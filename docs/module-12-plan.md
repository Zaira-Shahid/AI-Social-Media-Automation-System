# Module 12 — Facebook Integration: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-12-facebook` (from `develop`).
**Meta documentation re-verified:** 2026-09-01.

---

## Step 1 — Read

§13, §14, §17, §19 (integrations, and the whole token storage and lifecycle
section), §20 (provider adapters, and the rule that Module 16's interface
comes first), §21 (mock mode), §27, §32, §33, §42 (social accounts screen),
§49, §52, §55, §56, §58, §59, §63 (Modules 12 and 16), §65
(anti-hallucination), §66 (REAL/MOCK/UNAVAILABLE), §67. Also
`docs/module--1-platform-access-spike.md`, which named exactly what this
module had to confirm.

## Step 2 — Inspect

| Item | State |
|---|---|
| Adapter interface | Did not exist. §20 and Module 16 both require it before any provider adapter |
| `TOKEN_ENCRYPTION_KEY` | Already in the env schema since Module 00, unused |
| `socialAccounts` | No collection, no rules — only the catch-all deny |
| §42's screen | Nav entry rendered as inert text |
| Rendered cards | Module 08 puts a public PNG on Cloudinary — already the shape Meta's photo endpoint wants |
| Publishing | Nothing. Module 16 is the engine; this module builds one adapter for it |

## Step 3 — Verification first (§19, §65)

§19 says the assistant must verify API availability, publishing permissions,
scopes, account and app requirements, rate limits and analytics availability,
and "never invent any of these". Module −1 left five items marked
**[UNVERIFIED]** for this module. Each was checked against Meta's own
documentation on **2026-09-01**:

