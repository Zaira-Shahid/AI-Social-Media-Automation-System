"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { exchangeForLongLivedUserToken, listPages } from "@/lib/publishing/facebook";
import { findInstagramAccount } from "@/lib/publishing/instagram";
import { fetchMemberIdentity, introspectToken, missingScopes } from "@/lib/publishing/linkedin";
import { encryptToken } from "@/lib/social/crypto";
import { deleteSocialAccount, saveSocialAccount } from "@/lib/social/store";

/**
 * Connecting and disconnecting accounts (spec §19, §42, §56).
 *
 * The connect step takes a **user access token** obtained from Meta and turns
 * it into a stored, encrypted **Page token**. It never receives or stores the
 * app secret from the browser: the secret lives in the server environment, and
 * the exchange happens here, which is what Meta's own documentation requires.
 *
 * No token — given, exchanged or stored — is ever logged or returned to the
 * client (§19, §42).
 */
export interface ConnectFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function connectFacebook(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;

  const user = await requirePermission("integrations:manage");
  const env = getServerEnv();

  const userToken = String(form.get("userToken") ?? "").trim();
  const pageId = String(form.get("pageId") ?? "").trim();

  if (!userToken) {
    return { status: "error", message: "Paste the user access token from Meta first." };
  }

  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    /*
     * Loud rather than a partial success. Without the app credentials the
     * token cannot be exchanged for a long-lived one, and storing the
     * short-lived token instead would produce an account that silently stops
     * working in an hour (§67).
     */
    return {
      status: "error",
      message:
        "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are not set, so the token cannot be exchanged for a long-lived one.",
    };
  }

  try {
    const longLived = await exchangeForLongLivedUserToken(
      env.FACEBOOK_APP_ID,
      env.FACEBOOK_APP_SECRET,
      userToken,
    );

    const pages = await listPages(longLived.accessToken);

    if (pages.length === 0) {
      return {
        status: "error",
        message:
          "That token administers no Pages. Check the token was granted pages_show_list and that the account has a role on the Page.",
      };
    }

    const page = pageId ? pages.find((candidate) => candidate.id === pageId) : pages[0];

    if (!page) {
      return {
        status: "error",
        message: `That token administers ${pages.length} Page(s), and none of them is ${pageId}.`,
      };
    }

    await saveSocialAccount({
      platform: "FACEBOOK",
      accountId: page.id,
      accountName: page.name,
      accessTokenEncrypted: encryptToken(page.accessToken),
      // Meta issues no refresh token for Pages; the Page token itself is the
      // long-lived credential.
      refreshTokenEncrypted: null,
      /*
       * Null, and deliberately so: Meta documents long-lived Page tokens as
       * having no expiration date. Inventing 60 days here would put a false
       * countdown on this screen.
       */
      expiresAt: null,
      lastRefreshedAt: new Date().toISOString(),
      status: "VALID",
      connectedAt: new Date().toISOString(),
      connectedBy: user.uid,
      lastError: null,
    });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/FACEBOOK",
      status: "SUCCESS",
      // The Page, never the token (§19, §55).
      metadata: { pageId: page.id, pageName: page.name },
    });

    revalidatePath("/social-accounts");

    return { status: "success", message: `Connected ${page.name}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // The message can quote Meta's own refusal, which never contains the
    // token — but the token was in the request, so nothing else is logged.
    logger.error("Could not connect the Facebook Page", { error: message });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/FACEBOOK",
      status: "FAILURE",
    });

    return { status: "error", message };
  }
}

export async function disconnectFacebook(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;
  void form;

  const user = await requirePermission("integrations:manage");

  await deleteSocialAccount("FACEBOOK");

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: "socialAccounts/FACEBOOK",
    status: "SUCCESS",
    metadata: { disconnected: true },
  });

  revalidatePath("/social-accounts");

  return { status: "success", message: "Disconnected. Nothing can publish to the Page now." };
}

/**
 * Connect the Instagram professional account behind a Page (§19, §42, §56).
 *
 * Same shape as the Facebook connect, and deliberately so — but a separate
 * connection, not a side effect of the Facebook one. The two accounts are
 * disconnected independently, and publishing to one must never depend on the
 * other still being connected.
 *
 * The Page token is what publishes: Meta reaches the Instagram account
 * through the Page it is linked to, so the credential stored here is the Page
 * token paired with the **Instagram** user id.
 */
export async function connectInstagram(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;

  const user = await requirePermission("integrations:manage");
  const env = getServerEnv();

  const userToken = String(form.get("userToken") ?? "").trim();
  const pageId = String(form.get("pageId") ?? "").trim();

  if (!userToken) {
    return { status: "error", message: "Paste the user access token from Meta first." };
  }

  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    return {
      status: "error",
      message:
        "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are not set, so the token cannot be exchanged for a long-lived one.",
    };
  }

  try {
    const longLived = await exchangeForLongLivedUserToken(
      env.FACEBOOK_APP_ID,
      env.FACEBOOK_APP_SECRET,
      userToken,
    );

    const pages = await listPages(longLived.accessToken);

    if (pages.length === 0) {
      return {
        status: "error",
        message:
          "That token administers no Pages. Instagram publishing goes through the Page its account is linked to, so a Page is required.",
      };
    }

    const page = pageId ? pages.find((candidate) => candidate.id === pageId) : pages[0];

    if (!page) {
      return {
        status: "error",
        message: `That token administers ${pages.length} Page(s), and none of them is ${pageId}.`,
      };
    }

    const account = await findInstagramAccount(page.id, page.name, page.accessToken);

    await saveSocialAccount({
      platform: "INSTAGRAM",
      // The IG user id, not the Page id: this is what publishing posts to.
      accountId: account.id,
      accountName: `@${account.username} (via ${account.pageName})`,
      accessTokenEncrypted: encryptToken(page.accessToken),
      refreshTokenEncrypted: null,
      /*
       * Null for the same reason as Facebook: this is a long-lived Page
       * token, which Meta documents as having no expiration date. A
       * fabricated countdown would be worse than none (§67).
       */
      expiresAt: null,
      lastRefreshedAt: new Date().toISOString(),
      status: "VALID",
      connectedAt: new Date().toISOString(),
      connectedBy: user.uid,
      lastError: null,
    });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/INSTAGRAM",
      status: "SUCCESS",
      // The account, never the token (§19, §55).
      metadata: { instagramUserId: account.id, username: account.username, pageId: page.id },
    });

    revalidatePath("/social-accounts");

    return { status: "success", message: `Connected @${account.username}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Could not connect the Instagram account", { error: message });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/INSTAGRAM",
      status: "FAILURE",
    });

    return { status: "error", message };
  }
}

