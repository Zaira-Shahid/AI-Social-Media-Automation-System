# Module 21 — Audit Logs & Error Recovery

Spec sections: §17, §18, §33, §41, §52, §53, §55, §63 (Module 21), §65.

Build: audit logs, automation logs, retry handling, failure recovery, Slack
alerts, operational visibility.

## Step 1 — Read

§52 (the general pattern — Detect → Log → Retry when safe → Notify → Correct
status — and that every failure type in its list must follow it), §55
(audit fields; recording has existed since Module 01), §53/§17 (idempotency
and the fixed status-transition table — read closely before assuming what
"recovery" is allowed to mean), §63 Module 21, §65.

## Step 2 — Inspect, and a near-miss worth recording

`auditLogs` has been written to since Module 01 — LOGIN, NEWS_IMPORTED,
CONTENT_GENERATED, POST_PUBLISHED, SETTINGS_CHANGED, WEEKLY_REPORT_GENERATED,
STRATEGY_GENERATED, ANALYTICS_SYNCED, NOTIFICATION_SENT — and nothing has
ever read it back. Module 20 built `automationRuns`' run history
(`listRecentRuns`) but the screen only ever showed the latest run. Only
`publishing/publish.ts` sends a Slack alert on failure; the other eight
automations fail silently unless someone is already looking at the
Automation screen.

Before building anything, the obvious reading of "failure recovery" — a
retry button on a `FAILED` platform post — was checked against
`content/status.ts` and `content/schedule-rules.ts` and found wrong.
`ALLOWED.FAILED = []` in §17's transition table, with its own comment
("nothing is added... a reviewer who approved by mistake needs a decision
from the spec, not a transition from the code"), and
`scheduleRefusal("FAILED")` already answers with *"This post failed to
publish; scheduling it again would hide why."* That is a deliberate
invariant from Module 09/11, not a gap. The correct recovery path for a
failed post — regenerate a fresh version, get it approved, schedule that —
already exists and was not touched.

So "retry handling" and "failure recovery" are scoped here to what §52's
own list is actually about: automation runs, not content status.

## Step 3 — Implementation

### Audit log viewing (§55)

`audit.ts` gained `occurredAt: new Date().toISOString()` alongside the
existing `timestamp: FieldValue.serverTimestamp()` — the same convention
every store in this codebase already follows (a server timestamp is
write-only bookkeeping; nothing reads one back), and the field this
module's screen actually orders and displays by. `listRecentAuditEntries`
reads with a loose `action: z.string()` rather than an enum, so a
historical entry recorded under an action this file has since renamed still
reads back — the audit trail's whole point is that nothing in it goes
missing. `/automation/audit` (a child of the existing Automation nav entry
— §34's ten-item nav has no room for an eleventh top-level entry) is
read-only, gated on `automations:manage`, reading through the Admin SDK;
`firestore.rules` still denies every client read on `auditLogs`, unchanged.

### Run history in the UI (§41, closing a Module 20 gap)

`automation/status.ts`'s `AutomationStatusView` gained `recentRuns` —
`listRecentRuns` already existed; the screen just never used it. The
Automation screen now shows the last five runs per automation behind a
disclosure, in the same normalized shape (Slack's own SENT/FAILED/SKIPPED
alongside every other row's SUCCESS/PARTIAL/FAILURE, never translated into
each other's words).

### Manual re-run — the actual "retry handling" (§52)

`automation/actions.ts`'s `runAutomationNow` dispatches to the *same*
engine function each workflow's webhook already calls — never a second
implementation of "how content generation runs," which would drift the
first time one changed and the other did not. Gated on
`automations:manage`; an unrecognized workflow key is rejected before
anything runs.

One instrumentation gap needed closing first: Scheduling's run recording
lived inside `content/due/route.ts` (a documented exception from Module 20
— `collectDuePosts` is also called internally by Publishing, and
instrumenting it directly would double-count every publish tick as a
scheduling run too). That recording is now `runSchedulingCheck`
(`content/schedule.ts`), shared by the webhook and the manual trigger, so
neither drifts from the other and the route/engine split Module 20 used
everywhere else is restored.

### Slack alerts on any automation failure (§52's "Notify")

`recordAutomationRun` (`automation/store.ts`) now alerts Slack whenever a
run's `status` is `FAILURE`, reusing the same channel and notifier every
other Slack integration here uses. Centralized in the one function every
workflow already calls, so coverage is uniform without touching nine call
sites individually. Publishing is excluded — it already posts a richer,
per-post breakdown on a publish failure via its own `notifyFailures`, and
alerting again here would post the same failure twice. Best-effort: a
Slack outage is logged, never thrown, so it cannot make an automation's own
failure record harder to write — the one thing this addition must never do.

## Step 4 — Tests

`tests/unit/automation-store.test.ts` — the Slack alert: fires on
`FAILURE`, never on `SUCCESS`/`PARTIAL`, excludes Publishing, and never
throws when Slack itself is down. `tests/unit/content-scheduling-check.test.ts`
— `runSchedulingCheck` records SUCCESS/PARTIAL/FAILURE correctly and tags
`WEBHOOK` vs `MANUAL`. `tests/unit/automation-status.test.ts` updated for
`recentRuns` (was written against Module 20's `getLatestRun`-only shape).

## Step 5 — Validate

`typecheck`, `lint`, `test` (506 passed), `build`, and `test:rules` against
the Firebase emulator (37 passed, no rules changed this module) — all clean.

## Step 6 — Security

Reviewed directly: `/automation/audit` reads only through the Admin SDK,
`auditLogs` stays server-only in `firestore.rules`; `runAutomationNow` is
gated on `automations:manage` and only dispatches to a fixed, known set of
workflow keys; the Slack alert reuses existing, already-secret-free error
message conventions. No findings.

### Next

Module 22 — Security & Production Hardening.
