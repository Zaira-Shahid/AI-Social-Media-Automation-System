import type { NextConfig } from "next";

/**
 * `NEXT_PUBLIC_*` values are inlined into the production bundle at build time,
 * so a build made while pointing at the Firebase emulators stays pointed at
 * them until something rebuilds. Left in the default `.next`, that build gets
 * served by the next plain `npm run start` — the app then talks to an emulator
 * that may not even be running, and every auth call fails for reasons that
 * look nothing like the cause.
 *
 * The credentialed end-to-end run therefore builds into its own directory.
 * `.next` only ever holds a build made against the real configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
