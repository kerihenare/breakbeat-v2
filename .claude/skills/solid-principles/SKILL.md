---
name: solid-principles
description: Use when writing, reviewing, or refactoring TypeScript in this NestJS/Hexagonal codebase, or deciding how to structure ports, application stages, adapters, or domain objects — and when judging whether a SOLID concern is real or a false positive against idiomatic NestJS DI.
---

# SOLID in this codebase

## Overview

This module (`src/modules/jobs/`) is already a clean Hexagonal design: `domain/` (entities + `ports/`), `application/` (the pipeline stages), `infrastructure/` (adapters). The architecture *encodes* SOLID — so the job of this skill is **keeping it intact and not misapplying the principles**. Adding abstraction where the code is already clear is the more common failure here than missing abstraction.

Core principle: **SOLID is a lens for "what forces this to change, and what can vary independently" — not a checklist that rewards more interfaces.** Use CONTEXT.md domain terms (Job, Resolved Identity, Result, Exclusion, Collapse, Content Type, Warning, Angle Query) when naming things.

## The five, anchored to real code

### SRP — one reason to change
- **Anchor:** each stage owns one transformation (`ResolveStage`, `SearchStage`, `FilterStage`, `ClassifyStage`); `PipelineService` only orchestrates; `Job`/`Result` each own one concept.
- **Test:** "What unrelated forces would edit this file?" Two unrelated answers → split.
- **Smell:** a stage that both fetches *and* classifies; a domain object that also talks to the DB.
- **NOT a violation:** a cohesive method with several sequential steps. `SearchStage.run` (guard → fan out Angle Queries → map hits → dedup → Warning/throw policy) is *one* responsibility: turn queries into deduped Results. Don't shatter it into a `ResultFactory`/`persistHit` just to cut line count.

### OCP — extend without editing existing logic
- **Anchor:** add a search source by writing another `SearchProvider` adapter and changing one line in `jobs.module.ts` (`{ provide: SEARCH_PROVIDER, useClass: ... }`); `SearchStage` and the port are untouched. For many sources, a `CompositeSearchProvider implements SearchProvider` fans out — still no caller changes.
- **Test:** "To add the next variant, do I edit existing logic or add a new unit?"
- **Smell:** a growing `if (source === "tavily") … else if …` switch inside a stage.
- **NOT a violation:** the explicit `Resolve → Search → Filter → Classify` sequence in `PipelineService`. The order is a deliberate domain decision that changes ~never; an explicit, readable sequence beats a data-driven `PipelineStage[]` loop + indirection. Don't abstract a pipeline that changes once a quarter.

### LSP — substitutes honor the *behavioral* contract
**The most relevant principle here, and the most misunderstood.** Every port has multiple implementations (real adapter, test fake, "unconfigured" degrade path). LSP is satisfied only when each honors the port's *documented behavior*, not just its method signatures.
- **Anchor:** `SearchProvider`'s contract — `isConfigured()` gates work; a *partial* failure becomes a Warning; an *all*-fail throws. A new adapter or a Composite that silently **swallows** per-source failures type-checks fine but breaks that contract → LSP violation.
- **Test:** "Given only the interface's promises, does every caller still behave correctly with this implementation dropped in?"
- **Kill this misconception:** "No class inheritance, so LSP doesn't apply." False — LSP governs every interface implementation. In a ports-and-adapters codebase it is the principle most in play.

### ISP — narrow, client-specific ports
- **Anchor:** ports are tiny — `SearchProvider` (2 methods), `JobRepository` (3), `IdGenerator` (1), `Clock` (1). `SearchStage` injects three small ports, not one fat gateway.
- **Test:** "Does any implementer have to stub methods it doesn't use?"
- **Smell:** a `JobsGateway` with `save/find/list/search/extract/classify`; consumers forced to depend on methods they ignore.
- **NOT a violation:** several small ports injected into one service — that's ISP working.

### DIP — policy depends on abstractions, never on detail
- **Anchor:** `domain/ports/*.port.ts` declare a `Symbol` token + interface; `infrastructure/*` implements; `jobs.module.ts` wires `{ provide: TOKEN, useClass: Adapter }`; consumers take `@Inject(TOKEN) private readonly x: Port`. The domain/application layers never import `infrastructure`.
- **Test:** "Does this import point policy → detail (down, bad) or detail → policy (up, good)?" Domain importing Tavily/Drizzle/Anthropic is the violation.
- **Kill this misconception:** DIP targets dependence on **external detail** (DB, HTTP, LLM, queue) — realized by the port files. `PipelineService` depending on concrete `SearchStage`/`FilterStage` is **NOT** a DIP violation: those are *same-layer* application peers, not low-level details, and NestJS injects them by class on purpose. Don't invent a `PipelineStage` port to "fix" it.

## False positives — do NOT flag these

CodeRabbit and generic SOLID reviews repeatedly raise these; all are idiomatic here:

| Flagged as… | Reality |
|---|---|
| Constructor parameter properties + decorators (`@Inject(TOKEN) private readonly x: T`) | Required NestJS DI. Flagged against a **retired** "erasable syntax only" guideline — false positive (see CLAUDE.md / `bd memories`). Never convert DI to manual field assignment. |
| `Symbol` token + `useClass` wiring | That IS the DIP mechanism, not coupling. |
| Orchestrator depending on concrete same-layer stages | Same-layer collaboration, not a DIP target. |
| Explicit, readable pipeline sequence | Deliberate domain ordering — don't demand a data-driven loop. |
| A cohesive method with several steps | Steps ≠ responsibilities. |

## Review checklist

1. **Imports:** does any `domain/` or `application/` file import `infrastructure/`? (DIP)
2. **New variant:** could the next source/Content Type/Exclusion rule be added as a new adapter/strategy, not an edit? (OCP)
3. **Contracts:** does each port implementation honor the documented behavior — gating, Warning vs throw, dedup? (LSP)
4. **Port width:** any implementer stubbing unused methods? (ISP)
5. **Change pressure:** does one file have two unrelated reasons to change? (SRP)
6. **Restraint:** before proposing a new interface or indirection, confirm something *actually* needs to vary. If not, leave it concrete.

## Common mistakes

- **Over-applying DIP:** demanding ports for same-layer collaborators. Ports are for *external* detail.
- **Dismissing LSP** because there's no inheritance. It applies to every port implementation — and the swallowed-failure contract break is the classic example here.
- **SRP-shattering** a cohesive method into factories/helpers to reduce its size, trading clarity for ceremony.
