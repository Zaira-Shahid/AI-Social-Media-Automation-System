# Internal AI Social Media Automation System

Internal tool that researches industry news, drafts brand-aligned social
posts, routes them through human approval, and publishes to Facebook,
Instagram and LinkedIn on a schedule.

The authoritative specification is
[AI-Social-Media-Automation-System.md](AI-Social-Media-Automation-System.md).
It governs every decision in this repository; this README only covers how to
run what exists today.

## Status

| Module | State |
|---|---|
| −1 — Platform access spike | Complete ([notes](docs/module--1-platform-access-spike.md)) |
| 00 — Foundation | Complete ([plan](docs/module-00-plan.md)) |
| 01 — Authentication & Access Control | Complete ([plan](docs/module-01-plan.md)) |
| 02 — Company & Brand Intelligence | Complete ([plan](docs/module-02-plan.md)) |
| 03 — News Source Management | Complete ([plan](docs/module-03-plan.md)) |
| 04 — AI News Research & Ranking | Complete ([plan](docs/module-04-plan.md)) |
| 05 — Slack News Notification | Complete ([plan](docs/module-05-plan.md)) |
| 06 — Human News Selection | Complete ([plan](docs/module-06-plan.md)) |
| 07 — AI Content Generation | Complete ([plan](docs/module-07-plan.md)) |
| 08 — Static Post Generator | Complete ([plan](docs/module-08-plan.md)) |
| 09 — Content Preview & Approval | Complete ([plan](docs/module-09-plan.md)) |
| 10 — Social Media Calendar | Complete ([plan](docs/module-10-plan.md)) |
| 11 — Scheduling Engine | Complete ([plan](docs/module-11-plan.md)) |
| 12 — Facebook Integration | Complete ([plan](docs/module-12-plan.md)) |
| 13 — Instagram Integration | Complete ([plan](docs/module-13-plan.md)) |
| 14 — LinkedIn Integration | Complete ([plan](docs/module-14-plan.md)) |
| 16 — Publishing Engine | Complete ([plan](docs/module-16-plan.md)) |
| 17 — Analytics Collection | Complete ([plan](docs/module-17-plan.md)) |
| 18 — Weekly Performance Analysis | Complete ([plan](docs/module-18-plan.md)) |
| 19 — AI Strategy Optimization | Complete ([plan](docs/module-19-plan.md)) |

The app now has login, roles, protected routes, the central brand profile,
news discovery from configurable RSS sources, AI ranking that produces a daily
shortlist, a Slack notification that posts that shortlist to the team, and the
full news screen where a human selects exactly three stories for the day. Those
three are turned into a core message and a Facebook, Instagram and LinkedIn
version each, with a branded static card rendered for every one of them. The
content screen is now a review queue: a reviewer previews each platform
version, edits its copy, regenerates it, and approves or rejects it **per
platform**, with an "approve all" convenience that applies the same
per-platform approval to each eligible version. Status transitions are
enforced on the server; the story-level status is derived for display only and
never stored. A read-only calendar shows what is scheduled by month, week or
day in the company's configured timezone, filtered by platform and status,
alongside the approved versions still waiting for a slot. Approved versions can
now be given a slot: the time is picked in the company's timezone and stored as
UTC, only approved work can be scheduled, and two posts cannot land on one
account within fifteen minutes. An n8n tick reports what is due and verifies
each one's approval record, and a second signed tick publishes it.

The Facebook Page and Instagram adapters are built against Meta's Graph API
v26.0 and the publishing adapter contract (Module 16's, stubbed first as §20
requires). Instagram publishes in two steps — a media container, then a
publish once Meta reports it finished — and accepts JPEG only, which is why
Module 08 already stores that card as JPEG. OAuth tokens are stored encrypted
with AES-256-GCM and are never shown, logged or readable by any client.
`FACEBOOK_PROVIDER` and `INSTAGRAM_PROVIDER` each default to `mock` and are
separate switches, so nothing reaches a real account until one is set
deliberately, and the Social Accounts screen says REAL, MOCK or which module
still owes the integration rather than showing everything as "Not connected".

