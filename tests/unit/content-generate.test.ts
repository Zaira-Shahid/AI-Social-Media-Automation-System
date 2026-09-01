import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_BRAND_SETTINGS, EMPTY_COMPANY_SETTINGS } from "@/lib/brand/schema";
import type { ContentItem, ContentVersion, PlatformPost } from "@/lib/content/schema";
import type { StoredNewsItem } from "@/lib/news/store";

/**
 * The content generation pipeline (spec §11, §13, §17, §47, §52, §67).
 *
 * The provider and Firestore are both replaced; what is under test is the
 * orchestration between them — when it refuses to start, what it does when one
 * platform fails, and what it records about which of those happened.
 */
const complete = vi.fn();
const getBrandProfile = vi.fn();
const getSelectionForDate = vi.fn();
const getNewsItem = vi.fn<(id: string) => Promise<StoredNewsItem | null>>();
const markSelectionGenerated = vi.fn();
const createContentItem = vi.fn<(item: ContentItem) => Promise<string>>();
const createPlatformPost = vi.fn<(post: PlatformPost) => Promise<string>>();
const recordContentVersion = vi.fn<(version: ContentVersion) => Promise<void>>();
const listContentForSelection = vi.fn();
const getPlatformPost = vi.fn();
const getContentItem = vi.fn();
const replacePlatformPostContent = vi.fn();

let providerMode: "REAL" | "MOCK" = "MOCK";

vi.mock("@/lib/ai", () => ({
  getAIProvider: () => ({
    name: "test",
    model: "test-model",
    get mode() {
      return providerMode;
    },
    complete,
  }),
}));

// Pacing is derived from the published rate limit; a high one keeps the suite
// fast without changing the code under test.
vi.mock("@/lib/ai/groq", () => ({ GROQ_FREE_TIER: { requestsPerMinute: 60_000 } }));

vi.mock("@/lib/brand/store", () => ({ getBrandProfile: () => getBrandProfile() }));

vi.mock("@/lib/news/selection", () => ({ currentSelectionDate: () => "2026-09-01" }));

vi.mock("@/lib/news/store", () => ({
  getNewsItem: (id: string) => getNewsItem(id),
  getSelectionForDate: () => getSelectionForDate(),
  markSelectionGenerated: (id: string) => markSelectionGenerated(id),
}));

vi.mock("@/lib/content/store", () => ({
  createContentItem: (item: ContentItem) => createContentItem(item),
  createPlatformPost: (post: PlatformPost) => createPlatformPost(post),
  recordContentVersion: (version: ContentVersion) => recordContentVersion(version),
  listContentForSelection: () => listContentForSelection(),
  getPlatformPost: (id: string) => getPlatformPost(id),
  getContentItem: (id: string) => getContentItem(id),
  replacePlatformPostContent: (id: string, content: unknown) =>
    replacePlatformPostContent(id, content),
}));

const CONFIGURED_BRAND = {
  ...EMPTY_BRAND_SETTINGS,
  toneOfVoice: "Direct and practical",
  targetAudience: "Operations leads",
  logo: { url: "https://example.com/logo.png", publicId: "logo", width: 100, height: 100 },
};

const CONFIGURED_COMPANY = { ...EMPTY_COMPANY_SETTINGS, name: "Example Co" };

function story(id: string): StoredNewsItem {
  return {
    id,
    title: `Story ${id}`,
    summary: "A summary.",
    sourceName: "TechCrunch",
    sourceId: "src-1",
    sourceUrl: "https://example.com/story",
    publishedAt: "2026-08-30T09:00:00.000Z",
    category: "AI",
    duplicateGroup: `group-${id}`,
    status: "SELECTED",
    imageUrl: "https://publisher.example.com/hero.jpg",
    compositeScore: 80,
    relevanceScore: 90,
  };
}

function coreResponse() {
  return {
    headline: "A headline",
    keyTakeaway: "A takeaway.",
    body: "Body copy.",
    sourceReference: "via TechCrunch",
    angle: "Why us.",
  };
}

function version(platform: string, overrides: Record<string, unknown> = {}) {
  return {
    platform,
    caption: `A ${platform} caption.`,
    hashtags: ["ai"],
    cta: "Read more",
    visual: {
      template: "HEADLINE_CARD",
      headline: "A card headline",
      supportingText: "Support.",
      emphasis: "PRIMARY",
    },
    ...overrides,
  };
}

