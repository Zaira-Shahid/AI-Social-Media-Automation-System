# Module 11 — Scheduling Engine: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-11-scheduling` (from `develop`).

---

## Step 1 — Read

§17 (transitions), §18 (scheduling: what to store, UTC in and company
timezone out, and the rule that the scheduler must never publish unapproved
content), §32, §33, §37, §44 (n8n's `07_scheduled_publishing`), §48, §49
(publishing workflow), §52, §53 (idempotency and duplicate protection), §54,
§55, §58, §59, §63, §65, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| `scheduledAt` | Declared by Module 10, nullable and UTC; nothing wrote it |
| Transitions | `canTransition` already allowed APPROVED → SCHEDULED and nothing else into it |
| Timezone | `src/lib/time.ts` converted instants to local dates; nothing converted the other way |
| Calendar | Read the field and showed the empty grid Module 10 promised |
| Permissions | `content:schedule` already in §27's table for ADMIN and SOCIAL_MANAGER |
| Indexes | `(status, scheduledAt)` added by Module 10 — exactly what the due query needs |
| Webhooks | Signed n8n triggers existed for ingest, rank, notify, generate and render |

## Step 3 — Plan

### This module schedules. It does not publish.

§63 puts publishing in Module 16, and §49's workflow runs scheduler → verify
approval → verify account → publish. Steps one and two are buildable now;
steps three and four are not. So the n8n tick answers *what is due* and says
plainly that nothing was published. Its response has no `published` field at
all — absent means the capability does not exist, where zero would be a claim
that it ran and found nothing (§67).

### §18's rule, enforced at both ends

"The scheduler must prevent publishing unapproved content." That is checked
twice, deliberately:

1. **Nothing but approved work gets a slot.** `canSchedule` admits APPROVED
   and SCHEDULED, and the status is re-read inside the transaction that writes
   the time.
2. **The due list re-verifies the approval record.** A SCHEDULED status is not
   accepted as proof that somebody approved it — §17 says authorization is read
   from the platform post itself, so `approvedBy` and `approvedAt` are checked
   on each document. Anything due without them is held back and logged as an
   error, because it would mean something wrote this collection outside the
   review path.

SCHEDULED is schedulable because moving a scheduled post to another time is a
correction, not a transition: the status does not change, and a schedule nobody
can fix is a trap. There is no un-schedule — §17 lists no way back out of
SCHEDULED, and inventing one is not this module's call.

### Duplicate protection (§53)

Two posts landing on **the same account** within fifteen minutes reads as a
double post to everyone who sees both, and is nearly always a mistake. So a
slot is refused when another SCHEDULED or PUBLISHED post on that platform sits
inside that window. All three platforms at 09:00 is fine — that is one story
going out everywhere, which is the intended shape of a day here.

The check runs **inside the transaction** that writes the slot, alongside the
status check. Checking beforehand would leave exactly the window §53 exists to
close: two schedulers, or one impatient double-click, both passing a check made
against a state that has since changed. §53's publish-time idempotency is
Module 16's; this stops the mistake being made, not merely repeated.

### Timezone (§54), the other direction

Module 10 converted instants into local dates. Scheduling needs the reverse: a
person picks 09:00 on a date in the company's zone, and the UTC instant they
meant is what gets stored. `instantFromLocalTime` measures the offset twice for
the same reason `startOfDayInTimeZone` does — which is now written in terms of
it, so there is one conversion rather than two.

A wall clock that does not exist (the hour a zone springs forward) resolves to
the following hour rather than throwing. The intent is still served, and
refusing would strand the scheduler on one day a year.

### A horizon, which the spec does not give

Ninety days. A typo in the year would otherwise put a post beyond every
calendar anyone will look at, where it sits as work nobody can see is stuck.
Anything genuinely further out is a plan, not a schedule. This is a judgement,
and it is recorded here as one.

## Implementation record (§64 Steps 4–9)

### Files

- `src/lib/time.ts` — `instantFromLocalTime`, `isClockTime`;
  `startOfDayInTimeZone` now delegates to the former.
- `src/lib/content/schedule-rules.ts` — the horizon, the minimum gap, the time
  check, what may be scheduled, and the conflict search. Pure.
- `src/lib/content/schedule.ts` — `schedulePost` and `collectDuePosts`.
- `src/lib/content/store.ts` — `scheduleAtInstant` (status and conflicts
  re-checked inside one transaction) and `listDuePosts`.
- `src/app/(app)/content/actions.ts` — `schedulePlatformPost`, behind
  `content:schedule`, writing §55's `POST_SCHEDULED` audit record.
- `src/components/content-list.tsx` — §37's Schedule action: a date, a time,
  the zone named on the label, and the scheduled time shown on the card.
- `src/app/api/webhooks/content/due/route.ts` — the signed n8n tick for
  `07_scheduled_publishing`.

### A §54 correction while passing

The review queue rendered `approvedAt` with `toLocaleString()`, which reads the
browser's zone. Two people would see different times for one approval, which is
the confusion §54 exists to prevent. Both timestamps on that card now go
through the configured zone, which the page passes down explicitly.

### What the tests cover

- `tests/unit/content-schedule.test.ts` — 22 cases: the wall-clock-to-UTC
  conversion, past times, the horizon at both edges, which statuses may be
  scheduled and why each refusal reads as it does, the conflict rules
  (same platform collides, different platforms do not, a post never collides
  with itself, exactly the gap is allowed), and both due-list behaviours
  including a scheduled post with no approval record.
- `tests/e2e-auth/webhook.spec.ts` — the tick rejects an unsigned request, and
  a signed one returns `due: 0`, no `published` field, and says publishing is
  Module 16.
- `tests/e2e-auth/news.spec.ts` — a version in review is offered no slot, and a
  post with no slot says so.
- `tests/e2e/smoke.spec.ts` — the tick is unauthenticated-safe.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 338 tests, 26 files (was 316/25) |
| Emulator rules tests | pass — 33 tests |
| Playwright, no credentials | pass — 15 tests (was 14) |
| Playwright, credentialed | pass — 68 tests (was 64) |
| Production build | pass — `/api/webhooks/content/due` added |

### Security and correctness review (§64 Step 7)

- **Authorization.** The action requires `content:schedule` — ADMIN and
  SOCIAL_MANAGER by §27, not MANAGER, who reviews rather than plans. The form
  is hidden from roles without it, but the check that matters is the one in the
  action.
- **Webhook.** HMAC-signed with the same timestamped scheme as every other n8n
  trigger; an unsigned or replayed request is refused, and both are tested.
- **Server-side enforcement (§17, §18).** Status and conflicts are both
  re-checked inside the transaction. `firestore.rules` still denies every
  client write to `platformPosts`, so this path is the only way `scheduledAt`
  or `status` moves.
- **Inputs.** Date and time are validated as a real calendar date and a real
  24-hour clock time before any conversion, and the refusal names which half
  was wrong.
- **Audit (§55).** `POST_SCHEDULED` records the actor and the stored instant.
- **No fake success.** The tick publishes nothing and says so; it omits
  `published` rather than reporting zero; a due post without an approval record
  is withheld and logged as an error rather than passed on.

### Next

Module 12 — Facebook Integration.
