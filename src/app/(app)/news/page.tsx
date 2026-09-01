import { NewsShortlist } from "@/components/news-shortlist";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { requirePermission } from "@/lib/auth/current-user";
import { listRankedItems } from "@/lib/news/store";
import { NEWS_SHORTLIST_WORKFLOW } from "@/lib/slack/schema";
import { listNotifications } from "@/lib/slack/store";

/**
 * Ranked stories and the daily shortlist (spec §7, §8).
 *
 * Read-only. §36's full news screen — search, filters, article detail, and the
 * human choosing exactly three — is Module 06. What this page has to show is
 * that ranking produced something a person can judge: the score, why it
 * matters, and whether the score is real or simulated.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "News" };

export default async function NewsPage() {
  await requirePermission("content:view");

  const user = await getCurrentUser();
  const [items, notifications] = await Promise.all([
    listRankedItems(60),
    // Read server-side: `firestore.rules` denies clients this collection
    // outright, the same as the audit log (§33).
    listNotifications(NEWS_SHORTLIST_WORKFLOW, 5),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">News</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Shortlisted stories, highest scoring first. A human picks the final three — the ranking
        never does.
      </p>

      <NewsShortlist
        items={items}
        notifications={notifications}
        canRank={user?.role ? can(user.role, "automations:manage") : false}
      />
    </div>
  );
}
