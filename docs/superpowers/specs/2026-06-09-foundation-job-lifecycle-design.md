# Foundation & Job Lifecycle — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/01-foundation-job-lifecycle.md`
**ADRs:** 0004 (OTel / process model), 0006 (SSE Redis bridge)
**Status:** approved — ready for implementation plan

> This is the *technical* design beneath PRD 1. The product design (problem, solution,
> user stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and the ADRs and
> is not re-litigated here. This document fixes the module boundaries, port interfaces,
> the stage-runner contract, the durable schema, and the test strategy.

---

## Goal

Ship the durable, observable spine of Breakbeat: a **Job** with a frozen company anchor and a
real state machine, persisted in Postgres, enqueued from `breakbeat-web`, executed in
`breakbeat-worker` through an **empty in-process sequential pipeline**, reaching exactly one
terminal state (`done` / `done_with_warnings` / `failed`) and observable across the process
boundary. No research stages exist yet — this is the tracer bullet that PRDs 2–6 plug into.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Unit test framework | **Vitest** (pure domain + port-faked application) |
| Integration test framework | **Vitest** against **real Postgres/Redis** via **Testcontainers** |
| End-to-end test | **Playwright** — the tracer bullet only (browser-driven form POST → observe terminal) |
| Backing-service provisioning in tests | **Testcontainers** (ephemeral, hermetic, parallel-safe) |
| Job identity | **App-minted UUIDv7** (domain owns identity; time-sortable; index-friendly) |
| Process / source layout | **Single package, two NestJS entrypoints**, shared hexagonal `src/` |
| Redis status-nudge publisher | **In scope** (port + thin adapter; publish side only, no subscriber) |
| Tracer-bullet observable surface | **`GET /jobs/:id`** (DB assertions stay in layer-specific integration tests) |

These supersede the stale `@types/jest` in `package.json`: the plan adds `vitest`,
`@playwright/test`, `@testcontainers/postgresql`, `@testcontainers/redis`, a UUIDv7 source,
and removes `@types/jest`.

---

## Architecture

Hexagonal (ports & adapters) on NestJS 11. Three concentric layers plus a thin interface layer:

- **domain** — pure TypeScript. No framework, no I/O, no NestJS decorators. The `Job`
  aggregate and its value objects live here and are the richest test target.
- **application** — use-cases and the port *interfaces* they depend on. The stage runner and
  the `Stage` port live here. Depends only on `domain` + its own ports.
- **infrastructure** — adapters that *implement* the ports: Drizzle/Postgres repository,
  BullMQ producer/consumer, ioredis event publisher, `Clock`/`IdGenerator`.
- **interface** — NestJS controllers/bootstraps that wire DI and expose the HTTP surface.

The dependency arrow always points inward: `interface → application → domain`, with
`infrastructure` implementing `application`'s ports. The domain never imports BullMQ, Drizzle,
ioredis, or `@nestjs/*`.

### Source layout

```
src/
  domain/job/
    job.ts                      # Job aggregate (state machine + warning list)
    job-state.ts                # JobState union + terminal-state predicate
    company-anchor.ts           # frozen value object (disambiguated | name-only)
    warning.ts                  # Warning value object
    job-errors.ts               # IllegalTransitionError, JobFailedError
  application/
    ports/
      job-repository.port.ts     # save / findById
      job-queue.port.ts          # enqueue (producer)
      job-event-publisher.port.ts# publish id-only status nudge
      clock.port.ts              # now() — injected for deterministic tests
      id-generator.port.ts       # uuidv7()
    pipeline/
      stage.port.ts              # uniform Stage interface
      run-context.ts             # { job, recordWarning(); resolvedIdentity reserved }
      stage-runner.ts            # ordered, in-process, sequential runner
    submit-job.input.ts          # Zod schema → CompanyAnchor
    submit-job.usecase.ts
    run-job.usecase.ts
  infrastructure/
    persistence/
      schema.ts                  # Drizzle schema: jobs, results, resolved_identity, warnings
      job.repository.ts          # JobRepository impl over Drizzle
      drizzle.module.ts          # connection + provider wiring
    queue/
      job.producer.ts            # JobQueue impl (BullMQ)
      job.worker.ts              # BullMQ consumer binding runJob
      queue.module.ts
    events/
      redis-event.publisher.ts   # JobEventPublisher impl (ioredis pub/sub)
    system/
      system-clock.ts            # Clock impl
      uuid-id-generator.ts       # IdGenerator impl (uuidv7)
  interface/web/
    jobs.controller.ts           # POST /jobs, GET /jobs/:id
    jobs.view.ts                 # minimal render of Job state
  app-web.module.ts              # web DI graph
  app-worker.module.ts           # worker DI graph
  main.web.ts                    # HTTP bootstrap
  main.worker.ts                 # worker bootstrap
  instrumentation.ts             # empty OTel seam (node --import on both entrypoints)
```

---

## Domain

### `Job` aggregate

The deep core. Behavioural interface — no public setters; callers cannot push it into an
illegal state.

- `Job.create(id, anchor, now)` → state `pending`, empty warning list, `createdAt = now`,
  frozen `anchor`. `startedAt`/`terminalAt`/`failureReason` null.
- `start(now)` → `pending → running`, sets `startedAt`. From any other state throws
  `IllegalTransitionError`.
- `recordWarning(warning)` → appends to the warning list. Legal only while `running`.
- `complete(now)` → from `running`, derives terminal state: **`done` iff the warning list is
  empty, else `done_with_warnings`**; sets `terminalAt`. The caller never chooses which.
- `fail(reason, now)` → from `running`, state `failed`, stores `failureReason`, sets
  `terminalAt`.
- Terminal states (`done`, `done_with_warnings`, `failed`) are **absorbing** — `start`,
  `recordWarning`, `complete`, `fail` all throw from a terminal state.
- The `anchor` is exposed read-only and frozen at construction; there is no API to mutate it.

Reconstitution for the repository: `Job.fromPersistence({ id, anchor, state, warnings,
timestamps, failureReason })` rebuilds an aggregate from a stored row without re-running
transitions (so loading a `done` Job doesn't throw). This is the only constructor the
repository uses on read.

**Single source of truth for warnings:** the aggregate owns the warning list. The runner's
"warning sink" is just `RunContext.recordWarning()` delegating to `job.recordWarning()` — there
is never a second list to reconcile.

### `CompanyAnchor` value object

Immutable discriminated union (`readonly` fields + `Object.freeze` at construction):

```ts
type CompanyAnchor =
  | { kind: "disambiguated"; domain: string | null; brandId: string | null; provenance: Provenance }
  | { kind: "name_only"; name: string; provenance: "name_only" };

type Provenance = "picked" | "url_provided" | "name_only";
```

- `disambiguated` carries at least one of `domain` / `brandId` (the Zod input layer guarantees
  this). `provenance: "url_provided"` records that the host came from a pasted URL — later
  stages and Warnings reason about how much the user already gave us (`CONTEXT.md` Resolved
  Identity).
- `name_only` is the explicit degraded fallback.
- The anchor is copied verbatim into a re-run's new Job; it is never re-derived.

### `Warning` value object

`{ type: string; message: string }` — a stage's partial-success note. A Warning is a partial
*success*, never an error (`CONTEXT.md`).

### Errors

- `IllegalTransitionError(from, attempted)` — thrown by the aggregate on any illegal transition.
- `JobFailedError(reason)` — the **explicit "nothing to show" signal** a stage throws to fail
  the Job. Distinct from an unexpected throw so the runner can record an honest reason.

---

## Application

### `Stage` port

The uniform interface every later PRD's stage implements:

```ts
interface Stage {
  readonly name: string;          // 'resolve' | 'search' | ... (closed set lands per-stage)
  run(ctx: RunContext): Promise<void>;
}
```

A stage does its work, calls `ctx.recordWarning(...)` for any recoverable shortfall, and
**returns normally on success**. To fail the Job it throws `JobFailedError(reason)`.

### `RunContext`

```ts
interface RunContext {
  readonly job: Job;
  recordWarning(warning: Warning): void;   // delegates to job.recordWarning
  // resolvedIdentity?: ResolvedIdentity   // reserved for PRD 2; absent in PRD 1
}
```

Minimal now; the `resolvedIdentity` slot is the documented extension point for PRD 2 so later
stages thread shared run state without reshaping the runner.

### `StageRunner` — the warn-vs-fail mechanism

Holds an **ordered** list of `Stage`s (empty in PRD 1) and runs them **in-process and
sequentially** against one `RunContext`. The policy (tested exhaustively here with fakes):

| Stage outcome | Runner behaviour |
|---|---|
| Returns normally (no warnings) | Continue to next stage |
| Returns normally after `ctx.recordWarning(...)` | Continue; warning is on the Job |
| Throws `JobFailedError(reason)` | Stop; signal Job failure with `reason` |
| Throws anything else (unexpected) | Stop; signal Job failure, reason records the throw |
| **Empty stage list** | Complete with no warnings → `done` (the tracer-bullet path) |

The runner reports its outcome to the `runJob` use-case (success, or failure-with-reason);
the use-case applies `complete()` / `fail()` to the aggregate. The runner never persists.

**Division of responsibility:** the *thresholds* ("is my population empty / did all my queries
fail?") belong to each later stage — only the stage knows its population. The *mechanism*
(how a failure or an unexpected throw becomes a `failed` Job, how warnings accrue, that a
recoverable shortfall is a Warning not a failure) lives here, once, well-tested. This is the
`CONTEXT.md` Warning rule expressed as runner policy: a judged-population-narrowed-to-zero is
*not* a runner concern — a stage that produced an empty-but-valid result simply returns
normally (and may Warn), and the Job ends `done` / `done_with_warnings`.

### `submitJob` use-case (web side)

1. Validate raw input with the Zod schema (`submit-job.input.ts`).
2. Construct the correct `CompanyAnchor` shape from the validated input.
3. `Job.create(idGen.uuidv7(), anchor, clock.now())`.
4. `jobRepository.save(job)` — persists `pending`.
5. `jobQueue.enqueue({ jobId: job.id })` — exactly one unit of work.
6. Return the Job id.

Repository and queue are ports; the web controller calls this use-case.

### `runJob` use-case (worker side)

1. `jobRepository.findById(jobId)` → aggregate (or fail fast if absent).
2. `job.start(clock.now())`; `jobRepository.save(job)`; `publisher.publish({ jobId, kind: "status" })`.
3. `stageRunner.run({ job, recordWarning })`.
4. On runner success → `job.complete(clock.now())`; on runner failure → `job.fail(reason, clock.now())`.
   Either way an unexpected throw escaping the runner is caught and routed to `fail`.
5. `jobRepository.save(job)`; `publisher.publish({ jobId, kind: "status" })`.

The publish-after-write call sites are established here so PRD 7 adds only the *subscriber*.

### Input validation (`submit-job.input.ts`)

Zod schema accepting either a name, a domain, or a disambiguated `{ domain?, brandId? }` with
provenance; rejects blank/garbage. Maps validated input to a `CompanyAnchor`:
- a pasted URL → `disambiguated` with `provenance: "url_provided"`, host extracted as `domain`;
- a picked brand/domain → `disambiguated` with `provenance: "picked"`;
- a bare name with nothing resolvable → `name_only`.

(The disambiguation *interaction* — autocomplete, Brand Search options, homepage fetch — is
PRD 2. PRD 1 only constructs the frozen anchor from whatever the input already carries.)

---

## Infrastructure

### Schema (Drizzle/Postgres)

All four durable concerns are defined now so the shape is stable; **PRD 1 only writes `jobs`
and `warnings`.** `results` and `resolved_identity` are created with their invariants enforced
in the schema and exercised by integration tests, but no domain object populates them yet.

- **`jobs`** — `id` uuid PK (uuidv7, app-minted); anchor columns `anchor_kind`,
  `anchor_domain`, `anchor_brand_id`, `anchor_name`, `anchor_provenance`; `state`;
  `created_at`, `started_at` (nullable), `terminal_at` (nullable); `failure_reason`
  (nullable). Anchor columns are written once at submit and never updated.
- **`warnings`** — many per job: `id`, `job_id` FK, `type`, `message`, `created_at`.
- **`results`** — many per job, **defined with invariants in the schema**:
  - `status` enum `included | excluded`, **default `included`**;
  - a constraint enforcing the only legal status transition is *to* `excluded` (status check +
    repository never resurrects an excluded row — the born-`included`/`→excluded`-only rule);
  - `exclusion_code` enum, closed set: `own_channel | aggregator | ecommerce_review |
    out_of_window | duplicate | off_topic`, nullable;
  - `exclusion_detail` nullable text (records the *catcher*, e.g. `"LLM"` — never model free
    text; the anti-echo channel);
  - nullable stage columns: `match_score`, `verification_status`, `content_type`, `sentiment`,
    `takeaway` (NULL = "hasn't reached that stage", never a sentinel);
  - **unique index on `(job_id, normalized_url)`** — Search's insert-time URL dedup.
- **`resolved_identity`** — one row per job, reserved for PRD 2 (company name, own domains,
  handles, brand context, name collisions / negative boost). Created empty/unused now.

Exact column types, indexes, and migrations are adapter detail. The load-bearing invariants —
frozen anchor, born-`included` Result, closed exclusion-code set, warning-presence-drives-
terminal-state — are fixed here. Migrations via `drizzle-kit`.

### `JobRepository` (Drizzle adapter)

- `save(job)` — upserts the `jobs` row and **synchronises the `warnings` rows** (insert new
  warnings) in one transaction. Idempotent re-save of an unchanged Job is a no-op-equivalent.
- `findById(id)` — loads the `jobs` row + its `warnings` and reconstitutes via
  `Job.fromPersistence`.
- A re-run is a brand-new `Job.create` → new id → its own rows; the repository never mutates a
  prior Job's rows (immutable history).

### Queue (BullMQ / ioredis)

- `JobProducer` implements `JobQueue.enqueue({ jobId })` — one BullMQ job per Job, carrying the
  id only. Not a per-stage queue, not a Flow (ADR 0004).
- `job.worker.ts` is the BullMQ consumer: it claims the unit durably (BullMQ reservation) and
  invokes `runJob`. Stalled-job handling is left at BullMQ defaults so a worker restart
  re-claims rather than double-runs.
- The web and worker DI graphs share the queue *connection config* but only the web side
  registers the producer and only the worker side registers the consumer.

### `RedisEventPublisher` (ioredis adapter, ADR 0006)

Implements `JobEventPublisher.publish({ jobId, kind: "status" })` — an **id-only** nudge on a
per-Job channel, published **after** each committed state write. Fire-and-forget: it publishes
whether or not anyone is subscribed, carries no Result content or model text (anti-echo), and
does **not** participate in the Job Trace. No subscriber is built in PRD 1 (PRD 7 adds the web
SSE subscriber).

### `Clock` / `IdGenerator`

Injected ports (`SystemClock`, `UuidIdGenerator` using a UUIDv7 source) so the domain and
use-cases are deterministic under test.

---

## Interface

### `breakbeat-web` (`main.web.ts` + `app-web.module.ts`)

- `POST /jobs` — accepts form-encoded company input, runs `submitJob`, returns/redirects to the
  new Job (the `pending` view). Validation failure → 4xx with the Zod message.
- `GET /jobs/:id` — returns the Job's current state. Minimal by design (bare JSON or a tiny
  HTML fragment); it is the **observable surface the tracer bullet polls** and the seam PRD 7's
  read model grows from. The rich live UI, SSE, list views, profile card, etc. are all PRD 7.

### `breakbeat-worker` (`main.worker.ts` + `app-worker.module.ts`)

Hosts the BullMQ consumer only — no HTTP surface. Boots the worker DI graph (repository, queue
consumer, event publisher, stage runner with an empty stage list).

### `instrumentation.ts`

An empty module loaded via `node --import ./dist/instrumentation.js` on **both** entrypoints.
It establishes the load-before-app-modules seam ADR 0004 / PRD 8 fill in. Present now purely so
the process boundary and bootstrap order exist; it does nothing yet.

### Shutdown

Both processes handle `SIGTERM`/`SIGINT`: the worker drains its current Job before exiting; the
web app closes its HTTP server. (The telemetry-flush step ADR 0004 adds slots in after app
close — not implemented here, but the ordering hook exists.)

---

## Error handling

- **Illegal transitions** never reach the DB — the aggregate throws `IllegalTransitionError`
  before any persistence; use-cases let it propagate (it's a programming error, not a Job
  outcome).
- **A stage's `JobFailedError`** → `runJob` calls `job.fail(reason)` → `failed` with the reason
  persisted. The Job never hangs in `running`.
- **An unexpected throw inside the runner** → caught by `runJob`, routed to `job.fail` with a
  generic-but-recorded reason; the throw is re-surfaced to telemetry later (PRD 8), never
  swallowed silently.
- **A missing Job on `findById`** in the worker → fail fast (the enqueue contract guarantees the
  row was persisted before enqueue; absence is a real fault, not a silent skip).
- **Redis publish failure** → logged and swallowed (fire-and-forget; Postgres is the source of
  truth, ADR 0006). This is the *only* sanctioned silent failure in PRD 1.
- **Worker restart mid-Job** → BullMQ re-delivers the unclaimed/stalled unit; the Job is
  re-run from `running` claim, not double-completed.

---

## Testing strategy

TDD throughout — failing test first, assert on **observable state transitions and persisted
facts**, never on which private method ran.

**Vitest unit (no I/O):**
- *Job aggregate* (richest suite): fresh Job is `pending` with the exact anchor; `start`
  moves `pending → running` and is rejected from every other state; `complete` with no
  warnings → `done`; `complete` with ≥1 warning → `done_with_warnings`; `fail` → `failed` with
  reason; every illegal transition rejected; terminal states absorbing; `done` vs
  `done_with_warnings` proven as a property of the warning list, not a caller choice; anchor
  frozen/immutable; both anchor shapes representable with correct provenance.
- *Warning/terminal-state policy*: fake stages drive the runner — recoverable-shortfall stage →
  Warning + `done_with_warnings`; "nothing to show" stage (`throw JobFailedError`) → `failed`;
  unexpected-throw stage → `failed` with throw recorded; Classify-shaped total-failure fake →
  Warning only (proves a total non-essential stage failure never fails the Job).
- *Stage runner*: empty list → clean `done`; fakes run in registered order; shared context
  threaded; warnings accumulate; stops on a Job-failing condition.
- *Use-cases* with port fakes: `submitJob` validates via Zod (reject blank/garbage; accept a
  name; accept a disambiguated anchor), builds the right anchor, saves one `pending` Job,
  enqueues exactly one unit; `runJob` loads, starts, drives runner, persists derived terminal
  state, publishes status nudges.

**Vitest integration — Testcontainers (real Postgres):**
- Round-trip a Job (anchor shape + provenance, state, warnings, failure reason).
- Born-`included` default on Results; `included → excluded`-only constraint rejects illegal
  status; `(job_id, normalized_url)` unique constraint rejects a duplicate insert.
- Re-run produces a new Job id with its own rows; the prior Job's rows are unchanged.

**Vitest integration — Testcontainers (real Redis):**
- Enqueue one unit → worker claims → transitions → reaches terminal.
- Thrown stage → `failed`, never stuck `running`.
- Worker restart does not double-run a claimed Job.
- Event publisher: a test subscriber on the per-Job channel receives the id-only status nudge
  after a state write.

**Playwright — the tracer bullet (the PRD's acceptance test):**
- POST the form on `breakbeat-web` → assert a `pending` Job → let `breakbeat-worker` drain the
  empty pipeline → assert the Job reaches `done` and is observable via `GET /jobs/:id`.

**Gates:** Biome (format + lint) and `tsc` clean; every file keeps an FTA complexity
assessment of `OK`. `OTEL_SDK_DISABLED=true` in test/CI. Autoevals is **not** used in PRD 1
(it scores the later LLM precision/recall work).

---

## Out of scope (deferred to later PRDs)

- The disambiguation **interaction** (autocomplete, Brand Search, homepage fetch, collisions) —
  PRD 2. PRD 1 owns only the frozen anchor.
- All actual pipeline **stages** — PRDs 2–6. PRD 1 ships the empty runner skeleton.
- **SSE subscriber / live UI** beyond the bare submit POST + minimal `GET /jobs/:id` — PRD 7.
  (PRD 1 ships the *publish* side of the Redis channel only.)
- **OpenTelemetry** spans, the enqueue→worker span link, metrics, the Bugsink/otel-lgtm split —
  PRD 8 / ADR 0004. PRD 1 ships only the empty `instrumentation.ts` seam and the process
  boundary.
- Result-level domain values (Match Score, Verification, Content Type, Sentiment, Enhancement,
  Collapse, Negative Boost) — their columns are reserved; behaviour is later PRDs.
- Auth, multi-tenancy, rate limiting, scheduled/recurring Jobs, and a first-class one-click
  re-run affordance.

## Vocabulary guardrails (from `CONTEXT.md`)

- A Result is **Excluded** (soft, with a code) — never "dropped", "deleted", or "filtered out".
- A **Warning** is a partial *success* — never an "error"/"failure".
- "Fetch" is reserved for the Resolve homepage fetch (PRD 2) — nothing is fetched here.
- A **Job** *contains* stages; it is never a "search" or a "task".
- Keep the **anchor** (frozen at input) and the **Resolved Identity** (derived per-run, PRD 2)
  strictly separate in code and schema — conflating them reintroduces the disambiguation bug.
- `exclusion_detail` records the *catcher*, never model free text (the prompt-injection echo
  channel) — baked into the schema's intent now though LLM stages arrive later.
