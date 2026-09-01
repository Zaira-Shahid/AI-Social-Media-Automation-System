import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_BRAND_SETTINGS, EMPTY_COMPANY_SETTINGS } from "@/lib/brand/schema";
import type { StoredPlatformPost } from "@/lib/content/store";

/**
 * Rendering and storing card images (spec §15, §28, §52, §67).
 *
 * The renderer itself is tested for real in `render-card.test.ts`; what is
 * under test here is the order of operations. §63 requires that "a failed
 * upload must not leave a platform post in a state that claims a usable image
 * exists", which is a claim about sequencing, not about pixels.
 */
const getBrandProfile = vi.fn();
const listPostsWithoutMedia = vi.fn<() => Promise<StoredPlatformPost[]>>();
const getPlatformPost = vi.fn();
const setPlatformPostMedia = vi.fn();
const setPlatformPostRenderError = vi.fn();
const renderCard = vi.fn();
const uploadCard = vi.fn();
const deleteCard = vi.fn();
const loadLogoDataUri = vi.fn();

vi.mock("@/lib/brand/store", () => ({ getBrandProfile: () => getBrandProfile() }));

vi.mock("@/lib/content/store", () => ({
  listPostsWithoutMedia: () => listPostsWithoutMedia(),
  getPlatformPost: (id: string) => getPlatformPost(id),
  setPlatformPostMedia: (id: string, media: unknown) => setPlatformPostMedia(id, media),
  setPlatformPostRenderError: (id: string, message: string) =>
    setPlatformPostRenderError(id, message),
}));

vi.mock("@/lib/render/card", async () => {
  const actual = await vi.importActual<typeof import("@/lib/render/card")>("@/lib/render/card");

  return { ...actual, renderCard: (input: unknown) => renderCard(input) };
});

vi.mock("@/lib/render/assets", () => ({
  uploadCard: (png: Buffer, options: unknown) => uploadCard(png, options),
  deleteCard: (publicId: string) => deleteCard(publicId),
  loadLogoDataUri: (logo: unknown) => loadLogoDataUri(logo),
}));

function post(id: string, overrides: Partial<StoredPlatformPost> = {}): StoredPlatformPost {
  return {
    id,
    contentItemId: "content-1",
    platform: "LINKEDIN",
    status: "IN_REVIEW",
    caption: "A caption.",
    hashtags: [],
    cta: "",
    visual: {
      template: "HEADLINE_CARD",
      headline: "A headline",
      supportingText: "",
      emphasis: "PRIMARY",
    },
    mediaUrl: null,
    mediaPublicId: null,
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
  return import("@/lib/content/media");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getBrandProfile.mockResolvedValue({
    company: { ...EMPTY_COMPANY_SETTINGS, name: "Example Co" },
    brand: EMPTY_BRAND_SETTINGS,
  });
  listPostsWithoutMedia.mockResolvedValue([post("post-1")]);
  loadLogoDataUri.mockResolvedValue("data:image/png;base64,AAAA");
  renderCard.mockResolvedValue(Buffer.from("fake-png"));
  uploadCard.mockResolvedValue({
    url: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
    publicId: "posts/post-1",
    bytes: 1234,
  });
  setPlatformPostMedia.mockResolvedValue(undefined);
  setPlatformPostRenderError.mockResolvedValue(undefined);
});

