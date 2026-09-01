import { describe, expect, it, vi } from "vitest";

import {
  decryptToken,
  encryptToken,
  TokenDecryptionError,
  tokenFingerprint,
} from "@/lib/social/crypto";
import { statusForExpiry } from "@/lib/social/schema";

/**
 * Token encryption and expiry state (spec §19, §42).
 *
 * §19 requires an authenticated mode so tampering is detectable. That is the
 * property worth testing: not merely that a token survives a round trip, but
 * that an altered record refuses to decrypt instead of returning something
 * plausible.
 */
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  }),
}));

const TOKEN = "EAABsomethingthatlookslikeametatoken1234567890";

describe("encryptToken", () => {
  it("round-trips a token", () => {
    expect(decryptToken(encryptToken(TOKEN))).toBe(TOKEN);
  });

  it("never stores the token in readable form", () => {
    expect(encryptToken(TOKEN)).not.toContain(TOKEN);
  });

  it("produces different ciphertext each time, because the IV is fresh", () => {
    expect(encryptToken(TOKEN)).not.toBe(encryptToken(TOKEN));
  });

  it("carries a version tag, so the format can change later", () => {
    expect(encryptToken(TOKEN).startsWith("v1.")).toBe(true);
  });
});

describe("decryptToken", () => {
  it("refuses a record whose ciphertext was altered (§19)", () => {
    const stored = encryptToken(TOKEN);
    const parts = stored.split(".");
    // Flip a character in the ciphertext, leaving the shape intact.
    parts[2] = parts[2].startsWith("A") ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;

    expect(() => decryptToken(parts.join("."))).toThrow(TokenDecryptionError);
  });

  it("refuses a record whose authentication tag was altered", () => {
    const parts = encryptToken(TOKEN).split(".");
    parts[3] = parts[3].startsWith("A") ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;

    expect(() => decryptToken(parts.join("."))).toThrow(TokenDecryptionError);
  });

  it("refuses anything that is not in the stored format", () => {
    expect(() => decryptToken("plain-token")).toThrow(TokenDecryptionError);
    expect(() => decryptToken("v2.a.b.c")).toThrow(TokenDecryptionError);
  });

  it("says the key may have changed rather than leaking the value", () => {
    try {
      decryptToken("v1.aaaa.bbbb.cccc");
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN);
      expect(String(error)).toContain("could not be decrypted");
    }
  });
});

describe("tokenFingerprint", () => {
  it("identifies a credential without revealing it (§19, §42)", () => {
    const fingerprint = tokenFingerprint(TOKEN);

    expect(fingerprint).not.toContain(TOKEN);
    expect(fingerprint).toContain(TOKEN.slice(-4));
  });
});

describe("statusForExpiry", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("treats a token with no expiry as valid, which is a real answer", () => {
    // Meta's long-lived Page tokens have no expiration date.
    expect(statusForExpiry(null, now)).toBe("VALID");
  });

  it("warns before a token lapses, not on the day (§19)", () => {
    expect(statusForExpiry("2026-09-05T00:00:00Z", now)).toBe("EXPIRING");
  });

  it("calls a lapsed token expired", () => {
    expect(statusForExpiry("2026-08-31T23:00:00Z", now)).toBe("EXPIRED");
  });

  it("leaves a distant expiry alone", () => {
    expect(statusForExpiry("2026-10-31T00:00:00Z", now)).toBe("VALID");
  });
});
