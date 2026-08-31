# Module 01 — Authentication & Access Control: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-08-31.
**Branch:** `feature/module-01-auth` (from `develop`).

---

## Step 1 — Read

Master specification §2 (internal-only use), §26 (internal authentication),
§27 (roles), §32 (`profiles` collection), §33 (Security Rules), §34
(navigation), §55 (audit logs), §56 (security), §58 (testing), §63 (Module 01
scope).

## Step 2 — Inspect

Module 00 is merged into `develop`. What exists and constrains this module:

| Item | State |
|---|---|
| `src/lib/firebase/client.ts` | Client SDK, exposes `getClientAuth()` — unused so far |
| `src/lib/firebase/admin.ts` | Admin SDK, `server-only`, exposes `getAdminAuth()` — unused so far |
| `src/lib/env.server.ts` / `env.client.ts` | Two Zod schemas, fail-fast |
| `src/lib/logger.ts` | Structured logging with key-based redaction |
| `src/components/app-shell.tsx` | §34 nav, entirely inert, no user context |
| `src/app/layout.tsx` | Wraps every route in `AppShell` — no auth boundary exists |
| `firestore.rules` | Default-deny wildcard only |
| Tests | 12 unit, 5 rules, 2 e2e — all passing |
| Firestore (cloud) | **Database not created.** `verify:services` still fails |

Nothing here needs to be migrated. Two things must change shape: the root
layout (it currently assumes every route is an app route) and
`firestore.rules` (the wildcard stays, but `profiles` opens narrowly).

## Step 3 — Plan

### Scope

Login, logout, session, roles, route protection, admin-side user
provisioning. **No** user-management UI, no product screens, no Firestore
collection beyond `profiles` and `auditLogs`.

### 3.1 Roles and permissions (§27)

`src/lib/auth/roles.ts` — shared by client and server, no secrets.

`ADMIN` / `MANAGER` / `SOCIAL_MANAGER` as a Zod enum, plus an explicit
permission matrix. §27 says "permissions must be explicitly defined", so
permissions are enumerated (`users:manage`, `content:approve`, …) and each
role maps to a literal set. `can(role, permission)` is the single place any
check is expressed.

Roles live in Firebase Auth **custom claims** (§33) — set only via the Admin
SDK — and are mirrored onto `profiles/{uid}` so the UI can display them
without a token round-trip. The claim is authoritative; the mirror is not
trusted for authorization.

### 3.2 Session handling (§26)

Firebase Auth **session cookies**, created by the Admin SDK from a freshly
minted ID token.

- Cookie name `__session`. Not arbitrary: hosts that cache aggressively pass
  through only that name, and it costs nothing to be compatible now.
