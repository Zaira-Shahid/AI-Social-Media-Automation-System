# Internal AI Social Media Automation System
## Zero-to-Hero Master Build Specification

**Document:** `AI-Social-Media-Automation-System.md`  
**Status:** Master Source of Truth  
**Build Mode:** Module-by-module  
**Product Type:** Internal company automation system  
**Publishing:** Human approval required  
**Content:** Static posts only  
**Initial Platforms:** Facebook, Instagram, LinkedIn  
**Internal Notifications:** Slack  
**Automation:** n8n  
**Primary Goal:** Replace repetitive social-media operations with a reliable AI-assisted internal system.

---

# 0. IMPORTANT INSTRUCTIONS FOR THE AI CODING ASSISTANT

This document is the project's **Single Source of Truth**.

Before changing any code, the assistant MUST:

1. Read this complete document.
2. Inspect the existing repository.
3. Inspect the existing `docs/` directory.
4. Inspect `package.json`.
5. Inspect the current application architecture.
6. Inspect the database/schema if one exists.
7. Inspect environment configuration without exposing secrets.
8. Confirm which module is currently authorized to be built.
9. Never invent technical capabilities.
10. Never silently change approved requirements.
11. Never introduce a paid dependency without approval.
12. Never start the next module automatically.

The assistant must work **one module at a time**.

At the end of every completed module, the assistant MUST:

```text
Implement
→ Test
→ Fix
→ Lint
→ Build
→ Security check
→ Update documentation
→ Git commit
→ Push branch
→ Merge
→ Verify
→ STOP
```

The assistant must not continue to another module until explicitly instructed.

---

# 1. PRODUCT VISION

The company currently needs people to repeatedly:

- research social-media-worthy news
- decide which stories matter
- write captions
- adapt content for different platforms
- create static social posts
- schedule posts
- publish posts
- monitor performance
- decide what content strategy should change

This system turns those repetitive activities into an automated AI workflow.

The goal is not simply to create an AI content generator.

The goal is to build an **internal AI social-media department**.

The final system should be capable of:

```text
Find important news
        ↓
Understand and rank it
        ↓
Send shortlist to Slack
        ↓
Human selects stories
        ↓
AI creates platform-specific content
        ↓
Brand identity is applied
        ↓
Static post is generated
        ↓
Human reviews and approves
        ↓
Post is scheduled
        ↓
Post is published
        ↓
Performance is collected
        ↓
AI analyzes performance
        ↓
AI improves future strategy
```

---

# 2. BUSINESS REQUIREMENTS

## 2.1 Internal Company Use

This is an internal tool for one company.

It is NOT a public SaaS in this phase.

Do not implement:

- public signup
- public registration
- client accounts
- customer portals
- subscriptions
- billing
- Stripe
- multi-tenant SaaS
- client onboarding
- agency client management

The architecture should remain clean enough to evolve into SaaS later, but SaaS functionality is out of scope.

---

# 3. CORE DAILY WORKFLOW

Every day at approximately **10:00 AM**, the system should start the news workflow.

```text
10:00 AM
   ↓
News discovery
   ↓
Source normalization
   ↓
Duplicate removal
   ↓
AI relevance analysis
   ↓
AI ranking
   ↓
5–10 shortlisted stories
   ↓
Slack notification
   ↓
Human selects 3
   ↓
AI content generation
   ↓
Platform adaptation
   ↓
Static visual generation
   ↓
Content preview
   ↓
Human approval
   ↓
Scheduling
   ↓
Publishing
```

The exact timezone must be configurable.

Do not hardcode a timezone.

---

# 4. NEWS TOPIC DIRECTION

The system should prioritize stories around:

- Artificial Intelligence
- AI automation
- AI agents
- AI replacing jobs
- companies replacing employees with AI
- AI reducing workforce requirements
- AI automation replacing repetitive work
- major AI business developments
- important AI product launches
- major AI company announcements
- AI transformation of industries
- AI productivity
- AI workplace transformation

Examples of desired story angles:

> "I replaced 500 employees"

> "Company launches a new AI agent"

> "AI automation cuts customer-support jobs"

These are examples of the type of news the system should discover.

They must NOT be hardcoded as fake stories.

---

# 5. NEWS DISCOVERY

The system should support configurable news sources.

Preferred free sources may include:

- RSS feeds
- public news feeds
- official company newsrooms
- reputable technology/AI publications
- legally accessible public sources

The assistant MUST verify current technical availability before implementing a source.

Never invent an RSS feed, endpoint, API, permission or source URL.

---

# 6. NEWS NORMALIZATION

Every discovered article should be normalized into a common structure.

Stored as documents in a `news_items` Firestore collection.

Conceptual document shape:

```text
newsItems/{newsItemId}
  title             string
  summary           string
  sourceName        string
  sourceUrl         string
  publishedAt       timestamp
  retrievedAt       timestamp
  category          string
  imageUrl          string
  relevanceScore    number
  credibilityScore  number
  socialPotentialScore  number
  duplicateGroup    string
  aiAnalysis        map
  status            string
```

Notes on Firestore modelling:

- The document ID replaces the separate `id` field.
- `aiAnalysis` is a nested map rather than a joined table.
- Firestore is schemaless; the shape above is enforced in application code
  through Zod validation (§31), not by the database.
- Fields used for filtering or ordering require composite indexes.
  Indexes must be declared explicitly and reviewed.

Exact collection shape and required indexes must be reviewed before implementation.

---

# 7. NEWS QUALITY FILTER

AI should score candidate stories using factors such as:

