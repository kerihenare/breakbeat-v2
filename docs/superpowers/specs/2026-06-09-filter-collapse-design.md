# Filter & Collapse — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/04-filter-collapse.md`
**ADRs:** 0004 (OTel / process model), 0005 (recency window split — Published Date is Search's, `out_of_window` is Filter's). The closed `exclusion_code` vocabulary is fixed by Foundation's schema + `CONTEXT.md`, not an ADR.
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`), Resolve Stage (`docs/superpowers/specs/2026-06-09-resolve-stage-design.md`), Search Stage (`docs/superpowers/specs/2026-06-09-search-stage-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 4. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADRs 0004/0005 and is not
> re-litigated here. This document fixes the domain pure functions (the heuristic predicates, the
> priority gate, title normalization, the distinctiveness gate, the Collapse clustering), the
> `ResultRepository` extension Filter needs, the stage orchestration, and the test strategy. It
> assumes Foundation provides the `Stage` port, `RunContext` (with the `resolvedIdentity` slot and
> `recordWarning`), the `Job`, the `Warning` value object, the `Clock` port, the Drizzle `results`
> table (with `status`, the **closed `exclusion_code` enum** `own_channel | aggregator |
> ecommerce_review | out_of_window | duplicate | off_topic`, nullable `exclusion_detail`, and the
> `published_date` column Search writes), and the two NestJS entrypoints; that Resolve populates
> `ctx.resolvedIdentity` with the immutable `ResolvedIdentity`; and that Search has already inserted
> the born-`included` Results (with `url`, `title`, `snippet`, `published_date`) and owns the
> `ResultRepository` port this design extends.

---

## Goal

Given a Job's `included` Results and its `ResolvedIdentity`, run a **cheap, deterministic,
network-free, LLM-free** stage that transitions the structurally-obvious noise from `included` to
`excluded` **before** any paid Verify / Extract / Enhance work begins. Two passes, one stage:

1. **Heuristic pass** — soft-Exclude each Result that sits on a surface the company *controls*
   (`own_channel`), is a product / ecommerce / review surface (`ecommerce_review`), is a
   link-aggregator / directory (`aggregator`), or is older than the 36-month horizon
   (`out_of_window`) — each rule a pure predicate over the Result and the Resolved Identity, in a
   **fixed priority order** so a multi-match Result gets one predictable code.
2. **Collapse pass** — over the *still-`included`* Results only, cluster near-identical copies of
   one story on **normalized, distinctive title** within a **14-day** window spanning **≥ 2 source
   domains**, keep the **earliest-published** copy, and soft-Exclude the losers as `duplicate` with
   an `exclusion_detail` pointing at the winner.

