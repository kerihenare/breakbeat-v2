# Filter & Collapse

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle, Search Stage

## Problem Statement

A broad recall search returns a large, noisy set of Results. For a target like the Aglow test case, a few thousand candidate hits surface roughly 14 pieces of genuine third-party coverage buried under hundreds of off-target rows: the company's own website and social profiles, app-store listings, link aggregators, ecommerce and product-review pages, near-identical wire-distributed copies of the same press release, and a long tail of unrelated entities that merely share the name. Recall is deliberately generous; the cost of that generosity is paid here.

The expensive precision work — Verify's entity-relevance judgement, Extract, the full-text re-pass — runs per-Result against an LLM and a paid extraction API. Sending the raw recall set into that work is wasteful (we pay to Extract and judge obvious noise) and slow. We need a cheap, deterministic stage that kills the high-volume, structurally-obvious noise *before* any token is spent, and that does so independently of whether Resolve happened to know about a given Name Collision.

That noise has a recognisable shape. Own-channel surfaces (the company's domains and its named accounts on third-party platforms), link aggregators, and ecommerce/product-review pages are all identifiable from a URL, a host, and a snippet — no model required. Likewise, the recall set contains many near-identical copies of the same story (a press release re-published verbatim across a dozen wire outlets); keeping all of them inflates the list, double-counts a single story, and pays the LLM repeatedly for one piece of coverage.

The Filter stage is, alongside Verify's positive check, the **primary noise rejector**: between them they strip the social / own-channel / app-store / review mass. Filter does the part that needs no judgement and no knowledge of which other companies share the name. Collapse, running at the tail of the same stage, removes the duplicate-story redundancy. Both must respect the project's invariants: every removal is a soft Exclusion (never a delete), every Exclusion carries a machine-groupable code from the closed vocabulary, and no free text from any model is ever echoed into a stored field.

## Solution

The **Filter stage** consumes the `included` Results produced by the Search stage (Search has already enforced exact-URL dedup at insert time via a DB unique constraint) and applies cheap, deterministic heuristic Exclusions against the Resolved Identity produced by Resolve. It writes three codes from the closed `exclusion_code` set:

- **`own_channel`** — the Result sits on a surface the company *controls*: one of its own domains, or one of its named accounts/profiles on a third-party platform (its LinkedIn page, its X handle, its Substack, its app-store listing).
- **`aggregator`** — the Result is a link-aggregator / index / directory surface that re-lists content rather than publishing original coverage about the company.
- **`ecommerce_review`** — the Result is a product page, ecommerce listing, or product-review / comparison page.

Each Exclusion is **soft**: the Result row stays in the database, transitions `status` from `included` to `excluded`, and records the `exclusion_code` (why) plus a nullable `exclusion_detail`. Nothing is deleted; an Excluded Result is simply not returned as live coverage. The `exclusion_code` records *why* the Result was Excluded, never which stage caught it — these heuristics write the same vocabulary the Classify backstop (PRD 5) writes, so the code alone never reveals the catcher.

The **Own Channel control test** is the load-bearing rule: the test is *control of the surface*, not authorship. A wire-distributed press release or a company-bylined guest post sits on someone else's editorial surface and is **in scope** (press release is a required Content Type); content *about* the company on any platform is **in scope**; only a surface the company controls is `own_channel`.

After the heuristic pass, **Collapse** runs at the **tail of the Filter stage**, over the still-`included` Results only. It deduplicates near-identical Results on **normalized title**: dated copies cluster within **14 days** of the cluster's earliest member; the **earliest-published** copy wins; the losers are Excluded as `duplicate` with a human-readable `exclusion_detail` like `"of #42"` pointing at the winner. A date-unknown copy joins a cluster only when the grouping is unambiguous (exactly one cluster); with multiple candidate clusters it stays `included` rather than being guessed into a story. An already-Excluded copy never enters the Collapse pool — it can neither compete nor win.

When Resolve produced a **degraded, name-only Resolved Identity** (no own domains — the homepage fetch failed and no handles were scraped), the `own_channel` heuristic has little to anchor on. In that case Own Channel exclusion falls back to the **Classify backstop in PRD 5**, which writes `own_channel` with `exclusion_detail = "LLM"`. Filter still applies whatever own-channel signal it has (e.g. a `url_provided` host the user supplied) and still applies the `aggregator` and `ecommerce_review` heuristics normally.

The stage is, with the deliberate exception of the date arithmetic, **pure deterministic logic over structured Result fields and the Resolved Identity** — no network calls, no LLM. That makes it fast, cheap, and exhaustively unit-testable against labelled fixtures, including the Aglow test case.

## User Stories

1. As a PR analyst, I want the company's own website and blog Excluded automatically, so that the list shows coverage *about* the company, not pages the company published about itself.
2. As a PR analyst, I want the company's named social accounts (its LinkedIn page, its X handle, its Instagram, its Facebook page, its TikTok) Excluded as own channels, so that the company's own posts don't crowd out third-party coverage.
3. As a PR analyst, I want a journalist's or a customer's social post *about* the company to stay in scope, so that genuine third-party commentary on a platform isn't lost just because the platform also hosts the company's own account.
4. As a PR analyst, I want a wire-distributed press release to stay in scope even though the company authored it, so that the press-release Content Type the brief requires is never wrongly Excluded as own-channel.
5. As a PR analyst, I want a company-bylined guest post on someone else's publication to stay in scope, so that earned placements on third-party editorial surfaces are counted.
6. As a PR analyst, I want app-store listings for the company's own app Excluded as own channels, so that Apple App Store and Google Play pages the company controls don't appear as coverage.
7. As a PR analyst, I want link-aggregator, index, and directory pages Excluded as aggregators, so that the list isn't padded with sites that merely re-list links rather than reporting.
8. As a PR analyst, I want ecommerce and product pages Excluded, so that "buy" and product-detail pages never read as editorial coverage.
9. As a PR analyst, I want product-review and comparison pages Excluded under the same `ecommerce_review` code, so that review-aggregation surfaces are treated as the noise they are.
10. As a reviewer scanning the Excluded section, I want each Excluded Result to carry a clear reason code (`own_channel`, `aggregator`, `ecommerce_review`, `duplicate`), so that I can audit *why* something was removed and trust the filtering.
11. As a reviewer, I want nothing ever deleted, so that I can always inspect what was Excluded and reverse my judgement of the tool's behaviour.
12. As a reviewer, I want the reason code to describe *why* a Result was removed, not which stage removed it, so that the same code means the same thing whether a heuristic or the Classify backstop caught it.
13. As a reviewer, I want near-identical copies of the same story collapsed to one row, so that a single press release re-published across a dozen wire outlets counts once, not a dozen times.
14. As a reviewer, I want the earliest-published copy of a duplicated story kept as the winner, so that the surviving row points at the original break rather than a later re-print.
15. As a reviewer, I want each collapsed duplicate to record which Result it was a duplicate *of* (e.g. `"of #42"`), so that I can trace a removed copy back to the surviving original.
16. As a reviewer, I want a Result whose publication date is unknown to be collapsed into a duplicate group only when there is exactly one obvious group, so that the tool never guesses an undated copy into the wrong story.
17. As a reviewer, I want an undated copy that could belong to several stories to stay in the list rather than be silently folded into one, so that ambiguity is preserved as visible coverage instead of a guess.
18. As a reviewer, I want an already-Excluded copy never to win a Collapse, so that an own-channel or aggregator copy can never swallow legitimate coverage and become the surviving row.
19. As an operator, I want the Filter stage to run with no network calls or LLM tokens, so that the cheap noise is removed before any paid Verify, Extract, or Enhance work begins.
20. As an operator, I want exact-URL duplicates handled at Search insert time, not re-handled here, so that there is exactly one place each kind of de-duplication happens (URL at insert, title at Collapse).
21. As an operator, I want Filter to write the same closed `exclusion_code` vocabulary as every other stage, so that aggregate Exclusion counts group cleanly across the whole pipeline.
22. As an operator, I want Filter never to store free text emitted by a model, so that the prompt-injection echo channel is closed at this stage by construction (these heuristics emit no model text at all).
23. As an operator running a name-only degraded Job, I want Filter to apply whatever own-channel signal it has and defer the rest to the Classify backstop, so that a Job with no resolved domains still gets the best own-channel rejection available without failing.
24. As an operator, I want Filter to proceed and record a Warning rather than fail the Job when own-channel coverage is degraded, so that a reviewable list still exists even when Resolve was thin.
25. As an operator, I want the `aggregator` and `ecommerce_review` heuristics to run identically whether or not Resolve was degraded, so that those rejectors don't depend on knowing the company's domains.
26. As a developer, I want the heuristic rules expressed as pure functions over a Result and the Resolved Identity, so that I can unit-test each rule in isolation against labelled fixtures.
27. As a developer, I want the Own Channel test driven by the Resolved Identity's own domains and scraped handles, so that the control test is anchored on resolved facts rather than guesswork.
28. As a developer, I want Collapse expressed as a deterministic clustering function over normalized title and publication date, so that its output is reproducible and testable without any external dependency.
29. As a developer, I want the title-normalization rule defined precisely (case, whitespace, punctuation, trailing source/site suffixes), so that "the same title" means the same thing on every run.
30. As a developer, I want the Aglow test case encoded as a labelled fixture set, so that every regression in the heuristics or Collapse is caught by a failing test.
31. As a developer, I want Filter to emit aggregate Stage Span attributes (Results in/out and per-code Exclusion counts) without any per-Result span, so that the stage's behaviour is observable without flooding the Job Trace.
32. As a developer, I want a Collapse loser to be recorded as a span event on the Stage Span, so that an interesting per-Result outcome is visible in the trace while happy-path rows stay silent.
33. As a reviewer, I want the Match Score ordering untouched by Filter, so that the only thing this stage changes is which Results are `included`, never how the survivors are scored or sorted.
34. As a developer, I want an Exclusion to be idempotent — a Result already `excluded` is never re-Excluded with a different code — so that re-entrancy or retries don't rewrite reasons.
35. As an operator, I want the order of heuristic evaluation defined so that a Result that qualifies for several codes is assigned a single, predictable code, so that Exclusion counts are stable and explainable.

## Implementation Decisions

This is the **Filter & Collapse** vertical slice. It is a deep module with a simple interface: in, a Job's `included` Results plus its Resolved Identity; out, the same Results with some transitioned to `excluded` and a set of aggregate counts for the Stage Span. It performs the Filter stage's heuristic pass and then the Collapse tail-pass. It owns no network adapters.

### Stage interface

The stage exposes one conceptual operation: *given a Job's `included` Results and its Resolved Identity, apply the heuristic Exclusions and then Collapse, persisting each transition and returning aggregate Exclusion counts per code.* It depends on:

- A **Results repository port** (from Foundation & Job Lifecycle) to read the Job's `included` Results and to record each Exclusion (set `status = excluded`, write `exclusion_code` and `exclusion_detail`). Exclusion is the only `status` transition; a Result already `excluded` is skipped.
- The **Resolved Identity** (from Resolve, carried on the Job): the company name, zero or more own domains, and scraped social handles. This is the anchor for the Own Channel control test.

The heuristic rules and the Collapse algorithm are **pure functions** with no I/O; the stage orchestrates them and the repository writes. This keeps the decision logic exhaustively unit-testable.

### Heuristic rules and exclusion_code mapping

Each rule is a pure predicate over a Result (its URL/host, title, snippet) and, where relevant, the Resolved Identity. Rules are evaluated in a **fixed priority order** so that a Result qualifying for more than one code receives a single, predictable code; the recommended order is `own_channel` → `ecommerce_review` → `aggregator` → `out_of_window` (most-specific-surface signal first, so the Excluded reason names *what kind of surface* it was before falling back to "merely too old"). The first matching rule Excludes the Result; rules are not re-applied to an already-Excluded Result.

- **`own_channel`** — true when the Result's host matches one of the Resolved Identity's own domains (registrable-domain match, subdomains included), OR the Result is the company's *named account* on a recognised third-party platform. The named-account test compares the platform-specific account identifier in the URL path against the Resolved Identity's scraped handles for that platform (e.g. an `linkedin.com/company/<handle>`, `x.com/<handle>`, `instagram.com/<handle>`, `facebook.com/<page>`, `substack`, or an app-store developer/app listing the company controls). A third-party post that merely *mentions* the company, or a different person's profile, does **not** match — control of the surface is the test, not the appearance of the name. App-store listings for the company's own app are own channels.
- **`ecommerce_review`** — true when the Result is a product page, ecommerce listing (cart/checkout/product-detail surfaces), or a product-review / comparison page. Recognised structurally from host and URL-path shape plus snippet cues; this is the "coverage *about* it, not a place to buy or rate its product" rule.
- **`aggregator`** — true when the Result is a link-aggregator, index, directory, or re-listing surface that does not publish original coverage about the company. Recognised from a maintained set of known aggregator hosts plus structural cues.
- **`out_of_window`** — true when the Result's **Published Date** (captured by Search from Tavily metadata, ADR 0005) is older than the 36-month horizon. Pure date arithmetic, no network or model. A Result with a **NULL** Published Date is **never** Excluded `out_of_window` — we do not guess a missing date into a rejection (symmetric with Collapse's undated-copy rule). This is the recency *precision* backstop; Search's Time Slices are the recency *recall* tactic and Exclude nothing.

