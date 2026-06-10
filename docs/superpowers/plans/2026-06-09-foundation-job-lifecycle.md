# Foundation & Job Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status (2026-06-10): IMPLEMENTED.** Foundation shipped ahead of this plan file being
> written (the design spec served as the working plan). This document is the retrospective
> build sequence — the spec remains the source of truth for *what* and *why*; this records
> the *order* the other seven plans (PRDs 2–8) build on top of. Boxes are checked to reflect
> the landed implementation.

**Goal:** Ship the durable, observable spine of Breakbeat — a **Job** with a frozen company anchor and a real state machine, persisted in Postgres, enqueued from `breakbeat-web`, executed in `breakbeat-worker` through an **empty in-process sequential pipeline**, reaching exactly one terminal state (`done` / `done_with_warnings` / `failed`) and observable across the process boundary. The tracer bullet PRDs 2–6 plug stages into.

**Architecture:** Hexagonal (ports & adapters) on NestJS 11 — `domain` (pure), `application` (use-cases + port interfaces + stage runner), `infrastructure` (Drizzle/BullMQ/ioredis adapters), `interface` (two NestJS entrypoints, DI wiring, HTTP surface). Single package, two entrypoints (`main.web.ts`, `main.worker.ts`) over a shared `src/`.

**Tech Stack:** TypeScript, NestJS 11, Zod, Drizzle/Postgres, BullMQ + ioredis, app-minted UUIDv7, Vitest (unit + integration), Playwright (e2e), Biome, FTA.

**Spec:** `docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`
**PRD:** `docs/prd/01-foundation-job-lifecycle.md` · **ADRs:** 0004 (OTel / process model), 0006 (SSE Redis bridge), 0008 (test tiers)

---

## Prerequisites (read before starting)

- Greenfield: this is the first code in `src/`. Every later PRD plan lists Foundation as a hard prerequisite.
- **Test tiers (ADR 0008):** unit `*.test.ts` (pure domain + port-faked application, no I/O); integration `*.integration.test.ts` against the dev compose Postgres/Redis (isolated by truncation, **not** Testcontainers); e2e `*.e2e.ts` via Playwright. `pnpm verify` is the hermetic chain only: Biome → tsc → FTA → `test:unit`.
- **Commit discipline:** one commit per task (after its tests pass). DRY, YAGNI, TDD. Set `OTEL_SDK_DISABLED=true` in the test environment.

---

## Task 1: Domain value objects — `CompanyAnchor`, `Warning`, errors, `JobState`

**Files:** `src/domain/job/company-anchor.ts` (+ test), `src/domain/job/warning.ts`, `src/domain/job/job-errors.ts`, `src/domain/job/job-state.ts`

- [x] **Step 1:** `CompanyAnchor` discriminated union (`disambiguated` | `name_only`) with `Provenance`, plus `disambiguatedAnchor` / `nameOnlyAnchor` smart constructors; test the freeze and provenance rules.
- [x] **Step 2:** `Warning` value object `{ type, message }` (frozen) — a partial *success*, never an error.
- [x] **Step 3:** `JobState` union + `TERMINAL_STATES` / `isTerminal`; `IllegalTransitionError`.

## Task 2: The `Job` aggregate

**Files:** `src/domain/job/job.ts` (+ `job.test.ts`)

- [x] **Step 1:** Write `job.test.ts` covering the state machine: `pending → running → {done, done_with_warnings, failed}`, terminal states absorbing, `done` vs `done_with_warnings` *derived* from the warning list at `complete`, `recordWarning` legal only while `running`.
- [x] **Step 2:** Implement `Job` with a private constructor, no public setters, `create` / `fromPersistence` / `toSnapshot`, and a defensive-copy `warnings` getter (the aggregate owns the only mutable list).

## Task 3: Application ports

**Files:** `src/application/ports/{clock,id-generator,job-queue,job-repository,job-event-publisher,read-models}.port.ts`, `src/application/pipeline/stage.port.ts`, `src/application/pipeline/run-context.ts`

- [x] **Step 1:** `Clock`, `IdGenerator` (`uuidv7()`), `JobQueue` (producer; `{ jobId }` message), `JobRepository` (`save` / `findById` / `delete`), `JobEventPublisher` (status nudge), `ReadModels`.
- [x] **Step 2:** `Stage` port (named unit of pipeline work over a `RunContext`) and `RunContext`.