```text
Relevance
Recency
Credibility
Business importance
AI relevance
Social-media potential
Novelty
Source quality
```

AI should reject:

- duplicate stories
- very old stories
- low-quality sources
- irrelevant stories
- obvious spam
- unsupported claims

The system must retain source information.

AI must never fabricate a source.

---

# 8. DAILY SHORTLIST

The AI should produce:

**5–10 shortlisted stories**

Each story should show:

```text
Headline
Short summary
Source
Published date
Why it matters
AI relevance score
```

The human chooses **3**.

AI does not automatically choose the final 3.

---

# 9. SLACK WORKFLOW

Slack is the internal notification/approval channel.

Daily:

```text
5–10 News Stories
       ↓
Slack
       ↓
Human selects 3
```

Slack should also receive:

- content ready for review
- publishing status
- publishing failures
- weekly report
- important automation failures

The exact Slack interaction must be implemented according to the actual Slack API capabilities available to the chosen setup.

Do not invent Slack interaction capabilities.

If interactive Slack buttons/actions require configuration, document and implement them correctly.

---

# 10. HUMAN CONTROL

The system is AI-first but human-controlled.

Mandatory rule:

**No social post may be published without human approval.**

Human actions:

```text
Select news
Review generated content
Edit content
Regenerate content
Approve
Reject
Schedule
```

AI actions:

```text
Research
Rank
Generate
Adapt
Design
Analyze
Recommend
Optimize strategy
```

---

# 11. BRAND INTELLIGENCE

The system must have one central Brand Intelligence profile.

It should contain:

```text
Company name
Logo
Brand colours
Typography
Visual style
Tone of voice
Writing style
Target audience
Brand positioning
Preferred topics
Topics to avoid
CTA style
Hashtag rules
Content rules
Visual rules
```

All generated content must use this profile.

The brand identity must not be duplicated separately for every platform.

Platform-specific content should inherit the central brand identity.

---

# 12. AI CONTENT GENERATION

After the human selects 3 stories:

```text
Selected Story
     ↓
Load Brand Identity
     ↓
AI Analysis
     ↓
Generate Core Message
     ↓
Generate Platform Versions
     ↓
Generate Static Visual Concept
     ↓
Validate
     ↓
Preview
```

The AI should generate:

- headline
- body/copy
- caption
- CTA where appropriate
- hashtags where appropriate
- source reference
- key takeaway
- static visual concept

---

# 13. PLATFORM ADAPTATION

Initial platforms:

1. Facebook
2. Instagram
3. LinkedIn

X/Twitter was removed from scope. X discontinued its free API tier for new
developers on 2026-02-06; publishing and reading are both paid. Under the
zero-paid-tier constraint (§29) no X integration is possible. See the
Module -1 Platform Access Spike report.

The system must not simply duplicate the same content everywhere.

AI should adapt:

```text
Length
Tone
Structure
Hook
CTA
Hashtags
Formatting
Visual treatment
```

Example:

### LinkedIn

Professional and insight-driven.

### Instagram

Shorter, visually driven and engaging.

### Facebook

Conversational and accessible.

These are defaults, not hardcoded restrictions.

AI can select a suitable format based on the story and strategy.

---

# 14. STATIC CONTENT ONLY

The MVP is strictly static.

Do NOT build:

- AI video generation
- reels
- video editing
- video rendering
- video-generation APIs
- video-processing pipelines

Static assets may include:

- branded news cards
- quote-style graphics
- statistic cards
- headline cards
- educational cards
- carousel-style static images if technically practical

## Image sourcing rule

Generated posts must use **only** brand templates and Cloudinary-hosted
branded assets owned by the company.

A news article's own image must **never** be pulled into a generated post.
Static cards are headline, text and branding only, rendered from our own
templates.

The `imageUrl` field captured during news normalization (§6) exists for
reference and attribution in the internal UI only. It must never be passed
into the static post generator or published.

This is a legal requirement, not a stylistic preference. Republishing a
publisher's image without a licence risks takedown and account termination
on the company's own social accounts. It must be enforced as a validation
rule in code, not merely documented.

---

# 15. STATIC POST GENERATION

Implementation: **SVG-based rendering via Satori (JSX/HTML + CSS → SVG),
then resvg to rasterize SVG → PNG.**

Headless Chromium (Puppeteer/Playwright rendering) must not be used for
image generation. It is heavy, and unnecessary for static text-and-branding
cards.

Constraint to design to: Satori supports only a subset of CSS. Templates
must be built within that subset from the start rather than designed freely
and retrofitted. Fonts must be supplied explicitly as font data; there is
no system font fallback.

Concept:

```text
AI Content
    ↓
Template Selection
    ↓
Brand Colours
    ↓
Typography
    ↓
Logo
    ↓
Image / Source Asset
    ↓
Static Image
    ↓
Upload to Cloudinary
    ↓
Public media URL stored in Firestore
```

The generated image must end up at a publicly reachable URL, because
Instagram's publishing API fetches media by URL rather than accepting a
direct upload. Cloudinary provides that URL.

Uploads must be performed **server-side** using signed authentication.
Unsigned client-side uploads must not be used, as they would require
exposing upload credentials to the browser.

Do not make a paid image-generation service mandatory.

If AI-generated imagery is desired later, it should be a separately approved capability.

---

# 16. CONTENT PREVIEW

Every generated post must have a preview.

Preview should show:

```text
Platform
Image
Caption
Copy
Hashtags
CTA
Source
Scheduled time
Status
```

Actions:

