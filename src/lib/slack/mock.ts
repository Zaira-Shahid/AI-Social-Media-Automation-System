import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";
import type { SlackDeliveryResult, SlackMessage, SlackNotifier } from "@/lib/slack/notifier";

/**
 * Mock Slack notifier (spec §21, §58).
 *
 * The default, so no message reaches a real workspace by accident and CI needs
 * no token. It writes the message to the log instead of the network, which is
 * also the only way to eyeball the layout without a Slack app.
 *
 * The returned `ts` is deterministic — derived from the message — because a
 * random one makes a flaky suite, and because a value shaped like a real Slack
 * timestamp is easier to spot as fake when it never changes for the same input.
 */
export class MockSlackNotifier implements SlackNotifier {
  readonly name = "mock";
  readonly mode = "MOCK" as const;

  async post(channel: string, message: SlackMessage): Promise<SlackDeliveryResult> {
    logger.info("Slack notification simulated; nothing was sent", {
      channel,
      text: message.text,
      blocks: message.blocks.length,
    });

    return { mode: this.mode, channel, ts: simulatedTs(message.text) };
  }
}

function simulatedTs(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  return `MOCK.${digest.readUInt32BE(0)}`;
}
