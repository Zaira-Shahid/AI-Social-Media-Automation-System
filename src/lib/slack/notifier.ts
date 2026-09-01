/**
 * Slack notification abstraction (spec §9, §21, §30).
 *
 * §9 is explicit that Slack must be implemented against the API's actual
 * capabilities, not an imagined one. So the contract here is only what
 * `chat.postMessage` really offers: post a message, made of Block Kit blocks
 * plus fallback text, to a channel, and tell the caller whether it landed.
 *
 * Everything Slack-shaped — the endpoint, the bot token, retries on a 429 —
 * lives behind an adapter. The notification pipeline in `lib/slack/notify.ts`
 * never learns which one ran, beyond the `mode` it must record and display.
 */

/**
 * Whether the message actually reached Slack, or was simulated (§21, §66).
 *
 * Stored on every notification log entry, not merely returned. §67 forbids
 * ever saying "Slack notification sent" unless the integration confirmed it,
 * and a flag that exists only at call time is gone by the time anyone asks.
 */
export type DeliveryMode = "REAL" | "MOCK";

/** A Block Kit block. Shape is Slack's; this code only ever passes it along. */
export type SlackBlock = Record<string, unknown>;

export interface SlackMessage {
  /**
   * Fallback text.
   *
   * Required in practice even when `blocks` carries the content: it is what
   * shows in notifications and in clients that cannot render blocks, and
   * `chat.postMessage` answers `no_text` without it.
   */
  text: string;
  blocks: SlackBlock[];
}

export interface SlackDeliveryResult {
  mode: DeliveryMode;
  /** The channel the message went to, for the log. Never the token. */
  channel: string;
  /**
   * Slack's message timestamp — its identifier for the posted message.
   *
   * Later modules use it to thread replies or update a posted message
   * (§9's "content ready for review" and publishing status updates).
   */
  ts: string;
}

export interface SlackNotifier {
  readonly name: string;
  readonly mode: DeliveryMode;

  /**
   * Post one message.
   *
   * Throws when Slack refuses it or cannot be reached. Callers treat that as
   * "the notification did not happen" and record a FAILED log entry — never
   * as a quiet success (§67).
   */
  post(channel: string, message: SlackMessage): Promise<SlackDeliveryResult>;
}
