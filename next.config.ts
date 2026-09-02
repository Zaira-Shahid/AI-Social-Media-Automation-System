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
/**
 * Security headers (spec §22 Module 22, §56).
 *
 * Content-Security-Policy is deliberately not here — `src/proxy.ts` sets it
 * per-request with a fresh nonce, which a static header in this file cannot
 * do. Confirmed directly: a headless run against a built server with a
 * static `script-src 'self'` (no nonce) broke every page, because Next.js's
 * App Router bootstraps each one with its own inline `<script>` tags for RSC
 * hydration data. See `proxy.ts` for the rest of that reasoning.
 */
const SECURITY_HEADERS = [
  // Redundant with proxy.ts's `frame-ancestors` for CSP-aware browsers, kept
  // for the handful that only understand the older header.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Everything this app has no use for is turned off rather than left at
  // the browser's default, which is "permitted unless the page opts out".
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Only meaningful over HTTPS, which is every deployed environment (§56)
  // — harmless for the plain-HTTP `next dev` this also runs under.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },

  /*
   * Cloudinary is where every rendered card and brand logo lives (§28) —
   * `next/image` refuses an unconfigured remote host at render time, which
   * without this would fail the moment a real logo (`components/brand-form.tsx`)
   * or card reached the browser.
   */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },

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
