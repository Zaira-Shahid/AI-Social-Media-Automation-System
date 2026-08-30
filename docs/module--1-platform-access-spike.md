# Module -1 — Platform Access Spike

**Status:** Report only. No code written.
**Date of verification:** 2026-08-30
**Governs:** §19, §20, §22, §66 (REAL/MOCK/UNAVAILABLE/FUTURE), §65 (anti-hallucination)
**Constraint applied:** Zero paid tiers. All paid dependencies are rejected by default, not merely "needs approval."

---

## 0. Method and epistemic status

Every claim below is tagged:

- **[VERIFIED-PRIMARY]** — confirmed against the platform's own documentation during this spike.
- **[VERIFIED-SECONDARY]** — consistent across multiple independent third-party sources this spike consulted; not read off the vendor's own page.
- **[UNVERIFIED]** — believed true but NOT checked in this spike. Must be confirmed at implementation time before any code depends on it.

Per §65, nothing here is asserted from memory alone. Free-tier terms and review requirements change; **re-verify at the start of each integration module.**

---

## 1. Executive summary — the priority order in the brief is inverted

The MVP priority stated in the brief was: **LinkedIn + X first, Facebook/Instagram later (blocked on Meta App Review).**

Verification contradicts this on both halves.

| Platform | Publishing verdict | Analytics verdict | Blocker |
|---|---|---|---|
| **Facebook Page** | **REAL** | Likely REAL | None. No App Review needed for owned Pages. |
| **Instagram** | **REAL** | Likely REAL | None. No App Review needed for owned accounts. |
| **LinkedIn (personal profile)** | **REAL** | **UNAVAILABLE** | Token re-auth every 60 days. |
| **LinkedIn (company page)** | **UNAVAILABLE** | UNAVAILABLE | Two-tier review + registered company + verified Page. |
| **X / Twitter** | **UNAVAILABLE** | **UNAVAILABLE** | **No free tier exists as of Feb 2026.** Any use costs money. |

**Two findings drive this:**

1. **X has no free tier at all.** It is not "posting free, analytics paid" as assumed in the brief. Under the zero-paid-tier constraint, X is out entirely.
2. **Meta needs no App Review for this use case.** The system publishes only to accounts the company owns. That is Standard Access, which is explicitly designed for it. The 2–4 week review gauntlet does not apply.

**Recommended revised MVP order: Facebook + Instagram first, LinkedIn personal profile second, X excluded.**

---

## 2. X / Twitter — UNAVAILABLE

### Finding

X **discontinued its free tier for new developer signups on 2026-02-06**, replacing tiered pricing with pay-per-use as the default. [VERIFIED-SECONDARY, corroborated across multiple independent sources]

X's own API introduction page confirms the model is **"pay-per-usage pricing with no subscriptions,"** credits purchased upfront and deducted as used. The page does **not** document any complimentary allowance for new developers. [VERIFIED-PRIMARY]

Reported pay-per-use rates (approximately $0.015 per post created, higher for posts containing links, ~$0.005 per post read). [VERIFIED-SECONDARY — treat exact figures as indicative, not contractual]

Additional detail: the legacy Basic tier was retired and Pro is closed to new signups. [VERIFIED-SECONDARY]

### Consequence

Under the hard zero-paid constraint, **X/Twitter is UNAVAILABLE — for publishing as well as analytics.** There is no free path.

Note this is *stronger* than the brief anticipated. The brief expected posting to work free and only analytics to be blocked. Posting is not free either.

### Recommendation

- Build the X adapter as **MOCK only**, conforming to the Module 16 interface.
- Surface it in the Social Accounts screen (§42) explicitly as `UNAVAILABLE — no free tier` rather than "Not Connected," which would wrongly imply it is one OAuth click away.
- Keep the adapter shape complete so that if the constraint is ever relaxed, it is a credentials change, not a rewrite.
- **Do not register an X developer account.** It cannot be used under current constraints.

