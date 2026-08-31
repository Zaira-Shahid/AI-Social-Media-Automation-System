# Internal AI Social Media Automation System

Internal tool that researches industry news, drafts brand-aligned social
posts, routes them through human approval, and publishes to Facebook,
Instagram and LinkedIn on a schedule.

The authoritative specification is
[AI-Social-Media-Automation-System.md](AI-Social-Media-Automation-System.md).
It governs every decision in this repository; this README only covers how to
run what exists today.

## Status

| Module | State |
|---|---|
| −1 — Platform access spike | Complete ([notes](docs/module--1-platform-access-spike.md)) |
| 00 — Foundation | Complete ([plan](docs/module-00-plan.md)) |
| 01 — Authentication & Access Control | Not started |

Module 00 is an empty, tested application shell. No product feature exists
yet: no news, no content generation, no publishing, no login.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui ·
Firebase (Firestore + Auth, Spark plan) · Cloudinary for media ·
Vitest · Playwright · Firebase Emulator Suite. Deployment target is the
Render free tier (spec §28).

## Setup

Requires Node 24+, npm 11+, and the Firebase CLI for the emulator tests.

```bash
npm install
cp .env.example .env.local   # then fill in real values
```

`.env.local` is git-ignored and must never be committed. `.env.example`
carries variable names and shapes only. Two groups matter (§57):
`NEXT_PUBLIC_*` variables reach the browser; everything else is server-only
and enforced as such by the `server-only` package.

`FIREBASE_ADMIN_PRIVATE_KEY` is pasted with literal `\n` sequences; the env
schema unescapes them. `TOKEN_ENCRYPTION_KEY` must be 64 hex characters
(32 bytes) — generate one with `openssl rand -hex 32`.

### Firebase project prerequisites

Before `npm run verify:services` can pass, the Firestore database must be
created in the Firebase console for the project named in
`FIREBASE_ADMIN_PROJECT_ID`. Creating the project alone is not enough — the
Firestore API stays disabled until a database exists.

## Commands

```bash
npm run dev              # development server
npm run verify           # typecheck + lint + format check + unit tests + build
npm run test             # Vitest unit tests
npm run test:rules       # Firestore rules tests against the emulator
npm run test:e2e         # Playwright smoke tests
npm run verify:services  # live credential check against Firestore + Cloudinary
npm run emulators        # Firestore + Auth emulators
```

`npm run verify` is the offline quality gate (§59) — it needs no credentials
and no network. `verify:services` is the separate, deliberately manual check
that real credentials work.

## Notes on two deliberate choices

**Firestore rules start closed.** `firestore.rules` denies every read and
write. Each module opens exactly what it needs, and deny cases are tested,
not just allow cases (§58).

**`/api/health` does nothing.** It is the keep-warm target for the n8n cron
that stops the Render free instance from spinning down (§28). It touches no
dependency and reveals no configuration, because it is unauthenticated. A
readiness check that probes dependencies must be a separate, authenticated
endpoint.

## Contributing

Conventional Commits (§62). Work happens on `feature/module-XX-*` branches
and merges into `develop` (§60). Never commit to `main` directly.
