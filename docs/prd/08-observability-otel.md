# Observability (OTel)

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle (cross-cuts all other PRDs)
**ADRs:** 0004 (OTel / process model — the core decision), 0003 (the fused full-text Haiku call → one `analyze` span)

## Problem Statement

When a developer or on-call operator looks at a Breakbeat Job that behaved oddly — it took four minutes, it cost more than expected, it landed in `done_with_warnings`, or it `failed` — they have no first-class way to answer "what happened, where did the time and money go, and why." The pipeline is the product: a single Job moves through Resolve → Search → Filter (with Collapse) → Verify → Extract → Classify → Enhance → Summarise, and almost all of its latency and dollar cost lives in external calls (Anthropic Haiku, Tavily search/extract, BrandFetch). That work runs in a BullMQ worker, decoupled in time from the web request that enqueued it, so a console log on the web process tells the operator nothing about the run.

The operator needs to:

- See a single Job's whole pipeline run as one coherent trace — including the enqueue-to-execution hop — and read off where the time went, stage by stage and call by call.
- Account for external cost and latency per Haiku / Tavily / BrandFetch call, and roll it up per stage and per Job, without losing the ability to slice spend by model and by stage across many Jobs.
- Distinguish a real failure from a Warning. A `done_with_warnings` Job is a partial success (some queries failed, no homepage resolved, Classify left Results unclassified) — it must not show up in error-rate dashboards or page anyone via Bugsink. A genuine throw or a Job-failing condition must.
- Trust that turning telemetry on never changes product behaviour: a Collector that is down or unreachable must never throw into or stall the pipeline, and telemetry must never leak prompt text, raw completions, or scraped page text into a backend (the same anti-echo discipline that protects `exclusion_detail` from prompt-injection echo).
- Jump from a Bugsink error straight to the Job Trace in Grafana, and back, via a shared `trace_id`.

Today none of this exists. This PRD implements ADR 0004 in full to provide it.

## Solution

Instrument Breakbeat with the **OpenTelemetry Node SDK** (`@opentelemetry/sdk-node` plus `auto-instrumentations-node` for Express, ioredis, postgres, and undici) augmented with **manual pipeline spans**. The shape is NestJS/BullMQ-native, not request-centric:

- **One Job Trace per Job.** One BullMQ job per Job; stages run in-process and sequentially, so the entire run is a single trace. The only cross-process boundary is enqueue (on `breakbeat-web`) to execution (on `breakbeat-worker`): the enqueue injects `traceparent` into the job data, and the worker opens a **new root span** `job.pipeline` that carries a **span link** back to the enqueue span — a link, never a continued or nested trace.
- **One Stage Span per pipeline stage**, carrying aggregate attributes. Child spans exist **only for real external calls** — each Haiku call (OTel GenAI semantic conventions plus derived cost), each Tavily and BrandFetch call. The interesting minority of per-Result outcomes (an Exclusion, a Verification flip at full-text, a per-Result Warning) are **span events** on the Stage Span. Happy-path per-Result work emits no span and no event — it lives in aggregates and metrics. Never span-per-Result.
- **A three-signal split (the Signal Split).** Traces, logs, and metrics flow to **otel-lgtm** (Grafana Tempo / Loki / Mimir) via its bundled OTel Collector over OTLP HTTP/protobuf on 4318. **Errors only** flow to **Bugsink** via `@sentry/nestjs` with tracing disabled. The two backends correlate by `trace_id`.
- **Bounded-cardinality metrics** for cross-Job aggregates, with closed/small label sets only.
- **Domain-faithful status mapping**: span status `ERROR` and `recordException` only on an unexpected throw or a Job-failing condition; a Warning is an `OK` span plus a span event; `done_with_warnings` is an `OK` root span.
- **Fail-soft exporting, deterministic bootstrap/shutdown, route hygiene, and anti-echo discipline** as described below.

