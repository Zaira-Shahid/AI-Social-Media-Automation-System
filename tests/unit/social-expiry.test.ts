import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SlackMessage, SlackNotifier } from "@/lib/slack/notifier";
import type { SocialAccount } from "@/lib/social/schema";

/**
 * Token expiry warnings (spec §19, §21, §52, §67).
 *
 * Firestore and Slack are both replaced; what is under test is the decision
 * between them — which accounts count as running out, when a message is worth
 * sending at all, and that a Slack failure is never reported as an alert that
 * happened.
 */
const listSocialAccounts = vi.fn<() => Promise<SocialAccount[]>>();
const post = vi.fn<SlackNotifier["post"]>();

let notifierMode: "REAL" | "MOCK" = "MOCK";

vi.mock("@/lib/social/store", () => ({
  listSocialAccounts: () => listSocialAccounts(),
}));

vi.mock("@/lib/slack", () => ({
  getSlackTarget: () => ({
    channel: "C0123456789",
    notifier: {
      name: "test",
      get mode() {
        return notifierMode;
      },
      post: (channel: string, message: SlackMessage) => post(channel, message),
    },
  }),
}));

const { alertOnExpiringTokens, collectExpiringAccounts } = await import("@/lib/social/expiry");

const NOW = new Date("2026-09-02T12:00:00.000Z");

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    platform: "LINKEDIN",
    accountId: "urn:li:person:abc",
    accountName: "Jamie Doe",
    accessTokenEncrypted: "v1.x.y.z",
    refreshTokenEncrypted: null,
    expiresAt: null,
    lastRefreshedAt: null,
    status: "VALID",
    connectedAt: "2026-07-04T00:00:00.000Z",
    connectedBy: "uid-1",
    lastError: null,
    ...overrides,
  };
}

/** `days` from NOW, as an ISO string. */
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  listSocialAccounts.mockReset();
  post.mockReset();
  post.mockResolvedValue({ mode: "MOCK", channel: "C0123456789", ts: "1.0" });
  notifierMode = "MOCK";
});

describe("collectExpiringAccounts", () => {
  it("ignores a token that does not expire at all", async () => {
    // Facebook and Instagram store null deliberately; warning about them would
    // train people to ignore this alert.
    listSocialAccounts.mockResolvedValue([
      account({ platform: "FACEBOOK", expiresAt: null }),
      account({ platform: "INSTAGRAM", expiresAt: null }),
    ]);

    await expect(collectExpiringAccounts(NOW)).resolves.toEqual([]);
  });

  it("ignores a token with plenty of life left", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(45) })]);

    await expect(collectExpiringAccounts(NOW)).resolves.toEqual([]);
  });

  it("reports one inside §19's warning window", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(6) })]);

    const expiring = await collectExpiringAccounts(NOW);

    expect(expiring).toHaveLength(1);
    expect(expiring[0]).toMatchObject({
      platform: "LINKEDIN",
      status: "EXPIRING",
      daysRemaining: 6,
    });
  });

  it("reports one that has already lapsed", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(-2) })]);

    const expiring = await collectExpiringAccounts(NOW);

    expect(expiring[0]).toMatchObject({ status: "EXPIRED" });
    expect(expiring[0].daysRemaining).toBeLessThan(0);
  });

  it("puts the most urgent first", async () => {
    listSocialAccounts.mockResolvedValue([
      account({ platform: "LINKEDIN", expiresAt: inDays(5) }),
      account({ platform: "FACEBOOK", expiresAt: inDays(-1) }),
    ]);

    const expiring = await collectExpiringAccounts(NOW);

    expect(expiring.map((entry) => entry.platform)).toEqual(["FACEBOOK", "LINKEDIN"]);
  });
});

describe("alertOnExpiringTokens", () => {
  it("says nothing when nothing is expiring", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(45) })]);

    const outcome = await alertOnExpiringTokens(NOW);

    expect(outcome).toMatchObject({ checked: 1, alerted: false, mode: null });
    // An alert channel that posts "all fine" daily is one nobody reads.
    expect(post).not.toHaveBeenCalled();
  });

  it("posts one message naming the platform and the date", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(3) })]);

    const outcome = await alertOnExpiringTokens(NOW);

    expect(outcome).toMatchObject({ alerted: true, mode: "MOCK" });
    expect(post).toHaveBeenCalledTimes(1);

    const [channel, message] = post.mock.calls[0];
    expect(channel).toBe("C0123456789");
    expect(JSON.stringify(message)).toContain("LINKEDIN");
    expect(JSON.stringify(message)).toContain("Jamie Doe");
  });

  it("carries the delivery mode, so a simulated warning is never read as a real one (§21)", async () => {
    notifierMode = "REAL";
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(1) })]);

    await expect(alertOnExpiringTokens(NOW)).resolves.toMatchObject({ mode: "REAL" });
  });

  it("does not report an alert that Slack refused (§67)", async () => {
    listSocialAccounts.mockResolvedValue([account({ expiresAt: inDays(2) })]);
    post.mockRejectedValue(new Error("channel_not_found"));

    await expect(alertOnExpiringTokens(NOW)).rejects.toThrow(/channel_not_found/);
  });

  it("never puts a token, encrypted or not, in the message", async () => {
    listSocialAccounts.mockResolvedValue([
      account({ expiresAt: inDays(2), accessTokenEncrypted: "v1.secret.cipher.tag" }),
    ]);

    await alertOnExpiringTokens(NOW);

    expect(JSON.stringify(post.mock.calls[0])).not.toContain("v1.secret.cipher.tag");
  });
});
