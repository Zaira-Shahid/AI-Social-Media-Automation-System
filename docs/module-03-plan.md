# Module 03 — News Source Management: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-08-31.
**Branch:** `feature/module-03-news` (from `develop`).

---

## Step 1 — Read

§4 (topic direction), §5 (discovery, and the rule against inventing sources),
§6 (normalization and the `newsItems` shape), §7 (what the quality filter will
later reject), §14 (the image sourcing rule), §21 (mock mode), §27 (roles),
§31–§33, §36 (news screen), §41 (automation control centre), §44–§45 (n8n
orchestration), §52 (error handling), §53 (idempotency), §54 (timezone), §55,
§58, §63.

## Step 2 — Inspect

| Item | State |
|---|---|
| News code | None |
| Collections in use | `profiles`, `auditLogs`, `companySettings`, `brandSettings` |
| `firestore.indexes.json` | Empty — no composite index has been needed yet |
| Server mutation pattern | Server actions (Module 02); route handlers only where something external calls in |
| `N8N_WEBHOOK_SECRET` | In the environment since Module 00, unused — this module is where §44 said it would first be needed |
| Navigation | §34 items, `Brand` linked, the rest inert |
| Permissions | Module 01's matrix, no news-related entry |

## Step 3 — Plan

### Scope

§63's seven items: the source database, its management UI, activation,
priority, health, the RSS ingestion foundation, and normalization.

**Not** in scope, and deliberately so: AI scoring and ranking (§7 is Module
04 — `relevanceScore`, `credibilityScore`, `socialPotentialScore` and
`aiAnalysis` are left absent rather than written as zeroes, because a zero
would be indistinguishable from a real low score), the Slack shortlist
(Module 05), human selection (Module 06), and the §36 news screen.

### 3.1 Verified sources (§5)

§5 forbids inventing a feed URL and requires availability to be verified
before implementation. Every candidate was fetched before being written down.
Checked 2026-08-31:

| Source | Feed | Result |
|---|---|---|
| TechCrunch AI | `techcrunch.com/category/artificial-intelligence/feed/` | 200, RSS, 19 items |
| VentureBeat AI | `venturebeat.com/category/ai/feed/` | 200, RSS, 7 items |
| The Verge | `theverge.com/rss/index.xml` | 200, Atom, 10 items |
| WIRED AI | `wired.com/feed/tag/ai/latest/rss` | 200, RSS, 10 items |
| MIT News — AI | `news.mit.edu/rss/topic/artificial-intelligence2` | 200, RSS, 50 items |
| OpenAI | `openai.com/blog/rss.xml` | 200, RSS |
| Google — AI | `blog.google/technology/ai/rss/` | 200, RSS, 20 items |
| Google DeepMind | `deepmind.google/blog/rss.xml` | 200, RSS, 100 items |
| Hugging Face | `huggingface.co/blog/feed.xml` | 200, RSS |
| ~~Ars Technica~~ | `arstechnica.com/feed/` | **403** — excluded |

Ars Technica is excluded rather than shipped and left to fail. A source that
is known not to work is not a source.

These ship as an **optional seed script**, not as rows written on first boot.
Which publications a company follows is an editorial decision, and §4's topic
direction is guidance for discovery, not a fixed list to bake in.

### 3.2 Documents

```text
newsSources/{sourceId}
  name  feedUrl  homepageUrl  category
  priority   number   1 (highest) .. 5
  active     boolean
  health     map { status, lastCheckedAt, lastSuccessAt, lastError,
                   consecutiveFailures, lastItemCount }
  createdAt  updatedAt  updatedBy

newsItems/{newsItemId}          # §6's shape
  title  summary  sourceName  sourceUrl  publishedAt  retrievedAt
  category  imageUrl  duplicateGroup  status  sourceId
```

**Document ID is derived, not random.** `newsItems` IDs are a SHA-256 of the
canonical article URL. Re-running ingestion then overwrites the same document
instead of creating a second copy, which makes the whole pipeline safely
re-runnable — §53 demands that of publishing, and it costs nothing to have it
here, where n8n will be re-triggering a schedule that may overlap or retry.

`duplicateGroup` is a hash of the normalized title, so the same story from
three publications lands in one group. Module 04 decides what to do about it;
this module only makes the grouping available.

`imageUrl` is captured because §6 lists it, and it is **reference only** —
§14 forbids it ever reaching the post generator, as a legal matter rather
than a stylistic one. The field carries that warning at its definition, and
enforcement belongs with the generator in Module 08.

### 3.3 Indexes (§32 step 6)

`firestore.indexes.json` gains what the queries actually need:

- `newsItems (status ASC, publishedAt DESC)` — the discovery queue
- `newsItems (duplicateGroup ASC, publishedAt DESC)` — dedupe inspection
- `newsSources (active ASC, priority ASC)` — the ingestion run's own query

Declared now rather than discovered later as a failed query in production.

### 3.4 Ingestion foundation

`rss-parser` handles both RSS and Atom and normalizes dates to `isoDate`;
verified against three of the feeds above before being adopted.

A run: read active sources by priority → fetch each → normalize → validate →
upsert by derived ID → update that source's health → write one
`automationRuns` record. §45 requires every run to be logged.

Failures are per-source, not per-run (§52): one dead feed marks that source
`FAILING` and the run continues. A run only fails if it could not read the
source list at all.