describe("renderPendingCards", () => {
  it("renders, uploads, then records — in that order", async () => {
    const { renderPendingCards } = await load();

    const outcome = await renderPendingCards();

    expect(outcome.status).toBe("RENDERED");
    expect(outcome.rendered).toBe(1);

    expect(renderCard.mock.invocationCallOrder[0]).toBeLessThan(
      uploadCard.mock.invocationCallOrder[0],
    );
    expect(uploadCard.mock.invocationCallOrder[0]).toBeLessThan(
      setPlatformPostMedia.mock.invocationCallOrder[0],
    );
  });

  it("never records media when the upload fails (§63, §67)", async () => {
    uploadCard.mockRejectedValue(new Error("Cloudinary rejected the upload"));

    const { renderPendingCards } = await load();
    const outcome = await renderPendingCards();

    expect(setPlatformPostMedia).not.toHaveBeenCalled();
    expect(setPlatformPostRenderError).toHaveBeenCalledWith(
      "post-1",
      expect.stringContaining("Cloudinary"),
    );
    expect(outcome.status).toBe("FAILED");
  });

  it("records the reason when the render itself fails", async () => {
    renderCard.mockRejectedValue(new Error("Font file missing"));

    const { renderPendingCards } = await load();
    await renderPendingCards();

    expect(uploadCard).not.toHaveBeenCalled();
    expect(setPlatformPostRenderError).toHaveBeenCalledWith(
      "post-1",
      expect.stringContaining("Font file missing"),
    );
  });

  it("keeps going when one card fails (§17)", async () => {
    listPostsWithoutMedia.mockResolvedValue([post("post-1"), post("post-2"), post("post-3")]);
    renderCard
      .mockResolvedValueOnce(Buffer.from("a"))
      .mockRejectedValueOnce(new Error("broken"))
      .mockResolvedValueOnce(Buffer.from("c"));

    const { renderPendingCards } = await load();
    const outcome = await renderPendingCards();

    expect(outcome.status).toBe("PARTIAL");
    expect(outcome.rendered).toBe(2);
    expect(outcome.problems).toHaveLength(1);
  });

  it("stores Instagram as JPEG and the others as PNG", async () => {
    listPostsWithoutMedia.mockResolvedValue([
      post("ig", { platform: "INSTAGRAM" }),
      post("li", { platform: "LINKEDIN" }),
    ]);

    const { renderPendingCards } = await load();
    await renderPendingCards();

    expect(uploadCard.mock.calls[0][1]).toMatchObject({ format: "jpg", publicId: "ig" });
    expect(uploadCard.mock.calls[1][1]).toMatchObject({ format: "png", publicId: "li" });
  });

  it("fetches the logo once for the whole run, not once per card (§28)", async () => {
    listPostsWithoutMedia.mockResolvedValue([post("a"), post("b"), post("c")]);

    const { renderPendingCards } = await load();
    await renderPendingCards();

    expect(loadLogoDataUri).toHaveBeenCalledTimes(1);
    expect(renderCard).toHaveBeenCalledTimes(3);
  });

  it("still renders without a logo, and says so", async () => {
    loadLogoDataUri.mockResolvedValue(null);

    const { renderPendingCards } = await load();
    const outcome = await renderPendingCards();

    // A card without a logo is still a brand-coloured, correctly typeset card.
    expect(outcome.status).toBe("RENDERED");
    expect(outcome.missingLogo).toBe(true);
  });

  it("skips when every post already has an image", async () => {
    listPostsWithoutMedia.mockResolvedValue([]);

    const { renderPendingCards } = await load();
    const outcome = await renderPendingCards();

    expect(outcome.status).toBe("SKIPPED");
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("refuses to render without a company name, which every card carries", async () => {
    getBrandProfile.mockResolvedValue({
      company: EMPTY_COMPANY_SETTINGS,
      brand: EMPTY_BRAND_SETTINGS,
    });

    const { renderPendingCards } = await load();

    await expect(renderPendingCards()).rejects.toThrow(/company name/i);
    expect(renderCard).not.toHaveBeenCalled();
  });
});

describe("renderCardForPost", () => {
  beforeEach(() => {
    getPlatformPost.mockResolvedValueOnce(post("post-1")).mockResolvedValueOnce(
      post("post-1", {
        mediaUrl: "https://res.cloudinary.com/our-cloud/image/upload/posts/post-1.png",
        mediaPublicId: "posts/post-1",
      }),
    );
  });

  it("returns the stored URL after a successful re-render", async () => {
    const { renderCardForPost } = await load();

    const result = await renderCardForPost("post-1");

    expect(result.url).toContain("posts/post-1");
  });

  it("does not delete an asset it is about to overwrite in place", async () => {
    const { renderCardForPost } = await load();

    await renderCardForPost("post-1");

    // The public id is deterministic, so a re-render replaces the asset;
    // deleting first would risk losing the image if the new render failed.
    expect(deleteCard).not.toHaveBeenCalled();
  });
});
