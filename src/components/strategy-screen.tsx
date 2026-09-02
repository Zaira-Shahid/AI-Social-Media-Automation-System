"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { regenerateStrategy, type RegenerateStrategyFormState } from "@/app/(app)/strategy/actions";
import { labelFor } from "@/components/analytics-screen";
import { Button } from "@/components/ui/button";
import type { StoredWeeklyReport } from "@/lib/reporting/store";
import type { StoredStrategyReport } from "@/lib/strategy/store";
import type { WeightedGroup } from "@/lib/strategy/schema";
import { cn } from "@/lib/utils";

/**
 * The Strategy screen (spec §24, §25, §40, §63 Module 19).
 *
 * §40's list, split by where the data actually comes from: "what worked /
 * what did not work / best topics / weak topics / best platforms / best
 * formats" is Module 18's most recent weekly report — this screen does not
 * recompute any of it. "AI recommendations / next week's strategy" is this
 * module's own current strategy version.
 */
const CATEGORY_LABELS: Record<string, string> = {
  TOPIC_WEIGHTING: "Topic weighting",
  PLATFORM_WEIGHTING: "Platform weighting",
  POSTING_FREQUENCY: "Posting frequency",
  CONTENT_MIX: "Content mix",
  HEADLINE_STYLE: "Headline style",
  CTA_STYLE: "CTA style",
  FORMAT_DISTRIBUTION: "Format distribution",
  TIMING: "Timing",
};

const INITIAL: RegenerateStrategyFormState = { status: "idle" };

function RegenerateButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Generating…" : "Regenerate now"}
    </Button>
  );
}

function WeightList({ title, groups }: { title: string; groups: WeightedGroup[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No measured data.</p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-sm">
          {groups.map((group) => (
            <li key={group.key} className="flex justify-between">
              <span>{labelFor(group.key)}</span>
              <span className="text-muted-foreground">{group.weight}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StrategyScreen({
  current,
  history,
  latestWeek,
  canManage,
}: {
  current: StoredStrategyReport | null;
  /** Most recent versions first. */
  history: StoredStrategyReport[];
  latestWeek: StoredWeeklyReport | null;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(regenerateStrategy, INITIAL);

  return (
    <div className="mt-4 space-y-8">
      {canManage ? (
        <form action={formAction} className="flex items-center gap-3">
          <RegenerateButton />
          {state.status !== "idle" && state.message ? (
            <p
              role="status"
              className={cn("text-sm", state.status === "error" ? "text-destructive" : "text-muted-foreground")}
            >
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">What worked, what did not</h2>
        {!latestWeek ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No weekly report has run yet — see Analytics once one has.
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Best platform", latestWeek.bestPlatform ? labelFor(latestWeek.bestPlatform) : "—"],
              ["Weakest platform", latestWeek.weakestPlatform ? labelFor(latestWeek.weakestPlatform) : "—"],
              ["Best topic", latestWeek.bestTopic ?? "—"],
              ["Weak topic", latestWeek.weakTopic ?? "—"],
              ["Best format", latestWeek.bestFormat ? labelFor(latestWeek.bestFormat) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-card p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {!current ? (
        <p className="text-sm text-muted-foreground">
          No strategy has been generated yet. It runs automatically once a weekly report exists,
          {canManage ? " or generate one above." : "."}
        </p>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-semibold">
              Next week&apos;s strategy
              <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                v{current.version}
              </span>
              {current.mode === "MOCK" ? (
                <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  SIMULATED
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Computed from {current.postsAnalyzed} measured post(s) across {current.weeksAnalyzed.length} week(s).
            </p>

            <div className="mt-3 grid gap-6 sm:grid-cols-3">
              <WeightList title="Topic weighting" groups={current.topicWeighting} />
              <WeightList title="Platform weighting" groups={current.platformWeighting} />
              <WeightList title="Format weighting" groups={current.formatWeighting} />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium">AI recommendations</h3>
            {!current.recommendations || current.recommendations.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Not enough measured data to recommend anything yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {current.recommendations.map((rec, index) => (
                  <li key={index} className="rounded-md border p-3 text-sm">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {CATEGORY_LABELS[rec.category] ?? rec.category}
                    </span>
                    <p className="mt-1.5 font-medium">{rec.recommendation}</p>
                    <p className="mt-1 text-muted-foreground">{rec.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {history.length > 1 ? (
        <section>
          <h3 className="text-sm font-medium">Version history</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {history.map((version) => (
              <li key={version.id} className="flex justify-between">
                <span>Version {version.version}</span>
                <span className="text-muted-foreground">
                  {version.postsAnalyzed} post(s), {version.recommendations?.length ?? 0} recommendation(s)
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
