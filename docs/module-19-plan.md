# Module 19 — AI Strategy Optimization

Spec sections: §8, §10, §11, §24, §25, §30, §31, §32, §33, §40, §44, §51,
§55, §63 (Module 19), §65, §67.

Build: evidence-based analysis, strategy recommendations, strategy
versioning, next-week strategy, automated strategy update. §63 is explicit:
"do not allow this module to bypass approval" — §24 draws that line exactly
where the previous modules left it: **the strategy itself may change
automatically; a post still always needs a human's approval before it
publishes.** Nothing in this module writes a platform post, changes a status,
or touches the publishing engine.

## Step 1 — Read

§24 (what the AI may recommend or modify, and the one thing it may never
do), §25 (every recommendation needs a reason grounded in real analytics —
the exact shape: "Recommendation: ... Reason: ..."), §30
(`generateStrategy()` named as this module's AI function), §31 (Zod
validation), §32 (`strategy_reports`, versioned), §40 (Strategy Screen — its
nav entry was stubbed inert, same as Analytics before Module 18), §44/§51
(`10_strategy_optimization`, run after the weekly analysis tick), §55
(`STRATEGY_GENERATED` — already declared in the audit vocabulary, unused
until now), §65/§67. Also §8 (the fixed "exactly three stories a day" rule)
and §11 (the brand profile is human-owned) — both named below as boundaries
this module does not cross.

## Step 2 — Inspect

| Item | State |
|---|---|
| Weekly reports (Module 18) | Present — the only source of real evidence this module reads |
| A "current strategy" concept | Did not exist |
| Strategy Screen (§40) nav entry | Stubbed inert |
| `strategy:view` / `strategy:manage` permissions | Already in the role matrix (ADMIN+MANAGER view, ADMIN manage), unused until now |
| `STRATEGY_GENERATED` audit action | Already declared (§55), unused until now |

## Step 3 — A scoping decision, stated plainly

§24 lists what the AI "can recommend or modify": topic weighting, platform
weighting, posting frequency, content mix, headline style, CTA style, static
format distribution, educational/promotional balance, recommended timing.
Two of those cannot be numbers this module computes or the AI writes,
without crossing a line another module already owns:

- **Posting frequency** would mean changing Module 06's fixed "exactly three
  stories a day" (§8) — not this module's rule to change, and nothing here
  attempts to.
- **Headline style / CTA style** sound like brand voice, but §11 keeps the
  brand profile centrally human-edited. This module never writes to
  `brandSettings` or `companySettings`.

So every one of §24's eight items is produced here as **a recommendation on
the Strategy screen for a human to read and, if they choose, act on** — not
as a live control that silently reconfigures news ranking, content
generation or the brand profile. Topic, platform and format weighting are
real computed numbers (§25); posting frequency, content mix, headline style,
CTA style and timing are AI-written text, each with a reason. Wiring any of
these into Module 07's generation prompts or Module 04's ranking weights
would be a substantial, separate change to two already-shipped, tested
modules, and nothing in the roadmap's bullet list for this module or the
next one (Module 20 — Automation Control Center, which is workflow status,
not strategy application) asks for it. If that wiring is wanted, it should
be its own explicit request.

One more substitution, named rather than left implicit: §25's own example is
"educational posts generated higher average engagement than promotional
posts" — but this system stores no "content type" tag distinguishing
educational from promotional. The closest real, stored signal is
`VISUAL_TEMPLATES`' four formats, one of which (`EDUCATIONAL_CARD`) already
names itself that. The AI is told this substitution directly in its prompt,
so its content-mix reasoning is grounded in the format weighting it was
actually given, not an invented category.

## Step 4 — Implementation

### Weighting is computed, not written by the AI (`compute.ts`)

`aggregateWeighting` sums each topic/platform/format's measured engagement
across the lookback window (§25's own "previous 4 weeks",
`STRATEGY_LOOKBACK_WEEKS`), then expresses each key's share of the total as
a percentage. Pure and synchronous, same discipline as
`reporting/compare.ts` — a weight is always a real proportion of stored
numbers, never something the model invented. An empty window produces an
empty weighting, not a divide-by-zero or a guess.

### Versioning (`schema.ts`, `store.ts`)

`strategyReports` is append-only, the same shape as `contentVersions`: every
run adds a document with an incrementing `version`, and "current strategy"
is simply the highest one (`getCurrentStrategy`, `orderBy("version", "desc").limit(1)`).
Nothing here ever overwrites a previous version — §24 permits the strategy
to change automatically precisely because the history stays intact and
visible.

### The one AI call, grounded and validated (`optimize.ts`)

`generateStrategy()` is handed only the computed weighting numbers — never
raw posts — and returns up to eight recommendations, each with a `category`
from §24's fixed list and a `reason`. Validated per-entry with Zod (§31),
mirroring `content/generate.ts`'s `adaptationEnvelopeSchema` pattern: one
malformed entry (an invented category, for one) is dropped rather than
failing the whole run. Two refusals mirror Module 18's:

- **Skipped entirely when no week in the window has any measured posts** —
  nothing to be evidence for (§67).
- **A failed AI call still saves the real computed weighting.** The
  narrative is what's allowed to go missing, never the numbers (§52, §67).

### Storage, screen, and the manual trigger

`firestore.rules` opens `strategyReports` to signed-in reads, denies every
client write. `/strategy` (§40) shows what worked/what did not (reusing
Module 18's most recent weekly report, not recomputing it), the current
version's weighting and recommendations, and version history. A "Regenerate
now" button — gated on `strategy:manage`, ADMIN only — mirrors the Content
screen's manual-generation pattern, for the same reason: n8n owns the
schedule, but nobody should have to wait for next week's cron to see an
updated strategy after a new weekly report lands.

## Step 5 — Tests

`tests/unit/strategy-compute.test.ts` — the weighting math: sums correctly
across weeks, sorts strongest first, produces nothing over an empty window.
`tests/unit/strategy-optimize.test.ts` — orchestration with Firestore and
the AI provider replaced: the AI call skipped when nothing was measured,
version numbers incrementing off the current highest, a malformed
recommendation dropped rather than failing the run, the real weighting still
saved when the AI call fails, and one `STRATEGY_GENERATED` audit entry per
run.

## Step 6 — Validate

`typecheck`, `lint`, `test` (490 passed), `build`, and `test:rules` against
the Firebase emulator (37 passed) — all clean.

## Step 7 — Security

Reviewed directly: the webhook is signed identically to every other n8n
trigger; `strategyReports` denies all client writes; the manual action takes
no form input at all and is gated on `strategy:manage` before it calls the
engine. No findings.

### Next

Module 20 — Automation Control Center: workflow status, last/next run, and
on/off for each automation named in §41 — including the two this module and
Module 18 added (`09_weekly_performance_analysis`,
`10_strategy_optimization`).
