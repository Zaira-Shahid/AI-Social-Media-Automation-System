"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { getClientAuth } from "@/lib/firebase/client";

/**
 * Login form (spec §26).
 *
 * Two steps, both required: the client SDK verifies the password and mints
 * an ID token, then the server exchanges that token for an httpOnly session
 * cookie. Only the second step produces something the server will trust.
 */

/**
 * One message for every *credential* failure.
 *
 * Distinguishing "no such user" from "wrong password" would turn this form
 * into an account-enumeration oracle for an internal-only system (§56).
 */
const GENERIC_ERROR = "Email or password is incorrect.";

/**
 * Codes that genuinely mean "those credentials are wrong".
 *
 * Everything else gets its own message. Reporting an unreachable auth service
 * as a bad password sends the user to change a password that was never the
 * problem — §52 says never silently fail, and a wrong explanation is a silent
 * failure wearing a hat.
 */
const CREDENTIAL_ERROR_CODES = new Set([
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-email",
  "auth/user-disabled",
]);

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

function messageForSignInError(error: unknown): string {
  const code = errorCode(error);

  if (CREDENTIAL_ERROR_CODES.has(code)) return GENERIC_ERROR;

  if (code === "auth/network-request-failed") {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a few minutes and try again.";
  }

  // Everything left is a configuration or service fault, not the user's doing.
  // The code is shown because it is the one thing that makes it diagnosable.
  return `Sign-in is not working right now${code ? ` (${code})` : ""}. This is not your password — tell an administrator.`;
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const credential = await signInWithEmailAndPassword(getClientAuth(), email, password);

      const idToken = await credential.user.getIdToken();

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        // The password was right — the server rejected the token exchange.
        // Saying "incorrect password" here would be a lie.
        throw Object.assign(new Error("Session exchange failed"), {
          code: "app/session-exchange-failed",
        });
      }

      // `refresh` matters: the layout is server-rendered and would otherwise
      // still be holding the signed-out render.
      router.replace(next);
      router.refresh();
    } catch (error) {
      // The only channel a browser has, and without it a misconfiguration is
      // invisible to whoever is debugging.
      console.error("Sign-in failed", error);
      setError(messageForSignInError(error));
      setPending(false);
    }
  }

  /**
   * Password recovery (§26).
   *
   * Always reports success, whether or not the address has an account — for
   * the same enumeration reason as the login error above.
   */
  async function handleReset() {
    if (!email) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }

    setError(null);
    setPending(true);

    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(getClientAuth(), email);
    } catch (error) {
      /*
       * The *message* stays generic — that is what §26 asks for, so the form
       * cannot be used to discover which addresses have accounts.
       *
       * The error itself is not swallowed. Discarding it entirely made a
       * genuinely broken reset indistinguishable from a working one, which
       * cost real debugging time.
       */
      console.error("Password reset request failed", error);
    } finally {
      setNotice("If that address has an account, a password reset email is on its way.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>

      {error ? (
        <p role="alert" data-testid="login-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="px-0"
        onClick={handleReset}
        disabled={pending}
      >
        Forgot password?
      </Button>
    </form>
  );
}
