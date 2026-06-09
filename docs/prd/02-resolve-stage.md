# Resolve Stage

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle

## Problem Statement

Every later stage of the pipeline needs a single, stable anchor to filter against: what is *this* company, what surfaces does it control, and which other companies share its name and could be mistaken for it. Without that anchor, Search has nothing to phrase queries around, Filter cannot recognise an Own Channel, and Verify cannot tell the target apart from a look-alike. The brief's own test case (Aglow, `getaglow.co` — a Sydney beauty-membership startup) is surrounded by roughly three hundred same-name surfaces: a global Christian ministry (aglow.org), a home-cleaning marketplace (HomeAglow), a Nigerian cargo airline (Aglow Air), outdoor-writers' associations, garden light festivals, and a long tail of social noise. Telling the one target apart from that crowd is the entire precision problem, and it has to be set up before a single search runs.

The Resolve stage produces that anchor — the **Resolved Identity** — exactly once per Job. It must do so cheaply (zero Resolve-time LLM cost), robustly (a missing homepage, an absent Brand Context, or unfetchable Name Collisions must degrade with a Warning, never fail the Job), and honestly (it must never *re-decide which company* the user picked at input — disambiguation is frozen into the Job upstream; Resolve only re-fetches the live brand, context, and collisions for that frozen anchor).

The stage also makes the one real HTTP **fetch** Breakbeat performs: the Resolve homepage fetch, used to confirm the name and scrape social handles. Everywhere else in the product, content is *returned* by Search or *Extracted* by Tavily; here, and only here, we reach out and fetch a page ourselves.

## Solution

The Resolve stage takes a Job's frozen company anchor (a disambiguated domain or brand-id chosen at input, or raw name-only as the explicit degraded fallback) and assembles one **Resolved Identity** carrying:

- the **company name**;
- **zero or more own domains** — the controlled surfaces later used by Filter's `own_channel` heuristic, each tagged with a provenance (`url_provided` for a host the user supplied, or derived from the resolved brand);
- **scraped social handles** — the company's named accounts on third-party platforms (its LinkedIn page, its X handle, its Substack), scraped from the fetched homepage, also feeding Own Channel recognition;
- an optional **Brand Context** sourced from BrandFetch's Brand Context API (`GET /v2/context/{domain}`, keyed by *domain* — which is precisely why a name-only Job has none): tagline/mission/description, tags, and the positioning fields Verify leans on — **value proposition, target audience segments, and products & services**;
- **zero or more Name Collisions** — different companies that share the target's name, discovered via BrandFetch's Brand Search API, each carrying its own mini brand-context from a single `/v2/context/{collisionDomain}` call;
- a derived **Negative Boost** — per ADR 0001, the collisions' own Brand Contexts *collected* into a compact one-line-per-look-alike list, handed verbatim into every Verify prompt.

The assembly draws on three BrandFetch adapters behind ports (Brand Search API, Brand API, Brand Context API) and the single homepage fetch. The Resolved Identity is job-scoped and consumed downstream by Search (to phrase queries), Filter (to recognise Own Channels), Verify (to weigh the positive Brand Context against the Negative Boost), and Classify (the Own Channel backstop).

Robustness is built in as a set of named degraded paths, each recording a **Warning** rather than failing the Job:

- **Name-only, no homepage resolves.** A name-only input that resolves no homepage proceeds *degraded*: zero own domains, no scraped handles, no Brand Context, with a Warning. Own Channel exclusion falls entirely to the Classify backstop.
- **URL-provided, homepage fetch fails.** A url-provided Job whose homepage fetch fails *keeps the given host as an own domain* (provenance stays `url_provided`), with a Warning that handles weren't scraped. The fetch failure costs the handle scrape and the name confirmation — never the knowledge the user already supplied.
- **No Brand Context.** Absence of Brand Context records a Warning but never fails the Job; Verify simply runs without the positive context for that Job.
- **Name Collisions unfetchable.** Name Collisions are best-effort and BrandFetch-indexed only; failing to discover or fetch them is a Warning, never a Job failure.

