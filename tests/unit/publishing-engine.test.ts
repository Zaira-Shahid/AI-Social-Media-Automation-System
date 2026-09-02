import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEntry } from "@/lib/audit";
import type { StoredPlatformPost } from "@/lib/content/store";
import type { PublishCredentials, PublishRequest, PublishResult } from "@/lib/publishing/adapter";
import type { SlackMessage, SlackNotifier } from "@/lib/slack/notifier";

/**
 * The publishing engine (spec §49, §52, §53, §55, §67).
 *
 * Firestore, the adapters, the credential store and Slack are all replaced.
 * What is under test is the orchestration between them: whether publishing is
 * allowed to start, what the platform's answer means for the post, and that
 * nothing reaches PUBLISHED without an id from outside this system.
 */
const claimForPublish = vi.fn();
const recordPublishSuccess = vi.fn();
const recordPublishFailure = vi.fn();
const collectDuePosts = vi.fn();
const getUsableCredentials = vi.fn();
const publish = vi.fn<(r: PublishRequest, c: PublishCredentials) => Promise<PublishResult>>();
const recordAudit = vi.fn<(entry: AuditEntry) => Promise<void>>();
const slackPost = vi.fn<SlackNotifier["post"]>();

let adapterMode: "REAL" | "MOCK" = "REAL";

vi.mock("@/lib/content/store", () => ({
  claimForPublish: (id: string, now: Date, max: number) => claimForPublish(id, now, max),
  recordPublishSuccess: (id: string, result: unknown) => recordPublishSuccess(id, result),
  recordPublishFailure: (id: string, reason: string, terminal: boolean) =>
    recordPublishFailure(id, reason, terminal),
}));

vi.mock("@/lib/content/schedule", () => ({
  collectDuePosts: (now: Date) => collectDuePosts(now),
}));

vi.mock("@/lib/social/store", () => ({
  getUsableCredentials: (platform: string, now: Date) => getUsableCredentials(platform, now),
}));

vi.mock("@/lib/publishing", () => ({
  getAdapter: (platform: string) => ({
    platform,
    get mode() {
      return adapterMode;
    },
    describe: () => ({ platform, mode: adapterMode, detail: "test", limitation: null }),
    publish: (request: PublishRequest, credentials: PublishCredentials) =>
      publish(request, credentials),
  }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: (entry: AuditEntry) => recordAudit(entry),
}));

vi.mock("@/lib/slack", () => ({
  getSlackTarget: () => ({
    channel: "C0123456789",
    notifier: {
      name: "test",
      mode: "MOCK" as const,
      post: (channel: string, message: SlackMessage) => slackPost(channel, message),
    },
  }),
}));

const { MAX_PUBLISH_ATTEMPTS, composeMessage, publishOne, runDuePublishing } =
  await import("@/lib/publishing/publish");

const NOW = new Date("2026-09-02T09:00:00.000Z");

const TOKEN = "super-secret-token-value";

function post(overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id: "post-1",
    contentItemId: "content-1",
    platform: "LINKEDIN",
    status: "SCHEDULED",
    caption: "A caption.",
    hashtags: ["automation"],
    cta: "Read more.",
    visual: {
      template: "HEADLINE_CARD",
      headline: "Headline",
      supportingText: "Support",
      emphasis: "PRIMARY",
    },
    mediaUrl: "https://cdn.example.com/card.png",
    mediaPublicId: "cards/post-1",
    lastError: null,
    version: 1,
    approvedBy: "uid-1",
    approvedAt: "2026-09-01T10:00:00.000Z",
    rejectionNote: null,
    scheduledAt: "2026-09-02T09:00:00.000Z",
    providerPostId: null,
    permalink: null,
    publishedAt: null,
    publishMode: null,
    publishAttempts: 0,
    publishStartedAt: null,
    ...overrides,
  };
}

