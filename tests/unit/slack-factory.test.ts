import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which notifier gets built (spec §9, §21, §67).
 *
 * The case that matters most is the one that must NOT happen: a half-configured
 * Slack app quietly falling back to the mock. The system would keep logging
 * notifications while the team's channel stayed empty.
 */
const BASE_ENV = {
  FIREBASE_ADMIN_PROJECT_ID: "test-project",
  FIREBASE_ADMIN_CLIENT_EMAIL: "admin@test-project.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkq\n-----END PRIVATE KEY-----\n",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "123456789012345",
  CLOUDINARY_API_SECRET: "test-secret-value",
  APP_TIMEZONE: "Asia/Karachi",
  TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  N8N_WEBHOOK_SECRET: "test-webhook-secret",
};

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { ...originalEnv, ...BASE_ENV };
  delete process.env.SLACK_PROVIDER;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_NEWS_CHANNEL_ID;
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

async function loadFactory() {
  return import("@/lib/slack");
}

describe("getSlackTarget", () => {
  it("defaults to the mock notifier, so nothing reaches a real workspace by accident", async () => {
    const { getSlackTarget } = await loadFactory();
    const { notifier } = getSlackTarget();

    expect(notifier.name).toBe("mock");
    expect(notifier.mode).toBe("MOCK");
  });

  it("builds the Slack notifier when the token and channel are both set", async () => {
    process.env.SLACK_PROVIDER = "slack";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_NEWS_CHANNEL_ID = "C0123456789";

    const { getSlackTarget } = await loadFactory();
    const { notifier, channel } = getSlackTarget();

    expect(notifier.name).toBe("slack");
    expect(notifier.mode).toBe("REAL");
    expect(channel).toBe("C0123456789");
  });

  it("throws rather than silently downgrading to mock when the token is missing", async () => {
    process.env.SLACK_PROVIDER = "slack";
    process.env.SLACK_NEWS_CHANNEL_ID = "C0123456789";

    const { getSlackTarget } = await loadFactory();

    expect(() => getSlackTarget()).toThrow(/SLACK_BOT_TOKEN/);
  });

  it("throws when the channel is missing, which is just as unconfigured", async () => {
    process.env.SLACK_PROVIDER = "slack";
    process.env.SLACK_BOT_TOKEN = "xoxb-test";

    const { getSlackTarget } = await loadFactory();

    expect(() => getSlackTarget()).toThrow(/SLACK_NEWS_CHANNEL_ID/);
  });

  it("rejects a provider name that has no adapter", async () => {
    process.env.SLACK_PROVIDER = "discord";

    const { getSlackTarget } = await loadFactory();

    expect(() => getSlackTarget()).toThrow(/SLACK_PROVIDER/);
  });

  it("shows where a simulated message would have gone", async () => {
    process.env.SLACK_NEWS_CHANNEL_ID = "C0123456789";

    const { getSlackTarget } = await loadFactory();
    const { notifier, channel } = getSlackTarget();

    expect(notifier.mode).toBe("MOCK");
    expect(channel).toBe("C0123456789");
  });
});