/** Answers the two calls the pipeline makes per story, in order. */
function respondNormally(versions = ["FACEBOOK", "INSTAGRAM", "LINKEDIN"]) {
  complete.mockImplementation(async (request: { schemaName: string }) => ({
    data:
      request.schemaName === "content_core_message"
        ? coreResponse()
        : { versions: versions.map((platform) => version(platform)) },
    mode: providerMode,
    provider: "test",
    model: "test-model",
    inputTokens: null,
    outputTokens: null,
  }));
}

async function load() {
  return import("@/lib/content/generate");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  providerMode = "MOCK";
  getBrandProfile.mockResolvedValue({ company: CONFIGURED_COMPANY, brand: CONFIGURED_BRAND });
  getSelectionForDate.mockResolvedValue({
    id: "sel-1",
    selectionDate: "2026-09-01",
    storyIds: ["a"],
    selectedBy: "user-1",
    selectedAt: "2026-09-01T05:00:00.000Z",
    status: "PENDING_GENERATION",
    supersededBy: null,
  });
  getNewsItem.mockImplementation(async (id) => story(id));
  listContentForSelection.mockResolvedValue([]);
  createContentItem.mockResolvedValue("content-1");
  createPlatformPost.mockResolvedValue("post-1");
  recordContentVersion.mockResolvedValue(undefined);
  markSelectionGenerated.mockResolvedValue(undefined);
  respondNormally();
});