**Sources are never auto-deactivated.** A feed that silently switches itself
off is a story that stops appearing with nobody noticing; a source shown in
red is one somebody fixes.

### 3.5 Trigger

Two ways in:

- **`POST /api/webhooks/news/ingest`** for n8n (§44), authenticated with an
  HMAC signature over a timestamp and the raw body using `N8N_WEBHOOK_SECRET`.
  Compared in constant time, with a replay window, because a bare shared
  secret in a header is only as good as every log that header passes through.
- **A "Fetch now" button** for an ADMIN, so the thing can be exercised before
  any n8n workflow exists.

### 3.6 Permissions

A new `sources:manage`, ADMIN only. §27's matrix is described as an example
and is meant to be explicit, so a new capability gets its own entry rather
than being smuggled in under `integrations:manage`, which §19 and §42 use for
social platform connections.

### 3.7 Rules (§33)

- `newsSources` — signed-in read, no client write.
- `newsItems` — signed-in read, no client write. Later modules set `status`
  server-side; §33 forbids clients writing status anywhere.
- `automationRuns` — denied outright, both directions. Server-only (§33).

### 3.8 Screen

`/news/sources`, gated on `sources:manage`. Add, edit, activate, prioritise,
delete, and a health column showing last check, last success and last error.
Nested under §34's `News` entry rather than invented as a new top-level item.

### 3.9 Tests

- **Unit** — normalization (RSS and Atom entry shapes, HTML stripping, missing
  dates, relative URLs, ID derivation stability, duplicate grouping), source
  schema, and HMAC verification including a wrong signature, a stale
  timestamp, and a body altered after signing.
- **Rules** — read allowed signed-in, denied unauthenticated, writes denied
  for every role, `automationRuns` denied entirely.
- **E2E** — ADMIN can add and deactivate a source; SOCIAL_MANAGER is refused;
  the webhook rejects an unsigned request.

Tests parse fixture XML, never live feeds — §58 keeps tests off the network.

---

## Implementation record (§64 Steps 4–9)

### Two real bugs the tests caught

**The proxy was redirecting webhooks to the login page.** Its matcher excluded
`/api/health` and `/api/auth` by name, so `/api/webhooks/news/ingest` was
treated as a page: n8n, which has no session cookie, would have been answered
with an HTML login redirect instead of running discovery. The matcher now
excludes `/api` entirely. That is the correct rule rather than a patch — this
proxy answers a missing cookie with a redirect to HTML, which is the wrong
answer for every API client, and §33 already requires server routes to
authorize themselves.

**Row buttons did nothing.** Base UI's `Button` does not default to
`type="submit"`, so Deactivate, Delete and Fetch rendered correctly inside
their forms and silently did nothing when clicked. Only the save button worked,
because it had `type="submit"` written out. `PendingButton` now defaults the
type explicitly.

Both were invisible without a browser-level test, which is the argument for
having them.

### Deviations from the plan

| Plan | What shipped | Why |
|---|---|---|
| Row actions return a message | Messages are now rendered per row | They were being discarded, so a failed fetch looked exactly like a successful one. §52: never silently fail. |
| — | `playwright.config.ts` loads `.env.local` | The webhook test has to sign the way n8n does, and Playwright is a separate process from Next — it was signing with an empty secret and failing for a reason unrelated to the code. Emulator hosts from `emulators:exec` are restored afterwards so the file cannot override them. |
| — | The Module 00 baseline rules tests moved to `contentItems` | They asserted that an authenticated client could not read `newsItems`, which stopped being a statement about the default-deny wildcard the moment this module opened that collection. They now use a collection no module has opened. |

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 103 tests, 9 files (was 52) |
| Emulator rules tests | pass — 25 tests (was 20) |
| Playwright, no credentials | pass — 11 tests |
| Playwright, credentialed | pass — 21 tests |
| Production build | pass — `/news/sources` and the webhook added |

The credentialed run includes a correctly signed webhook request that performs
a real discovery run against an empty source list — so the signature, the run
and the response are exercised without touching the network.

### Security review (§64 Step 7)

- **Webhook.** HMAC-SHA256 over `timestamp.body`, compared in constant time,
  with a five-minute window enforced in both directions so a captured request
  cannot be replayed indefinitely. The body is read as raw text, because the
  signature covers the exact bytes sent. Rejections return a bare 401; the
  reason goes only to the log.
- **Authorization.** Every source action re-checks `sources:manage`, ADMIN
  only. Rules allow signed-in reads of sources and items and no client writes
  at any role, so a client cannot set an item's `status` (§33).
- **Fetching.** Feed URLs are validated as `http(s)` before storage — Zod's
  `.url()` alone would accept `file:` and `javascript:`, and the server is
  what fetches them.
- **Audit.** Every create, update, delete and activation is recorded.

### Not deployed

`firestore.rules` and `firestore.indexes.json` both changed and neither is
live yet. The indexes matter more than usual: `listActiveSources` filters on
`active` and orders by `priority`, and without the composite index that query
fails outright in production rather than degrading.

```bash
firebase deploy --only firestore
```

### Note on `npm audit`

Six moderate advisories, all reached through `firebase-admin` →
`@google-cloud/storage` → `uuid`. `rss-parser` adds none. `npm audit fix
--force` would downgrade `firebase-admin` itself, which is a worse trade than
the advisories; left alone deliberately.

### Next

Module 04 — AI News Research & Ranking.
