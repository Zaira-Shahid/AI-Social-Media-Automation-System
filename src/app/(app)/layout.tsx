import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/current-user";

/**
 * Authenticated area.
 *
 * `requireUser()` verifies the session cookie with the Admin SDK on every
 * request. Middleware's cookie-presence check runs earlier but proves
 * nothing (§33) — this is the boundary that actually holds.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return <AppShell user={user}>{children}</AppShell>;
}