Every removal is a **soft Exclusion** (`status` → `excluded`, never a delete), carries a code from
the **closed `exclusion_code` set**, and writes **no model free text** (the heuristics emit none).
Filter never touches Match Score or ordering, never fetches, never calls an LLM, and never fails
the Job — a degraded (name-only) Resolved Identity is a **Warning**, not a failure, with the missing
own-channel rejection deferred to the Classify backstop in PRD 5.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Stage shape | A `FilterStage implements Stage` (Foundation's port), registered **third** in the worker's `StageRunner` (after `ResolveStage`, `SearchStage`) |
| How Filter reads the identity | Reads the read-only `ctx.resolvedIdentity` slot Resolve populated (own domains + scraped handles are the Own Channel anchor); never re-derives the company |
| How Filter reads / writes Results | Extends Search's `ResultRepository` port with `findIncluded(jobId)` (read the pool) and `recordExclusion(resultId, code, detail)` (the only write — `included → excluded`, idempotent) |
| Heuristic rules | Pure predicates over a Result (host / path / title / snippet) + the Resolved Identity. **No I/O, no network, no model** — exhaustively unit-testable against labelled fixtures |
| Priority order | `own_channel` → `ecommerce_review` → `aggregator` → `out_of_window`; first match wins, an already-`excluded` Result is never re-evaluated (most-specific-surface signal first) |
| `out_of_window` | Pure date arithmetic over the persisted `published_date` vs a 36-month horizon from `clock.now()`; a **NULL** date is **never** Excluded (symmetric with Collapse's undated rule) — ADR 0005 |
| Collapse | A pure clustering function over **normalized distinctive title** + publication date: 14-day window anchored to the earliest member, cluster collapses only across **≥ 2 distinct source domains**, **earliest-published wins**, losers `duplicate` |
| Distinctiveness gate | A normalized key may anchor a cluster only with **≥ 5 meaningful tokens** after removing the company name + stop-words; a generic / bare-name title is **never** a collapse key |
| Collapse pool | **`included`-only, by design** — an already-Excluded copy can neither compete nor win (forecloses an aggregator copy swallowing real coverage) |
| `exclusion_detail` | `null` for every heuristic; for `duplicate`, the stable internal reference `"of:<winnerResultId>"` (the winner's persistent Result id — never model text). The PRD's `"of #42"` is illustrative |
| Degraded path | `identity.ownDomains` empty → record one `filter.own_channel_degraded` **Warning**, still run the handle arm + `aggregator` + `ecommerce_review` + `out_of_window` unchanged, defer the rest to PRD 5's Classify backstop. Filter never fails the Job |
| Maintained host knowledge | The aggregator host set, the ecommerce/review host set, and the platform account-URL matchers live in **one clearly-labelled `host-knowledge.ts`**, extensible without touching the predicates or the clustering |
| Schema | **No migration.** Foundation reserved `status` / `exclusion_code` / `exclusion_detail`; Search added `url` / `title` / `snippet` / `published_date`. Filter writes only into columns that already exist |
| Unit tests | **Vitest, TDD throughout** — one labelled fixture per heuristic (positive + negative), priority order, degraded path, title normalization, distinctiveness gate, 14-day window, earliest-wins, undated handling, already-excluded-out-of-pool, idempotency, and the Aglow precision fixture |
| Repository test | **Vitest** integration (`*.integration.test.ts`) against the shared dev-compose Postgres per **ADR 0008** (`findIncluded` returns only `included`; `recordExclusion` flips `included → excluded` and is idempotent; Match Score untouched) |
| OTel spans | **Out of scope here** — PRD 8 owns span emission. Filter only upholds the *facts* a span will read (results in/out, per-code counts, each Exclusion as a candidate span event) and the **anti-echo** discipline |

---

## Architecture

Filter is a vertical slice and a deep module behind a simple interface (`Stage.run`). It lives
inside Foundation's hexagonal layering; the dependency arrow points inward
(`interface → application → domain`, with `infrastructure` implementing `application`'s ports). The
heuristic predicates, the priority gate, title normalization, the distinctiveness gate, and the
Collapse clustering are pure **domain**; the `ResultRepository` extension and the orchestration
shell are **application**; the Drizzle repository methods are **infrastructure**; DI wiring is
**interface**. Filter owns **no network adapters** — it is the one pipeline stage with no outbound
port at all beyond the Result repository.

### Source layout (new files unless marked *modify*)

```
src/
  domain/filter/
    exclusion-code.ts          # ExclusionCode union (the closed set) + HeuristicExclusionCode subset
    result-host.ts             # resultHost() + registrableDomain() — pure host/eTLD+1 extraction
    host-knowledge.ts          # maintained sets: aggregator hosts, ecommerce/review hosts, platform account matchers
    own-channel.ts             # isOwnChannel() — own-domain match OR named-account (control, not authorship)
    ecommerce-review.ts        # isEcommerceReview() — product / cart / review surface predicate
    aggregator.ts              # isAggregator() — link-aggregator / directory predicate
    out-of-window.ts           # isOutOfWindow() — pure date arithmetic over published_date (NULL ⇒ never)
    heuristic-exclusion.ts     # heuristicExclusion() — the fixed-priority gate → one code | null
    normalize-title.ts         # normalizeTitle() — the single shared "same title" key
    distinctive-title.ts       # isDistinctive() — the generic-title guard (≥ N meaningful tokens)
    collapse.ts                # collapse() — pure clustering → losers [{ loserId, winnerId }]
    filter-warnings.ts         # FILTER_WARNING closed set + builder
  application/filter/
    filter-config.ts           # FilterConfig type (horizon, window, distinctiveness, cluster-domains) + token
    filter.stage.ts            # FilterStage implements Stage — the impure orchestration shell
  application/search/ports/
    result-repository.port.ts  # *modify* — add FilterResult, findIncluded(), recordExclusion()
  infrastructure/persistence/
    result.repository.ts       # *modify* — implement findIncluded() + recordExclusion() (no schema change)
  app-worker.module.ts         # *modify* — construct FilterStage, register it THIRD in the StageRunner
```

---

## Domain

All domain types are immutable and contain **no I/O**. They are the richest unit-test target.

### `ExclusionCode` — the closed set (mirrors Foundation's enum)

```ts
type ExclusionCode =
  | "own_channel" | "aggregator" | "ecommerce_review" | "out_of_window" | "duplicate" | "off_topic";
type HeuristicExclusionCode = "own_channel" | "ecommerce_review" | "aggregator" | "out_of_window";
```

Filter writes only `own_channel | aggregator | ecommerce_review | out_of_window` (heuristics) and
`duplicate` (Collapse). It **never** writes `off_topic` (Verify's, `exclusion_detail = "LLM"`).
`llm_excluded` is not a code at all (`CONTEXT.md`). This TS union is the single source the
repository's `recordExclusion` accepts; it must stay in lock-step with Foundation's Drizzle enum.

### `resultHost(url)` and `registrableDomain(host)` — pure host extraction

`resultHost(url)` parses a URL and returns the lowercased host with no port (`""` for an
unparseable string — degrade, never throw). `registrableDomain(host)` reduces a host to its
registrable form (eTLD+1) so a **subdomain matches its parent** (`blog.getaglow.co` →
`getaglow.co`): take the last two labels, or the last three when the host ends in a known
**multi-part public suffix** (`co.uk`, `com.au`, `co.nz`, `co.za`, `com.br`, `co.jp`, …, seeded in
`result-host.ts`). A full Public-Suffix-List eTLD+1 is a noted deferred refinement (the same
simplification Resolve's `registrableDomain` documents) — Filter keeps its **own** copy because
Own Channel matching must include subdomains, which Resolve's strip-`www`-only version does not.

### `host-knowledge.ts` — the one maintained noise-surface table

The single, clearly-labelled, easily-extended home for the host/shape knowledge the `aggregator`,
`ecommerce_review`, and `own_channel` named-account rules lean on (PRD "Further Notes"). New noise
surfaces seen in evals are added **here**, never in the predicates or the clustering:

```ts
// Link-aggregator / index / directory surfaces (registrable-domain keys).
const AGGREGATOR_HOSTS: ReadonlySet<string>;     // e.g. news.google.com, news.yahoo.com, flipboard.com, paper.li, feedly.com, scoop.it, allsides.com
// Product / ecommerce / product-review / comparison surfaces (registrable-domain keys).
const ECOMMERCE_REVIEW_HOSTS: ReadonlySet<string>; // e.g. amazon.*, ebay.*, etsy.com, g2.com, capterra.com, getapp.com, trustpilot.com, productreview.com.au
// Per-platform pure extractor of a Result's *account key* from its URL, for the named-account arm.
type AccountKey = { readonly platform: string; readonly id: string };
function accountKey(url: string): AccountKey | null; // linkedin.com/company/<id>, x.com|twitter.com/<id>, instagram.com/<id>, facebook.com/<id>, <id>.substack.com, apps.apple.com/.../id<n>, play.google.com?id=<pkg>, tiktok.com/@<id>
```

`accountKey` is the load-bearing helper for **control-not-authorship**: it derives a stable
`{ platform, id }` from *any* URL on a recognised platform (a Result URL **or** a scraped handle
URL), so Own Channel can compare the two by value rather than trusting the scraper's `handle`
string format. A non-platform URL → `null`.

### `isOwnChannel(result, identity)` — the load-bearing control test

Pure predicate. True iff the Result sits on a surface the company **controls**:

1. **Own-domain arm:** `registrableDomain(resultHost(result.url))` equals
   `registrableDomain(d.domain)` for any `d` in `identity.ownDomains` (subdomains included). This
   arm covers a `url_provided` host the user supplied (Resolve keeps it as an own domain) **and**
   any `brand_derived` domain.
2. **Named-account arm:** `accountKey(result.url)` is non-null and **deep-equals**
   `accountKey(h.url)` for any `h` in `identity.socialHandles` (its LinkedIn page, X handle,
   Instagram, Facebook, Substack, app-store listing the company controls).

A third-party post that merely *mentions* the company, a different person's profile on the same
platform, a wire-distributed press release, and a company-bylined guest post on someone else's
publication all fail both arms — **control of the surface is the test, not authorship or the
appearance of the name.** (Those last two are explicitly *in scope* and must stay `included`; a
different-entity same-name page is **Verify's `off_topic`**, not Filter's.)

### `isEcommerceReview(result)` — buy/rate surface, not coverage

Pure predicate over host + path + snippet. True when the Result is a product page, ecommerce
listing (cart / checkout / product-detail), or a product-review / comparison surface:

- `registrableDomain(host)` ∈ `ECOMMERCE_REVIEW_HOSTS`, **or**
- structural path cues (`/dp/`, `/product/`, `/products/`, `/shop/`, `/cart`, `/checkout`,
  `/reviews/`, `/review/`), **or**
- snippet cues (`add to cart`, `buy now`, `in stock`, a price token alongside a review/rating cue).

Recognised structurally — "coverage *about* it, not a place to buy or rate its product."

### `isAggregator(result)` — re-lister, not reporter

Pure predicate. True when the Result is a link-aggregator / index / directory that re-lists content
rather than publishing original coverage: `registrableDomain(host)` ∈ `AGGREGATOR_HOSTS`, or a
structural directory cue (`/topic/`, `/tag/`, `/search?`, `/directory/`, `/feed/`). Conservative by
design — a genuine article on a news host must **not** match.

### `isOutOfWindow(publishedDate, now, horizonMonths)` — the recency precision backstop (ADR 0005)

Pure date arithmetic. `false` when `publishedDate` is **NULL** (we never guess a missing date into
a rejection — symmetric with Collapse's undated rule). Otherwise `true` when `publishedDate` is
strictly older than `now` minus `horizonMonths` (36). No network, no model. This is the recency
*precision* backstop; Search's Time Slices are the recency *recall* tactic and Exclude nothing.

### `heuristicExclusion(result, identity, now, config)` — the fixed-priority gate

Pure. Evaluates the four predicates in the **fixed order** `own_channel → ecommerce_review →
aggregator → out_of_window` and returns the **first** matching `HeuristicExclusionCode`, or `null`
if none match. The order makes a Result that qualifies for several codes receive a single,
predictable, explainable code (most-specific surface first; "merely too old" last). The stage calls
this once per `included` Result; an already-`excluded` Result is never passed in.

### `normalizeTitle(title)` — the single shared "same title" key

Pure. Produces the normalized key compared by Collapse: lowercase; collapse internal whitespace to
single spaces; strip surrounding punctuation; and remove a **trailing source/site suffix** — the
`" — Site Name"` / `" | Publisher"` / `" - Publisher"` tail wire re-prints append (split on the
last ` — ` / ` | ` / ` - ` separator and drop the tail when it looks like a publisher name). Defined
**once** and shared by every test; "near-identical title" means **equal normalized keys**.

### `isDistinctive(normalizedKey, companyName, config)` — the generic-title guard

Pure. A normalized key may anchor a cluster only when it is **distinctive**: after removing the
company-name tokens and a stop-word set, it retains **≥ `config.minDistinctiveTokens`** (default
**5**) meaningful tokens. A title that is just the company name or a generic phrase ("Funding
Announcement", "Q3 Update", "Press Release", "Company News") is **never** a collapse key — each such
Result stays a singleton. A shared title is evidence of "same story" only when the title itself is
identifying. This is the guard against generic-title false merges.

### `collapse(inputs, companyName, config)` — pure clustering

```ts
type CollapseInput = {
  readonly id: string;
  readonly title: string;
  readonly sourceDomain: string;          // registrableDomain(resultHost(url)) — precomputed by the shell
  readonly publishedDate: string | null;  // ISO yyyy-mm-dd, or null
};
type CollapseLoser = { readonly loserId: string; readonly winnerId: string };
function collapse(inputs: readonly CollapseInput[], companyName: string, config: FilterConfig): CollapseLoser[];
```

Pure, deterministic, no I/O. Steps:

1. **Key & gate.** `normalizeTitle(title)` per input; keep only inputs whose key passes
   `isDistinctive(key, companyName, config)`. Non-distinctive inputs are never clustered (singletons).
2. **Group** distinctive inputs by normalized key.
3. **Cluster (per key).** Take the **dated** members (`publishedDate !== null`), sorted by
   `(date asc, id asc)`. Greedily form clusters anchored to the **earliest** member: a later dated
   member joins the open cluster while it is within `config.collapseWindowDays` (**14**) of the
   cluster's **earliest** member (anchored to the earliest, not pairwise-chained); otherwise it
   opens a new cluster. Clusters are seeded only by dated members.
4. **Undated join.** If a key produced **exactly one** dated cluster, append all its undated members
   to that cluster; if it produced **zero or several** clusters, undated members stay `included`
   (never guessed into a story — stories 16/17).
5. **Collapsibility.** A cluster collapses only when it has **≥ 2 members** *and* its **dated**
   members span **≥ `config.minClusterDomains`** (**2**) distinct `sourceDomain`s — the
   wire-syndication signature. Same-title copies confined to one domain stay singletons. **Bias to
   under-collapse**: a visible near-duplicate is a minor annoyance; a silently-Excluded real story
   is a trust failure.
6. **Winner & losers.** The winner is the **earliest-published** (first sorted) dated member; every
   other member of a collapsing cluster is a loser, emitted as `{ loserId, winnerId }`.

The shell turns each loser into a `recordExclusion(loserId, "duplicate", "of:" + winnerId)`. Collapse
changes only `status` / `exclusion_*`; it never alters Match Score or ordering.

### `filter-warnings.ts` — closed Warning set

Filter's one Warning reuses Foundation's `Warning` value object (`{ type, message }`); the `type` is
drawn from a closed set namespaced under `filter.`:

```ts
const FILTER_WARNING = {
  ownChannelDegraded: "filter.own_channel_degraded", // no resolved own domains; own-channel ran on whatever signal it had, deferring the rest to the Classify backstop (PRD 5)
} as const;
```

The builder returns a `Warning` carrying a fixed, non-echoing message (no raw URL, no model text).
A degraded own-channel pass is an `OK`/Warning condition — never a Job failure.

---

## Application

### `FilterConfig`

```ts
type FilterConfig = {
  horizonMonths: number;        // 36 — out_of_window
  collapseWindowDays: number;   // 14 — cluster window, anchored to the earliest member
  minDistinctiveTokens: number; // 5  — distinctiveness gate
  minClusterDomains: number;    // 2  — wire-syndication signature
};
const FILTER_CONFIG = Symbol("FilterConfig");
```

Injected (never literals scattered through the predicates). Tuned against the Aglow set.

### `ResultRepository` extension (modify Search's port)

Search declared `ResultRepository` with `insertIncluded`. Filter adds the read and the one write it
needs, plus the `FilterResult` read-model the heuristics + Collapse consume:

```ts
// result-repository.port.ts (additions)
import type { ExclusionCode } from "../../../domain/filter/exclusion-code";

type FilterResult = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedDate: string | null; // ISO yyyy-mm-dd, or null
};

interface ResultRepository {
  insertIncluded(jobId: string, results: readonly ResultInsert[]): Promise<number>; // (existing — Search)
  // Filter additions:
  findIncluded(jobId: string): Promise<FilterResult[]>;                              // the Filter pool
  recordExclusion(resultId: string, code: ExclusionCode, detail: string | null): Promise<void>;
}
```

`recordExclusion` is the **only** status transition Filter performs and is **idempotent**: it
updates `status = 'excluded'`, `exclusion_code`, `exclusion_detail` **only `WHERE status =
'included'`**, so a Result already `excluded` is never re-Excluded with a different code (story 34)
and a retried run is a no-op on rows it already moved. `findIncluded` returns **only** rows whose
`status = 'included'` — an already-Excluded copy is never in the pool, by query (the load-bearing
"Collapse pool is `included`-only" invariant).

### `FilterStage implements Stage` — the orchestration shell

The only impure unit. `name = "filter"`. `run(ctx)`:

1. Read `identity = ctx.resolvedIdentity` (Resolve populated it). If `null`, that is a
   programming/ordering fault (Resolve must run first) — throw a plain `Error`; the runner routes an
   unexpected throw to `fail` (Foundation). It is **not** a degraded path.
2. **Degraded-path Warning.** If `identity.ownDomains.length === 0`, call
   `ctx.recordWarning(filterWarnings.ownChannelDegraded())` once. Filter still runs every rule with
   whatever signal it has (the handle arm of `own_channel`, plus `aggregator` / `ecommerce_review` /
   `out_of_window`, which are independent of the domains) and defers the rest to PRD 5's Classify
   backstop.
3. **Heuristic pass.** `const pool = await repo.findIncluded(ctx.job.id)`. For each Result, compute
   `code = heuristicExclusion(result, identity, this.clock.now(), this.config)`. If non-null,
   `await repo.recordExclusion(result.id, code, null)`; otherwise the Result survives into the
   Collapse pool. Track per-code counts (for the future span).
4. **Collapse pass.** Build `CollapseInput[]` from the **survivors** (compute `sourceDomain =
   registrableDomain(resultHost(url))`, carry `publishedDate`, `title`, `id`), call
   `collapse(inputs, identity.companyName, this.config)`, and for each loser
   `await repo.recordExclusion(loser.loserId, "duplicate", "of:" + loser.winnerId)`.
5. **Return normally.** Filter never throws `JobFailedError`: a deterministic refinement that
   narrows the population (even to zero) is a valid, reviewable outcome (`CONTEXT.md`). The Job ends
   `done` / `done_with_warnings`.

The stage performs **no concurrency tricks** — it is fast pure logic plus sequential repository
writes; correctness and determinism beat parallelism here. Filter never sets `ctx.resolvedIdentity`,
never writes `match_score` / `verification_status` / content fields, never fetches, never calls an
LLM.

---

## Infrastructure

### `findIncluded` + `recordExclusion` (Drizzle — `result.repository.ts` *modify*)

No schema change: Foundation reserved `status` (default `included`), the closed `exclusion_code`
enum, and nullable `exclusion_detail`; Search added `url` / `title` / `snippet` / `published_date`.
Filter implements two methods on the existing `ResultDrizzleRepository`:

- **`findIncluded(jobId)`** — `select { id, url, title, snippet, publishedDate } from results where
  jobId = :jobId and status = 'included'`. Maps `published_date` to the ISO string or `null`. This
  query is the entire "Collapse pool is `included`-only" guarantee.
- **`recordExclusion(resultId, code, detail)`** — `update results set status = 'excluded',
  exclusion_code = :code, exclusion_detail = :detail where id = :resultId and status = 'included'`.
  The `status = 'included'` guard makes it idempotent and forecloses re-Excluding a row with a
  different code. It touches **only** the three columns — `match_score` and ordering are untouched.

### DI wiring (`app-worker.module.ts` *modify*)

Provide a `FilterConfig` from `@nestjs/config` (`FILTER_*` env with the documented defaults),
construct `FilterStage` from the existing `RESULT_REPOSITORY` provider + `FILTER_CONFIG` +
Foundation's `Clock`, and register it **third** in the `StageRunner`'s ordered list, after
`ResolveStage` and `SearchStage` → `[ResolveStage, SearchStage, FilterStage]`. Filter introduces
**no new outbound adapter and no new client** — it reuses the Result repository Search already wired.
`.env.example` gains `FILTER_HORIZON_MONTHS=36`, `FILTER_COLLAPSE_WINDOW_DAYS=14`,
`FILTER_MIN_DISTINCTIVE_TOKENS=5`, `FILTER_MIN_CLUSTER_DOMAINS=2`.

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, the `filter` Stage Span, and per-Result span events are **PRD 8's** to build (ADR
0004). Filter's obligations are the *facts* those spans will read and the discipline they must not
violate:

- The aggregatable facts a future `filter` span needs — `results.in` (the `findIncluded` count),
  `results.out` (survivors after both passes), and `excluded.{own_channel|aggregator|
  ecommerce_review|out_of_window|duplicate}` per-code counts — are all derivable from the stage's run
  and the persisted Result rows. Happy-path `included` Results produce no span and no event.
- Each Exclusion (heuristic and Collapse loser) is the interesting per-Result outcome that will
  become a **span event** on the Stage Span; the stage already produces exactly these write points.
- The degraded own-channel Warning is an `OK` span with a span event, never a span-status `ERROR`.
- **Anti-echo:** Filter writes no model text into any stored field and emits no model text onto any
  future span — the heuristics are pure logic, so the echo channel does not exist here.
  `exclusion_detail` is either `null` or the stable internal reference `"of:<winnerResultId>"`.

---

## Error handling

- **Filter never fails the Job.** It throws no `JobFailedError` on any named condition — a narrowed
  or empty population is a valid outcome. The only throw is the **programming fault** of a missing
  `ctx.resolvedIdentity` (Resolve did not run), which the runner routes to `fail` (Foundation).
- **The degraded (name-only) path** (no resolved own domains) is a `Warning`, not a failure: the
  handle arm + `aggregator` + `ecommerce_review` + `out_of_window` run unchanged, and own-channel
  domain rejection defers to PRD 5's Classify backstop.
- **Idempotency / re-entrancy** is the repository's `status = 'included'` guard: a second run
  re-reads a smaller `included` pool and never rewrites an existing code.
- **A malformed Result URL** degrades inside `resultHost`/`registrableDomain` (returns `""`) — the
  predicates simply don't match it, so a junk URL stays `included` rather than crashing the pass.

---

## Testing strategy

This stage is almost entirely pure deterministic logic — the ideal candidate for thorough **Vitest**
unit tests over **labelled fixtures**, written **TDD throughout** (red-green-refactor). Tests assert
**external behaviour** — given these Results and this Resolved Identity, which Results end `excluded`
with which `code`/`detail` — never internal call shapes.

**Vitest unit (no I/O), fakes for the repository:**
- *`resultHost` / `registrableDomain`*: host lowercased, port stripped; subdomain reduces to the
  registrable parent; a multi-part suffix (`co.uk`, `com.au`) keeps three labels; a non-URL → `""`.
- *`accountKey`*: each supported platform URL → its `{ platform, id }`; a non-platform URL → `null`;
  a Result URL and a scraped handle URL for the same account produce **deep-equal** keys.
- *`isOwnChannel`*: the company's own domain **and** its subdomains match; its named accounts on each
  supported platform match; a **third party's** post mentioning the company does **not** match; a
  different person's profile on the same platform does **not** match; the app-store listing matches.
  **Control-not-authorship** asserted explicitly: a wire-distributed press release stays `included`;
  a company-bylined guest post on a third-party publication stays `included`; content *about* the
  company on a platform where the company also has an account stays `included`.
- *`isEcommerceReview` / `isAggregator`*: positive + negative fixtures — a product page, an ecommerce
  listing, a product-review/comparison page, a link-aggregator/directory page **vs** a genuine
  article on a news host (negative).
- *`isOutOfWindow`*: a date older than 36 months → `true`; inside the horizon → `false`; **NULL** →
  `false` (never guessed into a rejection); the exact-boundary pinned with a fixed `now`.
- *`heuristicExclusion` priority order*: a Result matching more than one rule receives the single
  expected code (`own_channel` beats `ecommerce_review` beats `aggregator` beats `out_of_window`),
  deterministically; a Result matching none → `null`.
- *Degraded path*: with `ownDomains: []`, the domain arm Excludes nothing, a present handle still
  Excludes via the named-account arm, and `aggregator`/`ecommerce_review`/`out_of_window` behave
  identically to the resolved case — confirming the deferral to the Classify backstop without failing.
- *`normalizeTitle`*: case, whitespace, surrounding punctuation, and trailing source-suffix stripping
  all map to the expected key; two genuinely different titles do **not** collide.
- *`isDistinctive`*: a generic / bare-company-name title never anchors a cluster; a distinctive title
  passes.
- *`collapse`*: a distinctive title across **≥ 2 domains** within 14 days collapses to the
  earliest-published winner, losers `duplicate` with `detail = "of:<winnerId>"`; same distinctive
  title on a **single** domain stays singletons; a copy **outside** the 14-day window forms a separate
  cluster; an **undated** copy under a single-cluster key joins (and if not the winner is Excluded),
  while an undated copy under a multi-cluster key stays `included`; an already-Excluded copy is never
  in the input pool (so it can neither win nor change the winner); the **under-collapse bias** asserted
  explicitly.
- *`FilterStage` orchestration* (the integrating suite) with a fake repository: the heuristic pass
  Excludes the expected rows with the expected codes; the Collapse pass runs over **survivors only**;
  the degraded path records exactly one `own_channel_degraded` Warning and still Excludes via the
  other rules; Filter **never** throws `JobFailedError`; a missing `resolvedIdentity` throws a plain
  `Error`; **idempotency** — running the stage twice produces the same Exclusions and never rewrites a
  code; **Match Score untouched** — no write path touches `match_score`.

**Vitest integration (`*.integration.test.ts`) — shared dev-compose Postgres (ADR 0008):** `findIncluded` returns only `included`
rows with the content columns; `recordExclusion` flips `included → excluded` with the code/detail and
is a no-op on an already-`excluded` row (idempotency at the SQL guard); `match_score` and ordering are
unchanged by an Exclusion; a re-run (new Job id) is unaffected by another Job's Exclusions.

**The Aglow precision fixture (the primary deterministic fixture for this stage):** the labelled
Aglow set (≈ 14 include, ≈ 300 exclude) is encoded as Vitest fixtures targeting the rows **this**
stage owns, independent of Verify:
- *`own_channel`*: `getaglow.co` pages and subpaths; the company's `getaglow` LinkedIn, `aglow_app`
  Instagram, Facebook, and X accounts; the Apple App Store and Google Play listings for the Aglow app.
- *`aggregator` / `ecommerce_review`*: directory/aggregator surfaces and any product/ecommerce/review
  pages in the fixture, each under the correct code.
- *In-scope rows preserved*: the genuine third-party coverage (Business News Australia, Startup Daily,
  the trade-publication beauty pieces) is **not** Excluded by any Filter heuristic. Same-name
  *different-entity* rows (Aglow International the ministry, Aglow Outdoors, HomeAglow, Aglow Air) are
  **Verify's `off_topic`**, not Filter's — Filter Excludes them only if they independently hit a rule.
- *Collapse*: near-identical re-prints of one Aglow story collapse to the earliest copy, losers
  `duplicate`.

End-to-end precision/recall **Autoevals** against the Aglow set belong to the **LLM-driven** stages
(Verify / Classify), not to this stage's deterministic rules; Filter's contribution is asserted by
the deterministic fixtures above.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file;
`OTEL_SDK_DISABLED=true` in test/CI.

---

## Out of scope (deferred)

- **Exact-URL deduplication** — Search's insert-time `(job_id, normalized_url)` unique constraint.
  There is no dedup *stage*; Collapse is the title pass only.
- **Entity-relevance / `off_topic` judgement** — a different same-name entity is **Verify's**
  `off_topic` (`exclusion_detail = "LLM"`), not Filter's. Filter Excludes such a row only if it
  independently matches an own-channel / aggregator / ecommerce rule.
- **The Own Channel Classify backstop itself** — the LLM backstop that catches own-channel surfaces
  on the degraded name-only path (writing `own_channel` with `exclusion_detail = "LLM"`) lives in
  **PRD 5**. Filter defers to it; it does not implement it.
- **Time Slices and Published Date capture** — Search-stage concerns (ADR 0005). Filter *consumes*
  the persisted `published_date` for `out_of_window`; it does not fetch or derive dates.
- **Match Score, Verification, Content Type, Extract, Enhancement, Sentiment, Summary** — all
  downstream of Filter; Collapse hands its winners on to them. Filter never touches Match Score or
  ordering.
- **Resolve and the Negative Boost** — Filter consumes the Resolved Identity; it does not produce it
  and does not use the Negative Boost (a Verify input).
- **OTel span emission** — PRD 8. Filter leaves the facts and the anti-echo discipline.
- **UI rendering of Excluded Results** — PRD 7. Filter only sets `status` / `exclusion_code` /
  `exclusion_detail`.

## Vocabulary guardrails (from `CONTEXT.md`)

- The verb for removal is **Excluded** (soft, with a code) — never "dropped", "deleted", "filtered
  out", "merged", or "deduped". The title pass is **Collapse**; the insert-time URL constraint is
  **URL dedup**.
- An **Exclusion** is recorded by `exclusion_code` (*why*) + `exclusion_detail` (the *catcher* / a
  stable reference) — never which stage caught it. `llm_excluded` is never a code; `"LLM"` is the
  Classify backstop's `exclusion_detail`, written downstream, not here.
- A **Result** is never deleted; an Excluded Result stays inspectable (story 11).
- **Filter is independent of Name Collisions** — the heuristics need no knowledge of which other
  companies share the name; with Verify's positive check they are the **primary noise rejector**, and
  the Negative Boost is only a sharpener for the confusable indexed-brand middle.
- The **Collapse pool is `included`-only — by design**: allowing Excluded copies in risks an
  earliest-published aggregator copy swallowing legitimate coverage and becoming the surviving row.
- **Anti-echo:** Filter writes no model text into any stored field — the heuristics emit none.
