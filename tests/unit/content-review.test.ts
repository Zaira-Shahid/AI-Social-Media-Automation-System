import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_BRAND_SETTINGS } from "@/lib/brand/schema";
import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * Review, approval and editing (spec §10, §16, §17, §48, §67).
 *
 * Firestore is replaced; the rules are not. What is under test is what a
 * reviewer's action is allowed to do — including the approval that must be
 * refused because the post could never be published.
 */
const getPlatformPost = vi.fn<(id: string) => Promise<StoredPlatformPost | null>>();
const listPlatformPostsFor = vi.fn<() => Promise<StoredPlatformPost[]>>();
const applyStatusTransition = vi.fn();
const updatePlatformPostCopy = vi.fn();
const recordContentVersion = vi.fn();
const getBrandProfile = vi.fn();

vi.mock("@/lib/content/store", () => ({
  getPlatformPost: (id: string) => getPlatformPost(id),
  listPlatformPostsFor: () => listPlatformPostsFor(),
  applyStatusTransition: (...args: unknown[]) => applyStatusTransition(...args),
  updatePlatformPostCopy: (...args: unknown[]) => updatePlatformPostCopy(...args),
  recordContentVersion: (version: unknown) => recordContentVersion(version),
}));

vi.mock("@/lib/brand/store", () => ({ getBrandProfile: () => getBrandProfile() }));

function post(overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id: "post-1",
    contentItemId: "content-1",
    platform: "LINKEDIN",
    status: "IN_REVIEW",
    caption: "A caption.",
    hashtags: ["ai"],
    cta: "Read more",
    visual: {
      template: "HEADLINE_CARD",
      headline: "A headline",
      supportingText: "",
      emphasis: "PRIMARY",
    },
    mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
    mediaPublicId: "posts/post-1",
    lastError: null,
    version: 1,
    approvedBy: null,
    approvedAt: null,
    rejectionNote: null,
    scheduledAt: null,
    ...overrides,
  };
}

async function load() {
  return import("@/lib/content/review");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getPlatformPost.mockResolvedValue(post());
  listPlatformPostsFor.mockResolvedValue([post()]);
  applyStatusTransition.mockResolvedValue({ ok: true, post: post({ status: "APPROVED" }) });
  updatePlatformPostCopy.mockResolvedValue({ ok: true, post: post({ version: 2 }) });
  recordContentVersion.mockResolvedValue(undefined);
  getBrandProfile.mockResolvedValue({
    company: { name: "Example Co" },
    brand: EMPTY_BRAND_SETTINGS,
  });
});

describe("approvePost", () => {
  it("records who approved it and when (§17)", async () => {
    const { approvePost } = await load();

    await approvePost("post-1", "user-1");

    const [id, to, extra] = applyStatusTransition.mock.calls[0];
    expect(id).toBe("post-1");
    expect(to).toBe("APPROVED");
    expect(extra).toMatchObject({ approvedBy: "user-1" });
    expect(typeof (extra as { approvedAt: string }).approvedAt).toBe("string");
  });

  it("refuses to approve a post with no image (§67)", async () => {
    getPlatformPost.mockResolvedValue(post({ mediaUrl: null, mediaPublicId: null }));

    const { approvePost, ReviewError } = await load();

    // An APPROVED record that publishing will have to fail on is a false
    // success waiting to happen.
    await expect(approvePost("post-1", "user-1")).rejects.toBeInstanceOf(ReviewError);
    expect(applyStatusTransition).not.toHaveBeenCalled();
  });

  it("explains a failed render rather than just refusing", async () => {
    getPlatformPost.mockResolvedValue(
      post({ mediaUrl: null, lastError: "Cloudinary rejected the upload" }),
    );

    const { approvePost } = await load();

    await expect(approvePost("post-1", "user-1")).rejects.toThrow(/Cloudinary rejected the upload/);
  });

  it("surfaces the transition's own refusal", async () => {
    applyStatusTransition.mockResolvedValue({
      ok: false,
      reason: "This post is rejected and cannot become approved.",
    });

    const { approvePost } = await load();

    await expect(approvePost("post-1", "user-1")).rejects.toThrow(/cannot become approved/);
  });
});

