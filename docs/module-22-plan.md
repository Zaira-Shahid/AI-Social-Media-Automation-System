# Module 22 — Security & Production Hardening

Spec sections: §22 (module roadmap), §33, §56, §57, §58, §65.

Perform: Firestore Security Rules review, Admin SDK credential handling
review, authorization review, secrets review, API security, webhook
verification, dependency review, error exposure review, logging review,
production configuration review. Unlike every module before it, this one
says "Perform," not "Build" — it is an audit across the whole system, not a
new screen. Findings are fixed where real; a checked item with nothing wrong
is recorded as checked, not padded with a change to justify the pass.

## Step 1 — Read

§56 (the mandatory list, and the two credential tiers that must never reach
the browser, Git, or n8n), §57 (env var hygiene — the client/server split
must never mix), §58 (Security Rules tested against the emulator, never the
live project; tests must never call a live platform), §65. §22's own bullet
list, read as ten separate questions rather than one.

## Step 2 — Inspect, ten items

Each reviewed directly against the current codebase, not from memory.

### 1. Firestore Security Rules — clean

Read `firestore.rules` in full. Default-deny catch-all intact
(`match /{document=**} { allow read, write: if false; }`), every opened
collection carries its own reasoning comment, and no client write exists
anywhere except the explicit read-only grants. Re-ran `test:rules` against
the emulator: 37 passed, allow and deny cases both covered per §58. No
changes needed.

### 2. Admin SDK credential handling — clean

`firebase/admin.ts` is `server-only`-guarded, never logs the private key,
and normalizes `\n` sequences once in the env schema rather than at each
call site. The named-app lookup (`getApps().find(...)`) exists specifically
so Next's dev-mode hot reload cannot double-initialize and throw. No
changes needed.

### 3. Authorization review — clean

Every page under `(app)/` calls `requirePermission` or `requireUser`
(verified across all 11), and every server action across all 7 `actions.ts`
files carries its own check rather than relying on the layout alone — 23
exported actions, 23 explicit calls, counted directly rather than assumed.
The layout itself also gates with `requireUser()`, so a page is behind two
independent checks, not one. No changes needed.

### 4. Secrets review — clean

`.gitignore` excludes `.env*` (with `.env.example` explicitly re-allowed),
every service-account/key file pattern, and `*.pem`/`*.key`. Searched the
full git history (`git log --all -p`) for PEM headers and common token
prefixes — the only matches are obviously-fake, truncated test fixtures in
`env.test.ts`. `env.server.ts` and `env.client.ts` stay in separate files
with separate schemas, exactly as §57 requires. No changes needed.

### 5. API security / webhook verification — clean

All 11 webhook routes call `verifySignature` (counted directly). The scheme
(HMAC-SHA256, timestamped, timing-safe compare, 5-minute skew window) was
verified in earlier modules and is unchanged. `/api/health` is deliberately
minimal and unauthenticated by design, with a comment explaining exactly why
that is safe. `/api/auth/session` never distinguishes an expired token from
a forged one in its response. No changes needed.

### 6. Error exposure review — clean

Every generic `catch` block across the webhook routes returns a fixed,
non-specific message (`"Generation failed"`, `"Could not sync analytics"`,
…) regardless of what the underlying error actually says — that detail goes
to `logger.error`, server-side only. The two routes that return
`error.message` directly (`content/generate`, `content/render`) do so only
for `GenerationError`, a deliberately-crafted, already user-facing domain
error ("brand profile incomplete, missing: X"), never a raw exception. No
changes needed.

### 7. Logging review — clean

`logger.ts`'s `redact()` walks every logged object recursively against a
broad sensitive-key pattern list (password, secret, token, apikey,
privatekey, credential, authorization, cookie, session, signature).
Searched for a secret interpolated directly into a message *string* rather
than passed as a keyed field — the one place `redact()` cannot reach — and
found none; every `Authorization: Bearer ${token}` match is outbound HTTP
header construction, never a log call. No changes needed.

### 8. Dependency review — one real finding, fixed

