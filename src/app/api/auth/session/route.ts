import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { createSession, destroySession, verifySession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/**
 * Session exchange (spec §26).
 *
 * POST   client SDK ID token  ->  httpOnly session cookie
 * DELETE clears the cookie and revokes refresh tokens
 *
 * The browser never mints the cookie itself; only the Admin SDK can, which
 * is what makes the cookie trustworthy on the server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1, "idToken is required"),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const user = await createSession(parsed.data.idToken);

    await recordAudit({
      actor: user.uid,
      action: "LOGIN",
      resource: `profiles/${user.uid}`,
      status: "SUCCESS",
      metadata: { role: user.role },
    });

    return NextResponse.json({ uid: user.uid, role: user.role }, { status: 200 });
  } catch (error) {
    // The token was rejected. Log it server-side for diagnosis, but tell the
    // caller nothing specific — the response must not help distinguish an
    // expired token from a forged one (§56).
    logger.warn("Rejected session creation", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE() {
  const user = await verifySession();

  await destroySession();

  if (user) {
    await recordAudit({
      actor: user.uid,
      action: "LOGIN",
      resource: `profiles/${user.uid}`,
      status: "SUCCESS",
      metadata: { event: "SIGNED_OUT" },
    });
  }

  // Always 200. Signing out an already-signed-out browser is not a failure.
  return NextResponse.json({ ok: true }, { status: 200 });
}
