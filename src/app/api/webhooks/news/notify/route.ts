import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { sendShortlistNotification } from "@/lib/slack/notify";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * Slack shortlist notification webhook for n8n (spec §9, §44, §45).
 *
 * The `03_slack_news_notification` trigger, which runs after ranking. Signed
 * the same way as the discovery and ranking webhooks — see the discovery route
 * for why the body is read as raw text before verification.
 *
 * Note this is an *inbound* n8n trigger, not a Slack request. Nothing here
 * handles Slack interactivity: that needs a public HTTPS request URL answered
 * within three seconds, which this system does not have until it is deployed,
 * and §9 forbids pretending otherwise.
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
    // The reason goes to the log, never to the caller (§56).
    logger.warn("Rejected shortlist notification webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await sendShortlistNotification("WEBHOOK");

    return NextResponse.json(
      {
        status: outcome.status,
        // §21: the caller is told plainly whether a message really went out.
        mode: outcome.mode,
        stories: outcome.storyCount,
        detail: outcome.detail,
      },
      /*
       * A delivery failure answers 502, so n8n's own error handling sees it
       * as a failed step. SENT and SKIPPED are both successful outcomes of
       * the workflow — skipping an empty day is not an error (§67).
       */
      { status: outcome.status === "FAILED" ? 502 : 200 },
    );
  } catch (error) {
    // Only configuration failures reach here: a missing token or channel.
    logger.error("Shortlist notification webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Notification failed" }, { status: 500 });
  }
}
