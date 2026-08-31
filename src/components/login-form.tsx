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
 * One message for every failure mode.
 *
 * Distinguishing "no such user" from "wrong password" would turn this form
 * into an account-enumeration oracle for an internal-only system (§56).
 */
const GENERIC_ERROR = "Email or password is incorrect.";

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

      if (!response.ok) throw new Error("Session exchange failed");

      // `refresh` matters: the layout is server-rendered and would otherwise
      // still be holding the signed-out render.
      router.replace(next);
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
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
    } catch {
      // Swallowed on purpose. See the note above.
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