```text
Edit
Regenerate
Reject
Approve
```

---

# 17. CONTENT STATUS

Use explicit states.

```text
DRAFT
IN_REVIEW
APPROVED
SCHEDULED
PUBLISHED
FAILED
REJECTED
```

Allowed transitions must be enforced.

Example:

```text
DRAFT → IN_REVIEW
IN_REVIEW → APPROVED
IN_REVIEW → REJECTED
APPROVED → SCHEDULED
SCHEDULED → PUBLISHED
SCHEDULED → FAILED
```

Status is owned **per platform**, not per story.

Each platform version of a story carries its own independent status. One
story's LinkedIn version may be APPROVED and PUBLISHED while its Instagram
version is still IN_REVIEW or REJECTED. A weak version for one platform
must never block the others.

Consequently the status field lives on the **platform post document**, not
on the parent content item. The parent content item holds the shared story
context and generated core message; it does not hold a single status that
represents all platforms.

Any aggregate status shown for a story in the UI is derived for display
only. It is never stored, and never the value that authorizes publishing.

Approval is recorded per platform post. An "approve all" action is a
convenience that applies the same per-platform approval to each eligible
platform post individually; it is not a separate story-level state.

Do not allow frontend-only status protection.

Enforce important transitions server-side. Firestore Security Rules must
not permit any client to write the status field on a platform post
document (§33).

---

# 18. SCHEDULING

Approved content can be scheduled.

Store:

```text
date
time
timezone
platform
contentId
status
```

Recommended timestamp strategy:

```text
Store UTC
Display configured company timezone
```

The scheduler must prevent publishing unapproved content.

---

# 19. SOCIAL MEDIA INTEGRATIONS

Required initial integrations:

```text
Facebook
Instagram
LinkedIn
```

Use official APIs and official authentication.

The assistant must verify:

- current API availability
- publishing permissions
- required OAuth scopes
- account requirements
- app requirements
- rate limits
- analytics availability

Never invent any of these.

If a capability is unavailable or requires additional approval, document it.

## Token storage and lifecycle

OAuth tokens must **never** be stored in plaintext.

Storage:

- Tokens are encrypted server-side with Node's `crypto` module using
  symmetric encryption before being written to Firestore.
- The encryption key is supplied through a server-only environment
  variable. It is never committed, never sent to the client, never given
  to n8n.
- Use an authenticated encryption mode, so tampering is detectable rather
  than silently decrypting to corrupt output.
- Encryption and decryption happen only in server-side code holding Admin
  SDK privileges. Firestore Security Rules must deny all client access to
  the social account collection outright (§33) — encryption is a second
  layer, not a substitute for rules.

Per token, store:

```text
platform
encrypted access token
encrypted refresh token   (where the platform issues one)
expiresAt                 timestamp
lastRefreshedAt           timestamp
status                    VALID | EXPIRING | EXPIRED | REVOKED
```

Lifecycle:

- **Facebook / Instagram** — refresh automatically where the platform
  supports it, before expiry.
- **LinkedIn** — no refresh token is issued on the self-serve tier and
  access tokens expire after 60 days. Automatic refresh is impossible.
  Track `expiresAt` and send a Slack alert **5–7 days before expiry** so a
  human can re-authorize in time.
- An expired token must cause publishing to fail loudly and set the post
  to FAILED with a clear reason (§52). It must never fail silently, and it
  must never be reported as a successful publish (§67).
- The Social Accounts screen (§42) must surface expiry state.

Never log a token, encrypted or decrypted (§55).

---

# 20. SOCIAL PROVIDER ARCHITECTURE

Use provider adapters.

Concept:

```text
PublishingService
       ↓
ProviderAdapter
       ├── Facebook
       ├── Instagram
       └── LinkedIn
```

The adapter interface (Module 16) must be designed and stubbed before any
individual provider adapter is built, so every adapter is written to one
common contract rather than refactored into it afterwards.

The rest of the application should not depend directly on platform-specific API code.

---

# 21. MOCK MODE

Development must support mock mode.

Example:

```env
MOCK_MODE=true
```

Mock mode may simulate:

- news
- AI responses
- Slack
- publishing
- analytics

Mock results must be clearly labelled.

The UI must never falsely say:

> Published to Instagram

when the system only simulated publishing.

Use a clear distinction between:

```text
REAL
MOCK
UNAVAILABLE
```

---

# 22. ANALYTICS

Collect real metrics only where officially available.

Potential metrics:

```text
Reach
Impressions
Likes
Comments
Shares
Clicks
Engagement
Engagement rate
```

Not every platform will provide every metric.

If unavailable:

```text
Unavailable
```

Never create fake numbers.

---

# 23. WEEKLY PERFORMANCE ANALYSIS

At the end of every week:

```text
Collect available analytics
        ↓
Normalize data
        ↓
Compare posts
        ↓
Compare platforms
        ↓
Compare topics
        ↓
Compare formats
        ↓
AI analysis
        ↓
Recommendations
        ↓
Next week's strategy
```

The report should identify:

- best posts
- weakest posts
- best topics
- weak topics
- best platform
- weakest platform
- best content format
- engagement patterns
- recommended changes

---

# 24. AI STRATEGY OPTIMIZATION

The AI can automatically improve the following week's strategy.

It can recommend or modify:

```text
Topic weighting
Platform weighting
Posting frequency
Content mix
Headline style
CTA style
Static format distribution
Educational/promotional balance
Recommended timing
```

But:

**AI strategy optimization does not give AI permission to publish without approval.**

The strategy can change automatically.

Posts still require human approval.

