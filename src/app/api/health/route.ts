import { NextResponse } from "next/server";

/**
 * Liveness endpoint — the keep-warm target for n8n (spec §28).
 *
 * Render free services spin down after 15 minutes idle and cold start in
 * roughly a minute, which would blow Slack's 3-second deadline for
 * interactive actions (§9). n8n pings this every ~10 minutes to keep the
 * instance awake.
 *
 * Deliberately minimal:
 *   - No Firestore read, no Cloudinary call, no external request. Its only
 *     job is to keep the process warm and confirm it is alive.
 *   - No version, config or dependency detail in the response — it is
 *     unauthenticated, so it must reveal nothing (§56).
 *   - Never written to the audit log (§55) or counted as an automation run
 *     (§41). At ~4,300 pings a month it would bury real activity.
 *
 * A deeper readiness check that touches dependencies may be added later,
 * but it must be a separate, authenticated endpoint — not this one.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
