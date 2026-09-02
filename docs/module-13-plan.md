# Module 13 — Instagram Integration

Spec sections: §13, §19, §20, §21, §42, §52, §63 (Module 13), §65, §66, §67.

Module −1 rated Instagram **REAL — likely, blockers: none**, on the finding
that Meta's Standard Access needs no App Review for accounts you own. This
module confirms that and builds the adapter. It answers, against Meta's own
documentation rather than from memory (§65), the three things Module −1
explicitly deferred here.

## What Module −1 asked, and what the documentation says

Checked 2026-09-02.

**1. The exact publishing permission names — was `[UNVERIFIED-PRIMARY]`.**

Module −1 recorded `instagram_business_basic` and
`instagram_business_content_publish` from secondary sources. Those names are
real but they belong to **Instagram Login**, which is a separate OAuth flow
against `graph.instagram.com`. This system uses **Facebook Login**: Module 12
already connects the Page, and the Instagram account is reached through it.
That path's scopes are `instagram_basic`, `instagram_content_publish` and
`pages_read_engagement` — plus `pages_show_list`, which is what finds the Page
in the first place. Those are the names the connect screen asks for.

**2. Does publishing require a public media URL? — was `[UNVERIFIED]`, and
flagged as constraining Module 08's storage design.**

Yes, and more narrowly than Module −1 feared. Meta: "We cURL media used in
publishing attempts, so the media must be hosted on a publicly accessible
server at the time of the attempt", and "**JPEG is the only image format
supported.** Extended JPEG formats such as MPO and JPS are not supported."

Both halves are already satisfied and neither costs anything now: Module 08
uploads to Cloudinary, whose delivery URLs are public, and it already converts
the Instagram card to JPEG at upload (`STORED_FORMAT.INSTAGRAM === "jpg"`) for
exactly this reason. **No storage change was needed.** The adapter still
checks the extension itself before creating a container, so a PNG that somehow
reached it fails locally instead of after a container has been spent.

**3. The content publishing rate limit — was `[UNVERIFIED]`, and flagged as
possibly constraining the scheduler.**

It exists: "Instagram accounts are limited to 100 API-published posts within a
24-hour moving period", readable at `GET /{ig-user-id}/content_publishing_limit`.
§3's daily workflow produces three posts a day, so **the scheduler is
unchanged** — raising a limit we are two orders of magnitude below would be
invented complexity. `readPublishingLimit()` is exported so Module 20 can show
the real number instead of this document's remembered one.

## What was built

### `src/lib/publishing/instagram.ts`

`InstagramAdapter` implements Module 16's `ProviderAdapter` contract — the same
one Module 12 was built against, unchanged, which is the point of §20 defining
it first.

Publishing is **two calls, not one**, unlike Facebook:

1. `POST /{ig-user-id}/media` with `image_url` and `caption` — creates a
   container Meta fetches the image into.
2. Poll `GET /{container-id}?fields=status_code` until `FINISHED`.
3. `POST /{ig-user-id}/media_publish` with `creation_id`.
4. `GET /{media-id}?fields=permalink` for a link a human can open.

Meta's documented status values are handled distinctly rather than collapsed
into "not finished yet":

| `status_code` | Treated as |
|---|---|
| `FINISHED` | Ready — publish it |
| `PUBLISHED` | Already posted — treated as arrival, never republished |
| `ERROR` | Failure, **not** retryable (the image itself is the problem) |
| `EXPIRED` | Failure, retryable — nothing was posted |
| `IN_PROGRESS` past the last attempt | Failure, retryable — Meta is still working |

Polling follows Meta's own advice — "once per minute, for no more than 5
minutes" — and gives up rather than blocking a scheduler run indefinitely. The
interval is a constructor argument so the tests do not sleep.

Step 4 is deliberately not allowed to fail the publish. An Instagram media id
does not appear in a public URL the way a Facebook post id does, so the
permalink has to be asked for; if that call fails the post still exists, so the
result is a success with a null permalink. §67 cuts both ways — do not claim a
link we do not have, and do not disown a post we do.

`findInstagramAccount()` reads `instagram_business_account{id,username}` off
the Page node. A Page with no linked account is Meta's most likely refusal here
and it answers with an **absent field rather than an error**, so that case is
named explicitly instead of surfacing as "undefined".

