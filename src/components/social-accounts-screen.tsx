"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  connectFacebook,
  connectInstagram,
  connectLinkedIn,
  disconnectFacebook,
  disconnectInstagram,
  disconnectLinkedIn,
  type ConnectFormState,
} from "@/app/(app)/social-accounts/actions";
import { PLATFORM_LABELS } from "@/components/post-status-badge";
import { Button } from "@/components/ui/button";
import type { AdapterCapability } from "@/lib/publishing/adapter";
import type { SocialAccountView } from "@/lib/social/schema";
import { cn } from "@/lib/utils";

/**
 * Social accounts (spec §19, §21, §42, §66).
 *
 * §42: show each platform's connection state and, where a token expires, the
 * date — never the token itself. The view type this screen receives has no
 * token field at all, so exposing one would be a type error rather than an
 * oversight.
 *
 * §66's three words do the work here: REAL means calls reach the platform,
 * MOCK means they are simulated, UNAVAILABLE means no path exists. A platform
 * nobody has built yet is never dressed up as one OAuth click away.
 */
const INITIAL: ConnectFormState = { status: "idle" };

function SubmitButton({
  idle,
  busy,
  variant = "default",
}: {
  idle: string;
  busy: string;
  variant?: "default" | "outline" | "destructive";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

function ModeBadge({ mode }: { mode: AdapterCapability["mode"] }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        mode === "REAL"
          ? "bg-primary/10 text-primary"
          : mode === "UNAVAILABLE"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
      data-testid="adapter-mode"
    >
      {mode}
    </span>
  );
}

function Message({ state }: { state: ConnectFormState }) {
  if (state.status === "idle" || !state.message) return null;

  return (
    <p
      role="status"
      data-testid="connect-status"
      className={cn(
        "text-sm",
        state.status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state.message}
    </p>
  );
}

/**
 * What each Meta connect form needs to differ on.
 *
 * Facebook and Instagram connect through the same pasted-token exchange —
 * Instagram is reached through the Page it is linked to — so one form serves
 * both rather than two that drift apart. They stay separate *connections*
 * though: disconnecting one leaves the other publishing.
 */
interface MetaConnectConfig {
  connect: typeof connectFacebook;
  disconnect: typeof disconnectFacebook;
  /** The scopes to ask Meta for, named so the operator can check them. */
  scopes: string;
  /** What "connected" points at, in words. */
  connectedNoun: string;
  connectLabel: string;
  hint: string;
}

const META_CONNECT: Partial<Record<AdapterCapability["platform"], MetaConnectConfig>> = {
  FACEBOOK: {
    connect: connectFacebook,
    disconnect: disconnectFacebook,
    scopes: "pages_show_list, pages_read_engagement and pages_manage_posts",
    connectedNoun: "Page",
    connectLabel: "Connect Page",
    hint: "Leave blank to use the only Page the token administers.",
  },
  INSTAGRAM: {
    connect: connectInstagram,
    disconnect: disconnectInstagram,
    scopes: "instagram_basic, instagram_content_publish, pages_show_list and pages_read_engagement",
    connectedNoun: "Instagram user",
    connectLabel: "Connect account",
    hint: "The Page the Instagram professional account is linked to. Leave blank to use the only Page the token administers.",
  },
};

/**
 * The Meta connect form.
 *
 * A pasted user token rather than an OAuth redirect: the Meta app stays in
 * Development mode serving only accounts the company owns (Module −1's
 * finding), so there is no consumer login flow to run and no App Review to
 * pass. The exchange to a long-lived token happens on the server, which is
 * where the app secret is.
 */
function MetaConnect({
  config,
  connected,
}: {
  config: MetaConnectConfig;
  connected: SocialAccountView | undefined;
}) {
  const [connectState, connect] = useActionState(config.connect, INITIAL);
  const [disconnectState, disconnect] = useActionState(config.disconnect, INITIAL);

  if (connected) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm">
          Connected to <span className="font-medium">{connected.accountName}</span> (
          {config.connectedNoun} {connected.accountId}).
        </p>

        <p className="text-xs text-muted-foreground" data-testid="expiry">
          {connected.expiresAt
            ? `Token expires ${connected.expiresAt}.`
            : "This Page token does not expire. Meta invalidates it only if the password changes, the app is removed, or the role is lost."}
        </p>

        {connected.lastError ? (
          <p className="text-xs text-destructive">Last problem: {connected.lastError}</p>
        ) : null}

        <form action={disconnect}>
          <SubmitButton idle="Disconnect" busy="Disconnecting…" variant="destructive" />
        </form>

        <Message state={disconnectState} />
      </div>
    );
  }

  return (
    <form action={connect} className="mt-3 space-y-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`userToken-${config.connectedNoun}`} className="text-xs font-medium">
          Meta user access token
        </label>
        <input
          id={`userToken-${config.connectedNoun}`}
          name="userToken"
          type="password"
          autoComplete="off"
          className="h-8 w-full max-w-lg rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Granted {config.scopes}. It is exchanged server-side for a long-lived token and stored
          encrypted; it is never shown again.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`pageId-${config.connectedNoun}`} className="text-xs font-medium">
          Page ID (optional)
        </label>
        <input
          id={`pageId-${config.connectedNoun}`}
          name="pageId"
          className="h-8 w-full max-w-xs rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        <p className="text-xs text-muted-foreground">{config.hint}</p>
      </div>

      <SubmitButton idle={config.connectLabel} busy="Connecting…" />

      <Message state={connectState} />
    </form>
  );
}