Every heuristic Exclusion writes its `exclusion_code` and leaves `exclusion_detail` null (the heuristics emit no human-readable catcher string and **never** any model text). The codes are deliberately the same vocabulary the Classify backstop writes downstream; the backstop is what distinguishes itself, by writing `exclusion_detail = "LLM"`.

The closed set is honoured exactly: Filter writes `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window` (heuristics) and `duplicate` (Collapse). It never writes `off_topic` (Verify's, written with `exclusion_detail = "LLM"`), and `llm_excluded` is not a code at all.

### Degraded (name-only) fallback

When the Resolved Identity carries **no own domains** (the name-only degraded path), the domain arm of the `own_channel` rule has nothing to match and the handle arm matches only if Resolve happened to record handles. Filter applies whatever own-channel signal it has — including a `url_provided` host the user supplied, which Resolve keeps as an own domain — and otherwise leaves Own Channel rejection to the **Classify backstop in PRD 5**. The `aggregator` and `ecommerce_review` heuristics are independent of the Resolved Identity's domains and run unchanged. Filter does not fail the Job in this case; the thinness of own-channel coverage is already recorded as a Resolve-stage Warning.

### Collapse algorithm

Collapse runs once, at the **tail** of the stage, over the Results still `included` after the heuristic pass (an already-Excluded copy is outside the pool and can neither compete nor win):

1. **Normalize title.** Produce a normalized key per Result: lowercase, collapse internal whitespace, strip surrounding punctuation, and remove a trailing source/site suffix (the " — Site Name" / " | Publisher" tail that wire re-prints append). The exact normalization is defined once and shared by all tests; "near-identical title" is defined as equal normalized keys.
1a. **Distinctiveness gate (guard against generic-title false merges).** A normalized key is only allowed to anchor a cluster when it is **distinctive**: at least a configured minimum of *meaningful* tokens (e.g. ≥ 5) after removing the company name and stop-words. A title that is just the company name or a generic phrase ("Funding Announcement", "Q3 Update", "Press Release", "Company News") is **never a collapse key** — each such Result stays a singleton. A shared title is evidence of "same story" only when the title itself is identifying.
2. **Cluster.** Group distinctive-keyed Results by normalized key. Within a key, **dated** copies cluster together when each is within **14 days** of the cluster's **earliest** member (the window is anchored to the earliest member, not pairwise-chained). A cluster is only collapsed when it **spans ≥ 2 distinct source domains** — the signature of true wire syndication (same story, many publishers); same-title copies confined to a single domain are left as singletons (more likely a pagination/edit artifact or genuinely distinct pieces). When in doubt, **under-collapse**: a visible near-duplicate is a minor annoyance, a silently-Excluded real story is a trust failure (symmetric with the undated-copy rule).
3. **Pick the winner.** Each cluster's winner is the **earliest-published** copy. A single-member cluster has no losers and is left untouched.
4. **Exclude the losers.** Every non-winning member of a multi-member cluster is Excluded with `exclusion_code = duplicate` and `exclusion_detail` set to a short human-readable pointer at the winner, e.g. `"of #42"` (a stable Result reference, not model text).
5. **Handle date-unknown copies.** A copy whose publication date is unknown joins a cluster **only when the grouping under its normalized key is unambiguous** — exactly one cluster exists for that key. If multiple clusters exist for the key, the date-unknown copy stays `included` (it is not guessed into a story).

Collapse changes only `status`/`exclusion_*` on losers; it never alters Match Score or ordering. The surviving winners flow on to Verify, Extract, Classify, and Enhance — so the LLM never pays to process a duplicate copy.

### Observability

Filter emits one **Stage Span** carrying aggregate attributes: `results.in`, `results.out`, and `excluded.{own_channel|aggregator|ecommerce_review|duplicate}` counts. Happy-path `included` Results produce no span and no event. Each Exclusion (heuristic and Collapse loser) is an interesting per-Result outcome and is recorded as a **span event** on the Stage Span. No raw URL beyond what the span event needs, and never any model text, appears on the span. A Warning (e.g. "own-channel heuristic ran degraded: no resolved domains") is an `OK` span with a span event, never a span-status `ERROR`.

## Testing Decisions

This stage is almost entirely pure deterministic logic, which makes it the ideal candidate for thorough **Vitest** unit tests over **labelled fixtures**, written **TDD throughout** (red-green-refactor): write the failing test from the labelled expectation first, then the rule that satisfies it. Tests assert **external behaviour** — given these Results and this Resolved Identity, which Results end `excluded`, with which `exclusion_code` and `exclusion_detail` — not internal call shapes.

### Heuristic rule tests

- One labelled fixture per heuristic, with positive and negative cases. For `own_channel`: the company's own domain and subdomains match; its named accounts on each supported platform match; a third party's post mentioning the company does **not** match; a different person's profile on the same platform does **not** match; the company's app-store listing matches.
- **Control-not-authorship** cases, asserted explicitly: a wire-distributed press release stays `included`; a company-bylined guest post on a third-party publication stays `included`; content *about* the company on a platform where the company also has an account stays `included`.
- `aggregator` and `ecommerce_review` positive/negative fixtures, including a product page, an ecommerce listing, a product-review/comparison page, and a link-aggregator/directory page versus a genuine article on a news host.
- **Priority-order** test: a Result that matches more than one rule receives the single expected code, deterministically.
- **Degraded path** test: with a Resolved Identity carrying no own domains, the domain arm of `own_channel` Excludes nothing, the `url_provided` host (if present) still Excludes, and `aggregator`/`ecommerce_review` behave identically to the resolved case — confirming the deferral to the Classify backstop without Filter failing.

### Collapse tests

- Title-normalization unit tests: case, whitespace, punctuation, and trailing source-suffix stripping all map to the expected key; two genuinely different titles do **not** collide.
- Distinctiveness gate: a generic/short title ("Funding Announcement", the bare company name) never anchors a cluster — independent same-generic-title copies all stay `included` singletons; a distinctive title still clusters. Same-title copies on a single source domain stay singletons; the same distinctive title across ≥2 domains collapses (the wire-syndication signature). Assert the bias-to-under-collapse direction explicitly.
- 14-day window: copies inside the window (anchored to the earliest member) cluster; a copy outside it forms a separate cluster.
- Earliest-published winner: the winner is the earliest copy and the losers are Excluded `duplicate` with `exclusion_detail` pointing at the winner.
- Date-unknown handling: an undated copy under a single-cluster key joins and (if not the chosen winner) is Excluded; an undated copy under a multi-cluster key stays `included`.
- Already-Excluded copies are outside the pool: an own-channel or aggregator copy can never win a Collapse, and removing it never changes which `included` copy wins.
- Idempotency / re-entrancy: running the stage twice produces the same Exclusions and never rewrites a code.

### The Aglow test case

The Aglow labelled set (≈14 include, ≈300 exclude) is encoded as the primary precision fixture for this stage. Filter-stage assertions target the rows this stage is responsible for, independent of Verify:

- **`own_channel`:** `getaglow.co` pages and subpaths; the company's `getaglow` LinkedIn, Instagram (`aglow_app`), Facebook, and X accounts; the company's Apple App Store and Google Play listings for the Aglow app.
- **`aggregator` / `ecommerce_review`:** app-store and directory/aggregator surfaces and any product/ecommerce/review pages present in the fixture, each Excluded under the correct code.
- **In-scope rows preserved:** the genuine third-party coverage (e.g. the Business News Australia and Startup Daily funding stories, trade-publication beauty-industry pieces) is **not** Excluded by any Filter heuristic — confirming Filter rejects own-channel/aggregator/ecommerce mass without touching real coverage. (Same-name *different-entity* rows — Aglow International the ministry, Aglow Outdoors, HomeAglow, Aglow Air — are Verify's `off_topic` job, not Filter's; Filter only Excludes them if they independently hit an own-channel/aggregator/ecommerce rule.)
- **Collapse:** any near-identical re-prints of the same Aglow story collapse to the earliest copy with the losers Excluded `duplicate`.

Because the brief mandates Autoevals and the Aglow set is a labelled precision/recall set, the deterministic Filter assertions live in Vitest fixtures; Autoevals scoring of the end-to-end precision/recall belongs to the LLM-driven stages (Verify/Classify), not to this stage's deterministic rules.

## Out of Scope

- **Exact-URL deduplication.** Handled at insert time during Search by a DB unique constraint (see the Search Stage PRD). There is no dedup *stage*; Collapse is the title pass only.
- **Entity-relevance / `off_topic` judgement.** A Result about a different entity sharing the name (the Aglow ministry, Aglow Outdoors, HomeAglow, Aglow Air) is Excluded by **Verify** as `off_topic` with `exclusion_detail = "LLM"` — not by Filter. Filter Excludes such a row only if it independently matches an own-channel/aggregator/ecommerce heuristic.
- **Time Slices and Published Date capture.** The 12-month query windows and the capture of each hit's `published_date` are Search-stage concerns (ADR 0005). Filter *consumes* the persisted Published Date to write `out_of_window`, but does not fetch or derive dates itself.
- **The Own Channel Classify backstop itself.** The LLM backstop that catches own-channel surfaces on the degraded name-only path (writing `own_channel` with `exclusion_detail = "LLM"`) lives in PRD 5 (Verify / Extract / Classify / Enhance). Filter defers to it; it does not implement it.
- **Content Type classification, Verification scoring, Extract, Enhancement, Sentiment, and the Summary.** All downstream of Filter; Collapse hands its winners on to them.
- **Resolve and the Negative Boost.** Filter consumes the Resolved Identity; it does not produce it, and it does not use the Negative Boost (a Verify input).
- **UI rendering of Excluded Results.** How the Excluded section is presented is the Web UI & SSE Delivery PRD's concern; Filter only sets `status`, `exclusion_code`, and `exclusion_detail`.

## Further Notes

- **Vocabulary discipline.** Nothing here is "dropped", "deleted", "filtered out", "merged", or "deduped". The verb for removal is **Excluded** (soft, with a reason). The title pass is **Collapse**; the insert-time URL constraint is **URL dedup**. `llm_excluded` is never a code; the catcher is recorded in `exclusion_detail` (`"LLM"` for the Classify backstop), never the `exclusion_code`.
- **Why Filter before Verify and Collapse before the LLM.** Filter and Collapse are cheap and deterministic; running them first means the paid, slow Verify/Extract/Enhance work only ever touches survivors, and the LLM never pays to process a duplicate copy. This ordering is a deliberate cost and latency decision.
- **Filter is independent of Name Collisions.** The heuristics need no knowledge of which other companies share the name; they kill the social/own-channel/app-store/review mass structurally. That independence is exactly why Filter (with Verify's positive check) is the primary noise rejector and the Negative Boost is only a sharpener for the confusable indexed-brand middle.
- **The Collapse pool is `included`-only — by design, not by accident.** This was an explicitly resolved ambiguity: allowing Excluded copies into the pool risked an earliest-published aggregator copy swallowing legitimate coverage and becoming the surviving row. Keeping the pool `included`-only forecloses that.
- **Anti-echo at this stage.** Filter writes no model text into any stored field and emits no model text onto any span — the heuristics are pure logic, so the prompt-injection echo channel simply does not exist here. `exclusion_detail` values are either null or a stable internal reference (`"of #42"`).
- **Aggregator and review host knowledge.** The `aggregator` and `ecommerce_review` rules lean on maintained host/shape knowledge. Keep that knowledge in a clearly-labelled, easily-extended place so new noise surfaces seen in evals can be added without touching the clustering or control-test logic.
- **Revisit trigger.** If eval precision shows a recurring own-channel surface that the heuristics miss on resolved (non-degraded) Jobs, prefer extending the heuristic's recognised platforms over leaning on the Classify backstop — the backstop is the degraded-path fallback, not a substitute for cheap deterministic rejection.
