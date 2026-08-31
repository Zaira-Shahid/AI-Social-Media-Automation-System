"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";
import { ingestSource, runNewsDiscovery } from "@/lib/news/ingest";
import { newsSourceInputSchema } from "@/lib/news/schema";
import {
  createSource,
  deleteSource,
  findSourceByFeedUrl,
  getSource,
  updateSource,
} from "@/lib/news/store";

/**
 * News source management (spec §5, §63).
 *
 * Every action re-checks `sources:manage` itself. A server action is a
 * callable endpoint whether or not a page rendered its form, and §33 is
 * explicit that the Admin SDK bypasses Security Rules.
 */
export interface SourceFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const SOURCES_PATH = "/news/sources";

function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }

  return errors;
}

export async function saveSource(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const user = await requirePermission("sources:manage");

  const id = String(form.get("id") ?? "").trim();

  const parsed = newsSourceInputSchema.safeParse({
    name: form.get("name"),
    feedUrl: form.get("feedUrl"),
    homepageUrl: form.get("homepageUrl") ?? "",
    category: form.get("category") ?? "",
    priority: form.get("priority"),
    active: form.get("active") === "on",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Some fields need attention.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  /*
   * Two sources pointing at one feed would ingest the same articles twice.
   * The items themselves would deduplicate — the document ID is derived from
   * the article URL — but the source list would be quietly wrong, and health
   * would be reported against whichever row ran last.
   */
  const owner = await findSourceByFeedUrl(parsed.data.feedUrl);

  if (owner && owner !== id) {
    return {
      status: "error",
      message: "That feed is already registered.",
      fieldErrors: { feedUrl: "Another source already uses this feed URL." },
    };
  }

  try {
    if (id) {
      await updateSource(id, parsed.data, user.uid);
    } else {
      await createSource(parsed.data, user.uid);
    }
  } catch (error) {
    logger.error("Failed to save news source", {
      error: error instanceof Error ? error.message : String(error),
    });

    return { status: "error", message: "Could not save. Please try again." };
  }

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: id ? `newsSources/${id}` : "newsSources",
    status: "SUCCESS",
    metadata: { operation: id ? "UPDATE" : "CREATE", feedUrl: parsed.data.feedUrl },
  });

  revalidatePath(SOURCES_PATH);

  return { status: "success", message: id ? "Source updated." : "Source added." };
}

export async function removeSource(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const user = await requirePermission("sources:manage");

  const id = String(form.get("id") ?? "").trim();
  if (!id) return { status: "error", message: "No source specified." };

  const source = await getSource(id);
  if (!source) return { status: "error", message: "That source no longer exists." };

  await deleteSource(id);

  /*
   * Articles already discovered from this source are kept. They carry their
   * own `sourceName` and `sourceUrl`, and §7 requires that source information
   * be retained — deleting the feed must not strip attribution from stories
   * that may already be scheduled.
   */
  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: `newsSources/${id}`,
    status: "SUCCESS",
    metadata: { operation: "DELETE", feedUrl: source.feedUrl },
  });

  revalidatePath(SOURCES_PATH);

  return { status: "success", message: `Removed ${source.name}.` };
}

/** Flip a source on or off without opening the edit form. */
export async function toggleSourceActive(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const user = await requirePermission("sources:manage");

  const id = String(form.get("id") ?? "").trim();
  const source = await getSource(id);

  if (!source) return { status: "error", message: "That source no longer exists." };

  // Rebuilt explicitly rather than spread: `id` and `health` are the system's,
  // and updateSource takes only the fields a person owns.
  await updateSource(
    id,
    {
      name: source.name,
      feedUrl: source.feedUrl,
      homepageUrl: source.homepageUrl,
      category: source.category,
      priority: source.priority,
      active: !source.active,
    },
    user.uid,
  );

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: `newsSources/${id}`,
    status: "SUCCESS",
    metadata: { operation: source.active ? "DEACTIVATE" : "ACTIVATE" },
  });

  revalidatePath(SOURCES_PATH);

  return {
    status: "success",
    message: `${source.name} ${source.active ? "deactivated" : "activated"}.`,
  };
}

/**
 * Run discovery now.
 *
 * n8n owns the schedule (§44), but the pipeline has to be exercisable before
 * any workflow exists — and when a source is failing, the person fixing it
 * needs to see the result immediately rather than waiting for tomorrow.
 */
export async function fetchNow(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  await requirePermission("sources:manage");

  const id = String(form.get("id") ?? "").trim();

  if (id) {
    const source = await getSource(id);
    if (!source) return { status: "error", message: "That source no longer exists." };

    const result = await ingestSource(source);
    revalidatePath(SOURCES_PATH);

    return result.ok
      ? {
          status: "success",
          message: `${source.name}: ${result.discovered} items, ${result.created} new.`,
        }
      : { status: "error", message: `${source.name} failed: ${result.error}` };
  }

  const { run } = await runNewsDiscovery("MANUAL");
  revalidatePath(SOURCES_PATH);

  return {
    // A PARTIAL run is reported as an error, because it is one: some feed did
    // not answer, and §52 says never silently fail.
    status: run.status === "SUCCESS" ? "success" : "error",
    message:
      run.sourcesAttempted === 0
        ? "No active sources to fetch."
        : `${run.sourcesAttempted - run.sourcesFailed}/${run.sourcesAttempted} sources fetched, ${run.itemsNew} new items.`,
  };
}
