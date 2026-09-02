import { SourceManager } from "@/components/source-manager";
import { requirePermission } from "@/lib/auth/current-user";
import { countNewsItems, listSources } from "@/lib/news/store";

/**
 * News source management (spec §5, §63).
 *
 * Nested under §34's News entry rather than invented as a new top-level item.
 * The §36 news screen itself — the article list, filters and selection — is a
 * later module; this is the plumbing behind it.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "News sources" };

export default async function NewsSourcesPage() {
  await requirePermission("sources:manage");

  const [sources, itemCount] = await Promise.all([listSources(), countNewsItems()]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">News sources</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Feeds discovery reads, in priority order. {itemCount} article
        {itemCount === 1 ? "" : "s"} discovered so far — ranking and selection come later.
      </p>

      <SourceManager sources={sources} />
    </div>
  );
}
