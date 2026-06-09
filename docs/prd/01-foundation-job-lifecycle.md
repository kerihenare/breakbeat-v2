# Foundation & Job Lifecycle

**Status:** ready-for-agent
**Depends on:** none

## Problem Statement

A Drumbeat customer pastes a company name or domain and wants a trustworthy digest of everything the outside world has published about that company over the last 36 months. That work is slow — it spans several external services and many pages — so it cannot happen inside the request that submitted it. The user needs to hand over one input and walk away knowing the work has been accepted, is genuinely running somewhere, and will reach a definite, honest end state: it finished, it finished but some parts came up short, or it failed outright and produced nothing worth reviewing.

Without a durable, observable run with a real lifecycle, every other promise the product makes is hollow. There is nowhere to anchor the disambiguated company once the user has chosen it; nowhere to record the results as they accrue; no way to tell "still working" apart from "done" apart from "broke"; and no honest way to say "you have a usable list, but classification didn't run" instead of either lying that everything is fine or throwing the whole run away. An internal analyst re-running a company a month later needs the new run to reflect today's coverage without silently turning into a different company than the one they originally picked. And the developer/operator needs a run they can stand up, enqueue, execute in a separate process, and watch reach a terminal state before any of the actual research stages exist.

This PRD establishes that foundation: the Job, its anchor, its state machine, its durable storage, the enqueue-to-worker handoff across a process boundary, the rules for when partial trouble is a Warning versus a failure, and an end-to-end tracer-bullet slice that runs an initially-empty pipeline to a terminal state.

## Solution

Breakbeat treats one run of the pipeline for one company as a **Job** — a durable, addressable thing with a clear state machine. A form POST on the web process accepts the company input, freezes the disambiguated company anchor into a new Job, persists it as `pending`, and enqueues exactly one background unit of work for it. The user immediately has a Job they can observe.

A separate worker process picks up that unit of work, moves the Job to `running`, and runs the pipeline stages in-process and in sequence. In this foundation the pipeline is an empty sequence — a runner skeleton that later PRDs plug real stages into — but it exercises the full path: claim the Job, run the (currently empty) stages, accumulate any Warnings, and write a terminal state. The Job ends in exactly one of three terminal states: `done` (clean), `done_with_warnings` (it produced something reviewable but some part came up short), or `failed` (it produced nothing worth showing). Status is observable throughout: the durable Job row is the source of truth, and the Web UI & SSE Delivery and Observability PRDs build their live views and traces on top of it.

The company anchor is chosen **once, at input**, and frozen into the Job: either a disambiguated domain/brand-id the user picked (via autocomplete or the options list), or — as an explicit, degraded fallback — a raw name only. Re-running a company creates a fresh Job against that same frozen anchor and produces fresh Results; "re-runs resolve fresh" means the later Resolve stage re-fetches live brand, context, and collisions for that anchor, but the Job never re-decides *which* company it is.

## User Stories

1. As a Drumbeat customer, I want to submit a single company name or domain and immediately get back a Job I can watch, so that I can hand off the slow research work and check on it rather than waiting on a spinning request.

2. As a Drumbeat customer, I want my submission to start a background run rather than block my browser, so that a research job that takes minutes does not tie up the page or time out.

3. As a Drumbeat customer, I want the company I picked at input to stay the company the run is about, so that the digest I get back is unambiguously about the business I meant and not a same-named one.

4. As a Drumbeat customer, I want to re-run a company later and get a brand-new Job with fresh Results, so that I can see what has been published since my last run without my old results bleeding into the new ones.

5. As a Drumbeat customer, I want a re-run to reflect today's live brand and context for the company I originally chose, so that the run stays current without ever quietly switching to a different company.

6. As a Drumbeat customer, I want every Job to reach a clear, final state, so that I always know whether to keep waiting, start reviewing, or try again.

7. As a Drumbeat customer, I want a Job that produced a usable list but hit some snags to be honestly labelled as finished-with-warnings, so that I can trust the list while knowing exactly which parts came up short.

8. As a Drumbeat customer, I want a Job that produced nothing worth reviewing to be plainly marked as failed, so that I am not handed an empty page dressed up as a result.

9. As an internal analyst, I want to submit a company by its exact disambiguated identity rather than a bare name, so that collision-heavy names resolve against the right business from the start.

10. As an internal analyst, I want to fall back to a name-only Job when I have nothing better than a name, so that I can still run a degraded search and be told plainly that it is degraded.

11. As an internal analyst, I want each Job to record why it ended the way it did — clean, with which warnings, or failed — so that I can audit run quality across many companies.

