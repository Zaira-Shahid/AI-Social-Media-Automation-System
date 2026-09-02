# Module 08 — Static Post Generator: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-08-static-images` (from `develop`).

---

## Step 1 — Read

§11 (brand identity), §12, §13, §14 (static content and the image sourcing
rule), §15 (Satori → resvg → PNG), §17, §21, §28 (Cloudinary credits), §29,
§32, §33, §52, §55, §56, §58, §59, §63, §65, §66, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| Renderer | None. No Satori, no resvg, no fonts in the repository |
| Cloudinary | Configured in Module 00; Module 02 uploads the brand logo with one eager transform |
| `platformPosts` | `mediaUrl` and `mediaPublicId` written as null by Module 07; `lastError` named in §32 but never added |
| Visual concept | Module 07 stores template, headline, supporting text and emphasis |
| Brand | Colours as hex, typography from a fixed five-family list, logo on Cloudinary |
| `/content` | Shows copy and the concept; says no image exists |

## Step 3 — Plan

### Three things verified before writing anything (§65)

**Instagram's publishing API accepts JPEG only.** Meta's content publishing
documentation states plainly that "JPEG is the only image format supported".
§15's pipeline ends in PNG, so a PNG stored for Instagram would render
correctly, pass review, and then fail at publish time in Module 13. Instagram's
asset is therefore stored as JPEG, converted once at upload rather than as a
delivery transformation (§28).

**Satori cannot parse the variable fonts Google Fonts now publishes.** Tested
directly: its bundled opentype.js throws on the `fvar` table of
`Inter[opsz,wght].ttf`. Static weights are required, which decided how fonts
are shipped.

**Weight selection works with static WOFF.** Also tested: 400 and 700 produce
genuinely different output, so bold is really bold rather than silently
regular.

### Fonts, shipped rather than fetched

§15: "Fonts must be supplied explicitly as font data; there is no system font
fallback." So the set of fonts the brand form offers and the set the renderer
ships must be the same list, or a brand could choose a font that renders
nothing.

All five families ship as Fontsource's latin 400 and 700 WOFF builds —
**252 KB for all ten files**, against roughly 900 KB for a single variable TTF.
All are SIL OFL 1.1; the licence and every family's copyright notice ship with
them in `assets/fonts/LICENSE.txt`.

They are read from disk, not from a CDN: a render that reaches the network for
a font gains a failure mode and a latency spike for files that never change
between deploys.

### §14, enforced a third time

Module 07 keeps the article's image URL out of the prompt and rejects any URL
in a visual concept. This module adds the last one: **the templates have
nowhere to put an external image.** The only image any template renders is the
brand logo, and `assets.ts` refuses any logo URL that is not an asset in our
own Cloudinary account — host and cloud name both, because
`res.cloudinary.com` serves every account on the platform.

### Credit awareness (§28)

25 credits, shared across storage, bandwidth and transformations:

- Rendered at final size per platform, so nothing is transformed on delivery.
- One eager format conversion at upload, never a transforming URL.
- The logo is fetched once per run and cached for the process, not once per
  card — nine cards would otherwise pay for nine identical downloads.
- Public ids are deterministic (`posts/<platformPostId>`), so a re-render
  overwrites in place instead of orphaning an asset that keeps consuming
  credits.

### Order of operations (§63, §67)

Render, upload, **then** record. §63 requires that "a failed upload must not
leave a platform post in a state that claims a usable image exists", so the
document is written only after Cloudinary returns a URL for an asset that is
actually stored. A failure writes `lastError` and explicitly nulls the media
fields, so a failed re-render cannot leave an old URL looking like this run's
result.

---

## Implementation record (§64 Steps 4–9)

### A correction to Module 07's plan note

Module 07's document said the card renderer "cannot work without" a logo. That
was stronger than the behaviour warrants, and this module does not implement
it that way: **a card renders without a logo**, carrying the brand's colours,
typography and company name, and the run reports that the logo was missing.
Refusing to produce any image over one asset would block the pipeline for a
cosmetic reason. The company name is genuinely required, because every card
carries it.

### A production bug the end-to-end build caught

Satori loads HarfBuzz as WebAssembly from `harfbuzzjs`. Bundled by Next, it
resolved that path against the bundle rather than `node_modules` and failed at
runtime with `ENOENT ... hb.wasm` pointing at a path that does not exist.

It appears **only in a production build** — `next dev` is fine — so it would
have reached Render otherwise. `satori`, `harfbuzzjs` and `@resvg/resvg-js`
are all in `serverExternalPackages` now; the native addon could never have been
bundled anyway.

### What the tests do and do not touch

The renderer is tested **for real**: Satori and resvg both run locally with no
network and no key, so every template, every platform size, both fonts and the
long-headline case are rendered and inspected as actual PNG bytes.

The end-to-end suite deliberately **does not** trigger a render. Storing a card
uploads to the real Cloudinary account and spends credits, and §58 keeps tests
off live services. What the browser tests check is the three states the screen
distinguishes — rendered, failed with a reason, and not yet — and that a
SOCIAL_MANAGER is not offered the run.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 251 tests, 22 files (was 227/20) |
| Emulator rules tests | pass — 33 tests |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 47 tests (was 44) |
| Production build | pass — the rendering webhook added |

One stale assertion from Module 07 was updated: it expected the placeholder
text "No image yet — the static post generator is Module 08", which this module
replaced.

### Security and correctness review (§64 Step 7)

- **§14.** Templates accept no external image; the logo must be an asset in our
  own Cloudinary account, checked on host and cloud name. Tested.
- **Uploads.** Signed and server-side, as every upload in this system is.
- **Authorization.** The run sits under `automations:manage` and is re-checked
  inside the action; the webhook is HMAC-signed.
- **No fake success.** Media is recorded only after a successful upload; a
  failure records its reason and nulls the media; the screen distinguishes
  rendered, failed and not-yet.
- **Per-platform independence (§17).** One card failing does not stop the rest.
- **Credits.** Final size, one eager conversion, deterministic public ids, logo
  fetched once per run.

### Next

Module 09 — Content Preview & Approval.
