"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  approvePlatformPost,
  approveStory,
  editPlatformPost,
  generateContent,
  regeneratePost,
  rejectPlatformPost,
  renderImages,
  schedulePlatformPost,
  type GenerateFormState,
  type RegenerateFormState,
  type RenderFormState,
  type ReviewFormState,
} from "@/app/(app)/content/actions";
import { PLATFORM_LABELS, PostStatusBadge } from "@/components/post-status-badge";
import { Button } from "@/components/ui/button";
import { canSchedule } from "@/lib/content/schedule-rules";
import { canEditCopy, deriveStoryStatus } from "@/lib/content/status";
import type { StoredContentItem, StoredPlatformPost } from "@/lib/content/store";
import { dateInTimeZone, timeInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The review queue (spec §16, §17, §37, §48).
 *
 * §16 fixes what a preview shows: platform, image, caption, copy, hashtags,
 * CTA, source, scheduled time and status. §17 fixes that status is per
 * platform, and that any story-level status is derived for display only.
 *
 * Every control here is a convenience over a server check. §17 forbids
 * frontend-only status protection, so a hidden button is never the thing
 * stopping an action — the server refuses it too.
 */
const INITIAL_GENERATE: GenerateFormState = { status: "idle" };
const INITIAL_REGENERATE: RegenerateFormState = { status: "idle" };
const INITIAL_RENDER: RenderFormState = { status: "idle" };
const INITIAL_REVIEW: ReviewFormState = { status: "idle" };

/** §37's list, in its order. "All" is added so the queue has a home. */
const TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Drafts", value: "DRAFT" },
  { label: "Review queue", value: "IN_REVIEW" },
  { label: "Approved", value: "APPROVED" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Failed", value: "FAILED" },
  { label: "Rejected", value: "REJECTED" },
];

function SubmitButton({
  idle,
  busy,
  variant = "default",
  size,
}: {
  idle: string;
  busy: string;
  variant?: "default" | "outline" | "destructive";
  size?: "sm";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? busy : idle}
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

function StatusMessage({ state, testId }: { state: ReviewFormState; testId: string }) {
  if (state.status === "idle" || !state.message) return null;

  return (
    <div className="mt-2">
      <p
        role="status"
        data-testid={testId}
        className={cn(
          "text-sm",
          state.status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state.message}
      </p>

      {state.problems && state.problems.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-destructive">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The editable copy (§16's Edit action).
 *
 * A plain form inside a disclosure rather than a modal: the reviewer is
 * comparing it against the card above it, and a dialog would cover that.
 */
function EditForm({ post }: { post: StoredPlatformPost }) {
  const [state, action] = useActionState(editPlatformPost, INITIAL_REVIEW);

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium">Edit</summary>

      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="platformPostId" value={post.id} />

        <div className="flex flex-col gap-1">
          <label htmlFor={`caption-${post.id}`} className="text-xs font-medium">
            Caption
          </label>
          <textarea
            id={`caption-${post.id}`}
            name="caption"
            rows={5}
            defaultValue={post.caption}
            className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`hashtags-${post.id}`} className="text-xs font-medium">
            Hashtags
          </label>
          <input
            id={`hashtags-${post.id}`}
            name="hashtags"
            defaultValue={post.hashtags.join(" ")}
            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`cta-${post.id}`} className="text-xs font-medium">
            Call to action
          </label>
          <input
            id={`cta-${post.id}`}
            name="cta"
            defaultValue={post.cta}
            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </div>

        <SubmitButton idle="Save changes" busy="Saving…" variant="outline" size="sm" />
        <StatusMessage state={state} testId="edit-status" />
      </form>
    </details>
  );
}

/**
 * When a post goes out (§18, §37's Schedule action).
 *
 * The date and time are read as the company's wall clock and stored as a UTC
 * instant (§54), which is why the zone is written on the form rather than left
 * to whoever is reading it to assume.
 */
function ScheduleForm({ post, timeZone }: { post: StoredPlatformPost; timeZone: string }) {
  const [state, action] = useActionState(schedulePlatformPost, INITIAL_REVIEW);

  const scheduled = post.scheduledAt ? new Date(post.scheduledAt) : null;

  return (
    <form action={action} className="mt-3 space-y-2" data-testid="schedule-form">
      <input type="hidden" name="platformPostId" value={post.id} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`date-${post.id}`} className="text-xs font-medium">
            Date
          </label>
          <input
            id={`date-${post.id}`}
            name="date"
            type="date"
            defaultValue={scheduled ? dateInTimeZone(scheduled, timeZone) : ""}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`time-${post.id}`} className="text-xs font-medium">
            Time ({timeZone})
          </label>
          <input
            id={`time-${post.id}`}
            name="time"
            type="time"
            defaultValue={scheduled ? timeInTimeZone(scheduled, timeZone) : ""}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </div>

        <SubmitButton
          idle={scheduled ? "Reschedule" : "Schedule"}
          busy="Scheduling…"
          variant="outline"
          size="sm"
        />
      </div>

      <StatusMessage state={state} testId="schedule-status" />
    </form>
  );
}

function ReviewControls({ post }: { post: StoredPlatformPost }) {
  const [approveState, approveAction] = useActionState(approvePlatformPost, INITIAL_REVIEW);
  const [rejectState, rejectAction] = useActionState(rejectPlatformPost, INITIAL_REVIEW);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <form action={approveAction}>
          <input type="hidden" name="platformPostId" value={post.id} />
          <SubmitButton idle="Approve" busy="Approving…" size="sm" />
        </form>

        <form action={rejectAction} className="flex items-center gap-2">
          <input type="hidden" name="platformPostId" value={post.id} />
          <input
            name="note"
            placeholder="Why? (optional)"
            aria-label={`Reason for rejecting the ${post.platform} version`}
            className="h-7 w-48 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <SubmitButton idle="Reject" busy="Rejecting…" variant="destructive" size="sm" />
        </form>
      </div>

      <StatusMessage state={approveState} testId="approve-status" />
      <StatusMessage state={rejectState} testId="reject-status" />
    </div>
  );
}

