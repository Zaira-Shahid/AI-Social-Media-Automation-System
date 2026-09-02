# Module 16 — Publishing Engine

Spec sections: §17, §18, §19, §20, §21, §32, §42, §44, §49, §52, §53, §55,
§63 (Module 16), §66, §67.

This is the module where the chain finally joins up. Modules 12–14 built three
adapters against one contract and **nothing called any of them**; the scheduler
tick answered "what is due" and then stopped, saying so in as many words. This
module is the missing middle: it decides whether a post may publish, asks the
right adapter, and writes the platform's answer back onto the post.

Module 15 is retired (§63) and was not built.

## What was already true

§20 and §63 both required the adapter interface to exist **before** Modules
12–14, and it did — `src/lib/publishing/adapter.ts` has been the contract since
Module 12. So this module wrote no adapter code and changed no adapter. That is
the payoff for building the interface first: three platforms, one orchestrator,
and nothing here knows what a Graph call or a LinkedIn URN looks like.

What did **not** exist was anywhere to put a publish result. §32's
`platformPosts` schema lists `platformPostId` — "returned by the platform after
publishing" — and the document had no such field, because nothing had ever
published.

## The one deliberate naming departure

§32 calls the stored field `platformPostId`. It is stored here as
**`providerPostId`**.

A `platformPosts/{platformPostId}` document holding a *different*
`platformPostId` is a trap: every existing call site in this codebase already
uses that word for our own Firestore document id — `getPlatformPost(id)`,
`publishOne`'s `platformPostId`, the whole review path. A field of the same
name meaning "LinkedIn's id" would be misread by the first person to touch it.

`adapter.ts` has said `providerPostId` since Module 12, so this matches the
name the value actually arrives under. The departure is from §32's spelling
only — the field is present, holds exactly what §32 says it holds, and is the
idempotency key §53 requires.

## What was built

### Schema — `src/lib/content/schema.ts`

Six fields added to `platformPostSchema`, all defaulted so posts written before
this module parse without a migration (Firestore has no DDL; §32 says so):

| Field | Why |
|---|---|
| `providerPostId` | §53's idempotency key. Non-null means the platform confirmed a post. |
| `permalink` | A link a human can open, where the platform returns one. |
| `publishedAt` | When the platform confirmed it, UTC (§54). |
| `publishMode` | REAL or MOCK, recorded **on the post** (§21, §66). |
| `publishAttempts` | Bounded retries (§52). |
| `publishStartedAt` | The claim lease — see below. |

`publishMode` is stored rather than derived from the current provider setting
on purpose. A post published while `FACEBOOK_PROVIDER=mock` stays MOCK forever;
flipping the switch later must not retitle history as real (§67).

### The claim — `claimForPublish()` in `src/lib/content/store.ts`

§53 lists four checks before publishing: approval, scheduled state, previous
attempt, platform post id. All four happen **inside one Firestore
transaction**, not in the engine, because the gap between "collect what is due"
and "publish it" is exactly where a second tick, a reviewer, or an n8n retry
lands. Checking them in the engine as well would be two implementations of one
rule, and the weaker one would be the one that mattered.

Order matters. `providerPostId` is checked *first*: a post the platform has
already confirmed is never published again, whatever else is true of it. That
single check is what makes a retry safe. Everything after it — SCHEDULED, an
approval record, a rendered card, the attempt ceiling — is about whether
publishing may *start*.

Approval is read from the platform post document alone. §32 is explicit that
the publishing engine must never infer it from the parent content item.

**The lease.** `publishStartedAt` holds a 10-minute claim so two overlapping
ticks cannot both call the platform for one post. It is a lease, not a status:
§17's transition table is fixed, and inventing a `PUBLISHING` state is not this
module's to do. It is also honestly a *duplicate-suppression window* rather
than a guarantee — a lock the platform knows nothing about cannot be one —
which is precisely why `providerPostId` is the real defence and is checked
first.

### The engine — `src/lib/publishing/publish.ts`

`publishOne()` runs §49 for a single post: claim → verify social account →
publish → verify response → store the id → PUBLISHED. `runDuePublishing()`
walks the due list.

- **The due list is not re-queried here.** It comes from
  `collectDuePosts()`, so "what is due" has one definition and §18's approval
  filter stays owned by the scheduler.
- **Posts publish one at a time.** Every platform rate-limits; nine sequential
  publishes cost seconds, nine concurrent ones are how a run trips a limit it
  never needed to meet.
- **`composeMessage()`** assembles caption → CTA → hashtags. The adapter
  contract takes a finished caption — an adapter formats for its own API and
  never composes content — so assembly happens once here rather than in three
  near-identical string builders that drift. Hashtags are stored bare and get
  their `#` here; a caption reading "automation ai" would be a silent content
  bug nobody notices until it is live.
- **`SKIPPED` is not a failure.** Already published, someone else holds the
  claim, or the post stopped being eligible — none of those are errors and none
  are written to the post as one.

### Failure handling (§52)

`Detect → Log → Retry when safe → Notify → Correct status`, with "when safe"
taken from the adapter's own `retryable` flag:

