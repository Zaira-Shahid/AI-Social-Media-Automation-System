import { NextResponse } from "next/server";

import { isWorkflowEnabled } from "@/lib/automation/gate";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { runWeeklyAnalysis, WEEKLY_ANALYSIS_WORKFLOW } from "@/lib/reporting/weekly";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/webhooks/signature";

/**
 * The weekly analysis tick for n8n's `09_weekly_performance_analysis`
 * (spec §44, §51).
 *
 * §51's workflow, this module's half: Analytics → Performance Analysis →
 * Save Report. Signed like every other n8n trigger here — see
 * `content/publish/route.ts` for the identical pattern this follows.
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
    logger.warn("Rejected weekly analysis webhook", { reason: verification.reason });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isWorkflowEnabled(WEEKLY_ANALYSIS_WORKFLOW))) {
    logger.info("Weekly analysis skipped: disabled from the Automation Control Center");

    return NextResponse.json({ skipped: true, reason: "This automation is disabled." });
  }

  try {
    const outcome = await runWeeklyAnalysis();

    return NextResponse.json(outcome);
  } catch (error) {
    logger.error("Weekly analysis webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Could not run weekly analysis" }, { status: 500 });
  }
}
