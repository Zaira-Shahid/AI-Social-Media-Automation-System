import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { alertOnExpiringTokens } from "@/lib/social/expiry";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The token-expiry tick (spec §19, §41, §44).
 *
 * §19 asks for a Slack alert 5–7 days before a token lapses. A warning needs
 * something to run it, and n8n is where every other schedule in this system
 * lives (§44), so this is a signed trigger like the rest — run it daily.
 *
 * It publishes nothing and changes nothing. It reads expiry dates and warns.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();

  const verification = verifySignature({
    secret: getServerEnv().N8N_WEBHOOK_SECRET,
    signature: request.headers.get(SIGNATURE_HEADER),
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    body,
  });

  if (!verification.ok) {
    logger.warn("Rejected token-expiry webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await alertOnExpiringTokens();

    return NextResponse.json({
      checked: outcome.checked,
      alerted: outcome.alerted,
      // §21/§66: whether the alert was real or simulated travels with it.
      mode: outcome.mode,
      expiring: outcome.expiring.map((account) => ({
        platform: account.platform,
        status: account.status,
        expiresAt: account.expiresAt,
        daysRemaining: account.daysRemaining,
      })),
    });
  } catch (error) {
    /*
     * A Slack failure lands here rather than being swallowed. Reporting a
     * successful check when the warning never reached anyone is exactly the
     * failure §67 forbids.
     */
    logger.error("Token-expiry check failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not check token expiry" }, { status: 500 });
  }
}
