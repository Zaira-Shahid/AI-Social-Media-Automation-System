# Module 09 — Content Preview & Approval: Implementation Plan

**Status:** Implemented (§64 Steps 1–9 complete). Verified 2026-09-01.
**Branch:** `feature/module-09-approval` (from `develop`).

---

## Step 1 — Read

§10 (human approval is mandatory), §11, §14, §16 (preview, edit, approve,
reject), §17 (per-platform status, allowed transitions, derived story status),
§21, §27 (role permissions), §32 (`content_versions`), §33, §37 (the content
screen's states), §48 (approval workflow), §52, §55 (audit trail), §58, §59,
§63, §65, §67.

## Step 2 — Inspect

| Item | State |
|---|---|
| `platformPosts` | Written by Module 07 with `status`, `version`, `lastError`; no approval fields |
| Status | `postStatusSchema` existed; nothing ever moved a post out of `IN_REVIEW` |
| `/content` | Listed stories and versions, offered regenerate only; said §37's full screen was Module 09 |
| Permissions | `content:edit`, `content:regenerate`, `content:approve` already defined in §27's table |
| `firestore.rules` | `platformPosts` already denies every client write |
| Media | Module 08 renders a card per version; `mediaUrl` may still be null |

## Step 3 — Plan

### The transition table is the module

§17 lists the allowed transitions and says they must be enforced server-side,
adding that "frontend-only status protection is not acceptable". So the table
lives in [`src/lib/content/status.ts`](../src/lib/content/status.ts) as pure
data, is tested as rules rather than inferred from a live approval, and is
applied inside a Firestore transaction that re-reads the current status.
Two reviewers acting at once would otherwise both pass a check made seconds
earlier — one approving what the other had just rejected.

Nothing was added to §17's list. In particular there is **no un-approve**:
approval is recorded with an actor and a timestamp (§55), and silently
reversing it would make that record describe a state the post is no longer in.

### Approval lives on the platform post, and only there

§17 puts approval on the platform post and says the publishing engine "must
never infer approval from the parent content item". `approvedBy`, `approvedAt`
and `rejectionNote` are therefore fields on `platformPosts`, and "approve all"
is a loop over eligible posts through the same single-post path (§63: "a
convenience … not a separate story-level state"). A post it cannot approve is
**reported**, not skipped — an "approve all" that quietly approved two of three
would be worse than one that approved none.

### The story status is derived, never stored

`deriveStoryStatus` is computed on every render from the platform statuses. It
exists so the queue can show one line per story; it authorizes nothing. A story
whose platforms disagree reads as Mixed rather than picking a winner.

### An approval needs an image (§67)

Approving a version with no rendered card would produce an `APPROVED` record
publishing could never honour — Instagram's API will not accept a post without
media at all. The refusal names the platform and, when a render failed, quotes
the reason.

### A human's edit is validated like a machine's

`editPost` re-runs `validatePlatformVersion` — the brand's hashtag rules, the
platform's caption limit, §14's rule against a URL in the visual concept — and
writes a `contentVersions` row with `reason: "EDITED"` and `mode: "REAL"`,
because a human wrote it. The visual concept is deliberately **not** editable:
changing it without re-rendering would leave a card that no longer matches its
own copy. Editing stops at approval, for the same reason un-approving does not
exist.

## Implementation record (§64 Steps 4–9)

### Files

- `src/lib/content/status.ts` — §17's transitions, editability, the derived
  story status, the "approve all" eligibility filter. Pure.
- `src/lib/content/review.ts` — approve, reject, approve-all, edit. Server only.
- `src/lib/content/store.ts` — `applyStatusTransition` and
  `updatePlatformPostCopy`, both transactional.
- `src/app/(app)/content/actions.ts` — four server actions, each re-checking
  its own permission and writing an audit record.
- `src/app/(app)/content/page.tsx` — §37's status tabs, applied server-side.
- `src/components/content-list.tsx` — preview, edit form, approve/reject,
  approve-all, per-version rejection reason and approval time.

### One end-to-end assertion was wrong, and the run said so

The first credentialed run failed on "a MANAGER can reject a version": it
waited for the success message inside the reject form. On the review-queue tab
a rejected version leaves the list, so the form — and with it the message —
unmounts before it can be read. The behaviour is right; the assertion was not.
It now checks that the queue is one shorter, and the next test reads the stored
reason on the Rejected tab. This is the §67 rule applied to our own tests: the
fix was to the assertion, not to the screen.

### What the tests cover

- `tests/unit/content-status.test.ts` — every entry in §17's table, including
  what it refuses: self-transitions, un-approving, skipping review.
- `tests/unit/content-review.test.ts` — the approval record, the missing-image
  refusal, per-platform reporting from "approve all", and that a human edit is
  validated and versioned.
- `tests/e2e-auth/news.spec.ts` — approval refused for a missing image, a
  MANAGER rejecting with a reason, a MANAGER not being offered Edit (§27), a
  SOCIAL_MANAGER editing into a new version, the status tabs, and the derived
  story badge.

### Verification (§59)

| Gate | Result |
|---|---|
| Type check, lint, format | pass |
| Vitest | pass — 279 tests, 24 files (was 251/22) |
| Emulator rules tests | pass — 33 tests |
| Playwright, no credentials | pass — 13 tests |
| Playwright, credentialed | pass — 54 tests (was 47) |
| Production build | pass |

### Security and correctness review (§64 Step 7)

- **Authorization.** Every action calls `requirePermission` itself:
  `content:approve` for approve, reject and approve-all, `content:edit` for
  edits. §27 gives MANAGER approval but not editing, and the screen matches —
  but the check that matters is the one in the action, since a hidden button is
  frontend-only protection.
- **Server-side transitions (§17).** The status is re-read inside the
  transaction and the rule applied there. `firestore.rules` denies every client
  write to `platformPosts`, so these functions are the only path.
- **Inputs.** The status filter is parsed with the schema and an unknown value
  falls back to the unfiltered list. Edited copy goes through the same
  validation generated copy does. Hashtags accept whitespace or commas and are
  normalized by the brand's rules.
- **Audit (§55).** Approve, reject, edit and approve-all each write an audit
  record with the actor; the rejection note is stored on the post and truncated
  in the audit metadata.
- **No fake success.** A refused transition returns the reason it was refused;
  "approve all" reports every platform it could not approve; approval is
  impossible without a rendered card.

### Next

Module 10 — Social Media Calendar. Module 05's WhatsApp swap is still open on
`feature/module-05-whatsapp-notification`.
