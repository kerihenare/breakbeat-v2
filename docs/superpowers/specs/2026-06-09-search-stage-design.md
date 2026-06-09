# Search Stage — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/03-search-stage.md`
**ADRs:** 0002 (Search source model), 0004 (OTel / process model), 0005 (recency window split)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`), Resolve Stage (`docs/superpowers/specs/2026-06-09-resolve-stage-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 3. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADRs 0002/0005 and is not
> re-litigated here. This document fixes the domain value objects, the three ports, the pure query
> builder + escalation gate, the stage orchestration, the `results`-write contract, and the test
> strategy. It assumes Foundation provides the `Stage` port, `RunContext`, `Job`, `JobFailedError`,
> the `StageRunner`, the Drizzle `results` table (reserved, with the `(job_id, normalized_url)`
> unique index and the born-`included` default), and the two NestJS entrypoints; and that Resolve
> populates `ctx.resolvedIdentity` with the immutable `ResolvedIdentity` before Search runs.

---

## Goal

Given the `ResolvedIdentity` for a Job, bring a population of third-party coverage Results into
existence — each born `included`, each carrying a **provisional Match Score** and a nullable
**Published Date** — by issuing a few broad Tavily queries first and **escalating only when the
broad yield is thin** (the single low-yield gate of ADR 0002) to the Angle Query set, a couple of
type-targeted long-tail queries, *and* the Anthropic web-search backstop. Search returns **title +
snippet only**, never fetches a Result's page, runs **no dedup stage** (insert-time URL-dedup is a
database unique constraint), and leaves every precision judgement to the stages built for it. It
fails the Job only when *all* queries against *all* attempted sources fail.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Stage shape | A `SearchStage implements Stage` (Foundation's port), registered **second** in the worker's `StageRunner` (after `ResolveStage`) |
| How Search reads the identity | Reads the read-only `ctx.resolvedIdentity` slot Resolve populated; never re-derives or re-chooses the company |
| Source model (ADR 0002) | **Two** sources behind one gate: Tavily Search (always run) + Anthropic `web_search` (escalation backstop). Tavily Research API **not wired** (deferred) |
| Query builder | A **pure** function over `ResolvedIdentity` + a `now` instant + config → a `QueryPlan` (broad / angle / type-targeted sets). No I/O, fully assertable |
| Escalation gate | A **pure** decision over the count of **distinct Results inserted by the broad set** (post-URL-dedup) vs a single scalar threshold; runs once, after the broad set has fully inserted |
| Time Slices (ADR 0005) | 12-month `start_date`/`end_date` windows applied **only** to news / press-release angle queries across the 36-month horizon; all other queries unsliced |
| Provisional Match Score | Tavily relevance scaled to the 0–100 ordering key; backstop hits take a fixed low floor that sorts beneath every Tavily-scored row. Search writes **no `verification_status`** |
| Published Date | Captured nullable from Tavily hit metadata, persisted on the Result at insert; **never** used to Exclude at Search time (that is Filter's `out_of_window`, ADR 0005) |
| URL dedup | The `(job_id, normalized_url)` **unique constraint** Foundation reserved; inserts use `onConflictDoNothing`. No dedup stage, no scan-for-duplicates code path |
| Adapters | `@tavily/core` behind `TavilySearchPort`; the Anthropic SDK `web_search` tool behind `WebSearchBackstopPort`; the Drizzle `results` writer behind `ResultRepository` |
| Unit tests | **Vitest** with fakes for all three ports (pure builder, gate, score; orchestration: every escalation/failure path) |
| Adapter tests | **Vitest** contract tests with the Tavily client and the Anthropic SDK stubbed (request shape, normalization, failure → benign `{ hits: [], failed: true }`) |
| Repository test | **Vitest** integration against real Postgres via **Testcontainers** (born-`included`, insert-time dedup, provisional ordering) |
| OTel spans | **Out of scope here** — PRD 8 owns span emission. Search only upholds the *facts* a span will read (counts, escalation flag, per-call outcomes) and the **anti-echo** discipline |

---

## Architecture

Search is a vertical slice and a deep module behind a simple interface (`Stage.run`). It lives
inside Foundation's hexagonal layering; the dependency arrow points inward
(`interface → application → domain`, with `infrastructure` implementing `application`'s ports).
The query builder, escalation gate, URL normalizer, and provisional-score map are pure **domain**;
the three ports and the orchestration shell are **application**; the Tavily / Anthropic / Drizzle
adapters are **infrastructure**; DI wiring is **interface**.

### Source layout (new files unless marked *modify*)

```
src/
  domain/search/
    normalize-url.ts              # normalizeUrl() — pure dedup-key normalization
    time-slice.ts                 # TimeSlice type + buildTimeSlices() — pure 12-mo windows over 36 mo
    search-query.ts               # SearchQuery + SearchQueryKind value types
    query-plan.ts                 # QueryPlan type + buildQueryPlan() — pure builder over ResolvedIdentity
    escalation.ts                 # shouldEscalate() — pure low-yield decision (post-dedup count)
    provisional-score.ts          # tavilyProvisionalScore() + BACKSTOP_PROVISIONAL_SCORE floor
    search-warnings.ts            # SEARCH_WARNING closed set + builders
  application/search/
    ports/
      tavily-search.port.ts       # TavilySearchPort + NormalizedHit + SearchSourceResult + token
      web-search-backstop.port.ts # WebSearchBackstopPort (Anthropic web_search) + token
      result-repository.port.ts   # ResultRepository (insert-included w/ onConflictDoNothing) + token
    search-config.ts              # SearchConfig type (threshold, horizon, limits) + token
    to-result-insert.ts           # pure: NormalizedHit + source → ResultInsert (score, normalized url, date)
    search.stage.ts               # SearchStage implements Stage — the impure orchestration shell
  infrastructure/
    tavily/
      tavily.config.ts            # API key + timeout (from @nestjs/config)
      tavily-search.adapter.ts    # TavilySearchPort over @tavily/core; failure → { hits: [], failed: true }
    anthropic/
      web-search-backstop.adapter.ts # WebSearchBackstopPort over @anthropic-ai/sdk web_search tool
    persistence/
      schema.ts                   # *modify* — define the result content columns Search writes
      result.repository.ts        # ResultRepository impl over Drizzle (onConflictDoNothing dedup + counts)
  app-worker.module.ts            # *modify* — register adapters + repo, SearchStage SECOND in StageRunner
```

---

## Domain

All domain types are immutable and contain **no I/O**. They are the richest unit-test target.

### `normalizeUrl(url): string` — the dedup key

Pure normalization producing the value stored in `results.normalized_url` and compared by the
unique constraint: lowercase host, strip scheme, leading `www.`, default ports, the trailing
slash, and the URL fragment; **preserve the path and a sorted, tracking-stripped query string**
(two genuinely different articles on one host must not collide). Tracking params
(`utm_*`, `gclid`, `fbclid`, `ref`) are dropped. A string that does not parse as a URL is
lowercased and trimmed verbatim (degrade, never throw). This is the *only* dedup mechanism Search
owns; near-duplicate title **Collapse** is Filter's, not Search's.

### `TimeSlice` + `buildTimeSlices(now, horizonMonths, windowMonths)` — ADR 0005

```ts
type TimeSlice = { readonly startDate: string; readonly endDate: string }; // ISO yyyy-mm-dd
```

Pure. Returns consecutive non-overlapping windows tiling the horizon backward from `now`
(default 3 × 12-month windows over 36 months). `now` is passed in (never read from the clock
inside the function) so the plan is deterministic in tests. Time Slices are a **recall** tactic:
they shape *which window a query fishes*, never which Result is kept.

### `SearchQuery` + `SearchQueryKind`

```ts
type SearchQueryKind = "broad" | "angle" | "type_targeted";
type SearchQuery = {
  readonly text: string;
  readonly kind: SearchQueryKind;
  readonly timeSlice: TimeSlice | null; // set only on news/press-release angle queries
};
```

### `QueryPlan` + `buildQueryPlan(identity, now, config)` — the pure builder

```ts
type QueryPlan = {
  readonly broad: readonly SearchQuery[];
  readonly angle: readonly SearchQuery[];        // event-type (unsliced) + news/PR (sliced ×windows)
  readonly typeTargeted: readonly SearchQuery[]; // podcast / newsletter long-tail
};
```

Emits, in order of effort:

- **broad set** — a few broad natural-language queries from `identity.companyName` and, when
  present, a primary `ownDomain` and a positioning term from `brandContext` (value proposition /
  tagline / first tag). A name-only degraded identity (no domain, no Brand Context) still yields a
  usable broad set from the name alone (PRD story 22).
- **angle set** — event-type queries (`"<name> funding"`, `"<name> acquisition"`,
  `"<name> partnership"`, …) emitted **unsliced**; *plus* the news and press-release angles
  (`"<name> news"`, `"<name> press release"`) emitted **once per Time Slice window** with
  `start_date`/`end_date` set. Recall comes from *more angles, not more per-Content-Type slices*.
- **type-targeted set** — the deliberate narrow exception: `"<name> podcast"`, `"<name> newsletter"`
  — the genuinely rare Content Types broad and angle queries under-fish.

The function is pure (`now` and config injected), so the entire query plan is assertable in a unit
test. The builder does **not** decide what runs — the stage runs the broad set always and the
angle + type-targeted sets only on escalation.

### `shouldEscalate(distinctBroadResults, threshold): boolean` — the gate

Pure. `distinctBroadResults < threshold`. The argument is the count of **distinct Results inserted
by the broad set** (post-URL-dedup), *not* raw hits returned — overlapping broad queries return the
same story many times, and counting raw hits would let duplicates mask a thin run and suppress the
escalation a borderline company most needs. `threshold` is a single scalar from config.

### `tavilyProvisionalScore` + `BACKSTOP_PROVISIONAL_SCORE` — the provisional ratchet rung

```ts
const BACKSTOP_PROVISIONAL_SCORE = 0; // distinctly below any real Tavily score
function tavilyProvisionalScore(relevance: number | null): number; // → clamp(round(rel*100), 1, 100)
```

Match Score is the 0–100 ordering key (`CONTEXT.md`). A Tavily hit maps its native 0–1 relevance to
`max(1, round(relevance * 100))` (a returned hit always scores ≥ 1); a backstop hit, having no
comparable native score, takes the fixed floor `0` so it sorts **beneath** every Tavily-scored row
until Verify ratchets it. This is honest (a backstop hit is the least-provenanced rescue) and
transient (Verify's interim score replaces it within seconds — PRD 7's reflow tolerates a rescue
hit *climbing*, never a mid-band guess visibly dropping). Search writes the **provisional** rung
only; Verify writes interim then final, and Search never writes `verification_status`.

### `search-warnings.ts` — closed Warning set

Search's Warnings reuse Foundation's `Warning` value object (`{ type, message }`); the `type` is
drawn from a closed set namespaced under `search.`:

```ts
const SEARCH_WARNING = {
  queriesPartiallyFailed: "search.queries_partially_failed", // some queries/sources failed; partial sweep returned
  backstopFailed: "search.backstop_failed",                  // escalation backstop call failed (Tavily still produced)
} as const;
```

Each builder returns a `Warning` carrying **counts only** — never raw query text, snippet text, or
a provider error body (anti-echo). A *Job-failing* total wipeout is **not** a Warning: it is a
`JobFailedError` (below).

---

## Application

### `SearchConfig`

```ts
type SearchConfig = {
  lowYieldThreshold: number; // distinct broad Results below which escalation fires (~10, Aglow-tuned)
  horizonMonths: number;     // 36
  windowMonths: number;      // 12
};
```

Injected (never a literal scattered through code). The threshold starts at **~10 distinct Results**
and is tuned against the Aglow set (≈14 genuine includes); a single scalar governs both the Angle
Query escalation and the Anthropic backstop — the one auditable "how hard did we fish this Job?"
decision (ADR 0002).

### Ports

```ts
// tavily-search.port.ts — primary recall, always run
type NormalizedHit = {
  url: string;
  title: string;
  snippet: string;
  relevance: number | null;     // Tavily's native 0–1 score (provisional Match Score source)
  publishedDate: string | null; // nullable, from Tavily hit metadata (ADR 0005)
};
type SearchSourceResult = {
  hits: NormalizedHit[];
  failed: boolean;              // true ⇒ this call failed as a transport/quota error (Warning-grade)
};
interface TavilySearchPort {
  search(query: SearchQuery): Promise<SearchSourceResult>; // never throws; failure → { hits: [], failed: true }
}
const TAVILY_SEARCH_PORT = Symbol("TavilySearchPort");

// web-search-backstop.port.ts — escalation BACKSTOP only (Anthropic web_search)
interface WebSearchBackstopPort {
  search(companyName: string): Promise<SearchSourceResult>; // same normalized shape; relevance/date null
}
const WEB_SEARCH_BACKSTOP_PORT = Symbol("WebSearchBackstopPort");

// result-repository.port.ts — the insert-time URL-dedup writer
type ResultSource = "tavily" | "web_search_backstop";
type ResultInsert = {
  url: string;
  normalizedUrl: string;
  title: string;
  snippet: string;
  matchScore: number;           // provisional only
  publishedDate: string | null;
  source: ResultSource;
};
interface ResultRepository {
  // Inserts born-`included` Results, skipping rows that violate (job_id, normalized_url).
  // Returns the number of rows ACTUALLY inserted (post-dedup) — the escalation gate's input.
  insertIncluded(jobId: string, results: readonly ResultInsert[]): Promise<number>;
}
const RESULT_REPOSITORY = Symbol("ResultRepository");
```

**Failure translation is the adapters' job.** Both source ports return
`{ hits: [], failed: true }` on transport/quota error — nothing escapes as a throw, so the
orchestration shell branches on values and decides Warning-vs-fail from *how many calls succeeded*,
not from catching exceptions. `insertIncluded` returning the post-dedup inserted count is what makes
the gate count **distinct** Results without a separate scan (the unique constraint does the dedup;
`onConflictDoNothing` makes the inserted-row count equal to distinct-new-rows).

### `toResultInsert(hit, source): ResultInsert` — pure mapping

Pure. Maps a `NormalizedHit` + its source to a `ResultInsert`: `normalizedUrl = normalizeUrl(url)`;
`matchScore = source === "tavily" ? tavilyProvisionalScore(relevance) : BACKSTOP_PROVISIONAL_SCORE`;
`publishedDate` passed through (nullable). No `verification_status`, no content type, no exclusion —
Search writes the provisional score and the raw coverage facts, nothing else.

### `SearchStage implements Stage` — the orchestration shell

The only impure unit. `name = "search"`. `run(ctx)`:

1. Read `identity = ctx.resolvedIdentity` (Resolve populated it). Build
   `plan = buildQueryPlan(identity, this.clock.now(), this.config)`.
2. **Broad set (always).** Run every `plan.broad` query through `TavilySearchPort` (concurrently,
   each individually failure-tolerant). For each result: `insertIncluded(jobId, hits.map(toResultInsert))`.
   Track `succeededCalls`, `failedCalls`, and `distinctBroad` (sum of `insertIncluded` return values).
3. **Gate.** `escalate = shouldEscalate(distinctBroad, this.config.lowYieldThreshold)`. The gate runs
   **after the broad set has fully inserted and URL-dedup has settled**, never mid-sweep.
4. **Escalation (only if `escalate`).** Run `plan.angle` + `plan.typeTargeted` through Tavily and, in
   parallel, `WebSearchBackstopPort.search(identity.companyName)`. Insert all hits (the same
   `onConflictDoNothing` absorbs any URL the broad sweep already inserted — story 25). Accumulate the
   same call counters; a failed backstop call → `backstopFailed` Warning (Tavily still produced).
5. **Outcome.** If `succeededCalls === 0` (every attempted call across every attempted source failed)
   → `throw new JobFailedError(...)` — the only "nothing to show" case. Else if `failedCalls > 0` →
   `ctx.recordWarning(queriesPartiallyFailed(failedCalls))` and **return normally**. A sweep that
   succeeds but returns zero Results is an honest empty finding, **not** a failure (`CONTEXT.md`).
6. Search **never** sets `ctx.resolvedIdentity`, never writes `verification_status`, never Excludes,
   never fetches a page.

Concurrency: broad queries run via `Promise.all`; escalation Tavily queries + the backstop run via
`Promise.all`; each call is individually failure-tolerant so one bad query never sinks the sweep.

---

## Infrastructure

### Tavily Search adapter (`tavily-search.adapter.ts`)

Wraps `@tavily/core`. Owns all client specifics: API key from `TAVILY_API_KEY`, an
`AbortController`/timeout, and translation of the `SearchQuery` into the client's parameters —
crucially mapping a `timeSlice` to the client's `startDate`/`endDate` (or `days`) date parameters.
Maps each client hit to `NormalizedHit` (`url`, `title`, `snippet` from content/snippet,
`relevance` from the client's `score`, `publishedDate` from `published_date`/`publishedDate`
metadata where present, else `null`). On non-2xx, quota, network error, or timeout returns
`{ hits: [], failed: true }` — a Warning-grade failure, never a throw. Nothing above the port knows
the `@tavily/core` shape.

### Anthropic web-search backstop adapter (`web-search-backstop.adapter.ts`)

Wraps the `@anthropic-ai/sdk` `web_search` server tool. Invoked **only** when the stage's gate
authorised it (the adapter does not decide; the stage does). Issues one `messages.create` with the
`web_search` tool around the company name, harvests the tool's result URLs/titles/snippets into
`NormalizedHit` (`relevance: null`, `publishedDate: null` — Anthropic gives neither natively), and
emits GenAI call metadata (model id, token usage, finish reason — for PRD 8's child span) without
ever putting raw model text or query completions into a persisted column or a future span attribute
(anti-echo). On error returns `{ hits: [], failed: true }`.

### `results` content columns + repository (`schema.ts` *modify*, `result.repository.ts`)

Foundation reserved `results` with the load-bearing invariants — `status` enum `included | excluded`
defaulting to `included`, the closed `exclusion_code` set, the nullable stage columns (`match_score`,
`verification_status`, `content_type`, `sentiment`, `takeaway`), and the **`(job_id, normalized_url)`
unique index**. Search **defines the coverage-content columns it writes** (verify against Foundation's
actual `schema.ts` first; add only what is missing via a `drizzle-kit` migration):

- `url` text (the canonical URL shown/linked), `normalized_url` text (the dedup key — already part of
  the unique index Foundation created), `title` text, `snippet` text,
- `published_date` date **nullable** (ADR 0005 — the single source for Collapse's date arithmetic,
  Filter's `out_of_window`, and the UI date; never used to Exclude at Search time),
- `source` enum `tavily | web_search_backstop` (provenance for telemetry / debugging),
- `match_score` integer (already reserved) — Search writes the **provisional** value only.

`ResultRepository.insertIncluded` inserts born-`included` rows with
`.onConflictDoNothing({ target: [results.jobId, results.normalizedUrl] })` and returns the number of
rows actually inserted (Drizzle's returning row count). This is the entire dedup mechanism — there is
no scan-for-duplicates code path. A re-run is a new Job id with its own rows (immutable history).

### DI wiring (`app-worker.module.ts` *modify*)

Register the Tavily adapter (→ `TAVILY_SEARCH_PORT`), the Anthropic backstop adapter
(→ `WEB_SEARCH_BACKSTOP_PORT`), the Drizzle `ResultRepository` (→ `RESULT_REPOSITORY`), and a
`SearchConfig` provider from `@nestjs/config`. Construct `SearchStage` from the three ports + config
+ Foundation's `Clock`, and register it **second** in the `StageRunner` ordered list (after
`ResolveStage`). `.env.example` gains `TAVILY_API_KEY`, `TAVILY_TIMEOUT_MS`, `ANTHROPIC_API_KEY`,
`SEARCH_LOW_YIELD_THRESHOLD`. (The Anthropic client is a *Search* dependency — note that Resolve has
**no** Anthropic dependency, ADR 0001; the two stages do not share it.)

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, the `search` Stage Span, per-call child spans, and Warning span events are **PRD 8's**
to build (ADR 0004). Search's obligations are the *facts* those spans will read and the discipline
they must not violate:

- The aggregatable facts a future `search` span needs are all derivable from the stage's run:
  `results.out` (rows inserted), broad/angle/type-targeted query counts, whether escalation fired,
  per-call success/failure, and the Warning list. No per-Result span is designed in (per-Result
  outcomes that matter are *Exclusions* — and Search Excludes nothing).
- Each Tavily and Anthropic call is the unit that will become a child span; the adapters surface
  per-call metadata (latency; for Anthropic, model id / token usage / finish reason / derived cost).
- A failed query is a span-event **Warning** (`OK` status), never an `ERROR` — Search recording it as
  a Foundation `Warning` is already the right signal.
- **Anti-echo:** no raw query text, snippet text, or provider error body ever enters a persisted
  column, a log line, or any value destined to become a span attribute — counts, model id, finish
  reason, latency, cost, and validated structured output only.

---

## Error handling

- **Every source-call failure is a value, not a throw** — adapters return `{ hits: [], failed: true }`;
  the shell counts it and decides Warning-vs-fail. This is the load-bearing robustness contract.
- **Partial failure** (≥1 call succeeded, ≥1 failed) → `queriesPartiallyFailed` Warning; the partial
  sweep still produces a reviewable list. A backstop-only failure with Tavily producing →
  `backstopFailed` Warning.
- **Total failure** (every attempted call across every attempted source failed) → `JobFailedError`;
  this is the only Search path that fails the Job. A successful sweep returning zero Results is *not*
  a failure — it is an honest empty finding that ends `done` / `done_with_warnings`.
- **A duplicate URL** is absorbed by the unique constraint at insert (`onConflictDoNothing`) — never
  an error, never application-level de-dup logic.
- **Missing `ctx.resolvedIdentity`** (Resolve did not run) is a programming/ordering fault — let it
  throw; the runner routes an unexpected throw to `fail` (Foundation). It is not a degraded path.

---

## Testing strategy

TDD throughout — failing test first; assert on the produced query plan, the gate decision, the rows
inserted, and the stage outcome, never on which private method ran.

**Vitest unit (no I/O), fakes for all three ports:**
- *`normalizeUrl`*: collapses scheme/`www`/port/trailing-slash/fragment and strips tracking params;
  keeps distinct paths/queries distinct; two forms of one article normalize equal; a non-URL string
  degrades without throwing.
- *`buildTimeSlices`*: 3 consecutive non-overlapping 12-month windows tile 36 months back from a
  fixed `now`; windows are ISO `yyyy-mm-dd`; deterministic for a pinned `now`.
- *`buildQueryPlan`*: broad set present by default and from the name alone for a name-only identity;
  a richer identity (domain + Brand Context) yields better-targeted broad queries; the angle set
  carries event-type queries **unsliced** and news/press-release queries **once per 12-month window**
  with `start_date`/`end_date`; type-targeted set is exactly the podcast/newsletter long-tail; the
  builder is pure (same inputs → same plan; no I/O).
- *`shouldEscalate`*: at/above threshold → `false` (suppresses both angle expansion and backstop);
  below → `true`; the exact-threshold boundary pinned; **post-dedup semantics** pinned — many raw
  hits but few distinct Results still escalates.
- *`tavilyProvisionalScore` / `BACKSTOP_PROVISIONAL_SCORE`*: 0–1 relevance maps into 1–100; a returned
  hit never scores 0; the backstop floor sorts strictly beneath every Tavily score.
- *`toResultInsert`*: Tavily hit → provisional score from relevance, normalized url, passed-through
  published date, `source: "tavily"`; backstop hit → floor score, `source: "web_search_backstop"`;
  never sets `verification_status`.
- *`SearchStage` orchestration* (the big suite) with port fakes — one test per outcome:
  - **healthy yield**: broad set inserts ≥ threshold distinct Results → gate does **not** escalate;
    angle/type-targeted Tavily queries and the backstop are **never called**; outcome reports no
    escalation, no Warnings.
  - **thin yield**: broad set inserts < threshold → gate escalates; angle + type-targeted Tavily
    queries run **and** the backstop runs; escalation observable in the outcome.
  - **provisional score**: inserted rows carry Tavily relevance as Match Score; backstop rows carry
    the floor; no `verification_status` written.
  - **partial failure**: some queries fail (port returns `failed: true`) but others succeed → one
    `queriesPartiallyFailed` Warning, Results still returned, Job not failed.
  - **backstop failure on escalation**: Tavily produced, backstop call failed → `backstopFailed`
    Warning, no Job failure.
  - **total failure**: every Tavily broad call fails (and on escalation every backstop call too) →
    `JobFailedError` thrown (the "nothing to show" path).
  - **insert-time dedup**: the same URL returned by two queries / two sources is inserted once (the
    fake repo enforces the conflict) and the gate counts it once.

**Vitest contract tests (adapters), client stubbed:**
- *Tavily adapter*: maps a representative `@tavily/core` response to `NormalizedHit`
  (url/title/snippet/relevance/publishedDate); surfaces a `timeSlice` as the client's date
  parameters; a timeout / non-2xx / thrown client error → `{ hits: [], failed: true }` (never throws).
- *Anthropic backstop adapter*: maps a `web_search` tool response to `NormalizedHit`
  (`relevance: null`, `publishedDate: null`) and emits GenAI call metadata; an SDK error →
  `{ hits: [], failed: true }`.

**Vitest integration — Testcontainers (real Postgres):**
- `insertIncluded` writes born-`included` rows carrying the provisional Match Score; ordering by
  `match_score` descending puts Tavily rows above backstop-floor rows; no `verification_status` set.
- Inserting the same `(job_id, normalized_url)` twice (across queries and across the two sources)
  yields exactly one row; the second insert is absorbed by the unique constraint and `insertIncluded`
  reports `0` newly inserted for it.
- A re-run (new Job id) writes its own rows; the prior Job's Results are unchanged.

**Recall realism (Autoevals, against the Aglow labelled set) — noted, not a unit gate.** The Aglow
case checks that the broad-then-escalate plan recalls the labelled include URLs and that escalation
is observable on this collision-heavy, mixed-coverage target. Precision belongs to downstream stages;
Search's *recall floor* is what this measures. This runs in the eval harness, not the per-task TDD loop.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file;
`OTEL_SDK_DISABLED=true` in test/CI.

---

## Out of scope (deferred)

- **The Tavily Research API** — deferred (ADR 0002); not in the recall path. Its natural re-entry is
  feeding **Summarise**, never recall. Do not wire it into Search.
- **The Extract step (PRD 5)** — Search returns title + snippet only; pulling full page text (via
  Tavily, server-side) for Results that survive the snippet gates is Extract's job. Search never
  fetches a Result's page; "fetch" stays reserved for the Resolve homepage fetch.
- **Filter & Collapse (PRD 4)** — heuristic Exclusions (`own_channel`, `aggregator`,
  `ecommerce_review`), the **`out_of_window`** judgement (reads the Published Date Search captured —
  ADR 0005), and near-duplicate title **Collapse** all live in Filter. Search performs only
  insert-time exact-URL dedup via the DB constraint.
- **Verify / Classify / Enhance / Summarise** — Search writes the provisional Match Score and nothing
  else of those; no `verification_status`, Content Type, Sentiment, Enhancement, or Summary.
- **OTel span emission** — PRD 8. Search leaves the facts and the anti-echo discipline; it creates no
  spans.
- **Always-on Anthropic search / Tavily Research recall** — explicitly retired by ADR 0002; the
  revisit triggers (weak thin-run recall, negligible duplicate cost) are noted there, not built here.

## Vocabulary guardrails (from `CONTEXT.md`)

- A **Result** is *returned* by Search and born **`included`**; Exclusion is the only later
  transition. Never "dropped"/"deleted"/"filtered out" — content the system chooses not to surface is
  simply *never returned by Search*. Use **Result**, never hit/item/link, in product-facing text.
- **"Fetch"** is reserved for the Resolve homepage fetch. Search **returns** Results; Extract
  *retrieves* page text via Tavily — Search never fetches a page.
- A **Time Slice** is a *recall* tactic (it constrains the query window), never the recency filter;
  `out_of_window` precision is Filter's, on the Published Date (ADR 0005).
- The **provisional Match Score** is Tavily's relevance, the first rung of the three-stage ratchet;
  Verify writes interim then final. Search never writes `verification_status`.
- A **Warning** is a partial *success* (some queries failed), never an error; total failure is a
  `JobFailedError`, which is the one "nothing to show" signal.
- The **single low-yield trigger is the design** (ADR 0002): one auditable threshold governs both the
  Angle Query escalation and the Anthropic backstop.
