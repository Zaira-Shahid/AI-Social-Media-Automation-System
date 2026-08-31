# Module 02 — Company & Brand Intelligence: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-08-31.
**Branch:** `feature/module-02-brand` (from `develop`).

---

## Step 1 — Read

§11 (brand intelligence), §14 (image sourcing rule), §15 (how the brand feeds
the static post generator), §27 (`brand:manage` is ADMIN-only), §28 (Cloudinary
credit model), §31 (Zod validation), §32 (collection design checklist), §33
(Security Rules), §34 (navigation), §43 (brand screen), §55 (audit), §58, §63.

## Step 2 — Inspect

| Item | State |
|---|---|
| Brand or company code | None. Only the `brand:manage` permission exists, unused |
| Collections in use | `profiles`, `auditLogs` |
| Auth / roles | Module 01, working against the live project |
| Navigation | §34 items render as inert `<span>`s — no route is linkable yet |
| Server-side mutation pattern | None. Module 01's only mutation is a route handler, because it is called from client SDK JavaScript |

Nothing to migrate.

## Step 3 — Plan

### Scope

The single central brand profile, its screen, its validation, and logo
storage. **Not** in scope: templates, rendering, or anything that consumes
the brand (§15 is Module 08), and no per-platform brand variation — §11 is
explicit that the identity must not be duplicated per platform.

### 3.1 Documents (§32's checklist, steps 3–5)

Two singleton documents rather than one, because §63 and §32 name them
separately and they change for different reasons — company facts are stable,
brand voice is edited often:

```text
companySettings/default
  name  description  website  industry  updatedAt  updatedBy

brandSettings/default
  logo            map     { url, publicId, width, height } | null
  colors          map     primary secondary accent background text  (hex)
  typography      map     { headingFont, bodyFont }
  visualStyle     string
  toneOfVoice     string
  writingStyle    string
  targetAudience  string
  brandPositioning string
  preferredTopics  array<string>
  topicsToAvoid    array<string>
  ctaStyle         string
  hashtagRules     map    { maxHashtags, required[], banned[], style }
  contentRules     array<string>
  visualRules      array<string>
  updatedAt  updatedBy
```

Fixed document ID `default` for both. These are configuration, not records:
a fixed ID means "the brand profile" is always one known path, and a second
one cannot quietly appear. No indexes are needed — neither collection is
ever queried, only fetched by ID.

Typography stores font *names* only. §15 requires font data to be supplied
explicitly to Satori with no system fallback, but choosing and bundling that
data is Module 08's problem; storing a name it cannot resolve would be worse
than storing nothing, so the field is documented as a name and validated
against the fonts the renderer will actually ship with.

### 3.2 Validation (§31, §32 step 8)

Firestore enforces no schema, so Zod is the schema. One shared module,
imported by both the server action and the form, so the rules cannot drift
between what the UI shows and what the database accepts.

Beyond field shapes, three business rules worth enforcing because each has a
real failure behind it:

- **Colours must be hex.** They are handed to Satori, which will not accept a
  CSS colour name it does not know, and the failure would surface much later
  as a broken render.
- **A topic cannot be both preferred and avoided.** Contradictory instructions
  reach the model as noise, and it will silently pick one.
- **Hashtag count has an upper bound**, and required tags cannot also be
  banned, for the same reason.

### 3.3 Logo storage (§28)

Signed, server-side Cloudinary upload — the pipeline from §15's rules, built
here only for the logo.

Cloudinary's free plan is credit-based and storage, bandwidth and
transformations all draw from the same 25-credit pool (§28), so: one eager
resize at upload time to bound the stored asset, then never transform on the
fly. Accepted types are PNG and SVG; size capped before anything is sent.

Replacing a logo deletes the previous asset by `publicId`. Orphaned uploads
are pure credit burn, and nothing else references the old one.

### 3.4 Screen (§43)

`/brand` — one form covering company, colours, typography, voice, audience,
topics, CTA, hashtag and content rules, plus logo upload with a preview.

Gated on `brand:manage`, which §27 gives to ADMIN alone. Other roles reach
`/forbidden`, not a broken page.

Loading, empty and error states are part of this module (§59). The empty
state matters more than usual: before the first save, every downstream module
depends on values that do not exist yet, so the screen has to say so rather
than render blank inputs.

### 3.5 Mutation path