12. As an internal analyst, I want re-runs of the same company to be separate, comparable Jobs, so that I can track how coverage of a company changes over time.

13. As a prospect evaluating the tool, I want submitting a company and watching it run to be self-explanatory on first try, so that I understand what the product does without a manual.

14. As a prospect, I want the run to end in a state I can read at a glance, so that my first experience ends with a clear outcome rather than ambiguity.

15. As a developer, I want a single Job aggregate that owns its own state transitions, so that no caller can shove a Job into an illegal state and the lifecycle stays correct as stages are added.

16. As a developer, I want the enqueue side and the execution side to be cleanly separated across a process boundary, so that the web process stays responsive and the worker can be scaled and deployed independently.

17. As a developer, I want exactly one background unit of work per Job with stages running in-process and sequentially, so that the run is simple to reason about and the whole run maps to one trace later.

18. As a developer, I want a stage-runner skeleton with a simple, uniform interface for stages, so that PRDs 2–6 can each drop in a stage without touching the lifecycle machinery.

19. As a developer, I want Warning accumulation and terminal-state selection to live in one well-tested place, so that "partial success" versus "failure" is decided consistently no matter which stage reports trouble.

20. As a developer, I want the durable schema for jobs, results, resolved identity, and warnings defined up front at a conceptual level, so that later stages persist into a stable shape rather than reshaping storage as they land.

21. As a developer, I want a Result to be born `included` and only ever transition to `excluded`, so that the soft-exclusion model is enforced by storage and no stage can silently drop a row.

22. As a developer, I want re-runs to be modelled as new Jobs against the frozen anchor, so that Result history is never mutated in place and each run is independently reviewable.

23. As an operator, I want to stand up the web and worker processes, submit a company, and watch a Job go `pending → running → done` through an empty pipeline, so that I can verify the whole spine works before any stage exists.

24. As an operator, I want the worker to claim a Job durably, so that a Job in flight is not lost or double-run if a worker restarts.

25. As an operator, I want a Job that throws unexpectedly to land in `failed` with the failure recorded, so that I can find and diagnose broken runs rather than have them hang in `running` forever.

26. As an operator, I want the process boundary between enqueue and execution established now, so that the Observability PRD can attach a span link across that boundary without re-architecting the handoff.

## Implementation Decisions

### Modules to build

**Job aggregate (domain).** The heart of this PRD. A deep domain object that owns the Job's identity, its frozen company anchor, its state, its accumulated Warnings, and the only legal transitions between states. Its interface is small and behavioural, not a bag of setters: create a `pending` Job from a company anchor; start it (`pending → running`); record a Warning against it; complete it (which derives the terminal state from the Warning list); and fail it (with a failure reason). The aggregate, not any caller, decides whether completion lands on `done` or `done_with_warnings`. Illegal transitions are rejected by the aggregate. This is the testable core; everything else is an adapter around it.

**Company anchor (domain value).** The durable, frozen disambiguation chosen once at input. It is one of two shapes: a disambiguated anchor (a domain and/or brand-id the user picked) or the explicit degraded name-only fallback. Provenance is carried (e.g. `url_provided` for a URL-supplied host) so later stages and Warnings can reason about how much the user already gave us. The anchor is immutable for the life of the Job — re-runs copy the anchor into a new Job, never re-derive which company it is. Note: the actual disambiguation *interaction* (autocomplete, the options list, the homepage-fetch and collision logic) belongs to the Resolve Stage PRD; this PRD only owns the frozen anchor as it sits on the Job.

**Job application service / use-cases (application).** Thin orchestration over the aggregate and its ports. Two entry points matter here: *submit a Job* (validate input via Zod, construct the anchor, persist a `pending` Job, enqueue one unit of work) used by the web process; and *run a Job* (load the Job, start it, drive the stage runner, complete or fail it, persist throughout) used by the worker. These are use-cases behind ports, not framework controllers.

**Stage runner (application).** The in-process sequential pipeline skeleton. It holds an ordered list of stages and runs them one after another against a shared run context (the Job and its Resolved Identity-to-be, plus a Warning sink). In this PRD the list is empty or a no-op placeholder; later PRDs register Resolve, Search, Filter, Verify/Extract/Classify/Enhance, and Summarise into it in order. A stage exposes a simple uniform port: given the run context, do your work, append Warnings to the sink, and either succeed or signal a Job-failing condition. The runner is responsible for catching a stage's unexpected throw, translating "produced nothing to show" into a Job failure, and letting recoverable shortfalls become Warnings — but the *policy* for which is which lives with the Warning rules below, not hard-coded per stage.