The Negative Boost is deliberately *not* a set of pre-computed per-collision diff calls (see ADR 0001). It is the raw collected collision contexts, contributing zero Resolve-time LLM cost; the target-vs-look-alike contrast happens inline inside each Verify call, against the actual page.

## User Stories

1. As a downstream Search stage, I want a single Resolved Identity carrying the company name and any own domains, so that I can phrase broad and Angle Queries around a confirmed anchor rather than the raw user input.
2. As a downstream Filter stage, I want the Resolved Identity's own domains and scraped social handles, so that I can Exclude Own Channel surfaces (`own_channel`) by matching against controlled surfaces.
3. As a downstream Verify stage, I want the Resolved Identity's Brand Context positioning fields (value proposition, target audience segments, products & services), so that I can judge on positive grounds whether a page is about the target.
4. As a downstream Verify stage, I want the Resolved Identity's Negative Boost as a compact one-line-per-look-alike list, so that I can sharpen rejection of the confusable indexed-brand middle (HomeAglow, Aglow Air) without paying for per-collision pre-computation.
5. As a downstream Classify stage, I want to know when Resolve produced no own domains or handles, so that I understand the Own Channel backstop is the only line of defence for this Job.
6. As an analyst running a collision-heavy company, I want Name Collisions discovered automatically at Resolve time, so that the target is contrasted against its known look-alikes rather than confused with them.
7. As an analyst, I want a name-only Job to still run, so that I can research a company I only know by name even when no homepage resolves.
8. As an analyst, I want a Job started from a domain to keep that domain as an own channel even if the homepage fetch fails, so that the knowledge I supplied is never thrown away by a transient fetch error.
9. As an analyst, I want failures to scrape handles or fetch collisions surfaced as Warnings rather than silent gaps, so that I can read the result list knowing exactly what was and wasn't established.
10. As an analyst, I want a Job that resolves no Brand Context to still complete, so that an absent or poorly-indexed company isn't a dead end — just a Verify run without positive context, flagged with a Warning.
11. As a cost-conscious operator, I want Resolve to make zero LLM calls, so that a collision-heavy target (15+ collisions) doesn't fire dozens of Haiku calls before any search runs.
12. As a cost-conscious operator, I want the Negative Boost to be collected collision contexts rather than pre-computed diffs, so that Verify tokens stay lean and the only contrast cost is paid once per page where it actually decides the outcome.
13. As a user who picked a specific company at input, I want a re-run to re-fetch the live brand, context, and collisions for that same anchor, so that my results refresh without the tool silently re-choosing which company it thinks I meant.
14. As an operator, I want the Resolved Identity to record the provenance of each own domain (`url_provided` versus brand-derived), so that I can tell which surfaces came from the user and which from BrandFetch.
15. As an observability consumer, I want the Resolve Stage Span to carry aggregate attributes and the BrandFetch/homepage external calls as child spans, so that I can see Resolve's cost and latency without per-collision span noise.
16. As an observability consumer, I want each degraded path to emit a Warning span event (not a span-status ERROR), so that error-rate dashboards keep meaning *failures* and a degraded-but-successful Resolve reads as `OK`.
17. As a security-conscious operator, I want no scraped homepage text or raw BrandFetch payloads on any span or log, so that the anti-echo discipline holds at the one stage that actually fetches a third-party page.
18. As a downstream Verify stage, I want each Name Collision's mini brand-context to describe how that look-alike positions itself, so that I can recognise a page that is plausibly about the look-alike rather than the target.
19. As an analyst, I want Name Collisions limited to BrandFetch-indexed brands, so that the contrast list stays a tight set of real companies and never tries (and fails) to enumerate the unbounded same-name social noise.
20. As a downstream stage, I want the Resolved Identity to be immutable and job-scoped once Resolve completes, so that every later stage reads a single consistent anchor for the whole Job.
21. As the Web UI's autocomplete, I want the Brand Search adapter to be the shared source of company suggestions, so that the same BrandFetch search powers both input-time autocomplete and Resolve-time collision discovery.
22. As a maintainer, I want the homepage fetch to be the *only* sanctioned outbound HTTP fetch in the codebase, so that "fetch" stays an unambiguous term and Result pages are never fetched by us.

