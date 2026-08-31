import Link from "next/link";

/**
 * Shown when a signed-in user lacks the role for a route (§27).
 *
 * Deliberately says nothing about what the route contains or which role
 * would have been sufficient.
 */
export const metadata = { title: "Not authorized" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account does not have access to this area. Ask an administrator if you think this is
          a mistake.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
