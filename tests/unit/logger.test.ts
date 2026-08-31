import { describe, expect, it } from "vitest";

import { redact } from "@/lib/logger";

/**
 * Spec §55/§56: secrets must never reach logs. These assert the redactor
 * actually strips them, including the awkward cases — nesting, arrays, and
 * circular references that would otherwise crash the logger itself.
 */
describe("log redaction", () => {
  it("redacts obviously sensitive keys", () => {
    const output = redact({ username: "zaira", password: "hunter2" }) as Record<string, unknown>;

    expect(output.username).toBe("zaira");
    expect(output.password).toBe("[REDACTED]");
  });

  it("redacts regardless of casing or separators", () => {
    const output = redact({
      API_KEY: "secret-1",
      "private-key": "secret-2",
      accessToken: "secret-3",
      platform: "not-a-secret",
    }) as Record<string, unknown>;

    expect(output.API_KEY).toBe("[REDACTED]");
    expect(output["private-key"]).toBe("[REDACTED]");
    expect(output.accessToken).toBe("[REDACTED]");
    expect(output.platform).toBe("not-a-secret");
  });

  it("redacts nested values", () => {
    const output = redact({
      account: { platform: "LINKEDIN", refreshToken: "should-not-appear" },
    }) as { account: Record<string, unknown> };

    expect(output.account.platform).toBe("LINKEDIN");
    expect(output.account.refreshToken).toBe("[REDACTED]");
  });

  it("redacts inside arrays", () => {
    const output = redact([{ apiKey: "leak" }]) as Array<Record<string, unknown>>;
    expect(output[0].apiKey).toBe("[REDACTED]");
  });

  it("survives circular references instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => redact(circular)).not.toThrow();
  });

  it("passes primitives through untouched", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
