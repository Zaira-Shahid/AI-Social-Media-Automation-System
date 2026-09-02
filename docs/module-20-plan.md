# Module 20 — Automation Control Center

Spec sections: §3, §8, §32, §33, §41, §44, §45, §49, §50, §51, §52, §63
(Module 20), §65, §67.

Build: workflow status, run history, last successful run, next run, errors,
enable/disable controls. §41 fixes the eight rows this screen shows — Daily
News Discovery, Slack Notification, Content Generation, Scheduling,
Publishing, Analytics, Weekly Analysis, Strategy Optimization — and five
columns for each: ON/OFF, last run, next run, status, last error.

## Step 1 — Read

§41 (the exact rows and columns), §44 (the eleven n8n workflows this app
implements nine of), §45/§49/§50/§51 (each automation's own shape, already
built by Modules 03–19), §65 (never invent a deployment or scheduling fact),
§67.

## Step 2 — Inspect: what §41 actually required building

This module's real work turned out to be upstream of the screen itself.
Inspecting the seven automations already built (Modules 03, 03, 04, 07, 11,
16, 17, 18, 19) found:

| Row | Recorded a run before this module? |
|---|---|
| Daily News Discovery | Yes — `automationRuns`, since Module 03 |
| Slack Notification | Yes — its own `notificationLogs`, since Module 05 |
| Content Generation | **No** |
| Scheduling | **No** |
| Publishing | **No** |
| Analytics | **No** |
| Weekly Analysis | **No** |
| Strategy Optimization | **No** |

Six of eight rows had nothing to read. `CONTENT_GENERATION_WORKFLOW`,
`WEEKLY_ANALYSIS_WORKFLOW` and `STRATEGY_OPTIMIZATION_WORKFLOW` were already
declared as constants (their own modules' doc comments already named the
n8n workflow they belong to) but never once passed to a run-recording call.
§41 cannot be satisfied by a screen alone — it needed every workflow
actually instrumented first.

The existing `automationRunSchema` (Module 03) was also narrower than this
module needed: `sourcesAttempted`/`sourcesFailed`/`itemsDiscovered`/
`itemsNew` are meaningful for news discovery and (repurposed, a little
awkwardly) for ranking, but mean nothing for, say, strategy optimization.

## Step 3 — Two decisions, stated plainly

