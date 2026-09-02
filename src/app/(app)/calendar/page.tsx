import { CalendarScreen, type CalendarFilters } from "@/components/calendar-screen";
import { requirePermission } from "@/lib/auth/current-user";
import { buildRange, parseAnchor, parseView } from "@/lib/calendar/grid";
import { platformSchema, postStatusSchema } from "@/lib/content/schema";
import {
  getContentItemsByIds,
  listApprovedUnscheduledPosts,
  listScheduledPostsBetween,
  type StoredContentItem,
  type StoredPlatformPost,
} from "@/lib/content/store";
import { getServerEnv } from "@/lib/env.server";
import { dateInTimeZone, endOfDayInTimeZone, startOfDayInTimeZone } from "@/lib/time";

/**
 * The social media calendar (spec §38, §54).
 *
 * Read-only. §63 puts schedule management, validation and duplicate protection
 * in Module 11; this module shows what is scheduled and what is waiting, and
 * writes nothing.
 *
 * Everything is computed on the server in the configured timezone. §54 forbids
 * browser-local time as the source of truth, and a calendar is precisely where
 * that mistake would be invisible: the grid would simply look right to whoever
 * built it.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Calendar" };

/** Enough for a busy month; three platforms times three stories a day is 270. */
const UNSCHEDULED_LIMIT = 60;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("content:view");

  const params = await searchParams;
  const timeZone = getServerEnv().APP_TIMEZONE;
  const today = dateInTimeZone(new Date(), timeZone);

  const range = buildRange(parseView(one(params.view)), parseAnchor(one(params.date), today));

  /*
   * An unrecognised filter is dropped rather than refused. It arrives from a
   * URL someone may have edited or a link that outlived a rename, and the
   * honest answer to a filter nobody recognises is the unfiltered calendar.
   */
  const filters: CalendarFilters = {
    platform: platformSchema.safeParse(one(params.platform)).data ?? "",
    status: postStatusSchema.safeParse(one(params.status)).data ?? "",
  };

  const from = startOfDayInTimeZone(range.days[0], timeZone).toISOString();
  const to = endOfDayInTimeZone(range.days[range.days.length - 1], timeZone).toISOString();

  const [scheduled, unscheduledAll] = await Promise.all([
    listScheduledPostsBetween(from, to),
    listApprovedUnscheduledPosts(UNSCHEDULED_LIMIT),
  ]);

  const matches = (post: StoredPlatformPost) =>
    (!filters.platform || post.platform === filters.platform) &&
    (!filters.status || post.status === filters.status);

  const posts = scheduled.filter(matches);
  // The waiting list is APPROVED by definition, so only the platform filter
  // applies to it — a status filter would empty it for a reason nobody asked.
  const unscheduled = unscheduledAll.filter(
    (post) => !filters.platform || post.platform === filters.platform,
  );

  const items = await getContentItemsByIds(
    [...posts, ...unscheduled].map((post) => post.contentItemId),
  );

  const stories: Record<string, StoredContentItem> = {};

  for (const item of items) stories[item.id] = item;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        What is scheduled, per platform and per day. Scheduling itself is Module 11 — this screen
        reads the plan, it does not change it.
      </p>

      <CalendarScreen
        range={range}
        posts={posts}
        unscheduled={unscheduled}
        stories={stories}
        filters={filters}
        timeZone={timeZone}
        today={today}
      />
    </div>
  );
}
