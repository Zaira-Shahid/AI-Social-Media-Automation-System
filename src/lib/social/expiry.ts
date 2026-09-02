import "server-only";

import { getSlackTarget } from "@/lib/slack";
import type { DeliveryMode } from "@/lib/slack/notifier";
import { logger } from "@/lib/logger";
import {
  EXPIRY_WARNING_DAYS,
  statusForExpiry,
  type TokenStatus,
  type SocialAccount,
} from "@/lib/social/schema";
import { listSocialAccounts } from "@/lib/social/store";

/**
 * Token expiry warnings (spec §19, §41, §52, §67).
 *
 * §19 is specific: LinkedIn issues no refresh token on the self-serve tier and
 * its access token dies after 60 days, so "track `expiresAt` and send a Slack
 * alert 5–7 days before expiry so a human can re-authorize in time".
 *
 * Module 12 built the `EXPIRING` state for this and nothing consumed it, which
 * was correct then — no connected credential actually expired. Module 14 is
 * where that stops being hypothetical, so this is where the alert lands.
 *
 * Read-only by design. It derives status from the stored `expiresAt` and
 * reports; it never rewrites a stored status, because only the platform
 * refusing a token can establish REVOKED (§19), and a warning is not a
 * refusal.
 */

export interface ExpiringAccount {
  platform: SocialAccount["platform"];
  accountName: string;
  status: TokenStatus;
  expiresAt: string;
  /** Whole days remaining; negative once it has lapsed. */
  daysRemaining: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Every connected account whose token is expiring or already expired.
 *
 * An account with no expiry — a Facebook Page token, an Instagram one — is
 * never listed. `null` there is a real answer, not a missing one, and warning
 * about a credential that does not expire would train people to ignore this.
 */
export async function collectExpiringAccounts(now: Date = new Date()): Promise<ExpiringAccount[]> {
  const accounts = await listSocialAccounts();

  return accounts
    .filter((account) => account.expiresAt !== null)
    .map((account) => {
      const expiresAt = account.expiresAt as string;
      const derived = statusForExpiry(expiresAt, now);

      return {
        platform: account.platform,
        accountName: account.accountName,
        status: derived,
        expiresAt,
        daysRemaining: Math.floor((new Date(expiresAt).getTime() - now.getTime()) / MS_PER_DAY),
      };
    })
    .filter((account) => account.status === "EXPIRING" || account.status === "EXPIRED")
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

function describe(account: ExpiringAccount): string {
  if (account.status === "EXPIRED") {
    return `*${account.platform}* — ${account.accountName}: the token *expired* on ${account.expiresAt}. Publishing to it is failing now.`;
  }

  const days = account.daysRemaining;

  return `*${account.platform}* — ${account.accountName}: the token expires in ${days} day${
    days === 1 ? "" : "s"
  } (${account.expiresAt}).`;
}

export interface ExpiryAlertOutcome {
  checked: number;
  expiring: ExpiringAccount[];
  /** Whether a message was actually sent, and whether it was simulated (§21). */
  alerted: boolean;
  mode: DeliveryMode | null;
}

/**
 * Check every connected account and warn on Slack if any is running out.
 *
 * Silence when nothing is expiring is deliberate: an alert channel that posts
 * "all fine" every day is one nobody reads by the time it matters.
 *
 * A Slack failure is not swallowed — it is logged and rethrown, so the caller
 * records the run as failed rather than reporting an alert that never
 * happened (§67).
 */
export async function alertOnExpiringTokens(now: Date = new Date()): Promise<ExpiryAlertOutcome> {
  const accounts = await listSocialAccounts();
  const expiring = await collectExpiringAccounts(now);

  if (expiring.length === 0) {
    return { checked: accounts.length, expiring, alerted: false, mode: null };
  }

  const { notifier, channel } = getSlackTarget();

  const lines = expiring.map(describe);
  const text = `${expiring.length} social token(s) need attention`;

  await notifier.post(channel, {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Social tokens need attention" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `LinkedIn issues no refresh token, so this has to be done by hand: reconnect on the Social Accounts screen. Warning window is ${EXPIRY_WARNING_DAYS} days.`,
          },
        ],
      },
    ],
  });

  logger.warn("Alerted on expiring social tokens", {
    count: expiring.length,
    platforms: expiring.map((account) => account.platform),
  });

  return { checked: accounts.length, expiring, alerted: true, mode: notifier.mode };
}
