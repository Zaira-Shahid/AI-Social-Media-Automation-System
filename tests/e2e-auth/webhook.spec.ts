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