describe("runContentGeneration", () => {
  it("generates one post per platform and leaves them in review (§47)", async () => {
    const { runContentGeneration } = await load();

    const outcome = await runContentGeneration("user-1");

    expect(outcome.status).toBe("GENERATED");
    expect(outcome.posts).toBe(3);
    expect(createPlatformPost).toHaveBeenCalledTimes(3);

    for (const [post] of createPlatformPost.mock.calls) {
      // §10: nothing here approves, schedules or publishes anything.
      expect(post.status).toBe("IN_REVIEW");
      // §67: no image exists until Module 08 renders one.
      expect(post.mediaUrl).toBeNull();
    }
  });

  it("generates without a logo, which only the card renderer needs (§11, Module 08)", async () => {
    getBrandProfile.mockResolvedValue({
      company: CONFIGURED_COMPANY,
      brand: { ...CONFIGURED_BRAND, logo: null },
    });

    const { runContentGeneration } = await load();

    await expect(runContentGeneration("user-1")).resolves.toMatchObject({ status: "GENERATED" });
  });

  it("refuses to start when the brand profile is incomplete, and names what is missing (§11)", async () => {
    getBrandProfile.mockResolvedValue({
      company: EMPTY_COMPANY_SETTINGS,
      brand: EMPTY_BRAND_SETTINGS,
    });

    const { runContentGeneration, GenerationError } = await load();

    await expect(runContentGeneration("user-1")).rejects.toBeInstanceOf(GenerationError);
    await expect(runContentGeneration("user-1")).rejects.toThrow(/Tone of voice/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("never puts the article's own image URL into the prompt (§14)", async () => {
    const { runContentGeneration } = await load();

    await runContentGeneration("user-1");

    for (const [request] of complete.mock.calls) {
      expect(request.prompt).not.toContain("publisher.example.com");
    }
  });

  it("records the mode on the stored item, not just in the return value (§21)", async () => {
    const { runContentGeneration } = await load();

    await runContentGeneration("user-1");

    expect(createContentItem.mock.calls[0][0].generation.mode).toBe("MOCK");
  });

  it("skips when nothing has been selected", async () => {
    getSelectionForDate.mockResolvedValue(null);

    const { runContentGeneration } = await load();
    const outcome = await runContentGeneration("user-1");

    expect(outcome.status).toBe("SKIPPED");
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not generate twice for the same story when a retry arrives", async () => {
    listContentForSelection.mockResolvedValue([{ id: "content-1", sourceNewsItemId: "a" }]);

    const { runContentGeneration } = await load();
    const outcome = await runContentGeneration("user-1");

    expect(outcome.status).toBe("SKIPPED");
    expect(createContentItem).not.toHaveBeenCalled();
  });

  it("keeps the platforms that passed when one fails validation (§17)", async () => {
    complete.mockImplementation(async (request: { schemaName: string }) => ({
      data:
        request.schemaName === "content_core_message"
          ? coreResponse()
          : {
              versions: [
                version("FACEBOOK"),
                // Over Instagram's limit; LinkedIn's would allow it.
                version("INSTAGRAM", { caption: "x".repeat(2_500) }),
                version("LINKEDIN"),
              ],
            },
      mode: providerMode,
      provider: "test",
      model: "test-model",
      inputTokens: null,
      outputTokens: null,
    }));

    const { runContentGeneration } = await load();
    const outcome = await runContentGeneration("user-1");

    expect(outcome.status).toBe("PARTIAL");
    expect(outcome.posts).toBe(2);
    expect(outcome.problems.join(" ")).toMatch(/INSTAGRAM/);
  });

  it("reports a platform the model simply did not return", async () => {
    respondNormally(["FACEBOOK", "LINKEDIN"]);

    const { runContentGeneration } = await load();
    const outcome = await runContentGeneration("user-1");

    expect(outcome.posts).toBe(2);
    expect(outcome.problems.join(" ")).toMatch(/INSTAGRAM/);
  });

  it("discards a version for a platform nobody asked about (§65)", async () => {
    respondNormally(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK"]);

    const { runContentGeneration } = await load();
    await runContentGeneration("user-1");

    expect(createPlatformPost).toHaveBeenCalledTimes(3);
  });

  it("does not lock the selection when nothing was generated (§46)", async () => {
    complete.mockRejectedValue(new Error("provider is down"));

    const { runContentGeneration } = await load();
    const outcome = await runContentGeneration("user-1");

    expect(outcome.status).toBe("FAILED");
    // Locking here would block the retry that would fix it.
    expect(markSelectionGenerated).not.toHaveBeenCalled();
  });

  it("locks the selection once content exists", async () => {
    const { runContentGeneration } = await load();

    await runContentGeneration("user-1");

    expect(markSelectionGenerated).toHaveBeenCalledWith("sel-1");
  });

  it("writes an initial version for every post it creates", async () => {
    const { runContentGeneration } = await load();

    await runContentGeneration("user-1");

    expect(recordContentVersion).toHaveBeenCalledTimes(3);
    expect(recordContentVersion.mock.calls[0][0].reason).toBe("INITIAL");
    expect(recordContentVersion.mock.calls[0][0].version).toBe(1);
  });
});

describe("regeneratePlatformPost", () => {
  beforeEach(() => {
    getPlatformPost.mockResolvedValue({
      id: "post-1",
      contentItemId: "content-1",
      platform: "LINKEDIN",
      status: "IN_REVIEW",
      caption: "Old caption",
      hashtags: [],
      cta: "",
      visual: {
        template: "HEADLINE_CARD",
        headline: "Old",
        supportingText: "",
        emphasis: "PRIMARY",
      },
      mediaUrl: null,
      mediaPublicId: null,
      version: 1,
    });
    getContentItem.mockResolvedValue({ id: "content-1", coreMessage: coreResponse() });
    respondNormally(["LINKEDIN"]);
  });

  it("writes the next version and records it", async () => {
    const { regeneratePlatformPost } = await load();

    const result = await regeneratePlatformPost("post-1", "user-1");

    expect(result.version).toBe(2);
    expect(replacePlatformPostContent).toHaveBeenCalledTimes(1);
    expect(recordContentVersion.mock.calls[0][0].reason).toBe("REGENERATED");
  });

  it("asks only for the platform being rewritten", async () => {
    const { regeneratePlatformPost } = await load();

    await regeneratePlatformPost("post-1", "user-1");

    // One call, and only the adaptation one: the story's core message is
    // reused so a rewrite cannot quietly change what the story is about.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].prompt).toContain("Platforms: LINKEDIN");
  });

  it("refuses to rewrite an approved post (§10, §55)", async () => {
    getPlatformPost.mockResolvedValue({
      id: "post-1",
      contentItemId: "content-1",
      platform: "LINKEDIN",
      status: "APPROVED",
      caption: "Approved caption",
      hashtags: [],
      cta: "",
      visual: {
        template: "HEADLINE_CARD",
        headline: "Old",
        supportingText: "",
        emphasis: "PRIMARY",
      },
      mediaUrl: null,
      mediaPublicId: null,
      version: 1,
    });

    const { regeneratePlatformPost } = await load();

    await expect(regeneratePlatformPost("post-1", "user-1")).rejects.toThrow(/approved/i);
    expect(replacePlatformPostContent).not.toHaveBeenCalled();
  });

  it("does not change the post's status", async () => {
    const { regeneratePlatformPost } = await load();

    await regeneratePlatformPost("post-1", "user-1");

    expect(Object.keys(replacePlatformPostContent.mock.calls[0][1] as object)).not.toContain(
      "status",
    );
  });
});