---

# 25. AI STRATEGY EVIDENCE

Every major strategy recommendation should have an explanation.

Example:

```text
Recommendation:
Increase educational AI posts.

Reason:
Educational posts generated higher average engagement
than promotional posts during the previous 4 weeks.
```

The AI must use actual stored analytics.

No fabricated reasoning.

---

# 26. INTERNAL AUTHENTICATION

Recommended:

```text
Firebase Authentication
```

Requirements, mapped to verified Firebase Authentication capabilities:

- secure login — Email/Password provider
- logout
- session management — Firebase Auth session cookies, created via the
  Admin SDK in a server environment, with a configurable expiry
  (supported range: 5 minutes to 2 weeks)
- protected routes — server-side verification of the session cookie
- password recovery where appropriate — Firebase Auth password reset email

No public registration.

Firebase Authentication permits account creation by default. Because this
system must not allow public signup (§2), accounts are provisioned only by
an administrator through the Firebase Admin SDK in a trusted server
environment. No client-facing signup route may be exposed.

---

# 27. ROLES

Initial roles:

```text
ADMIN
MANAGER
SOCIAL_MANAGER
```

Permissions must be explicitly defined.

Example:

### ADMIN

Can manage:

- users
- brand
- integrations
- automations
- content
- analytics
- strategy
- settings

### MANAGER

Can:

- review content
- approve content
- view analytics
- view strategy
- manage workflows where permitted

### SOCIAL_MANAGER

Can:

- review content
- edit content
- regenerate
- approve where permitted
- schedule where permitted

Authorization must be enforced server-side/database-side.

---

# 28. RECOMMENDED TECH STACK

## Frontend

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
Lucide
```

## Backend

```text
Next.js Route Handlers
Server Actions where appropriate
TypeScript
Zod
```

## Database

```text
Cloud Firestore (Native mode)
```

## Authentication

```text
Firebase Authentication
```

## Storage

```text
Cloudinary (free plan)
```

Cloud Storage for Firebase is **not** used. Since 2026-02-03 it requires the
pay-as-you-go Blaze plan and a linked Cloud Billing account; Spark-plan
projects receive 402/403 on all bucket access. A credit card must not be
linked to this project under any circumstances, so Firebase Storage is
excluded entirely.

Cloudinary registration requires no credit card and no financial details.

Cloudinary's free plan is **credit-based, not a fixed storage quota.** The
plan provides 25 credits. One credit equals approximately 1 GB of managed
storage, or 1 GB of viewing bandwidth, or 1,000 transformations. All three
draw from the **same shared pool** — 25 GB of storage and 25 GB of bandwidth
are not available simultaneously.

Design consequences:

- Store generated images at final render size. Avoid on-the-fly
  transformations, which consume the same credits as storage.
- Bandwidth is consumed whenever a platform fetches a media URL.
- Monitor credit consumption as an operational metric.

Firestore and Firebase Authentication remain on the free Spark plan.

The project must not use Cloud Functions for Firebase, which would also
require Blaze. All scheduled and background orchestration belongs to n8n
(§44), which triggers signed HTTP webhooks on the application.

## Automation

```text
n8n
```

Prefer self-hosted n8n for the MVP to avoid mandatory hosted-plan costs.

## Charts

```text
Recharts
```

## Version Control

```text
Git
GitHub
```

## Deployment

```text
Vercel Hobby/free tier where suitable
```

---

# 29. FREE-TIER-FIRST POLICY

The MVP must be built using free/open-source/free-tier tooling wherever technically possible.

No paid service may be introduced silently.

If a required capability is paid:

```text
STOP
↓
Explain why
↓
Identify free/mock alternative
↓
Ask for approval
```

Do not claim that an API is free without verification.

Free-tier limits can change.

The assistant must verify current requirements when implementation reaches that integration.

---

# 30. AI PROVIDER ABSTRACTION

Do not tightly couple the application to one AI provider.

Use:

```text
AIService
    ↓
ProviderAdapter
    ↓
Model
```

Logical functions:

```text
discoverNews()
rankNews()
summarizeNews()
generateContent()
adaptContent()
generateVisualPlan()
analyzePerformance()
generateStrategy()
```

Provider choice must consider:

- actual availability
- current free tier
- quality
- rate limits
- structured output support
- technical compatibility

Never hardcode provider-specific assumptions into the business layer.

---

# 31. AI OUTPUT VALIDATION

AI output must be structured and validated.

Pattern:

```text
AI
 ↓
Structured Output
 ↓
Zod Validation
 ↓
Business Rules
 ↓
Database
```

Invalid output must not enter production workflows blindly.

---

# 32. DATABASE

Logical entities may include:

```text
profiles
company_settings
brand_settings
news_sources
news_items
selected_news
content_items
content_versions
platform_posts
approval_records
scheduled_posts
social_accounts
analytics
strategy_reports
automation_runs
automation_logs
notifications
```

These are Firestore collections, not SQL tables.

Do not blindly create every collection.

## Content and platform post layout

Because approval is per platform (§17), the split between `content_items`
and `platform_posts` is a fixed design requirement, not an open choice.

```text
contentItems/{contentItemId}
  sourceNewsItemId   string
  coreMessage        map
  createdAt          timestamp
  (no status field — status is per platform)

platformPosts/{platformPostId}
  contentItemId      string
  platform           string      FACEBOOK | INSTAGRAM | LINKEDIN
  status             string      per-platform state from §17
  caption            string
  hashtags           array
  cta                string
  mediaUrl           string      Cloudinary public URL
  mediaPublicId      string      Cloudinary public ID
  scheduledAt        timestamp   UTC
  approvedBy         string
  approvedAt         timestamp
  platformPostId     string      returned by the platform after publishing
  lastError          string
