import { defineConfig } from "@playwright/test";

/*
 * Load `.env.local` into the test process.
 *
 * Next loads it for the app under test, but Playwright is a separate process
 * and does not. A test that needs to sign a webhook the way n8n does needs
 * the same secret the server verifies against, and without this it would sign
 * with an empty string and fail for a reason that has nothing to do with the
 * code under test.
 *
 * Emulator hosts are exported by `firebase emulators:exec` and must win over
 * anything the file says, so they are restored afterwards.
 */
const emulatorEnv = {
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
};

try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent in CI, where the environment is provided directly.
}

for (const [key, value] of Object.entries(emulatorEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Two runs share this config:
 *
 *   npm run test:e2e        tests/e2e       — no credentials, live-safe
 *   npm run test:e2e:auth   tests/e2e-auth  — inside `firebase emulators:exec`
 *
 * The emulator run is detected by the hosts `emulators:exec` exports. When
 * they are present the app under test is built and started pointed at the
 * emulators, so a login test never reaches the live project (§58).
 */
const usingEmulators = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

/*
 * The emulator run uses its own port.
 *
 * Sharing 3000 means the credentialed suite refuses to start whenever anyone
 * has the app running — which is exactly when they are most likely to want to
 * run it. `E2E_PORT` overrides either default.
 */
const port = Number(process.env.E2E_PORT ?? (usingEmulators ? 3100 : 3000));
const baseURL = `http://127.0.0.1:${port}`;

/*
 * Force every outbound integration to mock for the app under test (§58).
 *
 * `.env.local` is loaded above so webhook signatures match, and it carries
 * whatever the developer has switched on for real work. The emulator run
 * isolates Firebase and nothing else, so a real `SLACK_PROVIDER=slack` reached
 * the app under test and the suite posted an actual shortlist to the team's
 * workspace before this existed. §58 is explicit that tests must not touch
 * live services, and "remember to set it back to mock" is not a mechanism.
 *
 * Every switch is listed, including ones no test exercises yet: the failure
 * mode is silent and outward-facing, so a new provider must be opted *in* to
 * reaching the network, never opted out.
 */
const MOCKED_PROVIDERS = {
  SLACK_PROVIDER: "mock",
  AI_PROVIDER: "mock",
  FACEBOOK_PROVIDER: "mock",
  INSTAGRAM_PROVIDER: "mock",
  LINKEDIN_PROVIDER: "mock",
} as const;

// The Playwright process itself, for any test that imports server code.
Object.assign(process.env, MOCKED_PROVIDERS);

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    // A server left over from the non-emulator run would be pointed at the
    // live project, so it must not be reused for the emulator run.
    reuseExistingServer: !process.env.CI && !usingEmulators,
    timeout: 180_000,
    env: usingEmulators
      ? {
          ...MOCKED_PROVIDERS,
          // The browser half of the SDK needs this at build time; the server
          // half reads FIREBASE_AUTH_EMULATOR_HOST from the inherited
          // environment on its own.
          NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
          /*
           * Build somewhere else.
           *
           * NEXT_PUBLIC_* values are baked into the bundle, so this build is
           * permanently wired to the emulator. Left in `.next`, the next plain
           * `npm run start` would serve it against an emulator that is no
           * longer running, and every sign-in would fail for a reason that
           * looks nothing like the cause. Ask how I know.
           */
          NEXT_DIST_DIR: ".next-e2e",
          PORT: String(port),
        }
      : { ...MOCKED_PROVIDERS, PORT: String(port) },
  },
});