## Implementation Decisions

**Module shape.** Resolve is a vertical slice and a deep module behind a simple interface: given a Job's frozen anchor, produce one Resolved Identity (plus any Warnings) or fail the Job only in the narrow cases below. Internally it composes BrandFetch ports, a homepage-fetch port, and pure assembly/derivation logic; externally it exposes a single resolve operation. The pipeline runs Resolve in-process as the first stage of the Job's BullMQ run.

**BrandFetch ports (hexagonal).** Three ports, each with a single conceptual responsibility, each backed by a thin adapter over the corresponding BrandFetch endpoint:

- a **Brand Search port** — discovers Name Collisions for the company name and is the same port the Web UI PRD consumes for input-time autocomplete;
- a **Brand port** — resolves the canonical brand for the anchor (name, domains); it is also what turns a **brand-id-only anchor into a domain** (see Anchor resolution order below), so a brand-id anchor is never needlessly treated as domainless;
- a **Brand Context port** — fetches a domain-keyed Brand Context, used both for the target (`/v2/context/{domain}`) and once per collision (`/v2/context/{collisionDomain}`).

Each port returns Zod-validated structured data; adapters own retry and timeout policy and translate transport failures into the degraded-path signals below rather than letting them escape as Job-failing throws.

**Homepage fetch port.** A single outbound HTTP fetch port confirms the name and scrapes social handles from the resolved homepage. This is the one real "fetch" in Breakbeat; it is isolated behind its own port so the rest of the system never grows a second outbound fetcher.

**Resolved Identity assembly.** Pure, side-effect-free assembly logic composes the port outputs into one Resolved Identity: company name; own domains (each tagged with provenance); scraped social handles; optional Brand Context (target positioning fields); the list of Name Collisions (each with its mini brand-context); and the derived Negative Boost. Assembly never re-chooses the company — it operates strictly on the frozen anchor — and produces an immutable, job-scoped value once complete.

