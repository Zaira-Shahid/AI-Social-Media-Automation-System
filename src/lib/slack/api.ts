import "server-only";

import { logger } from "@/lib/logger";
import type { SlackDeliveryResult, SlackMessage, SlackNotifier } from "@/lib/slack/notifier";

/**
 * Slack Web API adapter (spec §9).
 *
 * Endpoint, authentication and error shape are from Slack's own reference for
 * `chat.postMessage`, verified 2026-09-01 — not recalled (§65):
 *
 * - `POST https://slack.com/api/chat.postMessage`
 * - bot token in the `Authorization: Bearer` header, scope `chat:write`
 * - a failure is HTTP 200 with `{"ok": false, "error": "..."}`, which is why
 *   `response.ok` alone is not a success check here
 * - rate limiting answers HTTP 429 with a `Retry-After` header in seconds
 *
 * The transport was chosen over an incoming webhook because a webhook URL is
 * bound to one channel and its messages can never be updated — and later
 * modules (§9's publishing status, §41's automation alerts) need both.
 */
const ENDPOINT = "https://slack.com/api/chat.postMessage";

/**
 * Slack's published allowance for `chat.postMessage` is roughly one message
 * per second per channel, with short bursts tolerated. This system sends a
 * handful of messages a day, so the limit is only ever reached by a retry
 * storm — hence one retry, not a loop.
 */
const MAX_RETRIES = 1;

/** Give up rather than hold a webhook request open for a long Retry-After. */
const MAX_RETRY_WAIT_MS = 30_000;

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  channel?: string;
  ts?: string;
}

/**
 * Turn a Slack error code into something the person reading the screen can act
 * on. Unrecognised codes are passed through verbatim rather than flattened
 * into "Slack failed", which would hide the one useful word in the response.
 */
function describe(error: string): string {
  switch (error) {
    case "channel_not_found":
      return "Slack rejected the channel: SLACK_NEWS_CHANNEL_ID does not match a channel this app can see.";
    case "not_in_channel":
      return "The Slack app is not a member of that channel. Invite it with /invite @your-app.";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return "Slack rejected the bot token. It may have been revoked or the app uninstalled.";
    case "missing_scope":
      return "The Slack bot token is missing the chat:write scope.";
    case "invalid_blocks":
      return "Slack rejected the message layout.";
    default:
      return `Slack refused the message: ${error}.`;
  }
}

export class SlackWebApiNotifier implements SlackNotifier {
  readonly name = "slack";
  readonly mode = "REAL" as const;

  constructor(private readonly botToken: string) {}

  async post(channel: string, message: SlackMessage): Promise<SlackDeliveryResult> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel, text: message.text, blocks: message.blocks }),
      });

      if (response.status === 429) {
        const waitMs = retryAfterMs(response.headers.get("retry-after"));

        if (attempt >= MAX_RETRIES || waitMs > MAX_RETRY_WAIT_MS) {
          throw new Error(
            "Slack rate limit reached; the notification was not sent. Slack allows about one message per second per channel.",
          );
        }

        logger.warn("Slack rate limited the notification; retrying once", { waitMs });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!response.ok) {
        // The status only. A Slack error body can echo the message content,
        // and the request carried a bot token (§55).
        logger.error("Slack request failed", { status: response.status });
        throw new Error(`Slack request failed with status ${response.status}.`);
      }

      const body = (await response.json().catch(() => ({}))) as SlackApiResponse;

      /*
       * The important part: Slack answers 200 for refusals too. Treating an
       * HTTP 200 as delivery would let the UI say "notification sent" when
       * nothing was posted — exactly what §67 forbids.
       */
      if (!body.ok) {
        const code = body.error ?? "unknown_error";
        logger.error("Slack refused the message", { error: code, channel });
        throw new Error(describe(code));
      }

      if (!body.ts) throw new Error("Slack accepted the message but returned no timestamp.");

      return { mode: this.mode, channel: body.channel ?? channel, ts: body.ts };
    }
  }
}

/** `Retry-After` is in seconds. A missing or malformed value falls back to one second. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000;
}
