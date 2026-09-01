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

  /*
   * The rendering stack has to stay out of the bundler (§15).
   *
   * `@resvg/resvg-js` is a native addon: npm installs a prebuilt binary for
   * the host platform, and a bundler cannot inline a `.node` file.
   *
   * `satori` loads HarfBuzz as a WebAssembly file from `harfbuzzjs`. Bundled,
   * it resolves that path against the bundle's own location rather than
   * node_modules and fails at runtime with `ENOENT ... hb.wasm` — a failure
   * that only appears in a production build, never in `next dev`.
   *
   * Both are therefore required at runtime from node_modules, which is the
   * only way either loads at all.
   */
  serverExternalPackages: ["@resvg/resvg-js", "satori", "harfbuzzjs"],
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
