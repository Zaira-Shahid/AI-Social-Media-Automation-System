# Module 18 — Weekly Performance Analysis

Spec sections: §22, §23, §30, §31, §32, §33, §39, §44, §51, §53, §55, §63
(Module 18), §65, §67.

Build: weekly reporting, performance comparison, best/worst content, topic
analysis, platform analysis, format analysis. The roadmap draws a clean line
between this module and Module 19 — "AI Strategy Optimization" — by its own
distinct bullet list (evidence-based analysis, strategy recommendations,
strategy versioning, next-week strategy, automated strategy update). §23's
diagram shows "AI analysis → Recommendations → Next week's strategy" as one
flow, but only the first step — an evidence-grounded narrative describing
what the numbers show — is this module's `analyzePerformance()` (§30).
Anything that changes what gets generated next week is Module 19's
`generateStrategy()`, and nothing here does that.

## Step 1 — Read

§22 (metric vocabulary, never fabricate), §23 (the report's exact content),
§30 (`analyzePerformance()` named as this module's AI function), §31 (Zod
validation of AI output), §32 (storage — `weeklyReports`, not `analytics` or
`strategy_reports`), §39 (Analytics Screen — its nav entry was already
stubbed inert, same as Social Accounts before Module 12), §44/§51
(`09_weekly_performance_analysis`, and the workflow shape: Analytics →
Performance Analysis → Save Report), §53 (idempotent re-runs), §55 (audit),
§65/§67.

## Step 2 — Inspect

| Item | State |
|---|---|
| `analytics` collection (Module 17) | Present — the only source of real metrics this module reads |
| A way to find posts published in a date range | Did not exist — `content/store.ts` had `listPublishedPosts` (Module 17, no range) and `listScheduledPostsBetween` (range, but on `scheduledAt` and no status filter) |
| Topic dimension | `newsItems.category` (free text from RSS feeds), reachable via `contentItems.sourceNewsItemId` |
| Format dimension | `platformPosts.visual.template`, already `VISUAL_TEMPLATES` |
| Analytics Screen (§39) nav entry | Stubbed inert (`{ label: "Analytics", icon: BarChart3 }`, no `href`) |
| `analytics:view` permission | Already in the role matrix (ADMIN, MANAGER), unused until now |
| A stale test found in passing | `tests/rules/firestore.rules.test.ts`'s baseline test used `analytics/any-id` as its example of "a collection no module has opened yet" — true when written, false since Module 17 opened it for signed-in reads. Not caught earlier because `test:rules` needs the Firebase emulator and isn't part of `npm test`. Fixed here (now uses `automationLogs`, genuinely still closed) and re-verified against the emulator |

No external API to verify against — this module is internal aggregation over
data Modules 16/17 already collect, plus one AI call built on the same
`AIProvider`/Zod pattern `content/generate.ts` already uses successfully.
Nothing here needed fresh documentation research.

## Step 3 — Implementation

### The window (§23, §51)

`currentWeekWindow` is the **trailing 7 complete calendar days**, ending at
the start of today in `APP_TIMEZONE` — not a Monday–Sunday calendar week,
which §23 never specifies. This makes the report correct regardless of which
weekday the n8n trigger actually runs on, and never includes a partial
"today" whose analytics have not had a chance to sync yet. The window's
start date is also the report's document id, so a retried run overwrites
rather than duplicates (§53).

### The comparison math is pure (`compare.ts`)

`weekly.ts` does every bit of I/O — Firestore, the AI call — and hands
`compare.ts` plain `AnalyzablePost[]` data. A post whose engagement Module 17
could not measure (`UNAVAILABLE`, mapped to `null` here) is **excluded**,
never scored as zero — averaging it in as zero would understate a platform
that is actually performing fine but under-measured, and §67 forbids
treating "no data" as "zero engagement" no less than it forbids treating "no
data" as a fabricated positive number. The report separately counts
`postsAnalyzed` vs. `postsExcluded` so an incomplete week is visible, not
silently smoothed over.

### The one AI call (`weekly.ts`, `generation-schema.ts`)

`analyzePerformance()` is given only the already-computed comparison
numbers — never raw posts — and asked for a short narrative plus up to six
recommended changes, validated with Zod exactly like every other AI output
in this codebase (§31). Two deliberate refusals:

- **Skipped entirely when nothing was measured** (`postsAnalyzed === 0`) —
  narrating a week with no data would either be empty or invented, and §67
  rules out the second option outright.
- **A failed AI call does not lose the real numbers.** The comparison data is
  still real and worth saving even if the narrative step throws; the report
  is saved with `narrative: null` rather than either failing the whole run
  or writing fabricated prose over a real gap (§52, §67).

### Storage and idempotency

One document per week in `weeklyReports` (§32's list isn't exhaustive, and
this is a distinct concern from Module 19's `strategy_reports`), doc id =
window start date, overwritten on rerun. `firestore.rules` opens it to
signed-in reads and denies every client write.

### The Analytics screen (§39)

`/analytics`, gated on `analytics:view` (already in the role matrix). Shows
§39's list — overall performance, platform comparison, top/weak posts, topic
performance, engagement trend across recent weeks — against the selected
week's report. §39's "date" filter is a week selector, since reports are
already weekly; platform/topic/post are shown as full comparison tables
rather than as further filters, since a week's post count is small enough
that showing everything costs less than hiding rows behind a filter would.
Server component only — everything on the page is read-only, so there is
nothing here that needs client-side interactivity.

## Step 4 — Tests

`tests/unit/reporting-compare.test.ts` — the pure comparison math: measured
vs. unmeasured posts, ranking, group averages, best/weakest-of-one-group.
`tests/unit/reporting-weekly.test.ts` — orchestration with Firestore and the
AI provider replaced: the window calculation, an unmeasured post excluded
rather than scored zero, the AI narrative skipped when nothing was measured,
a failed narrative call still saving the real numbers, and one
`WEEKLY_REPORT_GENERATED` audit entry per run.

## Step 5 — Validate

`typecheck`, `lint`, `test` (480 passed), `build` all clean.
`npm run test:rules` re-run against the Firebase emulator — 37 passed,
including the corrected baseline test and the new `weeklyReports` rule.

## Step 6 — Security

Reviewed directly (see commit): signed webhook identical to every other n8n
trigger; `weeklyReports` denies all client writes; the one new user input
(`?week=`) is only ever compared against already-trusted Firestore document
ids in memory, never concatenated into a query or a doc path; topic/title
strings sourced from RSS content render through React, which escapes them.
No findings.

### Next

Module 19 — AI Strategy Optimization, reading this module's `weeklyReports`
for the evidence its own recommendations must cite (§25), and never
publishing anything without human approval (§10, §24).
