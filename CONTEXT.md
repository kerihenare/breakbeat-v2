# Breakbeat

Finds third-party content about a company from the last 36 months via a background pipeline, and presents it as a reviewable list. Single context.

## Language

**Job**:
One run of the pipeline for one company, moving through a state machine from `pending` to a terminal state.
_Avoid_: task, search (a Job *contains* a Search stage)

**Resolved Identity**:
The company name plus *zero or more* own domains and scraped social handles, established per-Job by the Resolve stage; the anchor every later stage filters against. Also carries an optional **Brand Context** sourced from BrandFetch's Brand Context endpoint (`GET /v2/context/{domain}` — keyed by *domain*; a **brand-id-only anchor is first resolved to a domain via the Brand port**, so only a *true* name-only Job with no resolvable domain has none): tagline/mission/description and tags, plus the positioning fields Verify leans on — **value proposition, target audience segments, products & services**. Absence of brand context records a Warning but never fails the Job. Domains/handles are optional — a name-only input that resolves no homepage proceeds degraded (with a Warning), leaving Own Channel exclusion entirely to the Classify backstop. The zero-domain degraded path is *name-only*: a URL-provided Job whose homepage fetch fails keeps the given host as an own domain (provenance stays `url_provided`, Warning notes handles weren't scraped) — the fetch failure costs the handle scrape and name confirmation, never knowledge the user already supplied.
_Avoid_: company profile, match

**Name Collision**:
A *different* company that shares the target's name (Aglow International the ministry, Aglow Outdoors, HomeAglow), discovered at Resolve time via **Brand Search** and carried on the Resolved Identity as its own mini brand-context (one `/v2/context/{collisionDomain}` call each). **Best-effort: BrandFetch-indexed brands only** — never the bulk of real-world same-name noise (social posts, unrelated news, festivals, local orgs), which Brand Search has never heard of. Most targets surface a handful or none; failing to fetch them is a **Warning**, never a Job failure. They exist to be *contrasted against*, never confused with the target. The **target itself appears in its own Brand Search** and *must be de-selfed* out of the collision set before the Negative Boost is derived (match each hit against the anchor's resolved `brandId`, else registrable domain; name-only with no key → infer the top hit as target and Warn) — otherwise Verify would be primed to reject pages about the target.
_Avoid_: namesake, competitor (a collision is neither a rival nor in the same market — it just shares a name)