function PlatformCard({
  post,
  sourceTitle,
  sourceUrl,
  canRegenerate,
  canEdit,
  canApprove,
  canScheduleAny,
  simulated,
  timeZone,
}: {
  post: StoredPlatformPost;
  sourceTitle: string;
  sourceUrl: string;
  canRegenerate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canScheduleAny: boolean;
  simulated: boolean;
  timeZone: string;
}) {
  const [state, action] = useActionState(regeneratePost, INITIAL_REGENERATE);
  const open = canEditCopy(post.status);

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="platform-post">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          {PLATFORM_LABELS[post.platform] ?? post.platform}
        </span>

        <PostStatusBadge status={post.status} />

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

      <p className="mt-2 text-xs text-muted-foreground">
        Source:{" "}
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4"
        >
          {sourceTitle}
        </a>
        {" · "}
        {/* §16 lists scheduled time; §54 fixes the zone it is read in. */}
        {post.scheduledAt ? (
          <span data-testid="scheduled-for">
            {dateInTimeZone(new Date(post.scheduledAt), timeZone)} at{" "}
            {timeInTimeZone(new Date(post.scheduledAt), timeZone)} ({timeZone})
          </span>
        ) : (
          "Not scheduled yet"
        )}
      </p>

      <div className="mt-3 rounded-md bg-muted/50 p-3">
        <p className="text-xs font-medium">Visual concept ({post.visual.template})</p>
        <p className="mt-1 text-sm">{post.visual.headline}</p>
        {post.visual.supportingText ? (
          <p className="text-xs text-muted-foreground">{post.visual.supportingText}</p>
        ) : null}

        {/*
          §67: the screen never implies an image exists that does not. Three
          distinct states — rendered, failed with a reason, and not yet — and
          they never look alike.
        */}
        {post.mediaUrl ? (
          <a href={post.mediaUrl} target="_blank" rel="noreferrer noopener">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.mediaUrl}
              alt={`Generated ${post.platform} card`}
              data-testid="card-image"
              className="mt-2 w-full rounded-md border border-border"
            />
          </a>
        ) : post.lastError ? (
          <p className="mt-2 text-xs text-destructive" data-testid="render-error">
            The image could not be rendered: {post.lastError}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No image rendered yet.</p>
        )}
      </div>

      {post.status === "REJECTED" && post.rejectionNote ? (
        <p className="mt-3 text-sm text-destructive" data-testid="rejection-note">
          Rejected: {post.rejectionNote}
        </p>
      ) : null}

      {post.status === "APPROVED" && post.approvedAt ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="approved-at">
          Approved {dateInTimeZone(new Date(post.approvedAt), timeZone)} at{" "}
          {timeInTimeZone(new Date(post.approvedAt), timeZone)}
        </p>
      ) : null}

      {canEdit && open ? <EditForm post={post} /> : null}
      {canApprove && open ? <ReviewControls post={post} /> : null}
      {canScheduleAny && canSchedule(post.status) ? (
        <ScheduleForm post={post} timeZone={timeZone} />
      ) : null}

      {canRegenerate && open ? (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="platformPostId" value={post.id} />
          <SubmitButton idle="Regenerate" busy="Rewriting…" variant="outline" size="sm" />

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

function StoryHeader({
  item,
  posts,
  canApprove,
}: {
  item: StoredContentItem;
  posts: StoredPlatformPost[];
  canApprove: boolean;
}) {
  const [state, action] = useActionState(approveStory, INITIAL_REVIEW);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{item.coreMessage.headline}</h2>

        {/* §17: derived for display only. Never stored, never authorizing. */}
        <span
          className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          data-testid="story-status"
        >
          {deriveStoryStatus(posts.map((post) => post.status))}
        </span>

        {item.generation.mode === "MOCK" ? <SimulatedBadge /> : null}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">{item.coreMessage.keyTakeaway}</p>

      {canApprove && posts.some((post) => post.status === "IN_REVIEW") ? (
        <form action={action} className="mt-2">
          <input type="hidden" name="contentItemId" value={item.id} />
          <SubmitButton
            idle="Approve all platforms"
            busy="Approving…"
            variant="outline"
            size="sm"
          />
          <StatusMessage state={state} testId="approve-all-status" />
        </form>
      ) : null}
    </>
  );
}

export function ContentList({
  items,
  postsByItem,
  activeStatus,
  canGenerate,
  canRegenerate,
  canEdit,
  canApprove,
  canScheduleAny,
  timeZone,
}: {
  items: StoredContentItem[];
  postsByItem: Record<string, StoredPlatformPost[]>;
  activeStatus: string;
  canGenerate: boolean;
  canRegenerate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canScheduleAny: boolean;
  timeZone: string;
}) {
  const [state, action] = useActionState(generateContent, INITIAL_GENERATE);
  const [renderState, renderAction] = useActionState(renderImages, INITIAL_RENDER);

  return (
    <div className="mt-6">
      {canGenerate ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <form action={action}>
              <SubmitButton idle="Generate today's content" busy="Generating…" />
            </form>

            <form action={renderAction}>
              <SubmitButton idle="Render images" busy="Rendering…" variant="outline" />
            </form>
          </div>

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

          {renderState.status !== "idle" && renderState.message ? (
            <p
              role="status"
              data-testid="render-status"
              className={cn(
                "text-sm",
                renderState.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {renderState.message}
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

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter by status">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value ? `/content?status=${tab.value}` : "/content"}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-sm",
              activeStatus === tab.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        /* Empty state (§59): nothing generated is not the same as nothing selected. */
        <p className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          {activeStatus
            ? "Nothing is in this state."
            : "No content has been generated yet. Three stories have to be selected on the news screen first, and then generation writes a version for each platform."}
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {items.map((item) => {
            const posts = postsByItem[item.id] ?? [];

            return (
              <section key={item.id} data-testid="content-item">
                <StoryHeader item={item} posts={posts} canApprove={canApprove} />

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

                {/*
                  A story can reach this screen with nothing under it: every
                  platform version failed validation. Filtered views drop those
                  stories on the server, so this only shows on the full list —
                  where saying nothing would read as an image still loading.
                */}
                {posts.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                    No platform version passed validation for this story.
                  </p>
                ) : null}

                <div className="mt-3 grid gap-3">
                  {posts.map((post) => (
                    <PlatformCard
                      key={post.id}
                      post={post}
                      sourceTitle={item.sourceTitle}
                      sourceUrl={item.sourceUrl}
                      canRegenerate={canRegenerate}
                      canEdit={canEdit}
                      canApprove={canApprove}
                      canScheduleAny={canScheduleAny}
                      simulated={item.generation.mode === "MOCK"}
                      timeZone={timeZone}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