This delivers per-Job drill-down (traces), cross-Job spend and health analytics (metrics), trace-correlated logs (Loki), and actionable error alerting (Bugsink) — with exactly one tracer-provider owner and no behavioural risk to the pipeline.

## User Stories

1. As an operator debugging a slow Job, I want the whole pipeline run to appear as a single Job Trace, so that I can see Resolve → Search → Filter → Verify → Extract → Classify → Enhance → Summarise in one timeline without stitching traces together.

2. As an operator, I want the enqueue-to-worker hop represented as a span link from a fresh `job.pipeline` root span, so that queue-wait time and re-run/scheduled timing are not folded into the Job's measured pipeline duration.

3. As a developer, I want to confirm the worker opens a new root trace (not a continuation of the enqueue trace), so that a Job that sat in the queue for an hour still reports a clean pipeline duration.

4. As an operator accounting for cost, I want each Haiku call to appear as a child span under its Stage Span with `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.response.finish_reasons`, and a derived cost, so that I can attribute spend to specific model calls.

5. As an operator, I want each Tavily and BrandFetch call to appear as a child span under its Stage Span, so that I can see external latency and failures from the providers that dominate a Job's wall-clock time.

6. As an operator, I want each Stage Span to carry aggregate attributes (`results.in`, `results.out`, `excluded.{code}` counts, `tokens.total`, `cost.total`, `warnings`), so that I can read a stage's outcome at a glance without expanding every child.

7. As an operator, I want outlier per-Result outcomes — an Exclusion, a Verification flip at full-text, a per-Result Warning — recorded as span events on the owning Stage Span, so that I can investigate the interesting minority without drowning in per-Result spans.

8. As a developer, I want happy-path per-Result work to emit no span and no span event, so that a Job with hundreds of Results stays in the low hundreds of spans and the trace remains readable.

9. As a cost-conscious product owner, I want `llm.cost` and `llm.tokens` metrics labelled by `model` and `stage` (never by Job or company), so that I can chart spend over time and by stage without a Mimir cardinality explosion.

10. As a product owner, I want a `job.duration` and `job.completed` metric labelled by `terminal_state`, so that I can track how often Jobs finish `done` vs `done_with_warnings` vs `failed` over time.