**The schema gained a `metrics` bag rather than losing its four original
fields.** Seven call sites outside `news/ingest.ts` and `news/rank.ts` —
two webhook routes and two server actions in `news/actions.ts` and
`news/sources/actions.ts` — read `run.sourcesAttempted` etc. directly off
the in-memory result. Removing those fields would have forced changes to
already-shipped, already-tested UI messages for no behavioural gain. Instead
`metrics: z.record(z.string(), z.number()).default({})` was added
alongside them (defaulted, so an old stored run still parses — same
reasoning as `platformPost.publishAttempts`'s default). News discovery and
ranking keep their four named fields, untouched; every other workflow uses
`metrics` instead, spreading in `NO_SOURCE_METRICS` (four zeroes, named so
the choice reads as deliberate rather than forgotten) for the fields that do
not apply to it.

**"Next run" is answered honestly, not guessed.** n8n owns every schedule,
and this app has no API into n8n's own cron configuration. §65 forbids
inventing one, so the screen states this in words — "configured in n8n, not
tracked here" — rather than showing a plausible-looking countdown built
from `lastRun + assumed interval`, which could be wrong the moment someone
changes the schedule in n8n without this app knowing.

## Step 4 — Implementation

### `src/lib/automation/` — the new module

- `schema.ts` — re-exports the (now generalized) `automationRunSchema` from
  `news/schema.ts` rather than moving it, `automationSettingSchema`
  (enable/disable), `NO_SOURCE_METRICS`, three new workflow-key constants
  (`SCHEDULING_WORKFLOW`, `PUBLISHING_WORKFLOW`, `ANALYTICS_SYNC_WORKFLOW` —
  nothing else owned these yet), and `AUTOMATIONS`: §41's eight rows as
  plain data. Deliberately plain data, not imports from each owning module —
  importing `content/generate.ts` just for one string would pull its whole
  AI/Firestore dependency graph into every webhook route that reads this
  registry, including ones with nothing to do with content generation.
- `store.ts` — `recordAutomationRun` (moved from `news/store.ts`, same
  never-throws contract), `getLatestRun`/`listRecentRuns`,
  `getAutomationSetting`/`listAutomationSettings`/`setAutomationEnabled`.
  Both collections stay server-only in `firestore.rules` — same posture
  `automationRuns` has had since Module 03 — because the screen reads them
  through the Admin SDK, same pattern as Social Accounts (Module 12) and
  every other Module 20-adjacent screen.
- `gate.ts` — `isWorkflowEnabled`, the enable/disable half. "OFF" means the
  endpoint declines to run its pipeline and says so; it cannot mean "n8n
  stops asking," because this app cannot reach n8n's schedule.
- `status.ts` — normalizes both sources (`automationRuns` for seven rows,
  `notificationLogs` for Slack Notification) into one shape for the screen,
  without forcing Slack's own SENT/FAILED/SKIPPED vocabulary into the other
  rows' SUCCESS/PARTIAL/FAILURE — that would be a paraphrase of what
  actually happened, not a display convenience. One workflow's read failing
  is caught per-row so it cannot blank the other seven.

### Instrumentation, one engine at a time

`content/generate.ts`, `analytics/sync.ts`, `reporting/weekly.ts` and
`strategy/optimize.ts` each got a thin wrapper around their existing
function — the original body renamed to an `…Inner` function — so every exit
path (including early returns and a thrown error) records exactly one
automation run, without touching the already-tested logic inside. Trigger
(`WEBHOOK` vs `MANUAL`) is inferred from the existing actor-string
convention (`"n8n:…"` / `"system:strategy"` vs a real uid) rather than a new
parameter, since two of these already have a manual trigger (Content
screen's Generate button, Strategy screen's Regenerate button) reusing the
same function.

"Scheduling" and "Publishing" are two rows for one n8n workflow
(`07_scheduled_publishing`). `collectDuePosts` itself is not instrumented —
`runDuePublishing` (Publishing) calls it internally, and recording inside
the shared function would double-count every publish tick as a scheduling
run too. Instead `content/due/route.ts` (Scheduling) records its own run
directly, and `publishing/publish.ts`'s `runDuePublishing` (Publishing)
records its own — the one place in this module where instrumentation lives
in a route rather than its engine function, for exactly this reason.

### Enable/disable

Every one of the nine webhook routes this app has (news discovery, ranking,
notification, content generation, scheduling, publishing, analytics sync,
weekly analysis, strategy optimization) now checks `isWorkflowEnabled`
immediately after signature verification and before doing anything else,
responding `{ skipped: true, reason: "This automation is disabled." }`
rather than a 4xx/5xx — n8n's own step succeeded; the pipeline chose not to
run. `content/render` was left alone: it has no row of its own in §41's
eight, and gating it would be scope this module was not asked for.

### The screen

`/automation`, gated on `automations:manage` (already the permission this
app's manual-trigger buttons use — the natural fit for controlling
automations, not merely viewing them). One row per §41 automation: status
badge, last-run time and trigger, last error where there is one, and an
Enable/Disable button whose server action validates the submitted workflow
key against the fixed `AUTOMATIONS` registry before writing anything.

## Step 5 — Tests

`tests/unit/automation-gate.test.ts`, `automation-status.test.ts`. Under
test: a never-toggled workflow reads as enabled, Slack Notification reads
from `notificationLogs` and never calls `getLatestRun`, one workflow's read
failure does not blank the other seven rows, and per-workflow enabled state
is reflected correctly. The five instrumented engines' existing test suites
(`content-generate`, `publishing-engine`, `analytics-sync`,
`reporting-weekly`, `strategy-optimize`) needed no changes at all —
`recordAutomationRun` never throws, so the new call inside each is silently
absorbed by tests that do not mock `automation/store`, exactly as designed.

## Step 6 — Validate

`typecheck`, `lint`, `test` (496 passed), `build`, and `test:rules` against
the Firebase emulator (37 passed) — all clean.

## Step 7 — Security

Reviewed directly: every gate check is a pure early return before the
existing signed-verification logic, adding no new auth surface;
`automationSettings` is server-only, deny-all in `firestore.rules`; the
toggle action validates the submitted workflow key against the fixed
registry before writing, and is gated on `automations:manage`. No findings.

### Next

Module 21 — Audit Logs & Error Recovery.