```

Notes:

- `platformPosts` is a top-level collection, not a subcollection, so the
  review queue can query across all stories by status without a collection
  group query.
- `status`, `approvedBy` and `approvedAt` live here and only here.
- A composite index on `(status, scheduledAt)` will be required for the
  review queue and the scheduler.
- The publishing engine reads authorization from this document alone.
  It must never infer approval from the parent content item.

Firestore has no migrations in the SQL sense. Collections and documents are
created on first write, and the database enforces no schema. This shifts
responsibility onto design and validation rather than DDL.

Before implementation:

1. inspect existing collections
2. identify required entities
3. define document shapes
4. decide subcollection vs. top-level collection for each relationship
5. decide where denormalization is required, since Firestore has no joins
6. define composite indexes for every query that filters or orders
7. define Firestore Security Rules
8. define application-level validation (Zod) to compensate for the absence
   of database constraints
9. review
10. implement

---

# 33. FIRESTORE SECURITY RULES

Firestore Security Rules are mandatory.

Important data must not be accessible merely because someone knows a
document path or ID.

Rules are scoped to the internal-only, single-company access model in §2:

- There is no public or anonymous read or write access to any collection.
- Every rule requires an authenticated request (`request.auth != null`).
- Role checks read the role from a Firebase Auth **custom claim**
  (`request.auth.token.role`), set only from a trusted server environment
  via the Admin SDK. Roles are those defined in §27.
- Rules must be default-deny. Access is granted per collection explicitly,
  never by a broad wildcard match.
- Collections that only server-side code touches — publishing state,
  analytics, automation logs, audit logs — should deny all client access
  outright and be written exclusively through the Admin SDK.
- Status transitions (§17) must not be enforceable from the client.
  Rules must not permit a client to write `status` on content documents.

Server-side access checks are also required. Security Rules govern client
SDK access only; they do **not** apply to the Firebase Admin SDK, which
bypasses them entirely. Any path that uses the Admin SDK must perform its
own authorization check.

Rules must be covered by tests using the Firebase emulator.

---

# 34. FRONTEND INFORMATION ARCHITECTURE

Recommended navigation:

```text
Dashboard
News
Content
Calendar
Analytics
Strategy
Automation
Social Accounts
Brand
Settings
```

---

# 35. DASHBOARD

Dashboard should show:

```text
Today's news
Selected stories
Content awaiting approval
Scheduled posts
Published posts
Weekly performance
Automation health
Recent activity
```

It should feel like a real internal operations control center.

---

# 36. NEWS SCREEN

Include:

- news list
- source
- publication date
- category
- relevance
- selection state
- search
- filters
- article detail

Human must be able to select exactly the required daily stories.

---

# 37. CONTENT SCREEN

Include:

```text
Drafts
Review Queue
Approved
Scheduled
Published
Failed
Rejected
```

Actions:

```text
View
Edit
Regenerate
Approve
Reject
Schedule
```

---

# 38. CALENDAR

Support:

```text
Month
Week
Day
```

Each post should show:

```text
Platform
Preview
Status
Scheduled time
```

---

# 39. ANALYTICS SCREEN

Show:

```text
Overall performance
Platform comparison
Top posts
Weak posts
Topic performance
Engagement trends
```

Filters:

```text
Date
Platform
Topic
Post
```

---

# 40. STRATEGY SCREEN

Show:

```text
What worked
What did not work
Best topics
Weak topics
Best platforms
Best formats
AI recommendations
Next week's strategy
```

---

# 41. AUTOMATION CONTROL CENTER

Show every major automation:

```text
Daily News Discovery
Slack Notification
Content Generation
Scheduling
Publishing
Analytics
Weekly Analysis
Strategy Optimization
```

For each:

```text
ON/OFF
Last run
Next run
Status
Last error
```

---

# 42. SOCIAL ACCOUNTS SCREEN

Display:

```text
Facebook       Connected / Not Connected
Instagram      Connected / Not Connected
LinkedIn       Connected / Not Connected
```

LinkedIn access tokens expire after 60 days and cannot be refreshed
programmatically on the self-serve tier. This screen must therefore show
the token expiry date, not merely Connected / Not Connected, and the system
must alert to Slack before expiry.

Never expose access tokens.

---

# 43. BRAND SCREEN

Authorized users can manage:

```text
Company
Logo
Colours
Typography
Tone
Audience
Visual style
Topics
Forbidden topics
CTA rules
Hashtag rules
Content rules
```

Changes should be audited.

---

# 44. AUTOMATION ARCHITECTURE

Use n8n for scheduled/background orchestration.

Recommended workflows:

```text
01_daily_news_discovery
02_news_ranking
03_slack_news_notification
04_news_selection_processing
05_content_generation
06_content_review_notification
07_scheduled_publishing
08_analytics_sync
09_weekly_performance_analysis
10_strategy_optimization
11_error_notification
```

Keep workflows modular.

---

# 45. DAILY NEWS N8N WORKFLOW

```text
Schedule Trigger
       ↓
Fetch Sources
       ↓
Normalize
       ↓
Deduplicate
       ↓
AI Rank
       ↓
Select 5–10
       ↓
Database
       ↓
Slack
```

Every run should be logged.

---

# 46. NEWS SELECTION WORKFLOW

```text
Human selects 3
       ↓
Validate selection
       ↓
