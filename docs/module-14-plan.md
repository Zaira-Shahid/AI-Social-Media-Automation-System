# Module 14 — LinkedIn Integration

Spec sections: §13, §19, §20, §21, §41, §42, §44, §52, §63 (Module 14), §65,
§66, §67.

Module −1 rated LinkedIn split: the **personal profile REAL**, the **company
page UNAVAILABLE**, and left one question — whether "Sign In with LinkedIn
using OpenID Connect" is strictly required — marked `[UNVERIFIED]` for this
module. This module confirms all three against LinkedIn's own documentation
(§65) and builds the adapter.

## What the documentation says

Checked 2026-09-02.

**1. Module −1's open question is answered: yes, OIDC is required.**

`POST /rest/posts` will not accept a post without an `author` URN, and the only
self-serve way to learn the member's own id is the OIDC `userinfo` endpoint —
its `sub` becomes `urn:li:person:{sub}`. So the app needs **both** self-serve
products, and neither is reviewed:

| Product | Grants |
|---|---|
| Share on LinkedIn | `w_member_social` |
| Sign In with LinkedIn using OpenID Connect | `openid`, `profile` |

**2. The company page stays UNAVAILABLE, and it is a documented limitation.**

Posting as an organization needs `w_organization_social` via the Community
Management API, which the documentation gates behind two-tier App Review, a
registered company and a verified Page. §66 is explicit that this must be shown
as UNAVAILABLE with the reason, never as an account nobody has connected yet —
so the adapter's `limitation` names it in words on §42's screen.

**3. Analytics stay unavailable.** `r_member_social` is described as
"**restricted** and is available to **approved users only**", and Module −1
found LinkedIn is not accepting requests for it. §22's realistic coverage is
therefore Facebook and Instagram, as Module −1 warned.

**4. Publishing is three calls, and the image cannot be a URL.**

This is the sharpest difference from Meta. Instagram fetches a public URL;
LinkedIn will not:

1. `POST /rest/images?action=initializeUpload` with `{"initializeUploadRequest":
   {"owner": "<person urn>"}}` → `uploadUrl` + an `urn:li:image:...`.
2. Download the card from Cloudinary and **PUT** the bytes to `uploadUrl`. The
   image upload requires the OAuth token in the header — LinkedIn notes this is
   the opposite of the video upload, which must not carry one.
3. `POST /rest/posts` referencing the image URN.

PNG is supported ("JPG, GIF, and PNG formats"), which is exactly what Module 08
already stores for LinkedIn. **No storage change was needed** — the same
outcome as Module 13, for the opposite reason.

**5. The post id is in a header.** A successful create returns `201` with an
empty body and the id in **`x-restli-id`** (`urn:li:share:...` or
`urn:li:ugcPost:...`). Reading the body would find nothing, and a response
without that header is not a publish (§67).

**6. Every REST call needs two headers**: `LinkedIn-Version: YYYYMM` and
`X-Restli-Protocol-Version: 2.0.0`. The version is pinned to `202608`; LinkedIn
sunsets versions about a year out (the docs currently warn 202508 goes on
2026-08-17), so an unpinned call would change behaviour without a deploy.

**7. The 60-day token is real, and its expiry is knowable.** LinkedIn issues no
refresh token on this tier. `POST /oauth/v2/introspectToken` with the client id
and secret returns `active`, `status`, `scope` and `expires_at` (epoch
**seconds**) — so the stored `expiresAt` is a fact read back from LinkedIn, not
"now + 60 days".

## What was built

### `src/lib/publishing/linkedin.ts`

`LinkedInAdapter` implements Module 16's `ProviderAdapter` contract unchanged —
the third adapter to be written against it, which is the point of §20 defining
it first. Alongside it:

- `fetchMemberIdentity()` — OIDC `userinfo` → the author URN.
- `introspectToken()` — the real expiry, status and granted scopes.
- `missingScopes()` — pure, so the connect form can refuse a token that would
  fail later.

Retry classification follows LinkedIn's own error table (§52): `409` — which
the docs literally annotate "Retry the request." — `429` and 5xx are retryable;
`401`, `403`, `400` and `422` are decisions and are not.

### Token expiry warnings — §19's alert, finally wired

Module 12 built the `EXPIRING` token state explicitly for LinkedIn's 60-day
reality, and nothing consumed it, because no connected credential could
actually expire. This module is where that stops being hypothetical, so §19's
"Slack alert 5–7 days before expiry" is implemented here rather than deferred:

- `src/lib/social/expiry.ts` — `collectExpiringAccounts()` and
  `alertOnExpiringTokens()`. Accounts whose `expiresAt` is null are never
  warned about: null is a real answer for a Facebook Page token, and warning
  about a credential that does not expire trains people to ignore the channel.
- `src/app/api/webhooks/social/tokens/route.ts` — a signed daily n8n tick
  (§44), like every other schedule here. It publishes nothing and writes
  nothing.
- Silence when nothing is expiring is deliberate. An alert channel that says
  "all fine" every day is one nobody reads on the day it matters.
- A Slack failure is rethrown, so the run is recorded as failed rather than
  reporting a warning that never reached anyone (§67).

### Screen and actions (§42)

`connectLinkedIn` / `disconnectLinkedIn`. A pasted token again, but for a
different reason than Meta's: LinkedIn's 3-legged OAuth needs a registered
HTTPS redirect URL, which this system does not have until it is deployed —
the same constraint that made §66 mark Slack's interactive buttons UNAVAILABLE.
LinkedIn's developer portal issues a token directly to an app's own owner,
which is precisely this case.

