import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed webhooks from n8n (spec §44).
 *
 * §44 says n8n triggers *signed* HTTP webhooks, not merely authenticated
 * ones. A bare shared secret in a header is only as safe as every proxy log,
 * error report and browser devtools panel it passes through; a signature over
 * the body is not replayable against a different payload and is not useful on
 * its own.
 *
 * Scheme: `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, hex encoded, sent
 * as `x-signature` alongside `x-timestamp`.
 */
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-timestamp";

/**
 * How far out of date a request may be.
 *
 * Five minutes is generous enough for clock skew between n8n's host and this
 * one, and short enough that a captured request stops working quickly.
 */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Constant-time compare, so a wrong signature cannot be discovered byte by byte. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so it is checked separately and the compare still runs.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a webhook request.
 *
 * The reason is for the server log only. Callers must not return it: telling
 * an unauthenticated caller whether the signature or the timestamp was wrong
 * helps only an attacker (§56).
 */
export function verifySignature({
  secret,
  signature,
  timestamp,
  body,
  now = Date.now(),
}: {
  secret: string;
  signature: string | null;
  timestamp: string | null;
  body: string;
  now?: number;
}): VerificationResult {
  if (!signature) return { ok: false, reason: "missing signature" };
  if (!timestamp) return { ok: false, reason: "missing timestamp" };

  const sentAt = Number(timestamp);

  if (!Number.isFinite(sentAt)) return { ok: false, reason: "malformed timestamp" };

  // Both directions: a future timestamp is as suspicious as a stale one, and
  // allowing it would let a captured request be replayed indefinitely.
  if (Math.abs(now - sentAt) > MAX_SKEW_MS) return { ok: false, reason: "timestamp out of range" };

  if (!equals(signature, sign(secret, timestamp, body))) {
    return { ok: false, reason: "signature mismatch" };
  }

  return { ok: true };
}