/**
 * How close to expiry LinkedIn's token is, said plainly.
 *
 * §42 asks the screen to surface expiry state. It matters more here than
 * anywhere else in this system: LinkedIn issues no refresh token, so this line
 * is the only warning a human gets before publishing starts failing.
 *
 * The status is derived on the server by `statusForExpiry`, not recomputed
 * here — one implementation of §19's window, and no clock reading during
 * render.
 */
function ExpiryNotice({ account }: { account: SocialAccountView }) {
  if (!account.expiresAt) return null;

  const urgent = account.status === "EXPIRED" || account.status === "EXPIRING";

  return (
    <p
      data-testid="expiry"
      className={cn("text-xs", urgent ? "font-medium text-destructive" : "text-muted-foreground")}
    >
      {account.status === "EXPIRED"
        ? `This token expired on ${account.expiresAt}. Reconnect before anything can publish.`
        : `This token expires ${account.expiresAt}. LinkedIn issues no refresh token, so it must be reconnected by hand.`}
    </p>
  );
}

/**
 * The LinkedIn connect form.
 *
 * One field, not the Meta pair: there is no Page to choose, and 3-legged OAuth
 * needs a registered HTTPS redirect URL this system does not have until it is
 * deployed. LinkedIn's developer portal issues a token directly to an app's own
 * owner, which is the case here.
 */
function LinkedInConnect({ connected }: { connected: SocialAccountView | undefined }) {
  const [connectState, connect] = useActionState(connectLinkedIn, INITIAL);
  const [disconnectState, disconnect] = useActionState(disconnectLinkedIn, INITIAL);

  if (connected) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm">
          Posting as <span className="font-medium">{connected.accountName}</span> (
          {connected.accountId}).
        </p>

        <ExpiryNotice account={connected} />

        {connected.lastError ? (
          <p className="text-xs text-destructive">Last problem: {connected.lastError}</p>
        ) : null}

        <form action={disconnect}>
          <SubmitButton idle="Disconnect" busy="Disconnecting…" variant="destructive" />
        </form>

        <Message state={disconnectState} />
      </div>
    );
  }

  return (
    <form action={connect} className="mt-3 space-y-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="linkedinToken" className="text-xs font-medium">
          LinkedIn access token
        </label>
        <input
          id="linkedinToken"
          name="accessToken"
          type="password"
          autoComplete="off"
          className="h-8 w-full max-w-lg rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Granted openid, profile and w_member_social. Its real expiry is read back from LinkedIn
          rather than assumed, and it is stored encrypted; it is never shown again.
        </p>
      </div>

      <SubmitButton idle="Connect profile" busy="Connecting…" />

      <Message state={connectState} />
    </form>
  );
}

export function SocialAccountsScreen({
  capabilities,
  accounts,
  canManage,
}: {
  capabilities: AdapterCapability[];
  accounts: SocialAccountView[];
  canManage: boolean;
}) {
  const byPlatform = new Map(accounts.map((account) => [account.platform, account]));

  return (
    <div className="mt-6 space-y-4">
      {capabilities.map((capability) => {
        const connected = byPlatform.get(capability.platform);
        const metaConnect = META_CONNECT[capability.platform];

        return (
          <section
            key={capability.platform}
            className="rounded-lg border border-border bg-card p-4"
            data-testid="social-account"
            data-platform={capability.platform}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                {PLATFORM_LABELS[capability.platform] ?? capability.platform}
              </h2>

              <ModeBadge mode={capability.mode} />

              <span className="text-xs text-muted-foreground" data-testid="connection-state">
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">{capability.detail}</p>

            {capability.limitation ? (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="limitation">
                {capability.limitation}
              </p>
            ) : null}

            {canManage && metaConnect ? (
              <MetaConnect config={metaConnect} connected={connected} />
            ) : null}

            {canManage && capability.platform === "LINKEDIN" ? (
              <LinkedInConnect connected={connected} />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