The Instagram account is reached **through** the Page it is linked to, so there
is no second Meta app — but it is a separate connection, and disconnecting one
leaves the other publishing. The account must be a Professional (Business or
Creator) account; a personal account has no API access at all.

LinkedIn publishes to a **member profile**, not a company Page: posting as a
Page needs the Community Management API, which is gated behind two-tier App
Review, a registered company and a verified Page (§66 — that is a documented
limitation, not a missing feature). Its post analytics are unavailable too,
because `r_member_social` is a closed permission LinkedIn is not granting.
Unlike Meta, LinkedIn
will not fetch an image from a URL — the card is downloaded and re-uploaded as
bytes — and its token **expires after 60 days with no refresh token**. That
expiry is read back from LinkedIn rather than assumed, and a signed daily tick
at `/api/webhooks/social/tokens` warns on Slack inside the last seven days so a
human can reconnect in time (§19).

The publishing engine joins those three adapters to the calendar. Every
pre-publish check — the approval record, the scheduled state, the previous
attempt and the platform's own post id — runs inside one transaction, and the
post id is checked first, so a retry can tell "already published" from "never
published" instead of creating a second post. A rate limit or a network fault
leaves the post scheduled for the next tick; a rejected token or a refused
image fails it outright with the reason stored. Terminal failures are
announced on Slack, because nothing retries them. Whether a publish was real
or simulated is recorded **on the post**, so a post published in mock mode
stays labelled that way even after a provider is switched on.

A signed daily-tick-style webhook (`08_analytics_sync`) reads back what
happened to every published post. Facebook reports real `likes`, `comments`
and `shares` (their sum as `engagement`); reach and impression metrics are
stored as `UNAVAILABLE` because Meta has been deprecating them and no
confirmed replacement metric name exists in primary documentation. Instagram
reports real `reach`, `likes`, `comments`, `shares` and `engagement`
(`total_interactions`), with `engagementRate` computed only when both halves
are real numbers; `impressions` is unavailable because Meta deprecated it for
feed media. LinkedIn stays unavailable, unchanged from Module 14. A
mock-published post gets deterministic simulated analytics, labelled `MOCK`,
and never touches a real credential or a real API call — §22's rule holds
throughout: a number is either what the platform actually returned or the
literal word `UNAVAILABLE`, never invented. Module 17 stores this in its own
`analytics` collection with a small read model.

Every week, a signed tick (`09_weekly_performance_analysis`) computes the
trailing 7 days' performance: best and weakest posts, and platform, topic and
format comparisons, all averaged only over posts Module 17 could actually
measure — a post with no usable analytics is excluded from every average
rather than counted as zero. One AI call then writes a short narrative and up
to six recommended changes, grounded only in those already-computed numbers,
and is skipped outright rather than invented when a week has nothing
measured to say. The Analytics screen (`/analytics`) reads the saved report:
overall performance, platform/topic/format comparison, top and weak posts,
and the engagement trend across recent weeks. Module 18 stops at reporting
what happened — the strategy recommendations that act on it, with versioning
and evidence citations, are Module 19.

A second signed tick (`10_strategy_optimization`) reads the last four weekly
reports and computes topic, platform and format weighting as each one's real
share of measured engagement over that window — never an AI-invented number.
One AI call then writes up to eight recommendations (§24: topic weighting,
platform weighting, posting frequency, content mix, headline style, CTA
style, format distribution, timing), each grounded in those weights with a
stated reason, skipped outright when nothing was measured. Every run adds a
new version rather than overwriting the last one, so "current strategy" is
just the highest version and nothing is ever silently lost — §24 permits the
strategy to change automatically precisely because that history stays
intact. **The strategy can change on its own; a post still always needs a
human's approval before it publishes** — nothing here writes a platform
post, and nothing here writes to the human-owned brand profile (§11) or
Module 06's fixed three-stories-a-day rule (§8) either, however a
recommendation might read. The Strategy screen (`/strategy`) shows the
current version, its recommendations, and version history, plus a
manual "Regenerate now" for ADMIN.