**Negative Boost**:
The contrast signal derived from the **Name Collisions** at Resolve time — the gist of how each collision differs from the target — carried on the Resolved Identity and consumed by **Verify** alongside the positive Brand Context. It is a **sharpener for the confusable indexed-brand middle** (HomeAglow, Aglow Air — real companies whose business-news coverage could be mistaken for the target's), *not* the primary rejection path. The bulk of the noise is rejected upstream and independently: **Filter heuristics** (`own_channel`, `aggregator`, `ecommerce_review`) kill the social/own-channel/app-store/review mass, and **Verify's positive check** ("is this about a beauty-membership startup?") rejects unrelated news, festivals, and the ministry on positive grounds *whether or not* the collision was known. Its exact computed shape is a Resolve-stage implementation detail; the domain fact is that Verify weighs *both* a positive "is this the target?" signal and a negative "...or is it one of these known look-alikes?" signal.
_Avoid_: blocklist (it's not a hard exclude list — it informs a judgement), disambiguation (too broad)

**Own Channel**:
A surface the company *controls* — its domains, or its named accounts/profiles on third-party platforms (its LinkedIn page, its X handle, its Substack). Content on a controlled surface is always excluded. Control, not authorship, is the test: a wire-distributed press release or a company-bylined guest post sits on *someone else's* editorial surface and is in scope; content *about* the company on any platform is in scope.
_Avoid_: own site (too narrow — misses social accounts); "authored by the company" (wrong test — it would exclude press releases, a required Content Type)

**Result**:
One search hit returned by the Search stage, stored permanently with a `status` of `included` or `excluded`. Born `included`; Exclusion is the only transition. Scoped to its Job — re-runs produce fresh Results. Search's primary source is Tavily, run as a few broad natural-language queries by default and escalating — when Tavily returns fewer than a threshold of hits — to the full Angle Query set plus a couple of type-targeted queries for the genuinely rare Content Types (podcast, newsletter), which broad and angle queries under-fish. The same low-yield escalation trigger also fires the **Anthropic web-search backstop** (`web_search` tool): it is *not* always-on (a parallel Anthropic search against a rich Tavily yield mostly produces duplicates we pay for then URL-dedup away), but a recall rescue for thin runs. Recall is built from more angles, not from per-content-type slicing: the type-targeted escalation queries are the narrow exception, aimed only at the long-tail types the brief requires but Tavily won't volunteer. Search returns title + snippet; the **Extract** step pulls full page text (via Tavily, server-side) for the Results that survive the snippet gates, feeding the shared full-text re-pass (re-verify + re-classify + enhance) — we never fetch a Result page ourselves. ("Fetch" stays reserved for the one real HTTP fetch we make: the Resolve homepage fetch.)
_Avoid_: hit, item, link; "fetched" for the Extract step (say **Extract** — Tavily retrieves the page, we don't)

**Exclusion**:
Marking a Result `excluded` with a machine-groupable `exclusion_code` (closed set: `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`, `off_topic`) plus a nullable human-readable `exclusion_detail` ("of #42", "LLM"). Codes record *why*, never which stage caught it — the Classify backstop writes the same vocabulary as the heuristics, with `exclusion_detail = "LLM"` recording the catcher (never free text from the model; that's the prompt-injection echo channel). `off_topic` means the Result is about a different entity, not the target company; it is written by the Verify stage with `exclusion_detail = "LLM"` — the same "records the catcher, not the stage" convention. `out_of_window` (Result's **Published Date** older than the 36-month horizon) is written by **Filter** as a cheap deterministic date-arithmetic rule alongside its other heuristics — a NULL date is never Excluded `out_of_window`. Soft — never a delete; nothing is dropped except by never being returned by Search.
_Avoid_: drop, delete, filter out (as a verb for the action); `llm_excluded` as a code (it names the stage, not the reason)

**Match Score**:
The 0–100 ordering key for the results list, and the number the UI shows on every row. It is **Verify's entity-relevance confidence** — how confident we are the page is about the *target*, not a Name Collision — the continuous signal behind the **Verification** bucket (the same judgement at two resolutions: the score orders, the bucket labels). It ratchets through three resolutions: **provisional** (Tavily's own relevance score, so streaming rows sort sensibly before any Verify), then **interim** (Verify's snippet gate), then **final/authoritative** (Verify's full-text re-pass). Each replaces the last. The list always sorts by Match Score descending. Match Score is *not* importance or prominence ("coverage that matters" is a separate axis we do not score today); trust, not popularity, is the sort key.
_Avoid_: relevance score (ambiguous — Tavily's query-relevance is only the provisional fallback, never what we display once Verify has run), rank

**Verification**:
A per-Result entity-relevance judgement against the Resolved Identity's Brand Context *and* its **Negative Boost** (the positive "is this the target?" and the negative "...or a known look-alike?" weighed together). Verify runs in **two passes**: a cheap **snippet gate** (title, snippet, URL) *before* Extract that drops obvious off-topic Results and sets an interim Match Score, and a **full-text re-pass** *after* Extract — symmetric to Classify's re-pass — that sets the final, authoritative Match Score and can still Exclude `off_topic` a look-alike whose *snippet* fooled the gate but whose *full text* gives away (HomeAglow's funding, Aglow Air's). Stored as `verification_status` (`verified | uncertain`, nullable). Both `verification_status` and the Exclude decision are **derived purely from Match Score** (no independent verdict field) via two configured, Aglow-tuned cutoffs: below `T_exclude` → Excluded (`off_topic`, `exclusion_detail = "LLM"`); between the cutoffs → `included` + `uncertain`; at/above `T_verified` → `verified`. The same mapping runs at both passes, but the snippet gate's `T_exclude` is deliberately *more lenient* than the full-text pass's (the snippet gate stops obvious waste; the stricter call is made on the actual page). The continuous confidence behind this bucketing is the Result's **Match Score**. Only the **full-text re-pass** ever writes `verification_status` — the snippet gate is a cost gate, not the authoritative verdict — so a Result that passed the snippet gate but **failed Extract** stays `included` and reads "Unverified" (NULL status) while still showing its interim Match Score: a NULL status does *not* imply a NULL score. "Unverified" is a *reading* of NULL (Verify didn't run, was not configured, or no brand context was available), not a stored value — mid-Job, NULL just means the Result has not yet reached Verify, and the UI labels it that way.

**Collapse**:
Deduplicating near-identical Results on normalized title; runs at the tail of the Filter stage, over still-`included` Results only (an already-Excluded copy never competes or wins). The winner is the earliest-published copy, losers are Excluded as duplicates. Dated copies cluster within 14 days of the cluster's earliest member; a date-unknown copy joins only when the group is unambiguous (one cluster) — with multiple clusters it stays included rather than being guessed into a story. Two guards bias toward *under*-collapsing: a title must be **distinctive** (≥ a configured minimum of meaningful tokens after removing the company name/stop-words) to anchor a cluster at all — a generic headline or bare company name never collapses — and a cluster collapses only when it **spans ≥2 distinct source domains** (the wire-syndication signature). A silently-Excluded real story is a trust failure; a visible near-duplicate is a minor annoyance. There is no dedup *stage*: exact-URL dedup happens at insert time during Search (DB unique constraint).
_Avoid_: merge, dedupe (say "URL dedup" for the insert-time constraint, "Collapse" for the title pass)

**Content Type**:
The brief's seven categories verbatim (news article, trade publication, blog post, press release, major social post, newsletter, podcast) plus `other` as the explicit escape hatch. Assigned only by the Classify stage and nullable — a failed classify leaves Results "unclassified" (never defaulted to `other`, which is reserved for genuine type ambiguity) under `done_with_warnings`. "Unclassified" is a *reading* of NULL at a terminal state, not a stored value: mid-Job, NULL just means awaiting classification, and the UI labels it that way.

**Enhancement**:
A per-Result analysis produced by the **Enhance** stage from the Extracted full page text, adding `sentiment` and a short per-Result takeaway. It is part of the post-Extract full-text re-pass (shared with re-verify and re-classify), so it runs only on Results that survive the snippet gates and Extract. Only still-`included` Results are Enhanced. A failed Enhance is a **Warning**, never a Job failure — the row still shows, just without sentiment.
_Avoid_: analysis (too broad), enrichment

**Sentiment**:
The coverage's *stance toward the target company* — `positive | neutral | negative` — produced per-Result by **Enhance** from the Extracted text, judged from how the *company* is portrayed, not the article's overall mood. A media-monitoring signal ("is this good or bad for us?"), so an industry-downturn piece that praises the target is `positive`, and a glowing piece that mentions the target only as a cautionary aside is not. Nullable (Warning if Enhance fails), and only on `included` Results.
_Avoid_: tone, article sentiment (those read the whole piece; we read the stance toward the target)

**Summary**:
A single Job-level digest produced by the **Summarise** stage at the tail of the pipeline, over the snippets of the surviving (`included`) Results. This is the "Enhancement details summary" the Result page shows. One per Job; a failed Summarise is a **Warning**.
_Avoid_: result summary (that's the per-Result Enhancement takeaway, a different thing)

**Warning**:
A recorded note that a stage completed its purpose *partially* (some search queries failed, no homepage resolved, classify errored leaving Results unclassified). A stage failure fails the Job only when it leaves *nothing to show* — meaning *no population to judge* (all Search queries fail), **not** a judged population that narrowed to zero. A Job whose Search returned Results that were then all Excluded is an honest empty finding ("no in-scope coverage"), not a failure: it ends `done`/`done_with_warnings` (Summarise's empty-case Warning flags it). A total Classify failure is still a Warning — the reviewable list is the Job's purpose, and it exists, just untyped and unaudited ("own-channel backstop did not run"). Terminal state is `done_with_warnings` iff the Job's warning list is non-empty.
_Avoid_: error (errors fail the job), partial failure (a Warning is a partial *success*)

**Angle Query**:
A search query phrased around an event type ("X funding", "X acquisition") rather than a content type — recall comes from more angles, not more slices.

**Time Slice**:
One 12-month `start_date`/`end_date` window of a query; applied only to news and press-release *angle queries*, where dates are reliable. A Time Slice is a **recall** tactic (fish each 12-month window across the 36-month horizon for date-reliable angles) — it is *not* the recency-exclusion mechanism. Recency *precision* is enforced separately by Filter's **`out_of_window`** rule.
_Avoid_: treating Time Slices as the out-of-window filter (they constrain the query, not the Result), or applying them to date-unreliable types (blog, social, podcast, newsletter), which would wrongly narrow recall at the source.

**Published Date**:
A Result's publication date, captured (nullable) by Search from Tavily's hit metadata at insert. The single source for both **Collapse**'s 14-day clustering / earliest-wins and the date the UI shows on every row. A NULL Published Date is never guessed and never Excluded `out_of_window` — symmetric with Collapse's "an undated copy isn't guessed into a story."

## Relationships

- A **Job** belongs to one company and produces many **Results**; the company row is the durable anchor — the **disambiguated domain/brand-id** when the user picked one at input (autocomplete or the options list), or raw name-only as the explicit degraded fallback. Disambiguation happens *once, at input*, and is frozen into the Job; "re-runs resolve fresh" means Resolve re-fetches the live brand/context/collisions for that anchor, **never** re-chooses which company it is
- A **Job**'s Resolve stage produces one **Resolved Identity** (job-scoped); Search, Filter, Verify, and Classify all consume it
- A **Resolved Identity** carries zero or more **Name Collisions**, from which a **Negative Boost** is derived; **Verify** consumes both the positive Brand Context and the Negative Boost
- A **Collapse** Excludes all but one of a set of near-duplicate still-`included` **Results**
- An `included` **Result** is assigned a `verification_status` and an authoritative **Match Score** by the **Verify** stage (before which the Match Score is provisional, from Tavily); the list sorts by Match Score descending
- An `included` **Result** is assigned one **Content Type** by the Classify stage — or none, if classify fails (**Warning**)
- An `included` **Result** is given an **Enhancement** (sentiment + takeaway) by the Enhance stage, which consumes the Extracted full page text (in the shared post-Extract re-pass)
- A **Job** produces one **Summary** (Summarise stage), over the snippets of its surviving Results
- A **Job** accumulates **Warnings**; any Warning turns `done` into `done_with_warnings`

## Observability

Cross-cutting infrastructure vocabulary, not product domain — but the words are load-bearing in the same way. Decided in `docs/adr/0004-otel-instrumentation.md`.

**Job Trace**:
The single OpenTelemetry trace covering one **Job**'s pipeline run. The pipeline runs in one BullMQ job, stages in-process and sequential, so the whole run is one trace. The enqueue (on `breakbeat-web`) and the execution (on `breakbeat-worker`) are *different processes decoupled in time*: enqueue injects `traceparent` into the job data, and the worker opens a **new root span** (`job.pipeline`) carrying a **span link** back — never a *continued* trace, which would fold dead queue-wait (and nonsensical re-run timing) into the trace's duration.
_Avoid_: request trace (there is no request — the unit is the Job), continued trace (we link, not nest)

**Stage Span**:
One span per pipeline **stage** — `resolve | search | filter | analyze | summarise` — carrying *aggregate* attributes (`results.in`/`out`, `excluded.{code}` counts, `tokens.total`, `cost.total`, `warnings`). The PRD-5 domain stages (Verify / Classify / Enhance) share a single **`analyze`** Stage Span: distinct in their *fields and semantics* but executing as snippet-gate → Extract → one fused Haiku call rather than separable time-ordered stages, so one span owns them and the fused call is one child span (ADR 0003/0004); Extract is a child span under `analyze`, never its own Stage Span. Beneath it, child spans exist **only for real external calls** — each Haiku call (with GenAI semantic conventions + cost), each Tavily/BrandFetch call. The *interesting minority* of per-**Result** outcomes (an **Exclusion**, a **Verification** flip at full-text, a per-Result **Warning**) are **span events** on the Stage Span; happy-path per-Result work produces no span and no event — it lives in the aggregates and the metrics.
_Avoid_: span-per-Result (a Job with many Results would mint thousands of spans and make the trace unreadable — that detail is metrics' job)

**Signal Split**:
Three signals, two backends. **Traces + logs + metrics** go to **otel-lgtm** (Grafana Tempo / Loki / Mimir) via OTLP through its bundled Collector; **errors** go to **Bugsink** via `@sentry/nestjs` with tracing disabled (Bugsink cannot ingest spans). They correlate by `trace_id`. A **Warning is never an error**: it is an `OK` span with a span event, never a span-status `ERROR`, and never a Bugsink issue — only an unexpected throw or a Job-failing condition is. The same anti-echo rule as **Exclusion**'s `exclusion_detail` applies to telemetry: **no raw prompt, completion, or scraped page text on any span or log** — counts, model id, finish reason, cost, and validated structured output only.
_Avoid_: marking Warning spans `ERROR` (it re-breaks the domain — error-rate must mean *failures*); putting `job.id`/company/URL on a *metric* label (cardinality bomb — that drill-down is the Job Trace's job)

## Example dialogue

> **Dev:** "The heuristic pass dropped a bunch of Reddit links."
> **Domain expert:** "Nothing is *dropped* — they're **Excluded** as aggregators, with the reason on the row. They'll show in the collapsed excluded section."
> **Dev:** "And the company's LinkedIn posts?"
> **Domain expert:** "**Own Channel**, Excluded. But a journalist's LinkedIn post *about* the company is in scope — Own Channel is about the author, not the platform."

## Flagged ambiguities

- "drop" was used for both *never returned* and *filtered out* — resolved: filtered-out Results are **Excluded** (soft, with reason); only content never returned by Search is absent.
- "own site" vs **Own Channel** — resolved: exclusion covers the company's accounts on third-party platforms, not just its domains, and never third-party content on those platforms.
- **Own Channel** as "authored by the company" contradicted the brief — press releases are company-authored by definition yet a required Content Type. Resolved: the test is *control of the surface*, not authorship; wire releases and guest posts are in scope.
- "fetched" implied Result pages are retrieved — they never are (out of scope). Resolved: Results are *returned* by Search; "fetch" names only the Resolve homepage fetch.
- Whether an Excluded copy could win a **Collapse** (earliest-published aggregator copy swallowing legitimate coverage) — resolved: the Collapse pool is `included` Results only.
- **Negative Boost** was framed as rejecting "the bulk of the noise" — wrong: collisions are best-effort (BrandFetch-indexed brands only), so negative boost only sharpens the confusable indexed-brand middle. Resolved: Filter heuristics + Verify's *positive* check are the primary rejectors; negative boost is a sharpener.
- Dedup appeared as both a pipeline stage and an insert-time constraint — resolved: no dedup stage exists; URL dedup fires at insert (Search), title-**Collapse** runs at the tail of Filter, before Verify and Classify (so the LLM never pays for duplicates).
- "nothing to show → `failed`" was ambiguous between *no population to judge* and *judged population narrowed to zero* — resolved: only the former fails the Job. An all-Excluded Job (Search returned hits, all Excluded) is an honest empty finding, ending `done`/`done_with_warnings` with a distinct empty-state UI, never `failed`.
- `out_of_window` was orphaned — Search deferred it "downstream", Filter disclaimed it as "Search's concern", Verify writes only `off_topic`, so no stage wrote it. Resolved: **Search captures a nullable Published Date** from Tavily metadata; **Filter writes `out_of_window`** as a deterministic date-arithmetic rule (NULL date never Excluded). Time Slices stay a recall tactic, not the recency filter. (See ADR 0005.)
- OTel instrumentation was framed as an "OTLP emitter" on `@envelop/opentelemetry` in GraphQL Yoga — wrong stack, imported from another project; Breakbeat is NestJS/Express with a BullMQ pipeline and no GraphQL. Resolved: NestJS/BullMQ-native instrumentation with one **Job Trace** per Job (see Observability and `docs/adr/0004-otel-instrumentation.md`).