describe("rejectPost", () => {
  it("stores the reason and clears any approval", async () => {
    applyStatusTransition.mockResolvedValue({ ok: true, post: post({ status: "REJECTED" }) });

    const { rejectPost } = await load();

    await rejectPost("post-1", "user-1", "  Off brand  ");

    const [, to, extra] = applyStatusTransition.mock.calls[0];
    expect(to).toBe("REJECTED");
    expect(extra).toMatchObject({ rejectionNote: "Off brand", approvedBy: null, approvedAt: null });
  });

  it("does not require an image, since nothing is being published", async () => {
    getPlatformPost.mockResolvedValue(post({ mediaUrl: null }));
    applyStatusTransition.mockResolvedValue({ ok: true, post: post({ status: "REJECTED" }) });

    const { rejectPost } = await load();

    await expect(rejectPost("post-1", "user-1", "No")).resolves.toBeUndefined();
  });
});

describe("approveAllForStory", () => {
  it("approves each platform individually, not as a story-level state (§63)", async () => {
    listPlatformPostsFor.mockResolvedValue([
      post({ id: "a", platform: "FACEBOOK" }),
      post({ id: "b", platform: "INSTAGRAM" }),
      post({ id: "c", platform: "LINKEDIN" }),
    ]);

    const { approveAllForStory } = await load();
    const outcome = await approveAllForStory("content-1", "user-1");

    expect(outcome.approved).toBe(3);
    expect(applyStatusTransition).toHaveBeenCalledTimes(3);
  });

  it("reports the platforms it could not approve rather than skipping them", async () => {
    listPlatformPostsFor.mockResolvedValue([
      post({ id: "a", platform: "FACEBOOK" }),
      post({ id: "b", platform: "INSTAGRAM", status: "REJECTED" }),
    ]);

    const { approveAllForStory } = await load();
    const outcome = await approveAllForStory("content-1", "user-1");

    expect(outcome.approved).toBe(1);
    expect(outcome.problems.join(" ")).toMatch(/INSTAGRAM/);
  });

  it("reports a platform blocked by a missing image", async () => {
    listPlatformPostsFor.mockResolvedValue([
      post({ id: "a", platform: "FACEBOOK" }),
      post({ id: "b", platform: "INSTAGRAM" }),
    ]);
    getPlatformPost.mockImplementation(async (id) =>
      id === "b" ? post({ id, platform: "INSTAGRAM", mediaUrl: null }) : post({ id }),
    );

    const { approveAllForStory } = await load();
    const outcome = await approveAllForStory("content-1", "user-1");

    expect(outcome.approved).toBe(1);
    expect(outcome.problems.join(" ")).toMatch(/render the card/i);
  });
});

describe("editPost", () => {
  it("saves an edit and writes a version (§32)", async () => {
    const { editPost } = await load();

    const result = await editPost("post-1", "user-1", {
      caption: "A better caption.",
      hashtags: ["#AI", "automation"],
      cta: "Read it",
    });

    expect(result.version).toBe(2);
    expect(recordContentVersion.mock.calls[0][0]).toMatchObject({
      reason: "EDITED",
      version: 2,
      createdBy: "user-1",
    });
  });

  it("applies the brand's hashtag rules to a human's edit too (§11)", async () => {
    const { editPost } = await load();

    await editPost("post-1", "user-1", {
      caption: "A caption.",
      hashtags: ["#AI", "AI", "ai"],
      cta: "",
    });

    expect(updatePlatformPostCopy.mock.calls[0][1]).toMatchObject({ hashtags: ["ai"] });
  });

  it("refuses an edit that breaks a platform limit", async () => {
    const { editPost, ReviewError } = await load();

    await expect(
      editPost("post-1", "user-1", { caption: "x".repeat(4_000), hashtags: [], cta: "" }),
    ).rejects.toBeInstanceOf(ReviewError);

    expect(updatePlatformPostCopy).not.toHaveBeenCalled();
  });

  it("refuses to edit an approved post (§10, §55)", async () => {
    getPlatformPost.mockResolvedValue(post({ status: "APPROVED" }));

    const { editPost } = await load();

    await expect(
      editPost("post-1", "user-1", { caption: "Changed", hashtags: [], cta: "" }),
    ).rejects.toThrow(/approved/i);
  });

  it("records the edit as real, because a human wrote it", async () => {
    const { editPost } = await load();

    await editPost("post-1", "user-1", { caption: "Mine.", hashtags: [], cta: "" });

    expect(recordContentVersion.mock.calls[0][0]).toMatchObject({ mode: "REAL" });
  });
});
