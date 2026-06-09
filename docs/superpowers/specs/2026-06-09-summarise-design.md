# Summarise Stage — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/06-summarise.md`
**ADRs:** 0002 (Search source model — Research API deferred, names this stage as its re-entry point), 0004 (OTel / process model)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`), Verify / Extract / Classify / Enhance (`docs/superpowers/specs/2026-06-09-verify-extract-classify-enhance-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 6. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADRs 0002/0004 and is not
> re-litigated here. This document fixes the one domain value object (the validated `Summary`), the
> pure input-selection rule, the closed Warning set, the single `SummarisePort` over a Haiku adapter,
> the `SummaryRepository` + the `ResultRepository` read extension, the small `summaries` migration,
> the stage orchestration, and the test strategy. It assumes Foundation provides the `Stage` port,
> `RunContext` (`job`, `recordWarning`), the `Job`, the `Warning` value object, the `StageRunner`, and
> the Drizzle schema (`jobs`, `warnings`, `results`, `resolved_identity`) — but **no Summary storage
> exists yet**, so this design adds one. It assumes Verify/Classify/Enhance has settled which Results
> survive (`status = 'included'`) and written each surviving Result's Enhancement (`sentiment` +
> `takeaway`) onto the `results` row. This is a deliberately **small** stage: one LLM call per Job.

---

## Goal

