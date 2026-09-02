# Module 07 — AI Content Generation: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-07-content-generation` (from `develop`).

---

## Step 1 — Read

§10 (human control), §11 (brand intelligence), §12 (content generation), §13
(platform adaptation), §14 (static content and the image sourcing rule), §15
(static post generation), §16, §17 (per-platform status), §21, §27, §29, §30,
§31, §32 (`contentItems` / `platformPosts` layout), §33, §37, §44, §47, §52,
§55, §58, §59, §63, §65, §66, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| AI abstraction | Module 04's `AIProvider` + factory + deterministic mock, ready to carry two more contracts |
| Mock provider | Knew one schema (ranking) and sniffed the prompt to recognise it |
| Brand profile | Module 02's central profile, with `isBrandConfigured` |
| Selection | Module 06 leaves `selectedNews` at `PENDING_GENERATION` and owns nothing after that |
| Content collections | None. §32 fixes their shape; nothing had created them |
| `/content` | A nav label with no destination |
| Platform limits | Nowhere in the codebase |

## Step 3 — Plan

### Verified platform limits (§65)

Checked against the platforms' own documentation on 2026-09-01, because a
caption that is too long fails at publish time — the worst place to find out:

| Platform | Limit | Source |
|---|---|---|
| Instagram | 2,200 characters, max 30 hashtags | Meta developer documentation |
| LinkedIn | 3,000 characters for a UGC post's commentary | LinkedIn UGC Post API, on Microsoft Learn |
| Facebook | **not verified** | An internal editorial cap of 2,000 is used instead, and labelled as ours in code |

Meta also publishes a limit of 100 API posts per 24 hours for Instagram, which
belongs to Module 11's scheduler rather than here.

### Two calls per story, not four

§12's flow is: core message → platform versions → visual concept. It ships as
**two** provider calls: one for the core message, one that returns all three
platform versions with their visual concept attached.

The visual concept is not a third call because §13 lists "visual treatment"
among the things adapted **per platform** — a card's words and its treatment
are one decision per platform, not a separate pass. Two calls per story also
keeps a three-story day inside Groq's free-plan budget (§29), which is 8,000
tokens a minute.

### What is core and what is per-platform

Decided once, shared: headline, key takeaway, body, source reference, angle.
Adapted per platform: caption, CTA, hashtags, visual concept. §11 forbids
duplicating the brand identity per platform, and the same logic applies to the
story's substance — the angle is decided once and adapted after.

### §14, enforced rather than documented

§14 says in as many words that the image sourcing rule "must be enforced as a
validation rule in code". Two defences:

1. **The article's `imageUrl` never enters a prompt.** A model cannot echo back
   a URL it was never given, and the visual concept has no field to put one in.
2. **Any URL in a visual concept is rejected**, wherever it came from. The case
   this catches is the model inventing a plausible image URL on its own.

Both are tested, including the invented-URL case.

### Per-platform independence (§17)

A platform whose version fails validation fails **alone**. A caption too long
for Instagram is not a reason to withhold the LinkedIn post that is fine, and
§17 gives every platform its own status precisely so a weak version cannot
block the others.

Nothing is silently truncated. An over-long caption is refused with a reason,
because a machine-trimmed caption can lose its call to action and still look
finished (§67).

### Hashtags: repaired, not refused

The brand's hashtag rules are the brand's own, so the correct answer is
knowable: drop banned tags, add required ones, dedupe, cap at the stricter of
the brand's maximum and the platform ceiling. Required tags are ordered first
so a tight cap never drops the ones the brand insists on. Hashtags count
against the caption limit, because they publish as part of it.

### Versioning and regeneration (§63)

Every generated version is written to `contentVersions` and never modified.
Regeneration asks only for the platform being rewritten, reusing the stored
core message — a rewrite of one caption must not quietly change what the story
is about, or what the other platforms say.

Regeneration is refused once a post is APPROVED, SCHEDULED or PUBLISHED.
Replacing the text under an approval would make it a record of something
nobody agreed to (§10, §55). Status is never touched by a rewrite.

### Where it stops

`IN_REVIEW`, which is exactly where §47's diagram ends. Nothing here approves,
schedules or publishes — §10 keeps all three with a human, and §16's preview
and §37's queue are Module 09.

---

## Implementation record (§64 Steps 4–9)

### A design correction the tests forced

The first end-to-end run refused to generate: `isBrandConfigured` required a
logo, and the emulator profile has none.

The right fix was not to relax the test but to split the gate. **Text
generation never touches the logo** — it is the static card renderer (Module
08) that cannot work without one. `isBrandReadyForWriting` now gates writing on
company name, tone of voice and audience; `isBrandConfigured` keeps the logo
and is what the brand screen reports. Gating a draft on an asset the draft does
not use was refusing for the wrong reason.

### A bug the tests found

One version for an unrequested platform failed the **entire** response, because
the array was parsed as a whole. A model that adds a fourth platform should cost
us that entry, not the three it got right. Entries are now validated one at a
time; the strict array schema remains as the statement of the contract and is
what the mock provider is held to.

### The mock provider now dispatches on `schemaName`

It previously recognised the ranking contract by sniffing the prompt. With
three contracts that would break the moment two prompts looked alike, so it
keys off the name the caller already supplies — and throws for a schema it has
no answer for, rather than returning a shape the caller will misread.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 227 tests, 20 files (was 188/17) |
| Emulator rules tests | pass — 33 tests (was 29) |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 44 tests (was 38) |
| Production build | pass — `/content` and the generation webhook added |

The credentialed run generates for all three selected stories, asserts nine
platform posts land IN_REVIEW, asserts the copy is labelled simulated, asserts
a second run does not duplicate, and asserts a SOCIAL_MANAGER can regenerate
but cannot start a run.

**One thing worth watching.** During two intermediate runs — while the brand
gate above was still failing and holding a worker for 30 seconds — unrelated
auth assertions in `brand.spec` and `login.spec` failed intermittently. Both
runs after the fix were clean, so this was not reproduced and not chased. If it
returns, the emulator's behaviour under `fullyParallel` workers is the place to
look.

### Note on run logging

Generation does not write an `automationRuns` record. That schema's fields —
`sourcesAttempted`, `itemsDiscovered` — describe news discovery, and forcing
content generation into them would make the operational history read falsely.
Module 20's control centre should generalise the record; until then the content
items and the audit log are the trail.

### Security and correctness review (§64 Step 7)

- **Authorization.** A generation run sits under `automations:manage`;
  regeneration under `content:regenerate`, which §27 gives SOCIAL_MANAGER
  explicitly. Both are re-checked inside the action.
- **Rules.** `contentItems`, `platformPosts` and `contentVersions` are readable
  by signed-in users and writable by no client at any role. §17 forbids a client
  writing `status`; the same reasoning covers the copy, and both are tested.
- **§14.** Enforced twice and tested, including an invented URL.
- **No fake success.** `mediaUrl` is explicitly null and the screen says the
  renderer is Module 08; a failed platform is reported with its reason; a run
  that generated nothing is not reported as partial.
- **Mode is persisted.** Every content item and version records whether a real
  provider wrote it.
- **Idempotence.** A retry skips stories already generated for the selection,
  and the selection is locked only once content actually exists.
- **Quota.** Two calls per story, paced from Groq's published limits (§29).

### Next

Module 08 — Static Post Generator.
