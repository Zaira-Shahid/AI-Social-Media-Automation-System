# Module 17 — Analytics Collection

Spec sections: §19, §20, §21, §22, §32, §33, §42, §44, §50, §55, §63
(Module 17), §65, §66, §67.

Build: provider analytics adapters, normalization, analytics storage,
unavailable-metric handling. §63 is explicit that dashboard data is part of
this module's brief, but §39's actual Analytics Screen — trends,
comparisons, filters — is Module 18's, and Module 18 also owns weekly
comparison. This module ships the data and a read model to query it; nothing
that renders it.

## Step 1 — Read

§19 (verification rule, analytics availability), §20 (one adapter interface
before any provider), §21 (mock mode, never claiming a real number),
§22 (the metric vocabulary and "never create fake numbers"), §32 (the
`analytics` collection), §33 (client access), §42 (screen carries adapter
capability — future work, but the vocabulary is set here), §44/§50
(`08_analytics_sync`'s shape: fetch → normalize → store), §55 (`ANALYTICS_SYNCED`
audit action, already declared), §65 (verify before writing), §66/§67
(REAL/MOCK/UNAVAILABLE, never fabricate a success).

## Step 2 — Inspect

| Item | State |
|---|---|
| Analytics adapter interface | Did not exist. Built first, mirroring `src/lib/publishing/adapter.ts` (§20) |
| `analytics` collection | Named in §32, no schema, no rules — only the catch-all deny |
| Facebook/Instagram permission scopes for reading | Publishing's scopes (`pages_manage_posts`, `instagram_content_publish`, …) do not include read access |
| LinkedIn | Module 14 already found `r_member_social` closed; nothing new to check |
| A way to find published posts | Did not exist — `content/store.ts` had no query for `status == "PUBLISHED"` |
| `08_analytics_sync` webhook | Did not exist |

## Step 3 — Verification first (§19, §65)

Checked against Meta's own documentation on **2026-09-02**. This module
answers §22's question — which metrics are *actually returned*, not merely
theoretically listed — platform by platform.

### Facebook Page posts

