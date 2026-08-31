"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { rankNow, type RankFormState } from "@/app/(app)/news/actions";
import { Button } from "@/components/ui/button";
import type { StoredNewsItem } from "@/lib/news/store";
import { cn } from "@/lib/utils";

/**
 * Ranked story list (spec §8).
 *
 * §8 fixes what each shortlisted story shows: headline, short summary, source,
 * published date, why it matters, and the relevance score. All six are here.
 */
const INITIAL_STATE: RankFormState = { status: "idle" };

function RankButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Ranking…" : "Rank now"}
    </Button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A simulated score must never be presented as a real one (§21).
 *
 * The badge sits next to the score rather than once at the top of the page,
 * because a story can outlive the run that scored it — a list can hold both.
 */
function ModeBadge({ analysis }: { analysis: Record<string, unknown> | undefined }) {
  if (analysis?.mode !== "MOCK") return null;

  return (
    <span
      className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      data-testid="mock-badge"
    >
      Simulated
    </span>
  );
}

function StoryRow({ item }: { item: StoredNewsItem }) {
  const analysis = item.aiAnalysis;
  const whyItMatters = typeof analysis?.whyItMatters === "string" ? analysis.whyItMatters : null;
  const shortlisted = item.status === "SHORTLISTED";

  return (
    <li className="border-b border-border py-4 last:border-b-0" data-testid="story-row">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              {item.title}
            </a>
            {shortlisted ? (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                Shortlisted
              </span>
            ) : null}
            <ModeBadge analysis={analysis} />
          </div>

          {item.summary ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
          ) : null}

          {whyItMatters ? (
            <p className="mt-2 text-sm">
              <span className="font-medium">Why it matters: </span>
              <span className="text-muted-foreground">{whyItMatters}</span>
            </p>
          ) : null}

          <p className="mt-2 text-xs text-muted-foreground">
            {item.sourceName} · {formatDate(item.publishedAt)}
            {item.category ? ` · ${item.category}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tabular-nums">{item.compositeScore ?? "—"}</p>
          <p className="text-xs text-muted-foreground">relevance {item.relevanceScore ?? "—"}</p>
        </div>
      </div>
    </li>
  );
}

export function NewsShortlist({ items, canRank }: { items: StoredNewsItem[]; canRank: boolean }) {
  const [state, action] = useActionState(rankNow, INITIAL_STATE);

  const shortlisted = items.filter((item) => item.status === "SHORTLISTED");
  const ranked = items.filter((item) => item.status !== "SHORTLISTED");

  return (
    <div className="mt-6">
      {canRank ? (
        <div className="flex items-center gap-3">
          <form action={action}>
            <RankButton />
          </form>

          {state.status !== "idle" && state.message ? (
            <p
              role="status"
              data-testid="rank-status"
              className={cn(
                "text-sm",
                state.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {state.mode === "MOCK" ? "Simulated — " : ""}
              {state.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        /* Empty state (§59): nothing has been ranked, which is not the same as nothing existing. */
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          No stories have been ranked yet. Discovery has to run first, and then ranking scores what
          it found.
        </p>
      ) : (
        <>
          <h2 className="mt-6 text-sm font-semibold">
            Shortlist ({shortlisted.length}) — a human picks three
          </h2>

          {shortlisted.length === 0 ? (
            <p className="mt-2 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
              Nothing scored high enough to shortlist. That is a real result, not an error — a thin
              day is better than a padded list.
            </p>
          ) : (
            <ul className="mt-2 rounded-lg border border-border px-4">
              {shortlisted.map((item) => (
                <StoryRow key={item.id} item={item} />
              ))}
            </ul>
          )}

          {ranked.length > 0 ? (
            <>
              <h2 className="mt-8 text-sm font-semibold">Scored but not shortlisted</h2>
              <ul className="mt-2 rounded-lg border border-border px-4 opacity-70">
                {ranked.map((item) => (
                  <StoryRow key={item.id} item={item} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
