import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Env validation must fail fast and loudly (spec §31 pattern applied to
 * configuration). A malformed environment surfacing later as an opaque
 * Admin SDK error is exactly what these tests exist to prevent.
 *
 * The module caches its result, so each test re-imports with a fresh module
 * registry.
 */

const VALID_ENV = {
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
  process.env = { ...originalEnv, ...VALID_ENV };
  // Force re-evaluation so the cached parse result does not leak between tests.
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

async function loadEnv() {
  return import("@/lib/env.server");
}

describe("server env validation", () => {
  it("accepts a well-formed environment", async () => {
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).not.toThrow();
  });

  it("converts escaped newlines in the private key to real newlines", async () => {
    const { getServerEnv } = await loadEnv();
    const env = getServerEnv();

    expect(env.FIREBASE_ADMIN_PRIVATE_KEY).toContain("\n");
    expect(env.FIREBASE_ADMIN_PRIVATE_KEY).not.toContain("\\n");
  });

  it("rejects a missing required variable", async () => {
    delete process.env.CLOUDINARY_API_SECRET;

    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/CLOUDINARY_API_SECRET/);
  });

  it("rejects an encryption key that is not 32 bytes of hex", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "tooshort";

    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("rejects a private key that is not PEM-shaped", async () => {
    process.env.FIREBASE_ADMIN_PRIVATE_KEY = "not-a-key";

    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/FIREBASE_ADMIN_PRIVATE_KEY/);
  });

  it("does not include secret values in the error message", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "invalid-but-secret-looking-value";

    const { getServerEnv } = await loadEnv();

    try {
      getServerEnv();
      expect.unreachable("expected validation to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("invalid-but-secret-looking-value");
    }
  });
});
