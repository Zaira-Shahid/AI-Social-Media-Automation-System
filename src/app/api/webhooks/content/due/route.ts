import { NextResponse } from "next/server";

import { SCHEDULING_WORKFLOW } from "@/lib/automation/schema";
import { isWorkflowEnabled } from "@/lib/automation/gate";
import { runSchedulingCheck } from "@/lib/content/schedule";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The scheduler tick for n8n's `07_scheduled_publishing` (spec §44, §49).
 *
 * §49's workflow is: scheduler → verify approval → verify social account →
 * publish. This endpoint is the first two steps. It answers what is due and
 * confirms each one carries the approval record §18 requires, and it publishes
 * nothing.
 *
 * That is still true now that Module 16 exists: publishing lives at
 * `content/publish`, and this endpoint stays side-effect free (beyond its own
 * run bookkeeping) so an operator can ask what is due without publishing it.
 *
 * §41's Automation Control Center shows "Scheduling" and "Publishing" as
 * separate rows even though both are phases of this one n8n workflow —
 * `runSchedulingCheck` (`content/schedule.ts`) is what records the
 * "Scheduling" row's run, shared with the Automation screen's manual
 * "Run now".
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
    logger.warn("Rejected scheduler webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isWorkflowEnabled(SCHEDULING_WORKFLOW))) {
    logger.info("Scheduling tick skipped: disabled from the Automation Control Center");

    return NextResponse.json({ skipped: true, reason: "This automation is disabled." });
  }

  try {
    const outcome = await runSchedulingCheck(new Date(), "WEBHOOK");

    return NextResponse.json({
      /*
       * Named so no downstream step can mistake this for a publish result.
       * `published` is deliberately absent rather than zero, which would be a
       * claim that publishing ran here. It runs at `content/publish`.
       */
      due: outcome.due,
      posts: outcome.posts.map((post) => ({
        id: post.id,
        platform: post.platform,
        scheduledAt: post.scheduledAt,
        contentItemId: post.contentItemId,
      })),
      // §18: anything due without an approval record is reported, never sent on.
      unapproved: outcome.unapproved,
      detail:
        "These posts are due and approved; none were published. Publishing runs at /api/webhooks/content/publish.",
    });
  } catch (error) {
    logger.error("Scheduler webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not collect due posts" }, { status: 500 });
  }
}
