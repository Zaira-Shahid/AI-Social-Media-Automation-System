"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  notifySlackNow,
  rankNow,
  type NotifyFormState,
  type RankFormState,
} from "@/app/(app)/news/actions";
import { Button } from "@/components/ui/button";
import type { StoredNotificationLog } from "@/lib/slack/store";
import { cn } from "@/lib/utils";

/**
 * Manual triggers for the news automations (spec §41, §46).
 *
 * Split out of the news screen because they answer a different question. The
 * screen is about which stories to publish; this is about whether the pipeline
 * that produced them has run, and what it did.
 */
const INITIAL_RANK_STATE: RankFormState = { status: "idle" };
const INITIAL_NOTIFY_STATE: NotifyFormState = { status: "idle" };

function RankButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Ranking…" : "Rank now"}
    </Button>
  );
}

function NotifyButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Sending…" : "Send to Slack"}
    </Button>
  );
}

export function NewsAutomationControls({
  notifications,
}: {
  notifications: StoredNotificationLog[];
}) {
  const [rankState, rankAction] = useActionState(rankNow, INITIAL_RANK_STATE);
  const [notifyState, notifyAction] = useActionState(notifySlackNow, INITIAL_NOTIFY_STATE);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <form action={rankAction}>
          <RankButton />
        </form>

        <form action={notifyAction}>
          <NotifyButton />
        </form>
      </div>

      {rankState.status !== "idle" && rankState.message ? (
        <p
          role="status"
          data-testid="rank-status"
          className={cn(
            "text-sm",
            rankState.status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {rankState.mode === "MOCK" ? "Simulated — " : ""}
          {rankState.message}
        </p>
      ) : null}

      {notifyState.status !== "idle" && notifyState.message ? (
        <p
          role="status"
          data-testid="notify-status"
          className={cn(
            "text-sm",
            notifyState.status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {/* §67: a simulated send is never reported as a delivered one. */}
          {notifyState.mode === "MOCK" ? "Simulated — nothing was sent to Slack. " : ""}
          {notifyState.message}
        </p>
      ) : null}

      <NotificationHistory entries={notifications} />
    </div>
  );
}

/**
 * Delivery history (§9's notification logs, §52).
 *
 * Shows what actually happened rather than what was intended: a send, a
 * failure with its reason, or a skip. §67 means "no news today" and "the
 * notifier broke" must never look the same on this screen.
 */
function NotificationHistory({ entries }: { entries: StoredNotificationLog[] }) {
  return (
    <section className="pt-4">
      <h2 className="text-sm font-semibold">Slack notifications</h2>

      {entries.length === 0 ? (
        <p className="mt-2 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          The shortlist has not been sent to Slack yet.
        </p>
      ) : (
        <ul className="mt-2 rounded-lg border border-border px-4" data-testid="notification-log">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-border py-3 text-sm last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium",
                    entry.status === "FAILED"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {entry.status}
                </span>

                {entry.mode === "MOCK" ? (
                  <span
                    className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    data-testid="notification-mock-badge"
                  >
                    Simulated
                  </span>
                ) : null}

                <span className="text-muted-foreground">
                  {entry.storyCount} {entry.storyCount === 1 ? "story" : "stories"} ·{" "}
                  {entry.channel} · {entry.trigger.toLowerCase()}
                </span>
              </div>

              {entry.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
