import { ContentList } from "@/components/content-list";
import { getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { listPlatformPostsFor, listRecentContentItems } from "@/lib/content/store";
import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * Generated content (spec §12, §13, §37).
 *
 * §37's full screen — the review queue split by status, editing, approval,
 * rejection and scheduling — is Module 09. This is what Module 07 owes: a
 * place to see what generation produced, per story and per platform, and to
 * ask for a rewrite.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Content" };

const RECENT_LIMIT = 20;

export default async function ContentPage() {
  await requirePermission("content:view");

  const user = await getCurrentUser();
  const items = await listRecentContentItems(RECENT_LIMIT);
  const posts = await listPlatformPostsFor(items.map((item) => item.id));

  /*
   * Grouped here rather than in the client component: the page already knows
   * the shape, and passing a flat list would make the component re-derive it
   * on every render.
   */
  const postsByItem: Record<string, StoredPlatformPost[]> = {};

  for (const post of posts) {
    (postsByItem[post.contentItemId] ??= []).push(post);
  }

  for (const list of Object.values(postsByItem)) {
    list.sort((a, b) => a.platform.localeCompare(b.platform));
  }

  const role = user?.role;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Content</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One core message per selected story, adapted per platform. Each version carries its own
        status — a weak version for one platform never blocks the others.
      </p>

      <ContentList
        items={items}
        postsByItem={postsByItem}
        canGenerate={role ? can(role, "automations:manage") : false}
        canRegenerate={role ? can(role, "content:regenerate") : false}
      />
    </div>
  );
}
