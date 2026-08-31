# Module 04 — AI News Research & Ranking: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-04-ai-ranking` (from `develop`).

---

## Step 1 — Read

§4 (topic direction), §7 (quality filter and its eight factors), §8 (the daily
shortlist), §21 (mock mode), §27 (roles), §29 (free-tier-first), §30 (AI
provider abstraction), §31 (AI output validation), §32–§33, §36, §44–§46,
§52, §55, §58, §63, §65 (anti-hallucination), §66 (REAL/MOCK/UNAVAILABLE).

## Step 2 — Inspect

| Item | State |
|---|---|
| AI code | None. §30's abstraction did not exist yet |
| News pipeline | Module 03: sources, ingestion, normalization, `newsItems` at status `DISCOVERED` |
| Scoring fields | Deliberately absent from stored items — Module 03 refused to write zeroes |
| `duplicateGroup` | Populated by Module 03; nothing consumed it |
| Webhook pattern | Signed HMAC route from Module 03, reusable as-is |
| Permissions | `automations:manage` (ADMIN, MANAGER) already fits a ranking trigger |
| Indexes | `(status, publishedAt)` already declared and now live |

## Step 3 — Plan

### The provider decision (§29)

§29 requires that a paid capability stop and ask, and that no API be called
free without verification. Every claim below was checked against the
provider's own documentation on 2026-08-31, not recalled (§65):

| Option | Verified finding |
|---|---|
| **Groq** | Free plan. `openai/gpt-oss-120b`: 30 RPM, 1K RPD, **8K TPM**, 200K TPD. Supports `response_format: json_schema` with `strict: true` |
| Google Gemini | Several Flash models "free of charge" — but the pricing page states free-tier content **is used to improve Google's products**, and the brand profile that feeds later prompts is company data |
| Anthropic Claude | No free tier. Opus 5 $5/$25 per MTok, Haiku 4.5 $1/$5 |

The owner chose **Groq**. Gemini was rejected on the training-data term rather
than on capability.

**8K tokens per minute is the binding constraint**, and it shapes the design
more than anything else here: small batches, truncated summaries, and pacing
between requests.

### Scope

§63's eight items. **Not** in scope: the Slack shortlist notification (Module
05), human selection of the final three (Module 06), and §36's full news
screen.

### 3.1 The abstraction (§30)

`AIProvider` exposes exactly one method — `complete({system, prompt, schema,
schemaName, maxOutputTokens})` returning parsed JSON plus the mode, provider
and model that produced it. Endpoints, `response_format`, rate limits and
retries live behind the adapter; `rank.ts` never learns which provider ran.

§30 names eight logical functions. They are **not** declared as seven throwing
stubs — each arrives with the module that needs it, on this same primitive. A
method that exists and always throws documents less than one that does not
exist.

Two adapters: `GroqProvider` and `MockProvider`.

### 3.2 Mock mode (§21, §66)

The mock is the **default**, so nothing reaches a live service by accident and
CI needs no key. Its output is deterministic — derived from a hash of the
prompt — because a random mock produces a flaky suite.

`mode: "REAL" | "MOCK"` travels with every result and is **stored on each
document**, not merely displayed. §21 forbids the UI presenting a simulated
outcome as real, and a flag that exists only at call time is gone by the time
anyone looks at the data. The screen badges every simulated story.

A missing `GROQ_API_KEY` with `AI_PROVIDER=groq` **throws**. Falling back to
mock would leave the system producing simulated scores while every screen
reported them as real.

### 3.3 What the AI is asked, and what it is not

§7 lists eight factors. Six are judgement and go to the model. **Recency and
source quality do not**: one is a subtraction against `publishedAt`, the other
is the priority a person already set on the source. Asking a model to compute
either adds a way to be wrong and nothing else.

Age is also decided before any call. Rejecting stale stories first means the
day's quota is spent on stories that could actually be published.

### 3.4 Validation (§31)

Two representations of one contract, kept in one file: a JSON Schema for the
provider's constrained decoding, and a Zod schema that validates the reply.
The Zod pass is not redundant — a provider that claims to enforce a schema and
one that actually does are not reliably the same provider.

A score for an id nobody asked about is discarded. §65's rule against invented
data applies to model output too.

### 3.5 Shortlist (§8)

5–10 stories, ordered by a weighted composite. Relevance and AI relevance
dominate the weights because §4 is explicit about what this system is for — a
credible, fresh story about something else is not what anyone asked for.

A score floor is applied **before** the cap, so a thin day produces a short
shortlist rather than one padded with stories nobody would pick (§67).

**The AI never chooses the final three.** §8 gives that to a human, and this
module stops at the shortlist.

### 3.6 Duplicates (§7)

Module 03 grouped identical headlines; deciding which copy survives needs the
scores, so it happens here. The best-scoring copy is kept and the rest are
marked `REJECTED` — not deleted, so the record of what was discovered stays
intact.

### 3.7 Trigger

`POST /api/webhooks/news/rank` for n8n's `02_news_ranking`, signed exactly as
Module 03's discovery webhook, plus a "Rank now" button for ADMIN and MANAGER.

---

## Implementation record (§64 Steps 4–9)

### Deviation from the plan

| Plan | What shipped | Why |
|---|---|---|
| Backend only, per §63's list | A read-only `/news` screen | §59's gate asks for frontend, loading, empty and error states. A ranking pipeline with no surface cannot be judged by anyone, and §8's six required fields need somewhere to appear. §36's full screen — search, filters, article detail, choosing three — is still Module 06. |

### Three test-infrastructure faults this module exposed

**Sign-out was logging other specs out.** Signing out revokes the account's
refresh tokens across every session — correct behaviour, and the reason logout
means something on a second device. But every spec file shared one admin
account, so `login.spec`'s sign-out test intermittently killed the sessions
`brand.spec` and `news.spec` were using. It presented as a flaky brand test.
The sign-out spec now has its own account.

**The emulator run collided with a running dev server.** It hard-coded port
3000, so the credentialed suite refused to start whenever anyone had the app
running — which is exactly when they most want to run it. It now uses 3100,
overridable with `E2E_PORT`.

**`.next-e2e` was being linted.** It was added to `.gitignore` but not to
eslint's or Prettier's ignore lists, so `npm run verify` started failing on
generated build output.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 139 tests, 12 files (was 103) |
| Emulator rules tests | pass — 25 tests |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 28 tests |
| Production build | pass — `/news` and the ranking webhook added |
| Live Firestore indexes | all three queries now succeed against the real database |

The credentialed run ranks five seeded stories end to end through the mock
provider and asserts that every story carries a "Simulated" badge — the
labelling §21 requires is tested, not assumed.

### Security and correctness review (§64 Step 7)

- **No silent downgrade.** `AI_PROVIDER=groq` without a key throws rather than
  quietly producing mock scores.
- **Mode is persisted.** Every scored document records whether a real provider
  ran, so a simulated score cannot later be mistaken for a real one.
- **Authorization.** Ranking sits under `automations:manage` (§27) and is
  re-checked inside the action; the webhook is HMAC-signed.
- **Output validation.** Zod before the database (§31); unknown ids discarded;
  a truncated provider response is treated as a failure rather than parsed.
- **Never fabricates.** An unscored story stays `DISCOVERED` for the next run
  instead of being written with zeroes (§67).
- **Quota.** Batched, paced and capped against Groq's published free-plan
  limits, so one bad day cannot spend tomorrow's quota.

### To switch from simulated to real scoring

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=...      # console.groq.com, free plan
```

Until then every score is labelled Simulated in the UI and stored as `MOCK`.

### Next

Module 05 — Slack News Notification.
