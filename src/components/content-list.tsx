"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  generateContent,
  regeneratePost,
  type GenerateFormState,
  type RegenerateFormState,
} from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/button";
import type { StoredContentItem, StoredPlatformPost } from "@/lib/content/store";
import { cn } from "@/lib/utils";

/**
 * Generated content, per story and per platform (spec §12, §13, §17).
 *
 * Read-only apart from regeneration. §16's full preview and §37's queue —
 * editing, per-platform approval and rejection — are Module 09. What this has
 * to show is that generation produced something a person can judge, and
 * whether the copy is real or simulated.
 */
const INITIAL_GENERATE: GenerateFormState = { status: "idle" };
const INITIAL_REGENERATE: RegenerateFormState = { status: "idle" };

const PLATFORM_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
};

function GenerateButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Generating…" : "Generate today's content"}
    </Button>
  );
}

function RegenerateButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Rewriting…" : "Regenerate"}
    </Button>
  );
}

/** §21: simulated copy is labelled wherever it appears, never presented as real. */
function SimulatedBadge() {
  return (
    <span
      className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      data-testid="mock-badge"
    >
      Simulated
    </span>
  );
}

function PlatformCard({
  post,
  canRegenerate,
  simulated,
}: {
  post: StoredPlatformPost;
  canRegenerate: boolean;
  simulated: boolean;
}) {
  const [state, action] = useActionState(regeneratePost, INITIAL_REGENERATE);

  return (
    <div className="rounded-lg border border-border p-4" data-testid="platform-post">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          {PLATFORM_LABELS[post.platform] ?? post.platform}
        </span>

        <span
          className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          data-testid="post-status"
        >
          {post.status.replace("_", " ")}
        </span>

        <span className="text-xs text-muted-foreground">v{post.version}</span>

        {simulated ? <SimulatedBadge /> : null}
      </div>

      <p className="mt-2 text-sm whitespace-pre-line">{post.caption}</p>

      {post.cta ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">CTA: </span>
          <span className="text-muted-foreground">{post.cta}</span>
        </p>
      ) : null}

      {post.hashtags.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {post.hashtags.map((tag) => `#${tag}`).join(" ")}
        </p>
      ) : null}

      <div className="mt-3 rounded-md bg-muted/50 p-3">
        <p className="text-xs font-medium">Visual concept ({post.visual.template})</p>
        <p className="mt-1 text-sm">{post.visual.headline}</p>
        {post.visual.supportingText ? (
          <p className="text-xs text-muted-foreground">{post.visual.supportingText}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {/* §67: no image exists yet, and the screen does not imply one does. */}
          {post.mediaUrl
            ? "Image rendered."
            : "No image yet — the static post generator is Module 08."}
        </p>
      </div>

      {canRegenerate ? (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="platformPostId" value={post.id} />
          <RegenerateButton />

          {state.status !== "idle" && state.message ? (
            <span
              role="status"
              data-testid="regenerate-status"
              className={cn(
                "text-sm",
                state.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {state.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function ContentList({
  items,
  postsByItem,
  canGenerate,
  canRegenerate,
}: {
  items: StoredContentItem[];
  postsByItem: Record<string, StoredPlatformPost[]>;
  canGenerate: boolean;
  canRegenerate: boolean;
}) {
  const [state, action] = useActionState(generateContent, INITIAL_GENERATE);

  return (
    <div className="mt-6">
      {canGenerate ? (
        <div className="space-y-2">
          <form action={action}>
            <GenerateButton />
          </form>

          {state.status !== "idle" && state.message ? (
            <p
              role="status"
              data-testid="generate-status"
              className={cn(
                "text-sm",
                state.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {state.mode === "MOCK" ? "Simulated — " : ""}
              {state.message}
            </p>
          ) : null}

          {state.problems && state.problems.length > 0 ? (
            <ul
              className="list-disc space-y-1 pl-5 text-sm text-destructive"
              data-testid="generate-problems"
            >
              {state.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        /* Empty state (§59): nothing generated is not the same as nothing selected. */
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          No content has been generated yet. Three stories have to be selected on the news screen
          first, and then generation writes a version for each platform.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {items.map((item) => {
            const posts = postsByItem[item.id] ?? [];
            const simulated = item.generation.mode === "MOCK";

            return (
              <section key={item.id} data-testid="content-item">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">{item.coreMessage.headline}</h2>
                  {simulated ? <SimulatedBadge /> : null}
                </div>

                <p className="mt-1 text-sm text-muted-foreground">{item.coreMessage.keyTakeaway}</p>

                <p className="mt-1 text-xs text-muted-foreground">
                  From{" "}
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4"
                  >
                    {item.sourceTitle}
                  </a>{" "}
                  · {item.coreMessage.sourceReference}
                </p>

                {posts.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                    No platform version passed validation for this story.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-3">
                    {posts.map((post) => (
                      <PlatformCard
                        key={post.id}
                        post={post}
                        canRegenerate={canRegenerate}
                        simulated={simulated}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
