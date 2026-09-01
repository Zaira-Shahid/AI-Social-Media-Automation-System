import { describe, expect, it } from "vitest";

import {
  canEditCopy,
  canTransition,
  deriveStoryStatus,
  eligibleForApproval,
  statusLabel,
  transitionRefusal,
} from "@/lib/content/status";
import type { PostStatus } from "@/lib/content/schema";

/**
 * Status transitions (spec §17, §48).
 *
 * §17 requires that transitions be enforced and that "frontend-only status
 * protection" is not acceptable. These are the rules the server enforces, so
 * they are tested as rules — including the ones that must be refused.
 */
const ALL: PostStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
];

describe("canTransition", () => {
  it("allows exactly the transitions §17 lists", () => {
    expect(canTransition("DRAFT", "IN_REVIEW")).toBe(true);
    expect(canTransition("IN_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("IN_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "PUBLISHED")).toBe(true);
    expect(canTransition("SCHEDULED", "FAILED")).toBe(true);
  });

  it("refuses approving something that was never in review", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
  });

  it("refuses un-approving, which §17 does not list", () => {
    // Approval is recorded with an actor and a timestamp (§55). Reversing it
    // silently would make that record describe a state the post is not in.
    expect(canTransition("APPROVED", "IN_REVIEW")).toBe(false);
    expect(canTransition("APPROVED", "REJECTED")).toBe(false);
  });

  it("treats published, failed and rejected as terminal", () => {
    for (const to of ALL) {
      expect(canTransition("PUBLISHED", to)).toBe(false);
      expect(canTransition("FAILED", to)).toBe(false);
      expect(canTransition("REJECTED", to)).toBe(false);
    }
  });

  it("never allows a status to transition to itself", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("refuses skipping review entirely", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("IN_REVIEW", "PUBLISHED")).toBe(false);
    expect(canTransition("IN_REVIEW", "SCHEDULED")).toBe(false);
  });
});

describe("transitionRefusal", () => {
  it("names both states, so a reviewer knows what happened", () => {
    const message = transitionRefusal("REJECTED", "APPROVED");

    expect(message).toContain("rejected");
    expect(message).toContain("approved");
  });
});

describe("canEditCopy", () => {
  it("allows editing before approval and not after", () => {
    expect(canEditCopy("DRAFT")).toBe(true);
    expect(canEditCopy("IN_REVIEW")).toBe(true);
    expect(canEditCopy("APPROVED")).toBe(false);
    expect(canEditCopy("SCHEDULED")).toBe(false);
    expect(canEditCopy("PUBLISHED")).toBe(false);
  });
});

describe("deriveStoryStatus", () => {
  it("uses the shared status when every platform agrees", () => {
    expect(deriveStoryStatus(["APPROVED", "APPROVED", "APPROVED"])).toBe("Approved");
  });

  it("reads as still waiting when anything is still in review", () => {
    // The thing a reviewer has to act on wins, not the majority.
    expect(deriveStoryStatus(["APPROVED", "IN_REVIEW", "REJECTED"])).toBe("Partly reviewed");
  });

  it("says mixed rather than picking a winner", () => {
    expect(deriveStoryStatus(["APPROVED", "REJECTED"])).toBe("Mixed");
  });

  it("handles a story with no platform versions", () => {
    expect(deriveStoryStatus([])).toBe("No platform versions");
  });
});

describe("eligibleForApproval", () => {
  it("returns only the posts an approval could actually move", () => {
    const posts = [
      { id: "a", status: "IN_REVIEW" as const },
      { id: "b", status: "APPROVED" as const },
      { id: "c", status: "REJECTED" as const },
      { id: "d", status: "IN_REVIEW" as const },
    ];

    expect(eligibleForApproval(posts).map((post) => post.id)).toEqual(["a", "d"]);
  });
});

describe("statusLabel", () => {
  it("reads as words rather than as a constant", () => {
    expect(statusLabel("IN_REVIEW")).toBe("In review");
    expect(statusLabel("APPROVED")).toBe("Approved");
  });
});