| Question | Answer | Source |
|---|---|---|
| Likes/comments/shares | Ordinary fields on a Page post node: `likes.summary(true)`, `comments.summary(true)`, `shares.count`. No extra permission beyond `pages_read_engagement`, already granted in Module 12 | [Page Post reference](https://developers.facebook.com/docs/graph-api/reference/v26.0/page-post) |
| Insights permission | `read_insights` (Standard Access — no App Review for a Page we own) | [Page/insights reference](https://developers.facebook.com/docs/graph-api/reference/insights/) |
| Reach/impressions metrics | **Actively being deprecated.** `post_impressions` and every `*_impressions_unique` variant were deprecated between 2025-06-15 and 2025-11-15. A replacement family (`post_media_view` and friends) is described only in Meta's own deprecation notice — I could not fetch a primary metric reference confirming it as a currently valid enum value | [Deprecated Page Insights metrics](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics) |

**Decision:** the Facebook adapter never calls the `insights` edge. It reads
`likes`, `comments`, `shares` — all confirmed, all reliable — and derives
`engagement` as their sum. `reach`, `impressions`, `clicks` and
`engagementRate` are stored as `"UNAVAILABLE"` rather than built on a metric
name I could not confirm against primary documentation (§65).

### Instagram feed media

| Question | Answer | Source |
|---|---|---|
| Valid metrics for feed media, by name | `GET /{ig-media-id}/insights` — for FEED media the current, non-deprecated set is `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions`, `views` (plus aggregated `total_*` variants). `impressions` is explicitly marked deprecated for media created after 2024-07-02 | [ig-media/insights reference](https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights) |
| Permission | `instagram_manage_insights` (Standard Access — no App Review for an account we own and manage), read alongside `pages_read_engagement` through the same Facebook Login connection Module 13 already uses | Same page |

**Decision:** the Instagram adapter requests `reach`, `likes`, `comments`,
`shares`, `saved`, `total_interactions` in one call. `engagement` is
`total_interactions`; `engagementRate` is `engagement / reach` only when both
are real numbers. `impressions` and `clicks` are `"UNAVAILABLE"` — not
offered for feed media at all.

`instagram_manage_insights` was **not** requested by Module 13's original
connect flow. An account connected before this module may lack it; that
surfaces as the real permission error Meta returns on the first sync, stored
as that post's `syncError`, rather than being assumed away.

### LinkedIn

Unchanged from Module 14: `r_member_social` — the permission post analytics
need — is "restricted and available to approved users only", and LinkedIn is
not accepting requests for it. The LinkedIn analytics adapter is
**UNAVAILABLE**, not "not connected" (§66) — nothing about reconnecting the
account would fix it.

## Step 4 — Implementation

### The adapter interface came first (§20)

`src/lib/analytics/adapter.ts` mirrors the publishing contract: `describe()`
for capability, `fetchMetrics(request, credentials)` returning a result that
is `ok: true` with a `Metrics` map or `ok: false` with a reason — never a
thrown exception the caller has to remember to catch. `Metrics` values are
`number | "UNAVAILABLE"`, defined in `src/lib/analytics/schema.ts` alongside
the fixed §22 metric vocabulary (`reach`, `impressions`, `likes`, `comments`,
`shares`, `clicks`, `engagement`, `engagementRate`) every adapter reports
against, so nothing platform-specific leaks upward.

### One adapter per platform, one selector

`facebook.ts`, `instagram.ts`, `linkedin.ts` implement the contract per the
verification above. `mock.ts` derives deterministic numbers from a post's
(fake) `providerPostId` rather than `Math.random()`, so a re-sync of the same
mock post reports the same numbers — a simulated measurement should still be
stable, not a new fiction every tick. `index.ts` selects an adapter the same
way `publishing/index.ts` does, reusing `FACEBOOK_PROVIDER`/
`INSTAGRAM_PROVIDER` rather than adding a second pair of flags that could
drift from the ones publishing already reads.

### Sync follows how a post was published, not today's provider flag (§67)

`sync.ts`'s `syncOne` branches on the post's own `publishMode`, stored at
publish time — not on the current `FACEBOOK_PROVIDER` value, which could have
changed since. A `publishMode: "MOCK"` post never reaches a real adapter or
real credentials; its `providerPostId` is `mock-facebook-…`, and no real API
would recognise it. A `publishMode: "REAL"` post always gets the real
adapter, because it genuinely reached the platform. `content/store.ts`
gained `listPublishedPosts`, filtering `status == "PUBLISHED"` alone — the
existing invariant in `recordPublishSuccess` (Module 16) guarantees that
status never lands without a `providerPostId` in the same write, so nothing
second-guesses that here.

A missing or expired credential is stored as a **sync failure** (`syncError`
on the record), not silently skipped — same reasoning as the publishing
engine's "verify social account" step (§49).

### Storage (§32, §33)

One document per platform post in `analytics`, doc id = the platform post id,
overwritten on each sync. `firestore.rules` opens it to signed-in reads (the
future Module 18 screen's read model) and denies every client write — a
client that could write `"UNAVAILABLE"` away into a number would be exactly
the fabrication §22 forbids.

### The webhook (§44, §50)

`POST /api/webhooks/content/analytics-sync` is n8n's `08_analytics_sync`
trigger, signed identically to `content/publish`. It runs `runAnalyticsSync()`
and returns per-post detail, then writes one `ANALYTICS_SYNCED` audit entry
per run (already declared in `src/lib/audit.ts` since before this module).

### What Module 17 does not do

No dashboard, no trend, no platform/topic/format comparison — §39's screen
and §50's "update dashboards" step are Module 18's, reading this module's
`analytics` collection and `getPostAnalytics`/`listAnalyticsForPlatform` read
model rather than duplicating storage.

## Step 5 — Tests

`tests/unit/analytics-facebook.test.ts`, `analytics-instagram.test.ts`,
`analytics-linkedin.test.ts`, `analytics-sync.test.ts`. `fetch` is stubbed;
nothing calls a real platform. Covered: only the confirmed fields are ever
reported as real numbers, a metric a platform's own response omits is
`"UNAVAILABLE"` rather than `0`, a refused call returns a failure rather than
a fabricated result, a mock-published post never touches credentials or a
real adapter, and one post's sync failure never stops the run.

### Next

Module 18 — Weekly Performance Analysis, reading this module's `analytics`
collection to build comparisons, the trends screen, and AI strategy
recommendations.
