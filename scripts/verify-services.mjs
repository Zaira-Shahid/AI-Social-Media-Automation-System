/**
 * One-off setup verification for Module 00 (spec §64 Step 5).
 *
 *   npm run verify:services
 *
 * Confirms that the credentials in `.env.local` actually reach Firestore,
 * Cloudinary and — when it is configured live — Slack. This is deliberately
 * NOT part of `npm run verify`: that gate
 * must stay offline and credential-free so it runs in CI, and it must never
 * be wired into /api/health, which is forbidden from making external calls
 * (§28).
 *
 * Standalone on purpose. The app's own helpers (`src/lib/firebase/admin.ts`,
 * `src/lib/cloudinary.ts`, `src/lib/slack/api.ts`) are marked `server-only`,
 * which is unimportable
 * from a plain Node script. What is being verified here is the contents of
 * the environment, not the app wiring — the test suite covers the wiring.
 *
 * Prints only pass/fail and error messages. Never a credential value (§55).
 */
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";

const REQUIRED = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("Run with: node --env-file=.env.local scripts/verify-services.mjs");
  process.exit(1);
}

/**
 * "(default)" is a literal name, parentheses included. A database created
 * with an explicit ID (for example "default") is a different database, and
 * targeting the wrong one fails as a bare `5 NOT_FOUND`.
 */
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID ?? "(default)";

/** Round-trip a throwaway document, then remove it. No product collection is touched. */
async function checkFirestore() {
  const app = initializeApp(
    {
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // .env carries literal backslash-n rather than real newlines.
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\n/g, "\n"),
      }),
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    },
    `verify-${Date.now()}`,
  );

  try {
    const ref = getFirestore(app, DATABASE_ID).collection("_healthcheck").doc("module-00");
    await ref.set({ checkedAt: new Date().toISOString() });
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("document written but not readable");
    await ref.delete();
  } finally {
    await deleteApp(app);
  }
}

async function checkCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  await cloudinary.api.ping();
}

/**
 * Slack error codes are returned as HTTP 200 with `{"ok": false}` (see
 * `src/lib/slack/api.ts`), so the body is the only success signal.
 */
async function slackCall(method, init = {}) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

  const body = await response.json();
  if (!body.ok) {
    const needed = body.needed ? ` (needs scope: ${body.needed})` : "";
    throw new Error(`${method} refused: ${body.error}${needed}`);
  }

  return body;
}

/**
 * Two probes, because the token being valid says nothing about the channel.
 *
 * `auth.test` confirms the token and reports which workspace it belongs to —
 * the check that catches a token pasted from the wrong Slack app.
 *
 * Channel visibility is then probed by scheduling a message ten minutes out
 * and immediately deleting it. `conversations.info` would be the obvious
 * call, but it needs `channels:read`/`groups:read`, which this app has no
 * other use for; the schedule/delete round-trip needs only `chat:write` and
 * fails with the same codes the live notifier would hit — `channel_not_found`
 * for a bad id, `not_in_channel` if the bot was never invited. Nothing is
 * ever visible in the channel, so this is safe to run repeatedly.
 */
async function checkSlack() {
  const channel = process.env.SLACK_NEWS_CHANNEL_ID;
  const auth = await slackCall("auth.test", { method: "POST" });

  const scheduled = await slackCall("chat.scheduleMessage", {
    method: "POST",
    body: JSON.stringify({
      channel,
      post_at: Math.floor(Date.now() / 1000) + 600,
      text: "verify:services probe — deleted before it can post.",
    }),
  });

  await slackCall("chat.deleteScheduledMessage", {
    method: "POST",
    body: JSON.stringify({ channel, scheduled_message_id: scheduled.scheduled_message_id }),
  });

  console.log(`      workspace "${auth.team}" as ${auth.user}, can post to ${channel}`);
}

const checks = [
  [`Firestore (Admin SDK write/read/delete on database ${DATABASE_ID})`, checkFirestore],
  ["Cloudinary (credentials ping)", checkCloudinary],
];

/*
 * Slack is optional: `SLACK_PROVIDER=mock` is a supported way to run the whole
 * system, and failing a setup check over a service the operator has chosen not
 * to wire up would be noise. Only a live provider is verified — but then the
 * missing-variable case is a real failure, not a skip, because
 * `getSlackTarget()` throws on exactly that (`src/lib/slack/index.ts`).
 */
if (process.env.SLACK_PROVIDER === "slack") {
  const missingSlack = ["SLACK_BOT_TOKEN", "SLACK_NEWS_CHANNEL_ID"].filter(
    (name) => !process.env[name],
  );

  checks.push([
    "Slack (auth.test + channel visibility)",
    missingSlack.length > 0
      ? () => {
          throw new Error(`SLACK_PROVIDER is "slack" but ${missingSlack.join(" and ")} is not set`);
        }
      : checkSlack,
  ]);
} else {
  console.log(`SKIP  Slack (SLACK_PROVIDER=${process.env.SLACK_PROVIDER ?? "mock"})`);
}

let failed = false;

for (const [label, run] of checks) {
  try {
    await run();
    console.log(`PASS  ${label}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
