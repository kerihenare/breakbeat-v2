# SSE delivery bridges worker→web over Redis Pub/Sub, with Postgres as the source of truth

The pipeline runs on `breakbeat-worker`; the open SSE connections live on `breakbeat-web`. The process that *knows* a Result or status changed is not the process holding the browser connection. We bridge that gap with **Redis Pub/Sub**: after a DB write commits, the worker publishes a minimal **id-only nudge** (`{ jobId, kind: "result" | "status", id }`) on a per-Job channel. The web SSE handler subscribes for the Job it is streaming, and on each nudge runs the read-model query against Postgres and emits the SSE frame.

## Why

- **No new infra** — Redis is already present for BullMQ/ioredis. LISTEN/NOTIFY would couple eventing to a dedicated PG connection per listener; polling is laggy and thrashes the DB under many open connections, fighting the "calm under live load" goal.
- **Postgres stays the source of truth.** The nudge carries only ids, never Result content, so a dropped or duplicated message is harmless: PRD 7 already requires row-level idempotency (re-deliver by id → update-in-place, never duplicate), and a reconnecting client re-reads page 1 from the DB. Anti-echo is preserved for free — no model text or scraped page text ever rides the channel.
- **Preserves the Foundation decoupling.** The worker publishes whether or not anyone is listening; it has zero knowledge of connected clients. Enqueue→worker remains the only *work* hop (ADR 0004); this is a separate fire-and-forget *notification* channel and does not affect the Job Trace.

## Consequences

- **Granularity: per-Result, no replay.** The worker publishes one nudge per persisted Result change and one per status transition (volume bounded by the "low hundreds of Results" the Observability PRD already assumes). On first connect the client gets no SSE replay — the Result page server-renders page 1 on load and SSE carries only subsequent deltas, avoiding a replay/live race.
- The publish is the last step *after* commit, so web never reads a row the worker hasn't written.
- If per-Result volume ever proves chatty, coalescing (debounced status + batched result-ids) is a later optimisation behind the same channel shape — not a re-architecture.