### Configuration

`INSTAGRAM_PROVIDER` (`graph` | `mock`, default `mock`) — its own switch, not a
shared Meta one. The Page and the Instagram account are separate connections
that can be enabled separately, and one flag would mean turning on either turns
on both. There is no second app: the app credentials are `FACEBOOK_APP_ID` and
`FACEBOOK_APP_SECRET`, because the Instagram account is reached through the
Page.

### Screen and actions (§42)

`connectInstagram` / `disconnectInstagram` mirror Module 12's: a pasted user
token, exchanged server-side for a long-lived one, the Page found, the linked
Instagram account read, and the **Page token** stored encrypted against the
**Instagram user id** — that pairing is what publishes.

Disconnecting one platform leaves the other publishing; they are separate
documents in `socialAccounts` and separate audit entries.

Module 12's `FacebookConnect` became `MetaConnect`, one form driven by a
per-platform config, since the flows are identical apart from wording. Two
forms that started the same and drifted apart would be the worse outcome.

### Tests (§58)

- `tests/unit/publishing-instagram.test.ts` — 23 tests: the container/publish
  order and bodies, a non-JPEG refused before any call is made, every
  `status_code` branch, no media id being a failure not a success, code 9007
  retryable and a rejected token not, an unreadable 5xx body, a failed
  permalink still reporting the post, and no token in the logged failure.
- `tests/rules/firestore.rules.test.ts` — no client may read or write the
  Instagram credential either.
- `tests/e2e-auth/social-accounts.spec.ts` — Instagram reads MOCK, its
  limitation names `INSTAGRAM_PROVIDER` rather than a module that owes it, both
  token fields are password fields, the Instagram form names
  `instagram_content_publish`, and connecting without app credentials fails
  with the reason. LinkedIn is now the row that names its module.

No test contacts Meta. `fetch` is replaced in the unit tests and both providers
stay `mock` everywhere else.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 390 tests, 29 files (was 367/28) |
| Emulator rules tests | pass — 37 tests (was 36) |
| Playwright, no credentials | pass — 16 tests |
| Playwright, credentialed | pass — 79 tests (was 76) |
| Production build | pass |

### Security and correctness review (§64 Step 7)

- **Secrets.** The app secret stays server-side and is used only in the
  exchange. No token is logged, returned to a client, or rendered — the Graph
  calls all carry one in the body or query string, so the request itself is
  never logged, only its status and error code.
- **At rest.** AES-256-GCM, the same key and helpers as Module 12.
- **Rules (§33).** `socialAccounts` denies client reads and writes; the
  Instagram document is now covered by its own emulator test rather than by
  assuming the Facebook one generalises.
- **Authorization.** Connecting and disconnecting need `integrations:manage`,
  re-checked inside each action, not merely hidden in the UI.
- **Audit (§55).** Connect and disconnect write `SETTINGS_CHANGED` with the
  Instagram user id, username and Page id — never the token.
- **No fake success (§67).** A publish without a media id is a failure; a
  container that never finishes publishes nothing; the mock adapter returns a
  visibly fake id and is labelled MOCK.
- **Failure handling (§52).** Failures return a reason and a `retryable` flag
  rather than throwing. Only rate limits (4, 17, 32, 9007), Meta's transient
  errors (1, 2), 5xx and network faults are retryable; a rejected token or a
  refused image is not.

### Open item for the owner

The real path cannot be exercised until Meta credentials exist. Module −1's
checklist A applies in full, with two Instagram-specific items: the account
**must be Professional (Business or Creator)** — a personal account has zero
API access — and it **must be linked to the Facebook Page**. With that done,
`FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` set and `INSTAGRAM_PROVIDER=graph`, the
connect form and the adapter are ready to run against the real account.

### Next

Module 14 — LinkedIn Integration. Module −1 flagged that LinkedIn's
self-serve tier gives a 60-day token that cannot be refreshed programmatically,
which is why `TokenStatus` already has an `EXPIRING` state waiting for it, and
that post analytics are behind a closed permission — so §22's coverage will be
Facebook and Instagram only.
