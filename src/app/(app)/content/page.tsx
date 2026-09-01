import { ContentList } from "@/components/content-list";
import { getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { postStatusSchema } from "@/lib/content/schema";
import { listPlatformPostsFor, listRecentContentItems } from "@/lib/content/store";
import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * The content screen and review queue (spec §16, §17, §37).
 *
 * §37's states are the tabs; §16's preview is what each platform card shows.
 * The story-level status a reader sees is derived in the component and stored
 * nowhere, because §17 says it must never be the value that authorizes
 * anything.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Content" };

const RECENT_LIMIT = 20;

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("content:view");

  const params = await searchParams;
  const raw = (Array.isArray(params.status) ? params.status[0] : params.status) ?? "";

  // An unknown status in the URL is ignored rather than shown as an error:
  // it is a filter, and the honest response to a filter nobody recognises is
  // the unfiltered list.
  const status = postStatusSchema.safeParse(raw).data ?? "";

  const user = await getCurrentUser();
  const items = await listRecentContentItems(RECENT_LIMIT);
  const posts = await listPlatformPostsFor(items.map((item) => item.id));

  const postsByItem: Record<string, StoredPlatformPost[]> = {};

  for (const post of posts) {
    if (status && post.status !== status) continue;

    (postsByItem[post.contentItemId] ??= []).push(post);
  }

  for (const list of Object.values(postsByItem)) {
    list.sort((a, b) => a.platform.localeCompare(b.platform));
  }

  /*
   * A story with no version in the selected state is dropped entirely rather
   * than shown empty. Filtering to "Rejected" and being handed three stories
   * that have nothing rejected is a worse answer than a short list.
   */
  const visible = status ? items.filter((item) => (postsByItem[item.id] ?? []).length > 0) : items;

  const role = user?.role;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Content</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One core message per selected story, adapted per platform. Each version carries its own
        status — a weak version for one platform never blocks the others, and nothing publishes
        without a human approving it.
      </p>

      <ContentList
        items={visible}
        postsByItem={postsByItem}
        activeStatus={status}
        canGenerate={role ? can(role, "automations:manage") : false}
        canRegenerate={role ? can(role, "content:regenerate") : false}
        canEdit={role ? can(role, "content:edit") : false}
        canApprove={role ? can(role, "content:approve") : false}
      />
    </div>
  );
}