- `httpOnly`, `sameSite=lax`, `path=/`, `secure` outside development.
- Expiry from `SESSION_COOKIE_MAX_AGE_DAYS` (new server env var, default 5,
  bounded to Firebase's supported 5-minutes-to-14-days range).
- `POST /api/auth/session` exchanges an ID token for the cookie;
  `DELETE /api/auth/session` clears it and revokes refresh tokens.

Verification uses `verifySessionCookie(cookie, true)` — the `true` matters:
it checks revocation, so logging out or disabling a user takes effect
immediately rather than at the next expiry.

### 3.3 Route protection

Two layers, because neither alone is sufficient:

- `proxy.ts` — cheap redirect when the cookie is simply absent. It runs
  on the Edge runtime, where the Admin SDK cannot run, so it must never be
  treated as the authorization check.
- `src/lib/auth/current-user.ts` (`server-only`) — `getCurrentUser()`,
  `requireUser()`, `requireRole()`. This is the real check, and it runs in
  the protected layout and in every server route that matters. §33 is
  explicit that the Admin SDK bypasses Security Rules, so server paths must
  authorize themselves.

Route groups replace the current flat layout: `(app)` holds the
authenticated shell and calls `requireUser()`; `(auth)` holds the bare login
page. `/api/health` stays public and unauthenticated (§28 keep-warm).

### 3.4 Login and password recovery

`/login` — a client component using the client SDK's
`signInWithEmailAndPassword`, which then POSTs the ID token to
`/api/auth/session` and navigates. Password reset via the client SDK's
`sendPasswordResetEmail`.

Both surfaces report failure generically ("Email or password is incorrect",
and reset always claims success) so neither can be used to enumerate which
email addresses hold accounts. **No signup route exists** (§26).

Loading, empty and error states are required by §59 and are part of this
module, not a follow-up.

### 3.5 Provisioning (§26 — no public signup)

`scripts/provision-user.mjs`, run with the Admin SDK from a trusted
environment. It creates or updates a user, sets the role custom claim, and
writes `profiles/{uid}`.

This is a CLI script rather than a screen deliberately: §34's navigation has
no Users entry, and the first ADMIN has to exist before any admin-only UI
could be reached at all. A management screen belongs to a later settings
module.

### 3.6 Firestore rules (§33)

Default-deny stays. Two narrow openings:

- `profiles/{uid}` — client **read** for the owner, or for any ADMIN. No
  client write at any role: roles and status are server-written, or a user
  could promote themselves.
- `auditLogs/**` — denied to every client, read and write. Server-only (§33).

Deny cases are tested alongside allow cases (§58).

### 3.7 Audit log (§55)

`src/lib/audit.ts` writes `auditLogs` documents via the Admin SDK with
`actor`, `action`, `resource`, `timestamp`, `status`, `metadata`. Module 01
records `LOGIN` (and logout as `LOGIN` status `SIGNED_OUT`). Metadata passes
through the existing redaction helper — an audit trail must not become the
place secrets leak.

### 3.8 Emulator support for tests

`client.ts` and `admin.ts` connect to the Auth and Firestore emulators when
`NEXT_PUBLIC_FIREBASE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` are
set. Without this, an end-to-end login test would have to hit the live
project — which §58 forbids for platform APIs and which is a bad idea here
regardless, since the cloud database does not yet exist.

### 3.9 Tests

- **Unit** — permission matrix (including every role-denied case), session
  cookie options, session max-age bounds, audit entry redaction.
- **Rules** — owner reads own profile (allow); reads another's (deny);
  ADMIN reads any (allow); every client profile write (deny); `auditLogs`
  read and write (deny).
- **E2E** — unauthenticated request to `/` redirects to `/login`; login page
  renders; `/api/health` stays public. Full credentialed login e2e runs
  against the emulators.

---

### Known blocker, carried from Module 00

The Firestore database still does not exist in the cloud project, so
`npm run verify:services` fails on Firestore. Everything in this module is
developed and tested against the emulators, which need no cloud database.
What cannot happen until the owner creates it: provisioning the first real
ADMIN account and logging into the deployed app.

---

## Implementation record (§64 Steps 4–9)

### Deviations from the plan

| Plan | What shipped | Why |
|---|---|---|
| `middleware.ts` | `src/proxy.ts` | Next 16 deprecates the middleware file convention in favour of `proxy`. Same Edge-runtime behaviour, same caveat: it is a redirect, not an authorization check. |
| E2E fixture as a TypeScript module | `tests/fixtures/e2e-user.json` | The seed script is plain JS and cannot import a `server-only`-adjacent TS module, and parsing the TS source with a regex was fragile. JSON is read directly by the script and imported by the spec, so the two cannot drift. |

Also added, not in the plan: `.gitattributes` pinning `eol=lf`. Without it,
Git's autocrlf rewrote untouched files on Windows checkout and the Prettier
format check failed on files nobody had edited.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check | pass |
| Lint | pass |
| Format check | pass |
| Vitest | pass — 33 tests, 5 files (was 12) |
| Emulator rules tests | pass — 15 tests (was 5) |
| Playwright, no credentials | pass — 7 tests |
| Playwright, credentialed against emulators | pass — 4 tests |
| Production build | pass — `/`, `/login`, `/forbidden`, `/api/auth/session`, `/api/health`, proxy |

The credentialed run is the one that matters most here: it signs in with a
real password against the Auth emulator, exchanges the ID token for a
session cookie, reads the role back out of the claim on a server-rendered
page, signs out, and confirms the session is dead server-side afterwards.

### Security review (§64 Step 7)

- **Authentication.** Passwords are verified by Firebase, never by this
  code. The browser never mints the session cookie; only the Admin SDK can.
- **Session.** `httpOnly`, `sameSite=lax`, `secure` outside development,
  `__session` name. Both `verifySessionCookie` and `verifyIdToken` are
  called with revocation checking on, so sign-out and account disabling take
  effect immediately rather than at the next expiry.
- **Authorization.** Enforced server-side in `requireUser` /
  `requirePermission` / `requireRole`, and database-side in `firestore.rules`
  (§27). The proxy is explicitly not part of this.
- **Enumeration.** Login failures return one message regardless of cause,
  and password reset always reports success. The session endpoint returns a
  bare 401 while the specific reason goes only to the server log.
- **Privilege escalation.** No client can write `profiles/{uid}` at any
  role, so nobody can set their own `role` or re-enable their own disabled
  account. Rules tests cover the ADMIN case explicitly.
- **Open redirect.** `?next=` accepts only same-site paths; a full URL or a
  protocol-relative `//host` is discarded. Covered by an e2e test.
- **Secrets.** Audit metadata passes through the existing redaction helper
  before storage. A generated password is printed once by the provisioning
  script and never stored or logged.
- **Audit.** `LOGIN` is recorded on sign-in and sign-out (§55). A failed
  audit write never fails the action it was recording.

### Carried blocker

The cloud Firestore database still does not exist, so
`npm run verify:services` continues to fail on Firestore while passing on
Cloudinary. Everything above was verified against the emulators. Until the
owner creates the database, the first real ADMIN cannot be provisioned and
nobody can sign in to a deployed instance.

### Next

Module 02 — Company & Brand Intelligence.