export async function disconnectInstagram(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;
  void form;

  const user = await requirePermission("integrations:manage");

  await deleteSocialAccount("INSTAGRAM");

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: "socialAccounts/INSTAGRAM",
    status: "SUCCESS",
    metadata: { disconnected: true },
  });

  revalidatePath("/social-accounts");

  return { status: "success", message: "Disconnected. Nothing can publish to the account now." };
}

/**
 * Connect a LinkedIn member profile (§19, §42, §56).
 *
 * A pasted token again, but for a different reason than Meta's. LinkedIn's
 * 3-legged OAuth needs a registered redirect URL answered over HTTPS, and this
 * system has none until it is deployed (§28) — the same constraint that made
 * §66 mark Slack's interactive buttons UNAVAILABLE. LinkedIn's developer
 * portal issues a token directly for an app's own owner, which is exactly the
 * case here, so that is what this takes.
 *
 * Unlike Meta, the stored `expiresAt` is a real date: it is read back from
 * LinkedIn's token introspection rather than assumed to be sixty days out.
 */
export async function connectLinkedIn(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;

  const user = await requirePermission("integrations:manage");
  const env = getServerEnv();

  const accessToken = String(form.get("accessToken") ?? "").trim();

  if (!accessToken) {
    return { status: "error", message: "Paste the LinkedIn access token first." };
  }

  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    /*
     * Loud rather than a partial success. Without them the token's real
     * expiry cannot be established, and §19 requires tracking it — storing the
     * token with a guessed date would put a false countdown on the screen and
     * silently miss the window a human needs to act in (§67).
     */
    return {
      status: "error",
      message:
        "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are not set, so the token's real expiry cannot be established.",
    };
  }

  try {
    const introspection = await introspectToken(
      env.LINKEDIN_CLIENT_ID,
      env.LINKEDIN_CLIENT_SECRET,
      accessToken,
    );

    if (!introspection.active) {
      return {
        status: "error",
        message: `LinkedIn reports that token as ${introspection.status ?? "inactive"}. Generate a fresh one.`,
      };
    }

    const missing = missingScopes(introspection.scopes);

    if (missing.length > 0) {
      /*
       * Checked now rather than discovered at publish time. A token missing
       * w_member_social connects perfectly and then fails on the first real
       * post, which is the worst moment to learn it.
       */
      return {
        status: "error",
        message: `That token is missing the ${missing.join(", ")} scope(s). Add the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products to the app and generate a new token.`,
      };
    }

    const member = await fetchMemberIdentity(accessToken);

    await saveSocialAccount({
      platform: "LINKEDIN",
      accountId: member.urn,
      accountName: member.name,
      accessTokenEncrypted: encryptToken(accessToken),
      // LinkedIn issues no refresh token on this tier — §19 says so, and
      // storing a null here is what makes the expiry warning necessary.
      refreshTokenEncrypted: null,
      expiresAt: introspection.expiresAt,
      lastRefreshedAt: new Date().toISOString(),
      status: "VALID",
      connectedAt: new Date().toISOString(),
      connectedBy: user.uid,
      lastError: null,
    });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/LINKEDIN",
      status: "SUCCESS",
      // The member and the expiry, never the token (§19, §55).
      metadata: { memberUrn: member.urn, expiresAt: introspection.expiresAt },
    });

    revalidatePath("/social-accounts");

    return {
      status: "success",
      message: introspection.expiresAt
        ? `Connected ${member.name}. This token expires ${introspection.expiresAt} and cannot be refreshed automatically.`
        : `Connected ${member.name}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Could not connect the LinkedIn profile", { error: message });

    await recordAudit({
      actor: user.uid,
      action: "SETTINGS_CHANGED",
      resource: "socialAccounts/LINKEDIN",
      status: "FAILURE",
    });

    return { status: "error", message };
  }
}

export async function disconnectLinkedIn(
  previous: ConnectFormState,
  form: FormData,
): Promise<ConnectFormState> {
  void previous;
  void form;

  const user = await requirePermission("integrations:manage");

  await deleteSocialAccount("LINKEDIN");

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: "socialAccounts/LINKEDIN",
    status: "SUCCESS",
    metadata: { disconnected: true },
  });

  revalidatePath("/social-accounts");

  return { status: "success", message: "Disconnected. Nothing can publish to the profile now." };
}