**CONFIRMED by the owner 2026-08-30.** X is removed from scope. The spec has been amended: §13 and §19 now list Facebook, Instagram, LinkedIn only; the §20 adapter diagram drops X; §42 drops the X row; the `feat: integrate X publishing` commit example is removed; and Module 15 is marked RETIRED rather than renumbered, so existing references to Module 16 and later remain valid.

---

## 3. LinkedIn — REAL for personal profile, UNAVAILABLE for company page

### Two different products, two very different gates

**Personal profile posting — `w_member_social`**

This is an **open, self-serve permission**. Adding the "Share on LinkedIn" product to a developer app grants it with no review process. [VERIFIED-SECONDARY, consistent across sources]

→ **Verdict: REAL.** Fastest genuine publishing path on any platform.

**Company page posting — `w_organization_social`**

Requires the **Community Management API**, which per LinkedIn's own product documentation requires `w_organization_social`, `r_organization_social`, and `w_member_social`. [VERIFIED-SECONDARY, from LinkedIn/Microsoft Learn documentation]

Access is gated behind a **two-tier app review**, a **registered company**, and a **verified LinkedIn Page**, plus a verified business email and the organization's legal name, registered address, website, and privacy policy. [VERIFIED-SECONDARY]

→ **Verdict: UNAVAILABLE for MVP** unless the company already has a registered legal entity and verified LinkedIn Page and is willing to go through review. It is free of charge, but it is not self-serve.

### Analytics — UNAVAILABLE

`r_member_social` (reading engagement on member posts) is a **closed permission; LinkedIn is not accepting access requests for it** due to resource constraints. [VERIFIED-SECONDARY]

→ **Personal-profile post analytics cannot be collected via API.** §22 must render `Unavailable` for LinkedIn, exactly as the spec already mandates. Organization analytics ride on Community Management approval and are therefore also out for MVP.

### Token lifecycle — an operational constraint, not just a design detail

- LinkedIn access tokens are valid for **60 days**. [VERIFIED-SECONDARY]
- **LinkedIn does not issue refresh tokens to standard developer apps.** Programmatic refresh tokens are available only to approved Marketing Developer Platform partners. [VERIFIED-SECONDARY]

→ **A human must manually re-authorize LinkedIn roughly every 60 days.** This is unavoidable on the self-serve tier.

This has direct design consequences and must be built in from the start, not patched later:

1. Store token expiry and **proactively alert to Slack** ~7 days before expiry (fits §9 "important automation failures" and §52).
2. The Social Accounts screen (§42) must show **token expiry date**, not just Connected/Not Connected.
3. The publishing engine (§49 "Verify social account") must fail **cleanly and loudly** on an expired token — never silently, per §52.

---

## 4. Facebook & Instagram — REAL (this is the significant finding)

### Why App Review does not apply here

Meta's Instagram Platform documentation defines two access levels: [VERIFIED-PRIMARY]

- **Standard Access** — the default; for "apps that will only be used by people who have roles on them, during app development, or for testing." Suits apps serving **only owned or managed accounts**.
- **Advanced Access** — required "if your app serves Instagram professional accounts that you don't own or manage," and demands App Review **plus** Business Verification.

**This system is an internal tool publishing exclusively to the company's own accounts.** That is squarely Standard Access. Meta's own docs indicate App Review is unnecessary where the app only serves an account you own or manage. [VERIFIED-PRIMARY]

Independent sources corroborate the operational pattern: keep the app in Development mode, assign the relevant account a role on the app (e.g. Instagram Tester), and publish without ever submitting for review. Review is triggered when *other people's* accounts connect to your app. [VERIFIED-SECONDARY]

→ **Facebook Page and Instagram both move from the brief's assumed UNAVAILABLE/MOCK to REAL.** No 2–4 week wait. Do **not** submit an App Review; it is not needed and would add risk and delay for nothing.

### Hard account requirements

- The Instagram account **must be Professional (Business or Creator)**. Personal accounts have **zero** API access. [VERIFIED-PRIMARY/SECONDARY, consistent]
- For Facebook Login setups the Instagram account must be **connected to a Facebook Page**. [VERIFIED-PRIMARY]

