# Module 05 — Slack News Notification: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-05-slack` (from `develop`).

---

## Step 1 — Read

§8 (the daily shortlist and its six required fields), §9 (the Slack workflow),
§21 (mock mode), §27 (roles), §28 (hosting, keep-warm and the three-second
problem), §29 (free-tier-first), §33, §44–§46, §52 (error handling), §55, §57,
§58, §63, §65 (anti-hallucination), §66 (REAL/MOCK/UNAVAILABLE/FUTURE), §67 (no
fake success).

## Step 2 — Inspect

| Item | State |
|---|---|
| Slack code | None |
| Shortlist | Module 04 writes `status: "SHORTLISTED"` with scores and `aiAnalysis` |
| Provider pattern | Module 04's `AIProvider` + factory + mock, reusable in shape |
| Webhook pattern | Signed HMAC route from Modules 03–04, reusable as-is |
| Permissions | `automations:manage` (ADMIN, MANAGER) already fits a notification trigger |
| Run records | `automationRuns` exists, but records *runs*, not deliveries |
| `/news` screen | Read-only list from Module 04, with a "Rank now" button |

## Step 3 — Plan

### The transport decision (§9, §29)

§9 requires implementing Slack's *actual* capabilities. Every claim below was
checked against Slack's own documentation on 2026-09-01, not recalled (§65):

| Option | Verified finding |
|---|---|
| **`chat.postMessage`** | `POST https://slack.com/api/chat.postMessage`, bot token, scope `chat:write`. Block Kit. Roughly one message per second per channel. **A refusal arrives as HTTP 200 with `{"ok": false, "error": ...}`** |
| Incoming webhook | `POST https://hooks.slack.com/services/…`, Block Kit — but bound to one channel, and its messages can never be updated or deleted |
| Interactivity | Needs a public HTTPS Request URL, acknowledged **within 3 seconds**; payload is form-encoded with a `payload` field; `response_url` is usable 5 times within 30 minutes |
| Request signing | `X-Slack-Signature: v0=…`, HMAC-SHA256 over `v0:<timestamp>:<raw body>`, five-minute replay window |

The owner chose **`chat.postMessage` with a bot token**. The incoming webhook
was rejected on capability, not on cost: both are free, but a message that can
never be edited rules out §9's later uses — publishing status and automation
alerts that update in place.

### Interactivity is UNAVAILABLE, and says so (§66)

Slack's three-second acknowledgement is not something this system can meet
today. §28 already records why: the app is not deployed, and once it is, the
free Render instance spins down after 15 minutes and takes about a minute to
wake. §9 says plainly: *do not invent Slack interaction capabilities.*

So the message carries **link buttons**, which need no Request URL and no
interactivity configuration. They open `/news`, where §46's selection of
exactly three happens — which is Module 06, not this one.

This is recorded as UNAVAILABLE rather than quietly omitted, in the README and
in the code that would otherwise look like an oversight.

### Scope

§63's five items: Slack integration, the daily shortlist notification, the
selected-story workflow as far as verified capabilities allow, error handling,
and notification logs.

**Not** in scope: the human choosing three (Module 06), content-ready and
publishing notifications (Modules 09 and 16), and the automation control centre
that will read these logs (Module 20).

### 3.1 The abstraction

`SlackNotifier` exposes one method — `post(channel, {text, blocks})` — and
returns the mode, channel and Slack's message timestamp. The endpoint, the bot
token and the 429 retry live behind the adapter; `notify.ts` never learns which
one ran.

Two adapters: `SlackWebApiNotifier` and `MockSlackNotifier`.

### 3.2 Mock mode (§21, §66)

The mock is the **default**, so no message reaches a real workspace by accident
and CI needs no token. It logs the message instead of sending it, and returns a
deterministic `ts` prefixed `MOCK.` — a value that cannot be mistaken for a real
Slack timestamp, and that does not make the suite flaky.

`mode` is **stored on every notification log entry**, not merely returned. §67
forbids ever saying "Slack notification sent" unless the integration confirmed
it, and a flag that only exists at call time is gone by the time anyone asks.

A missing `SLACK_BOT_TOKEN` or `SLACK_NEWS_CHANNEL_ID` with
`SLACK_PROVIDER=slack` **throws**. Falling back to mock would leave the system
logging deliveries into an empty channel.

### 3.3 The one Slack behaviour that must not be got wrong

