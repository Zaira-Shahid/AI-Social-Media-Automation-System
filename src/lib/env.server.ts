import "server-only";

import { z } from "zod";

/**
 * Server-only environment schema.
 *
 * Importing this file from client code is a build error, enforced by
 * `server-only`. That guard matters more than usual here: these values
 * include the Firebase Admin credentials, which bypass Firestore Security
 * Rules entirely (spec §33), and the Cloudinary API secret (§56).
 */
const serverEnvSchema = z.object({
  FIREBASE_ADMIN_PROJECT_ID: z.string().min(1, "FIREBASE_ADMIN_PROJECT_ID is required"),
  FIREBASE_ADMIN_CLIENT_EMAIL: z
    .string()
    .min(1, "FIREBASE_ADMIN_CLIENT_EMAIL is required")
    .email("FIREBASE_ADMIN_CLIENT_EMAIL must be an email address"),
  FIREBASE_ADMIN_PRIVATE_KEY: z
    .string()
    .min(1, "FIREBASE_ADMIN_PRIVATE_KEY is required")
    // The value arrives from .env with literal backslash-n sequences rather
    // than real newlines. Left unconverted, the Admin SDK fails with an
    // opaque signature error, so normalize here rather than at each use.
    .transform((key) => key.replace(/\\n/g, "\n"))
    .refine(
      (key) => key.includes("-----BEGIN PRIVATE KEY-----"),
      "FIREBASE_ADMIN_PRIVATE_KEY does not look like a PEM private key",
    ),

  /*
   * Firestore database ID.
   *
   * Almost always "(default)" — with the parentheses, which are part of the
   * literal name Google gives the first database in a project. Multi-database
   * Firestore also allows arbitrary IDs, and a database created with an
   * explicit name (say "default", without parentheses) is a *different*
   * database. Targeting the wrong one fails as a bare `5 NOT_FOUND` with no
   * indication of which name was tried, so the value is explicit here.
   */
  FIREBASE_DATABASE_ID: z.string().min(1).default("(default)"),

  /*
   * AI provider (§30). "mock" simulates every call (§21) and needs no key,
   * which is what keeps development, CI and the emulator run off a live
   * service (§58).
   */
  AI_PROVIDER: z.enum(["groq", "mock"]).default("mock"),

  /*
   * Optional so the app boots without it in mock mode. It is checked where
   * the provider is built, not here — a missing key must fail with "AI_PROVIDER
   * is groq but GROQ_API_KEY is not set", not with a generic env error that
   * appears even when nothing needs a key.
   */
  GROQ_API_KEY: z.string().min(1).optional(),

  /** Overrides the adapter's default. Only some models support strict JSON schema. */
  AI_MODEL: z.string().min(1).optional(),

  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),

  APP_TIMEZONE: z.string().min(1, "APP_TIMEZONE is required"),

  // 32 bytes, hex-encoded. Enforced strictly: a short key would silently
  // weaken token encryption (§19) rather than fail loudly.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),

  // Firebase Auth session cookie lifetime (§26). Firebase supports 5 minutes
  // to 14 days; anything outside that is rejected by the Admin SDK at
  // runtime, so the bound is enforced here where the message is useful.
  SESSION_COOKIE_MAX_AGE_DAYS: z.coerce
    .number()
    .min(1 / 288, "SESSION_COOKIE_MAX_AGE_DAYS must be at least 5 minutes (0.0035 days)")
    .max(14, "SESSION_COOKIE_MAX_AGE_DAYS must be at most 14 days")
    .default(5),

  // Placeholder until Module 03 introduces signed n8n webhooks (§44).
  N8N_WEBHOOK_SECRET: z.string().min(1, "N8N_WEBHOOK_SECRET is required"),

  /*
   * Slack delivery (§9, §21). "mock" logs the message instead of sending it,
   * which is what keeps development, CI and the emulator run out of a real
   * workspace (§58).
   */
  SLACK_PROVIDER: z.enum(["slack", "mock"]).default("mock"),

  /*
   * Optional here so the app boots without them in mock mode. Both are checked
   * where the notifier is built, so a half-configured Slack app fails with a
   * message naming the missing value rather than a generic env error that
   * would appear even when nothing needs Slack.
   */
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_NEWS_CHANNEL_ID: z.string().min(1).optional(),

  /*
   * Facebook publishing (§19, §20, §21, §63 Module 12).
   *
   * "mock" simulates the publish and reaches nothing, which is the default so
   * neither development nor the test runs can post to a real Page (§58).
   * "graph" calls Meta's Graph API with the stored Page token.
   */
  FACEBOOK_PROVIDER: z.enum(["graph", "mock"]).default("mock"),

  /*
   * Meta app credentials, used only to exchange a short-lived user token for a
   * long-lived one (§19). Optional here and checked where the exchange
   * happens, so the app boots unconfigured; the app secret never leaves the
   * server and is never given to n8n.
   */
  FACEBOOK_APP_ID: z.string().min(1).optional(),
  FACEBOOK_APP_SECRET: z.string().min(1).optional(),

  /*
   * Instagram publishing (§19, §20, §21, §63 Module 13).
   *
   * Its own switch rather than a shared Meta one: the Page and the Instagram
   * account are separate connections that can be turned on separately, and a
   * single flag would mean enabling one silently enables the other.
   *
   * The app credentials are Facebook's — the Instagram account is reached
   * through the Page (see `findInstagramAccount`), so there is no second app.
   */
  INSTAGRAM_PROVIDER: z.enum(["graph", "mock"]).default("mock"),

  /*
   * LinkedIn publishing (§19, §20, §21, §63 Module 14).
   *
   * "mock" simulates the publish and reaches nothing, which is the default.
   * The client id and secret are used only to introspect a pasted token — they
   * establish its real expiry, which §19 requires be tracked rather than
   * assumed. They never leave the server and are never given to n8n.
   */
  LINKEDIN_PROVIDER: z.enum(["rest", "mock"]).default("mock"),
  LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),

  /*
   * Public base URL, used to build the links inside a Slack message.
   *
   * Defaulted rather than required so local development and the test runs
   * work unconfigured. It is only ever used to build a link a human clicks —
   * nothing authenticates against it — so a wrong value produces a dead link,
   * not a security problem.
   */
  APP_BASE_URL: z
    .string()
    .url("APP_BASE_URL must be a full URL, including https://")
    .default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Parse and cache the server environment.
 *
 * Fails fast with every problem listed at once, rather than surfacing later
 * as a confusing runtime error deep inside the Admin SDK.
 *
 * Note this never logs the values themselves — only which keys are wrong
 * (§55: never log secrets).
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid server environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }

  cached = parsed.data;
  return cached;
}