/** The common happy path: the claim succeeds and credentials are available. */
function allowClaim(overrides: Partial<StoredPlatformPost> = {}) {
  claimForPublish.mockResolvedValue({
    ok: true,
    post: post({ publishAttempts: 1, publishStartedAt: NOW.toISOString(), ...overrides }),
  });

  getUsableCredentials.mockResolvedValue({
    ok: true,
    credentials: { accountId: "urn:li:person:abc", accessToken: TOKEN },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adapterMode = "REAL";
  recordAudit.mockResolvedValue();
  recordPublishSuccess.mockResolvedValue(undefined);
  recordPublishFailure.mockResolvedValue(undefined);
  slackPost.mockResolvedValue({ mode: "MOCK", channel: "C0123456789", ts: "1.2" });
});

describe("composeMessage", () => {
  it("puts the caption, then the CTA, then the hashtags", () => {
    expect(composeMessage({ caption: "Body.", cta: "Read more.", hashtags: ["ai"] })).toBe(
      "Body.\n\nRead more.\n\n#ai",
    );
  });

  it("adds the # a stored hashtag does not carry", () => {
    expect(composeMessage({ caption: "Body.", cta: "", hashtags: ["ai", "#ml"] })).toBe(
      "Body.\n\n#ai #ml",
    );
  });

  it("leaves out an empty CTA and an empty hashtag list rather than trailing blank lines", () => {
    expect(composeMessage({ caption: "Body.", cta: "", hashtags: [] })).toBe("Body.");
  });
});

describe("publishOne", () => {
  it("publishes and records the platform's own id", async () => {
    allowClaim();
    publish.mockResolvedValue({
      ok: true,
      mode: "REAL",
      providerPostId: "urn:li:share:999",
      permalink: "https://example.com/p/999",
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome).toMatchObject({
      status: "PUBLISHED",
      providerPostId: "urn:li:share:999",
      mode: "REAL",
    });

    expect(recordPublishSuccess).toHaveBeenCalledWith("post-1", {
      providerPostId: "urn:li:share:999",
      permalink: "https://example.com/p/999",
      publishedAt: NOW.toISOString(),
      publishMode: "REAL",
    });
  });

  it("records a mock publish as MOCK, so flipping the provider later cannot retitle it", async () => {
    allowClaim();
    adapterMode = "MOCK";
    publish.mockResolvedValue({
      ok: true,
      mode: "MOCK",
      providerPostId: "mock-1",
      permalink: null,
    });

    await publishOne(post(), NOW);

    expect(recordPublishSuccess).toHaveBeenCalledWith(
      "post-1",
      expect.objectContaining({ publishMode: "MOCK" }),
    );
  });

  it("audits a publish with the provider id and never the token", async () => {
    allowClaim();
    publish.mockResolvedValue({
      ok: true,
      mode: "REAL",
      providerPostId: "urn:li:share:999",
      permalink: null,
    });

    await publishOne(post(), NOW);

    const entry = recordAudit.mock.calls[0][0];

    expect(entry).toMatchObject({
      action: "POST_PUBLISHED",
      resource: "platformPosts/post-1",
      status: "SUCCESS",
    });

    expect(JSON.stringify(entry)).not.toContain(TOKEN);
  });

  it("skips a post the platform has already confirmed, without calling the adapter", async () => {
    claimForPublish.mockResolvedValue({
      ok: false,
      reason: "Already published as urn:li:share:999.",
      alreadyPublished: true,
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("SKIPPED");
    expect(publish).not.toHaveBeenCalled();
    expect(recordPublishFailure).not.toHaveBeenCalled();
  });

  it("skips — and does not record an error — when another attempt holds the claim", async () => {
    claimForPublish.mockResolvedValue({
      ok: false,
      reason: "Another publishing attempt is already in progress.",
      alreadyPublished: false,
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("SKIPPED");
    expect(publish).not.toHaveBeenCalled();
    expect(recordPublishFailure).not.toHaveBeenCalled();
  });

  it("fails terminally when there are no usable credentials, without calling the adapter", async () => {
    claimForPublish.mockResolvedValue({ ok: true, post: post({ publishAttempts: 1 }) });
    getUsableCredentials.mockResolvedValue({
      ok: false,
      reason: "The LINKEDIN credential expired on 2026-08-01. Reconnect the account.",
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("FAILED");
    expect(publish).not.toHaveBeenCalled();
    expect(recordPublishFailure).toHaveBeenCalledWith(
      "post-1",
      "The LINKEDIN credential expired on 2026-08-01. Reconnect the account.",
      true,
    );
  });

  it("leaves a retryable failure scheduled for the next tick", async () => {
    allowClaim();
    publish.mockResolvedValue({
      ok: false,
      mode: "REAL",
      reason: "Rate limited.",
      retryable: true,
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("RETRYING");
    expect(recordPublishFailure).toHaveBeenCalledWith("post-1", "Rate limited.", false);
  });

  it("fails a refusal that will not change on its own", async () => {
    allowClaim();
    publish.mockResolvedValue({
      ok: false,
      mode: "REAL",
      reason: "The token was rejected.",
      retryable: false,
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("FAILED");
    expect(recordPublishFailure).toHaveBeenCalledWith("post-1", "The token was rejected.", true);
  });

  it("stops retrying a retryable failure once the attempts are spent", async () => {
    allowClaim({ publishAttempts: MAX_PUBLISH_ATTEMPTS });
    publish.mockResolvedValue({
      ok: false,
      mode: "REAL",
      reason: "Rate limited.",
      retryable: true,
    });

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("FAILED");
    expect(recordPublishFailure).toHaveBeenCalledWith(
      "post-1",
      `Rate limited. (gave up after ${MAX_PUBLISH_ATTEMPTS} attempts)`,
      true,
    );
  });

  it("treats an adapter that throws as retryable, because the post's real state is unknown", async () => {
    allowClaim();
    publish.mockRejectedValue(new Error("socket hang up"));

    const outcome = await publishOne(post(), NOW);

    expect(outcome.status).toBe("RETRYING");
    expect(recordPublishFailure).toHaveBeenCalledWith(
      "post-1",
      "Publishing threw before the platform answered: socket hang up",
      false,
    );
  });

  it("hands the adapter the assembled caption and the card URL", async () => {
    allowClaim();
    publish.mockResolvedValue({ ok: true, mode: "REAL", providerPostId: "x", permalink: null });

    await publishOne(post(), NOW);

    expect(publish).toHaveBeenCalledWith(
      {
        platformPostId: "post-1",
        platform: "LINKEDIN",
        message: "A caption.\n\nRead more.\n\n#automation",
        mediaUrl: "https://cdn.example.com/card.png",
      },
      { accountId: "urn:li:person:abc", accessToken: TOKEN },
    );
  });

  it("never puts the token in an audited failure", async () => {
    allowClaim();
    publish.mockResolvedValue({
      ok: false,
      mode: "REAL",
      reason: `Refused for ${TOKEN}`,
      retryable: false,
    });

    await publishOne(post(), NOW);

    const audited = recordAudit.mock.calls.map(([entry]) => entry.action);

    expect(audited).toContain("POST_FAILED");
    expect(recordAudit.mock.calls[0][0].status).toBe("FAILURE");
  });
});

describe("runDuePublishing", () => {
  it("counts each outcome and announces only the terminal failures", async () => {
    collectDuePosts.mockResolvedValue({
      due: 2,
      unapproved: [],
      posts: [post({ id: "post-1" }), post({ id: "post-2", platform: "FACEBOOK" })],
    });

    claimForPublish
      .mockResolvedValueOnce({ ok: true, post: post({ id: "post-1", publishAttempts: 1 }) })
      .mockResolvedValueOnce({
        ok: true,
        post: post({ id: "post-2", platform: "FACEBOOK", publishAttempts: 1 }),
      });

    getUsableCredentials.mockResolvedValue({
      ok: true,
      credentials: { accountId: "acc", accessToken: TOKEN },
    });

    publish
      .mockResolvedValueOnce({ ok: true, mode: "REAL", providerPostId: "a", permalink: null })
      .mockResolvedValueOnce({
        ok: false,
        mode: "REAL",
        reason: "The token was rejected.",
        retryable: false,
      });

    const outcome = await runDuePublishing(NOW);

    expect(outcome).toMatchObject({ due: 2, published: 1, failed: 1, retrying: 0, skipped: 0 });
    expect(outcome.notified).toBe(true);

    const [, message] = slackPost.mock.calls[0];

    expect(message.text).toContain("1 post(s) failed");
    expect(JSON.stringify(message)).not.toContain(TOKEN);
  });

  it("says nothing on Slack when nothing failed terminally", async () => {
    collectDuePosts.mockResolvedValue({ due: 1, unapproved: [], posts: [post()] });
    allowClaim();
    publish.mockResolvedValue({ ok: true, mode: "REAL", providerPostId: "a", permalink: null });

    const outcome = await runDuePublishing(NOW);

    expect(outcome.published).toBe(1);
    expect(outcome.notified).toBe(false);
    expect(slackPost).not.toHaveBeenCalled();
  });

  it("does not report an alert Slack refused, and still reports the posts", async () => {
    collectDuePosts.mockResolvedValue({ due: 1, unapproved: [], posts: [post()] });
    allowClaim();
    publish.mockResolvedValue({
      ok: false,
      mode: "REAL",
      reason: "The token was rejected.",
      retryable: false,
    });
    slackPost.mockRejectedValue(new Error("slack is down"));

    const outcome = await runDuePublishing(NOW);

    expect(outcome.failed).toBe(1);
    expect(outcome.notified).toBe(false);
  });

  it("publishes nothing when nothing is due", async () => {
    collectDuePosts.mockResolvedValue({ due: 0, unapproved: [], posts: [] });

    const outcome = await runDuePublishing(NOW);

    expect(outcome).toMatchObject({ due: 0, published: 0, failed: 0, skipped: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(slackPost).not.toHaveBeenCalled();
  });
});
