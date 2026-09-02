import { NextResponse } from "next/server";

import { isWorkflowEnabled } from "@/lib/automation/gate";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { NEWS_DISCOVERY_WORKFLOW, runNewsDiscovery } from "@/lib/news/ingest";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * News discovery webhook for n8n (spec §44, §45).
 *
 * This is the `01_daily_news_discovery` trigger. It is unauthenticated in the
 * session sense — n8n has no login — and authenticated by an HMAC signature
 * over the raw body instead.
 *
 * The body is read as text, not JSON, because the signature covers the exact
 * bytes that were sent. Parsing first and re-serializing would sign something
 * subtly different.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A run walks every active feed, so it is far slower than a normal request.
 * Render's free tier will still cut this off eventually; n8n should treat a
 * dropped connection as unknown rather than failed, since the run continues.
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
    logger.warn("Rejected news ingestion webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isWorkflowEnabled(NEWS_DISCOVERY_WORKFLOW))) {
    logger.info("News discovery skipped: disabled from the Automation Control Center");

    return NextResponse.json({ skipped: true, reason: "This automation is disabled." });
  }

  try {
    const { run } = await runNewsDiscovery("WEBHOOK");

    // 200 even for a PARTIAL run: the request was handled, and the run record
    // carries the detail. n8n retrying would only re-fetch the feeds that
    // already worked.
    return NextResponse.json(
      {
        status: run.status,
        sourcesAttempted: run.sourcesAttempted,
        sourcesFailed: run.sourcesFailed,
        itemsDiscovered: run.itemsDiscovered,
        itemsNew: run.itemsNew,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("News ingestion webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