| Question | Answer | Source |
|---|---|---|
| Photo publishing endpoint | `POST /{page-id}/photos`, with `url` — "URL of a photo that is already uploaded to the Internet" — plus `caption`; returns `id` and `post_id` | [Page photos reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/) |
| Text/link publishing | `POST /{page-id}/feed` with `message` and `link` | [Pages API — posts](https://developers.facebook.com/docs/pages-api/posts) |
| Required permissions | `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, and a Page token from someone with the `CREATE_CONTENT` task | [Page photos reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/) |
| Does a Page token expire? | **No.** "Long-lived Page access token do not have an expiration date and only expire or are invalidated under certain conditions". The long-lived *user* token it comes from lasts "about 60 days" | [Long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived) |
| Token exchange | `GET /oauth/access_token?grant_type=fb_exchange_token` with app id and secret, server-side only | same |
| Rate limits | Business Use Case limits: "Calls within 24 hours = 4800 \* Number of Engaged Users", reported in `X-Business-Use-Case-Usage`; codes **32** and **80001** on breach | [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) |
| Current API version | **v26.0**, released 2026-07-29; each version is supported about two years | [Versions](https://developers.facebook.com/docs/graph-api/changelog/versions/) |

Module −1's central finding held: publishing to a Page the company owns is
Standard Access and needs no App Review. **This module therefore builds the
real integration, not a mock** (§63: "Implement real official integration if
technically available").

The Page-token answer changed a design decision. §19's lifecycle section
assumes refresh-before-expiry for Facebook; there is nothing to refresh, and
nothing to count down. `expiresAt` is stored as **null**, and §42's screen says
in words why — a fabricated 60-day expiry would have been a false countdown on
a credential that does not expire.

## Step 4 — Implementation

### The adapter interface came first (§20, Module 16)

`src/lib/publishing/adapter.ts` is Module 16's contract, stubbed here because
§20 says every provider adapter must be written to it rather than refactored
into it. It carries `PublishRequest`, `PublishResult` — a success needs a
provider post id, and a failure carries a reason and a `retryable` flag — and
`AdapterCapability` in §66's REAL / MOCK / UNAVAILABLE vocabulary. It contains
no orchestration: provider selection, retries and writing PUBLISHED or FAILED
back onto a post are Module 16's, and none of that is here.

Nothing calls `publish()` yet. That is correct for this module and is why the
system still cannot post to Facebook.

### Token storage (§19)

- **AES-256-GCM**, Node's own `crypto`, key from `TOKEN_ENCRYPTION_KEY`. §19
  requires an authenticated mode, and the tests prove it: a record whose
  ciphertext or tag has been altered refuses to decrypt rather than returning
  something plausible.
- A fresh 12-byte IV per encryption, never derived from the token.
- `firestore.rules` denies `socialAccounts` **reads as well as writes**.
  Encryption is a second layer, not a licence to hand ciphertext to a browser.
  Covered by three emulator rules tests.
- The screen receives a `SocialAccountView`, a type with **no token field at
  all**, so exposing one would be a type error rather than an oversight (§42).
- Nothing logs a token, encrypted or decrypted. The failing-connect path
  deliberately logs only Meta's message, because the request body held the
  token.

### Connecting, without an OAuth redirect

The Meta app stays in Development mode serving only accounts the company owns,
so there is no consumer login flow to run. An admin pastes a Meta user access
token; the server exchanges it for a long-lived one using the app secret — the
only way Meta permits, since the secret must never be client-side — lists the
Pages that token administers, and stores the **Page** token encrypted.

Missing app credentials fail loudly. Storing the pasted short-lived token
instead would produce an account that quietly stops working within the hour.

### Mock by default (§21, §58)

`FACEBOOK_PROVIDER` defaults to `mock`, so neither development nor any test run
can post to a real Page. The mock adapter returns `mode: "MOCK"` and an id
prefixed `mock-`, which nobody can mistake for a Facebook post id. Instagram
and LinkedIn get the same mock adapter with a limitation naming the module that
will build them — never "Not connected", which would imply one OAuth click.

## Implementation record (§64 Steps 5–9)

### Files

- `src/lib/publishing/adapter.ts` — Module 16's contract (§20).
- `src/lib/publishing/facebook.ts` — the real adapter, the token exchange and
  the Pages lookup, with every verified fact cited in the file itself.
- `src/lib/publishing/mock.ts`, `src/lib/publishing/index.ts` — simulation and
  adapter selection.
- `src/lib/social/crypto.ts`, `schema.ts`, `store.ts` — §19's storage.
- `src/app/(app)/social-accounts/` — §42's screen and its actions.
- `src/components/social-accounts-screen.tsx` — the screen.
- `firestore.rules` — `socialAccounts` denied outright.
- `src/lib/env.server.ts`, `.env.example` — `FACEBOOK_PROVIDER`,
  `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`.

### What the tests cover

- `tests/unit/social-crypto.test.ts` — round trip, ciphertext that never
  contains the token, a fresh IV each time, refusal of an altered ciphertext
  and of an altered tag, an error message that leaks nothing, and the expiry
  states including "no expiry is a real answer".
- `tests/unit/publishing-facebook.test.ts` — the endpoint and body actually
  sent, `post_id` preferred over `id`, a response with no id refused as
  unpublished, Meta's own wording passed through, rate-limit codes 32 and 80001
  treated as retryable while a rejected token is not, an unreachable Facebook
  treated as retryable, and the mock adapter's labelling.
- `tests/rules/firestore.rules.test.ts` — no client may read or write a
  connected account.
- `tests/e2e-auth/social-accounts.spec.ts` — every platform has a row, Facebook
  reads MOCK and "Not connected", Instagram names Module 13, the token field is
  a password field, connecting without app credentials fails with the reason,
  and a SOCIAL_MANAGER sees the screen but is offered no connect form.
- `tests/e2e/smoke.spec.ts` — `/social-accounts` redirects to login.

No test contacts Meta. `fetch` is replaced in the unit tests and the provider
stays `mock` everywhere else (§58).

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 367 tests, 28 files (was 338/26) |
| Emulator rules tests | pass — 36 tests (was 33) |
| Playwright, no credentials | pass — 16 tests (was 15) |
| Playwright, credentialed | pass — 76 tests (was 68) |
| Production build | pass — `/social-accounts` added |

### Security and correctness review (§64 Step 7)

- **Secrets.** The app secret is server-only and used solely in the exchange;
  it never reaches the browser and is never given to n8n. No token is logged,
  returned to a client, or rendered.
- **At rest.** AES-256-GCM with a server-only key; tampering is detected.
- **Rules (§33).** `socialAccounts` denies client reads and writes, tested
  against the emulator.
- **Authorization.** Viewing the screen needs `content:view`; connecting and
  disconnecting need `integrations:manage`, re-checked inside each action, not
  merely hidden in the UI.
- **Audit (§55).** Connect and disconnect write `SETTINGS_CHANGED` with the
  Page id and name — never the token.
- **No fake success (§67).** A Facebook response without a post id is a
  failure; the mock adapter is labelled MOCK and returns an obviously fake id;
  the screen distinguishes REAL, MOCK and "not built yet" instead of showing
  everything as "Not connected".
- **Failure handling (§52).** Failures return a reason and a `retryable` flag
  rather than throwing, so Module 16 can store them on the post; only rate
  limits, transient Meta errors and 5xx are marked retryable.

### Open item for the owner

The real path cannot be exercised until Meta credentials exist. Module −1's
checklist A still applies: a Facebook Page with an admin role, a Meta app left
in Development mode with **no App Review submitted**, and then App ID, App
Secret and Page ID. With those in `.env.local` and `FACEBOOK_PROVIDER=graph`,
the connect form and the adapter are ready to run against the real Page.

### Next

Module 13 — Instagram Integration. Module −1 flagged two things to confirm
there: the exact publishing permission names, and whether the API really
requires media as a public URL (it interacts with how Module 08 stores cards).
