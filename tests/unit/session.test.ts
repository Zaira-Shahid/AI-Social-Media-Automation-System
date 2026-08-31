import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session.shared";

/**
 * Session cookie attributes (spec §26, §56).
 *
 * These are the properties an attacker cares about, so they are asserted
 * rather than assumed.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session cookie", () => {
  it("uses the __session name that caching front-ends preserve", () => {
    expect(SESSION_COOKIE_NAME).toBe("__session");
    expect(sessionCookieOptions(1000).name).toBe("__session");
  });

  it("is httpOnly and sameSite=lax so script cannot read it and CSRF is limited", () => {
    const options = sessionCookieOptions(1000);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("is secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(1000).secure).toBe(true);
  });

  it("is not secure in development, where localhost is plain HTTP", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions(1000).secure).toBe(false);
  });

  it("converts the max age from milliseconds to whole seconds", () => {
    expect(sessionCookieOptions(5 * 24 * 60 * 60 * 1000).maxAge).toBe(432_000);
    expect(sessionCookieOptions(1500).maxAge).toBe(1);
    expect(sessionCookieOptions(0).maxAge).toBe(0);
  });
});