Load selected news
       ↓
Load brand identity
       ↓
Trigger content generation
```

The system should reject invalid selection states.

---

# 47. CONTENT GENERATION WORKFLOW

```text
Selected News
       ↓
Brand Intelligence
       ↓
AI Core Content
       ↓
Platform Adaptation
       ↓
Static Visual Generation
       ↓
Validation
       ↓
Database
       ↓
IN_REVIEW
       ↓
Human Notification
```

---

# 48. APPROVAL WORKFLOW

```text
IN_REVIEW
    ↓
Human Preview
    ↓
Edit / Regenerate
    ↓
Approve
    ↓
APPROVED
```

Rejected:

```text
IN_REVIEW → REJECTED
```

Approved content can proceed to scheduling.

---

# 49. PUBLISHING WORKFLOW

```text
Approved
   ↓
Scheduler
   ↓
Verify approval
   ↓
Verify social account
   ↓
Publish
   ↓
Verify response
   ↓
Store platform post ID
   ↓
PUBLISHED
```

Failure:

```text
FAILED
↓
Log
↓
Retry when safe
↓
Notify
```

---

# 50. ANALYTICS WORKFLOW

```text
Scheduled analytics sync
        ↓
Fetch available platform data
        ↓
Normalize
        ↓
Store
        ↓
Update dashboards
```

---

# 51. WEEKLY WORKFLOW

```text
Weekly Trigger
      ↓
Analytics
      ↓
Performance Analysis
      ↓
AI Strategy
      ↓
Save Report
      ↓