**De-selfing the collision set (correctness).** A Brand Search for the company name returns the **target itself** alongside the genuine look-alikes. The target *must* be dropped from the collision set before the Negative Boost is derived — otherwise the target's own brand-context is collected into the boost and Verify is primed to *reject pages about the target* ("known look-alikes… NOT the target — reject pages about these"), a direct precision self-sabotage on exactly the collision-heavy companies the feature exists for. De-selfing matches each Brand Search hit against the frozen anchor's canonical brand (resolved via the **Brand port**): drop the hit whose `brandId` equals the anchor's resolved brand-id (strongest), else whose registrable domain equals the anchor's resolved domain (fallback). For a **name-only anchor with no resolvable brand-id/domain**, there is no exact key, so the single best Brand Search hit (top relevance / exact-name) is treated as the target and excluded, the rest listed as collisions, with a **Warning** noting the target was *inferred*. (Verify's positive "is this the target?" check is a belt-and-braces backstop if a target hit ever slips through, but de-selfing at Resolve is the correct fix, not that.)

**Negative Boost derivation (ADR 0001).** Per **ADR 0001 (Negative Boost is collected collision contexts, not pre-computed diffs)**, the Negative Boost is derived by *collecting* the collisions' own Brand Contexts into a compact one-line-per-look-alike list, formatted for verbatim injection into every Verify prompt under assertive framing ("Known look-alikes sharing this name that are NOT the target — reject pages about these: …"). There are **no per-collision Haiku diff calls** at Resolve time; the value-prop / products-and-services / audience contrast that `search.md` originally prescribed is done inline by Verify, per page, where it can focus on the axis that decides *that* page. Resolve-time LLM cost is zero. The Negative Boost is a *sharpener* for the confusable indexed-brand middle, not the primary rejection path — Filter heuristics and Verify's positive check remain the primary rejectors. ADR 0001's revisit trigger (re-introducing per-collision diffing only if Autoevals on the Aglow set show it measurably improves the confusable middle) is noted but out of scope for this PRD.

**Anchor resolution order (a brand-id anchor is NOT degraded).** Brand Context is domain-keyed (`/v2/context/{domain}`), so Resolve first resolves the frozen anchor to a canonical domain: (1) if the anchor carries a domain, use it; (2) else if it carries a brand-id, call the **Brand port** to get the canonical brand's primary domain; (3) only if *neither* yields a domain (true name-only, or a brand-id that resolves no domain) does the no-Brand-Context degraded path apply. A disambiguated brand-id is a *strong* anchor (the user explicitly picked a real brand) and gets the full Brand Context + homepage fetch + collision treatment, identical to a domain anchor — treating it as degraded would punish the better-disambiguated input. The Brand-port-resolved domain also becomes an **own domain** on the Resolved Identity (provenance: brand-derived). "Name-only / no domain" is therefore the *genuine* degraded trigger, never "the anchor stored an id instead of a domain."

**Degraded-path handling.** Assembly branches on what the ports and the fetch actually produced:

- *Name-only, no homepage resolves* → Resolved Identity with no own domains, no handles, no Brand Context; one Warning; Job proceeds. Own Channel exclusion is deferred entirely to the Classify backstop.
- *URL-provided, homepage fetch fails* → keep the user-supplied host as an own domain (provenance `url_provided`); no scraped handles; one Warning noting handles weren't scraped and the name wasn't confirmed; Job proceeds.
- *No Brand Context resolved* → Resolved Identity without target positioning fields; one Warning; Job proceeds.
- *Name Collisions undiscoverable or unfetchable* → as many collisions as succeeded (possibly zero); one Warning if any collision fetch failed; Job proceeds.

The Resolve stage fails the Job only when Foundation's lifecycle rules dictate a hard failure for this stage; the absence of domains, handles, Brand Context, or collisions is always a Warning, never a failure — Resolve's *purpose* (a usable anchor) is still met by the company name alone.

**Warning conditions (closed list).** Resolve raises a Warning for: no homepage resolved (name-only path); homepage fetch failed on a url-provided Job (handles not scraped, name not confirmed); Brand Context absent for the target; one or more Name Collision context fetches failed; the target was *inferred* (not exactly matched) when de-selfing the collision set on a name-only anchor. A Warning is a partial *success* — per ADR 0004 it is recorded as an `OK` Stage Span with a `warning` span event, never a span-status `ERROR`, and never a Bugsink issue. A non-empty Warning list drives the Job toward `done_with_warnings` per Foundation's lifecycle.

**Observability (per ADR 0004).** Resolve emits one Stage Span carrying aggregate attributes, with child spans only for the real external calls (each BrandFetch call, the one homepage fetch — each is a child span, not a per-collision swarm). Degraded paths are span events. No scraped page text, no raw BrandFetch payloads, and no prompt-shaped strings land on any span or log — counts, status, latency, and validated structured output only.

## Testing Decisions

Test external behaviour, not internals, and drive every unit with TDD throughout.

**Vitest unit tests (assembly + degraded-path + derivation).** Cover the pure logic with fakes for all ports:

- Assembly composes name, own domains (with correct provenance), handles, Brand Context, and collisions into one immutable Resolved Identity.
- Negative Boost derivation produces the compact one-line-per-look-alike list from collected collision contexts, and makes **zero LLM calls** (assert no Haiku port is invoked at Resolve time) — the load-bearing ADR 0001 guarantee.
- Each degraded path produces the right Resolved Identity shape *and* the right Warning: name-only/no-homepage; url-provided/fetch-failed keeping the host with `url_provided` provenance; absent Brand Context; failed collision fetches. Each asserts the Job proceeds (no hard failure).
- Re-run semantics: assembly re-fetches for the frozen anchor and never re-chooses the company.

**Contract / integration tests for BrandFetch adapters.** Each BrandFetch adapter (Brand Search, Brand, Brand Context) gets contract tests pinning the request shape and the Zod parse of the response, plus behaviour on timeout, error status, and empty result — verifying that transport failures surface as the degraded-path signals (Warning) rather than escaping as Job-failing throws. The homepage-fetch adapter gets the same treatment: success (handles scraped), and failure translating to the url-provided / name-only Warning paths.

**Autoevals (precision/recall, downstream).** The Aglow labelled set (14 include, ~300 exclude) is the eventual measure of whether the Negative Boost sharpens the confusable middle, but that evaluation belongs to the Verify PRD; Resolve's tests assert the *shape and cost* of the Negative Boost it hands over, not Verify's precision.

**Integration smoke (Playwright, downstream).** End-to-end coverage that a name-only Job and a url-provided Job both reach a usable Resolved Identity is exercised through the full pipeline in the Web UI PRD's integration tests; Resolve's own suite stays at the unit/contract level.

## Out of Scope

- **Input-time disambiguation.** Choosing *which* company the Job is about (autocomplete selection, the options list, or the name-only fallback) happens once at input and is frozen into the Job — owned by the Web UI and Foundation PRDs. Resolve consumes the frozen anchor and never re-chooses.
- **Per-collision LLM diffing.** Explicitly excluded by ADR 0001. The collected-contexts Negative Boost is the baseline; per-collision diffing is a deferred, eval-gated experiment, not part of this stage.
- **The Verify contrast itself.** Weighing the positive Brand Context against the Negative Boost per page is the Verify stage's job (PRD 5). Resolve only *supplies* both signals.
- **Own Channel exclusion logic.** Resolve supplies own domains and handles; the `own_channel` heuristic (Filter) and the Classify Own Channel backstop apply them. Owned by the Filter & Collapse and Verify/Extract/Classify/Enhance PRDs.
- **Search query construction, Result fetching/Extraction.** Owned by the Search and Verify/Extract PRDs. Resolve makes the one homepage fetch and nothing else; Result pages are never fetched by us.
- **Tavily Research API and the Anthropic web-search backstop.** Search-source decisions (ADR 0002) are out of scope here.
- **Job lifecycle and terminal-state computation.** How Warnings roll up into `done_with_warnings`, and how a stage failure fails the Job, are owned by Foundation & Job Lifecycle; Resolve emits the Warnings and respects the lifecycle.

## Further Notes

- **The one true fetch.** The Resolve homepage fetch is the only outbound HTTP fetch Breakbeat makes. Keep the vocabulary clean: Search *returns* Results, Tavily *Extracts* full text; only Resolve *fetches*. A second outbound fetcher anywhere else is a smell.
- **Domain-keyed context is why name-only has no Brand Context.** Brand Context is keyed by domain; a name-only Job has no domain, so it has no target Brand Context by construction — this is expected, recorded as a Warning, and not a bug to "fix."
- **Best-effort collisions, by design.** Name Collisions are BrandFetch-indexed brands only and will surface a handful or none for most targets. They will *never* cover the bulk of real-world same-name noise (the ~300 Aglow exclusions: social posts, festivals, ministries, local orgs) — that mass is rejected upstream by Filter heuristics and Verify's positive check, independently of whether any collision was known. The Negative Boost only sharpens the confusable indexed-brand middle.
- **Zero Resolve-time LLM cost is a guarantee, not an optimisation.** Per ADR 0001 it is the explicit design property; a future change that reintroduces Resolve-time Haiku calls must come through the ADR 0001 revisit path with eval evidence.
- **Provenance matters downstream.** Tagging a url-provided host's provenance lets later stages and the UI distinguish user-supplied knowledge from brand-derived domains — important in the degraded url-provided path where the host is all we have.
- **Verify weighs both signals.** The domain fact the Resolved Identity encodes is that Verify weighs a positive "is this the target?" signal (Brand Context) *and* a negative "...or one of these known look-alikes?" signal (Negative Boost). Resolve's job is to deliver both cleanly; the exact computed shape of the Negative Boost is a Resolve-stage implementation detail behind that contract.
