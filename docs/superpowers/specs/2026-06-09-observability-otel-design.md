# Observability (OpenTelemetry) — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/08-observability-otel.md`
**ADRs:** 0004 (primary — OTel topology / signal split / status mapping / lifecycle), 0003 (the fused full-text Haiku call is one child span)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`) — cross-cuts **every** stage (Resolve, Search, Filter, Verify/Extract/Classify/Enhance, Summarise) and the Web UI / SSE delivery
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 8. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADRs 0004/0003 and is not
> re-litigated here. **Unlike the sibling specs, this is not a single new vertical slice** — there
> is no `domain/observability/` aggregate and no new pipeline stage. Observability is a
> cross-cutting concern that *weaves into* Foundation's existing seams (`instrumentation.ts`, the
> producer, the worker, `runJob`, the `StageRunner`, both entrypoints, both DI modules) and into
> every stage's already-declared facts. The hard design judgement — fixed below — is **how the
> Stage Span aggregates and the external-call child spans get emitted across the hexagonal
> boundary without the domain or the stages importing OTel.** Every stage spec already wrote an
> "Observability (deferred to PRD 8 — the seam only)" section listing the facts it upholds; this
> document consumes those seams and builds the emitters.

---

## Goal

Make one Job's whole pipeline run readable as a single **Job Trace** — Resolve → Search → Filter →
Verify/Extract/Classify/Enhance → Summarise, including the enqueue→worker hop — with external cost
and latency (Anthropic Haiku, Tavily search/extract, BrandFetch) attributed per call, rolled up per
**Stage Span**, and per Job; emit bounded-cardinality **metrics** for cross-Job spend and health;
ship **traces + logs + metrics** to otel-lgtm and **errors only** to Bugsink, correlated by
`trace_id`; map status to the domain so a **Warning** is an `OK` span event and only a genuine
throw or a Job-failing condition is `ERROR`; and do all of this **fail-soft** — a down Collector
never throws into or stalls the pipeline — with exactly **one** tracer-provider owner and the
**anti-echo** discipline inherited verbatim from the domain. Turning telemetry on must never change
product behaviour.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| SDK | OTel Node SDK (`@opentelemetry/sdk-node`) + `@opentelemetry/auto-instrumentations-node` (Express, ioredis, pg, undici) + **manual pipeline spans**. These packages are **not yet in `package.json`** — the plan adds them. `@sentry/nestjs`, `nestjs-pino`, `@nestjs/terminus` are already present |
| Tracer-provider owner | **Exactly one:** the OTel `sdk-node`. `@sentry/nestjs` runs with `tracesSampleRate: 0` (errors only). No `@envelop`/Yoga, no second hand-rolled SDK |
| Per-process identity | `service.name` = `breakbeat-web` (enqueue) / `breakbeat-worker` (execution), set in `instrumentation.ts` from an env switch |
| Trace topology | One **Job Trace** per Job. Producer injects `traceparent` into BullMQ job data; the worker opens a **new root span** `job.pipeline` carrying a **span link** back — link, **never** continue |
| Stage Span emission | A **tracing decorator around the `StageRunner`** opens/closes one Stage Span per stage and reads aggregates from the `ResultRepository` + the Job's warning list. The stage stays OTel-free |
| Child-span / event emission | An application-layer `PipelineTelemetry` port (no OTel types in its signature) injected into adapters (child spans for real external calls) and into stages (span events for outlier per-Result outcomes). The infrastructure adapter implements it over the OTel API |
| GenAI call shape (ADR 0003) | Each Haiku child span carries OTel GenAI conventions + derived `cost`; the fused full-text call is **one** child span with combined token/cost, never split three ways |
| Signal Split | Traces + logs + metrics → otel-lgtm Collector over **OTLP HTTP/protobuf on 4318**; errors → Bugsink via `@sentry/nestjs` (`tracesSampleRate: 0`); `@sentry/opentelemetry` stamps `trace_id` onto error events; logs via `nestjs-pino` → `pino-opentelemetry-transport` (→ Loki) **and** stdout |
| Metrics | `job.duration`/`stage.duration` **Histograms**; `job.completed`/`llm.tokens`/`llm.cost`/`external.request`/`results`/`warnings` **Counters**; `queue.depth` **observable gauge**. Closed label sets only |
| Status mapping | `recordException` + `ERROR` only on unexpected throw or Job-failing condition; Warning = `OK` span + `warning` event (`warning.type`); `done_with_warnings` = `OK` root; Bugsink fed by failures only |
| Sampling | `ParentBased(AlwaysOnSampler)` at 100%. Tail-sampling deferred to the Collector (out of scope) |
| Config / fail-soft | Standard `OTEL_*` env in `.env.example`; `OTEL_SDK_DISABLED=true` in test/CI; exporter retries-then-drops, never throws/blocks; a startup warning if SDK disabled or endpoint unset |
| Route hygiene | SSE stream route + Terminus health route excluded from HTTP span creation; SSE health is **metrics only** |
| Tests | In-memory span/metric exporter installed **within the test** (CI runs `OTEL_SDK_DISABLED=true`); no test depends on a live Collector/Tempo/Loki/Mimir/Bugsink. **Vitest** unit + integration |

---

## Architecture

Observability is **infrastructure that wires into application and interface seams** — it never
reaches into `domain`. The dependency arrow still points inward: the one application-layer abstraction
this design introduces is the `PipelineTelemetry` **port** (a plain interface, no OTel types in its
signature), which adapters and stages consume; the OTel implementation of that port and the SDK
bootstrap are **infrastructure**; the `StageRunner` tracing decorator, the `@sentry/nestjs` wiring,
and the route-hygiene hooks are wired in **interface** (the DI modules + entrypoints). The OTel
import surface is confined to `instrumentation.ts` and `src/infrastructure/observability/**` — no
`domain/**`, no stage, and no use-case ever imports `@opentelemetry/*`.

The central tension — **the stage produces the facts but the runner owns the Stage Span** — is
resolved two ways, deliberately split by *who knows what*:

1. **Aggregates the runner can observe externally** (`results.in`/`results.out`, `excluded.{code}`
   counts, `warnings`) are read by the **tracing decorator around the `StageRunner`** from the
   `ResultRepository` (counts before/after a stage) and the Job's warning list — the stage emits
   nothing. This is why each stage spec could legitimately defer "span emission" to PRD 8: the
   facts are already persisted (Result rows) or on the aggregate (warnings).
2. **Facts only the stage/adapter holds at the moment of work** (per-Haiku-call token/cost, an
   external call's latency/outcome, an outlier per-Result Exclusion or full-text Verify flip) are
   reported through the injected `PipelineTelemetry` port — the adapter mints the child span, the
   stage records the span event — onto whatever Stage Span the decorator currently has open
   (carried on the active OTel context, so neither needs a handle to it).

### Source layout

```
src/
  infrastructure/observability/
    sdk.ts                         # buildSdk(): NodeSDK — resource (service.name), OTLP HTTP exporter
                                   #   (4318), BatchSpanProcessor, ParentBased(AlwaysOnSampler),
                                   #   auto-instrumentations-node (Express/ioredis/pg/undici) + ignore hooks
    tracer.ts                      # the single tracer + getActiveSpan() helpers (thin re-export of the API)
    meter.ts                       # MetricsRegistry — the named instruments (histograms/counters/gauge)
    pipeline-telemetry.adapter.ts  # PipelineTelemetry impl over the OTel API (child spans + span events)
    stage-runner.tracing.ts        # StageRunnerTracing — decorates StageRunner: opens/closes Stage Span,
                                   #   reads results.in/out + warnings, records stage.duration + results
    job-trace.ts                   # injectTraceparent(jobData) / startJobPipelineSpan(jobData) — the link
    sentry.ts                      # initSentry(): @sentry/nestjs tracesSampleRate:0 + @sentry/opentelemetry
                                   #   trace_id stamping; reportFailure() helper (failures only)
    logging.ts                     # nestjs-pino LoggerModule config: pino-opentelemetry-transport + stdout
    sse-metrics.ts                 # active-connections gauge + messages-sent counter (Web UI consumes)
    startup-check.ts               # warnIfBlind(): startup warning when SDK disabled or endpoint unset
    shutdown.ts                    # flushSdk(timeoutMs): bounded SDK flush for the shutdown sequence
  application/observability/
    pipeline-telemetry.port.ts     # PipelineTelemetry interface + token (NO OTel types in the signature)
  application/pipeline/
    stage-runner.ts                # *modify* — expose the seam the tracing decorator wraps (no OTel import)
  instrumentation.ts               # *modify* — the empty Foundation seam becomes the real SDK bootstrap
  infrastructure/queue/
    job.producer.ts                # *modify* — inject traceparent into BullMQ job data at enqueue
    job.worker.ts                  # *modify* — open job.pipeline root span + span link before runJob
  application/run-job.usecase.ts   # *modify* — status mapping hook: complete→OK, fail→ERROR+recordException+Bugsink
  app-web.module.ts                # *modify* — initSentry, nestjs-pino, route-hygiene hooks, queue.depth gauge owner? (worker)
  app-worker.module.ts             # *modify* — initSentry, nestjs-pino, StageRunnerTracing decorator, PipelineTelemetry, queue.depth gauge
  main.web.ts                      # *modify* — shutdown order: close app → flush SDK
  main.worker.ts                   # *modify* — shutdown order: drain worker → close app → flush SDK
  interface/web/jobs.controller.ts # *modify* — SSE + health route-hygiene ignore-hook coordination; SSE health metrics
  # each adapter that makes a real external call — *modify* to accept PipelineTelemetry and mint child spans:
  infrastructure/anthropic/web-search-backstop.adapter.ts   # *modify* — Haiku/GenAI child span (Search backstop)
  infrastructure/tavily/tavily-search.adapter.ts            # *modify* — Tavily child span
  infrastructure/tavily/tavily-extract.adapter.ts           # *modify* — Tavily Extract child span (under analyze)
  infrastructure/anthropic/*.adapter.ts                     # *modify* — snippet-Verify / snippet-Classify / fused full-text / Summarise Haiku child spans
  infrastructure/brandfetch/*.adapter.ts                    # *modify* — BrandFetch child spans (Brand Search / Brand / Brand Context)
```

The `application/observability/pipeline-telemetry.port.ts` interface is the **only** observability
type the application layer and the adapters program against. Everything OTel-shaped lives under
`infrastructure/observability/`.

---

## Trace topology

**One Job Trace per Job.** The pipeline is one BullMQ job; stages run in-process and sequentially
(no per-stage queue, no BullMQ Flow — out of scope), so the only context that crosses a process
boundary is enqueue→worker. The vocabulary is **Job Trace** and **link** — never "request trace"
(there is no request; the unit is the Job) and never "continued trace."

**Link, never continue.** Two edits, two precise locations (`job-trace.ts` holds both helpers):

- **Producer (`job.producer.ts`, on `breakbeat-web`).** Before `queue.enqueue({ jobId })`,
  `injectTraceparent(jobData)` writes the active context's `traceparent` (and `tracestate`) into the
  BullMQ job data via the OTel `propagation` API. The enqueue itself happens inside the HTTP POST
  span auto-instrumentation already opened; the injected `traceparent` therefore points at that
  enqueue span.
- **Worker (`job.worker.ts`, on `breakbeat-worker`).** Before invoking `runJob`,
  `startJobPipelineSpan(jobData)` extracts the carried `traceparent` into a `Context`, derives a
  **`SpanContext`** from it, and starts a **new root span** named `job.pipeline` with
  `{ root: true, links: [{ context: enqueueSpanContext }] }`. `runJob` then executes inside this
  root span's context. The link records the causal enqueue→execution edge; it does **not** continue
  the enqueue trace.

**Why link, not continue (the load-bearing reason).** A continued trace would fold dead queue-wait
(and nonsensical re-run / scheduled timing) into the trace's measured duration. The new root keeps
`job.pipeline` duration equal to *actual pipeline wall-clock*, and the link preserves the navigable
edge from the enqueue side. **Test proof:** the worker span's `trace_id` **differs** from the
enqueue span's `trace_id`, and the worker span carries exactly one link whose `traceId` equals the
enqueue trace's.

`job.pipeline` is opened/closed in `job.worker.ts`; its **status** (OK vs ERROR) is set by the
`runJob` status-mapping hook (below), because `runJob` is where the terminal state and
`JobFailedError` are known.

---

## Span granularity

**One Stage Span per stage**, over the closed stage set `resolve | search | filter | analyze |
summarise`, opened and closed by the `StageRunnerTracing` decorator (named exactly the stage's
`Stage.name`). It is a child of `job.pipeline`. Each Stage Span carries the **aggregate** attributes:

- `results.in` — `included` count the stage received (decorator reads it from the `ResultRepository`
  *before* the stage runs; for `resolve`/`search` whose `results.in` is `0`/`n/a`, the decorator
  records `0`).
- `results.out` — `included` count after the stage (decorator reads it *after* the stage returns).
- `excluded.own_channel`, `excluded.aggregator`, `excluded.ecommerce_review`,
  `excluded.out_of_window`, `excluded.duplicate`, `excluded.off_topic` — per-code Exclusion deltas
  over the **closed exclusion-code set** (decorator computes the before/after delta per code; a stage
  that excludes nothing records nothing).
- `tokens.total`, `cost.total` — summed from the GenAI child spans this stage produced (the
  `PipelineTelemetry` adapter accumulates per active Stage Span).
- `warnings` — the count of Warnings this stage added to the Job's warning list (decorator diffs the
  warning list length before/after).

**`analyze` is the single Stage Span for the whole PRD-5 stage.** Verify / Classify / Enhance are
distinct *domain* stages but do **not** execute as three time-ordered stages — they run as
snippet-Verify + snippet-Classify (two cheap Haiku calls) → Tavily Extract → **one fused Haiku call**
that re-Verifies, re-Classifies, and Enhances together (ADR 0003). So:

- `analyze` `results.in` = the survivors **Filter handed it**; `results.out` = those still `included`
  after the **full-text re-pass**.
- The two-pass shape (snippet calls → Extract → fused call) lives entirely in the **child-span
  timeline** under `analyze`, **not** in extra Stage Spans.
- **Extract is a Tavily child span under `analyze`** — never its own Stage Span.
- The **fused full-text call is ONE child span** whose GenAI attributes carry the *combined*
  token/cost; it is never split three ways (splitting re-introduces the per-stage fiction ADR 0003
  rejects).

**Child spans only for real external calls.** Each Haiku call, each Tavily call (search and Extract),
each BrandFetch call gets one child span under its Stage Span — minted by the adapter through the
`PipelineTelemetry` port. There are **no synthetic spans and no per-Result spans.**

**Outliers are span events, not spans.** The interesting minority of per-Result outcomes — an
**Exclusion**, a **Verification flip at full-text**, a per-Result **Warning** — are recorded as
**span events on the owning Stage Span** via `PipelineTelemetry.recordResultEvent(...)` (it reads
the active Stage Span off the OTel context). Happy-path per-Result work emits **no span and no
event** — it lives in the Stage Span aggregates and in metrics. **Never span-per-Result:** a Job with
hundreds of Results stays in the low hundreds of spans (dominated by the calls we actually pay for).

### The emission mechanism (the hard part, fixed)

```ts
// application/observability/pipeline-telemetry.port.ts — NO OTel types anywhere in this file.
type ExternalSystem = "anthropic" | "tavily" | "brandfetch";

type GenAiCall = {
  readonly model: string;                    // e.g. "claude-haiku-4-5" → gen_ai.request.model
  readonly inputTokens: number;              // → gen_ai.usage.input_tokens
  readonly outputTokens: number;             // → gen_ai.usage.output_tokens
  readonly finishReasons: readonly string[]; // → gen_ai.response.finish_reasons
  readonly costUsd: number;                  // derived cost attribute
};
type ResultEvent =
  | { kind: "exclusion"; code: ExclusionCode }            // exclusion_code only — never exclusion_detail free text
  | { kind: "verification_flip"; status: "verified" | "uncertain" } // full-text re-pass flipped the gate
  | { kind: "result_warning"; warningType: string };      // a per-Result Warning (warning.type)

interface PipelineTelemetry {
  // Mints a child span on the active Stage Span; awaits fn; records latency + outcome; never throws.
  externalCall<T>(system: ExternalSystem, op: string, fn: () => Promise<T>): Promise<T>;
  // As externalCall, but stamps OTel GenAI attributes + derived cost, and accrues tokens/cost to the Stage Span.
  genAiCall<T>(op: string, fn: () => Promise<{ value: T; call: GenAiCall }>): Promise<T>;
  // Records an outlier per-Result outcome as a span EVENT on the active Stage Span (no span).
  recordResultEvent(event: ResultEvent): void;
}
const PIPELINE_TELEMETRY = Symbol("PipelineTelemetry");
```

- The **adapters** (Tavily, Anthropic, BrandFetch) are *modified* to accept `PipelineTelemetry` and
  wrap their one outbound call in `externalCall` / `genAiCall`. They still return their existing
  benign values (`{ hits: [], failed: true }` / `null`) — `externalCall` records the failure outcome
  on the child span and re-returns the value; it never converts a domain-benign failure into a throw.
- The **stages** (Filter records each Exclusion; Verify records each full-text flip and each
  per-Result Warning) call `recordResultEvent` for the *outlier* outcomes their specs already
  enumerate. They pass plain domain data (`ExclusionCode`, a status, a warning `type`) — never an OTel
  span.
- Neither adapters nor stages hold a handle to the Stage Span: `PipelineTelemetry` reads the **active
  span off the OTel context**, which the `StageRunnerTracing` decorator set when it opened the Stage
  Span. This is exactly how the runner can own the span while the stage owns the facts.
- A **no-op `PipelineTelemetry`** is the bound implementation when `OTEL_SDK_DISABLED=true` (and the
  default in unit tests that don't assert telemetry), so the pipeline is byte-for-byte identical with
  telemetry off.

`StageRunnerTracing` decorates the existing `StageRunner` (it does not modify the runner's policy):
for each stage it (1) reads `results.in` from the repository, (2) opens the Stage Span and makes it
the active context, (3) runs the underlying stage, (4) reads `results.out` + per-code deltas +
warning delta, sets the aggregate attributes, records `stage.duration` and the `results` counter,
(5) sets the Stage Span status by the same rule `runJob` uses (a stage's `JobFailedError` →
`ERROR` + `recordException`; otherwise `OK`, Warnings already on it as events), (6) ends the span.

---

## Signal Split

Three signals, two backends, correlated by `trace_id`.

- **Traces + logs + metrics → otel-lgtm** via its **bundled OTel Collector** over **OTLP
  HTTP/protobuf on port 4318** (Tempo / Loki / Mimir sit behind it). `sdk.ts` configures the
  OTLP HTTP trace + metric exporters at `OTEL_EXPORTER_OTLP_ENDPOINT` (default
  `http://localhost:4318`).
- **Errors → Bugsink** via `@sentry/nestjs` (already a dependency), configured in `sentry.ts` with
  **`tracesSampleRate: 0`** — Bugsink **cannot ingest spans**; this is mandatory, not a preference.
  `@sentry/opentelemetry` stamps the **active `trace_id`** onto every Bugsink error event so a
  Bugsink issue deep-links to the exact Job Trace in Grafana Tempo and back. The DSN comes from
  `SENTRY_DSN` (already in `.env.example`); blank DSN → Sentry disabled, app still boots.
- **Logs** via `nestjs-pino` (`logging.ts`) to a **multi-transport** sink:
  `pino-opentelemetry-transport` (→ Loki, trace-correlated by the active `trace_id`) **and**
  **stdout** as a durable floor that survives a Collector outage. otel-lgtm has no stdout scraper, so
  the OTLP-logs transport is what lands logs in Loki with correlation; stdout guarantees logs are
  never lost when the Collector is down.

**Single-owner consequence:** the OTel `sdk-node` is the **only** tracer-provider. `@sentry/nestjs`
contributes errors only and never registers a span processor (`tracesSampleRate: 0` guarantees it).
`@sentry/opentelemetry` is wired purely to *read* the active OTel `trace_id` for stamping — it does
not own or replace the provider.

---

## Metrics

A `MetricsRegistry` (`meter.ts`) declares the instruments from the OTel `meter`. **Instrument types
are part of the contract** — they fix the queryable Prometheus/Mimir series suffixes operators rely
on, so they are named and fixed here:

| Metric | Instrument | Series / query shape | Labels (closed sets only) |
|---|---|---|---|
| `job.duration` | **Histogram** | `_bucket`/`_sum`/`_count`; `histogram_quantile` for p95 | `terminal_state`, `service` |
| `stage.duration` | **Histogram** | `_bucket`/`_sum`/`_count`; p95 per stage | `stage`, `service` |
| `job.completed` | **Counter** | `_total` | `terminal_state`, `service` |
| `llm.tokens` | **Counter** | `_total` | `model`, `stage`, `service` |
| `llm.cost` | **Counter** | `_total` | `model`, `stage`, `service` |
| `external.request` | **Counter** | `_total` | `service` (the external system), `stage`, outcome |
| `results` | **Counter** | `_total` | `exclusion_code`, `content_type`, `stage` |
| `warnings` | **Counter** | `_total` | `stage`, `warning.type` (closed per-stage namespace) |
| `queue.depth` | **observable gauge** | no suffix | `service` |

- `job.duration` / `stage.duration` are **Histograms** because a latency metric you cannot take a
  percentile on does not answer "why slow." `job.completed`, `llm.tokens`, `llm.cost`,
  `external.request`, `results`, `warnings` are **Counters** (`_total`). `queue.depth` is an
  **observable gauge** registered with a callback that reads BullMQ's waiting/active count on the
  worker (no per-message work).
- **Closed/small label sets only:** `stage` (`resolve | search | filter | analyze | summarise`),
  `model`, `exclusion_code` (the six-code closed set), `terminal_state` (`done |
  done_with_warnings | failed`), `content_type` (the seven brief categories **plus `other`**), and
  `service` (`breakbeat-web | breakbeat-worker`; for `external.request` the label denotes the
  external system: `anthropic | tavily | brandfetch`).
- **NEVER** `job.id`, the company anchor, or a URL on a metric label — that is a **Mimir cardinality
  bomb**. Per-Job drill-down is the Job Trace's job, not a metric's. The `MetricsRegistry` API takes
  only the closed-label enums as arguments, so a high-cardinality label is impossible to pass.

**Where metrics are recorded.** `job.duration` + `job.completed` in the `runJob` status-mapping hook
(it owns the terminal state). `stage.duration` + `results` in the `StageRunnerTracing` decorator.
`llm.tokens` + `llm.cost` + `external.request` in the `PipelineTelemetry` adapter (alongside the
child span). `warnings` in `recordResultEvent` and in the decorator's warning-delta read.
`queue.depth` is an observable gauge on the worker.

---

## Status mapping

Status maps to the domain (`CONTEXT.md`'s Warning rule), enforced at two hook points: the `runJob`
status-mapping hook (root span) and the `StageRunnerTracing` decorator (Stage Span). The rule is the
same at both:

- **`recordException` + span status `ERROR` ONLY** on (a) an *unexpected* throw escaping a stage, or
  (b) a **Job-failing condition** — a stage's `JobFailedError` (e.g. all Search queries failed; the
  Job has nothing to show). A red span always means something genuinely broke.
- **A Warning is an `OK` span + a `warning` span event** (with `warning.type`) — **never** `ERROR`.
  A Warning is a partial *success* (some Search queries failed, no homepage resolved, Classify left
  Results unclassified, Enhance/Summarise failed, brand context or collisions absent). Recorded as a
  span event by `recordResultEvent` / the decorator's warning-delta read; the `warnings` counter
  increments. **The span status stays `OK`.**
- **`done_with_warnings` is an `OK` root span.** The most common imperfect outcome never pollutes
  error rate.
- **Bugsink is fed by the failure condition ONLY** (`reportFailure()` in `sentry.ts`, called from the
  `runJob` failure branch with the active `trace_id` stamped). **No Warning ever produces a Bugsink
  event.** Do **not** "fix" a noisy error rate by marking Warning spans `ERROR` — that re-breaks the
  domain model where error-rate must mean *failures*.

**Hook points, precisely:**

- **`run-job.usecase.ts` (*modify*).** Foundation already routes runner-success → `job.complete()`
  and runner-failure (`JobFailedError` or unexpected throw) → `job.fail(reason)`. The telemetry hook
  rides those same branches: on the **complete** branch set the `job.pipeline` root span `OK` (whether
  terminal state is `done` or `done_with_warnings`) and record `job.completed{terminal_state}` +
  `job.duration{terminal_state}`; on the **fail** branch set the root span `ERROR`, call
  `recordException(reason)`, call `reportFailure(reason)` (→ Bugsink with `trace_id`), and record
  `job.completed{terminal_state: "failed"}` + `job.duration`. The hook reads terminal state *from the
  aggregate* (`job.state`), so the OK/ERROR decision is derived from the domain, not chosen by the
  telemetry code.
- **`stage-runner.tracing.ts`.** A stage that throws `JobFailedError` → its Stage Span `ERROR` +
  `recordException`; a stage that returns (with or without Warnings) → `OK`; Warnings are events, not
  status.

---

## Bootstrap & lifecycle

- **`instrumentation.ts` (*modify* — Foundation's empty seam becomes real).** It calls
  `buildSdk().start()` **before any application module is imported**, loaded via
  `node --import ./dist/instrumentation.js` on **both** entrypoints (Foundation already established
  this). Loading before app modules is what lets `auto-instrumentations-node` patch Express, ioredis,
  pg, and undici before they are `require`d. `instrumentation.ts` reads the env switch to set
  `service.name` (`breakbeat-web` vs `breakbeat-worker`) and calls `warnIfBlind()`
  (`startup-check.ts`) to emit a **startup warning** if `OTEL_SDK_DISABLED=true` or the OTLP endpoint
  is unset — production can never silently run blind. If `OTEL_SDK_DISABLED=true`, `buildSdk` returns
  a no-op (SDK not started) and the bound `PipelineTelemetry` is the no-op implementation.
- **Shutdown (`main.web.ts` / `main.worker.ts` *modify*).** Foundation already handles SIGTERM/SIGINT
  with a drain-then-close ordering hook; this design slots the SDK flush after app close. Order:
  **drain worker → close app → flush SDK** (`flushSdk(timeoutMs)` in `shutdown.ts`). The SDK uses a
  `BatchSpanProcessor` with a **bounded flush timeout**, so an interrupted Job's telemetry survives a
  deploy without hanging shutdown indefinitely. The web process has no worker to drain, so its order
  is close app → flush SDK.
- **Sampling:** `ParentBased(AlwaysOnSampler)` at 100%, configured in `sdk.ts` — a low-throughput,
  deliberate-user-action tool must never silently drop a Job Trace. Tail-sampling, if ever needed, is
  configured at the Collector, never added in-app (out of scope).

---

## Config & fail-soft

- **Standard `OTEL_*` env vars in `.env.example`** (added by the plan): `OTEL_SDK_DISABLED`
  (default unset → enabled; `true` in test/CI), `OTEL_EXPORTER_OTLP_ENDPOINT`
  (`http://localhost:4318`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`http/protobuf`),
  `OTEL_SERVICE_NAME` (set per-process by the entrypoint, or via the env switch),
  `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_RESOURCE_ATTRIBUTES`. `SENTRY_DSN` already exists.
- **Fail-soft exporter — the only sanctioned silent failure.** The OTLP exporter is configured to
  **retry, then drop** on a down/unreachable Collector and **never throws into or blocks the
  pipeline.** Because the `BatchSpanProcessor` exports asynchronously off the hot path and the
  `PipelineTelemetry` adapter swallows any exporter error (logging at most a throttled local warning),
  an observability outage can never degrade or stall company research. The Job still reaches its
  terminal state with telemetry failing.
- **Startup warning** (`warnIfBlind()`): fired when the SDK is disabled (`OTEL_SDK_DISABLED=true`) or
  the OTLP endpoint is unset, written via the same logger so it lands in stdout regardless of
  Collector state.

---

## Route hygiene

Coordinates with the Web UI / SSE spec (`docs/superpowers/specs/2026-06-09-web-ui-sse-design.md`),
which exposes the SSE stream route and the Terminus health route this design's ignore-hook excludes.

- The **SSE stream route** and the **Terminus health route** are **excluded from HTTP span
  creation** via `auto-instrumentations-node`'s HTTP instrumentation `ignoreIncomingRequestHook`
  (configured in `sdk.ts`, matching the SSE path and the health path). The SSE connection's lifetime
  is "how long the human watched," not a unit of work; a per-connection span would be misleading and
  per-message spans would blow up the trace.
- **SSE health is metrics only** (`sse-metrics.ts`, consumed by the Web UI controller): an
  **active-connections gauge** (incremented on connect, decremented on disconnect) and a
  **messages-sent counter**. **No span, no span-per-message.**

---

## Anti-echo

Span attributes and log bodies are a data sink shipped to a backend, so they inherit the **same
anti-echo rule** that keeps raw model output out of `exclusion_detail` (the prompt-injection echo
channel). **Never** put prompt text, raw completions, or scraped page text on any span or log. The
`PipelineTelemetry` port enforces this **structurally**: its `GenAiCall` and `ResultEvent` types
admit only counts, `model` id, `finishReasons`, `costUsd`, an `ExclusionCode`, a status, and a
warning `type` — there is no field through which prompt text, a raw completion, or scraped page text
*could* be passed. The Zod-validated structured output a stage already persists **may** be recorded
where useful; the prompt and the raw completion **may not**. Log bodies (`nestjs-pino`) carry counts,
model id, finish reason, latency, cost, and validated structured output only — never raw text. Every
upstream stage spec already upholds this at the persistence layer; this design upholds it at the
telemetry layer.

---

## Single-owner constraint

Exactly **one** tracer-provider owner: the OTel `sdk-node` started in `instrumentation.ts`.
`@sentry/nestjs` runs with `tracesSampleRate: 0` and contributes **errors only** — it registers no
span processor and never becomes a provider. `@sentry/opentelemetry` is wired only to read the active
OTel `trace_id` for stamping onto error events. **Do not reintroduce** `@envelop`/Yoga (a Yoga-only
plugin with no attachment point in this NestJS/Express + BullMQ stack — the mistake ADR 0004
corrected) or any hand-rolled second OTel SDK: two providers would fight over the global and silently
drop half the spans. **Test proof:** assert `tracesSampleRate === 0` in the Sentry config and that
exactly one tracer provider is registered on the global API.

---

## Error handling

- **The exporter never throws into the pipeline.** A down/unreachable Collector retries then drops;
  the `PipelineTelemetry` adapter and the `BatchSpanProcessor` swallow exporter errors (throttled
  local warning at most). This is the *only* sanctioned silent failure — and it is invisible to the
  Job, which still reaches its terminal state.
- **`PipelineTelemetry` calls never throw.** `externalCall` / `genAiCall` record latency + outcome
  and re-return the wrapped call's value (including the adapters' benign-failure values); a telemetry
  bug must never become a pipeline failure. `recordResultEvent` is best-effort.
- **An unexpected throw inside a stage** is still routed by Foundation's runner to `job.fail`; the
  telemetry hook records it as `ERROR` + `recordException` + Bugsink. Telemetry observes the failure;
  it never causes or suppresses it.
- **A missing active span** (telemetry called outside a Stage Span — a wiring fault) degrades to a
  no-op recording, never a throw.
- **SDK disabled** (`OTEL_SDK_DISABLED=true`): the no-op `PipelineTelemetry` and an un-started SDK
  mean every telemetry call is a cheap no-op; the startup warning fires.

---

## Testing strategy

Test the **observable contracts**, not the SDK's internals — auto-instrumentation belongs to upstream
and is not re-tested; the manual pipeline instrumentation, the wiring, and the invariants are. TDD
throughout (red-green-refactor), **Vitest** for unit and integration.

Because production/CI set `OTEL_SDK_DISABLED=true`, the assertion strategy uses an **in-memory
span/metric exporter (or a recording test tracer-provider) installed explicitly within the test**,
rather than the globally-disabled SDK. Tests that assert telemetry *shape* turn instrumentation on
against that in-memory backend; tests that assert the pipeline is *unaffected* by telemetry run with
the SDK disabled exactly as CI does, proving the disabled path is also safe. **No test depends on a
live Collector, Tempo, Loki, Mimir, or Bugsink.**

The assertion suites (one per PRD-8 invariant):

- **One trace, linked not continued.** Drive an enqueue→worker hop; assert the worker produces a
  `job.pipeline` **root** span with a **span link** to the enqueue span, and that its `trace_id`
  **differs** from the enqueue trace's `trace_id` (proves link, not continuation). Assert one Job
  yields one Job Trace.
- **Stage Span aggregates + child-span granularity.** Assert each stage emits **exactly one** Stage
  Span carrying `results.in`/`results.out`/`excluded.{code}`/`tokens.total`/`cost.total`/`warnings`;
  that external calls (Haiku/Tavily/BrandFetch) appear as child spans; and that a Job with **many
  Results** does **not** mint per-Result spans (span count stays bounded; happy-path Results emit no
  span and no event). Assert `analyze` is a single Stage Span with Extract as a child and the fused
  call as **one** child.
- **GenAI attributes.** Assert a Haiku child span carries `gen_ai.system`, `gen_ai.request.model`,
  `gen_ai.usage.*`, `gen_ai.response.finish_reasons`, and a derived `cost`; assert the fused full-text
  call's single span carries the *combined* token/cost (per ADR 0003).
- **Outliers as events.** Assert an Exclusion, a full-text Verification flip, and a per-Result Warning
  each appear as a **span event** on the owning Stage Span, never as a span.
- **Warnings are OK + event, never ERROR, never Bugsink.** Assert a stage that records a Warning
  yields an `OK` span with a `warning`/`warning.type` event; the root span for a
  `done_with_warnings` Job is `OK`; and **no Warning produces a Bugsink event**.
- **Failures are ERROR + recordException + Bugsink-with-trace_id.** Assert an unexpected throw and a
  Job-failing condition (e.g. all Search queries fail) set span status `ERROR`, call
  `recordException`, and feed Bugsink with the active `trace_id` stamped on the event.
- **No high-cardinality metric labels + `queue.depth` gauge.** Assert emitted metrics carry only the
  closed label sets (`stage`, `model`, `exclusion_code`, `terminal_state`, `content_type`,
  `service`) and that `job.id`, company anchor, and URL **never** appear on any metric label. Assert
  the `queue.depth` observable gauge is registered. Assert the duration metrics are Histograms and
  the rest Counters.
- **Exporter fail-soft.** Simulate a down/unreachable Collector; assert the exporter **retries then
  drops** and **never throws into or blocks the pipeline** — the Job still reaches its terminal state
  and product behaviour is byte-identical with the exporter failing.
- **SSE/health routes produce no HTTP span.** Assert requests to the SSE stream route and the
  Terminus health route create **no** HTTP server span, and that SSE health is reflected in the
  active-connections gauge and the messages-sent counter instead.
- **Anti-echo.** Assert span attributes and log bodies for a GenAI / Tavily / BrandFetch call contain
  **no** prompt text, raw completion, or scraped page text — only counts, model id, finish reason,
  latency, cost, and validated structured output.
- **Bootstrap + shutdown ordering + startup warning.** Assert SIGTERM/SIGINT triggers **drain worker
  → close app → flush SDK** in order within the bounded timeout, and that a startup warning fires when
  the SDK is disabled or the endpoint is unset.
- **Single owner.** Assert `@sentry/nestjs` is configured with `tracesSampleRate: 0` and that there
  is **exactly one** tracer-provider owner.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file;
`OTEL_SDK_DISABLED=true` in test/CI.

---

## Out of scope (deferred)

- **Per-stage queue isolation via BullMQ Flows.** Stages run in-process and sequentially today; the
  only cross-process hop is enqueue→worker (the one link this design creates). If a stage ever needs
  independent retry/backpressure, the trade is adding `traceparent` propagation on **every**
  parent→child job hop — and that propagation must be added **at the same time** as the Flow, never
  after.
- **Tail-sampling.** Sampling is `ParentBased(AlwaysOnSampler)` at 100% in-app. If tail-sampling is
  ever needed, it is configured at the **Collector**, not added to the application.
- **Profiling / continuous profiling (Pyroscope) and email transport monitoring (Mailpit)** named in
  the brief's Analysis section — not addressed by this PRD.
- **The per-stage business logic and the facts it produces** — owned by the stage specs
  (Resolve / Search / Filter; the Verify/Extract/Classify/Enhance spec
  `docs/superpowers/specs/2026-06-09-verify-extract-classify-enhance-design.md`; the Summarise spec
  `docs/superpowers/specs/2026-06-09-summarise-design.md`). This design only *reads* those facts and
  emits telemetry from them; it adds no domain behaviour and changes no Result.
- **The SSE route and health route definitions** — owned by the Web UI / SSE spec
  (`docs/superpowers/specs/2026-06-09-web-ui-sse-design.md`); this design only excludes them from HTTP
  span creation and feeds the SSE-health metrics it exposes.
- **Grafana dashboards, Bugsink alerting rules, and Collector pipeline config** — operational
  artefacts downstream of the contracts this design fixes; the metric/span/label vocabulary here is
  what those artefacts query.

## Vocabulary guardrails (from `CONTEXT.md`)

- The single trace per Job is the **Job Trace** — never a "request trace" (there is no request; the
  unit is the **Job**) and never a "continued trace" (we **link**, never nest).
- One **Stage Span** per stage over the closed set `resolve | search | filter | analyze |
  summarise`; the PRD-5 domain stages (Verify / Classify / Enhance) share the single **`analyze`**
  span, and **Extract is a child span under `analyze`**, never its own Stage Span. Never
  **span-per-Result** — per-Result detail is metrics' and span-events' job.
- A **Warning** is an `OK` span + a span event, never a span-status `ERROR`, and **never a Bugsink
  issue** — a Warning is a partial *success*. Only an unexpected throw or a Job-failing condition is
  `ERROR` and reaches Bugsink. Marking Warning spans `ERROR` re-breaks the domain.
- An **Exclusion** is recorded as a span event by `exclusion_code` (the closed set) only — never the
  `exclusion_detail` free text, never model output (the **anti-echo** channel).
- **Anti-echo on telemetry:** no raw prompt, completion, or scraped page text on any span or log —
  counts, model id, finish reason, latency, cost, and validated structured output only.
- **Never** put `job.id`, the company anchor, or a URL on a **metric** label (a Mimir cardinality
  bomb) — that drill-down is the Job Trace's job.
- The **Signal Split**: three signals (traces + logs + metrics → otel-lgtm), two backends (errors →
  Bugsink), one tracer-provider owner — correlated by `trace_id`.