`chat.postMessage` answers **HTTP 200 for refusals**. An adapter that checks
`response.ok` alone would report `not_in_channel` and `invalid_auth` as
successful deliveries — precisely the fake success §67 exists to prevent. The
adapter checks `body.ok`, maps the common error codes to something the person
reading the screen can act on, and passes unrecognised codes through verbatim
rather than flattening them into "Slack failed".

### 3.4 The message (§8)

§8 fixes six fields per story: headline, short summary, source, published date,
why it matters, and the relevance score. All six are in the message. Block Kit
limits — 50 blocks, 3,000 characters in a section, 150 in a header — are
enforced by truncation, not assumed. Two blocks per story keeps ten stories,
§8's ceiling, well inside the block limit.

Headlines are escaped for `&`, `<` and `>`: a headline containing markup would
otherwise render as something the publisher never wrote.

The message says a human picks three, so the top-scoring story is not read as a
decision already made.

### 3.5 Notification logs (§9, §52)

Every attempt is recorded — `SENT`, `FAILED` or `SKIPPED` — with the mode, the
channel, the story ids and the reason. Two things produce a skip: an empty
shortlist, and a shortlist already sent. Recording them means "nothing to say
today" cannot be confused with "the notification never ran".

`notificationLogs` is server-only in `firestore.rules`, like `automationRuns`
and `auditLogs`: a delivery record a client can write is not evidence that
anything was delivered.

### 3.6 Deduplication

n8n retries a failed step, and a retry that had actually succeeded would post
the shortlist twice. Scheduled triggers compare a fingerprint of the shortlist
against the last **successful** send and skip an exact repeat. Only sends count
— a failed attempt must not suppress the retry that would fix it.

A manual trigger always sends: a person clicking the button has asked for it.

### 3.7 Trigger

`POST /api/webhooks/news/notify` for n8n's `03_slack_news_notification`, signed
exactly as the discovery and ranking webhooks, plus a "Send to Slack" button on
`/news` for ADMIN and MANAGER. A delivery failure answers **502**, so n8n sees a
failed step; `SENT` and `SKIPPED` are both 200.

---

## Implementation record (§64 Steps 4–9)

### What shipped beyond the plan

| Addition | Why |
|---|---|
| Delivery history on `/news` | §59's gate asks for empty and error states, and §67 means an operator must be able to see that a send failed. A log nobody can read proves nothing |
| `NOTIFICATION_SENT` audit action | Not in §55's list, which predates the Slack workflow. A person pushing the shortlist to the team is an important action by §55's own standard, and reusing a listed action that means something else would make the trail worse |
| `(status, compositeScore)` index on `newsItems` | Slack sends the shortlist best-first, which is a different query from the screen's |

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 174 tests, 16 files (was 139/12) |
| Emulator rules tests | pass — 26 tests (was 25) |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 32 tests (was 28) |
| Production build | pass — `/api/webhooks/news/notify` added |

The credentialed run sends the shortlist end to end through the mock notifier,
asserts the screen says plainly that **nothing was sent to Slack**, and asserts
the stored delivery record carries a "Simulated" badge — the labelling §21
requires is tested, not assumed.

### Security and correctness review (§64 Step 7)

- **No silent downgrade.** `SLACK_PROVIDER=slack` without a token or channel
  throws rather than quietly simulating delivery.
- **No fake success.** `{"ok": false}` on an HTTP 200 is a failure; a mock send
  is never reported as a delivery; a skip is reported as a skip.
- **Mode is persisted.** Every notification record says whether a real message
  went out, so a simulated send cannot later be read as a real one.
- **Authorization.** The manual trigger sits under `automations:manage` (§27)
  and is re-checked inside the action; the webhook is HMAC-signed and its
  rejection reason goes to the log, never to the caller.
- **Secrets.** The bot token is server-only, never logged, and never included in
  an error surfaced to a caller; Slack error bodies are not echoed (§55).
- **Injection.** Headline and summary text is escaped before it enters mrkdwn.
- **Database access.** Notification logs are Admin-SDK-only and denied to every
  client in both directions.

### To switch from simulated to real delivery

```dotenv
SLACK_PROVIDER=slack
SLACK_BOT_TOKEN=xoxb-...      # api.slack.com/apps, bot scope chat:write
SLACK_NEWS_CHANNEL_ID=C...    # channel ID, not #name; invite the app first
APP_BASE_URL=https://...      # only used for links inside the message
```

Until then every message is labelled Simulated in the UI and stored as `MOCK`.

**Deploy the new indexes before the first real run:**
`firebase deploy --only firestore:indexes`.

### Next

Module 06 — Human News Selection.
