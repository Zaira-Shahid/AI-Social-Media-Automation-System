import { describe, expect, it } from "vitest";

import { buildAuditDocument } from "@/lib/audit";

/**
 * Audit entry shaping (spec §55).
 *
 * The fields are fixed by the spec, and metadata must never carry a secret
 * — an audit record is exactly where a caller is most likely to attach a
 * whole request object without thinking.
 */
describe("buildAuditDocument", () => {
  it("stores the fields §55 requires", () => {
    const document = buildAuditDocument({
      actor: "uid-1",
      action: "LOGIN",
      resource: "profiles/uid-1",
      status: "SUCCESS",
    });

    expect(document).toEqual({
      actor: "uid-1",
      action: "LOGIN",
      resource: "profiles/uid-1",
      status: "SUCCESS",
    });
  });

  it("redacts secrets in metadata", () => {
    const document = buildAuditDocument({
      actor: "uid-1",
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/fb-1",
      status: "SUCCESS",
      metadata: {
        accessToken: "ya29.super-secret",
        nested: { apiKey: "abc123", label: "Facebook page" },
        role: "ADMIN",
      },
    });

    expect(document.metadata).toEqual({
      accessToken: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", label: "Facebook page" },
      role: "ADMIN",
    });
  });

  it("omits metadata entirely when there is none", () => {
    const document = buildAuditDocument({
      actor: "system",
      action: "ANALYTICS_SYNCED",
      resource: "analytics",
      status: "FAILURE",
    });

    expect("metadata" in document).toBe(false);
  });
});
