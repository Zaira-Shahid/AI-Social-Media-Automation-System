import { SocialAccountsScreen } from "@/components/social-accounts-screen";
import { getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { PLATFORMS } from "@/lib/content/schema";
import { describeAdapters } from "@/lib/publishing";
import { statusForExpiry, toAccountView } from "@/lib/social/schema";
import { listSocialAccounts } from "@/lib/social/store";

/**
 * Social accounts (spec §19, §42).
 *
 * Reads the connected accounts through the Admin SDK — `firestore.rules`
 * denies the browser even a read, because the documents hold encrypted tokens
 * — and hands the component a view type with no token field on it at all.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Social Accounts" };

export default async function SocialAccountsPage() {
  await requirePermission("content:view");

  const user = await getCurrentUser();
  const accounts = await listSocialAccounts();

  /*
   * §19's expiry window is applied here, once, on the server. A stored status
   * only changes when something writes it; whether a token has run out is a
   * function of the clock, so it is derived at render — the same rule
   * `getUsableCredentials` publishes by, rather than a second one in the UI.
   *
   * REVOKED is never overwritten: only the platform refusing a token can
   * establish that, and a date cannot un-revoke it.
   */
  const now = new Date();
  const views = accounts.map((account) => {
    const view = toAccountView(account);

    return view.status === "REVOKED"
      ? view
      : { ...view, status: statusForExpiry(view.expiresAt, now) };
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Social Accounts</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Which platforms this system can actually post to, and which account each one posts as.
        Access tokens are encrypted at rest and are never shown here.
      </p>

      <SocialAccountsScreen
        capabilities={describeAdapters(PLATFORMS)}
        accounts={views}
        canManage={user?.role ? can(user.role, "integrations:manage") : false}
      />
    </div>
  );
}