**AI calls and Slack messages are simulated by default.** `AI_PROVIDER` defaults to `mock`, so
nothing reaches a paid or rate-limited service until it is set deliberately,
and `SLACK_PROVIDER` defaults to `mock` so no message reaches a real
workspace. Every simulated result is labelled as such in the UI and stored as
`MOCK` (§21).

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui ·
Firebase (Firestore + Auth, Spark plan) · Cloudinary for media ·
Groq for AI (free plan, behind a provider abstraction) ·
Vitest · Playwright · Firebase Emulator Suite. Deployment target is the
Render free tier (spec §28).

## Setup

Requires Node 24+, npm 11+, and the Firebase CLI for the emulator tests.

```bash
npm install
cp .env.example .env.local   # then fill in real values
```

`.env.local` is git-ignored and must never be committed. `.env.example`
carries variable names and shapes only. Two groups matter (§57):
`NEXT_PUBLIC_*` variables reach the browser; everything else is server-only
and enforced as such by the `server-only` package.

`FIREBASE_ADMIN_PRIVATE_KEY` is pasted with literal `\n` sequences; the env
schema unescapes them. `TOKEN_ENCRYPTION_KEY` must be 64 hex characters
(32 bytes) — generate one with `openssl rand -hex 32`.

### Firebase project prerequisites

Before `npm run verify:services` can pass, the Firestore database must be
created in the Firebase console for the project named in
`FIREBASE_ADMIN_PROJECT_ID`. Creating the project alone is not enough — the
Firestore API stays disabled until a database exists.

**Then check the database's ID**, because it is not always what it looks
like:

```bash
firebase firestore:databases:list --project <project-id>
```

A project's first database is normally called `(default)` — parentheses
included, they are part of the literal name. Multi-database Firestore also
allows plain IDs, so a database can end up called `default` without them,
and that is a *different* database. Pointing at the wrong one fails as a
bare `5 NOT_FOUND` that names neither the database it tried nor the one that
exists.

If the ID is anything other than `(default)`, set both halves — they must
match, and `firebase.json`'s `database` field must match too or rules deploy
to a database that is not there:

```dotenv
FIREBASE_DATABASE_ID=default
NEXT_PUBLIC_FIREBASE_DATABASE_ID=default
```

## Commands

```bash
npm run dev              # development server
npm run verify           # typecheck + lint + format check + unit tests + build
npm run test             # Vitest unit tests
npm run test:rules       # Firestore rules tests against the emulator
npm run test:e2e         # Playwright tests that need no credentials
npm run test:e2e:auth    # full credentialed suite against the emulators (port 3100)
npm run verify:services  # live credential check against Firestore + Cloudinary
npm run emulators        # Firestore + Auth emulators
npm run provision:user   # create or update an account (see below)
npm run seed:sources     # add the verified news feeds (optional)
```

`npm run verify` is the offline quality gate (§59) — it needs no credentials
and no network. `verify:services` is the separate, deliberately manual check
that real credentials work.

## Accounts

There is no signup route and there must never be one (§26). Accounts are
created by an administrator with the Admin SDK:

```bash
npm run provision:user -- --email someone@company.com --role ADMIN --name "Full Name"
```

Roles are `ADMIN`, `MANAGER` and `SOCIAL_MANAGER` (§27). The role lives in a
Firebase Auth custom claim, which is what Security Rules and the server
trust; the copy on `profiles/{uid}` is for display only. Omitting
`--password` generates a temporary one and prints it once — the user should
sign in and reset it immediately.

The same script disables an account, revoking its sessions at the same time:

```bash
npm run provision:user -- --email someone@company.com --disable
```

The **first** ADMIN has to be created this way, before anything is reachable.

