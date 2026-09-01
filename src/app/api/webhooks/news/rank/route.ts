import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { runNewsRanking } from "@/lib/news/rank";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * News ranking webhook for n8n (spec §44, §46).
 *
 * This is the `02_news_ranking` trigger, which runs after discovery. Signed
 * the same way as the discovery webhook — see that route for why the body is
 * read as raw text.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A run makes several AI calls with deliberate pacing between them to stay
 * inside the free plan's per-minute limits, so it is slow by design.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.text();

  const verification = verifySignature({
    secret: getServerEnv().N8N_WEBHOOK_SECRET,
    signature: request.headers.get(SIGNATURE_HEADER),
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    body,
  });

  if (!verification.ok) {
    // The reason goes to the log, never to the caller: telling an
    // unauthenticated client whether the signature or the clock was wrong
    // helps only someone probing it (§56).
    logger.warn("Rejected news ranking webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { run, shortlisted, rejected, mode } = await runNewsRanking("WEBHOOK");

    return NextResponse.json(
      {
        status: run.status,
        // §21: the caller is told plainly whether these scores are real.
        mode,
        considered: run.itemsDiscovered,
        shortlisted,
        rejected,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("News ranking webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Ranking failed" }, { status: 500 });
  }
}