11. As an operator, I want an `external.request` metric labelled by `service` (and the call's outcome), so that I can monitor Tavily / BrandFetch / Anthropic health and error rates across all Jobs.

12. As an operator, I want a `results` metric labelled by `exclusion_code` and `content_type`, so that I can watch how the included/excluded mix and the type distribution shift across runs.

13. As an operator, I want a `queue.depth` observable gauge, so that I can see backlog building up in BullMQ before users feel it.

14. As an on-call engineer, I want a Warning to be an `OK` span carrying a `warning` span event (with `warning.type`) — never span-status `ERROR` and never a Bugsink issue — so that error-rate dashboards and pager alerts mean actual failures, not partial successes.

15. As an on-call engineer, I want `done_with_warnings` to be an `OK` root span, so that the most common imperfect outcome does not pollute error rate.

16. As an on-call engineer, I want span status `ERROR` and `recordException` only on an unexpected throw or a Job-failing condition (e.g. all Search queries failed), so that a red trace always means something genuinely broke.

17. As an on-call engineer, I want Bugsink fed only by the failure condition, so that the issue tracker stays a list of real failures and never fills with Warnings.

18. As an on-call engineer, I want the active `trace_id` stamped onto every Bugsink error event, so that I can deep-link from a Bugsink issue to the exact Job Trace in Grafana Tempo and back.

19. As a developer, I want logs emitted via `nestjs-pino` to go to both `pino-opentelemetry-transport` (→ Loki, trace-correlated) and stdout, so that logs are trace-correlated when the Collector is up and still durable when it is down.

20. As an operator, I want a Job's logs correlated to its Job Trace by `trace_id` in Loki, so that I can pivot from a log line to the full trace.

21. As an operator, I want the per-process `service.name` to be `breakbeat-web` on the enqueue side and `breakbeat-worker` on the execution side, so that I can tell which process emitted any given span, log, or metric.

22. As an operator, I want sampling fixed at `ParentBased(AlwaysOnSampler)` (100%), so that no Job Trace is ever silently dropped for this low-throughput, deliberate-user-action tool.

23. As a developer, I want the OTel SDK bootstrapped in a standalone instrumentation module loaded via `node --import` on both entrypoints before any app module imports, so that auto-instrumentation hooks attach before Express, ioredis, postgres, and undici are required.

24. As an operator deploying a new version, I want SIGTERM/SIGINT shutdown to drain the worker, then close the app, then flush the SDK within a bounded timeout, so that an in-flight Job's telemetry survives the deploy instead of being lost.

25. As a developer, I want all behaviour configured through standard `OTEL_*` environment variables documented in `.env.example`, so that endpoints, headers, and protocol are operator-tunable without code changes.

26. As a developer running tests or CI, I want `OTEL_SDK_DISABLED=true` to fully disable the SDK, so that the suite emits no telemetry and does not depend on a Collector.

27. As an operator, I want the exporter to be fail-soft — a down or unreachable Collector retries, then drops, and never throws into or blocks the pipeline — so that an observability outage can never degrade or stall company research.

28. As an operator, I want a startup warning if the SDK is disabled or the OTLP endpoint is unset, so that a production process can never silently run blind.

29. As a developer, I want the SSE stream route and the Terminus health route excluded from HTTP span creation, so that a connection whose lifetime is "how long the human watched" is not mistaken for a unit of work.

30. As an operator, I want SSE health captured as metrics (an active-connections gauge and a messages-sent counter) rather than spans, so that I can monitor the stream without a span-per-message blowup.

31. As a security-minded developer, I want telemetry to inherit the anti-echo discipline — never prompt text, raw completions, or scraped page text on any span or log, only counts, model id, finish reason, latency, cost, and Zod-validated structured output — so that a backend can never become a prompt-injection echo channel.

32. As an architect, I want exactly one tracer-provider owner (the OTel `sdk-node`), with `@sentry/nestjs` running with tracing disabled and contributing errors only, so that two SDKs never fight over the global provider and silently drop spans.

33. As a developer, I want assurance that `@envelop`/Yoga and any hand-rolled second OTel SDK are never reintroduced, so that the single-owner invariant holds over time.

## Implementation Decisions

These encode ADR 0004 (`docs/adr/0004-otel-instrumentation.md`) — the primary source — in full. GenAI call shape follows ADR 0003. Env var names, span names, metric names, and attribute names below are interface contracts and are intentionally specified; no file paths or code are prescribed.

### Trace topology

- **One Job Trace per Job.** The pipeline runs as a single BullMQ job with stages in-process and sequential. There is no per-stage queue or BullMQ Flow (deferred — see Out of Scope), so no intra-pipeline cross-process hops exist today.
- **Link, never continue, the enqueue→worker hop.** On `breakbeat-web`, the enqueue injects `traceparent` into the BullMQ job data. On `breakbeat-worker`, execution opens a **new root span** named `job.pipeline` carrying a **span link** back to the enqueue span. A continued trace is explicitly wrong here: it would fold dead queue-wait and nonsensical re-run/scheduled timing into the trace's duration. The vocabulary is "Job Trace" and "link" — never "request trace" (there is no request; the unit is the Job) and never "continued trace."
- **Per-process identity.** `service.name` is `breakbeat-web` on the enqueue process and `breakbeat-worker` on the execution process.

### Span granularity

- **One Stage Span per pipeline stage** — `resolve`, `search`, `filter` (incl. Collapse), `analyze`, `summarise` — carrying **aggregate** attributes: `results.in`, `results.out`, `excluded.{code}` counts (over the closed exclusion-code set: `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`, `off_topic`), `tokens.total`, `cost.total`, and `warnings`. **`analyze` is the single span for the whole PRD-5 stage** (Verify / Classify / Enhance): these are distinct *domain* stages but execute as snippet-gate (snippet-Verify + snippet-Classify) → Tavily Extract → one fused Haiku call, not as three time-ordered stages. Its `results.in` is what Filter handed it; `results.out` is those still `included` after the full-text re-pass. The two-pass structure lives in the child-span timeline, not in extra stage spans; Extract is the Tavily Extract child span under `analyze`, not its own stage span (ADR 0004).
- **Child spans only for real external calls.** Each Haiku call, each Tavily call, each BrandFetch call gets a child span under its Stage Span. There are no synthetic or per-Result spans.
- **GenAI call shape (per ADR 0003).** Each Haiku child span uses OTel GenAI semantic conventions: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*` (input/output tokens), `gen_ai.response.finish_reasons`, plus a derived cost attribute. The fused full-text call is **one** such child span carrying the combined token/cost — never split across Verify/Classify/Enhance. The Zod-validated structured output may be recorded; prompt text and raw completion text may not (see Anti-echo).
- **Outliers are span events, not spans.** The interesting minority of per-Result outcomes — an Exclusion, a Verification flip at full-text, a per-Result Warning — are recorded as **span events on the owning Stage Span**. Happy-path per-Result work produces neither a span nor an event; it is represented only in the Stage Span aggregates and in metrics. Never span-per-Result.

### Signal Split

- **Traces + logs + metrics → otel-lgtm** via its bundled OTel Collector over OTLP HTTP/protobuf on port 4318 (Tempo / Loki / Mimir behind it).
- **Errors → Bugsink** via `@sentry/nestjs` configured with `tracesSampleRate: 0`. Bugsink cannot ingest spans — this is mandatory, not a preference. `@sentry/opentelemetry` stamps the active `trace_id` onto error events so Grafana and Bugsink deep-link in both directions.
- **Logs** via `nestjs-pino` to a multi-transport sink: `pino-opentelemetry-transport` (→ Loki, trace-correlated) **and** stdout as a durable floor that survives a Collector outage.

### Metric label discipline

- **Bounded aggregates only:** `job.duration`, `job.completed`, `stage.duration`, `llm.tokens`, `llm.cost`, `external.request`, `results`, `warnings`, and a `queue.depth` observable gauge.
- **Instrument types are contract** (they fix the queryable Prometheus/Mimir series): `job.duration` and `stage.duration` are **Histograms** (expose `_bucket`/`_sum`/`_count`, support `histogram_quantile` for p95 latency); `job.completed`, `llm.tokens`, `llm.cost`, `external.request`, `results`, `warnings` are **Counters** (`_total` suffix); `queue.depth` is an **observable gauge** (no suffix). A duration metric you cannot take a percentile on does not answer "why slow," so the duration pair must be histograms.
- **Closed/small label sets only:** `stage` (`resolve | search | filter | analyze | summarise`), `model`, `exclusion_code`, `terminal_state` (`done | done_with_warnings | failed`), `content_type` (the seven brief categories plus `other`), and `service` (`breakbeat-web | breakbeat-worker`).
- **Never** put `job.id`, the company anchor, or a URL on a metric label — that is a Mimir cardinality bomb, and per-Job drill-down is the Job Trace's job, not a metric's.

### Status mapping (to the domain)

- `recordException` + span status `ERROR` **only** on an unexpected throw or a Job-failing condition (e.g. all Search queries failed — the Job has nothing to show).
- A **Warning** is an `OK` span plus a span event (`warning`, with `warning.type`) — never `ERROR`. A Warning is a partial *success* (some Search queries failed, no homepage resolved, Classify left Results unclassified, Enhance/Summarise failed, brand context or collisions absent).
- `done_with_warnings` is an `OK` root span.
- **Bugsink is fed by the failure condition only**, never by Warnings. Do not "fix" a noisy error rate by marking Warning spans `ERROR` — that re-breaks the domain model, where error-rate must mean failures.

### Bootstrap & lifecycle

- The SDK lives in a standalone instrumentation module loaded via `node --import` on **both** entrypoints (`breakbeat-web` and `breakbeat-worker`), before any application module is imported, so auto-instrumentation attaches first.
- Shutdown on SIGTERM/SIGINT runs in order: **drain worker → close app → flush SDK**. The SDK uses a `BatchSpanProcessor` with a bounded flush timeout, so an interrupted Job's telemetry survives a deploy without hanging shutdown indefinitely.

### Identity & sampling

- Sampler: `ParentBased(AlwaysOnSampler)` at 100% — appropriate for a low-throughput, deliberate-user-action tool. Tail-sampling, if ever needed, is deferred to the Collector and never added in-app (see Out of Scope).

### Config & fail-soft

- Standard `OTEL_*` env vars (endpoint, protocol, headers, resource attributes) documented in `.env.example`. `OTEL_SDK_DISABLED=true` in test/CI.
- The exporter is **fail-soft**: a down or unreachable Collector retries, then drops, and **never throws into or blocks the pipeline**. This is the only sanctioned silent failure.
- A **startup warning** fires if the SDK is disabled or the OTLP endpoint is unset, so production can never silently run blind.

### Route hygiene

- The SSE stream route and the Terminus health route are **excluded from HTTP span creation** — the SSE connection's lifetime is "how long the human watched," not a unit of work.
- SSE health is captured as **metrics only**: an active-connections gauge and a messages-sent counter. No span, no span-per-message.

### Anti-echo (inherited)

- Span attributes and log bodies are a data sink shipped to a backend, so they inherit the same anti-echo rule that keeps raw model output out of `exclusion_detail`: **never** put prompt text, raw completions, or scraped page text on any span or log. Only counts, model id, finish reason, latency, cost, and Zod-validated structured output are permitted.

### Single-owner constraint

- Exactly one tracer-provider owner: the OTel `sdk-node`. `@sentry/nestjs` runs with tracing disabled (`tracesSampleRate: 0`) and contributes errors only. Do not reintroduce `@envelop`/Yoga or a hand-rolled second OTel SDK — two providers would fight over the global and silently drop half the spans.

## Testing Decisions

Test external, observable behaviour — the contracts above — not the SDK's internals. TDD throughout (red-green-refactor), Vitest for unit and integration. Auto-instrumentation belongs to upstream and is not re-tested; the manual pipeline instrumentation, the wiring, and the invariants are.

Because production sets `OTEL_SDK_DISABLED=true` in test/CI, the assertion strategy uses an **in-memory span/metric exporter (or a recording test tracer-provider) installed explicitly within the test**, rather than relying on the globally-disabled SDK. Tests that assert telemetry shape turn instrumentation on against that in-memory backend; tests that assert the pipeline is *unaffected* by telemetry run with the SDK disabled exactly as CI does, proving the disabled path is also safe. No test depends on a live Collector, Tempo, Loki, Mimir, or Bugsink.

- **One trace, linked not continued.** Drive an enqueue→worker hop and assert the worker produces a `job.pipeline` root span with a **span link** to the enqueue span, and that its `trace_id` differs from the enqueue trace (proving link, not continuation). Assert one Job yields one Job Trace.
- **Stage Span aggregates and child-span granularity.** Assert each stage emits exactly one Stage Span carrying the aggregate attributes, that external calls (Haiku/Tavily/BrandFetch) appear as child spans, and that a Job with many Results does **not** mint per-Result spans (span count stays bounded; happy-path Results emit no span and no event).
- **GenAI attributes.** Assert a Haiku child span carries `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.response.finish_reasons`, and a derived cost (per ADR 0003).
- **Outliers as events.** Assert an Exclusion, a full-text Verification flip, and a per-Result Warning each appear as a **span event** on the owning Stage Span, not as a span.
- **Warnings are OK + event, never ERROR.** Assert a stage that records a Warning yields an `OK` span with a `warning`/`warning.type` event, that the root span for a `done_with_warnings` Job is `OK`, and that **no Warning produces a Bugsink event**.
- **Failures are ERROR + Bugsink.** Assert an unexpected throw and a Job-failing condition (e.g. all Search queries fail) set span status `ERROR`, call `recordException`, and feed Bugsink with the active `trace_id` stamped on the event.
- **No high-cardinality metric labels.** Assert that emitted metrics carry only the closed label sets (`stage`, `model`, `exclusion_code`, `terminal_state`, `content_type`, `service`) and that `job.id`, company anchor, and URL never appear on any metric label. Assert the `queue.depth` observable gauge is registered.
- **Exporter is fail-soft.** Simulate a down/unreachable Collector and assert the exporter retries then drops and **never throws into or blocks the pipeline** — the Job still reaches its terminal state and product behaviour is identical with the exporter failing.
- **SSE/health routes produce no HTTP span.** Assert requests to the SSE stream route and the Terminus health route create no HTTP server span, and that SSE health is reflected in the active-connections gauge and messages-sent counter instead.
- **Anti-echo.** Assert that span attributes and log bodies for a GenAI / Tavily / BrandFetch call contain no prompt text, raw completion, or scraped page text — only counts, model id, finish reason, latency, cost, and validated structured output.
- **Bootstrap & shutdown.** Assert SIGTERM/SIGINT triggers drain worker → close app → flush SDK in order within the bounded timeout, and that a startup warning fires when the SDK is disabled or the endpoint is unset.
- **Single owner.** Assert `@sentry/nestjs` is configured with `tracesSampleRate: 0` and that there is exactly one tracer-provider owner.

## Out of Scope

- **Per-stage queue isolation via BullMQ Flows.** Stages run in-process and sequentially today. If a stage ever needs independent retry/backpressure, the trade-off is adding `traceparent` propagation on every parent→child job hop — and that propagation must be added at the same time as the Flow, never after.
- **Tail-sampling.** Sampling is `ParentBased(AlwaysOnSampler)` at 100% in-app. If tail-sampling is ever needed, it is configured at the Collector, not added to the application.

## Further Notes

- **Cross-cutting.** This PRD instruments the work owned by every sibling PRD: it depends on **Foundation & Job Lifecycle** for the Job state machine and the enqueue→worker hop it links, and it cross-cuts **Resolve Stage**, **Search Stage**, **Filter & Collapse**, **Verify / Extract / Classify / Enhance**, **Summarise**, and **Web UI & SSE Delivery** (route hygiene, SSE health metrics). It can be built alongside the pipeline rather than after it.
- **Stack alignment with the brief's Analysis section.** The brief's *Transmit* containers (OTel Collector for logs/metrics/traces; Bugsink for errors) and *Query* containers (Bugsink, Loki, Tempo, Prometheus/Mimir) map onto the otel-lgtm bundle and Bugsink in `docker-compose.yml`. Mailpit and Pyroscope/profiling named in the brief are not addressed by this PRD.
- **Why link, not continue.** Linking the enqueue→worker hop keeps the measured pipeline duration honest under queue-wait, re-runs, and scheduled Jobs; a continued trace would conflate "how long it waited" with "how long it ran."
- **Why metrics-for-aggregates, traces-for-detail.** This division is the only one that keeps Mimir cardinality bounded while preserving per-Job drill-down. Per-Result and per-Job detail lives in the Job Trace; cross-Job analytics live in metrics.
- **Warnings stay fully visible.** A Warning is never hidden — it is a span event plus the `warnings` metric counter — it is simply never counted as a failure. Grafana error-rate and Bugsink issues both mean *actual failures*.
