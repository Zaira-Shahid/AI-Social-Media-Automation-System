import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which provider gets built (spec §21, §30, §67).
 *
 * The case that matters most is the one that must NOT happen: `AI_PROVIDER=groq`
 * with no key silently falling back to the mock. That would leave the system
 * producing simulated scores while every screen reported them as real.
 */
const BASE_ENV = {
  FIREBASE_ADMIN_PROJECT_ID: "test-project",
  FIREBASE_ADMIN_CLIENT_EMAIL: "admin@test-project.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nMIIBVAIBADANBgkq\\n-----END PRIVATE KEY-----\\n",
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
  delete process.env.AI_PROVIDER;
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_MODEL;
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

async function loadFactory() {
  return import("@/lib/ai");
}

describe("getAIProvider", () => {
  it("defaults to the mock provider, so nothing reaches a live service by accident", async () => {
    const { getAIProvider } = await loadFactory();
    const provider = getAIProvider();

    expect(provider.name).toBe("mock");
    expect(provider.mode).toBe("MOCK");
  });

  it("builds the Groq provider when configured with a key", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-key";

    const { getAIProvider } = await loadFactory();
    const provider = getAIProvider();

    expect(provider.name).toBe("groq");
    expect(provider.mode).toBe("REAL");
    expect(provider.model).toBe("openai/gpt-oss-120b");
  });

  it("honours a model override", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-key";
    process.env.AI_MODEL = "openai/gpt-oss-20b";

    const { getAIProvider } = await loadFactory();

    expect(getAIProvider().model).toBe("openai/gpt-oss-20b");
  });

  it("throws rather than silently downgrading to mock when the key is missing", async () => {
    process.env.AI_PROVIDER = "groq";

    const { getAIProvider } = await loadFactory();

    expect(() => getAIProvider()).toThrow(/GROQ_API_KEY/);
  });

  it("rejects a provider name that has no adapter", async () => {
    process.env.AI_PROVIDER = "some-other-provider";

    const { getAIProvider } = await loadFactory();

    expect(() => getAIProvider()).toThrow(/AI_PROVIDER/);
  });

  it("never returns a REAL mode provider without a key", async () => {
    process.env.AI_PROVIDER = "groq";

    const { getAIProvider } = await loadFactory();

    let provider;
    try {
      provider = getAIProvider();
    } catch {
      provider = null;
    }

    expect(provider).toBeNull();
  });
});
