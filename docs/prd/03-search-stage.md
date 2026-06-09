# Search Stage

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle, Resolve Stage

## Problem Statement

A Job exists to produce a reviewable list of third-party coverage *about* a company from the last 36 months. Every later stage — Filter & Collapse, Verify, Classify, Enhance, Summarise — operates on a population of Results that this stage, and only this stage, brings into existence. If Search has thin recall, no downstream precision work can recover the coverage it never returned; the list is short and the user does not trust it. If Search has indiscriminate recall, the pipeline pays (in tokens, latency, and external-call cost) to Verify and Extract a flood of look-alikes, festivals, app-store pages, and the company's own posts that the downstream gates will only Exclude.

The hard constraint is that recall is uneven across the brief's required Content Types and across the company itself. A well-covered company with a homepage and rich Brand Context surfaces dozens of broad-query Results immediately; a name-only Job for an obscure company surfaces almost nothing from the same broad queries. Some Content Types the brief requires (podcast, newsletter) are genuinely rare and a broad natural-language query will not volunteer them. Meanwhile, paying for a second always-on search source against an already-rich yield mostly buys duplicates that an insert-time URL constraint then discards — cost with no recall gain.

Search must therefore decide *how hard to fish* per Job, cheaply, from the yield it has already seen — escalating effort only when the run is thin — while leaving every precision judgement to the stages built for it. It returns title and snippet only; it never fetches a Result's page (that is the Extract step's job, PRD 5), and it runs no dedup *stage* (insert-time URL-dedup is a database constraint; title-Collapse lives in the Filter PRD).

## Solution

Search consumes the Resolved Identity produced by the Resolve Stage (the company name, zero or more own domains and social handles, and optional Brand Context) and produces a population of Results scoped to the Job, each born `included`.

Per **ADR 0002 (Search source model)**, Search has **two sources behind a single low-yield escalation gate**. This **supersedes** the `.input/search.md` model of "18 queries (7 per-content-type + 6 time-sliced news/PR + 5 angle) run as always-on parallel sources alongside the Tavily Research API and Anthropic web search." That three-always-on-source, eighteen-fixed-query model is explicitly retired here.

The two sources are:

1. **Tavily Search — primary recall, ALWAYS run.** By default Search issues a few broad natural-language queries built from the Resolved Identity. **When Tavily returns fewer than a threshold of hits**, the escalation gate fires and Search expands to:
   - the full **Angle Query** set — queries phrased around event types ("X funding", "X acquisition", "X partnership"), because recall comes from *more angles, not more per-Content-Type slices*; plus
   - a small number of **type-targeted queries** aimed only at the genuinely rare Content Types (podcast, newsletter) that broad and Angle Queries under-fish. This is the narrow, deliberate exception to the angles-not-slices rule.

2. **Anthropic web search (`web_search` tool) — an escalation BACKSTOP, not always-on.** It fires on the *same* low-yield trigger as the Angle Queries, as a recall rescue for thin runs (name-only inputs, obscure companies). It is not run in parallel against a rich Tavily yield: per ADR 0002, an always-on Anthropic search against a healthy Tavily result set mostly produces duplicates the system pays for and then URL-dedups away.

The **Tavily Research API is DEFERRED** (ADR 0002): it is not in the recall path. Its report-with-citations shape fits a many-Results-then-verify pipeline awkwardly, costs more, and is slower; its natural re-entry point is feeding the **Summarise** stage, not recall.

A **Time Slice** is one 12-month `start_date`/`end_date` window, applied **only to news and press releases**, where publication dates are reliable. The 36-month horizon is covered by sliced windows for those date-reliable angles; other queries run unsliced.

Each Result is born `included`. Its **provisional Match Score** is Tavily's own relevance score — so streaming rows sort sensibly *before* Verify has run any judgement of its own (Verify later ratchets this to interim, then final/authoritative; see the Verify PRD). Search returns **title + snippet only**; the full page text is pulled later by the Extract step (PRD 5) — Search never fetches a Result's page.

**Insert-time URL-dedup is a database unique constraint**, not a stage. There is no dedup stage. When two queries or the two sources return the same URL, the second insert is absorbed by the constraint. Title-Collapse of near-duplicates is a separate concern owned by the Filter PRD.

A stage that returns *some* Results despite individual query failures records a **Warning** and continues. Search fails the Job only when it leaves nothing to show — i.e. when *all* queries against *all* attempted sources fail.

## User Stories