Given a Job whose Results have settled, produce **exactly one Job-level Summary** — a short digest of
what the surviving (`included`) coverage, taken as a whole, says about the target company — and
persist it as the Result page's "Enhancement details summary". The digest is over the surviving
Results' **snippets** (each plus its per-Result **Enhancement**: `takeaway` + `sentiment`), never over
Extracted full page text. Summarise selects only `included` Results at the point it runs; **Excluded
Results never feed the digest**. Any failure — no surviving Results, an adapter error, or output that
fails Zod validation — is recorded as a **Warning** and leaves the Summary absent. Summarise **never
fails the Job** and never throws `JobFailedError`: the reviewable list is the Job's purpose and it
always still exists, so a degraded digest is a partial *success*. The empty case (zero surviving
Results) is the Warning that flags an **all-Excluded Job** as `done_with_warnings` — an honest empty
finding, never a `failed` Job.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Stage shape | A `SummariseStage implements Stage` (Foundation's port), `name = "summarise"`, registered **fifth / last** in the worker's `StageRunner`: `[ResolveStage, SearchStage, FilterStage, AnalyzeStage, SummariseStage]` |
| LLM granularity | **One LLM call per Job** (not per Result) — the digest is Job-level. One `SummarisePort` over an Anthropic **Haiku** adapter |
| Digest input | The surviving (`included`) Results' **snippets**, each with its Enhancement (`takeaway`, `sentiment`). **Never** Extracted full page text — that is the deferred Research-API-shaped option (ADR 0002) |
| Input-selection rule | A **pure** function selecting only Results whose `status` is `included` at the point Summarise runs; Excluded Results are never in the input. Zero survivors → no Summary, empty-case Warning |
| Output | One Zod-validated `Summary` value object. Only the validated structured output is persisted — no raw model text leaks (anti-echo) |
| One-Summary-per-Job | Exactly one Summary stored per Job (`summaries` is one-row-per-Job, `job_id` PK). A re-run is a new Job id with its own row |
| Schema | **A small migration IS needed.** Add a one-row-per-Job `summaries` table (`job_id` PK/FK → `jobs.id`, `summary` text, `created_at`) — parallel to how Resolve added `resolved_identity`. Foundation reserved no Summary storage |
| Ports | `SummarisePort` (Haiku digest) + `SummaryRepository` (`save` / `findByJobId`), each with a `Symbol` token; **plus** a read extension on Search/Filter's `ResultRepository` returning the included Results' summarise input (`snippet`, `takeaway`, `sentiment`) |
| Failure model | **Warning-only.** Adapter error, Zod-validation failure, or no surviving Results → one Warning, Summary absent, Job still reaches a terminal state. Summarise never fails the Job |
| Warning set | A closed `SUMMARISE_WARNING` set namespaced under `summarise.` — `summarise_failed`, `summarise_empty` — with fixed, non-echoing messages |
| Adapter | Anthropic **Haiku** behind `SummarisePort`; returns the typed failure the application maps to a Warning. **Tavily Research API not wired** (deferred, ADR 0002 — a future alternative adapter behind the same port) |
| Unit tests | **Vitest** with the `SummarisePort` faked: input-selection (only `included`; Excluded never feed it) and Warning logic (empty → Warning not failure; adapter error / Zod failure → Warning, Summary absent, Job terminal; exactly one Summary per Job) |
| Adapter test | **Vitest** contract test with the Anthropic SDK stubbed (representative snippets-plus-Enhancements input → valid `Summary`; API / validation failure → typed failure; no raw model text escapes) |
| Quality eval | **Optional Autoevals** for digest faithfulness / groundedness — a quality gauge, kept out of the deterministic unit path |
| OTel spans | **Out of scope here** — PRD 8 owns span emission (ADR 0004). Summarise upholds only the *facts* the `summarise` Stage Span will read (one Haiku child span; failed/empty = `OK` + `warning` event) and the **anti-echo** discipline |

---

## Architecture

Summarise is a vertical slice and a small deep module behind a simple interface (`Stage.run`): a
well-defined input (the `included` Results' snippets plus Enhancements) maps through **one** validated
LLM call to **one** validated `Summary`. It lives inside Foundation's hexagonal layering; the
dependency arrow points inward (`interface → application → domain`, with `infrastructure` implementing
`application`'s ports). The `Summary` value object and the pure input-selection / Warning builders are
**domain**; the two ports (`SummarisePort`, `SummaryRepository`), the `ResultRepository` read
extension, and the orchestration shell are **application**; the Anthropic Haiku adapter, the Drizzle
`SummaryRepository`, and the new `summaries` table live in **infrastructure**; DI wiring is
**interface**.

### Source layout (new files unless marked *modify*)

```
src/
  domain/summarise/
    summary.ts                    # Summary value object + summarySchema (Zod) — the one validated output
    summarise-input.ts            # SummariseInputItem + SummariseInput types (snippet + takeaway + sentiment)
    select-input.ts               # selectSummariseInput() — pure: keep only `included`, shape the digest input
    summarise-warnings.ts         # SUMMARISE_WARNING closed set + builders (non-echoing)
  application/summarise/
    ports/
      summarise.port.ts           # SummarisePort + SummariseResult (ok | failed) + SUMMARISE_PORT token
      summary-repository.port.ts  # SummaryRepository (save / findByJobId) + SUMMARY_REPOSITORY token
    summarise.stage.ts            # SummariseStage implements Stage — the impure orchestration shell
  application/search/ports/
    result-repository.port.ts     # *modify* — add SummariseResultRow + findIncludedForSummary()
  infrastructure/
    anthropic/
      summarise.adapter.ts        # SummarisePort over @anthropic-ai/sdk (Haiku); failure → typed { failed: true }
    persistence/
      schema.ts                   # *modify* — add the one-row-per-Job `summaries` table
      summary.repository.ts       # SummaryRepository impl over Drizzle (save / findByJobId)
      result.repository.ts        # *modify* — implement findIncludedForSummary()
  app-worker.module.ts            # *modify* — register adapters + repo, SummariseStage FIFTH / last in StageRunner
```

---

## Domain

All domain types are immutable and contain **no I/O**. They are the unit-test target.

### `Summary` value object + `summarySchema` — the one validated output

The Summary is the **one Job-level digest** (`CONTEXT.md`): the Result page's "Enhancement details
summary", never a "result summary". It is a single short text produced by reading across all the
surviving Results — distinct from the per-Result Enhancement `takeaway`, which is one row's reading.

```ts
const summarySchema = z.object({
  summary: z.string().trim().min(1).max(/* bounded digest length, config-tunable */),
});
type Summary = z.infer<typeof summarySchema>; // { summary: string }
```

`summarySchema` is the **only** gate model output crosses. The adapter parses the structured response
through this schema; nothing unvalidated and **no raw model free-text** reaches a stored field, a log
line, or any future span attribute (anti-echo). The schema deliberately accepts only the digest
string — the model returns nothing else to persist. A re-run produces a fresh `Summary`; there is
never more than one live Summary for a Job.

### `SummariseInputItem` + `SummariseInput` — the port's input contract

```ts
type SummariseInputItem = {
  readonly snippet: string;                       // the surviving Result's snippet (the digest is over snippets)
  readonly takeaway: string | null;               // the per-Result Enhancement takeaway (nullable — Enhance may have failed/Warned)
  readonly sentiment: "positive" | "neutral" | "negative" | null; // the per-Result Enhancement Sentiment (nullable)
};
type SummariseInput = {
  readonly companyName: string;                   // the target, for the digest's framing
  readonly items: readonly SummariseInputItem[];  // one per surviving (`included`) Result
};
```

The digest is over **snippets** plus each Result's Enhancement — **never** Extracted full page text
(`CONTEXT.md`; the full-text path is the deferred Research-API-shaped option, ADR 0002). `takeaway`
and `sentiment` are nullable because Enhance is itself Warning-tolerant: a surviving Result whose
Enhance failed still appears in the digest input carrying its snippet with `null` Enhancement fields —
Summarise digests what it has, and never excludes a surviving Result for a missing takeaway.

### `selectSummariseInput(rows, companyName): SummariseInput` — the pure selection rule

Pure, no I/O, exhaustively unit-testable. Takes the rows the repository returned (already
`status = 'included'`-only by query — see the read extension below) and the target company name, and
shapes the `SummariseInput`. The load-bearing invariants it encodes:

- **Only `included` Results feed the digest.** Excluded Results are never in the input. (Defence in
  depth: the repository query already returns `included`-only; the pure rule is asserted against a
  mixed-status fixture so the guarantee holds at the domain boundary, not just in SQL.)
- It maps each surviving row to a `SummariseInputItem` (snippet + nullable takeaway + nullable
  sentiment), preserving the repository's order.
- It carries the `companyName` for the digest's framing.

It does **not** decide failure-vs-Warning and does **not** call the model — the orchestration shell
reads `items.length === 0` to take the empty path. Keeping selection pure makes "Excluded never feed
the digest" and "empty input is detectable" both assertable without a fake model.

### `summarise-warnings.ts` — closed Warning set

Summarise's Warnings reuse Foundation's `Warning` value object (`{ type, message }`); the `type` is
drawn from a **closed set namespaced under `summarise.`**:

```ts
const SUMMARISE_WARNING = {
  summariseEmpty:  "summarise.summarise_empty",  // no surviving (`included`) Results — nothing to digest
  summariseFailed: "summarise.summarise_failed", // adapter error OR Zod-validation failure — Summary absent
} as const;
```

Each builder returns a `Warning` carrying a **fixed, non-echoing message** — never raw snippet text,
never raw model output, never a provider error body (anti-echo). Both are partial-success notes: the
reviewable list is intact, only the digest is missing.

- `summariseEmpty` is the **empty-case Warning**: it is recorded when the selected input has zero
  items. This is also the Warning that flags an **all-Excluded Job** (Search returned hits, every one
  was later Excluded) as `done_with_warnings` — an honest empty finding ("no in-scope coverage"),
  never a `failed` Job (`CONTEXT.md`; Foundation's "no population to judge" vs "judged to zero" rule).
- `summariseFailed` collapses the two *production* failures — the adapter call erroring and the
  model's output failing `summarySchema` validation — into one type. Both leave the Summary absent and
  are indistinguishable to the reviewer (the digest simply isn't there); the distinction lives in
  telemetry (PRD 8), not in the Warning vocabulary.

There is **no** Job-failing path here: Summarise has no `JobFailedError` case. A failed or empty
Summarise can only ever Warn.

---

## Application

### Ports

```ts
// summarise.port.ts — the one digest call (Anthropic Haiku adapter), ONE call per Job
type SummariseResult =
  | { ok: true; summary: Summary }   // Zod-validated by the adapter before it returns
  | { ok: false };                   // typed failure: adapter error OR validation failure — never a throw
interface SummarisePort {
  summarise(input: SummariseInput): Promise<SummariseResult>;
}
const SUMMARISE_PORT = Symbol("SummarisePort");

// summary-repository.port.ts — the one-row-per-Job Summary store
interface SummaryRepository {
  save(jobId: string, summary: Summary): Promise<void>;     // upsert the Job's single Summary row
  findByJobId(jobId: string): Promise<Summary | null>;      // PRD 7's per-Job read model (null = absent/degraded)
}
const SUMMARY_REPOSITORY = Symbol("SummaryRepository");
```

**Failure translation is the adapter's job.** `SummarisePort.summarise` **never throws** — a transport
/ quota / SDK error *and* a schema-validation failure both surface as `{ ok: false }`. The
orchestration shell branches on the value and records a single `summariseFailed` Warning; it never
relies on `try/catch` to decide Warning-vs-success. `SummaryRepository.findByJobId` returns `null` when
no Summary was stored — the degraded/absent case PRD 7's Result page renders gracefully as "no digest"
(never an error).

### `ResultRepository` read extension (modify Search/Filter's port)

Search declared `ResultRepository.insertIncluded`; Filter added `findIncluded` (the Filter pool) and
`recordExclusion`. Summarise needs a read that returns each **`included`** Result's *summarise input* —
its `snippet` plus its Enhancement (`takeaway`, `sentiment`) — so it adds **one read method** and its
read-model type. It performs **no writes** to `results` at all.

```ts
// result-repository.port.ts (additions)
type SummariseResultRow = {
  readonly snippet: string;
  readonly takeaway: string | null;                                   // Enhance's per-Result takeaway (nullable)
  readonly sentiment: "positive" | "neutral" | "negative" | null;     // Enhance's per-Result Sentiment (nullable)
};

interface ResultRepository {
  // (existing — Search) insertIncluded(...)
  // (existing — Filter) findIncluded(...), recordExclusion(...)
  // Summarise addition (read-only):
  findIncludedForSummary(jobId: string): Promise<SummariseResultRow[]>;
}
```

`findIncludedForSummary` returns **only** rows whose `status = 'included'` at the moment Summarise runs
— this query is the primary "Excluded Results never feed the digest" guarantee (the pure
`selectSummariseInput` rule is the second line of defence). It is distinct from Filter's `findIncluded`
because Summarise needs the Enhancement columns (`takeaway`, `sentiment`) Filter does not, and never
needs `url` / `title` / `published_date`. A new method (not a reshape of `findIncluded`) keeps each
consumer's read model honest about exactly what it consumes.

### `SummariseStage implements Stage` — the orchestration shell

The only impure unit. `name = "summarise"` (the closed `Stage`-name set is
`resolve | search | filter | analyze | summarise`). `run(ctx)`:

1. **Read the surviving input.** `const rows = await this.results.findIncludedForSummary(ctx.job.id)`
   (`included`-only by query). `const input = selectSummariseInput(rows, ctx.job.companyAnchorName)`.
2. **Empty case.** If `input.items.length === 0`, record `ctx.recordWarning(summariseWarnings.summariseEmpty())`
   and **return normally**. No `SummarisePort` call, no `SummaryRepository` write — there is simply
   nothing to digest. This is the all-Excluded Job's `done_with_warnings` flag.
3. **Digest (one call).** `const result = await this.summarise.summarise(input)` — exactly **one** Haiku
   call per Job (never per Result).
4. **Failure case.** If `result.ok === false` (adapter error *or* Zod-validation failure),
   `ctx.recordWarning(summariseWarnings.summariseFailed())` and **return normally**. The Summary is
   left absent; nothing is written to `summaries`.
5. **Success.** `await this.summaries.save(ctx.job.id, result.summary)` — persist the one validated
   `Summary`. Return normally with no Warning.
6. Summarise **never** throws `JobFailedError`, never sets `ctx.resolvedIdentity`, never writes to
   `results` (no `match_score` / `verification_status` / content fields / Exclusions), and never
   fetches a page. It reads `included` Results and writes exactly one `summaries` row, or none.

The stage performs **no concurrency tricks** — it is one read, at most one model call, and at most one
write, strictly sequential. Determinism beats parallelism for a single-call stage.

---

## Infrastructure

### `summaries` table (the small migration — `schema.ts` *modify*)

Foundation reserved `jobs` / `warnings` / `results` / `resolved_identity` but **no Summary storage**.
Summarise adds a **one-row-per-Job** table via a `drizzle-kit` migration — parallel to how Resolve
added `resolved_identity`:

```
summaries
  job_id      uuid  PRIMARY KEY  REFERENCES jobs(id)   -- one row per Job, owned by the Job
  summary     text  NOT NULL                            -- the validated digest string only (anti-echo)
  created_at  timestamptz NOT NULL DEFAULT now()
```

**Why this shape:**

- **Owned by the Job, one per Job.** The Summary is a Job-level digest (`CONTEXT.md`); `job_id` as the
  primary key (not a surrogate id) enforces the **one-Summary-per-Job** rule structurally — a second
  insert for the same Job is a key conflict, not a silent duplicate. `save` is an upsert
  (`onConflictDoUpdate` on `job_id`) so a re-entrant run is idempotent.
- **A re-run is a new Job id with its own row.** Immutable history matches the rest of the pipeline
  (Foundation's "a re-run is a brand-new `Job.create` → new id → its own rows").
- **A separate table, not a column on `jobs`.** The Summary's *absence* is the normal degraded
  outcome; a missing row reads cleanly as "no digest" via `findByJobId` returning `null`, without a
  nullable sentinel column on the `jobs` aggregate. It also keeps the Summary out of the frozen-anchor
  `jobs` row that "is written once at submit and never updated."
- **Read by PRD 7 as a per-Job read model.** The Result page's "Enhancement details summary" slot is a
  single `findByJobId(jobId)` read; one row keyed by Job is the cheapest possible read model for it.
- **`summary` holds only the validated digest string** — never raw model output, never snippet text
  (anti-echo). The schema-validated `Summary.summary` is the only thing written.

The `FK → jobs(id)` plus `ON DELETE CASCADE` (if Foundation cascades) keeps a Job and its Summary's
lifetimes aligned. No change to `results`, `warnings`, or `resolved_identity`.

### `SummaryRepository` (Drizzle — `summary.repository.ts`)

- **`save(jobId, summary)`** — `insert into summaries (job_id, summary) values (...)
  .onConflictDoUpdate({ target: summaries.jobId, set: { summary } })`. The `job_id` PK conflict target
  enforces one-per-Job; the upsert makes a re-entrant stage run idempotent.
- **`findByJobId(jobId)`** — `select { summary } from summaries where job_id = :jobId`; maps a missing
  row to `null` (the degraded/absent reading PRD 7 renders gracefully).

### Anthropic Haiku adapter (`summarise.adapter.ts`)

Wraps the `@anthropic-ai/sdk` for **one** `messages.create` per Job against **Haiku**. It owns all
client specifics: API key from `ANTHROPIC_API_KEY`, model id, an `AbortController`/timeout, and the
prompt that turns the `SummariseInput` (the surviving snippets + each Result's takeaway + sentiment,
framed by `companyName`) into a request for a **single coverage digest across all the surviving rows**.
It requests structured output and **parses the response through `summarySchema`**:

- On a valid parse → `{ ok: true, summary }`.
- On a transport / quota / SDK error, a timeout, **or** a schema-validation failure → `{ ok: false }`
  (the typed failure the application maps to `summariseFailed`). **Never throws** above the port.

It emits GenAI call metadata (model id, token usage, finish reason — for PRD 8's child span and the
derived cost) **without** ever putting the raw prompt, raw completion, or snippet text into a persisted
column or a value destined to become a span attribute (anti-echo). Nothing above the port knows the
`@anthropic-ai/sdk` shape. The digest is over **snippets** — the adapter is never handed Extracted full
page text (that is the deferred Research-API option, ADR 0002).

### DI wiring (`app-worker.module.ts` *modify*)

Register the Anthropic adapter (→ `SUMMARISE_PORT`), the Drizzle `SummaryRepository`
(→ `SUMMARY_REPOSITORY`), and a `SummariseConfig` provider from `@nestjs/config` (model id, timeout,
the digest length bound). Construct `SummariseStage` from `SUMMARISE_PORT` + `SUMMARY_REPOSITORY` + the
existing `RESULT_REPOSITORY` provider (reused for `findIncludedForSummary` — no new Result repository),
and register it **fifth / last** in the `StageRunner`'s ordered list:
`[ResolveStage, SearchStage, FilterStage, AnalyzeStage, SummariseStage]`. `.env.example` gains
`SUMMARISE_MODEL`, `SUMMARISE_TIMEOUT_MS`, and the digest-length bound. The Anthropic client is a
*worker* dependency shared with the `analyze` stage's Haiku adapters — same SDK, distinct adapter and
port.

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, the `summarise` Stage Span, the Haiku child span, and Warning span events are **PRD 8's**
to build (ADR 0004; see `docs/superpowers/specs/2026-06-09-observability-otel-design.md`). Summarise's
obligations are the *facts* those spans will read and the discipline they must not violate:

- The `summarise` Stage Span owns this stage; its `results.in` is the count of surviving Results
  digested and `warnings` is the stage's Warning list. Happy-path per-Result work produces no span and
  no event — there is no per-Result work here at all (the digest is Job-level).
- Its **single external call is ONE Haiku child span** carrying GenAI semantic-convention attributes
  (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.response.finish_reasons`) plus
  derived cost. There is at most one such child span per Job (zero on the empty path, since no call is
  made).
- A **failed or empty Summarise is an `OK` span with a `warning` span event** (`warning`,
  `warning.type` = `summarise.summarise_failed` / `summarise.summarise_empty`), **never** a span-status
  `ERROR` and never a Bugsink issue — a Warning is a partial *success* (`CONTEXT.md` Signal Split).
- **Anti-echo:** no raw prompt, completion, or snippet text ever enters the `summary` column, a log
  line, or any value destined to become a span attribute — counts, model id, finish reason, cost, and
  the Zod-validated `Summary` only.

This section states facts and the anti-echo rule; it builds no spans.

---

## Error handling

- **Summarise never fails the Job.** It throws no `JobFailedError` on any named condition. The
  reviewable list is the Job's purpose and it always still exists, so every Summarise shortfall is a
  Warning (partial success), never a failure.
- **The empty case** (zero surviving `included` Results) → one `summariseEmpty` Warning, Summary
  absent, **return normally**. This is the all-Excluded Job's `done_with_warnings` flag — an honest
  empty finding, never `failed` (a judged population narrowed to zero is *not* "nothing to show";
  `CONTEXT.md` / Foundation).
- **The production failures** — the adapter call erroring *or* the model's output failing
  `summarySchema` validation — are **values, not throws**: the adapter returns `{ ok: false }`, the
  shell records one `summariseFailed` Warning and returns normally. The Summary is absent; nothing is
  written to `summaries`. The Job still reaches a terminal state with the list intact.
- **Idempotency / re-entrancy** is the repository's PK-conflict upsert: a second stage run re-reads the
  same `included` pool, re-produces a Summary, and `save` overwrites the single row rather than
  duplicating it — there is never more than one live Summary for a Job.
- **A missing prerequisite** (the `results` rows / Enhancement columns the `analyze` stage writes are
  absent because `analyze` did not run) is an ordering fault, not a degraded path — but Summarise
  reads it benignly: zero `included` rows is simply the empty case (a Warning), and a surviving row
  with `null` Enhancement fields is digested as snippet-only. Summarise never crashes on missing
  upstream data.

---

## Testing strategy

TDD throughout — failing test first; assert on **observable outcomes** (which Results feed the digest,
whether a Summary was stored, which Warning was recorded, that the Job is still terminal), never on
which private method ran. This is a single-call stage, so the suites are small and proportionate.

**Vitest unit (no I/O), `SummarisePort` and repositories faked:**
- *`selectSummariseInput`*: given a **mixed-status** fixture (some `included`, some `excluded`), only
  the `included` rows appear in `input.items` — **Excluded Results never feed the digest**; each
  surviving row maps to its `snippet` + nullable `takeaway` + nullable `sentiment`; a surviving row
  with `null` Enhancement fields is included as snippet-only; `companyName` is carried; order
  preserved; pure (same inputs → same output, no I/O).
- *`SummariseStage` orchestration* (the integrating suite) with a fake port + fake repositories — one
  test per outcome:
  - **healthy digest**: ≥1 surviving Result → exactly **one** `summarise` call → a validated `Summary`
    is saved once via `SummaryRepository.save(jobId, ...)`; **no** Warning; the Job is still terminal.
  - **empty case**: zero `included` Results → **no** `summarise` call, **no** `save`, one
    `summarise.summarise_empty` Warning, the Job still reaches a terminal state (proves the
    all-Excluded Job ends `done_with_warnings`, not `failed`).
  - **adapter error**: the port returns `{ ok: false }` → one `summarise.summarise_failed` Warning, the
    Summary **absent** (no `save`), the Job still terminal — Summarise never throws `JobFailedError`.
  - **Zod-validation failure**: the port returns `{ ok: false }` for output that violated
    `summarySchema` → the same `summarise_failed` Warning, Summary absent, Job terminal (the
    application treats the adapter's typed failure identically however it arose).
  - **exactly one Summary per Job**: a healthy run saves exactly one row keyed by `jobId`; a re-entrant
    run upserts (the fake repository enforces the PK conflict) — never two live Summaries.
  - **Excluded never feed it (at the stage)**: a fixture where Excluded rows carry tempting
    snippets/takeaways → those rows are absent from the `SummariseInput` the fake port receives.
  - **never per-Result**: assert the port is called **at most once** per `run` regardless of how many
    surviving Results there are (one call per Job, not per Result).

**Vitest contract test (the Anthropic Haiku adapter), SDK stubbed:**
- A representative **snippets-plus-Enhancements** input → a stubbed structured response parses through
  `summarySchema` to a valid `Summary` (`{ ok: true, summary }`), and emits GenAI call metadata.
- An SDK / transport error → `{ ok: false }` (the typed failure the application maps to
  `summarise_failed`); never throws.
- A **schema-violating** stubbed response (missing/empty/over-long `summary`) → `{ ok: false }`,
  nothing unvalidated returned.
- **Anti-echo**: given a stubbed completion containing injected free text, assert the adapter persists
  / returns only the schema-validated digest and that no raw completion, prompt, or snippet text
  escapes the boundary into a returned value or a metadata field.

**Vitest integration — Testcontainers (real Postgres):** `save` writes one `summaries` row keyed by
`job_id`; a second `save` for the same Job **upserts** (one row, updated `summary`) — the one-per-Job
PK invariant holds at the SQL level; `findByJobId` returns the stored `Summary`, and `null` for a Job
with no Summary; `findIncludedForSummary` returns only `status = 'included'` rows with their `snippet`
/ `takeaway` / `sentiment`, excluding every `excluded` row; a re-run (new Job id) writes its own row,
unaffected by another Job's Summary. (Reuses the shared compose Postgres per ADR 0008.)

**Optional Autoevals (digest quality) — a quality gauge, not a unit gate.** A small graded suite checks
the produced Summary is **faithful to and grounded in** the supplied snippets (no claims absent from the
input; reflects the aggregate coverage rather than one row's takeaway). It runs in the eval harness
against representative inputs, **out of the deterministic unit path** (it scores LLM quality, not
control flow).

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file (every non-test file
assessment `OK`); `OTEL_SDK_DISABLED=true` in test/CI.

---

## Out of scope (deferred)

- **The Tavily Research API integration** — deferred (ADR 0002), **not** wired here. ADR 0002 names
  *this* stage as the Research API's natural future re-entry point: if snippet-based digests prove too
  thin, the Research API's synthesized-report-with-citations shape could feed Summarise to produce a
  richer Job-level digest. **Because Summarise is a port with a swappable adapter, that future change
  is an alternative adapter behind the same `SummarisePort`, not a re-architecture** — a documented
  future option, not current scope. Do not build it here.
- **Full-text-based digesting.** The Summary is over **snippets** (plus each Result's Enhancement);
  reading Extracted full page text into the digest is explicitly not done today — it is the
  Research-API-shaped future option above.
- **The per-Result Enhancement takeaway and Sentiment.** Produced by the `analyze` stage's Enhance in
  the post-Extract full-text re-pass (PRD 5,
  `docs/superpowers/specs/2026-06-09-verify-extract-classify-enhance-design.md`). Summarise *consumes*
  them as input; it does not produce or own them. The Summary is a different thing from a takeaway
  (`CONTEXT.md`: never a "result summary").
- **Verify / Extract / Classify / Enhance, Filter & Collapse, Search, Resolve** — all upstream;
  Summarise consumes their settled `included` Results and writes only the `summaries` row.
- **The Result page's rendering of the Summary** (and its graceful render of the absent/degraded case)
  — PRD 7 (`docs/superpowers/specs/2026-06-09-web-ui-sse-design.md`). Summarise only produces and
  stores the digest, read via `SummaryRepository.findByJobId`.
- **OTel span emission** — PRD 8 (`docs/superpowers/specs/2026-06-09-observability-otel-design.md`).
  Summarise leaves the facts (one Haiku child span; failed/empty = `OK` + `warning` event) and the
  anti-echo discipline; it creates no spans.

## Vocabulary guardrails (from `CONTEXT.md`)

- The **Summary** is the **one Job-level digest** — the Result page's "Enhancement details summary".
  Never a "**result summary**" (that is the per-Result Enhancement **takeaway**, a different thing). One
  Summary per Job.
- The digest is over the surviving Results' **snippets**, plus each Result's **Enhancement**
  (`takeaway` + `sentiment`) — **never** Extracted full page text.
- Only **`included`** Results feed the digest; an **Excluded** Result never does. ("Excluded" is the
  soft, coded transition — never "dropped"/"deleted"/"filtered out".)
- A failed or empty Summarise is a **Warning** — a partial *success*, never an "error" and never a Job
  failure. The empty case is the Warning that flags an all-Excluded Job `done_with_warnings`; a
  judged-population-narrowed-to-zero is *not* "nothing to show".
- A **Job** *contains* the Summarise stage; the stage is never the "Summary" itself, and the Summary is
  never a "search" or a "task".
- **Anti-echo:** only the Zod-validated `Summary` is persisted; no raw prompt, completion, or snippet
  text ever reaches the `summary` column, a log line, or a future span attribute.