Notify Team
```

---

# 52. ERROR HANDLING

Handle:

```text
News source failure
AI failure
Invalid AI output
Slack failure
OAuth failure
Token expiry
Social API failure
Rate limiting
Database failure
Scheduler failure
Network failure
```

General pattern:

```text
Detect
↓
Log
↓
Retry when safe
↓
Notify
↓
Correct status
```

Never silently fail.

---

# 53. IDEMPOTENCY

Publishing must be idempotent.

Before publishing:

```text
Check approval
Check scheduled state
Check previous attempt
Check platform post ID
```

A retry must not accidentally create duplicate posts.

---

# 54. TIMEZONE

Store timestamps consistently, preferably UTC.

Display according to the company's configured timezone.

The application must not silently use browser-local time as the source of truth.

---

# 55. AUDIT LOGS

Record important actions:

```text
LOGIN
NEWS_IMPORTED
NEWS_SELECTED
CONTENT_GENERATED
CONTENT_EDITED
CONTENT_APPROVED
CONTENT_REJECTED
POST_SCHEDULED
POST_PUBLISHED
POST_FAILED
ANALYTICS_SYNCED
STRATEGY_GENERATED
SETTINGS_CHANGED
```

Store:

```text
actor
action
resource
timestamp
status
metadata
```

Never store secrets in logs.

---

# 56. SECURITY

Mandatory:

- authentication
- authorization
- Firestore Security Rules
- server-side checks
- protected routes
- input validation
- webhook verification
- OAuth token protection
- secure environment variables
- no secrets in client code
- no secrets in Git

Never expose:

```text
API keys
OAuth secrets
Access tokens
Webhook secrets
Firebase Admin SDK service account credentials
Cloudinary API key and API secret
```

The Firebase Admin SDK bypasses Firestore Security Rules completely. Its
service account credentials are the highest-privilege secret in the system
and must never reach the browser, the client bundle, Git, or n8n.

The Cloudinary API secret carries the same tier of sensitivity. It must be
server-only, must never appear in client code or Git, and must never be
given to n8n. All Cloudinary uploads are signed server-side.

n8n must never hold or use Firebase Admin SDK credentials or Cloudinary
credentials. n8n triggers signed HTTP webhooks on the application; the
application alone holds privileged database and media access and makes
every publish and schedule decision.

---

# 57. ENVIRONMENT VARIABLES

Maintain:

```text
.env.example
```

Only create variables that are actually required.

Possible categories:

```text
Firebase (client config)
Firebase Admin (server-only service account credentials)
Cloudinary (server-only: cloud name, API key, API secret)
AI
Slack
Social APIs
n8n
Application URL
```

Firebase client configuration values are not secret and may appear in the
client bundle. Firebase Admin service account credentials and Cloudinary
API credentials are secret and must be server-only. These two groups must
never be mixed.

Do not invent final variables before implementation.

---

# 58. TESTING

Every module requires appropriate tests.

Stack:

```text
Vitest                  unit and integration tests
Playwright              end-to-end tests
Firebase Emulator Suite Firestore Security Rules tests
```

Use:

```text
Unit tests
Integration tests
API tests
Validation tests
Permission tests
Workflow tests
```

Security Rules must be tested against the Firebase Emulator Suite, not
against the live project. Rules tests must cover both allow and deny cases:
a test proving an unauthorized role is denied is as important as one
proving an authorized role is permitted.

Tests must never call live social platform APIs. Provider adapters are
exercised through mock mode (§21).

Critical workflows should receive end-to-end testing where practical.

---

# 59. QUALITY GATE

A module is not complete until:

```text
Requirements verified
Frontend complete
Backend complete
Database complete
Validation complete
Loading states complete
Empty states complete
Error states complete
Security reviewed
Tests pass
Lint passes
Build passes
Documentation updated
```

---

# 60. GIT WORKFLOW

Never work directly on `main`.

Recommended:

```text
main
develop
feature/module-00-foundation
feature/module-01-auth
feature/module-02-brand
...
```

For every module:

```text
Create branch
↓
Implement
↓
Test
↓
Lint
↓
Build
↓
Security review
↓
Update docs
↓
Commit
↓
Push branch
↓
Merge into develop
↓
Verify
↓
STOP
```

When the project is release-ready:

```text
develop
↓
Final QA
↓
main
```

---

# 61. AUTOMATIC GIT REQUIREMENT

After each successfully completed module, the assistant must perform the Git workflow before reporting the module complete.

Required sequence:

```text
git status
git diff
tests
lint
build
security check
git add
git commit
git push
merge
verify
```

The assistant must not claim that it pushed or merged unless the command actually succeeded.

If GitHub authentication or remote configuration prevents pushing:

```text
STOP
Explain the exact issue
Do not falsely claim success
```

---

# 62. COMMIT CONVENTION

Use Conventional Commits.

Examples:

```text
feat: initialize project foundation
feat: implement internal authentication
feat: add brand intelligence
feat: implement news discovery
feat: add AI news ranking
feat: add Slack shortlist workflow
feat: implement content generation
feat: add static post generator
feat: implement approval workflow
feat: add social scheduling
feat: integrate Facebook publishing
feat: integrate Instagram publishing
feat: integrate LinkedIn publishing
feat: implement analytics
feat: add weekly strategy analysis
feat: add automation control center
fix: resolve scheduling timezone issue
fix: prevent duplicate publishing
test: add news ranking coverage
docs: update master specification
```

---

# 63. MODULE ROADMAP

Build strictly in this order.

## Module 00 — Foundation

Set up:

- repository structure
- Next.js
- TypeScript
- Tailwind
- shadcn/ui
- linting
- formatting
- environment handling
- base layout
- Firebase project setup (Spark plan — no billing account linked)
- Firestore initialization
- Firebase Authentication initialization
- Cloudinary account and server-side SDK configuration
- Firebase client SDK and Admin SDK separation
- Firebase emulator suite for local development and tests
- basic logging
- testing foundation
- Git conventions

---

## Module 01 — Authentication & Access Control

Build:

- Firebase Authentication (Email/Password provider)
- login
- logout
- protected routes
- session handling via Firebase Auth session cookies
- admin-only user provisioning via the Admin SDK (no public signup)
- roles as Firebase Auth custom claims
- authorization enforced server-side
- initial Firestore Security Rules (default-deny)

---

## Module 02 — Company & Brand Intelligence

Build:

- company profile
- brand settings
- logo storage
- colours
- typography
- tone
- audience
- content rules
- topic rules
- brand UI
- brand validation

---

## Module 03 — News Source Management

Build:

- source database
- source management UI
- source activation
- source priority
- source health
- RSS/public source ingestion foundation
- normalization

---

## Module 04 — AI News Research & Ranking

Build:

- AI service abstraction
- news analysis
- relevance scoring
- credibility handling
- duplicate detection
- shortlist generation
- structured AI output
- validation

---

## Module 05 — Slack News Notification

Build:

- Slack integration
- daily shortlist notification
- selected-story workflow according to verified Slack capabilities
- error handling
- notification logs

---

## Module 06 — Human News Selection

Build:

- selection UI
- select exactly 3
- validation
- selected-news state
- trigger content workflow

---

## Module 07 — AI Content Generation

Build:

- core content generation
- platform adaptation
- brand context
- structured outputs
- validation
- versioning
- regeneration

---

## Module 08 — Static Post Generator

Build:

- template system (Satori-compatible CSS subset only)
- brand rendering
- logo
- typography (explicit font data — no system font fallback)
- colours
- static image generation via Satori → resvg → PNG
- enforcement of the §14 image sourcing rule: brand templates and
  company-owned Cloudinary assets only, never an article's own image
- server-side signed upload to Cloudinary
- storage of the returned public media URL (and Cloudinary public ID, so
  assets can later be deleted or replaced) on the platform post document
- credit-consumption awareness: render at final size, avoid unnecessary
  transformations
- upload failure handling — a failed upload must not leave a platform post
  in a state that claims a usable image exists

---

## Module 09 — Content Preview & Approval

Build:

- review queue
- previews
- edit
- regenerate
- per-platform approve
- "approve all" convenience action, applied per platform post
- per-platform reject
- per-platform status transitions, enforced server-side
- derived story-level status for display only, never stored

---

## Module 10 — Social Media Calendar

Build:

- calendar
- scheduled content
- platform views
- filtering
- status indicators

---

## Module 11 — Scheduling Engine

Build:

- schedule management
- timezone handling
- scheduling validation
- duplicate protection
- scheduler integration

---

## Module 12 — Facebook Integration

Implement real official integration if technically available.

Otherwise:

```text
Mock
Document limitation
Do not fake production capability
```

---

## Module 13 — Instagram Integration

Same rule.

---

## Module 14 — LinkedIn Integration

Same rule.

---

## Module 15 — RETIRED (was X/Twitter Integration)

Removed from scope. X has no free API tier for new developers as of
2026-02-06; both publishing and reading are paid, which §29 prohibits.

This module number is retired rather than reused, so that existing
references to Module 16 and later remain correct. Do not build anything
under Module 15.

---

## Module 16 — Publishing Engine

Build provider-agnostic publishing orchestration.

The adapter interface defined here must be designed and stubbed **before**
Modules 12–14 are implemented, so each provider adapter is built to this
contract from the start.

Responsibilities:

- approval verification
- provider selection
- publishing
- response handling
- post IDs
- retry safety
- failure handling

---

## Module 17 — Analytics Collection

Build:

- provider analytics adapters
- normalization
- analytics storage
- dashboard data
- unavailable metric handling

---

## Module 18 — Weekly Performance Analysis

Build:

- weekly reporting
- performance comparison
- best/worst content
- topic analysis
- platform analysis
- format analysis

---

## Module 19 — AI Strategy Optimization

Build:

- evidence-based analysis
- strategy recommendations
- strategy versioning
- next-week strategy
- automated strategy update

Do not allow this module to bypass approval.

---

## Module 20 — Automation Control Center

Build:

- workflow status
- run history
- last successful run
- next run
- errors
- enable/disable controls

---

## Module 21 — Audit Logs & Error Recovery

Build:

- audit logs
- automation logs
- retry handling
- failure recovery
- Slack alerts
- operational visibility

---

## Module 22 — Security & Production Hardening

Perform:

- Firestore Security Rules review (default-deny verified, emulator-tested)
- Admin SDK credential handling review
- authorization review
- secrets review
- API security
- webhook verification
- dependency review
- error exposure review
- logging review
- production configuration review

---

## Module 23 — Final QA & Deployment

Perform:

- full integration testing
- production build
- workflow testing
- security audit
- performance review
- documentation
- deployment
- final smoke test

---

# 64. MODULE EXECUTION PROTOCOL

When the user says:

> Start Module X

the assistant must:

### Step 1 — Read

Read the master specification and current repository.

### Step 2 — Inspect

Inspect:

```text
package.json
src/app structure
components
lib
database
docs
environment configuration
existing tests
```

### Step 3 — Plan

Provide a concise implementation plan before changing files.

### Step 4 — Implement

Only implement the requested module.

### Step 5 — Test

Run relevant tests.

### Step 6 — Validate

Run:

```text
lint
build
type checking
```

where applicable.

### Step 7 — Security

Review:

- authentication
- authorization
- secrets
- inputs
- database access

as relevant to the module.

### Step 8 — Documentation

Update relevant documentation.

### Step 9 — Git

Create/verify the module branch.

Commit the work.

Push it.

Merge it into `develop`.

Verify the merge.

### Step 10 — STOP

Do not start the next module.

---

# 65. ANTI-HALLUCINATION POLICY

The assistant must never invent:

- APIs
- endpoints
- permissions
- OAuth scopes
- SDK methods
- database columns
- environment variables
- free-tier limits
- pricing
- platform capabilities
- analytics metrics
- source URLs
- news
- test results
- deployment results
- Git push results

If uncertain:

```text
STOP
↓
Explain what is unknown
↓
Ask for clarification or verify through an authoritative source
```

---

# 66. REAL / MOCK / UNAVAILABLE / FUTURE

Every integration or capability should clearly belong to one of these states:

### REAL

Actually connected and tested.

### MOCK

Simulated for development.

### UNAVAILABLE

The required capability cannot currently be implemented under the available API/access/free-tier constraints.

### FUTURE

Intentionally excluded from the current MVP.

The UI and documentation must not confuse these states.

---

# 67. NO FAKE SUCCESS

Never say:

```text
Published successfully
```

unless the real platform confirms publication.

Never say:

```text
Analytics collected
```

if the values are mocked.

Never say:

```text
Slack notification sent
```

unless the integration confirms it.

Never claim a Git push or merge succeeded unless the command succeeded.

---

# 68. FUTURE EXTENSIONS

These are intentionally outside the current MVP:

```text
Public SaaS
Multi-tenancy
Client workspaces
Client portals
Subscriptions
Billing
White-labeling
Video generation
AI reels
Comments automation
DM automation
Customer support automation
Advanced social listening
```

The current architecture should avoid making these future options impossible, but they must not be built now.

---

# 69. FINAL PRODUCT EXPERIENCE

The finished internal application should feel like:

```text
AI Social Media Command Center
```

A company employee should be able to open the dashboard and immediately understand:

```text
What news was found?
What needs my approval?
What is scheduled?
What has been published?
How are we performing?
What is AI recommending next?
Are all automations healthy?
```

The application should look and behave like a serious internal enterprise product, not a basic CRUD portfolio project.

---

# 70. FINAL END-TO-END ACCEPTANCE TEST

The complete MVP must successfully demonstrate:

```text
10:00 AM
    ↓
Relevant AI news discovered
    ↓
News normalized
    ↓
Duplicates removed
    ↓
AI ranks stories
    ↓
5–10 shortlisted
    ↓
Slack notification
    ↓
Human selects 3
    ↓
AI generates content
    ↓
AI adapts content for FB/IG/LinkedIn
    ↓
Brand identity applied
    ↓
Static post generated
    ↓
Human preview
    ↓
Human edits if required
    ↓
Human approves
    ↓
Post scheduled
    ↓
Official platform API publishes
    ↓
Publishing result stored
    ↓
Analytics collected where available
    ↓
Weekly report generated
    ↓
AI identifies winning/weak content
    ↓
Next week's strategy updated
    ↓
Human approval remains mandatory
```

---

# 71. FINAL RULE

This project should be built as a **real, maintainable internal automation platform**.

Do not optimize for the number of features.

Optimize for:

```text
Reliability
Security
Correctness
Automation
Observability
Maintainability
Real API integrations
Human control
Brand consistency
Evidence-based AI decisions
```

The assistant must always prefer:

```text
Working + verified
```

over:

```text
More features + unverified assumptions
```

This document is the project's **Single Source of Truth**.

Any change to this specification requires explicit owner approval.

**End of Master Specification.**
