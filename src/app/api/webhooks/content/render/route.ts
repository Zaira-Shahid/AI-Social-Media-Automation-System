import { NextResponse } from "next/server";

import { GenerationError } from "@/lib/content/generate";
import { renderPendingCards } from "@/lib/content/media";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * Static card rendering webhook for n8n (spec §15, §44, §47).
 *
 * Runs after content generation: §47's pipeline puts static visual generation
 * between the platform versions and validation, and this is that step. Signed
 * the same way as every other n8n trigger here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rendering and uploading nine cards is slow, and deliberately serial. */
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
    logger.warn("Rejected card rendering webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await renderPendingCards();

    return NextResponse.json(
      {
        status: outcome.status,
        rendered: outcome.rendered,
        // §52: per-card failures are reported, not swallowed.
        problems: outcome.problems,
        missingLogo: outcome.missingLogo,
        detail: outcome.detail,
      },
      /*
       * Nothing rendered answers 502 so n8n sees a failed step. PARTIAL is a
       * success with problems attached — some posts have an image and some do
       * not, and hiding that behind an error would be as misleading as hiding
       * the failures.
       */
      { status: outcome.status === "FAILED" ? 502 : 200 },
    );
  } catch (error) {
    if (error instanceof GenerationError) {
      logger.warn("Card rendering could not start", { reason: error.message });

      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    logger.error("Card rendering webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Rendering failed" }, { status: 500 });
  }
}
