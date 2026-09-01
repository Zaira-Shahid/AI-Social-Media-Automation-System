import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { SlackWebApiNotifier } from "@/lib/slack/api";
import { MockSlackNotifier } from "@/lib/slack/mock";
import type { SlackNotifier } from "@/lib/slack/notifier";

/**
 * Build the configured notifier and resolve its channel (spec §9, §21, §30).
 *
 * One place decides which adapter runs. Everything downstream asks for a
 * `SlackNotifier` and never learns which one it got, beyond the `mode` it has
 * to record and display (§66).
 */
export interface SlackTarget {
  notifier: SlackNotifier;
  channel: string;
}

/** Stands in for the channel id in mock mode, so the log entry is never blank. */
export const MOCK_CHANNEL = "#mock-news";

export function getSlackTarget(): SlackTarget {
  const env = getServerEnv();

  if (env.SLACK_PROVIDER === "slack") {
    /*
     * Both failures are loud rather than a fallback to mock. A silent
     * downgrade would leave the system logging "notification sent" while
     * nothing ever reached the workspace — §21 and §67 both forbid it.
     */
    if (!env.SLACK_BOT_TOKEN) {
      throw new Error(
        "SLACK_PROVIDER is 'slack' but SLACK_BOT_TOKEN is not set. " +
          "Set the bot token, or set SLACK_PROVIDER=mock to run simulated.",
      );
    }

    if (!env.SLACK_NEWS_CHANNEL_ID) {
      throw new Error(
        "SLACK_PROVIDER is 'slack' but SLACK_NEWS_CHANNEL_ID is not set. " +
          "Set the channel id the shortlist should be posted to.",
      );
    }

    return {
      notifier: new SlackWebApiNotifier(env.SLACK_BOT_TOKEN),
      channel: env.SLACK_NEWS_CHANNEL_ID,
    };
  }

  return {
    notifier: new MockSlackNotifier(),
    // A configured channel is still honoured in mock mode, so the log shows
    // where the message *would* have gone.
    channel: env.SLACK_NEWS_CHANNEL_ID ?? MOCK_CHANNEL,
  };
}

export type { SlackNotifier };
