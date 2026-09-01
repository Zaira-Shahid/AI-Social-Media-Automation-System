import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import type { Platform } from "@/lib/content/schema";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { decryptToken } from "@/lib/social/crypto";
import {
  socialAccountSchema,
  statusForExpiry,
  SOCIAL_ACCOUNTS_COLLECTION,
  type SocialAccount,
} from "@/lib/social/schema";

/**
 * Connected account storage (spec §19, §33, §55).
 *
 * Admin SDK only, and `firestore.rules` denies every client read as well as
 * every write: a token nobody can read is still a token nobody should be able
 * to fetch the ciphertext of.
 *
 * Nothing here logs a token, encrypted or decrypted (§19).
 */

function accounts() {
  return getAdminFirestore().collection(SOCIAL_ACCOUNTS_COLLECTION);
}

/** One document per platform, so reconnecting replaces rather than piles up. */
function documentId(platform: Platform): string {
  return platform;
}

export async function saveSocialAccount(account: SocialAccount): Promise<void> {
  const parsed = socialAccountSchema.parse(account);

  await accounts()
    .doc(documentId(parsed.platform))
    .set({ ...parsed, updatedAt: FieldValue.serverTimestamp() });

  logger.info("Social account connected", {
    platform: parsed.platform,
    accountId: parsed.accountId,
  });
}

export async function getSocialAccount(platform: Platform): Promise<SocialAccount | null> {
  const snapshot = await accounts().doc(documentId(platform)).get();

  if (!snapshot.exists) return null;

  const parsed = socialAccountSchema.safeParse(snapshot.data());

  if (!parsed.success) {
    logger.warn("Stored social account did not match the schema; treating as not connected", {
      platform,
    });
    return null;
  }

  return parsed.data;
}

/** Every connected account, for §42's screen. Tokens are stripped by callers. */
export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const snapshot = await accounts().get();

  return snapshot.docs
    .map((document) => socialAccountSchema.safeParse(document.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

export async function deleteSocialAccount(platform: Platform): Promise<void> {
  await accounts().doc(documentId(platform)).delete();

  logger.info("Social account disconnected", { platform });
}

/**
 * Record that the platform refused this credential (§19, §52).
 *
 * The status is set by whoever saw the refusal, never guessed from a
 * timestamp: only the platform can tell us a token was revoked.
 */
export async function markAccountProblem(
  platform: Platform,
  status: SocialAccount["status"],
  reason: string,
): Promise<void> {
  await accounts()
    .doc(documentId(platform))
    .set({ status, lastError: reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  logger.error("Social account credential problem", { platform, status, reason });
}

export interface UsableCredentials {
  accountId: string;
  accessToken: string;
}

/**
 * The credentials to publish with, or a reason there are none (§19, §49).
 *
 * §49's "verify social account" step, and §19's rule that an expired token
 * must fail loudly rather than silently. The refusal is a value the caller
 * stores on the post, not an exception it might forget to catch.
 */
export async function getUsableCredentials(
  platform: Platform,
  now: Date = new Date(),
): Promise<{ ok: true; credentials: UsableCredentials } | { ok: false; reason: string }> {
  const account = await getSocialAccount(platform);

  if (!account) {
    return { ok: false, reason: `No ${platform} account is connected.` };
  }

  if (account.status === "REVOKED") {
    return {
      ok: false,
      reason: `The ${platform} credential was revoked and must be reconnected.`,
    };
  }

  const derived = statusForExpiry(account.expiresAt, now);

  if (derived === "EXPIRED") {
    return {
      ok: false,
      reason: `The ${platform} credential expired on ${account.expiresAt}. Reconnect the account.`,
    };
  }

  return {
    ok: true,
    credentials: {
      accountId: account.accountId,
      // Throws on a tampered or unreadable record, which is the intended
      // behaviour: publishing with a credential we cannot verify is worse
      // than not publishing (§19).
      accessToken: decryptToken(account.accessTokenEncrypted),
    },
  };
}