The connect path refuses more than it accepts, on purpose: an inactive token,
or one missing any required scope, is rejected **with the scope named**, rather
than stored to fail on the first real post.

Expiry is now derived on the server in `page.tsx` through the existing
`statusForExpiry`, so §19's window has one implementation shared with
`getUsableCredentials` rather than a second one in the UI. `REVOKED` is never
overwritten by that derivation — only the platform refusing a token can
establish it, and a date cannot un-revoke one.

### A live-service leak this module surfaced (§58)

Running the credentialed suite posted a **real shortlist to the team's Slack
workspace**, and two tests failed because they assert the message is labelled
simulated.

The cause was not this module's code. `playwright.config.ts` loads `.env.local`
so webhook signatures match the server's secret, and that file carries whatever
is switched on for real work — by this point `SLACK_PROVIDER=slack` with a live
bot token. The emulator run isolates Firebase and **nothing else**, so the app
under test held real Slack credentials and used them.

§58 is explicit that tests must not touch live services, so the run now forces
every outbound switch to `mock` — Slack, AI, and all three publishing
providers — in both the Playwright process and the app under test. Providers
with no test exercising them yet are listed too: the failure is silent and
outward-facing, so reaching the network has to be opted *in*, never opted out.
"Remember to set it back to mock" is not a mechanism.

### Tests (§58)

- `tests/unit/publishing-linkedin.test.ts` — 18 tests: the register → download
  → PUT → post sequence and its bodies, the required headers on every REST
  call, the id read from `x-restli-id` and a 201 without it being a failure,
  an empty or undownloadable card stopping before any post, every retry
  classification, and no token in a logged failure.
- `tests/unit/social-expiry.test.ts` — 10 tests: a null expiry never warned
  about, the 7-day boundary, expired sorted first, silence when nothing is due,
  the delivery mode carried, a Slack refusal not reported as an alert, and no
  token in the message.
- `tests/rules/firestore.rules.test.ts` — the deny case now loops over every
  platform rather than assuming one generalises.
- `tests/e2e-auth/social-accounts.spec.ts` — LinkedIn reads MOCK, its
  limitation names `LINKEDIN_PROVIDER`, the form names `w_member_social`, all
  three token fields are password fields, connecting without client credentials
  fails with the reason, and a SOCIAL_MANAGER is offered no form.
- `tests/e2e-auth/webhook.spec.ts` — the token tick rejects an unsigned request
  and, with nothing connected, reports `alerted: false`.
- `playwright.config.ts` — every provider switch forced to `mock` for both
  runs, so no suite can reach a live service again.

No test contacts LinkedIn. `fetch` is replaced in the unit tests and every
provider stays `mock` elsewhere.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 418 tests, 31 files (was 390/29) |
| Emulator rules tests | pass — 37 tests |
| Playwright, no credentials | pass — 16 tests |
| Playwright, credentialed | pass — 83 tests (was 79) |
| Production build | pass — `/api/webhooks/social/tokens` added |

### Security and correctness review (§64 Step 7)

- **Secrets.** The client secret is server-only and used solely for
  introspection. No token is logged, returned to a client, or rendered; the
  Graph-equivalent calls all carry one, so requests are never logged — only
  status codes.
- **At rest.** AES-256-GCM, the same key and helpers as Modules 12 and 13.
- **Rules (§33).** `socialAccounts` denies client reads and writes; the
  LinkedIn document is covered by its own emulator assertion.
- **Authorization.** Connect and disconnect need `integrations:manage`,
  re-checked inside each action. The webhook is HMAC-signed like every other
  n8n trigger, and rejects an unsigned request with 401.
- **Audit (§55).** Connect and disconnect write `SETTINGS_CHANGED` with the
  member URN and the expiry — never the token.
- **No fake success (§67).** A create without `x-restli-id` is a failure; an
  empty or undownloadable card never reaches a post; the expiry tick never
  reports an alert Slack refused.
- **Failure handling (§52).** Failures return a reason and a `retryable` flag
  rather than throwing, classified from LinkedIn's documented error table.

### Open items for the owner

1. **The real path is untested against LinkedIn.** Module −1's checklist B
   applies, with the addition this module confirmed: add **both** products
   ("Share on LinkedIn" **and** "Sign In with LinkedIn using OpenID Connect"),
   then generate a token and paste it in with `LINKEDIN_CLIENT_ID`,
   `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_PROVIDER=rest` set.
2. **Somebody must reconnect LinkedIn roughly every 60 days.** This is
   unavoidable on the self-serve tier. The Slack warning exists so it is not a
   surprise, but it needs the n8n tick pointed at
   `/api/webhooks/social/tokens` daily, and `SLACK_PROVIDER=slack` for the
   message to leave this system.
3. **One thing cannot be verified before publishing.** The Images API does not
   support synchronous upload, and `w_member_social` is write-only — LinkedIn
   states that a token holding only it "would be unable to perform a GET call
   for rest/images". So unlike Instagram, this adapter cannot poll the asset to
   confirm it processed. LinkedIn warns that a post created before a failed
   image finishes processing "won't be visible to members". A successful PUT is
   the strongest confirmation available on this tier; that is stated here
   rather than papered over, and Module 21's failure recovery is where a
   post that lands invisibly would be caught.

### Next

Module 16 — Publishing Engine. All three adapters now exist against its
contract and nothing calls them: approval verification, provider selection,
retry safety and writing PUBLISHED or FAILED back onto the post are all still
unbuilt, which is why the scheduler tick still says publishing is Module 16.
Module 15 is retired (§63) and must not be built.