**Persistence adapters (infrastructure, Drizzle/Postgres).** Repository ports for loading and saving Jobs (with their Warnings and Results), implemented over Drizzle. The domain depends on the port; the Drizzle implementation is the adapter (Hexagonal).

**Queue adapters (infrastructure, BullMQ/ioredis).** A producer port the submit use-case calls to enqueue one unit of work per Job, and a consumer (the worker entrypoint) that binds the run use-case to incoming jobs. The domain and application layers never import BullMQ directly.

**Web entrypoint (`breakbeat-web`) and worker entrypoint (`breakbeat-worker`).** Two NestJS processes. The web process serves the form POST (and, per the Web UI PRD, the SSE and list views). The worker process consumes the queue and runs Jobs. They are decoupled in time and deployed separately.

### The Job state machine

```
pending ──start──▶ running ──┬─complete(no warnings)──▶ done
                             ├─complete(warnings ≠ ∅)──▶ done_with_warnings
                             └─fail──────────────────▶ failed
```

- `pending` — created and persisted at submit; enqueued; not yet claimed.
- `running` — the worker has claimed the unit of work and is driving the stage runner.
- `done` — terminal; the pipeline completed and the Job's Warning list is empty.
- `done_with_warnings` — terminal; the pipeline completed and the Warning list is non-empty.
- `failed` — terminal; the pipeline hit a Job-failing condition or an unexpected throw and there is nothing worth reviewing.

The three terminal states are absorbing. The choice between `done` and `done_with_warnings` is **derived**, not set by a caller: it is `done_with_warnings` if and only if the Job's Warning list is non-empty at completion. (This is the CONTEXT.md rule for **Warning** stated as a state-machine invariant.)

### Schema changes (conceptual — Drizzle/Postgres)

Four durable concerns. Names below are conceptual, not column specs:

- **jobs** — one row per Job. Carries the Job id, the frozen company anchor (its shape and provenance — disambiguated domain/brand-id or name-only fallback), the current state, timestamps for created/started/terminal, and a nullable failure reason. The anchor is written once at submit and never updated.
- **resolved_identity** — one job-scoped row produced later by the Resolve stage (company name plus zero or more own domains and scraped handles, Brand Context, and the carried Name Collisions / Negative Boost). Defined here as the durable target so the schema is stable; populated by the Resolve Stage PRD. It is *derived per-run* and distinct from the frozen anchor on the Job.
- **results** — many rows per Job. Each Result is born with `status = included` and the only legal status transition is to `excluded`, carrying a closed-set `exclusion_code` (`own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`, `off_topic`) and a nullable human-readable `exclusion_detail`. Match Score, `verification_status`, Content Type, sentiment, and takeaway are nullable columns populated by later stages (NULL is read as "hasn't reached that stage yet" / "unverified" / "unclassified" — never a stored sentinel). Results are scoped to their Job; re-runs produce fresh rows. An insert-time unique constraint on normalized URL within a Job gives Search its URL-dedup (the Collapse title pass is a later stage, not modelled here).
- **warnings** — many rows per Job. Each records a stage's partial-success note (a type and a human-readable message). The presence of any warning row drives the terminal-state choice above.

Exact column types, indexes, and migrations are an implementation detail of the adapter; the conceptual rows and their invariants (frozen anchor, born-included Result, closed exclusion-code set, warning-presence-drives-terminal-state) are the load-bearing decisions.

### The enqueue→worker contract

