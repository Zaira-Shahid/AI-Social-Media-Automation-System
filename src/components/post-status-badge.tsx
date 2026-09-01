import type { PostStatus } from "@/lib/content/schema";
import { statusLabel } from "@/lib/content/status";
import { cn } from "@/lib/utils";

/**
 * A version's status, in §17's vocabulary (§37, §38).
 *
 * Shared by the review queue and the calendar so one status never has two
 * appearances. Colour is a second channel, not the only one — the word is
 * always there, because a colour alone is unreadable to a reader who cannot
 * distinguish it.
 */
export function PostStatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        status === "APPROVED"
          ? "bg-primary/10 text-primary"
          : status === "REJECTED" || status === "FAILED"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
      data-testid="post-status"
    >
      {statusLabel(status).toUpperCase()}
    </span>
  );
}

/** Platform names as people write them, not as they are stored. */
export const PLATFORM_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
};
