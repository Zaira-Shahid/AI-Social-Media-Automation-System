# Module 06 — Human News Selection: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-06-selection` (from `develop`).

---

## Step 1 — Read

§6 (item shape), §8 (the shortlist and "the human chooses 3"), §10 (human
control), §27 (roles), §31, §32 (`selected_news`), §33, §36 (the news screen),
§46 (the selection workflow), §52, §54 (timezone), §55, §58, §59, §63, §65,
§66, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| `newsItemStatusSchema` | `DISCOVERED / RANKED / SHORTLISTED / REJECTED` — no `SELECTED` |
| `/news` screen | Read-only list from Module 04; §36's search, filters, detail and selection state all deferred to here |
| `selected_news` | Named in §32's entity list; never created |
| Permissions | No permission covered choosing stories |
| Module 07 | Does not exist. What §46's "trigger content generation" can honestly mean is the module's central question |
| `NEWS_SELECTED` | Already in `AuditAction` from §55 |

## Step 3 — Plan

### Who selects (§27)

§27 lists roles, not every action, and does not name this one. Choosing the
day's three stories decides what the company talks about, so it went to the
roles that already run the pipeline — **ADMIN and MANAGER**, the same pair that
holds `automations:manage`. SOCIAL_MANAGER writes, edits and approves content
but does not set the agenda. The owner confirmed this reading.

A new explicit `news:select` permission, rather than reusing `content:edit`:
reusing a permission that means something else would make the matrix lie.

### What a human may choose from

`SHORTLISTED` **and** `RANKED`. §8 asks the AI to shortlist and a human to
choose, and a human who can only ratify the shortlist is not choosing (§10).
`REJECTED` is never selectable — each was ruled out with a stated reason — and
`DISCOVERED` is not either, because it has never been scored.

### Exactly three

Enforced in the Zod schema, so the server action and any later caller get the
same answer. Two checks, not one: the length, **and** that the three ids are
different. A length test alone would accept the same story three times and
produce a day with one story in it.

A wrong count is refused with a message, never trimmed or padded into shape —
a selection that is quietly corrected is not a human decision (§10).

### The selection document (§32, §46)

`selectedNews/{id}` — one live document per working day:

```text
selectionDate   YYYY-MM-DD in APP_TIMEZONE (§54)
storyIds        exactly 3, all different
selectedBy      uid
selectedAt      ISO timestamp
status          PENDING_GENERATION | GENERATED | SUPERSEDED
supersededBy    id of the selection that replaced this one, or null
```

The day is the team's day, not UTC's. An evening selection in Asia/Karachi
would otherwise land on the previous date for everyone reading the history.

Re-selecting **supersedes** rather than overwrites. Who chose what, and when
they changed their mind, is exactly what an audit trail is for (§55).

### One transaction

A half-applied selection is worse than none: three stories marked `SELECTED`
with no selection document look like a choice nobody made, and a selection
document whose stories were never marked is invisible on the screen. Both the
document and the item statuses move in a single Firestore transaction, with
statuses re-read inside it so two people selecting at once cannot interleave
into a state with four selected stories.

Deselected stories revert to `statusBeforeSelection`, recorded on the way in.
Guessing at a default would quietly rewrite Module 04's result.

### "Trigger content workflow" — what it can honestly mean today

§63 lists it, and Module 07 does not exist. So the selection is written at
`PENDING_GENERATION` and stops there. Nothing is called, and the screen says
plainly that content generation is not built yet.

The alternative — calling a generator that does not exist, or writing a state
that claims one ran — is exactly what §65 and §67 forbid. The outbound trigger
belongs to Module 07, with the thing it triggers.

### The screen (§36)

All nine of §36's items: list, source, publication date, category, relevance,
selection state, search, filters, article detail. Filters are a plain GET form,
so a filtered view is a URL that survives a reload and can be shared.

---

## Implementation record (§64 Steps 4–9)

### Two constraints worth recording

**Firestore has no full-text search.** Search and category filtering happen in
memory over a capped page of 120 scored items. The honest alternatives were an
in-memory filter over a bounded fetch or a second search service; §29 rules out
the second, and the cap is what keeps the first from becoming a
full-collection scan.

**Rejected stories are hidden by default.** They are kept for the record (§7),
not to be scrolled past daily. The status filter surfaces them on request.

### Restructuring

`news-shortlist.tsx` became two components. `news-screen.tsx` is about which
stories to publish; `news-automation-controls.tsx` is about whether the
pipeline that produced them has run. They were one component only because
Module 04 had nothing else to put on the page.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 188 tests, 17 files (was 174/16) |
| Emulator rules tests | pass — 29 tests (was 26) |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 38 tests (was 32) |
| Production build | pass — `/news/[id]` added |

The credentialed run selects three stories end to end, asserts the save button
stays disabled at one and at two, and asserts the screen says content
generation is **not** built yet rather than implying a pipeline started.

### Security and correctness review (§64 Step 7)

- **Authorization.** `news:select` is re-checked inside the server action, not
  merely used to hide the checkboxes.
- **No trust in the client.** The posted ids are re-validated for count,
  uniqueness, existence and status. The on-screen counter is a convenience.
- **Rules.** `selectedNews` is readable by signed-in users and writable by no
  client at any role (§33) — a client write would bypass the validation and
  leave item statuses adrift.
- **Atomicity.** Document and statuses move together, with reads inside the
  transaction.
- **No fake success.** The confirmation says a selection was recorded and that
  content generation does not exist yet.
- **Locking.** A selection already used for generation cannot be repointed,
  which would leave generated content attributed to stories nobody chose.

### Note for Module 07

`selectedNews` documents at `PENDING_GENERATION` are the handoff point. Module
07 owns the transition to `GENERATED`, and owns whatever outbound call starts
generation — including n8n's `04_news_selection_processing`.

### Next

Module 07 — AI Content Generation.