`npm audit` found 6 moderate-severity advisories, all the same root cause:
`firebase-admin@14.3.0` (already the latest release) pulls
`@google-cloud/storage` → `gaxios`/`teeny-request` → `uuid@9.0.1`, below the
version patched for GHSA-w5hq-g745-h8pq. `npm audit fix --force`'s own
suggestion — downgrade to `firebase-admin@10.3.0` — would trade a moderate
transitive advisory for an actually older, less-maintained major version,
which is worse, not fixed. Added a `package.json` `overrides` entry pinning
`uuid` to `^11.1.1` instead: `npm install` resolves it, `npm audit` reports
zero vulnerabilities, and the full test suite (506 tests) still passes.

### 9. Production configuration review — three real findings, fixed

`next.config.ts` had no security headers at all, and no `images` config for
Cloudinary. `brand-form.tsx` already renders `brand.logo.url` — a
`res.cloudinary.com` address — through `next/image`, which refuses an
unconfigured remote host at render time; this was a live bug waiting for
the first real logo, not a hypothetical. Fixed both:

- `images.remotePatterns` now allows `res.cloudinary.com`.
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, and `Strict-Transport-Security` are set for every
  route via `headers()`.
- `package.json` gained an `engines.node` floor (`>=20.9.0`), matching
  Next.js 16.3.3's own documented requirement rather than a guess.

Content-Security-Policy needed its own path — see Step 3, it is the part of
this module that took real verification, not just inspection, to get right.

### 10. Testing — extended, not just re-run

§58 requires Security Rules tests against the emulator, which already
existed and still pass (37/37). This module added one new e2e assertion
(`login.spec.ts`) proving a real credentialed sign-in survives the new CSP,
and used the full 86-test credentialed e2e suite as the mechanism that
caught the regression described below — testing here was not a checkbox
step at the end, it is what found the real problem.

## Step 3 — CSP: caught, not assumed

A Content-Security-Policy is the one item in Step 2 that could not be
verified by reading code — only by running it. Two real breakages were
found this way, not by inspection, and both would have shipped without the
verification:

**First**: a static `script-src 'self'` (via `next.config.ts`) broke every
page. A headless run against a real production build threw
`InvariantError: Expected a request ID to be defined... self.__next_r`,
traced to the browser reporting Next.js's own inline RSC-hydration
`<script>` tags as CSP violations — the App Router bootstraps every page
with them. The fix is the documented Next.js pattern: CSP moved out of
`next.config.ts` (which cannot vary per request) into `src/proxy.ts`,
generating a fresh nonce every request and setting `'nonce-<value>'
'strict-dynamic'` in `script-src`; Next.js detects the nonce in the response
header and applies it to its own inline scripts automatically. Re-running
the headless check against the fixed policy showed a real
`signInWithEmailAndPassword` POST reaching `identitytoolkit.googleapis.com`
and round-tripping an `auth/invalid-credential` error correctly — proof the
CSP allows the one call that matters most, not just that the violation
message went away.

**Second**, found only by running the full credentialed e2e suite (`npm run
test:e2e:auth`) rather than the single manual check above: 31 of 86 tests
failed, every one of them behind a sign-in, with the login page itself
reporting *"Could not reach the sign-in service."* The CSP's `connect-src`
allowed only the two production Google Identity origins — correct for a
deployed environment, wrong for the Firebase emulator the credentialed test
suite (and local development) actually talks to, on `127.0.0.1:9099`.
`connect-src` now adds that host when `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST`
is set — the same flag `firebase/client.ts` already reads to decide whether
to connect to the emulator at all — so the widening exists only in local
development and the emulator-backed test run (§58), never in a deployed
environment. Re-ran the full suite after the fix: **86 passed**, including
the new CSP-specific assertion.

The policy itself is scoped to what the app actually calls from the
browser, not a generic template: `getClientFirestore()` is exported but
never called anywhere (every read goes through the Admin SDK on the
server), and the login form uses only `signInWithEmailAndPassword` and
`sendPasswordResetEmail` — plain REST, no popup or redirect flow — so there
is no `firebaseapp.com` iframe origin to allow either. Both narrow scopes
have to grow the moment either changes, and the file says so.

## Step 4 — Validate

`typecheck`, `lint`, `test` (506 passed), `build`, `test:rules` against the
Firebase emulator (37 passed), and the full credentialed e2e suite
(`test:e2e:auth`, 86 passed, including the new CSP assertion) — all clean.
`npm audit`: 0 vulnerabilities (was 6 moderate).

## Step 5 — Documentation

This file, and the README status table/narrative.

### Next

Module 23 — Final QA & Deployment.
