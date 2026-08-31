"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getClientAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";

/**
 * Sign out of both halves of the session.
 *
 * The server cookie and the client SDK's own state are separate. Clearing
 * only one leaves the app in a confusing half-signed-in state, so both are
 * cleared here, server first — if that call fails the user is still signed
 * in and should be told, rather than being shown a signed-out UI backed by a
 * live session.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Sign out failed");

      const { signOut: clientSignOut } = await import("firebase/auth");
      await clientSignOut(getClientAuth());

      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={signOut}
        disabled={pending}
      >
        <LogOut className="size-4" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </Button>

      {error ? (
        <p role="alert" className="mt-1 px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
