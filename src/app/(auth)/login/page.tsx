import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Login (spec §26).
 *
 * There is no signup counterpart and there must never be one: accounts are
 * provisioned by an administrator through the Admin SDK.
 */
export const dynamic = "force-dynamic";

/**
 * Only same-site paths are accepted as a return destination. Anything else —
 * a full URL, or a protocol-relative `//evil.example` — is discarded, which
 * is what keeps `?next=` from being an open redirect.
 */
function safeNext(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  // Someone already signed in has no business on the login screen.
  const user = await getCurrentUser();
  if (user) redirect(destination);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">AI Social Media Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue.</p>
        </div>

        <LoginForm next={destination} />

        <p className="mt-6 text-xs text-muted-foreground">
          Internal system. Accounts are created by an administrator — there is no self-signup.
        </p>
      </div>
    </main>
  );
}
