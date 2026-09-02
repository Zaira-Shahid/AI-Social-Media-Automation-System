import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { runDuePublishing } from "@/lib/publishing/publish";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The publishing tick for n8n's `07_scheduled_publishing` (spec §44, §49).
 *
 * The companion to `content/due`, which answers what is due and publishes
 * nothing. This one runs §49's remaining steps: verify the social account,
 * publish, verify the response, store the platform post id, and set PUBLISHED
 * or FAILED.
 *
 * Kept as its own endpoint rather than folded into `content/due` so that
 * asking what is due stays a question with no side effects — the thing an
 * operator wants when a publish has gone wrong is a way to look without
 * publishing again.
 *
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
    logger.warn("Rejected publishing webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await runDuePublishing();

    return NextResponse.json({
      due: outcome.due,
      published: outcome.published,
      failed: outcome.failed,
      retrying: outcome.retrying,
      skipped: outcome.skipped,
      notified: outcome.notified,
      /*
       * Per-post detail, so an n8n run that reports "3 published, 1 failed"
       * can also say which one and why without a second call. No token, no
       * credential and no caption — only ids, the platform, and the reason
       * already stored on the post (§55).
       */
      posts: outcome.outcomes,
    });
  } catch (error) {
    logger.error("Publishing webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not publish due posts" }, { status: 500 });
  }
}