1. As a PR/comms professional, I want a single company input to produce a broad first sweep of third-party coverage, so that I see trustworthy Results streaming in within seconds of submitting.
2. As a user researching a well-covered company, I want broad natural-language queries to run first and alone, so that I am not made to wait on (or pay for) escalation effort a healthy yield does not need.
3. As a user researching an obscure or name-only company, I want Search to escalate automatically when the broad sweep is thin, so that a poorly-covered company still produces the fullest list achievable.
4. As an analyst, I want escalation to add more *angles* (funding, acquisition, partnership) rather than more per-Content-Type slices, so that recall grows along the dimensions where coverage actually lives.
5. As an analyst, I want a couple of type-targeted queries for genuinely rare Content Types (podcast, newsletter) on escalation only, so that the long-tail types the brief requires are not silently absent without bloating every run.
6. As an operator, I want the Anthropic web-search backstop to fire only on the same low-yield trigger, so that thin runs get a recall rescue while rich runs do not pay for duplicate Results we immediately URL-dedup away.
7. As a cost-conscious operator, I want a healthy Tavily yield to *suppress* the Anthropic backstop entirely, so that the system spends a second source's budget only where it changes the result.
8. As a reviewer, I want news and press-release queries constrained to 12-month Time Slices across the 36-month horizon, so that date-reliable coverage is gathered window-by-window without leaning on dates that are unreliable for other Content Types.
9. As a reviewer, I want Time Slices applied *only* to news and press releases, so that blog posts, social posts, podcasts, and newsletters — whose dates Tavily reports unreliably — are not wrongly Excluded `out_of_window` at the source.
10. As a user watching the list build, I want each Result to arrive with a provisional Match Score from Tavily's relevance, so that streaming rows sort sensibly before Verify has run.
11. As a reviewer, I want Search to return title and snippet only, so that the expensive full-page pull (Extract) happens only for Results that survive the snippet gates.
12. As an engineer, I want Search to never fetch a Result's page itself, so that "fetch" stays reserved for the single Resolve homepage fetch and Extract owns all page retrieval.
13. As an operator, I want every Result born `included`, so that Exclusion is the only state transition and downstream stages have one clear population to narrow.
14. As an engineer, I want exact-URL dedup enforced by a database unique constraint at insert time, so that overlapping queries and the two sources cannot mint duplicate Result rows and there is no dedup stage to maintain.
15. As an engineer, I want title-based Collapse to be explicitly *out of this stage*, so that near-duplicate clustering runs once, later, over still-`included` Results in the Filter stage.
16. As an operator, I want a single low-yield threshold to govern both Angle Query escalation and the Anthropic backstop, so that the escalation decision is one auditable judgement, not several.
17. As an operator, I want individual query failures to be recorded as Warnings while the stage continues, so that a partial sweep still produces a reviewable list.
18. As an operator, I want Search to fail the Job only when *all* queries against *all* attempted sources fail, so that the Job fails only when there is genuinely nothing to show.
19. As an SRE, I want each external search call (Tavily, Anthropic) emitted as a child span under the Search Stage Span, so that the calls that dominate cost and latency are individually accounted for.
20. As an SRE, I want the Search Stage Span to carry aggregate attributes (`results.out`, query counts, whether escalation fired, `tokens.total`, `cost.total`, `warnings`), so that I can read a run's shape without a span per Result.
21. As an engineer, I want the query builder to derive its queries from the Resolved Identity (name plus, when present, domain and Brand Context), so that a richer identity yields better-targeted broad and angle queries.
22. As an engineer, I want a name-only degraded Resolved Identity (no domain, no Brand Context) to still produce a working broad sweep, so that the degraded Resolve path still searches rather than stalling.
23. As an engineer, I want the Tavily adapter behind a port, so that the query builder and escalation gate are unit-testable without a live Tavily account.
24. As an engineer, I want the Anthropic web-search backstop behind its own adapter port, so that the backstop is contract-tested independently of the primary recall path.
25. As a reviewer, I want Results returned by the backstop to flow through the same insert-time URL-dedup as Tavily Results, so that a backstop rescue never reintroduces a URL the primary sweep already inserted.
26. As an analyst, I want the escalation decision computed from the *yield Search has already seen*, so that effort is spent reactively on thin runs rather than speculatively on every run.
27. As a future maintainer, I want the deferred Tavily Research API kept clearly out of the recall path with its re-entry point noted at Summarise, so that I do not wrongly wire it into Search when revisiting ADR 0002.

## Implementation Decisions

The stage is a **deep module with a simple interface**: given a Resolved Identity, it inserts a population of `included` Results scoped to the Job and returns the stage outcome (counts, whether escalation fired, Warnings). Internally it composes a query builder, an escalation gate, and two source adapters behind ports, following the hexagonal/ports-and-adapters and vertical-slice discipline of the project.