### What is NOT yet verified

- Exact Facebook Page publishing scope names (commonly cited as `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`) — **[UNVERIFIED]**. Confirm against Meta docs during Module 12 before writing code.
- Exact Instagram publishing permission names (`instagram_business_basic`, `instagram_business_content_publish` appear in secondary sources) — **[UNVERIFIED-PRIMARY]**. Confirm during Module 13.
- Insights/analytics scope names and what metrics are actually returned under Standard Access — **[UNVERIFIED]**. Confirm during Module 17. Do not promise analytics coverage in the UI until confirmed.
- Instagram content publishing rate limits (a documented posts-per-24h quota exists) — **[UNVERIFIED]**. Confirm during Module 13; the scheduler (§18) may need to respect it.
- Whether a long-lived/non-expiring Page token is obtainable for this configuration — **[UNVERIFIED]**, but materially affects the token-refresh design. Confirm during Module 12.

### Constraint to design around

Instagram's publishing API requires media to be supplied as a **publicly reachable URL** — it fetches the image rather than accepting a direct upload. [UNVERIFIED — confirm in Module 13]

If confirmed, generated static images (Module 08) must be served from a **public** Supabase Storage bucket or equivalent public URL at publish time. This interacts with §56 (security) and needs a deliberate decision: public bucket with unguessable paths, or time-limited signed URLs if Instagram accepts them. **Flagging now because it constrains Module 08's storage design, which is built long before Module 13.**

---

## 5. AI provider — Groq confirmed viable

Groq free tier: **no credit card required**; approximately **30 requests/minute, 6,000 tokens/minute, 14,400 requests/day**, applied **per organization and per model**. [VERIFIED-SECONDARY]

Assessment against this system's actual load:

- Daily need is roughly: rank ~30–60 articles, then generate content for 3 stories × 4 platforms, plus regenerations. Request *count* sits far below 14,400/day.
- **The binding constraint is 6,000 tokens/minute, not the request count.** Ranking a batch of articles with full summaries can exceed 6,000 TPM in a single call.

**Design implications for Module 04 (mandatory, not optional):**

1. **Batch and chunk** the ranking step — score articles in small groups rather than one large prompt.
2. Implement **rate-limit backoff and retry** in the AI service abstraction from day one (§52 requires it anyway).
3. Truncate article bodies before sending; rank on title + summary, not full text.

Rate limits are shared per organization, so n8n, the app, and any local testing all draw from the same pool. [VERIFIED-SECONDARY]

Groq is confirmed as the concrete default. The provider abstraction (§30) stays swappable as the spec intends.

---

## 6. What to register — your action checklist

Do these in this order. **Do not register an X developer account.**

### A. Meta (covers both Facebook and Instagram) — highest priority

1. Confirm the company **Facebook Page** exists and you are an admin.
2. Convert the company **Instagram account to Professional** (Business or Creator) if it is not already.
3. **Link the Instagram account to the Facebook Page.**
4. Create a Meta app at developers.facebook.com. **Leave it in Development mode. Do not submit for App Review.**
5. Ensure your own user has an admin/developer role on the app, and add the Instagram account under the appropriate tester/role setting.
6. Hand me: App ID, App Secret, Page ID, Instagram Business Account ID.

### B. LinkedIn

1. Create an app at developer.linkedin.com.
2. Add the **"Share on LinkedIn"** product (self-serve — grants `w_member_social` with no review).
3. Add **"Sign In with LinkedIn using OpenID Connect"** if member identity is needed. [UNVERIFIED whether strictly required for our flow — confirm in Module 14]
4. Set the OAuth redirect URL to the Vercel deployment HTTPS callback (I will give you the exact path in Module 14). The Cloudflare Tunnel approach was dropped — see §28.
5. Hand me: Client ID, Client Secret.
6. **Decide separately:** do you want to pursue Community Management API approval for company-page posting? It is free but needs a registered company + verified Page + two-tier review. If yes, start it now in parallel — it is the only long-lead item left, and it is optional.

