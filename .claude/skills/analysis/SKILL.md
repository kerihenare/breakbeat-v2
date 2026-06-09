---
name: analysis
description: Use when investigating a Breakbeat Job's runtime behaviour with the local dev containers — a Job that was slow, cost too much, finished done_with_warnings or failed, threw an error, or whose logs/traces/metrics/spend you need to read. Covers Grafana (Tempo traces, Loki logs, Mimir metrics) and Bugsink (errors): which signal answers which question, the ports, and the exact span/metric/label vocabulary the instrumentation contract (ADR 0004 / PRD 08) fixes, so queries match what the pipeline emits.
---

# Analysis — querying the local observability stack

## Overview

"Analysis" is reading a running Breakbeat Job through its telemetry. The pipeline *is* the product, and almost all of a Job's latency and cost lives in external calls (Anthropic Haiku, Tavily, BrandFetch) running in a BullMQ worker decoupled from the web request — so a console log tells you nothing. You investigate through the containers in `docker-compose.yml`.

**Core principle: pick the signal that answers your question, then query the *domain vocabulary the instrumentation contract defines*.** Telemetry is shaped to the domain model (ADR 0004 / PRD 08 / CONTEXT.md "Observability"). If you query for things outside that contract — `job.id` on a metric, a per-Result span, prompt text — you find nothing and conclude wrongly. Know what's there *and what's deliberately absent*.

> **This is the contract, not a live readout.** Every span, metric, and label name below is fixed by ADR 0004 / PRD 08 — it is what the pipeline *must* emit, not something already observed. The backends in `docker-compose.yml` exist; the `breakbeat-web` / `breakbeat-worker` processes that emit into them are built by PRD 08. **Until that ships, the datasources are empty — an empty Grafana means "not yet instrumented," not "skill is wrong."** Use this doc two ways: before PRD 08, as the spec emissions are verified against; after, as the query guide.

## The two backends (everything else is upstream of these)

The app processes (`breakbeat-web`, `breakbeat-worker`) run **on the host** via `node --import`. The containers are **backends only** — there is no app container, so `docker compose logs breakbeat-worker` finds nothing. Telemetry reaches them over OTLP (4318 HTTP / 4317 gRPC).

| Question | Open | URL | Query lang |
|---|---|---|---|
| Why slow? Where did time/cost go per stage & call? | **Tempo** (traces, in Grafana) | http://localhost:3030 (anon) | TraceQL |
| What was logged for this run? | **Loki** (logs, in Grafana) | http://localhost:3030 → Explore | LogQL |
| Cross-Job trends: spend by model/stage, terminal-state mix, queue backlog | **Mimir** (metrics, in Grafana) | http://localhost:3030 → Explore | PromQL |
| Did anything actually **throw**? | **Bugsink** (errors) | http://localhost:8000 (`admin@example.com` / `admin`) | UI / search |

otel-lgtm bundles Tempo + Loki + Mimir behind one Grafana with datasources pre-wired. **Signal Split:** traces+logs+metrics → otel-lgtm; **errors only** → Bugsink (it cannot ingest spans). They correlate by `trace_id`.

### Brief → actual stack (don't hunt for containers that aren't here)

The brief's Analysis section names more tools than are wired. Map them before you go looking:

- **Prometheus → Mimir** (inside otel-lgtm; query as PromQL in Grafana). No standalone Prometheus container.
- **Tempo / Loki / Bugsink** — present as above.
- **Pyroscope (profiling)** and **Mailpit (emails)** — **named in the brief but NOT in `docker-compose.yml` and not emitted** (PRD 08 "Further Notes"). There is no continuous-profiling or outbound-email signal to query today. Don't promise CPU/alloc flamegraphs or sent-email inspection from this stack.

## The vocabulary you actually query

Queries only match if you use the emitted names. From ADR 0004 / PRD 08:

- **`service.name`**: `breakbeat-web` (enqueue) | `breakbeat-worker` (execution). The pipeline lives on the worker.
- **Root span**: `job.pipeline` — one per Job (the **Job Trace**). It is a *new root* linked (not continued) from the enqueue span, so its `trace_id` differs from the web side; follow the **span link**, don't expect a shared trace.
- **Stage Spans** (closed set): `resolve | search | filter | analyze | summarise`. Verify/Classify/Enhance all live under **`analyze`** (one span; the two-pass shape is in its child timeline, not extra stage spans). Stage-span attributes: `results.in`, `results.out`, `excluded.{code}`, `tokens.total`, `cost.total`, `warnings`.
- **Child spans** exist **only for real external calls** — each **Anthropic GenAI call** (GenAI conventions: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.response.finish_reasons`, derived cost): Haiku verify/classify/enhance calls under `analyze`, **and the Anthropic web-search backstop under `search` on thin runs** (the `web_search`-tool call ADR 0002 fires only when Tavily yield is low — a different call from the Haiku ones); each Tavily call (search under `search`, Extract under `analyze`); each BrandFetch call (under `resolve`). So `search` is **not** Tavily-only: an escalated thin-run Job carries an Anthropic child span there too.
- **Span events** (the interesting minority): `warning` (with `warning.type`), an Exclusion, a Verification flip at full-text. Happy-path per-Result work emits **nothing**.
- **Metrics**: `job.duration`, `job.completed`, `stage.duration`, `llm.tokens`, `llm.cost`, `external.request`, `results`, `warnings`, `queue.depth` (observable gauge).
- **Metric labels — closed/small sets only**: `stage` (5 above), `model`, `exclusion_code` (`own_channel | aggregator | ecommerce_review | out_of_window | duplicate | off_topic`), `terminal_state` (`done | done_with_warnings | failed`), `content_type` (seven brief categories + `other`), `service`.

> **PromQL name-mangling & instrument types:** OTLP names arrive in Mimir with dots → underscores, and the *suffix depends on the instrument type the contract fixes* (ADR 0004 / PRD 08). **Counters** → `_total`: `llm_cost_total`, `llm_tokens_total`, `job_completed_total`, `external_request_total`, `results_total`, `warnings_total`. **Histograms** (the duration pair) → `_bucket`/`_sum`/`_count`: `job_duration_*`, `stage_duration_*` — use these for `histogram_quantile` percentiles, not just `_sum`. **Gauge** (no suffix): `queue_depth`. Never the dotted names.

## Quick reference queries (starting points)

```
# TraceQL — find the slow Job Trace, then read its stage spans
{ name = "job.pipeline" && duration > 60s }
{ name = "job.pipeline" }              # sort by Duration desc; open the outlier
# inside it: which Stage Span owns the wall-clock? expand its child (external-call) spans.
# cost: read tokens.total / cost.total on the stage span; gen_ai.usage.* + finish_reasons on Haiku children.

# LogQL — this run's logs, trace-correlated
{ service_name = "breakbeat-worker" } | json | trace_id = "<trace_id from Tempo>"

# PromQL — cross-Job spend & health (note _total / underscores)
sum by (model) (llm_cost_total)                 # spend by model (counter)
# where time goes across Jobs — p95 per stage (histogram, NOT sum):
histogram_quantile(0.95, sum by (stage, le) (rate(stage_duration_bucket[$__rate_interval])))
sum by (terminal_state) (job_completed_total)   # done vs done_with_warnings vs failed mix
sum by (service) (external_request_total)       # Tavily/BrandFetch/Anthropic health
queue_depth                                     # BullMQ backlog (gauge)
```

**Bugsink:** open http://localhost:8000; each issue carries the active `trace_id` (stamped by `@sentry/opentelemetry`). Correlation is **manual copy-paste**, not a clickable deep-link: copy the issue's `trace_id` and paste it into Tempo to land on the exact Job Trace. There is no wired Grafana→Bugsink link in the reverse direction — grab the `trace_id` off the trace and search Bugsink for it. (Automatic deep-linking would need a Grafana derived-field config; out of scope today.)

## Diagnosing the common outcomes

- **Slow / expensive** → Tempo. Find `job.pipeline`, read stage-span durations; the dominant stage is usually `analyze` (fused Haiku + Tavily Extract). Drill its child spans; high `gen_ai.usage.*`, retries, or a length/max-tokens `finish_reason` explain cost. **But check `search` too:** a thin-run Job escalates (ADR 0002), so `search` may own the wall-clock with **extra Tavily queries *plus* an Anthropic web-search backstop child span** — escalation cost hides there, not in `analyze`.
- **`done_with_warnings`** → it is a partial *success*, **not** an error. The root span is **OK**. Look for `warning` **span events** on each Stage Span (failed Search queries, no homepage resolved at `resolve`, absent brand context, Classify left Results unclassified, Enhance/Summarise failed). It will **not** appear in Bugsink or in error-rate.
- **`failed` / a real throw** → Bugsink first (an unexpected throw or a Job-failing condition like all Search queries failing). The span will be `ERROR` with `recordException`. Grab its `trace_id` → Tempo.

## What's deliberately absent (the gotchas that waste time)

- **No per-Result spans.** A Job with hundreds of Results stays in the low hundreds of spans. Per-Result detail is span *events* (the outliers) and metric aggregates — never a span per Result. Don't go looking for one.
- **No `job.id` (or company / URL) on any metric label** — that would be a Mimir cardinality bomb. **Per-Job drill-down is the Job Trace's job, not a metric's.** To investigate *one* Job, use Tempo; metrics are for cross-Job trends only.
- **No prompt text, raw completions, or scraped page text — anywhere.** Anti-echo discipline (same rule that protects `exclusion_detail`). Spans and logs carry only counts, model id, finish reason, latency, cost, and Zod-validated structured output. Don't grep telemetry for the prompt or page body — it isn't there, by design.
- **A Warning is never an error.** Not span-status `ERROR`, not a Bugsink issue. Error-rate and Bugsink mean *actual failures*. Don't "fix" a noisy error rate by treating Warnings as errors — that re-breaks the domain.
- **No Prometheus / Pyroscope / Mailpit container** (see brief→actual mapping). No standalone Prometheus, no profiling flamegraphs, no email inbox to inspect.

## Common mistakes

| Mistake | Reality |
|---|---|
| `docker compose logs breakbeat-worker` | No app container — web/worker run on the host. Use Loki, or the host process stdout. |
| Filtering a metric by `job.id` to debug one Job | Not a label. Use the Job Trace in Tempo for per-Job drill-down. |
| Expecting `done_with_warnings` in Bugsink / error-rate | Warnings are `OK` spans + span events. Only throws/Job-failing conditions reach Bugsink. |
| Querying dotted metric names in PromQL (`llm.cost`) | Mimir has `llm_cost_total` (dots→`_`, counters→`_total`). |
| Looking for a per-Result span, or the prompt/page text | Neither exists — bounded spans + anti-echo. Read aggregates, events, and metrics. |
| Hunting for a Pyroscope/Mailpit/Prometheus container | Not wired. Profiling/email aren't emitted; Prometheus is Mimir inside otel-lgtm. |
| Expecting web and worker to share one `trace_id` | The worker opens a new root linked from enqueue — follow the **span link**. |