A **server action**, not a route handler. Module 01 used a route handler
because the client SDK had to POST a token to it; nothing here is called from
client-side JavaScript, so a server action removes the endpoint, does the
authorization check in the same place as the write, and handles the multipart
logo upload without a second mechanism.

Every write re-checks `brand:manage` server-side. §33 is explicit that the
Admin SDK bypasses Security Rules.

### 3.6 Security Rules (§33)

- `companySettings/{id}` and `brandSettings/{id}` — client **read** for any
  signed-in user, since previews and generation UI in later modules need the
  brand. No client **write** at any role: writes go through the server action,
  which is where the authorization and validation live.
- Default-deny wildcard stays for everything else.

Allow and deny cases both tested (§58).

### 3.7 Audit (§55)

`SETTINGS_CHANGED` on every save, recording which fields changed — names
only, not values. A brand profile is long free text; storing before-and-after
copies would bloat the audit collection without telling anyone more than the
field list does.

### 3.8 Navigation

§34's Brand entry becomes a real link, and the shell starts marking the
active route. Entries without a route stay inert rather than linking
nowhere. Items the current role cannot reach are hidden — showing a user a
link that will bounce them to `/forbidden` is worse than not showing it.

### 3.9 Tests

- **Unit** — brand and company schemas: hex colours, the preferred/avoided
  overlap, required-vs-banned hashtags, bounds, and that a valid profile
  round-trips.
- **Rules** — signed-in read allowed; unauthenticated read denied; client
  write denied for every role including ADMIN.
- **E2E** — signed out redirects to login; ADMIN sees the form, saves, and
  the values persist; a SOCIAL_MANAGER is refused.

---

## Implementation record (§64 Steps 4–9)

### Deviations from the plan

| Plan | What shipped | Why |
|---|---|---|
| Logo constants in `logo.ts` | Split into `logo.shared.ts` | `logo.ts` is `server-only` and loads the Cloudinary SDK, so the form could not import the accepted file types from it. Retyping them in the component would have let the browser's `accept` attribute drift from what the server enforces. |
| Single e2e account | Fixture now holds an ADMIN and a SOCIAL_MANAGER | The role-refusal case cannot be tested with one account. The seed also clears the brand documents, so the empty-state assertion runs against a genuinely unconfigured profile rather than whatever the previous run left behind. |

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 52 tests, 6 files (was 33) |
| Emulator rules tests | pass — 20 tests (was 15) |
| Playwright, no credentials | pass — 8 tests |
| Playwright, credentialed | pass — 10 tests, 6 of them the brand screen |
| Production build | pass — `/brand` added |

The credentialed brand tests cover the empty state, a save that survives a
reload, both business-rule rejections, the SOCIAL_MANAGER refusal, and that
the navigation entry is hidden from that role rather than shown and then
refused.

### Security review (§64 Step 7)

- **Authorization.** `requirePermission("brand:manage")` runs in the page and
  again inside the server action. §27 gives that permission to ADMIN alone.
  The action re-checks rather than trusting the page, because a server action
  is a callable endpoint whether or not a page rendered its form.
- **Rules.** Brand documents are client-readable to any signed-in user, since
  later previews need them, and client-writable by nobody — including ADMIN.
  A client write would bypass the §31 validation and store a brand the
  renderer cannot use. Both cases are tested.
- **Uploads.** Signed and server-side (§15). Type and size are checked before
  anything reaches Cloudinary, and the upload happens only after validation
  passes, so a rejected form cannot leave an orphaned asset burning credits.
- **Audit.** `SETTINGS_CHANGED` records which fields changed, by name only.
- **Input.** Every field is Zod-parsed and trimmed; lists are normalized and
  deduplicated rather than stored as typed.

### Note on Cloudinary credits (§28)

The logo is uploaded with one eager resize and a fixed public ID, and the
previous asset is deleted on replacement. Storage, bandwidth and
transformations all draw on the same 25-credit pool, and the logo is fetched
on every generated card, so paying for one transform at upload beats paying
per view.

### Not deployed yet

`firestore.rules` gained the two brand matchers but has **not** been deployed
to the live project. Nothing needs it yet — the app reads the brand through
the Admin SDK, which bypasses rules entirely — but it should go out before
any client-side read of the brand lands:

```bash
firebase deploy --only firestore:rules
```

### Next

Module 03 — News Source Management.
