# Module 10 — Social Media Calendar: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-10-calendar` (from `develop`).

---

## Step 1 — Read

§17 (per-platform status), §18 (scheduling: store UTC, display the configured
timezone), §29, §32 (`scheduledAt`, the `(status, scheduledAt)` index), §33,
§34 (navigation), §37, §38 (month, week, day; platform, preview, status,
scheduled time), §54 (timezone), §58, §59, §63, §65, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| `platformPosts` | Module 09 left status, approval and rejection fields; no `scheduledAt` |
| Timezone | `APP_TIMEZONE` exists and `news/selection.ts` already formats the working day from it |
| Navigation | §34's Calendar entry rendered as inert text, waiting for a route |
| Indexes | `firestore.indexes.json` had nothing for `platformPosts` |
| Status badge | Lived inside the review queue's client component, unexported |

## Step 3 — Plan

### This module reads; Module 11 writes

§63 gives schedule management, validation and duplicate protection to Module
11. So `scheduledAt` is **declared** here — it is §32's field, and the calendar
has to read something — but nothing in this module ever sets it. The screen
has no action, no form and no server action at all.

That leaves an honest problem: with nothing scheduled, the grid is empty. It
says so ("Nothing is scheduled in this period"), and beside it lists the
approved versions that have no slot yet — the queue Module 11 will schedule
from, and the thing a calendar exists to surface. §67: an empty grid that
explains itself beats one that looks like a loading failure.

### The timezone is the whole problem

§54: store UTC, display the company's zone, never let browser-local time become
the source of truth. A calendar is where that mistake hides best, because the
grid looks right to whoever built it.

So every conversion goes through [`src/lib/time.ts`](../src/lib/time.ts), the
page is server-rendered, and the browser's zone is never read. `Intl` does the
arithmetic — Node ships a timezone database, and §29 is a reason not to add a
date library for what the platform already knows.

The one genuinely hard function is `startOfDayInTimeZone`: it measures the
zone's offset from a first guess and then again from the corrected instant,
because on the days a zone changes offset the offset at midnight is not the one
that applied to the guess. It is tested on both sides of a daylight-saving
change and on the shortened day itself.

### One grid function, three views

Month, week and day are the same thing — a list of consecutive local dates — so
[`src/lib/calendar/grid.ts`](../src/lib/calendar/grid.ts) builds all three and
they differ only in where the list starts and how long it is. It is pure and
knows nothing about Firestore: what belongs on 12 March in Asia/Karachi is a
question about dates, and answering it inside a query would make it untestable.

Weeks start on Monday. The spec does not say; the team's working week does.

The month view returns whole weeks so the grid is rectangular, and marks the
days either side of the month as adjacent rather than hiding them — a post on
the 1st is not less relevant for falling on a Thursday.

### State lives in the URL

View, period and both filters are query parameters, and every control is a
link. A calendar view nobody can send to a colleague is half a calendar. An
unrecognised parameter is dropped rather than refused: it arrives from a URL
someone edited or a link that outlived a rename, and the honest answer to a
filter nobody recognises is the unfiltered calendar.

### Queries and the index

- `listScheduledPostsBetween` — a range on `scheduledAt` ordered by the same
  field, so it needs no composite index.
- `listApprovedUnscheduledPosts` — two equality filters, which does need one.
  That is §32's `(status, scheduledAt)` index, now in
  `firestore.indexes.json`.

Platform and status filters are applied in memory. A calendar window is already
a small result set, and an index per filter combination would not earn its
keep.

## Implementation record (§64 Steps 4–9)

### Files

- `src/lib/time.ts` — §54 in one place: the local date and wall clock of an
  instant, the instant a local day begins and ends, whole-day arithmetic, date
  validation.
- `src/lib/calendar/grid.ts` — views, ranges, period shifting, bucketing posts
  by local day, labels. Pure.
- `src/lib/content/store.ts` — the two calendar queries and
  `getContentItemsByIds`, so a screen that starts from posts can show the story
  each belongs to.
- `src/app/(app)/calendar/page.tsx` — the route, server-rendered.
- `src/components/calendar-screen.tsx` — the grid, the filters, the post chips,
  the waiting list.
- `src/components/post-status-badge.tsx` — the status badge extracted from the
  review queue, so one status never has two appearances.
- `src/lib/content/schema.ts` — `scheduledAt`, nullable, UTC.
- `src/lib/news/selection.ts` — `selectionDateFor` now delegates to
  `dateInTimeZone` rather than keeping a second copy of the same `Intl` call.

### What the tests cover

- `tests/unit/calendar-grid.test.ts` — 37 cases. The timezone conversions
  (including a daylight-saving weekend), the three view shapes, a month that
  starts on a Sunday, a month that spills into a sixth week, period shifting
  that clamps 31 January to the end of February rather than skipping a month,
  and bucketing by the company's day rather than UTC's.
- `tests/e2e-auth/calendar.spec.ts` — the navigation entry, the three views and
  their headings, the period controls, a filter surviving in the URL, an
  unusable date falling back to today, the timezone note, and both empty
  states.
- `tests/e2e/smoke.spec.ts` — `/calendar` redirects to login without a session.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 316 tests, 25 files (was 279/24) |
| Emulator rules tests | pass — 33 tests |
| Playwright, no credentials | pass — 14 tests (was 13) |
| Playwright, credentialed | pass — 64 tests (was 54) |
| Production build | pass — `/calendar` added |

### Security and correctness review (§64 Step 7)

- **Authorization.** The page calls `requirePermission("content:view")` itself;
  the navigation entry is hidden from roles without it, and the smoke test
  proves an unauthenticated request lands on `/login?next=%2Fcalendar`.
- **Nothing to write.** The module has no server action and no mutation path,
  so there is no transition for it to bypass (§17).
- **Inputs.** View, date, platform and status are each parsed — the two enums
  through their Zod schemas, the date through a real-date check — and an
  unusable value falls back rather than throwing.
- **Database access.** Admin SDK only, behind the page's own check, as §33
  requires. `firestore.rules` is unchanged: clients still cannot write
  `platformPosts`, and `scheduledAt` is covered by that same denial.
- **§54.** No browser-local time anywhere. The screen names the timezone it
  rendered in, so a wrong `APP_TIMEZONE` is visible rather than silent.
- **§67.** An empty period says it is empty; a post with no rendered card says
  "No card" instead of showing an empty frame; the screen states plainly that
  scheduling is not this module.

### Next

Module 11 — Scheduling Engine, which fills in `scheduledAt`.
