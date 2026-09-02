# Module 23 — Final QA & Deployment

Spec sections: §23 (module roadmap), §28, §44, §56, §57, §65, §69, §70.

Perform: full integration testing, production build, workflow testing,
security audit, performance review, documentation, deployment, final smoke
test. The last of the numbered modules — not a new screen, an acceptance
pass against §69's "should feel like a serious internal enterprise
product" and §70's full end-to-end chain.

## Step 1 — Read

§70's chain — discovery → normalize → dedupe → rank → shortlist → Slack →
human selects → generate → adapt per platform → brand applied → render →
preview → edit → approve → schedule → publish → analytics → weekly report
→ strategy → human approval still mandatory — is the acceptance bar. §69
fixes what a company employee should be able to answer from the dashboard
at a glance.

## Step 2 — A fork worth stating plainly

§23's "deployment" bullet needs an account only the project owner holds —
Render, in this project's case. I prepared everything short of the
account-level action (`render.yaml`, `docs/deployment-guide.md` with every
env var and its source, the n8n webhook wiring table, a smoke-test
checklist) rather than assume I could complete it unattended. This was
asked and confirmed before doing the rest of this module.

## Step 3 — Full integration testing

Ran cold, not assumed from earlier passes:

- `npm run verify` (typecheck, lint, format, 510 unit/integration tests,
  production build) — clean.
- `npm run test:rules` against the Firebase emulator — 37/37, both allow
  and deny cases.
- `npm run test:e2e:auth`, the full credentialed suite — 86/86, every role,
  every screen.
- `npm run test:e2e`, the no-credential smoke suite — 17/17.
- `npm audit` — 0 vulnerabilities.

One transient failure worth recording so it isn't mistaken for a real bug
later: `tsc --noEmit` failed once on a torn `.next/dev/types/validator.ts`
— Next's own generated route-type file, caught mid-write by the dev server
that happened to be running concurrently. Deleting `.next/dev/types` and
retrying resolved it; nothing in `src/` was at fault.

## Step 4 — Workflow testing (§44, §70)

Not simulated — actually run. Every signed webhook in the chain was called
in sequence against the real project, in the order n8n would call them:
discovery → ranking → (existing) selection → content generation → card
rendering → approval → scheduling → due-check → publish → analytics sync →
weekly analysis → strategy optimization → Slack notification. This is the
literal §70 acceptance chain, executed end to end rather than asserted.

It found one real defect along the way: `firestore.indexes.json`'s two
composite indexes (`automationRuns` from Module 20, `platformPosts` from
Module 18) had been written and tested against the emulator, but **never
deployed to the real project** — `firebase deploy --only firestore:indexes`
had never been run outside this module. Weekly analysis failed outright
(500) until it was. Recorded here because it is exactly the kind of gap a
"tested against the emulator" checklist can miss: the emulator has no
concept of an undeployed index, so the tests passing there proved nothing
about the live project's state.

## Step 5 — Security audit (§56)

Re-checked what changed since Module 22 rather than repeating the whole
audit: the dashboard redesign, the dev-only CSP `unsafe-eval` fix (already
reasoned through and verified when made), and the new
`scripts/seed-brand-profile.mjs`. The script never logs a credential or a
decrypted value — same convention as `provision-user.mjs` — and needs
nothing beyond the same `.env.local` access every other admin script in
`scripts/` already requires. No new findings.

## Step 6 — Performance review

A clean production build (into a throwaway `NEXT_DIST_DIR`, so it doesn't
collide with the dev server's own `.next`) puts total client-side static
assets at **~1.8 MB**, largest single chunk **~383 KB**, across a
14-screen application with the Firebase client SDK — healthy, no route
found carrying more than its own screen needs. Cold page loads against the
live dev server measured **~640 ms**. No action needed.

One process note: passing an unfamiliar `NEXT_DIST_DIR` value caused
`next build` to silently rewrite `tsconfig.json`'s `include` list and
reformat the whole file. Reverted before committing anything — worth
knowing about if this check is ever repeated.

## Step 7 — Documentation

This file; `render.yaml`; `docs/deployment-guide.md` (account setup, the
full env var table cross-referenced with `.env.example`, the n8n wiring
table with the exact HMAC scheme, the keep-warm requirement from §28's own
research, and a final smoke-test checklist); the README status table.

## Step 8 — Final smoke test

Performed against the real, now-seeded project (not the emulator) as part
of Step 4's workflow run: sign-in, every screen reachable per role,
generation through publication, analytics and reports populated, a real
Slack message delivered. `docs/deployment-guide.md`'s own checklist is this
same list, so it can be re-run identically once the app is actually live
on Render.

### Status

All 23 modules (plus the platform-access spike) complete. Deployment
itself — the Render account-level step — is prepared and documented,
pending the project owner's action per `docs/deployment-guide.md`.
