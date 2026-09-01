"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { getServerEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { exchangeForLongLivedUserToken, listPages } from "@/lib/publishing/facebook";
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
