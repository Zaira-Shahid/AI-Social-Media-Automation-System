import { describe, expect, it } from "vitest";

import { MAX_SKEW_MS, sign, verifySignature } from "@/lib/webhooks/signature";

/**
 * Webhook signatures (spec §44, §56, §58).
 *
 * §44 requires signed webhooks, not merely a shared secret in a header. These
 * tests are what stop that distinction from quietly eroding.
 */
const SECRET = "test-secret-value";
const BODY = JSON.stringify({ trigger: "daily" });
const NOW = 1_788_000_000_000;

function signedAt(timestamp: number, body = BODY) {
  return { signature: sign(SECRET, String(timestamp), body), timestamp: String(timestamp) };
}

describe("verifySignature", () => {
  it("accepts a correctly signed request", () => {
    const { signature, timestamp } = signedAt(NOW);

    expect(verifySignature({ secret: SECRET, signature, timestamp, body: BODY, now: NOW })).toEqual(
      {
        ok: true,
      },
    );
  });

  it("rejects a missing signature", () => {
    const result = verifySignature({
      secret: SECRET,
      signature: null,
      timestamp: String(NOW),
      body: BODY,
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    const { signature } = signedAt(NOW);

    expect(
      verifySignature({ secret: SECRET, signature, timestamp: null, body: BODY, now: NOW }).ok,
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const signature = sign("someone-elses-secret", String(NOW), BODY);

    expect(
      verifySignature({ secret: SECRET, signature, timestamp: String(NOW), body: BODY, now: NOW })
        .ok,
    ).toBe(false);
  });

  it("rejects a body altered after signing, which is the whole point of signing it", () => {
    const { signature, timestamp } = signedAt(NOW);

    const result = verifySignature({
      secret: SECRET,
      signature,
      timestamp,
      body: JSON.stringify({ trigger: "daily", extra: "injected" }),
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a replayed request once the window has passed", () => {
    const { signature, timestamp } = signedAt(NOW);

    const result = verifySignature({
      secret: SECRET,
      signature,
      timestamp,
      body: BODY,
      now: NOW + MAX_SKEW_MS + 1000,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a request inside the window, allowing for clock skew", () => {
    const { signature, timestamp } = signedAt(NOW);

    expect(
      verifySignature({
        secret: SECRET,
        signature,
        timestamp,
        body: BODY,
        now: NOW + MAX_SKEW_MS - 1000,
      }).ok,
    ).toBe(true);
  });

  it("rejects a timestamp from the future, which would extend a replay forever", () => {
    const future = NOW + MAX_SKEW_MS + 60_000;
    const { signature, timestamp } = signedAt(future);

    expect(verifySignature({ secret: SECRET, signature, timestamp, body: BODY, now: NOW }).ok).toBe(
      false,
    );
  });

  it("rejects a timestamp that is not a number", () => {
    const { signature } = signedAt(NOW);

    expect(
      verifySignature({ secret: SECRET, signature, timestamp: "yesterday", body: BODY, now: NOW })
        .ok,
    ).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(
      verifySignature({
        secret: SECRET,
        signature: "abc",
        timestamp: String(NOW),
        body: BODY,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  it("binds the signature to the timestamp, so one cannot be swapped for another", () => {
    const { signature } = signedAt(NOW);

    expect(
      verifySignature({
        secret: SECRET,
        signature,
        timestamp: String(NOW + 1000),
        body: BODY,
        now: NOW,
      }).ok,
    ).toBe(false);
  });
});