### C. Not required

- **X / Twitter** — no registration. No free path exists.

### D. Still needed from you (blocking Module 00)

- **Git repository URL.** This directory is not a git repo and contains only the spec — no `package.json`, no `docs/` prior to this report. Nothing to reuse here yet.
- **Firebase project ID + client config + Admin SDK service account JSON** (Admin credentials to the app environment only — per your constraint they never reach n8n). **Keep the project on Spark; do not link a billing account.**
- **Cloudinary cloud name + API key + API secret** (server-only, same sensitivity tier as the Admin SDK credentials).
- **Company timezone** — confirmed as `Asia/Karachi` (§3, §54 — stored config, not hardcoded).

---

## 7. Impact on the spec

Per §65 and §0 rule 10, these are flagged for your approval, not applied:

1. **§13 / §19 name four initial platforms. X cannot be one of them** under the zero-paid constraint. Requires an explicit spec amendment.
2. **§22 analytics coverage is thinner than the spec implies.** LinkedIn post analytics are unavailable via API (closed permission), and X is out entirely. Realistic analytics coverage for MVP is **Facebook + Instagram only**. §23's weekly analysis and §24's strategy optimization will therefore reason over two platforms, not four. The "compare platforms" logic must handle this honestly rather than presenting gaps as zeros.
3. **Module roadmap order should change**: Module 12 (Facebook) and 13 (Instagram) become the fastest to REAL; 14 (LinkedIn) follows; 15 (X) becomes a MOCK-only adapter.
4. **Module 16's adapter interface is designed and stubbed first**, per your instruction, ahead of 12–15.

---

## 8. Open decisions — paused for discussion per §0 rule 12

No defaults have been chosen. Recommendations only.

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| 1 | OAuth token storage | Encrypt at rest via a dedicated app-held key; store expiry; Slack alert before expiry | LinkedIn's 60-day no-refresh reality makes expiry alerting mandatory, not nice-to-have |
| 2 | Static image generation | SVG-based (Satori → resvg) over Puppeteer | Your lean is correct — no Chromium binary, works in serverless/free hosting. Caveat: Satori supports a constrained CSS subset; template design must be built to that limit from the start |
| 3 | Image copyright rule | Adopt as stated: branded templates or explicitly licensed only; never an article's own image | Protects the company accounts from takedown/ban. Recommend encoding it as a validation rule, not just documentation |
| 4 | Duplicate detection | Start with normalized-title + URL hashing. **The embeddings fallback is now uncertain — see §11.** | Hashing is free and deterministic; embeddings add Groq calls against a 6K TPM budget already under pressure |
| 5 | Testing stack | Vitest (unit/integration) + Playwright (E2E) | Standard fit for fresh Next.js + Supabase; both free |
| 6 | Approval granularity | **CONFIRMED 2026-08-30** — per-platform approval with an "approve all" action | Now applied to the spec: status/approval live on `platformPosts/{id}` documents, never nested in the content item. See §17 and §32 |

**Status of these decisions as of 2026-08-30:** #4 and #6 are settled (#4 partially — see §11). #1, #2, #3 and #5 remain open and are still awaiting your call before Module 00.

---

## 9. Module -1 protocol completion (§64)

| Step | Status |
|---|---|
| 1. Read | Done — full spec read (2442 lines, §0–§71) |
| 2. Inspect | Done — directory contains only the spec; no repo, no `package.json`, no prior `docs/` |
| 3. Plan | Done — verification-first spike, four platforms + AI provider |
| 4. Implement | N/A — report-only module, by instruction |
| 5. Test | N/A — no code |
| 6. Validate | N/A — no code |
| 7. Security | Reviewed at design level: token expiry/rotation raised (§8.1); Instagram public-URL media requirement flagged against §56; n8n service-role-key exclusion confirmed as an architectural constraint |
| 8. Documentation | This report |
| 9. Git | **NOT PERFORMED — blocked.** No git repository exists in this directory and no remote is configured. Per §61, no commit, push, or merge is claimed. |
| 10. STOP | **Stopped. Module 00 not started.** |

