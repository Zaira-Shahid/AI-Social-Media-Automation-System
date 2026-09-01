import { NewsAutomationControls } from "@/components/news-automation-controls";
import { NewsScreen } from "@/components/news-screen";
import { getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { currentSelectionDate } from "@/lib/news/selection";
import { getSelectionForDate, listNewsForScreen } from "@/lib/news/store";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";
import { listNotifications } from "@/lib/slack/store";

/**
 * The news screen (spec §36) and the daily selection (§8, §46).
 *
 * Module 04 shipped a read-only list of what ranking produced and deferred the
 * rest of §36 to here. This is that screen: search, filters, selection state,
 * a link into each article's detail, and the human choosing exactly three.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "News" };

/**
 * How many scored stories the screen reads.
 *
 * Search and category filtering happen over this page in memory — Firestore
 * offers no full-text search — so the bound is what keeps a filter from
 * turning into a full-collection scan. It comfortably covers several days of
 * discovery at the volumes §5 implies.
 */
const SCREEN_LIMIT = 120;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("content:view");

  const params = await searchParams;
  const query = first(params.q);
  const category = first(params.category);
  const status = first(params.status);

  const user = await getCurrentUser();

  const [allItems, selection, notifications] = await Promise.all([
    listNewsForScreen(SCREEN_LIMIT),
    getSelectionForDate(currentSelectionDate()),
    // Read server-side: `firestore.rules` denies clients this collection
    // outright, the same as the audit log (§33).
    listNotifications(NEWS_SHORTLIST_WORKFLOW, 5),
  ]);

  /*
   * Categories come from what was actually discovered rather than a fixed
   * list: sources are configurable (§5), so a hardcoded set would go stale the
   * first time someone adds a feed.
   */
  const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))].sort();

  const needle = query.toLowerCase();

  const items = allItems
    .filter((item) => {
      // Rejected stories are hidden unless asked for. They are kept for the
      // record (§7), not to be scrolled past every day.
      if (status) return item.status === status;
      return item.status !== "REJECTED";
    })
    .filter((item) => (category ? item.category === category : true))
    .filter((item) =>
      needle
        ? item.title.toLowerCase().includes(needle) || item.summary.toLowerCase().includes(needle)
        : true,
    )
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));

  const role = user?.role;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">News</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ranked stories, highest scoring first. A human picks the final three — the ranking never
        does.
      </p>

      {role && can(role, "automations:manage") ? (
        <div className="mt-6">
          <NewsAutomationControls notifications={notifications} />
        </div>
      ) : null}

      <NewsScreen
        items={items}
        categories={categories}
        selection={selection}
        canSelect={role ? can(role, "news:select") : false}
        query={query}
        category={category}
        status={status}
      />
    </div>
  );
}
