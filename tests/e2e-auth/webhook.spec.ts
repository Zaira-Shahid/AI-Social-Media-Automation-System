import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

/**
 * The n8n ingestion webhook (spec §44, §45).
 *
 * Runs under the emulators, where the seed has cleared every source — so the
 * accepted request performs a real run that fetches nothing. §58 keeps tests
 * off the network, and the point here is the signature and the run record,
 * not the feeds.
 */
test.skip(
  !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "requires the Firebase emulators — run npm run test:e2e:auth",
);

const SECRET = process.env.N8N_WEBHOOK_SECRET ?? "";

function signed(body: string, timestamp = String(Date.now())) {
  return {
    "x-timestamp": timestamp,
    "x-signature": createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex"),
    "content-type": "application/json",
  };
}

test("a correctly signed request runs discovery", async ({ request }) => {
  const body = JSON.stringify({ trigger: "daily" });

  const response = await request.post("/api/webhooks/news/ingest", {
    headers: signed(body),
    data: body,
  });

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ sourcesAttempted: 0, itemsNew: 0 });
});

test("a signature over a different body is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/news/ingest", {
    headers: signed(JSON.stringify({ trigger: "daily" })),
    data: JSON.stringify({ trigger: "daily", injected: true }),
  });

  expect(response.status()).toBe(401);
});

test("a stale timestamp is rejected, so a captured request cannot be replayed", async ({
  request,
}) => {
  const body = JSON.stringify({ trigger: "daily" });
  const stale = String(Date.now() - 10 * 60 * 1000);

  const response = await request.post("/api/webhooks/news/ingest", {
    headers: signed(body, stale),
    data: body,
  });

  expect(response.status()).toBe(401);
});

test("an unsigned notification request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/news/notify", {
    data: JSON.stringify({ trigger: "daily" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("a correctly signed request runs the Slack notification in mock mode", async ({ request }) => {
  const body = JSON.stringify({ trigger: "daily" });

  const response = await request.post("/api/webhooks/news/notify", {
    headers: signed(body),
    data: body,
  });

  expect(response.status()).toBe(200);

  const payload = await response.json();

  // §21: the caller is told plainly that nothing reached a real workspace.
  expect(payload.mode).toBe("MOCK");
  /*
   * Whether there is a shortlist to send depends on whether the ranking spec
   * has run yet, and spec files do not share an order. Both outcomes are
   * successes; a delivery failure would be neither.
   */
  expect(["SENT", "SKIPPED"]).toContain(payload.status);
});

test("an unsigned content generation request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/content/generate", {
    data: JSON.stringify({ trigger: "selection" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("an unsigned card rendering request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/content/render", {
    data: JSON.stringify({ trigger: "generation" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("an unsigned scheduler request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/content/due", {
    data: JSON.stringify({ trigger: "schedule" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("the scheduler reports what is due and publishes nothing (§49, §67)", async ({ request }) => {
  const body = JSON.stringify({ trigger: "schedule" });

  const response = await request.post("/api/webhooks/content/due", {
    headers: signed(body),
    data: body,
  });

  expect(response.status()).toBe(200);

  const payload = await response.json();

  // Nothing is approved in this run, so nothing can be scheduled or due.
  expect(payload.due).toBe(0);
  expect(payload.unapproved).toEqual([]);
  // §67: this endpoint never claims a publish. It reports; publishing is a
  // separate, signed call to content/publish.
  expect(payload.published).toBeUndefined();
  expect(payload.detail).toContain("/api/webhooks/content/publish");
});

test("an unsigned publishing request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/content/publish", {
    data: JSON.stringify({ trigger: "publish" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("the publishing tick reports zero when nothing is due (§49)", async ({ request }) => {
  const body = JSON.stringify({ trigger: "publish" });

  const response = await request.post("/api/webhooks/content/publish", {
    headers: signed(body),
    data: body,
  });

  expect(response.status()).toBe(200);

  const payload = await response.json();

  // Nothing is approved or scheduled in this run, so there is nothing to
  // publish — and the counts say zero rather than being absent (§67).
  expect(payload.due).toBe(0);
  expect(payload.published).toBe(0);
  expect(payload.failed).toBe(0);
  expect(payload.posts).toEqual([]);
  // Silence on Slack when nothing failed.
  expect(payload.notified).toBe(false);
});

test("an unsigned token-expiry request is rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/social/tokens", {
    data: JSON.stringify({ trigger: "tokens" }),
    headers: { "content-type": "application/json" },
  });

  expect(response.status()).toBe(401);
});

test("the token-expiry tick reports what it checked and warns nobody (§19)", async ({
  request,
}) => {
  const body = JSON.stringify({ trigger: "tokens" });

  const response = await request.post("/api/webhooks/social/tokens", {
    headers: signed(body),
    data: body,
  });

  expect(response.status()).toBe(200);

  const payload = await response.json();

  // No account is connected in this run, so there is nothing to warn about —
  // and silence is the correct outcome, not an "all fine" message.
  expect(payload.checked).toBe(0);
  expect(payload.alerted).toBe(false);
  expect(payload.expiring).toEqual([]);
});
