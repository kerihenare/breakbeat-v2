---
name: verification
description: Use when verifying Breakbeat code before claiming a task, stage, or PR done — running the quality gate, or deciding which checks apply and what their pass bar is. Covers the brief's verification tools (Biome lint/format, tsc type-check, FTA complexity with every non-test file Assessment OK, Vitest unit, Playwright integration, Autoevals against the Aglow precision/recall set), the exact pnpm commands, what's wired vs not-yet-installed, and which check applies to deterministic vs LLM-driven code.
---

# Verification — the quality gate before "done"

## Overview

"Verification" is proving a change meets Breakbeat's quality bar before you claim it complete. The brief fixes six tools; this skill is the **contract** for how they compose into one ordered gate, what each catches, and — the part that goes wrong — *which check applies to which code*.

**Core principle: run the gate fast-to-slow, deterministic-before-non-deterministic, and scope each tool to the code it actually judges.** Biome/tsc/FTA judge *every* file. Vitest vs Playwright splits on whether a real boundary is crossed. Autoevals judges *only* the LLM-driven stages against a labelled set — never deterministic logic. Run the wrong tool on the wrong code and you either gate on noise or claim done without proving the thing that could actually be wrong.

> **This is the contract, not a wired pipeline.** `package.json` has `"scripts": {}`, there is no `tsconfig.json` yet, and **only Biome (and the `typescript` devDep) are installed** — Vitest, Playwright, FTA, and Autoevals are named in the brief but **not yet in `devDependencies`**. The commands below are the source of truth for the gate; until a tool is wired, run it via `pnpm dlx`/`pnpm exec` and add it to deps + a `package.json` script as the slice that needs it lands. An "absent" tool means *not yet installed*, not *not required*. Package manager is **pnpm**.

## The gate (run in this order)

| # | Tool | Catches | Command | Pass bar | Wired? |
|---|---|---|---|---|---|
| 1 | **Biome** | Format, lint, import/key/attr sort | `pnpm biome check .` (fix: `--write`) | exit 0, no errors | ✅ installed |
| 2 | **TypeScript** | Type errors | `pnpm exec tsc --noEmit` | exit 0 | ⚠️ dep present, **no `tsconfig` yet** |
| 3 | **FTA** | Per-file complexity | `pnpm dlx fta-cli src` | **every non-test file `Assessment: OK`** | ❌ not installed |
| 4 | **Vitest** | `test:unit` (port-faked / pure logic) + scoped `test:integration` (single-adapter vs compose Postgres) | `pnpm exec vitest run` (split below) | all green, no skipped stage tests | ❌ not installed |
| 5 | **Playwright** | Two-process E2E + a11y floor (axe-core, WCAG 2.2 AA subset) | `pnpm exec playwright test` | all green, zero axe violations | ❌ not installed |
| 6 | **Autoevals** | LLM-stage precision/recall & quality | graded suites over `.input/test-case.md` (no CLI) | tracked thresholds met, no regression | ❌ not installed |

1–3 plus the hermetic `test:unit` half of 4 are cheap and run on **every** change (`pnpm verify`). The rest of 4 (single-adapter `test:integration` against compose Postgres), 5, and 6 are scoped — run when the slice touches them (below).

## Scoping rules (where agents go wrong)

**FTA — the easily-forgotten gate.** The brief's most explicit acceptance criterion: *every file excluding tests has `Assessment: OK`*. Any file scoring `Could be better` or `Needs improvement` **fails the gate** and must be split before "done" (see the `reduce-complexity` skill). Exclude test files from the judgement — configure `.ftarc.json` (`{ "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/*.e2e.ts"] }`) rather than eyeballing. These globs are the **single test-tier vocabulary** the whole gate shares: `*.test.ts` = unit (the `pnpm verify` set), `*.integration.test.ts` = single-adapter integration (still caught by `**/*.test.ts`, so no extra FTA rule), `*.e2e.ts` = Playwright. One suffix convention drives both the Vitest tier split and the FTA excludes, so the two can't drift. FTA judges *complexity*, not behaviour — it can pass while tests fail, and vice-versa.

**Vitest vs Playwright — split on the surface under test, not the presence of I/O.** Both can cross a real boundary; what differs is *how much system* is under test — one component, or the whole spine.
- **Vitest** owns *pure domain/application logic* (port fakes / in-memory doubles) **and** *single-adapter integration* — one component against one real dependency. The Job aggregate's state machine, the Filter rules over labelled fixtures, the Search query-plan/escalation gate, view-model formatting, adapter contract tests with `fetch` stubbed — and a single Drizzle repository exercised against **the dev `docker-compose.yml` Postgres** (a dedicated test database/schema on the same `postgres:17-alpine` container, **not** Testcontainers: the compose stack is the one source of real backing services, so tests reuse it rather than minting a parallel container lifecycle — ADR 0008).
- **Playwright** owns the *end-to-end spine*: the running `breakbeat-web` + `breakbeat-worker` processes together, real Postgres/Redis, the Web UI flows and SSE live-update behaviour, plus the **automated accessibility floor** against the rendered DOM. That floor is **zero `@axe-core/playwright` violations at the WCAG 2.2 AA ruleset on every rendered view** — AA is the committed bar (PRODUCT.md). It is an automated *subset*, **not** a claim of full AA conformance: axe-core catches the machine-detectable rules; manual AA concerns (keyboard traps, focus order, real screen-reader passes) live outside this gate and aren't proven by a green run.

