import Link from "next/link";

import { PLATFORM_LABELS, PostStatusBadge } from "@/components/post-status-badge";
import {
  bucketByDay,
  dayLabel,
  periodLabel,
  shiftAnchor,
  type CalendarRange,
  type CalendarView,
} from "@/lib/calendar/grid";
import { PLATFORMS } from "@/lib/content/schema";
import { statusLabel } from "@/lib/content/status";
import type { StoredContentItem, StoredPlatformPost } from "@/lib/content/store";
import { timeInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The calendar (spec §38).
 *
 * §38: month, week and day views, each post showing platform, preview, status
 * and scheduled time. Everything here is a link and nothing is client state,
 * because the view, the period and both filters belong in the URL — a calendar
 * nobody can send to a colleague is half a calendar.
 *
 * Rendered on the server in the company's configured timezone (§54). The
 * browser's zone is never consulted, so two people in different places reading
 * the same URL see the same grid.
 */

export interface CalendarFilters {
  platform: string;
  status: string;
}

/**
 * The statuses a scheduled post can actually be in (§17).
 *
 * Not every status in §17 — a draft has no scheduled time, so offering
 * "Drafts" here would be a filter that can only ever return nothing. Approved
 * work with no slot yet has its own list below the grid.
 */
export const CALENDAR_STATUSES = ["SCHEDULED", "PUBLISHED", "FAILED"] as const;

function href(view: CalendarView, date: string, filters: CalendarFilters): string {
  const query = new URLSearchParams({ view, date });

  if (filters.platform) query.set("platform", filters.platform);
  if (filters.status) query.set("status", filters.status);

  return `/calendar?${query.toString()}`;
}

const CHIP = "rounded-lg border px-2.5 py-1 text-sm";
const CHIP_ACTIVE = "border-primary bg-primary/10 text-primary";
const CHIP_IDLE = "border-border text-muted-foreground hover:bg-muted";

function FilterChips({
  label,
  options,
  active,
  build,
}: {
  label: string;
  options: { label: string; value: string }[];
  active: string;
  build: (value: string) => string;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label={label}>
      {options.map((option) => (
        <Link
          key={option.value}
          href={build(option.value)}
          className={cn(CHIP, active === option.value ? CHIP_ACTIVE : CHIP_IDLE)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * One post as it appears on the calendar (§38's four fields).
 *
 * The preview is the rendered card where one exists and the caption's opening
 * where it does not. §67: an empty frame that implies an image nobody rendered
 * is worse than saying there is no card.
 */
function PostChip({
  post,
  story,
  timeZone,
  detailed,
}: {
  post: StoredPlatformPost;
  story: StoredContentItem | undefined;
  timeZone: string;
  detailed: boolean;
}) {
  const thumbnail = detailed ? "size-20" : "size-10";

  return (
    <article
      className="rounded-md border border-border bg-background p-2 text-left"
      data-testid="calendar-post"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {post.scheduledAt ? (
          <span className="text-xs font-semibold" data-testid="scheduled-time">
            {timeInTimeZone(new Date(post.scheduledAt), timeZone)}
          </span>
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">Not scheduled</span>
        )}

        <span className="text-xs">{PLATFORM_LABELS[post.platform] ?? post.platform}</span>

        <PostStatusBadge status={post.status} />
      </div>

      <div className={cn("mt-1.5 flex gap-2", detailed ? "items-start" : "items-center")}>
        {post.mediaUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={post.mediaUrl}
            alt={`Card for the ${post.platform} version`}
            data-testid="calendar-preview"
            className={cn("shrink-0 rounded border border-border object-cover", thumbnail)}
          />
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded border border-dashed border-border text-center text-[10px] text-muted-foreground",
              thumbnail,
            )}
          >
            No card
          </span>
        )}

        <div className="min-w-0">
          {story ? (
            <p className="truncate text-xs font-medium">{story.coreMessage.headline}</p>
          ) : null}

          <p className={cn("text-xs text-muted-foreground", detailed ? "" : "truncate")}>
            {post.caption}
          </p>
        </div>
      </div>
    </article>
  );
}

function DayCell({
  date,
  posts,
  stories,
  timeZone,
  today,
  inPeriod,
  filters,
}: {
  date: string;
  posts: StoredPlatformPost[];
  stories: Record<string, StoredContentItem>;
  timeZone: string;
  today: string;
  inPeriod: boolean;
  filters: CalendarFilters;
}) {
  const { weekday, day } = dayLabel(date);

  return (
    <div
      className={cn(
        "min-h-28 rounded-lg border p-2",
        inPeriod ? "border-border" : "border-dashed border-border/60 bg-muted/30",
        date === today ? "ring-1 ring-primary" : "",
      )}
      data-testid="calendar-day"
      data-date={date}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{weekday}</span>

        {/* The day number opens that day, which is how a month view gets used. */}
        <Link
          href={href("day", date, filters)}
          aria-label={`Open ${date}`}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {day}
        </Link>
      </div>

      <div className="mt-2 space-y-1.5">
        {posts.map((post) => (
          <PostChip
            key={post.id}
            post={post}
            story={stories[post.contentItemId]}
            timeZone={timeZone}
            detailed={false}
          />
        ))}
      </div>
    </div>
  );
}

export function CalendarScreen({
  range,
  posts,
  unscheduled,
  stories,
  filters,
  timeZone,
  today,
}: {
  range: CalendarRange;
  posts: StoredPlatformPost[];
  unscheduled: StoredPlatformPost[];
  stories: Record<string, StoredContentItem>;
  filters: CalendarFilters;
  timeZone: string;
  today: string;
}) {
  const byDay = bucketByDay(posts, timeZone);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          label="Calendar view"
          active={range.view}
          options={[
            { label: "Month", value: "month" },
            { label: "Week", value: "week" },
            { label: "Day", value: "day" },
          ]}
          build={(value) => href(value as CalendarView, range.anchor, filters)}
        />

        <div className="flex items-center gap-2">
          <Link
            href={href(range.view, shiftAnchor(range.view, range.anchor, -1), filters)}
            className={cn(CHIP, CHIP_IDLE)}
            aria-label="Previous period"
          >
            ←
          </Link>
          <Link href={href(range.view, today, filters)} className={cn(CHIP, CHIP_IDLE)}>
            Today
          </Link>
          <Link
            href={href(range.view, shiftAnchor(range.view, range.anchor, 1), filters)}
            className={cn(CHIP, CHIP_IDLE)}
            aria-label="Next period"
          >
            →
          </Link>
        </div>

        <h2 className="text-sm font-semibold" data-testid="calendar-period">
          {periodLabel(range)}
        </h2>
      </div>

      <div className="flex flex-wrap gap-3">
        <FilterChips
          label="Filter by platform"
          active={filters.platform}
          options={[
            { label: "All platforms", value: "" },
            ...PLATFORMS.map((platform) => ({
              label: PLATFORM_LABELS[platform] ?? platform,
              value: platform,
            })),
          ]}
          build={(value) => href(range.view, range.anchor, { ...filters, platform: value })}
        />

        <FilterChips
          label="Filter by status"
          active={filters.status}
          options={[
            { label: "All statuses", value: "" },
            ...CALENDAR_STATUSES.map((status) => ({ label: statusLabel(status), value: status })),
          ]}
          build={(value) => href(range.view, range.anchor, { ...filters, status: value })}
        />
      </div>

      {/*
        §54, written where a reader can check it: this grid is the company's
        working day, not the reader's laptop's.
      */}
      <p className="text-xs text-muted-foreground" data-testid="calendar-timezone">
        Times shown in {timeZone}.
      </p>

      {posts.length === 0 ? (
        <p
          className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground"
          data-testid="calendar-empty"
        >
          Nothing is scheduled in this period. Approved versions waiting for a slot are listed
          below; giving them one is Module 11.
        </p>
      ) : null}

      <div
        className={cn(
          "grid gap-2",
          range.view === "day" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7",
        )}
      >
        {range.days.map((date) => (
          <DayCell
            key={date}
            date={date}
            posts={byDay[date] ?? []}
            stories={stories}
            timeZone={timeZone}
            today={today}
            inPeriod={date >= range.periodStart && date <= range.periodEnd}
            filters={filters}
          />
        ))}
      </div>

      <section>
        <h2 className="text-sm font-semibold">Approved, waiting for a slot</h2>

        {unscheduled.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground"
            data-testid="unscheduled-empty"
          >
            Nothing is approved and unscheduled. Versions appear here once a reviewer approves them
            on the content screen.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((post) => (
              <PostChip
                key={post.id}
                post={post}
                story={stories[post.contentItemId]}
                timeZone={timeZone}
                detailed
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