- **Retryable** (rate limit, 5xx, network) — the post stays SCHEDULED and the
  next tick tries again. `lastError` is still written: a post that silently
  reverts to SCHEDULED with no explanation is exactly the silent failure §52
  forbids.
- **Not retryable** (rejected token, refused image, missing account) — FAILED
  immediately. Retrying would burn quota and hide the real problem.
- **Attempts spent** — FAILED, with `(gave up after N attempts)` appended.
  A retryable failure on the final attempt is still terminal: leaving it
  SCHEDULED would park it in a state the engine has already refused to act on,
  which reads as "waiting" to anyone looking at the calendar (§67).
- **An adapter that throws** is treated as retryable, not terminal. A throw
  means the post's real state is *unknown*, and `providerPostId` is what stops
  that retry duplicating a post that did land.

**Notify** is Slack, terminal failures only. A retryable failure the next tick
will clear is not something anyone must act on, and a channel reporting every
transient rate limit is one people stop reading. Unlike the token alert, a
Slack failure here is logged and swallowed — the posts really did fail, that is
already recorded on each one, and throwing would replace an accurate partial
result with no result at all.

### The webhook — `src/app/api/webhooks/content/publish/route.ts`

A signed n8n tick (§44), like every other trigger here. Kept as its own
endpoint rather than folded into `content/due` so that asking what is due stays
a question with no side effects — which is exactly what an operator wants when
a publish has gone wrong. `content/due` keeps its contract and now points at
this endpoint instead of saying "Publishing is Module 16".

### Tests (§58)

- `tests/unit/publishing-engine.test.ts` — 19 tests: caption assembly and its
  edge cases; a publish recording the platform's id; a mock publish stored as
  MOCK; the audit entry carrying the provider id and no token; an
  already-published post skipped without the adapter being called; a held claim
  skipped without recording an error; missing credentials failing terminally
  without calling the adapter; retryable left scheduled; non-retryable failed;
  attempts spent turning retryable into terminal; a throwing adapter treated as
  retryable; the exact request handed to the adapter; run-level counts;
  Slack silence when nothing failed; and a Slack refusal never reported as an
  alert that happened.
- `tests/e2e-auth/webhook.spec.ts` — the publish tick rejects an unsigned
  request, and with nothing due reports zero rather than absent.
- `tests/e2e/smoke.spec.ts` — the same unsigned rejection, credential-free.

No test contacts a platform. The adapters, Firestore, the credential store and
Slack are all replaced in the unit tests, and `playwright.config.ts` forces
every provider to mock for the e2e runs.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 437 tests, 32 files (was 418/31) |
| Emulator rules tests | pass — 37 tests |
| Playwright, no credentials | pass |
| Playwright, credentialed | pass |
| Production build | pass — `/api/webhooks/content/publish` added |

### Security and correctness review (§64 Step 7)

- **Secrets.** The access token is fetched per publish, handed to the adapter,
  and never logged, audited, returned in the webhook response, or written to
  the post. Two tests assert a token cannot appear in an audit entry or in the
  Slack message.
- **Authorization.** The endpoint is HMAC-signed like every other n8n trigger
  and rejects an unsigned request with 401. Publishing is not reachable from
  any user-facing action.
- **Approval (§17, §18, §32).** Read from the platform post document alone,
  inside the transaction, never from the parent content item.
- **Idempotency (§53).** All four checks are transactional, `providerPostId`
  is checked first, and the claim lease narrows the window in which two ticks
  could overlap.
- **Audit (§55).** `POST_PUBLISHED` and `POST_FAILED`, actor
  `system:publishing`, with the provider id and the reason — never the token.
- **No fake success (§67).** A post reaches PUBLISHED only when an adapter
  returns an id, and the id is written in the same merge as the status, so
  PUBLISHED without proof is not a state the document can hold.
- **Rules (§33).** No new collection, and `platformPosts` already denies every
  client write. The new fields are Admin-SDK-only like the rest of the
  document.

### Open items for the owner

1. **n8n must call the new endpoint.** `07_scheduled_publishing` currently
   calls `content/due` only. It needs a second signed call to
   `content/publish` after it, on the same schedule.
2. **Everything publishes to mock until a provider is switched on.** All three
   `*_PROVIDER` variables default to mock, so a full run today produces
   `publishMode: "MOCK"` and reaches nothing. That is the §21 default, not a
   bug — but a first real publish needs the Meta and LinkedIn credentials
   Modules 12–14 are still waiting on.
3. **A post that fails terminally is not rescheduled automatically.** It goes
   FAILED with a reason, and §17 has no transition out of FAILED. Someone has
   to regenerate or re-create it. That is §17's decision, not this module's,
   and the Slack alert exists so it is noticed the same day.

### Next

Module 17 — Analytics Collection. `providerPostId` is what it will read to ask
each platform how a post performed, and Module −1's finding still stands: §22's
realistic coverage is Facebook and Instagram only, because LinkedIn's
`r_member_social` is a closed permission. A `publishMode` of MOCK is also the
signal that a post has no real analytics to fetch.