---

## 10. Firebase migration — Storage conflicts with the zero-paid-tier constraint

**Added 2026-08-30 following the Supabase → Firebase architecture change.**

### The blocker

**Cloud Storage for Firebase requires the Blaze pay-as-you-go plan as of 2026-02-03.** Firebase's own documentation states that projects on the Spark plan "won't have access to any Cloud Storage buckets (including default buckets), and your API calls to buckets will return 402 or 403 errors." [VERIFIED-PRIMARY]

Blaze retains a no-cost usage allowance — for legacy `*.appspot.com` buckets, 5 GB stored, 1 GB daily downloads, 20,000 daily uploads, 50,000 daily downloads; newer `PROJECT_ID.firebasestorage.app` buckets draw on Google Cloud Storage's "Always Free" tier in eligible regions. [VERIFIED-PRIMARY]

So the bill can genuinely be **$0** — but **a Cloud Billing account with a credit card must be linked**, and the plan is pay-as-you-go, meaning overage bills rather than a hard stop.

### Why this matters here

This is not a marginal component. **Module 08 generates static post images, and Module 13 likely requires them served from a publicly reachable URL for Instagram publishing.** Asset storage is on the critical path to publishing, not an optional extra.

Under your stated rule — *"treat all paid dependencies as rejected by default, not just needing approval"* — Blaze is rejected by default. But Firebase Storage was part of the architecture you specified. These two instructions conflict, so **I have not picked a default.** The spec now marks Storage as BLOCKED in §28 and Module 00.

### RESOLVED 2026-08-30 — Option B, via Cloudinary

**Decision: no credit card is linked to this project under any circumstances. Firebase Storage is excluded entirely.** Static image storage moves to **Cloudinary's free plan**, which requires no credit card or financial details to register. [VERIFIED-PRIMARY]

**Important correction to the framing:** Cloudinary's free plan is **not** "25 GB storage + 25 GB bandwidth." It is **25 credits**, where one credit equals roughly 1 GB managed storage **or** 1 GB viewing bandwidth **or** 1,000 transformations — all drawn from **one shared pool**. [VERIFIED-SECONDARY] So storage and bandwidth compete with each other, and every transformation costs the same as storing a gigabyte.

This is comfortably sufficient here — a few static images per day is trivial against 25 credits — but it changes Module 08's design rules, now written into §15 and Module 08:

- Render at final size; avoid on-the-fly transformations, which burn credits at the same rate as storage.
- Bandwidth is consumed each time a platform fetches the media URL.
- Track credit consumption as an operational metric.

**Uploads must be signed and server-side.** Cloudinary's own documentation is explicit that the API secret must never be exposed to the client. Unsigned client-side upload presets are therefore excluded. The API secret is now classified in §56 at the same sensitivity tier as the Firebase Admin SDK credentials, and like them it never goes to n8n.

**Cloud Functions check — confirmed clean.** You asked me to verify nothing in the updated spec quietly assumes a Firebase Function, since that would re-trigger the Blaze requirement. It does not: `grep` across the spec returns no Cloud Functions dependency, and §28 now states explicitly that Cloud Functions must not be used and that all scheduled/background orchestration belongs to n8n. The one place Admin-SDK-privileged server code runs is the Next.js app itself, which is unaffected.

Firestore and Firebase Auth remain on Spark. No billing account is linked.

### Options considered (superseded by the decision above)

| Option | Cost reality | Trade-off |
|---|---|---|
| **A. Enable Blaze, set a $0.01 budget alert** | $0 in practice at our volume | Requires a credit card; overage is billed, not blocked. Simplest path; keeps the stack coherent |
| **B. Keep Firestore + Firebase Auth, use different free storage** for generated images | Genuinely free | Splits the stack across two vendors; needs a provider that gives stable public URLs |
| **C. Store images as base64 in Firestore** | Free within Spark quota | **Not recommended** — 1 MiB document cap, 1 GiB total storage, and no public URL for Instagram to fetch. Likely fails the Module 13 requirement outright |

