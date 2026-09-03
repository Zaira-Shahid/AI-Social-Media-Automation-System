import Link from "next/link";

import { PLATFORM_LABELS } from "@/components/post-status-badge";
import type { ComparisonGroup, RankedPost } from "@/lib/reporting/schema";
import type { StoredWeeklyReport } from "@/lib/reporting/store";
import { dateInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The Analytics screen (spec §23, §39, §63 Module 18).
 *
 * §39's list, in order: overall performance, platform comparison, top posts,
 * weak posts, topic performance, engagement trends. A week selector stands
 * in for §39's date filter — reports are already weekly, so a date range
 * picker inside one would filter nothing a week boundary does not already
 * decide. Platform, topic and post are still real filters: this screen shows
 * everything and lets a reader scan groups, since a week's post count is
 * small enough that hiding rows would cost more than it saves.
 */
export const FORMAT_LABELS: Record<string, string> = {
  HEADLINE_CARD: "Headline card",
  QUOTE_CARD: "Quote card",
  STATISTIC_CARD: "Statistic card",
  EDUCATIONAL_CARD: "Educational card",
};

export function labelFor(key: string): string {
  return PLATFORM_LABELS[key] ?? FORMAT_LABELS[key] ?? key;
}

function GroupTable({ title, groups }: { title: string; groups: ComparisonGroup[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No measured posts this week.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 font-normal">Posts</th>
              <th className="py-1 font-normal">Avg. engagement</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key} className="border-b last:border-0">
                <td className="py-1.5">{labelFor(group.key)}</td>
                <td className="py-1.5">{group.postsAnalyzed}</td>
                <td className="py-1.5">{group.averageEngagement.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PostList({ title, posts }: { title: string; posts: RankedPost[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      {posts.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No measured posts this week.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {posts.map((post) => (
            <li key={post.platformPostId} className="text-sm">
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {labelFor(post.platform)}
              </span>{" "}
              {post.permalink ? (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {post.sourceTitle}
                </a>
              ) : (
                post.sourceTitle
              )}{" "}
              <span className="text-muted-foreground">
                — {post.engagement.toFixed(1)} engagement
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AnalyticsScreen({
  report,
  recent,
  selectedId,
  timeZone,
}: {
  report: StoredWeeklyReport | null;
  /** Most recent reports first, for the week selector and the trend list. */
  recent: StoredWeeklyReport[];
  selectedId: string | null;
  timeZone: string;
}) {
  if (recent.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No weekly report has run yet. The first one runs at the end of the current week, once at
        least one post has published.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-8">
      <nav aria-label="Week" className="flex flex-wrap gap-2">
        {recent.map((week) => {
          const active = week.id === (selectedId ?? recent[0].id);

          return (
            <Link
              key={week.id}
              href={`/analytics?week=${week.id}`}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                active
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              Week of {dateInTimeZone(new Date(week.windowStart), timeZone)}
            </Link>
          );
        })}
      </nav>

      {!report ? (
        <p className="text-sm text-muted-foreground">That report could not be found.</p>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-semibold">
              Week of {dateInTimeZone(new Date(report.windowStart), timeZone)} to{" "}
              {dateInTimeZone(new Date(report.windowEnd), timeZone)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.postsAnalyzed} post(s) analyzed
              {report.postsExcluded > 0
                ? `, ${report.postsExcluded} published post(s) excluded — no measurable analytics yet.`
                : "."}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Best platform", report.bestPlatform ? labelFor(report.bestPlatform) : "—"],
                [
                  "Weakest platform",
                  report.weakestPlatform ? labelFor(report.weakestPlatform) : "—",
                ],
                ["Best topic", report.bestTopic ?? "—"],
                ["Weak topic", report.weakTopic ?? "—"],
                ["Best format", report.bestFormat ? labelFor(report.bestFormat) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {report.narrative ? (
            <section>
              <h3 className="text-sm font-medium">
                Engagement patterns
                {report.narrativeMode === "MOCK" ? (
                  <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    SIMULATED
                  </span>
                ) : null}
              </h3>
              <p className="mt-1 text-sm">{report.narrative.engagementPatterns}</p>
              {report.narrative.recommendedChanges.length > 0 ? (
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                  {report.narrative.recommendedChanges.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough measured data this week to write an analysis.
            </p>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <PostList title="Top posts" posts={report.bestPosts} />
            <PostList title="Weak posts" posts={report.weakPosts} />
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <GroupTable title="Platform comparison" groups={report.platformComparison} />
            <GroupTable title="Topic performance" groups={report.topicComparison} />
            <GroupTable title="Format comparison" groups={report.formatComparison} />
          </div>

          {recent.length > 1 ? (
            <section>
              <h3 className="text-sm font-medium">Engagement trend</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {[...recent].reverse().map((week) => {
                  const total = week.platformComparison.reduce(
                    (sum, group) => sum + group.totalEngagement,
                    0,
                  );
                  const average = week.postsAnalyzed > 0 ? total / week.postsAnalyzed : null;

                  return (
                    <li key={week.id} className="flex justify-between">
                      <span>Week of {dateInTimeZone(new Date(week.windowStart), timeZone)}</span>
                      <span className="text-muted-foreground">
                        {average === null ? "no data" : `${average.toFixed(1)} avg. engagement`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
