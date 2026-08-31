import { requireUser } from "@/lib/auth/current-user";
import { permissionsFor, roleLabel } from "@/lib/auth/roles";

/**
 * Module 01 placeholder.
 *
 * The real Dashboard (spec §35) is built in a later module. This shows who
 * is signed in and what their role permits, which is the only thing this
 * module actually has to demonstrate.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const permissions = user.role ? permissionsFor(user.role) : [];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">AI Social Media Command Center</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email ?? user.uid}. No product features are implemented yet.
      </p>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Your access</h2>

        {user.role ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">Role: {roleLabel(user.role)}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </>
        ) : (
          /* Empty state (§59): an account with no claim is provisioned but unfinished. */
          <p className="mt-2 text-sm text-muted-foreground">
            No role has been assigned to this account yet, so nothing is accessible. Ask an
            administrator to finish provisioning it.
          </p>
        )}
      </div>
    </div>
  );
}
