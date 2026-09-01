import { NextResponse } from "next/server";

import { collectDuePosts } from "@/lib/content/schedule";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The scheduler tick for n8n's `07_scheduled_publishing` (spec §44, §49).
 *
 * §49's workflow is: scheduler → verify approval → verify social account →
 * publish. This endpoint is the first two steps. It answers what is due and
 * confirms each one carries the approval record §18 requires, and it publishes
 * nothing — there is no publishing engine until Module 16, and an endpoint
 * that reported posts as published would be inventing a capability (§67).
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

  try {
    const outcome = await collectDuePosts();

    return NextResponse.json({
      /*
       * Named so no downstream step can mistake this for a publish result.
       * `published` is deliberately absent rather than zero: absent is a
       * capability that does not exist yet, zero would be a claim that it ran.
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
      detail: "Publishing is Module 16. These posts are due and approved; none were published.",
    });
  } catch (error) {
    logger.error("Scheduler webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not collect due posts" }, { status: 500 });
  }
}
