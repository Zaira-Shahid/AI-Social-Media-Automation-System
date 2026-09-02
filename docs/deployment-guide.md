# Deployment Guide

Spec §23, §28, §44, §56, §57. Written so the actual account-level actions —
the parts nobody but you can do — are the only steps left once you follow
this.

## Before you start

You need, already in hand:

- A Firebase project with Firestore and Authentication (Email/Password)
  enabled, and its **Admin SDK service account** credentials (Project
  settings → Service accounts → Generate new private key).
- The Firebase **web app config** (Project settings → General → Your apps).
- A Cloudinary account (cloud name, API key, API secret).
- `TOKEN_ENCRYPTION_KEY` — generate one: `openssl rand -hex 32`.
- `N8N_WEBHOOK_SECRET` — any long random string; n8n will need the same
  value to sign its requests. Generate one the same way.

If you've been running this project locally against a real Firebase
project (not the emulator), you already have all of the above in
`.env.local` — the same project can be reused for production. There is
nothing in the code that assumes separate dev/prod Firebase projects.

## 1. Push to GitHub

Already done if you're reading this from the repo — Render deploys straight
from a connected GitHub repository, not a manual upload.

## 2. Create the Render service

1. [render.com](https://render.com) → New → Blueprint.
2. Connect this GitHub repository. Render reads `render.yaml` at the repo
   root and proposes the service automatically — free plan, Oregon region,
   `npm install && npm run build` / `npm run start`, health check at
   `/api/health`, exactly what §28 assumed throughout this build.
3. Render will stop and ask you to fill in every variable marked
   `sync: false` in `render.yaml` before it will deploy. That list, and
   where each value comes from, is identical to `.env.example` — the two
   files are kept in sync deliberately. The short version:

   | Variable | Where it comes from |
   |---|---|
   | `NEXT_PUBLIC_FIREBASE_*` (5) | Firebase console → Project settings → General → Your apps |
   | `FIREBASE_ADMIN_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | The service account JSON — three fields, not the file. Paste the private key with its literal `\n` sequences intact. |
   | `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | Cloudinary dashboard |
   | `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` |
   | `N8N_WEBHOOK_SECRET` | Any long random string — n8n needs the same one |
   | `APP_BASE_URL` | Your Render URL, e.g. `https://ai-social-media-automation.onrender.com` — fill this in **after** step 3, once Render assigns it |
   | `GROQ_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_NEWS_CHANNEL_ID`, `FACEBOOK_APP_ID`/`_SECRET`, `LINKEDIN_CLIENT_ID`/`_SECRET` | Only if you're turning that provider on now — see §4 below. Leave blank otherwise; every provider defaults to `mock` in `render.yaml` and the app boots fine without them. |

4. Deploy. First build takes a few minutes.

## 3. Verify it's alive

```bash
curl https://your-app.onrender.com/api/health
# {"status":"ok"}
```

Then sign in at `/login` with an account already provisioned in this
Firebase project (§26 — there is no signup route). If none exists yet:

```bash
npm run provision:user -- --email you@company.com --role ADMIN --name "Your Name"
```

run locally with `.env.local` pointed at the same Firebase project — this
step talks to Firebase directly, not to Render, so it works before or after
the app is live.

## 4. Turn on real providers, one at a time

Every provider ships `mock` by default (§21) — the app is fully usable and
demonstrable with nothing turned on. Flip one only once you actually have
its credentials, by editing the corresponding env var in Render's dashboard
and setting the matching `*_PROVIDER` value:

- **AI**: `AI_PROVIDER=groq` + `GROQ_API_KEY` (free, no card — console.groq.com)
- **Slack**: `SLACK_PROVIDER=slack` + `SLACK_BOT_TOKEN` + `SLACK_NEWS_CHANNEL_ID`
- **Facebook / Instagram**: `FACEBOOK_PROVIDER=graph` / `INSTAGRAM_PROVIDER=graph` + `FACEBOOK_APP_ID`/`_SECRET`, then connect the account from `/social-accounts`
- **LinkedIn**: `LINKEDIN_PROVIDER=rest` + `LINKEDIN_CLIENT_ID`/`_SECRET`, then connect from `/social-accounts`

Each is independent — turning one on never silently enables another.

## 5. Wire up n8n

n8n is the scheduler (§44) — this app has no cron of its own. Every trigger
is an HTTP Request node: `POST` to the URL, with two headers computed from
`N8N_WEBHOOK_SECRET`:

```
x-timestamp: <current Unix ms, as a string>
x-signature: HMAC-SHA256(secret, "<timestamp>.<raw JSON body>") — hex
```

(`src/lib/webhooks/signature.ts` is the exact scheme, if n8n's own HMAC node
needs the reference.)

| Workflow | Method | Path | Suggested schedule |
|---|---|---|---|
| `01_daily_news_discovery` | POST | `/api/webhooks/news/ingest` | Daily, ~10:00 (§3) |
| `02_news_ranking` | POST | `/api/webhooks/news/rank` | Right after discovery |
| `03_slack_news_notification` | POST | `/api/webhooks/news/notify` | Right after ranking |
| `04_news_selection_processing` | POST | `/api/webhooks/content/generate` | After a human selects 3 stories |
| Card rendering | POST | `/api/webhooks/content/render` | Right after generation |
| `07_scheduled_publishing` (due check) | POST | `/api/webhooks/content/due` | Every few minutes |
| `07_scheduled_publishing` (publish) | POST | `/api/webhooks/content/publish` | Every few minutes, right after the due check |
| `08_analytics_sync` | POST | `/api/webhooks/content/analytics-sync` | Daily |
| `09_weekly_performance_analysis` | POST | `/api/webhooks/content/weekly-analysis` | Weekly |
| `10_strategy_optimization` | POST | `/api/webhooks/content/strategy-optimization` | Weekly, right after the weekly report |
| Token-expiry warning | POST | `/api/webhooks/social/tokens` | Daily |

Every one of these can also be triggered by hand from `/automation`
("Run now", ADMIN/MANAGER) — useful for testing the wiring before trusting
the schedule.

**Keep-warm.** Render's free tier spins down after 15 minutes idle and
takes about a minute to cold-start (docs/hosting-and-domain-research.md).
That breaks Slack's 3-second interactivity deadline the moment a request
arrives cold. Add one more n8n trigger, `GET /api/health`, on a ~10-minute
schedule — it does no privileged work (§28) and exists exactly for this.

## 6. Final smoke test

- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] Sign in, sign out
- [ ] Every nav item a role should see is visible; nothing a role shouldn't reaches beyond `/forbidden`
- [ ] Trigger `01_daily_news_discovery` from `/automation`, confirm items appear on `/news`
- [ ] Select 3 stories, generate content, render cards, approve, schedule, publish (mock is fine) — confirm the post reaches `/calendar` and then shows `PUBLISHED`
- [ ] `/analytics` and `/strategy` show data after `weekly-analysis` and `strategy-optimization` have run at least once
- [ ] `/automation` shows a run for everything just triggered, and `/automation/audit` shows the corresponding entries
