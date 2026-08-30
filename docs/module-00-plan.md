# Module 00 — Foundation: Implementation Plan

**Status:** Plan only (§64 Steps 1–3 complete). **Not implemented.**
**Branch:** `feature/module-00-foundation`
**Blocked on:** Firebase + Cloudinary credentials from the owner.

---

## Step 1 — Read

Master specification read in full (2700+ lines, §0–§71), incorporating all
decisions settled to date: Firebase/Firestore on Spark, Cloudinary storage,
Facebook/Instagram/LinkedIn only, per-platform approval, Satori/resvg,
encrypted token storage, Vitest/Playwright/Emulator testing.

## Step 2 — Inspect

| Item | State |
|---|---|
| Tracked files | `AI-Social-Media-Automation-System.md`, `docs/module--1-platform-access-spike.md` |
| `package.json` | Does not exist |
| `src/` | Does not exist |
| Application architecture | None yet — greenfield |
| Firestore collections | None yet |
| Environment configuration | None yet |
| Existing tests | None yet |
| Node | v24.14.0 |
| npm | 11.9.0 |
| Docker | 29.6.1 (available for n8n and Firebase emulators) |
| Branches | `main`, `develop`, `feature/module-00-foundation` |

Nothing to reuse or migrate. No existing code constrains this module.

## Step 3 — Plan

### Scope

Module 00 delivers a running, tested, empty application shell. It builds
**no** product features — no news, no content, no publishing, no brand UI.

Explicitly out of scope: authentication logic (Module 01), any Firestore
collection beyond a connectivity check, any Cloudinary upload beyond a
configuration check.

---

### 3.1 Project scaffolding

- Next.js (App Router) + TypeScript, strict mode enabled.
- Tailwind CSS.
- shadcn/ui initialized; Lucide icons.
- ESLint + Prettier, with a format check wired into the lint script.
- `zod` installed — used immediately by env validation (3.3).

### 3.2 Repository hygiene — do first, before any credential exists

`.gitignore` must be committed **before** any credential file can plausibly
land in the working tree. It must cover:

```text
.env*                         (except .env.example)
*serviceAccount*.json
node_modules/
.next/
coverage/
playwright-report/
test-results/
.firebase/
```

Rationale: the Firebase Admin service account is the highest-privilege
secret in the system (§56). Committing it once means rotating it. The
ignore rules exist before the risk does.

### 3.3 Environment handling

`.env.example` documenting every required variable, in two clearly
separated groups (§57):

**Client-safe (may reach the browser):**

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET      (unused — Cloudinary is storage)
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

**Server-only (never in the client bundle):**

```text
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
TOKEN_ENCRYPTION_KEY
APP_TIMEZONE                              (Asia/Karachi)
N8N_WEBHOOK_SECRET                        (placeholder; used from Module 03)
```

Validated at startup with Zod, in **two separate schemas** — a client schema
and a server schema. The server schema is imported only from server code. A
missing or malformed variable fails fast at boot with a clear message,
rather than surfacing as a confusing runtime error later.

`.env.example` contains names and shapes only — never real values.

### 3.4 Firebase initialization

Two distinct initialization paths, deliberately kept in separate files so
they cannot be confused:

- **Client SDK** (`lib/firebase/client.ts`) — browser-safe config only.
- **Admin SDK** (`lib/firebase/admin.ts`) — marked server-only, guarded by a
  singleton so Next.js hot reload does not re-initialize the app.

Firestore connectivity is verified by a single trivial read/write against a
throwaway `_healthcheck` document, then cleaned up. No product collections
are created in this module.

Firebase Auth is initialized but **no login flow is built** — that is
Module 01.

**No Cloud Storage bucket is configured.** Storage is Cloudinary (§28).

### 3.5 Cloudinary configuration

Server-side SDK configured and its credentials validated. A configuration
check confirms the credentials authenticate. **No upload pipeline is built**
— that is Module 08.

### 3.6 Firestore Security Rules baseline

`firestore.rules` committed with a **default-deny** baseline:

```text
match /{document=**} {
  allow read, write: if false;
}
```

Every later module opens access explicitly and narrowly. Starting closed
means no collection is ever accidentally world-readable during development.

`firebase.json` + `.firebaserc` configure the emulator suite (Firestore +
Auth). Emulators run locally via the Firebase CLI.

### 3.7 Testing foundation

- **Vitest** — configured with a first test covering env-schema validation
  (proving a malformed env is rejected).
- **Playwright** — configured with a smoke test that the base layout renders.
- **Firebase Emulator Suite** + `@firebase/rules-unit-testing` — a rules test
  asserting the default-deny baseline actually denies an unauthenticated
  read. Per §58, deny cases are tested, not just allow cases.

All three runners wired into npm scripts and proven to pass before the
module is considered complete.

### 3.8 Base layout and logging

- Minimal app shell with the §34 navigation structure present but inert
  (Dashboard, News, Content, Calendar, Analytics, Strategy, Automation,
  Social Accounts, Brand, Settings). No screens implemented.
- A small structured logging utility with a redaction helper, so no token,
  key or secret can be logged (§55, §56).

### 3.9 Git conventions

- Conventional Commits (§62).
- Branch flow per §60: `feature/module-00-foundation` → `develop`.

---

### Verification before this module is called complete (§59)

```text
Vitest passes
Playwright smoke test passes
Emulator rules test passes (default-deny verified)
Lint passes
Type check passes
Production build succeeds
No secret committed (git history checked)
Documentation updated
```

---

### Open questions for the owner

1. ~~Where does the Next.js app ultimately run?~~ **RESOLVED 2026-08-30** —
   Vercel. Cloudflare Tunnel dropped; n8n makes outbound calls only. Slack
   interactivity and OAuth redirects point at the Vercel deployment URL.
   **However**, a licensing conflict is now open in its place: Vercel's
   Hobby plan is non-commercial only, and this is a company internal tool.
   See §28 "Deployment — unresolved plan/licensing conflict". Still not
   blocking for Module 00, which stays host-agnostic.

2. **Admin SDK credential format** — plan assumes three discrete env vars
   (`PROJECT_ID` / `CLIENT_EMAIL` / `PRIVATE_KEY`) rather than a JSON file
   on disk, so nothing credential-shaped ever sits in the repo. Note that
   `FIREBASE_ADMIN_PRIVATE_KEY` contains literal `\n` sequences that must be
   unescaped at load time — a common source of confusing auth failures.

3. **`TOKEN_ENCRYPTION_KEY`** must be a 32-byte key. I will generate one for
   local development; production value is the owner's to set and store.

---

**STOP.** Awaiting credentials before Step 4 (Implement).
