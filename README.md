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
| 01 — Authentication & Access Control | Complete ([plan](docs/module-01-plan.md)) |
| 02 — Company & Brand Intelligence | Not started |

The app now has login, roles and protected routes, and nothing else. No
news, no content generation, no publishing.

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

**Then check the database's ID**, because it is not always what it looks
like:

```bash
firebase firestore:databases:list --project <project-id>
```

A project's first database is normally called `(default)` — parentheses
included, they are part of the literal name. Multi-database Firestore also
allows plain IDs, so a database can end up called `default` without them,
and that is a *different* database. Pointing at the wrong one fails as a
bare `5 NOT_FOUND` that names neither the database it tried nor the one that
exists.

If the ID is anything other than `(default)`, set both halves — they must
match, and `firebase.json`'s `database` field must match too or rules deploy
to a database that is not there:

```dotenv
FIREBASE_DATABASE_ID=default
NEXT_PUBLIC_FIREBASE_DATABASE_ID=default
```

## Commands

```bash
npm run dev              # development server
npm run verify           # typecheck + lint + format check + unit tests + build
npm run test             # Vitest unit tests
npm run test:rules       # Firestore rules tests against the emulator
npm run test:e2e         # Playwright tests that need no credentials
npm run test:e2e:auth    # full login flow against the emulators
npm run verify:services  # live credential check against Firestore + Cloudinary
npm run emulators        # Firestore + Auth emulators
npm run provision:user   # create or update an account (see below)
```

`npm run verify` is the offline quality gate (§59) — it needs no credentials
and no network. `verify:services` is the separate, deliberately manual check
that real credentials work.

## Accounts

There is no signup route and there must never be one (§26). Accounts are
created by an administrator with the Admin SDK:

```bash
npm run provision:user -- --email someone@company.com --role ADMIN --name "Full Name"
```

Roles are `ADMIN`, `MANAGER` and `SOCIAL_MANAGER` (§27). The role lives in a
Firebase Auth custom claim, which is what Security Rules and the server
trust; the copy on `profiles/{uid}` is for display only. Omitting
`--password` generates a temporary one and prints it once — the user should
sign in and reset it immediately.

The same script disables an account, revoking its sessions at the same time:

```bash
npm run provision:user -- --email someone@company.com --disable
```

The **first** ADMIN has to be created this way, before anything is reachable.

Firebase Authentication must be enabled in the console first (Authentication
→ Get started → Email/Password). Until it is, provisioning fails with
`auth/configuration-not-found`, which does not say what is missing.

## Notes on two deliberate choices

**Firestore rules start closed.** `firestore.rules` denies every read and
write. Each module opens exactly what it needs, and deny cases are tested,
not just allow cases (§58).

**Two layers guard every route, and only one of them counts.** `proxy.ts`
redirects when the session cookie is missing, but it runs on the Edge
runtime where the Admin SDK cannot run — it cannot tell a valid cookie from
a forged one. The real check is `requireUser()` in the authenticated layout
and in server routes. §33 is explicit that the Admin SDK bypasses Security
Rules, so server code authorizes itself.

**`/api/health` does nothing.** It is the keep-warm target for the n8n cron
that stops the Render free instance from spinning down (§28). It touches no
dependency and reveals no configuration, because it is unauthenticated. A
readiness check that probes dependencies must be a separate, authenticated
endpoint.

## Contributing

Conventional Commits (§62). Work happens on `feature/module-XX-*` branches
and merges into `develop` (§60). Never commit to `main` directly.