- **One BullMQ job per Job.** The submit use-case enqueues exactly one unit of work carrying the Job id (and the data the worker needs to load it). Stages run in-process and sequentially inside that one unit — this is *not* a per-stage queue or a BullMQ Flow. (Per-stage queue isolation is explicitly deferred in ADR 0004; if it is ever added, `traceparent` propagation must be added on the same change.)
- **Two processes, decoupled in time.** Enqueue happens on `breakbeat-web`; execution happens on `breakbeat-worker`. They are different processes that may run minutes apart. This process boundary is established here so that the Observability PRD can inject `traceparent` at enqueue and open a new, *linked* (never continued) root span at the worker — the span-link detail itself lives in ADR 0004 and the Observability PRD, but the boundary it relies on is this contract.
- **Durable claim.** The worker claims the unit of work durably (BullMQ's reservation), moves the Job to `running`, and on completion or failure writes the terminal state. A worker restart must not lose or double-run a Job; an unexpected throw must drive the Job to `failed` (with the reason recorded) rather than leaving it stuck in `running`.
- **A second, fire-and-forget notification channel.** Distinct from the one work-carrying BullMQ job, the worker also publishes id-only **Redis Pub/Sub** nudges after each DB write so the web process can drive SSE (ADR 0006). This is a *notification* channel, not a work hop: Postgres remains the source of truth, the worker publishes whether or not anyone is listening, and it does not appear in the Job Trace (which links only the enqueue→worker work hop).

### Warning vs. failure / terminal-state rules

- A **Warning** is a recorded note that a stage completed its purpose *partially* — it is a partial *success*, not an error. Warnings accumulate on the Job.
- A stage failure fails the **Job** *only* when it leaves **nothing to show** — and "nothing to show" means **there was no population to judge**, not "the judged population narrowed to zero." The canonical example is all Search queries failing: Search returned no Results at all, so there is no reviewable list and the Job is `failed`. A Job whose Search *did* return Results that were then all Excluded (every hit own-channel/aggregator/off-topic) is **not** `failed` — the pipeline ran correctly and produced an honest finding ("no in-scope third-party coverage in the last 36 months"). That outcome is `done` / `done_with_warnings`, never `failed`. (Search and the other stages live in later PRDs; this PRD owns the rule and the mechanism, the runner's policy hook, not the per-stage thresholds.)
- A *total* failure of a non-essential stage is still only a **Warning**. The canonical example is a total Classify failure: the reviewable list still exists, just untyped and unaudited, so the Job ends `done_with_warnings`, never `failed`. (CONTEXT.md and ADR 0004 both insist a Warning is never an error and never marks a failure.)
- Terminal state on completion is `done_with_warnings` **iff** the Warning list is non-empty, else `done`.
- An unexpected throw escaping a stage is a Job-failing condition → `failed`.

### Re-run semantics

**Re-run has no dedicated entry point.** It is simply the *submit* use-case re-invoked against the same disambiguated anchor — there is no separate "re-run" operation. Submitting the same company again (picking the same autocomplete brand / same domain) produces a new Job with fresh Results; the mechanism already exists in *submit*. A first-class re-run *affordance* (a one-click "Re-run" button that submits the stored anchor without re-disambiguation) is deferred — purely additive later, and explicitly out of scope for the Web UI PRD's MVP. Re-running a company creates a **new Job** whose frozen anchor is copied from the prior run's anchor (or re-supplied identically at input) — never re-disambiguated. The new Job produces its own fresh Results and its own Resolved Identity. "Re-runs resolve fresh" is precisely scoped: the Resolve stage re-fetches live brand/context/collisions for the frozen anchor, but the Job never re-chooses which company it is. Old Jobs and their Results are immutable history.

### ADR references

- **ADR 0004 (OTel instrumentation)** constrains the process model this PRD establishes: one BullMQ job per Job, stages in-process and sequential, `breakbeat-web`/`breakbeat-worker` as distinct `service.name`s, enqueue→worker as the only cross-process hop, and the deferral of per-stage queues. The terminal-state-to-span-status mapping (a Warning is `OK` + a span event; only a failure is `ERROR`/Bugsink) is the telemetry face of the Warning rules above.
- **ADRs 0001, 0002, 0003** constrain later stages (Negative Boost shape, search source model, the fused full-text Haiku call) and are not implemented here; they are noted so the durable schema (Resolved Identity, Results' nullable stage columns) leaves room for them without rework.

## Testing Decisions

TDD throughout — every module below is specified by a failing test first. The guiding principle: test **external behaviour**, not internal wiring. Assert on observable state transitions and persisted facts, never on which private method ran.

**Job aggregate — Vitest (unit).** The richest unit suite, because the aggregate is the deep core. Cover: a freshly created Job is `pending` with the exact anchor it was given; `start` moves `pending → running` and is rejected from any terminal state; `complete` with no Warnings yields `done`; `complete` with one or more Warnings yields `done_with_warnings`; `fail` yields `failed` with the reason; every illegal transition (e.g. completing a `pending` Job, starting a `failed` one, transitioning out of a terminal state) is rejected. Test the `done` vs `done_with_warnings` derivation as a property of the Warning list, not as something the caller chooses. Test the frozen-anchor invariant: the anchor cannot be mutated after creation, and a name-only anchor and a disambiguated anchor are both representable with correct provenance.

**Warning/terminal-state policy — Vitest (unit).** Drive the runner's "nothing to show → fail; partial → warn" decision with fake stages: a stage that reports a recoverable shortfall produces a Warning and the Job completes (`done_with_warnings`); a stage that signals "nothing to show" fails the Job; a stage that throws unexpectedly fails the Job with the throw recorded. Prove a total non-essential stage failure (Classify-shaped fake) is only a Warning.

**Stage runner — Vitest (unit).** With an empty stage list the runner completes the Job cleanly (`done`). With fake stages it runs them in registered order, threads the shared run context through, accumulates Warnings into the sink, and stops/fails on a Job-failing condition. Stages are exercised through their port with test doubles — no real Resolve/Search/etc. exist yet.

**Application use-cases — Vitest (unit) with port fakes.** *Submit* validates input via Zod (reject blank/garbage; accept a name; accept a disambiguated anchor), constructs the correct anchor shape, persists a `pending` Job through a fake repository, and enqueues exactly one unit through a fake producer. *Run* loads a Job, starts it, drives the runner, and persists the derived terminal state. Repository and queue are fakes here; their real adapters are tested separately.

**Persistence adapters — Playwright/integration against real Postgres.** Round-trip a Job (anchor shape and provenance, state, Warnings, failure reason) through real Drizzle/Postgres; assert the born-`included` default and the `included → excluded` constraint on Results; assert the within-Job URL-unique constraint rejects a duplicate insert; assert re-running produces a new Job id with its own Results rather than mutating the old. These are integration tests because the invariants live in the schema, not in code.

**Queue adapter + worker — Playwright/integration against real Redis.** Enqueue one unit and assert the worker claims it, transitions the Job, and reaches a terminal state; assert a thrown stage drives `failed` and does not leave the Job in `running`; assert a worker restart does not double-run a claimed Job.

**Tracer-bullet end-to-end — Playwright (integration).** The slice that proves the spine: POST the form on `breakbeat-web`, observe a `pending` Job, let `breakbeat-worker` run the empty pipeline, and assert the Job reaches `done` and is observable. This is the acceptance test for this PRD.

**Prior art / tooling.** Vitest for all pure-domain and port-faked application logic; Playwright for anything that crosses a real boundary (Postgres, Redis, the two processes). Autoevals is *not* used in this PRD (it scores the Verify/Classify precision-recall work in later PRDs against the Aglow labelled set). Every file must keep an FTA complexity assessment of `OK`; Biome and `tsc` gate formatting and types.

## Out of Scope

- The disambiguation **interaction** at input — autocomplete, the BrandFetch Brand Search options list, the homepage fetch, collision discovery. This PRD only owns the *frozen anchor* the interaction produces. (Resolve Stage PRD.)
- All actual pipeline **stages** — Resolve, Search, Filter & Collapse, Verify/Extract/Classify/Enhance, Summarise. This PRD ships only the empty stage-runner skeleton they plug into. (PRDs 2–6.)
- **SSE delivery** and any Web UI beyond the bare submit POST needed for the tracer bullet — the live result list, company profile card, filters, paginator, result-row page. (Web UI & SSE Delivery PRD.)
- **OpenTelemetry** spans, the enqueue→worker span link itself, metrics, the Bugsink/otel-lgtm signal split. This PRD establishes only the process boundary the span link will cross. (Observability PRD, ADR 0004.)
- Result-level domain values — Match Score, Verification, Content Type, Sentiment, Enhancement, Collapse, Negative Boost. Their durable columns are reserved in the schema; their *behaviour* is later PRDs.
- Authentication, multi-tenancy, rate limiting, and scheduled/recurring Jobs.

## Further Notes

- **Vocabulary is load-bearing.** Nothing is ever "dropped," "deleted," or "filtered out" — a Result is **Excluded** (soft, with a code). Nothing is "fetched" except the Resolve homepage fetch. A **Warning** is a partial success, never an error; reserve "error"/"failed" for Job-failing conditions only. A **Job** *contains* stages; it is never itself a "search" or a "task."
- **The anchor/identity distinction is the subtle one.** The **company anchor** is frozen at input and immutable. The **Resolved Identity** is derived fresh each run by Resolve. Re-runs resolve fresh against the frozen anchor — they never re-decide which company it is. Keep these two separate in code and schema; conflating them reintroduces the disambiguation bug this design exists to prevent.
- **Why one BullMQ job, not a Flow.** Sequential in-process stages keep the whole run as one trace (ADR 0004) with zero cross-job plumbing. Per-stage queue isolation is deferred, not rejected; if added, `traceparent` propagation on each hop must land on the same change.
- **The empty pipeline is the point of the tracer bullet.** It proves submit → enqueue → claim → run → terminal → observe before any stage exists, so PRDs 2–6 each land as an isolated, independently testable vertical slice against a spine that already works.
- **Anti-echo discipline starts here.** `exclusion_detail` records the *catcher* (e.g. "LLM"), never free text from a model — it is a prompt-injection echo channel. The same rule extends to telemetry later (ADR 0004). Bake the discipline into the schema's intent now even though the LLM stages arrive later.
