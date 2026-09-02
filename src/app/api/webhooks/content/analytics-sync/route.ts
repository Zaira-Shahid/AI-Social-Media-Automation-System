import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { runAnalyticsSync } from "@/lib/analytics/sync";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The analytics sync tick for n8n's `08_analytics_sync` (spec §44, §50).
 *
 * §50: fetch available platform data → normalize → store. Signed like every
 * other n8n trigger here — see `content/publish/route.ts` for the identical
 * pattern this follows.
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
    logger.warn("Rejected analytics sync webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await runAnalyticsSync();

    return NextResponse.json({
      candidates: outcome.candidates,
      synced: outcome.synced,
      skipped: outcome.skipped,
      failed: outcome.failed,
      posts: outcome.outcomes,
    });
  } catch (error) {
    logger.error("Analytics sync webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not sync analytics" }, { status: 500 });
  }
}
