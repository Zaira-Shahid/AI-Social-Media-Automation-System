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
