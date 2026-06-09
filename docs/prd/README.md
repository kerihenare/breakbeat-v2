# Breakbeat PRDs

Eight PRDs decomposing the Breakbeat build into deep modules / vertical slices, synthesised from `PRODUCT.md`, `CONTEXT.md` (the ubiquitous-language glossary), `DESIGN.md`, the `.input/` brief + specs, the Aglow test case, the `mockups/`, and ADRs 0001–0004. All terminology follows `CONTEXT.md`; all architectural decisions follow `docs/adr/`.

| # | PRD | Depends on | ADRs |
|---|-----|-----------|------|
| 1 | [Foundation & Job Lifecycle](01-foundation-job-lifecycle.md) | none | 0004 |
| 2 | [Resolve Stage](02-resolve-stage.md) | 1 | 0001 |
| 3 | [Search Stage](03-search-stage.md) | 1, 2 | 0002, 0005 |
| 4 | [Filter & Collapse](04-filter-collapse.md) | 1, 3 | 0005 |
| 5 | [Verify / Extract / Classify / Enhance](05-verify-extract-classify-enhance.md) | 1, 2, 3, 4 | 0001, 0003 |
| 6 | [Summarise](06-summarise.md) | 1, 5 | 0002 |
| 7 | [Web UI & SSE Delivery](07-web-ui-sse.md) | 1 (+ all stage outputs) | 0004, 0006, 0007 |
| 8 | [Observability (OTel)](08-observability-otel.md) | 1 (cross-cuts all) | 0004, 0003 |

## Dependency graph

```
        ┌──────────────────────────── 1. Foundation & Job Lifecycle ───────────────────────────┐
        │                                      │                          │                     │
        ▼                                      ▼                          ▼                     ▼
   2. Resolve ──▶ 3. Search ──▶ 4. Filter & Collapse ──▶ 5. Verify/Extract/Classify/Enhance ──▶ 6. Summarise
        │              │                │                          │                            │
        └──────────────┴────────────────┴──────────┐               │                            │
                                                    ▼               ▼                            ▼
                                          7. Web UI & SSE  (consumes Resolved Identity, Results, Match Score, Summary)

   8. Observability (OTel) ── instruments the Job lifecycle and every stage; build alongside.
```

## Suggested build order

1. **PRD 1 — Foundation** first: the tracer-bullet slice (form POST → enqueue → empty in-process pipeline → terminal state). Everything else plugs into this skeleton.
2. **PRD 8 — Observability** can start immediately after the skeleton exists and grows with each stage (it cross-cuts).
3. **PRDs 2 → 3 → 4 → 5 → 6** in pipeline order — each is an independently testable deep module behind a port.
4. **PRD 7 — Web UI** can begin against the Foundation's read models early (rendering `pending`/`running`/terminal states and an empty live stream), then light up as stages land.

## Conventions

- **Status:** every PRD is `ready-for-agent`.
- **No file paths or code snippets** in PRDs (they go stale) — the only inlined artifacts are the Job state machine (PRD 1) and the fused full-text structured-output shape (PRD 5, per ADR 0003), each because it encodes a decision more precisely than prose.
- **TDD throughout:** every module carries a Testing Decisions section (Vitest unit, Playwright integration, Autoevals against the Aglow precision/recall set for the LLM stages).