**Tavily Search adapter (port).** A port whose conceptual interface accepts a structured query (query text, optional `start_date`/`end_date` Time Slice window, and Tavily's search parameters) and returns a normalized list of hits — each carrying URL, title, snippet, Tavily's relevance score, and a **nullable `published_date`** (from Tavily's hit metadata where present) — plus call-level metadata for telemetry (token/cost where applicable, latency). The `published_date` is persisted on the Result at insert and is the single source for Collapse's date arithmetic, Filter's `out_of_window` rule (ADR 0005), and the date the UI shows; it is *not* used to Exclude at Search time. The adapter owns all `@tavily/core` specifics; nothing above the port knows the client shape. Network and quota failures surface as a typed failure the stage records as a Warning, not an exception that escapes the stage unless *every* call fails.

**Query builder.** A pure function (no I/O) over the Resolved Identity. It emits, in order of effort:
- the **broad set** — a few broad natural-language queries from the company name and, when present, its domain and Brand Context positioning;
- the **Angle Query set** — event-type queries ("`<name>` funding", "`<name>` acquisition", "`<name>` partnership", etc.), the recall-by-more-angles expansion;
- the **type-targeted set** — a small number of queries aimed only at the rare Content Types (podcast, newsletter).
Time Slice application is part of building the news/press-release angles: those queries are emitted once per 12-month window across the 36-month horizon with `start_date`/`end_date` set; all other queries are emitted unsliced. The builder being pure makes the entire query plan assertable in a unit test.

**Escalation gate.** A pure decision function: given the count of **distinct Results inserted by the broad set** (post-URL-dedup, *not* raw hits returned), return whether to escalate. Counting post-dedup is deliberate — the broad queries overlap heavily, so raw hit count would let the same story returned by three queries *mask* a genuinely thin run and suppress the escalation a borderline company most needs; duplicates aren't coverage, distinct Results are. The gate therefore runs **after the broad set has fully inserted and URL-dedup has settled**, never mid-sweep. On escalation it authorises *both* the Angle Query + type-targeted expansion *and* the Anthropic web-search backstop — the single low-yield trigger of ADR 0002. Below the threshold escalation fires; at or above it, the stage stops after the broad set and the backstop never runs. The threshold is a **single scalar configuration value** (not per-query, not per-Content-Type), **starting at ~10 distinct Results and tuned against the Aglow set** (≈14 genuine includes), never a literal scattered through the code.

**Anthropic web-search backstop adapter (port).** A port wrapping the Anthropic SDK's `web_search` tool, invoked *only* when the escalation gate authorises it. Its conceptual interface mirrors the Tavily adapter's output (normalized hits: URL, title, snippet, plus GenAI call metadata for telemetry — model id, token usage, finish reason, derived cost), so the stage treats both sources uniformly downstream. It is never run in parallel against a rich yield; it is a recall rescue for thin runs.

**Time Slice application.** A Time Slice is one 12-month `start_date`/`end_date` window. Slicing is applied only to the news and press-release angles, where dates are reliable; the 36-month horizon is covered by consecutive windows for those angles. Other Content Types' queries carry no window. This keeps date-unreliable types from being narrowed at the source. Out-of-window *judgement* is a downstream concern: Search captures each hit's nullable `published_date` and **Filter** writes the `out_of_window` exclusion code from it (ADR 0005). Time Slices are a recall tactic here, never the recency filter.

**Provisional Match Score.** On insert, each Result's Match Score is set to **Tavily's own relevance score** for that hit (the provisional resolution of the three-stage Match Score ratchet). Anthropic backstop hits have no comparable native score, so they take a **fixed low provisional floor** (a defined constant distinctly below any real Tavily score) and therefore sort *beneath* Tavily-scored rows until Verify runs. This is honest — a backstop hit is a recall rescue on a thin run, carrying the least provenance of all — and transient: the snippet-gate's interim score replaces it within seconds, so a genuinely-relevant rescue hit climbs as soon as it is judged, while a mid-band guess would instead let an unjudged rescue hit outrank real Tavily hits and then visibly drop (the reflow PRD 7 avoids). This is explicitly provisional: Verify replaces it with an interim score at the snippet gate and a final/authoritative score at the full-text re-pass. Search writes provisional only and never a `verification_status`.

**Insert-time URL-dedup.** Exact-URL dedup is a **database unique constraint** on the Result's URL within the Job scope — not a stage and not a code path that scans for duplicates. Inserts that violate the constraint are absorbed (ignored) so overlapping queries and the two sources cannot create duplicate rows. There is no dedup stage anywhere in the pipeline; near-duplicate **Collapse** on normalized title is a separate, later concern owned by the Filter & Collapse PRD.

**ADR references and supersession.** This stage implements **ADR 0002 (Search source model)**: two sources, one low-yield escalation gate, Tavily Research deferred. It **supersedes** `.input/search.md`'s "18 queries / 3 always-on parallel sources (Tavily Search + Tavily Research + Anthropic web search)" model — that fixed-query, three-always-on-source design is retired and must not be reintroduced.

No file paths or code snippets are prescribed here; module boundaries and conceptual interfaces only.

## Testing Decisions

Test external behaviour, not internals, and build the stage test-first (TDD throughout).

- **Query builder (Vitest, unit).** It is pure, so assert the *query plan* directly from a given Resolved Identity: the broad set is present by default; the Angle Query and type-targeted sets appear only in the escalated plan; news and press-release angles carry 12-month `start_date`/`end_date` windows covering the 36-month horizon while other queries carry none; a name-only degraded Resolved Identity (no domain, no Brand Context) still yields a usable broad set.
- **Escalation gate (Vitest, unit).** Pure decision tests around the threshold, measured on **distinct post-dedup Results**: a count at or above the threshold suppresses both the Angle/type-targeted expansion and the Anthropic backstop; below it authorises both. Pin that overlapping broad queries returning many *raw* hits but few *distinct* Results still escalate (the post-dedup semantics), and the exact-threshold boundary.
- **Tavily Search adapter (contract / integration).** A contract test asserts the adapter maps Tavily's response shape to the normalized hit (URL, title, snippet, relevance score) and surfaces Time Slice windows as the API's date parameters; an integration test (recorded or sandboxed) confirms a real call round-trips and that a failed query is reported as a Warning-grade failure rather than throwing.
- **Anthropic web-search backstop adapter (contract / integration).** A contract test asserts the `web_search` tool response maps to the same normalized hit shape and emits GenAI call metadata for telemetry; an integration test confirms the backstop is invoked only when authorised and stays dormant otherwise.
- **Insert-time URL-dedup (integration).** Inserting the same URL twice within a Job (across queries and across the two sources) results in exactly one Result row; the duplicate is absorbed by the unique constraint, not by application code.
- **Provisional Match Score (integration).** Inserted Results carry Tavily's relevance as their Match Score and are ordered by it descending before any Verify judgement runs; no `verification_status` is written by Search.
- **Stage outcome (integration).** Some-queries-fail records a Warning and still returns Results; all-queries-across-all-sources-fail fails the Job. Escalation firing vs not is observable in the stage outcome and on the Stage Span aggregates.
- **Recall realism (Autoevals, against the Aglow labelled set).** The Aglow test case is a labelled precision/recall set; use it to check that the broad-then-escalate plan recalls the labelled include URLs (escalation should be observable on this collision-heavy, mixed-coverage target). Precision judgements belong to downstream stages, but Search's recall floor is measurable here.

## Out of Scope

- **The Tavily Research API.** Deferred per ADR 0002; not in the recall path. Its natural re-entry point is feeding the **Summarise** stage if snippet-based summaries prove too thin — never recall. Do not wire it into Search.
- **The Extract step (PRD 5).** Search returns title + snippet only. Pulling full page text (via Tavily, server-side) for the Results that survive the snippet gates is the Extract step's responsibility; Search never fetches a Result's page.
- **Filter & Collapse.** Heuristic Exclusions (`own_channel`, `aggregator`, `ecommerce_review`), `out_of_window` judgement, and near-duplicate title **Collapse** all live in the Filter PRD. Search performs only insert-time exact-URL dedup via a database constraint.
- **Verify, Classify, Enhance, Summarise.** Search writes no `verification_status`, no Content Type, no Sentiment, no Enhancement, and no Summary. It writes the provisional Match Score and nothing else of those.

## Further Notes

- **Born `included`, Exclusion is the only transition.** Search never Excludes anything; it only inserts `included` Results. The first Exclusions appear in Filter. Nothing is ever dropped, deleted, or filtered out — content the system chooses not to surface is simply *never returned by Search*.
- **The single trigger is the design.** Folding Angle Query escalation and the Anthropic backstop onto one low-yield threshold is deliberate (ADR 0002): it makes "how hard did we fish this Job?" a single auditable decision and keeps the second source's cost tied to where it rescues recall.
- **Revisit triggers carried from ADR 0002.** If eval recall on thin runs stays weak with the backstop, or if duplicate cost proves negligible, reconsider running Anthropic always-on. If snippet-based Summaries prove too thin, the deferred Tavily Research API re-enters at Summarise. Both are noted, neither is in scope here.
- **Observability (ADR 0004).** The Search Stage Span carries aggregate attributes; each Tavily and Anthropic call is a child span (Anthropic calls carry OTel GenAI conventions plus derived cost). A failed query is a span event Warning (`OK` status), not an `ERROR`. Per the anti-echo discipline, no raw query completions or snippet text go on spans or logs — counts, model id, finish reason, latency, cost, and validated structured output only.
- **Naming discipline.** "Fetch" is reserved for the Resolve homepage fetch and is never used for Search or Extract; Extract *retrieves* page text via Tavily. Results are *returned* by Search, never "fetched". Use Result, never hit/item/link, in product-facing text.
