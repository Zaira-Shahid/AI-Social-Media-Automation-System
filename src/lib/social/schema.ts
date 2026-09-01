import { z } from "zod";

import { platformSchema } from "@/lib/content/schema";

/**
 * Connected social accounts (spec §19, §32, §42).
 *
 * One document per platform, keyed by the platform name, so there is exactly
 * one connected account per network and reconnecting replaces rather than
 * accumulates.
 *
 * `firestore.rules` denies every client read and write here. Encryption is a
 * second layer, not a substitute for that (§19).
 */
export const SOCIAL_ACCOUNTS_COLLECTION = "socialAccounts";

/**
 * §19's token states.
 *
 * EXPIRING exists because LinkedIn's 60-day token cannot be refreshed
 * programmatically on the self-serve tier — a human has to act before it
 * lapses, and a state that only flips on the day it dies is no warning at all.
 */
export const tokenStatusSchema = z.enum(["VALID", "EXPIRING", "EXPIRED", "REVOKED"]);

export type TokenStatus = z.infer<typeof tokenStatusSchema>;

export const socialAccountSchema = z.object({
  platform: platformSchema,
  /**
   * The account posts go to — a Facebook Page id, an Instagram user id, a
   * LinkedIn URN. Not a secret, and needed to show which account is connected.
   */
  accountId: z.string().min(1),
  /** What a human calls that account, for §42's screen. */
  accountName: z.string().min(1),

  /** Ciphertext from `encryptToken`. Never a readable token (§19). */
  accessTokenEncrypted: z.string().min(1),
  /** Null where the platform issues none — Facebook Page tokens, LinkedIn. */
  refreshTokenEncrypted: z.string().nullable(),

  /**
   * When the token stops working, or null where it does not expire.
   *
   * Null is a real answer here, not a missing one: a long-lived Facebook Page
   * token has no expiry date, and storing a fabricated one would put a
   * meaningless countdown on §42's screen.
   */
  expiresAt: z.string().datetime().nullable(),
  lastRefreshedAt: z.string().datetime().nullable(),
  status: tokenStatusSchema,

  connectedAt: z.string().datetime(),
  /** UID of whoever connected it (§55). */
  connectedBy: z.string().min(1),

  /** Why the last publish or refresh failed, or null (§52). */
  lastError: z.string().nullable(),
});

export type SocialAccount = z.infer<typeof socialAccountSchema>;

/**
 * The account as the UI is allowed to see it (§42: never expose tokens).
 *
 * A separate type rather than a convention, so handing a token to a client
 * component would be a type error rather than an oversight.
 */
export interface SocialAccountView {
  platform: SocialAccount["platform"];
  accountId: string;
  accountName: string;
  expiresAt: string | null;
  status: TokenStatus;
  connectedAt: string;
  lastError: string | null;
}

export function toAccountView(account: SocialAccount): SocialAccountView {
  return {
    platform: account.platform,
    accountId: account.accountId,
    accountName: account.accountName,
    expiresAt: account.expiresAt,
    status: account.status,
    connectedAt: account.connectedAt,
    lastError: account.lastError,
  };
}

/**
 * How close to expiry counts as EXPIRING (§19).
 *
 * §19 asks for a Slack alert 5–7 days before a LinkedIn token lapses. The
 * state that alert reads has to be true before the alert fires, so the window
 * is the wider end of that range.
 */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * The status a stored expiry implies right now.
 *
 * REVOKED is never derived — only the platform refusing the token can
 * establish that, so it is written by whoever saw the refusal.
 */
export function statusForExpiry(expiresAt: string | null, now: Date): TokenStatus {
  if (!expiresAt) return "VALID";

  const remaining = new Date(expiresAt).getTime() - now.getTime();

  if (remaining <= 0) return "EXPIRED";
  if (remaining <= EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000) return "EXPIRING";

  return "VALID";
}