Firebase Authentication must be enabled in the console first (Authentication
→ Get started → Email/Password). Until it is, provisioning fails with
`auth/configuration-not-found`, which does not say what is missing.

## AI provider

§30 forbids coupling to one provider, so everything goes through a small
`AIProvider` interface with two adapters: Groq and a deterministic mock.

Groq was chosen against §29's free-tier-first policy: its free plan needs no
card and supports JSON-schema constrained decoding. Gemini's free tier was
rejected because its own pricing page states free-tier content is used to
improve Google's products, and the brand profile feeds these prompts.

The free plan allows 8,000 tokens a minute, which is the binding constraint —
ranking batches, truncates and paces itself accordingly.

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=...      # console.groq.com
```

Leave `AI_PROVIDER` unset (or `mock`) to simulate. A missing key with
`AI_PROVIDER=groq` fails loudly rather than falling back to simulated scores.

## Slack

The shortlist is posted with `chat.postMessage` using a bot token, rather than
an incoming webhook: a webhook URL is bound to one channel and its messages can
never be edited, and later modules need both (§9's publishing status, §41's
automation alerts).

```dotenv
SLACK_PROVIDER=slack
SLACK_BOT_TOKEN=xoxb-...     # api.slack.com/apps -> bot scope chat:write
SLACK_NEWS_CHANNEL_ID=C...   # the channel ID, not the #name
APP_BASE_URL=https://...     # only used for the links inside the message
```

Invite the app to the channel (`/invite @your-app`) or Slack answers
`not_in_channel`. Leave `SLACK_PROVIDER` unset (or `mock`) to simulate: the
message is written to the log instead of the workspace, and both the screen
and the stored record say so. A missing token or channel with
`SLACK_PROVIDER=slack` fails loudly rather than falling back to simulated
delivery.

**Slack's interactive buttons are UNAVAILABLE, not missing** (§66). They
require a public HTTPS request URL answered within three seconds, which this
system does not have until it is deployed. The message therefore carries link
buttons into the app, where §46's selection of exactly three happens.

## Static card rendering

Cards are rendered with Satori (JSX and a CSS subset to SVG) and resvg (SVG to
PNG), as §15 requires. Headless Chromium is not used.

Fonts ship with the repository in `assets/fonts` — Fontsource's latin 400 and
700 WOFF builds of the five families the brand form offers, 252 KB in total,
all SIL OFL 1.1 with the licence bundled alongside. They are not fetched at
render time, and they are not the variable builds Google Fonts now publishes:
Satori's font parser throws on those.

`satori`, `harfbuzzjs` and `@resvg/resvg-js` are listed in
`serverExternalPackages`. The native addon cannot be bundled at all, and a
bundled Satori resolves HarfBuzz's WebAssembly file against the wrong path and
fails only in a production build.

**Instagram's asset is stored as JPEG.** Its publishing API accepts no other
format. The conversion is a single eager one at upload; §28's credit pool is
shared between storage, bandwidth and transformations, so nothing transforms on
delivery.

## Notes on two deliberate choices

**Firestore rules start closed.** `firestore.rules` denies every read and
write. Each module opens exactly what it needs, and deny cases are tested,
not just allow cases (§58).

**Two layers guard every route, and only one of them counts.** `proxy.ts`
redirects when the session cookie is missing, but it runs on the Edge
runtime where the Admin SDK cannot run — it cannot tell a valid cookie from
a forged one. The real check is `requireUser()` in the authenticated layout
and in server routes. §33 is explicit that the Admin SDK bypasses Security
Rules, so server code authorizes itself.

**`/api/health` does nothing.** It is the keep-warm target for the n8n cron
that stops the Render free instance from spinning down (§28). It touches no
dependency and reveals no configuration, because it is unauthenticated. A
readiness check that probes dependencies must be a separate, authenticated
endpoint.

## Contributing

Conventional Commits (§62). Work happens on `feature/module-XX-*` branches
and merges into `develop` (§60). Never commit to `main` directly.