**Autoevals — LLM stages only, against the Aglow set.** Autoevals is an npm library of scorers (not a CLI); you invoke it from graded eval suites. It judges the **non-deterministic, LLM-driven** work against the labelled Aglow set in `.input/test-case.md` (**14 include, ~300 exclude**):
- **Verify / Classify** — precision/recall on include/exclude verdicts and Content Type assignments. Assert the confusable indexed-brand middle (HomeAglow, Aglow Air) is Excluded at the full-text re-pass.
- **Search** — recall floor: the broad-then-escalate plan recalls the labelled include URLs.
- **Summarise** — faithfulness/groundedness of the digest (optional quality gauge).

Autoevals scores **LLM output judged by an LLM** — it varies run-to-run and costs real API spend — so the gate is **two-tier**, and it runs **on-demand when an LLM stage changes, never per-commit** (real spend, needs API keys, no CI wired):

1. **Hard invariants — pass/fail.** Effectively deterministic on the Aglow set: the labelled includes are recalled, and the confusable indexed middle (HomeAglow, Aglow Air) is Excluded at the full-text re-pass. These either hold or they don't — a green/red gate from day one.
2. **Aggregate precision/recall — tracked with a tolerance band, not a hairline trip.** On a stage's **first** eval run there is no prior bar: record the measured precision/recall as the baseline and commit it beside the eval suite. "No regression" thereafter means *outside a configured tolerance below baseline* (a few points, or a 2-of-3-run median) — a dip **inside** the band is recorded, not failed. A single noisy run that lands one verdict low never trips the gate; gating a hairline on a non-deterministic metric *is* gating on noise.

**Deterministic logic does NOT get Autoevals.** Filter is pure rules → assert exact `excluded` / `exclusion_code` / `exclusion_detail` outcomes in **Vitest fixtures**, written TDD. Per ADR 0001, the only place an Autoevals result *gates a decision* today is the gated per-collision-diff experiment — adopted only on a measured precision/recall improvement on the Aglow set.

## Quick reference

```bash
# Fast hermetic gate, fast-to-slow — `pnpm verify`, run on EVERY change (no container needed):
pnpm biome check .            # 1 format + lint  (--write to autofix)
pnpm exec tsc --noEmit        # 2 types          (needs a tsconfig)
pnpm dlx fta-cli src          # 3 complexity     (every non-test file → Assessment: OK)
pnpm exec vitest run --exclude '**/*.integration.test.ts'   # 4 test:unit — *.test.ts, port-faked / pure logic, NO I/O

# Scoped heavier tiers — run when the slice touches them (need a running stack):
pnpm exec vitest run '**/*.integration.test.ts'   # test:integration — single-adapter vs compose Postgres (needs `docker compose up`)
pnpm exec playwright test         # 5 E2E across web+worker, Web UI, axe-core a11y floor (WCAG 2.2 AA subset)
#   6 Autoevals: on-demand when an LLM stage changes — graded eval suite over .input/test-case.md
#      — Verify/Classify precision-recall, Search recall, Summarise faithfulness.
```

Once wired, prefer the `package.json` scripts; the raw commands above remain the contract those scripts must honour. The split that keeps the per-change loop hermetic: **`pnpm verify` = steps 1–3 + `test:unit`** (no container, runs on a clean checkout), with `test:integration` (needs the compose Postgres up), `pnpm e2e` (Playwright, needs both processes), and Autoevals (on-demand) as the scoped tiers run when the slice touches them.

## Common mistakes

| Mistake | Reality |
|---|---|
| Skipping FTA / not knowing the bar | FTA is a gate, not advice: **every non-test file must be `OK`**. It's the brief's most explicit criterion and the easiest to forget. |
| Counting test files against the FTA bar | Tests are excluded — set `.ftarc.json` excludes; don't refactor a test to chase an FTA score. |
| Running Autoevals on Filter / pure logic | Deterministic stages use Vitest fixtures. Autoevals is for LLM stages (Verify/Classify/Search/Summarise) against the Aglow set only. |
| Treating Autoevals as a CLI | It's a scorer library invoked from eval suites — there's no `autoevals` command. |
| `pnpm test` / `npm run lint` | `scripts` is empty. Until wired, use the raw `pnpm exec` / `pnpm dlx` commands above. |
| Playwright for single-component work | If only one component is under test, it's Vitest — port fakes, or one real dependency via the compose Postgres. Playwright is for the *two-process spine* together, the browser, SSE, and a11y. |
| `tsc` "passes" with no tsconfig | No `tsconfig.json` exists yet — type-checking isn't meaningfully wired until one does. |
| "Biome is green, so I'm done" | Biome is step 1 of 6. Green lint proves nothing about types, complexity, behaviour, or LLM-stage quality. |
| Claiming done before the gate runs | Verification is evidence, not assertion — run the applicable steps and report their output before saying complete. |
