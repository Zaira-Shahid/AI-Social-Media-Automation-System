import { defineConfig } from "@playwright/test";

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

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:3000",
    // A server left over from the non-emulator run would be pointed at the
    // live project, so it must not be reused for the emulator run.
    reuseExistingServer: !process.env.CI && !usingEmulators,
    timeout: 180_000,
    env: usingEmulators
      ? {
          // The browser half of the SDK needs this at build time; the server
          // half reads FIREBASE_AUTH_EMULATOR_HOST from the inherited
          // environment on its own.
          NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
        }
      : {},
  },
});
