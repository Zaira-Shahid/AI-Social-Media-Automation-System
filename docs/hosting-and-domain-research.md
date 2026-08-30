# Public URL Options — Research Report

**Date of verification:** 2026-08-30
**Question:** How does this project get a stable public HTTPS URL, for free, with terms that permit internal company (commercial) use?
**Blocks:** Modules 05 (Slack interactivity) and 12–14 (OAuth redirects). Does **not** block Module 00.
**Confidence tags:** as per the Module -1 report — VERIFIED-PRIMARY / VERIFIED-SECONDARY / UNVERIFIED.

---

## 0. An important distinction up front

Vercel is **unusual** in stating an explicit non-commercial restriction. Most providers simply do not address commercial use in their free-tier documentation at all.

That means for the alternatives below, the honest finding is usually **"no restriction found"**, which is *weaker evidence* than **"commercial use explicitly permitted."** Per §65 I am not going to upgrade the former into the latter. Where I could not read the actual terms, I say so.

---

## 1. Question 1 — free domain with nameserver delegation to Cloudflare

### Freenom (.tk / .ml / .ga / .cf) — UNAVAILABLE

Dead, definitively. Freenom paused all free registrations in 2023 after Meta's cybersquatting suit, ICANN terminated its registrar accreditation in November 2023, and it formally exited the domain business on 2024-02-12. By March 2024 roughly 12.6 million of its domains were no longer resolving. New registration is closed in 2026. [VERIFIED-SECONDARY, multiple consistent sources]

**Do not pursue.** Any tutorial recommending Freenom is stale.

### EU.org — available, but its own policy discourages this use case

Technically it does what was asked: free, permanent, and it supports delegating to Cloudflare's nameservers (requires at least two nameservers on application). Well-documented integration path with Cloudflare. [VERIFIED-SECONDARY]

**But the eligibility terms are the problem.** EU.org's own general policy states the service targets non-profit organizations and individuals, and that while **small commercial sites are permitted, they are "VERY STRONGLY" asked to do so only as a very last resort**, with commercial entities encouraged to use ICANN-accredited registrars instead. [VERIFIED-PRIMARY, from nic.eu.org policy]

Assessment for this project:

- This is a company internal tool (§2). That is exactly the category EU.org asks to go elsewhere.
- It is *permitted*, not prohibited — so this is a softer conflict than Vercel Hobby's outright restriction.
- Practical risks: registration is manually reviewed by volunteers and approval can take days to weeks; the domain is a favour, not a contract, and there is no service guarantee for a system that OAuth callbacks depend on.

**Verdict: technically available, but not recommended as the foundation for a company production system.** Using it would mean building the company's publishing pipeline on a hostname explicitly granted as a last resort to those who cannot afford registration.

### Other free-domain services

Dynamic-DNS providers (DuckDNS, No-IP free tier and similar) hand out a subdomain of *their* zone. They do not delegate a zone to you, so you cannot add it to Cloudflare as a zone, which is what a named Cloudflare Tunnel requires. [UNVERIFIED in detail, but this follows from how zone delegation works — confirm before relying on it]

### Conclusion on Question 1

There is **no free domain path that is both reliable and clearly appropriate for company commercial use.** The honest options are: pay roughly $10–15/year for a real domain, or avoid needing one.

---

## 2. Question 2 — free hosting with a persistent public subdomain

This is the more promising direction, because a platform-issued subdomain removes the domain requirement *and* the tunnel entirely.

### Render — strongest candidate