**My recommendation: Option A**, with a hard budget alert and documented quota monitoring — provided you accept linking a card. If the no-card rule is absolute, Option B.

Note the same Blaze requirement applies to **Cloud Functions**. Our architecture does not need them — n8n in local Docker handles cron, and the Next.js app owns business logic — so this does not add a second blocker. Worth stating explicitly so nobody reaches for Cloud Functions later without realizing it re-triggers billing.

### Firestore free tier — confirmed adequate

Spark plan: **1 GiB stored, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, 10 GiB/month egress.** [VERIFIED-SECONDARY]

Comfortably sufficient for this workload (tens of articles/day, a handful of content items). Firestore itself is not the problem — only Storage is.

---

## 11. Firestore and vector search — decision #4 revisited

You asked me to flag rather than silently substitute. Correcting the record first: **pgvector was never in the spec.** It appeared only as a hypothetical fallback in decision #4 of this report, so nothing in the specification assumed it.

The situation under Firestore:

- Firestore **does** have native vector search — `findNearest`, exact K-nearest-neighbour, requiring a single-field vector index, with query vectors capped at 2048 dimensions. [VERIFIED-SECONDARY] So it is not true that Firestore has no equivalent.
- **What I could not verify is whether vector search is usable on the Spark free plan.** Firestore's pricing documentation describes billing for KNN index entries read (one read per batch of up to 100 entries) but the sources consulted do not state Spark-plan availability either way. **[UNVERIFIED]**
- Vector search would also need an embeddings provider. Groq's free tier is confirmed for chat completions; **whether it serves an embeddings endpoint is [UNVERIFIED]** and would need checking before this route is viable at all.

**Paused decision — no substitute chosen.** The recommendation in decision #4 is unchanged and unaffected: **start with normalized-title + URL hashing**, which is free, deterministic, and backend-agnostic. It was already the recommended first step, so this changes nothing about Module 04's planned implementation. Only the *fallback* is now uncertain, and that fallback should be re-verified if and when hashing proves insufficient — not designed for speculatively.

---

## 12. Sources

- [X API Introduction — docs.x.com](https://docs.x.com/x-api/introduction)
- [Instagram Platform Overview — Meta for Developers](https://developers.facebook.com/docs/instagram-platform/overview/)
- [Create an Instagram App — Meta for Developers](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app/)
- [Community Management API Overview — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)
- [LinkedIn Community Management API — Product Catalog](https://developer.linkedin.com/product-catalog/marketing/community-management-api)
- [LinkedIn Programmatic Refresh Tokens — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)
- [LinkedIn 3-Legged OAuth Flow — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [X API Pricing 2026 — Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)
- [Can You Use the X API for Free? — twitterapi.io](https://twitterapi.io/blog/can-you-use-x-api-for-free)
- [Groq Free Tier Limits 2026 — TokenMix](https://tokenmix.ai/blog/groq-free-tier-limits-2026)
- [Groq API Free Tier Limits — Grizzly Peak Software](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb)
- [Cloudinary Free Plan FAQ — Cloudinary Docs](https://cloudinary.com/documentation/developer_onboarding_faq_free_plan)
- [How do Cloudinary credits work? — Cloudinary Docs](https://cloudinary.com/documentation/developer_onboarding_faq_credits)
- [Cloudinary Upload API Reference](https://cloudinary.com/documentation/image_upload_api_reference)
- [Cloudinary Authentication Signatures](https://cloudinary.com/documentation/authentication_signatures)
- [Cloud Storage for Firebase billing changes FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Instagram Posting API 2026 Integration Guide — Blotato](https://www.blotato.com/blog/instagram-posting-api)
- [LinkedIn Posting API Guide 2026 — Zernio](https://zernio.com/blog/linkedin-posting-api)

**End of Module -1 report.**
