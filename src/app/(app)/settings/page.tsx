import { SettingsScreen } from "@/components/settings-screen";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/roles";
import { getServerEnv } from "@/lib/env.server";
import { listUserProfiles } from "@/lib/settings/store";

/**
 * The Settings screen (spec §34's nav list — never assigned its own module
 * or content requirements, unlike every other item on that list).
 *
 * Two things this app actually has that were previously configurable only
 * outside the UI: provisioned accounts (§26 — CLI-only creation, by design,
 * shown here read-only) and the handful of env-sourced operational values
 * screens elsewhere already depend on silently (§54's timezone chief among
 * them).
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requirePermission("settings:manage");

  const showUsers = user.role ? can(user.role, "users:manage") : false;
  const users = showUsers ? await listUserProfiles() : null;

  const env = getServerEnv();

  return (
    <SettingsScreen
      users={users}
      appConfig={{
        timezone: env.APP_TIMEZONE,
        sessionCookieMaxAgeDays: env.SESSION_COOKIE_MAX_AGE_DAYS,
        appBaseUrl: env.APP_BASE_URL,
      }}
    />
  );
}