## Task 4: `StageRunner` — the warn-vs-fail mechanism

**Files:** `src/application/pipeline/stage-runner.ts` (+ test)

- [x] **Step 1:** Test that a stage returning warnings records them (not failure), an empty pipeline reaches `done`, and a thrown stage error drives `fail` with a reason.
- [x] **Step 2:** Implement the sequential in-process runner.

## Task 5: Use-cases — `submitJob` (web) and `runJob` (worker)

**Files:** `src/application/submit-job.usecase.ts` (+ test), `src/application/submit-job.input.ts`, `src/application/run-job.usecase.ts` (+ test)

- [x] **Step 1:** `submit-job.input.ts` — Zod schema + `toCompanyAnchor` (bare name → `name_only`; URL/bare domain → `disambiguated` `url_provided`; `brandId`+`domain` → `picked`).
- [x] **Step 2:** `submitJob` — validate, freeze anchor, persist `pending`, enqueue exactly one unit; **compensate (delete) the orphaned pending Job if enqueue fails** (best-effort; the enqueue error surfaces).
- [x] **Step 3:** `runJob` — load Job, `start`, run the pipeline via `StageRunner`, reach a terminal state, save.

## Task 6: Durable schema (Drizzle/Postgres)

**Files:** `src/infrastructure/persistence/schema.ts`, `drizzle.config.ts`, `drizzle/` migrations

- [x] **Step 1:** All four concerns defined now so the shape is stable: `jobs` (frozen anchor columns), `warnings` (append-only, `(job_id, seq)` unique for re-delivery idempotency), `results` (born-`included`, closed exclusion-code set, match-score range check, `(job_id, normalized_url)` unique), `resolved_identity` (minimal placeholder for PRD 2). PRD 1 only *writes* `jobs` and `warnings`.

## Task 7: Adapters — repository, queue, event publisher, system ports

**Files:** `src/infrastructure/persistence/{database,job.mapper,job.repository,read-models}.ts`, `src/infrastructure/queue/job.queue.ts`, `src/infrastructure/events/redis-event.publisher.ts`, `src/infrastructure/redis/redis.connection.ts`, `src/infrastructure/system/{system-clock,uuid-id-generator}.ts` (+ integration tests)

- [x] **Step 1:** `DrizzleJobRepository` — upsert `jobs` (mutable columns only; frozen anchor never updated), keyed append-only `warnings` sync, `delete` (FK cascade). Integration test round-trips, warning idempotency, delete-cascade.
- [x] **Step 2:** BullMQ producer + ioredis publisher (publish side only — no subscriber yet), pinned `ioredis@5.10.1` to match BullMQ's exact pin. Integration tests for enqueue and publish.
- [x] **Step 3:** `SystemClock`, `UuidV7IdGenerator`.

## Task 8: Interface — two entrypoints, DI wiring, HTTP surface

**Files:** `src/main.web.ts`, `src/main.worker.ts`, `src/app-web.module.ts`, `src/app-worker.module.ts`, `src/interface/**`, `src/instrumentation.ts`

- [x] **Step 1:** `breakbeat-web` — `POST` submit + `GET /jobs/:id` (the tracer-bullet observable surface); `breakbeat-worker` — BullMQ consumer (`concurrency: 1`) driving `runJob`.
- [x] **Step 2:** DI tokens + core providers wiring ports to adapters; `instrumentation.ts` OTel bootstrap; graceful shutdown of Redis/Postgres connections.

## Task 9: End-to-end tracer bullet

**Files:** Playwright `*.e2e.ts` (browser-driven form POST → observe terminal via `GET /jobs/:id`)

- [x] **Step 1:** Submit a Job through the web form, poll the status surface, assert it reaches a terminal state through the empty pipeline.

---

## Out of scope (deferred to later PRDs)

Resolve (PRD 2), Search (PRD 3), Filter & Collapse (PRD 4), Verify/Extract/Classify/Enhance (PRD 5), Summarise (PRD 6), the full Web UI & live SSE delivery (PRD 7), and the full OTel instrumentation contract (PRD 8). Foundation ships only the spine and the empty pipeline they plug into.
