import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { runStrategyOptimization } from "@/lib/strategy/optimize";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The strategy optimization tick for n8n's `10_strategy_optimization`
 * (spec §44, §51).
 *
 * §51's workflow, this module's half: AI Strategy → Save Report. Runs after
 * `weekly-analysis` in the same trigger chain, reading what that one saved.
 * Signed like every other n8n trigger here.
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
    logger.warn("Rejected strategy optimization webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await runStrategyOptimization("system:strategy");

    return NextResponse.json(outcome);
  } catch (error) {
    logger.error("Strategy optimization webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not run strategy optimization" }, { status: 500 });
  }
}
