"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  runAutomationNow,
  toggleAutomation,
  type RunNowFormState,
  type ToggleAutomationFormState,
} from "@/app/(app)/automation/actions";
import { Button } from "@/components/ui/button";
import type { AutomationStatusView } from "@/lib/automation/status";
import { cn } from "@/lib/utils";

/**
 * The Automation Control Center (spec §41, §63 Module 20/21).
 *
 * One row per automation, in §41's own order. Status vocabulary is shown
 * as-is rather than forced into one shared enum — Slack Notification's
 * SENT/FAILED/SKIPPED and every other row's SUCCESS/PARTIAL/FAILURE are both
 * real, both honest, and translating one into the other's words would be a
 * paraphrase of what actually happened, not a display convenience.
 */
const TOGGLE_INITIAL: ToggleAutomationFormState = { status: "idle" };
const RUN_INITIAL: RunNowFormState = { status: "idle" };

const SUCCESS_STATUSES = new Set(["SUCCESS", "SENT"]);
const FAILURE_STATUSES = new Set(["FAILURE", "FAILED"]);

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        SUCCESS_STATUSES.has(status)
          ? "bg-primary/10 text-primary"
          : FAILURE_STATUSES.has(status)
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} disabled={pending}>
      {pending ? "Saving…" : enabled ? "Disable" : "Enable"}
    </Button>
  );
}

function RunNowButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Running…" : "Run now"}
    </Button>
  );
}

function AutomationRow({ automation }: { automation: AutomationStatusView }) {
  const [toggleState, toggleAction] = useActionState(toggleAutomation, TOGGLE_INITIAL);
  const [runState, runAction] = useActionState(runAutomationNow, RUN_INITIAL);

  return (
    <li className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{automation.label}</h3>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-xs font-medium",
                automation.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {automation.enabled ? "ON" : "OFF"}
            </span>
          </div>

          {automation.lastRun ? (
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <StatusBadge status={automation.lastRun.status} />
                <span className="text-muted-foreground">
                  {new Date(automation.lastRun.finishedAt).toLocaleString()} · {automation.lastRun.trigger}
                </span>
              </div>
              {automation.lastRun.error ? (
                <p className="text-destructive">{automation.lastRun.error}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Never run yet.</p>
          )}

          {/* §65: honest rather than guessed — this app has no visibility into n8n's cron config. */}
          <p className="mt-2 text-xs text-muted-foreground">Next run: configured in n8n, not tracked here.</p>

          {automation.recentRuns.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Run history ({automation.recentRuns.length})
              </summary>
              <ul className="mt-2 space-y-1 border-l pl-3">
                {automation.recentRuns.map((run, index) => (
                  <li key={index} className="text-xs">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-muted-foreground">
                        {new Date(run.finishedAt).toLocaleString()} · {run.trigger}
                      </span>
                    </div>
                    {run.error ? <p className="text-destructive">{run.error}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <form action={toggleAction} className="flex flex-col items-end gap-1">
            <input type="hidden" name="workflow" value={automation.workflow} />
            <input type="hidden" name="enabled" value={(!automation.enabled).toString()} />
            <ToggleButton enabled={automation.enabled} />
            {toggleState.status !== "idle" && toggleState.message ? (
              <span
                className={cn(
                  "text-xs",
                  toggleState.status === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {toggleState.message}
              </span>
            ) : null}
          </form>

          <form action={runAction} className="flex flex-col items-end gap-1">
            <input type="hidden" name="workflow" value={automation.workflow} />
            <RunNowButton />
            {runState.status !== "idle" && runState.message ? (
              <span
                className={cn(
                  "max-w-40 text-right text-xs",
                  runState.status === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {runState.message}
              </span>
            ) : null}
          </form>
        </div>
      </div>
    </li>
  );
}

export function AutomationScreen({ automations }: { automations: AutomationStatusView[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {automations.map((automation) => (
        <AutomationRow key={automation.workflow} automation={automation} />
      ))}
    </ul>
  );
}