| Property | Finding | Confidence |
|---|---|---|
| Persistent subdomain | Yes — `*.onrender.com` by default on free services | VERIFIED-SECONDARY |
| Credit card required | **No** — "No credit card is required" | VERIFIED-PRIMARY (Render's own article) |
| Free allowance | 750 instance hours per workspace per month | VERIFIED-SECONDARY |
| Custom domains on free | Not available | VERIFIED-SECONDARY |
| Commercial use | **No non-commercial restriction found.** I could not load Render's actual Terms of Service to confirm positively — the page did not render for me. | **UNVERIFIED** |

**Critical operational caveat — this affects Module 05 directly:**

Free web services **spin down after 15 minutes of inactivity**, and cold start takes **about one minute**. [VERIFIED-SECONDARY]

Slack requires a response to an interactive action within **3 seconds**. A cold start of ~60 seconds means the first Slack button press after an idle period **fails**. This is not a minor latency issue; it breaks the §9 approval workflow.

Possible mitigation: have local n8n ping the service every ~10 minutes to keep it warm. One always-on service consumes roughly 730 hours/month against the 750-hour allowance, so this fits — but only just, and only for a single service. This stays within the documented allowance rather than circumventing it, but it is tight and worth stating plainly rather than discovering later.

### Cloudflare Workers / Pages — possible, but two real unknowns

Persistent `*.workers.dev` / `*.pages.dev` subdomains, free plan with 100,000 requests/day. [VERIFIED-PRIMARY for the request limit]

Two unresolved problems:

1. **Commercial use is not addressed** in the Workers pricing documentation I read. [UNVERIFIED]
2. **Runtime compatibility is a genuine risk.** Next.js on Workers requires an adapter (OpenNext), and the **Firebase Admin SDK expects Node.js APIs**. Whether it runs correctly on the Workers runtime under Node compatibility mode is **[UNVERIFIED]** and would need a spike before committing. This is not a small detail — Admin SDK access is the backbone of §33's security model.

I would not adopt this without proving the Admin SDK works there first.

### Others

- **Fly.io** — no longer offers free-tier access to new users. [VERIFIED-SECONDARY] Excluded.
- **Netlify / Railway** — not investigated in depth this round. Netlify is primarily static/functions and a poor fit for a persistent app; Railway's free offering has been repeatedly reduced.

---

## 3. Recommendation

Ranked, with the reasoning stated so it can be overridden knowingly:

**1. Buy a domain (~$10–15/year) and keep the agreed local + named Cloudflare Tunnel architecture.**

This is the only option with no terms ambiguity, no cold-start problem, and no runtime risk. It preserves the architecture already settled in §28. The cost is small, annual, and buys a company asset that outlives this project.

It does technically breach the zero-paid rule — which is why it is a recommendation, not a decision. But the rule's purpose is avoiding recurring platform costs and credit-card-linked pay-as-you-go exposure; a one-off domain registration is neither.

**2. Render free tier**, if no money at all can be spent — accepting that its commercial terms are unconfirmed and that Slack interactivity needs the keep-warm workaround.

**3. EU.org + Cloudflare Tunnel** — free and functional, but uses a service that explicitly asks commercial users to look elsewhere.

**Not recommended:** Cloudflare Workers until Admin SDK compatibility is proven; Freenom under any circumstances.

---

## 4. What is still unverified

Stated plainly, per §65:

- Render's Terms of Service on commercial use — **not read**. Should be confirmed directly before adoption.
- Cloudflare's Self-Serve Subscription Agreement on commercial use of free Workers/Pages — **not read**.
- Firebase Admin SDK compatibility with the Cloudflare Workers runtime — **not tested**.
- Whether dynamic-DNS providers permit zone delegation — **not confirmed**, though it is structurally unlikely.

None of these block Module 00.

---

## 5. Sources

- [EU.org general policy — nic.eu.org](https://nic.eu.org/policy.html)
- [EU.org — nic.eu.org](https://nic.eu.org/)
- [Freenom / .tk registration status — tld-list](https://tld-list.com/blog/the-tk-domain-name)
- [.tk — Wikipedia (ICANN termination, Meta settlement, exit)](https://en.wikipedia.org/wiki/.tk)
- [Platforms with a real free tier for developers in 2026 — Render](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Render Terms of Service](https://render.com/terms) — could not be read; listed for follow-up
- [The Ultimate Guide to Render's Free Tier](https://dashdashhard.com/posts/ultimate-guide-to-renders-free-tier/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Vercel Hobby plan — non-commercial restriction](https://vercel.com/docs/plans/hobby)
- [Vercel fair use guidelines — commercial usage](https://vercel.com/docs/limits/fair-use-guidelines)
