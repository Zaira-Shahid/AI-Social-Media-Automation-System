# Screenshot Checklist for the Client Pitch Deck

Twelve screenshots, numbered to match the `[SCREENSHOT N: ...]` markers in
`docs/client-pitch.md`. Take them in order, drop each one in over its
matching marker (`![caption](docs/screenshots/client-pitch-N-name.png)`),
and this doc is done.

## Before you start

- **Log in as ADMIN.** A couple of screens (Users in Settings, some Automation
  controls) only show their full content to that role.
- **Browser width ~1440px**, light mode. The app's design was built and
  tuned against that — it'll match the rest of the pitch deck's look.
- **Real data beats empty states.** Every screen below has a "best state" —
  if your project doesn't have that data yet, do the quick action noted
  first (there's always a one-line way to get there).
- Save each file as `docs/screenshots/client-pitch-N-<name>.png` (e.g.
  `client-pitch-1-dashboard.png`) so they don't collide with the three
  screenshots already used in the technical README.

---

### 1. Dashboard overview
**URL:** `/`
**Best state:** At least one post sitting in the review queue (so the
"Pending approval" card shows a real number, not zero) and at least one
automation with run history (so "Automation health" isn't blank). If
pending approval shows 0, generate content for today's selection from
`/content` first, then come back.
**Caption:** *"The command center — today's status, at a glance, the
moment your team logs in."*

### 2. Daily news shortlist
**URL:** `/news`
**Best state:** After ranking has run for the day, before all three
stories are picked — you want the ranked list with its scores/badges
visible, showing the AI's shortlist doing its job. If the list is empty,
trigger ranking from the Automation screen ("Run now" on Daily News
Discovery) first.
**Caption:** *"The AI-curated shortlist your team chooses from every
morning — relevant stories, ranked and ready."*

### 3. Configured news sources
**URL:** `/news/sources` (nested under News in the sidebar)
**Best state:** Several sources listed with a healthy status shown for
each — this is the "configured, not generic" story, so more than one or
two sources looks better here.
**Caption:** *"The industry sources feeding the pipeline — fully
configurable to what matters to your business."*

### 4. Content review and approval queue
**URL:** `/content`
**Best state:** The "Review queue" tab, with at least one story's three
platform versions visible, ideally with a rendered card image showing (not
just caption text) — that's the most visually convincing part of this
screen. Real AI-generated copy (not the mock "Simulated: ..." placeholder
text) looks far more credible for a client pitch — see the note at the
bottom of this checklist if you want to regenerate with real content
first.
**Caption:** *"Every platform version, previewed exactly as it will
appear, ready for a one-click approval."*

### 5. Publishing calendar
**URL:** `/calendar`
**Best state:** Month view, with a handful of posts spread across
different days — a mix of scheduled and already-published looks best. If
the calendar looks sparse, schedule two or three approved posts on
different days first.
**Caption:** *"A visual, at-a-glance calendar of everything scheduled and
everything already live, across every platform."*

### 6. Weekly analytics report
**URL:** `/analytics`
**Best state:** A week with real measured posts — best/weakest posts and
the platform/topic comparison tables populated, not the empty "no report
yet" state. If it's empty, a weekly report needs at least one published
post to measure; trigger it from Automation once you have one.
**Caption:** *"Real performance data, plainly reported — never a number
the system had to guess at."*

### 7. AI strategy recommendations
**URL:** `/strategy`
**Best state:** A current strategy version with its weighting numbers and
recommendations filled in, plus the version history list showing more
than one entry (proves it evolves over time, not a one-off). Needs at
least one weekly report to exist first (see #6).
**Caption:** *"Next week's recommended strategy, with the evidence behind
every recommendation."*

### 8. Automation control center
**URL:** `/automation`
**Best state:** All rows visible (scroll if needed to fit the ones that
matter most in frame), a mix of ON/OFF toggles if you have one paused, and
one row's "Run history" expanded open so a reviewer can see that detail
exists.
**Caption:** *"Every automated process, its health visible at a glance,
with a manual override always available."*

### 9. Connected social accounts
**URL:** `/social-accounts`
**Best state:** All three platforms (Facebook, Instagram, LinkedIn) shown
connected with a clear status badge on each.
**Caption:** *"Every connected platform and its status — never a guess
about whether an account is actually live."*

### 10. Brand profile
**URL:** `/brand`
**Best state:** Fully filled in — logo visible, brand colors, tone of
voice, target audience all showing real content, not placeholder text.
**Caption:** *"One central brand identity — voice, colors, audience —
that every generated post is built from."*

### 11. Audit log
**URL:** `/automation/audit` (nested under Automation in the sidebar)
**Best state:** A varied list — a login, an approval, a publish, a
settings change — rather than twenty of the same action in a row. If it
looks repetitive, do a couple of different actions elsewhere in the app
first (approve a post, toggle an automation), then come back.
**Caption:** *"A complete, timestamped record of every consequential
action taken in the system."*

### 12. Account and settings overview
**URL:** `/settings`
**Best state:** The Users table showing more than one account (so it
reads as a real team, not a single login), and the application
configuration section visible below it.
**Caption:** *"Administrative visibility into who has access and how the
system is configured."*

---

## Optional: getting real AI-generated content for #4

Content generated in the app's default (simulated) mode is clearly labeled
"Simulated" in the copy itself — accurate, but not what you want in a
sales screenshot. If you want real AI-written copy for that one screenshot:

1. Get a free API key at console.groq.com (no card required).
2. Ask Claude to set `AI_PROVIDER=groq` with that key and generate a fresh
   batch of content for today's selection.
3. Take the screenshot.
4. Ask Claude to set `AI_PROVIDER` back to `mock` afterward, so day-to-day
   development stays off the live API by default.
