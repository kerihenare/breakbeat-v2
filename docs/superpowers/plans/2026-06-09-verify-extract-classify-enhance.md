# Verify / Extract / Classify / Enhance (`analyze` stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single **`analyze`** stage — Verify, Classify, and Enhance — the fourth pipeline stage. Given a Job's `included` Results and its `ResolvedIdentity`, it runs Verification in two passes around one Extract step: a cheap **Pass 1** of two snippet gates (snippet-Verify → interim Match Score; snippet-Classify → provisional Content Type) on title + snippet + URL only; **Extract** (Tavily Extract, server-side, behind a port) for the survivors of the snippet-Verify gate only; and an authoritative **Pass 2** of one fused Haiku call per Extracted Result returning `{entityMatchScore, contentType, sentiment, takeaway}`. It produces, per surviving Result, the authoritative Match Score, `verification_status`, `content_type`, `sentiment`, and `takeaway`, and soft-Excludes the look-alikes `off_topic` (`exclusion_detail = "LLM"`). Every shortfall is a **Warning, never a Job failure**. Only Zod-validated structured output is persisted. **One schema migration** — this stage adds the single nullable `results.extracted_content` (text) column (the Extracted full text, persisted for PRD 07's Page to display); the analysis-output columns Foundation already reserved need no migration.

**Architecture:** Hexagonal on NestJS 11, inside Foundation's layering, after Resolve, Search, and Filter. Pure domain (the Match Score ratchet, the score→`verification_status` mapping at two cutoffs, the `off_topic` exclusion mapping, the Content Type / Sentiment vocabularies, the fused-analysis Zod schema, the Extract-gating predicate, the closed `ANALYZE_WARNING` set) + three new application ports (`SnippetJudgementPort`, `ContentExtractionPort`, `FullTextAnalysisPort`) + the `ResultRepository` extension (four narrow writes, incl. `setExtractedContent` for the Extracted full text) + an `AnalyzeStage implements Stage` per-Result orchestration shell with bounded concurrency. Adapters (two Anthropic Haiku, one Tavily Extract, the Drizzle repository methods) are the only impure edges; each external-call failure is a benign value, never a throw, so the shell branches on values and records Warnings.

**Tech Stack:** TypeScript, NestJS 11, Zod, Drizzle/Postgres (postgres-js), `@tavily/core` (Extract API), `@anthropic-ai/sdk` (Haiku Messages API), Vitest (unit `*.test.ts` + adapter contract `*.test.ts` + single-adapter `*.integration.test.ts` against the compose Postgres per ADR 0008), Biome, FTA. No new dependencies.

**Spec:** docs/superpowers/specs/2026-06-09-verify-extract-classify-enhance-design.md
**PRD:** docs/prd/05-verify-extract-classify-enhance.md · **ADRs:** 0001, 0003, 0004

---

## Prerequisites (read before starting)

- **Foundation (PRD 1), Resolve (PRD 2), Search (PRD 3), and Filter & Collapse (PRD 4) must be implemented.** This plan depends on and modifies their files. If any is missing, stop and implement the upstream PRD first. Specifically it relies on:
  - `src/domain/job/warning.ts` — the `Warning` value object `{ type: string; message: string }`.
  - `src/application/pipeline/stage.port.ts` — the `Stage` interface `{ readonly name: string; run(ctx: RunContext): Promise<void> }`.
  - `src/application/pipeline/run-context.ts` — `RunContext` with the read-only `resolvedIdentity: ResolvedIdentity | null` slot Resolve populates, and `recordWarning(warning: Warning): void`.
  - `src/application/pipeline/stage-runner.ts` — the ordered `StageRunner` (Resolve/Search/Filter already registered first/second/third).
  - `src/domain/resolve/resolved-identity.ts` — the `ResolvedIdentity` aggregate (`companyName: string`, `brandContext: BrandContext | null`, `negativeBoost: string`, plus `ownDomains` / `socialHandles` / `nameCollisions`) and its `static assemble(parts)` constructor.
  - `src/domain/resolve/brand-context.ts` — `BrandContext = { tagline, mission, description, tags, valueProposition, targetAudienceSegments, productsAndServices }`.
  - `src/application/search/ports/result-repository.port.ts` — the shared `ResultRepository` port (Search's `insertIncluded`; Filter's `findIncluded(jobId): Promise<FilterResult[]>` returning `{ id, url, title, snippet, publishedDate }` rows, and `recordExclusion(resultId, code, detail)`), the `RESULT_REPOSITORY = Symbol("ResultRepository")` token, and the `ExclusionCode` union from `src/domain/filter/exclusion-code.ts` (its closed set already includes `off_topic`).
  - `src/infrastructure/persistence/result.repository.ts` — Foundation/Search/Filter's `ResultDrizzleRepository` (postgres-js `PostgresJsDatabase`) which this plan extends with four methods.
  - `src/infrastructure/persistence/schema.ts` — Foundation's `results` table with the **already-reserved nullable stage columns** `match_score`, `verification_status`, `content_type`, `sentiment`, `takeaway`, the closed `exclusion_code` enum (incl. `off_topic`), and nullable `exclusion_detail`. **Task 1a adds the one new nullable column `extracted_content` (text)** to this table (the only schema edit this plan makes).
  - `src/infrastructure/anthropic/` — exists (Search's web-search backstop adapter + the Anthropic client wiring; one `ANTHROPIC_API_KEY`).
  - `src/infrastructure/tavily/` — exists (Search's Tavily Search adapter + the Tavily client config; one `TAVILY_API_KEY`).
  - `src/app-worker.module.ts` — the worker DI graph that builds the `StageRunner`.
- **One schema migration — the `extracted_content` column.** Foundation already reserved the **analysis-output** columns `match_score` / `verification_status` / `content_type` / `sentiment` / `takeaway` (all nullable) and the closed `exclusion_code` enum; this stage writes those into existing columns — exactly as Filter did, **needing no migration for them**. This stage **does** own **one** `drizzle-kit` migration: it adds the single nullable `results.extracted_content` (text) column (the Extracted full text, persisted for PRD 07's Page to display). That migration is **Task 1a** below (edit `schema.ts`, `pnpm drizzle-kit generate`, commit); there is **no other** schema change in this plan.
- **Test runner conventions (ADR 0008):** unit + adapter-contract tests are `*.test.ts` (port-faked / SDK-stubbed, **no I/O**), runnable on a clean checkout as part of `pnpm verify`. The single repository task is `*.integration.test.ts`, runs against the **`docker-compose.yml` Postgres** (NOT Testcontainers — ADR 0008 supersedes the older specs that mention it), and assumes `docker compose up` is running. Run a file with `pnpm exec vitest run <path>` and a single case with `-t "<name>"`. Set `OTEL_SDK_DISABLED=true` in the test environment.
- **Commit discipline:** one commit per task (after its tests pass), `git add <exact paths>` then a conventional `git commit -m "feat(analyze): …"`. DRY, YAGNI, TDD (red → green). `@anthropic-ai/sdk@^0.102.0`, `@tavily/core@^0.7.5`, `zod@^3.24.0`, `drizzle-orm@^0.38.0`, and `vitest` are already in `package.json` — add nothing new.
- **OTel is out of scope here** — PRD 8 owns span emission. `analyze` only upholds the *facts* the single `analyze` Stage Span will read and the **anti-echo** discipline (only Zod-validated structured output persisted; `exclusion_detail` always `"LLM"`; no raw prompt/snippet/page/completion text in any stored column).

---

## Task 1: `ratchet` — the three-rung Match Score ratchet

**Files:**
- Create: `src/domain/analyze/match-score.ts`
- Test: `src/domain/analyze/match-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/analyze/match-score.test.ts
import { describe, it, expect } from "vitest";
import { ratchet, type MatchScoreRung } from "./match-score";

describe("ratchet", () => {
  it("clamps and rounds a score into the 0-100 ordering key", () => {
    expect(ratchet("interim", 73.4)).toBe(73);
    expect(ratchet("final", 73.6)).toBe(74);
    expect(ratchet("provisional", -5)).toBe(0);
    expect(ratchet("final", 142)).toBe(100);
  });

  it("treats the boundary values 0 and 100 as valid", () => {
    expect(ratchet("interim", 0)).toBe(0);
    expect(ratchet("final", 100)).toBe(100);
  });

  it("is a pure function of (rung, score) — the rung never changes the number", () => {
    const rungs: MatchScoreRung[] = ["provisional", "interim", "final"];
    for (const rung of rungs) expect(ratchet(rung, 55)).toBe(55);
  });

  it("models latest-rung-overwrites: a sequence keeps only the latest value (no blend/max/average)", () => {
    // The shell writes provisional (Search), then interim, then final; each call returns the latest
    // rung's own clamped score — there is no read of the prior persisted value.
    const provisional = ratchet("provisional", 40);
    const interim = ratchet("interim", 62);
    const final = ratchet("final", 35);
    expect([provisional, interim, final]).toEqual([40, 62, 35]); // final overwrites even when LOWER
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/match-score.test.ts`
Expected: FAIL — `Cannot find module './match-score'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/analyze/match-score.ts

/**
 * The three resolutions of the Match Score, each REPLACING the last:
 * - "provisional": Tavily's relevance, written by Search.
 * - "interim": snippet-Verify (this stage, Pass 1).
 * - "final": the fused full-text call's entityMatchScore (this stage, Pass 2 — authoritative).
 */
export type MatchScoreRung = "provisional" | "interim" | "final";

/**
 * Pure clamp + round into the 0-100 ordering key the UI sorts by descending at every moment.
 * "Latest rung overwrites": the function never reads or compares the prior persisted value —
 * WHICH rung is written is the orchestration shell's decision (interim vs final repository write),
 * and a later rung simply overwrites the earlier persisted number (no blend, no max, no average).
 */
export function ratchet(_rung: MatchScoreRung, score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/match-score.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/analyze/match-score.ts src/domain/analyze/match-score.test.ts
git commit -m "feat(analyze): Match Score ratchet (provisional/interim/final, latest rung overwrites)"
```

---

## Task 1a: `extracted_content` column migration (the one schema change this stage owns)

**Files:**
- Modify: `src/infrastructure/persistence/schema.ts` (add the nullable `extracted_content` text column to `results`)
- Generated: `drizzle/<timestamp>_*.sql` (emitted by `pnpm drizzle-kit generate`)

> This stage owns **one** migration: the single nullable `results.extracted_content` (text) column that holds the Extracted full text so **PRD 07's Page can display it** ("Extracted via Tavily"). Stages own their own migrations (Search added `url`/`title`/`snippet`/`published_date`; Summarise adds the `summaries` table). This is **one new column, not a broad migration** — the analysis-output columns (`match_score` / `verification_status` / `content_type` / `sentiment` / `takeaway`) are already reserved by Foundation and need no migration. Read the existing `results` table in `schema.ts` first and match its column style (snake_case DB names via the property mapping the file already uses).

- [ ] **Step 1: Add the column to the `results` table in `schema.ts`**

Add the one nullable text column alongside the existing `results` columns (mirror the file's existing column declaration style — `text(...)`, nullable by default, no `.notNull()`):

```ts
// src/infrastructure/persistence/schema.ts — add inside the existing `results` table definition:
  // The Extracted full text (Tavily Extract, server-side), persisted ONLY for PRD 07's Page to display
  // ("Extracted via Tavily"). Nullable: a Result whose Extract failed (or has not run) leaves it NULL.
  // Display-only — never copied into exclusion_detail, a log, or a span attribute (anti-echo unaffected).
  extractedContent: text("extracted_content"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new `drizzle/<timestamp>_*.sql` migration whose only change is `ALTER TABLE "results" ADD COLUMN "extracted_content" text;` (one column, nullable, no other table touched). Inspect the generated SQL and confirm it adds exactly that single column and nothing else.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: clean — the schema change is additive; existing inserts/queries are unaffected (the column is nullable).

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/persistence/schema.ts drizzle/
git commit -m "feat(analyze): add nullable results.extracted_content column (the Extracted full text for PRD 07's Page)"
```

---

## Task 2: `classifyScore` — the score→`verification_status`/exclude mapping (two cutoffs)

**Files:**
- Create: `src/domain/analyze/verification-status.ts`
- Test: `src/domain/analyze/verification-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/analyze/verification-status.test.ts
import { describe, it, expect } from "vitest";
import { classifyScore, type Cutoffs, type VerificationStatus } from "./verification-status";

const SNIPPET: Cutoffs = { tExclude: 25, tVerified: 70 }; // lenient snippet-pass cutoff
const FULL_TEXT: Cutoffs = { tExclude: 40, tVerified: 70 }; // stricter full-text cutoff

describe("classifyScore", () => {
  it("below tExclude → exclude", () => {
    expect(classifyScore(0, FULL_TEXT)).toEqual({ kind: "exclude" });
    expect(classifyScore(39, FULL_TEXT)).toEqual({ kind: "exclude" });
  });

  it("[tExclude, tVerified) → uncertain", () => {
    expect(classifyScore(40, FULL_TEXT)).toEqual({ kind: "uncertain", status: "uncertain" });
    expect(classifyScore(69, FULL_TEXT)).toEqual({ kind: "uncertain", status: "uncertain" });
  });

  it("≥ tVerified → verified", () => {
    expect(classifyScore(70, FULL_TEXT)).toEqual({ kind: "verified", status: "verified" });
    expect(classifyScore(100, FULL_TEXT)).toEqual({ kind: "verified", status: "verified" });
  });

  it("the exact boundary scores bucket as specified (tExclude → uncertain, tVerified → verified)", () => {
    expect(classifyScore(25, SNIPPET)).toEqual({ kind: "uncertain", status: "uncertain" });
    expect(classifyScore(70, SNIPPET)).toEqual({ kind: "verified", status: "verified" });
  });

  it("the lenient-vs-strict boundary: a score in [snippetTExclude, fullTextTExclude) survives the snippet pass but Excludes at full text", () => {
    // 30 is the recall-protecting design: thin snippet survives (cost gate); the page Excludes it.
    expect(classifyScore(30, SNIPPET)).toEqual({ kind: "uncertain", status: "uncertain" });
    expect(classifyScore(30, FULL_TEXT)).toEqual({ kind: "exclude" });
  });

  it("only ever returns the two stored statuses (verified | uncertain); NULL is never returned here", () => {
    const verdicts = [classifyScore(10, FULL_TEXT), classifyScore(50, FULL_TEXT), classifyScore(90, FULL_TEXT)];
    const statuses = verdicts.flatMap((v) => ("status" in v ? [v.status] : []));
    const allowed: VerificationStatus[] = ["verified", "uncertain"];
    expect(statuses.every((s) => allowed.includes(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/verification-status.test.ts`
Expected: FAIL — `Cannot find module './verification-status'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/analyze/verification-status.ts

/** The two STORED values. NULL ("Unverified") is never returned here — it is the ABSENCE of a write. */
export type VerificationStatus = "verified" | "uncertain";

export type Cutoffs = { readonly tExclude: number; readonly tVerified: number };

export type ScoreVerdict =
  | { readonly kind: "exclude" } //                              score < tExclude → off_topic
  | { readonly kind: "uncertain"; readonly status: "uncertain" } // [tExclude, tVerified)
  | { readonly kind: "verified"; readonly status: "verified" }; //  score ≥ tVerified

/**
 * verification_status AND the Exclude decision are BOTH pure functions of the score against one
 * cutoff pair — there is no independent verdict field the model returns. The SAME function runs at
 * both passes; only the `cutoffs` argument differs (snippet uses the lenient tExclude, full-text the
 * stricter one). The snippet pass does NOT persist `status`; only the full-text pass writes it.
 */
export function classifyScore(score: number, cutoffs: Cutoffs): ScoreVerdict {
  if (score < cutoffs.tExclude) return { kind: "exclude" };
  if (score < cutoffs.tVerified) return { kind: "uncertain", status: "uncertain" };
  return { kind: "verified", status: "verified" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/verification-status.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/analyze/verification-status.ts src/domain/analyze/verification-status.test.ts
git commit -m "feat(analyze): pure score→verification_status/exclude mapping over two cutoffs"
```

---

## Task 3: `offTopicExclusion` — the only exclusion code this stage writes

**Files:**
- Create: `src/domain/analyze/exclusion-mapping.ts`
- Test: `src/domain/analyze/exclusion-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/analyze/exclusion-mapping.test.ts
import { describe, it, expect } from "vitest";
import { OFF_TOPIC, LLM_CATCHER, offTopicExclusion } from "./exclusion-mapping";

describe("offTopicExclusion", () => {
  it("is exactly { code: 'off_topic', detail: 'LLM' }", () => {
    expect(offTopicExclusion()).toEqual({ code: "off_topic", detail: "LLM" });
  });

  it("exposes the constants the stage uses (the catcher, never model text)", () => {
    expect(OFF_TOPIC).toBe("off_topic");
    expect(LLM_CATCHER).toBe("LLM");
  });

  it("takes no model output by design — there is nowhere for model text to enter the exclusion write", () => {
    // @ts-expect-error structural anti-echo proof: the builder accepts no arguments.
    offTopicExclusion("attacker chosen text");
    expect(offTopicExclusion().detail).toBe("LLM");
  });

  it("never produces any other exclusion code", () => {
    const forbidden = ["own_channel", "aggregator", "ecommerce_review", "out_of_window", "duplicate", "llm_excluded"];
    expect(forbidden).not.toContain(offTopicExclusion().code);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/exclusion-mapping.test.ts`
Expected: FAIL — `Cannot find module './exclusion-mapping'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/analyze/exclusion-mapping.ts

/** The single exclusion_code analyze ever writes. */
export const OFF_TOPIC = "off_topic" as const;
/** The exclusion_detail — the CATCHER string, never any text the model emitted (anti-echo). */
export const LLM_CATCHER = "LLM" as const;

/**
 * The only Exclusion this stage produces: `off_topic` with `exclusion_detail = "LLM"`, at EITHER pass
 * when classifyScore returns { kind: "exclude" }. It never writes own_channel / aggregator /
 * ecommerce_review / out_of_window / duplicate (Filter's), and never `llm_excluded` (not a code).
 * Takes no model output by design — the structural proof there is no echo channel into the write.
 */
export function offTopicExclusion(): { readonly code: typeof OFF_TOPIC; readonly detail: typeof LLM_CATCHER } {
  return { code: OFF_TOPIC, detail: LLM_CATCHER };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/exclusion-mapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/analyze/exclusion-mapping.ts src/domain/analyze/exclusion-mapping.test.ts
git commit -m "feat(analyze): off_topic/LLM exclusion mapping (the only code this stage writes)"
```

---

## Task 4: `ContentType` + `Sentiment` vocabularies + the fused-analysis Zod schema

**Files:**
- Create: `src/domain/analyze/content-type.ts`
- Create: `src/domain/analyze/sentiment.ts`
- Create: `src/domain/analyze/fused-analysis.ts`
- Test: `src/domain/analyze/fused-analysis.test.ts`

> The vocabularies (`content-type.ts`, `sentiment.ts`) are pure type/const modules verified by `tsc` and consumed by the schema; the runtime behaviour to test is the Zod schema. `takeaway`'s max length is supplied by the caller (the adapter passes `config.takeawayMaxLength`) so the schema stays config-driven, not a literal.

- [ ] **Step 1: Write the vocabulary modules**

```ts
// src/domain/analyze/content-type.ts

/** The brief's seven Content Types, verbatim, plus the explicit escape hatch `other`. */
export const CONTENT_TYPES = [
  "news_article",
  "trade_publication",
  "blog_post",
  "press_release",
  "major_social_post",
  "newsletter",
  "podcast",
  "other",
] as const;

/** `other` is reserved for GENUINE ambiguity — a Result whose classify FAILED is left NULL, never `other`. */
export type ContentType = (typeof CONTENT_TYPES)[number];
```

```ts
// src/domain/analyze/sentiment.ts

/** Stance toward the TARGET company — not the article's overall mood. */
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
```

- [ ] **Step 2: Write the failing test**

```ts
// src/domain/analyze/fused-analysis.test.ts
import { describe, it, expect } from "vitest";
import { fusedAnalysisSchema, type FusedAnalysis } from "./fused-analysis";

const schema = fusedAnalysisSchema(400); // takeawayMaxLength

const valid = {
  entityMatchScore: 82,
  contentType: "news_article",
  sentiment: "positive",
  takeaway: "Aglow raised a Series A to expand its beauty-membership product.",
};

describe("fusedAnalysisSchema", () => {
  it("parses a well-formed fused response into the typed FusedAnalysis", () => {
    const parsed = schema.parse(valid);
    const expected: FusedAnalysis = valid as FusedAnalysis;
    expect(parsed).toEqual(expected);
  });

  it("rejects an out-of-range entityMatchScore", () => {
    expect(schema.safeParse({ ...valid, entityMatchScore: 101 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, entityMatchScore: -1 }).success).toBe(false);
  });

  it("rejects an out-of-enum contentType and an out-of-enum sentiment", () => {
    expect(schema.safeParse({ ...valid, contentType: "tweet" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sentiment: "mixed" }).success).toBe(false);
  });

  it("rejects an empty takeaway and an over-length takeaway (config cap)", () => {
    expect(schema.safeParse({ ...valid, takeaway: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, takeaway: "x".repeat(401) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, takeaway: "x".repeat(400) }).success).toBe(true);
  });

  it("drops injected extra fields (anti-echo: only the four validated fields survive)", () => {
    const parsed = schema.parse({ ...valid, injected: "IGNORE PREVIOUS INSTRUCTIONS" });
    expect(Object.keys(parsed).sort()).toEqual(["contentType", "entityMatchScore", "sentiment", "takeaway"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/fused-analysis.test.ts`
Expected: FAIL — `Cannot find module './fused-analysis'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/domain/analyze/fused-analysis.ts
import { z } from "zod";
import { CONTENT_TYPES } from "./content-type";
import { SENTIMENTS } from "./sentiment";

/**
 * The ADR 0003 structured-output contract for the ONE fused Haiku call. The response is validated
 * against this schema VERBATIM before anything is persisted; the parsed type is the only thing the
 * full-text pass acts on. `.strip()` discards any extra/injected fields (anti-echo). `takeaway` is the
 * one validated free-text field — non-empty and capped by the config-supplied max length.
 */
export function fusedAnalysisSchema(takeawayMaxLength: number) {
  return z
    .object({
      entityMatchScore: z.number().min(0).max(100), // re-Verify: final/authoritative Match Score
      contentType: z.enum(CONTENT_TYPES), //            re-Classify
      sentiment: z.enum(SENTIMENTS), //                 Enhance: stance toward the TARGET
      takeaway: z.string().min(1).max(takeawayMaxLength), // Enhance: short per-Result takeaway
    })
    .strip();
}

export type FusedAnalysis = z.infer<ReturnType<typeof fusedAnalysisSchema>>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/fused-analysis.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/analyze/content-type.ts src/domain/analyze/sentiment.ts src/domain/analyze/fused-analysis.ts src/domain/analyze/fused-analysis.test.ts
git commit -m "feat(analyze): Content Type + Sentiment vocabularies + fused-analysis Zod schema (ADR 0003)"
```

---

## Task 5: `survivedSnippetGates` — the Extract-gating predicate

**Files:**
- Create: `src/domain/analyze/extract-gate.ts`
- Test: `src/domain/analyze/extract-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/analyze/extract-gate.test.ts
import { describe, it, expect } from "vitest";
import { survivedSnippetGates, type SnippetOutcome } from "./extract-gate";

describe("survivedSnippetGates", () => {
  it("is false for a snippet-Excluded outcome (never Extracted — the cost gate)", () => {
    const excluded: SnippetOutcome = { kind: "excluded" };
    expect(survivedSnippetGates(excluded)).toBe(false);
  });

  it("is true for a survived outcome and narrows the type so interimScore is accessible", () => {
    const survived: SnippetOutcome = { kind: "survived", interimScore: 62, provisionalType: "news_article" };
    expect(survivedSnippetGates(survived)).toBe(true);
    if (survivedSnippetGates(survived)) {
      expect(survived.interimScore).toBe(62); // narrowing compiles
    }
  });

  it("survives even when snippet-Classify yielded no provisional type (it never gates)", () => {
    const survived: SnippetOutcome = { kind: "survived", interimScore: 30, provisionalType: null };
    expect(survivedSnippetGates(survived)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/extract-gate.test.ts`
Expected: FAIL — `Cannot find module './extract-gate'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/analyze/extract-gate.ts
import type { ContentType } from "./content-type";

export type SnippetOutcome =
  | { readonly kind: "excluded" } // snippet-Verify Excluded off_topic — never Extracted
  | { readonly kind: "survived"; readonly interimScore: number; readonly provisionalType: ContentType | null };

/**
 * Pure Extract-gating predicate. Extract runs ONLY for a Result whose snippet-Verify did NOT Exclude
 * it. snippet-Classify never gates — its provisional type rides along even into an Excluded row,
 * harmlessly. An Excluded-at-snippet Result is never Extracted and never reaches the fused call.
 */
export function survivedSnippetGates(
  outcome: SnippetOutcome,
): outcome is { kind: "survived"; interimScore: number; provisionalType: ContentType | null } {
  return outcome.kind === "survived";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/extract-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/analyze/extract-gate.ts src/domain/analyze/extract-gate.test.ts
git commit -m "feat(analyze): pure Extract-gating predicate (survivedSnippetGates)"
```

---

## Task 6: `ANALYZE_WARNING` closed set + builders

**Files:**
- Create: `src/domain/analyze/analyze-warnings.ts`
- Test: `src/domain/analyze/analyze-warnings.test.ts`

> Confirm the import path/shape of `Warning` against Foundation's `src/domain/job/warning.ts`. If Foundation exports `Warning` from a different path, fix the import here and in later tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/analyze/analyze-warnings.test.ts
import { describe, it, expect } from "vitest";
import { ANALYZE_WARNING, analyzeWarnings } from "./analyze-warnings";

describe("analyze warnings", () => {
  it("exposes the closed namespaced set", () => {
    expect(Object.values(ANALYZE_WARNING).sort()).toEqual(
      [
        "analyze.extract_failed",
        "analyze.snippet_classify_failed",
        "analyze.full_text_classify_failed",
        "analyze.enhance_failed",
        "analyze.classify_totally_failed",
        "analyze.no_brand_context",
      ].sort(),
    );
  });

  it("every type is namespaced under 'analyze.'", () => {
    expect(Object.values(ANALYZE_WARNING).every((t) => t.startsWith("analyze."))).toBe(true);
  });

  it("the per-Result aggregated builders carry a COUNT, never raw text", () => {
    const extract = analyzeWarnings.extractFailed(7);
    expect(extract.type).toBe(ANALYZE_WARNING.extractFailed);
    expect(extract.message).toContain("7");

    const snippet = analyzeWarnings.snippetClassifyFailed(3);
    expect(snippet.type).toBe(ANALYZE_WARNING.snippetClassifyFailed);
    expect(snippet.message).toContain("3");

    const fullText = analyzeWarnings.fullTextClassifyFailed(2);
    expect(fullText.type).toBe(ANALYZE_WARNING.fullTextClassifyFailed);
    expect(fullText.message).toContain("2");

    const enhance = analyzeWarnings.enhanceFailed(5);
    expect(enhance.type).toBe(ANALYZE_WARNING.enhanceFailed);
    expect(enhance.message).toContain("5");
  });

  it("the Job-level builders take no count and produce a non-empty message of the matching type", () => {
    const total = analyzeWarnings.classifyTotallyFailed();
    expect(total.type).toBe(ANALYZE_WARNING.classifyTotallyFailed);
    expect(total.message.length).toBeGreaterThan(0);

    const noBrand = analyzeWarnings.noBrandContext();
    expect(noBrand.type).toBe(ANALYZE_WARNING.noBrandContext);
    expect(noBrand.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/analyze-warnings.test.ts`
Expected: FAIL — `Cannot find module './analyze-warnings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/analyze/analyze-warnings.ts
import type { Warning } from "../job/warning";

/** Closed set of analyze Warning types, namespaced under `analyze.`. */
export const ANALYZE_WARNING = {
  extractFailed: "analyze.extract_failed", // per-Result: Extract failed; stays included, interim score + provisional type kept, verification_status NULL
  snippetClassifyFailed: "analyze.snippet_classify_failed", // per-Result: snippet-Classify failed; provisional content_type NULL
  fullTextClassifyFailed: "analyze.full_text_classify_failed", // per-Result: re-Classify field unusable; content_type left NULL
  enhanceFailed: "analyze.enhance_failed", // per-Result: sentiment/takeaway NULL; row still shows
  classifyTotallyFailed: "analyze.classify_totally_failed", // Job-level: every Classify attempt failed; one Warning, never a failure
  noBrandContext: "analyze.no_brand_context", // Job-level: name-only Job, no brand context; Verify yields the Unverified (NULL) reading
} as const;

/**
 * Builders carrying COUNTS and ids only — never raw snippet text, page text, prompt, completion, or a
 * provider error body (anti-echo). Per-Result Warnings are aggregated by the shell (one Warning per
 * kind carrying a count, not one per Result); the Job-level Warnings fire at most once.
 */
export const analyzeWarnings = {
  extractFailed: (count: number): Warning => ({
    type: ANALYZE_WARNING.extractFailed,
    message: `${count} Result(s) failed Extract; each stays included with its interim score and provisional type, Unverified.`,
  }),
  snippetClassifyFailed: (count: number): Warning => ({
    type: ANALYZE_WARNING.snippetClassifyFailed,
    message: `${count} Result(s) failed snippet-Classify; provisional content_type left NULL (Unclassified).`,
  }),
  fullTextClassifyFailed: (count: number): Warning => ({
    type: ANALYZE_WARNING.fullTextClassifyFailed,
    message: `${count} Result(s) failed the full-text re-Classify; content_type left NULL (Unclassified).`,
  }),
  enhanceFailed: (count: number): Warning => ({
    type: ANALYZE_WARNING.enhanceFailed,
    message: `${count} Result(s) failed Enhance; sentiment and takeaway left NULL.`,
  }),
  classifyTotallyFailed: (): Warning => ({
    type: ANALYZE_WARNING.classifyTotallyFailed,
    message: "Every Classify attempt across the Job failed; the list is reviewable but untyped.",
  }),
  noBrandContext: (): Warning => ({
    type: ANALYZE_WARNING.noBrandContext,
    message: "No resolved brand context (name-only Job); Verify yields the Unverified reading where it cannot confidently verify or Exclude.",
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/analyze/analyze-warnings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/analyze/analyze-warnings.ts src/domain/analyze/analyze-warnings.test.ts
git commit -m "feat(analyze): closed ANALYZE_WARNING set + count-only builders (anti-echo)"
```

---

## Task 7: `AnalyzeConfig` + token (with load-time invariant)

**Files:**
- Create: `src/application/analyze/analyze-config.ts`
- Test: `src/application/analyze/analyze-config.test.ts`

> The config carries the three cutoffs, the bounded concurrency, and the takeaway cap. The invariant `snippetTExclude < fullTextTExclude ≤ tVerified` encodes the lenient-snippet/strict-full-text decision and is asserted at config load. A small `assertAnalyzeConfig` makes that invariant testable without booting Nest; the DI provider (Task 13) calls it.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/analyze/analyze-config.test.ts
import { describe, it, expect } from "vitest";
import { assertAnalyzeConfig, type AnalyzeConfig } from "./analyze-config";

const base: AnalyzeConfig = {
  snippetTExclude: 25,
  fullTextTExclude: 40,
  tVerified: 70,
  extractConcurrency: 5,
  takeawayMaxLength: 400,
};

describe("assertAnalyzeConfig", () => {
  it("returns the config unchanged when the cutoff ordering holds", () => {
    expect(assertAnalyzeConfig(base)).toEqual(base);
  });

  it("accepts the boundary fullTextTExclude === tVerified", () => {
    expect(() => assertAnalyzeConfig({ ...base, fullTextTExclude: 70, tVerified: 70 })).not.toThrow();
  });

  it("rejects a snippetTExclude that is not strictly less than fullTextTExclude (the lenient-vs-strict invariant)", () => {
    expect(() => assertAnalyzeConfig({ ...base, snippetTExclude: 40, fullTextTExclude: 40 })).toThrow();
  });

  it("rejects a fullTextTExclude above tVerified", () => {
    expect(() => assertAnalyzeConfig({ ...base, fullTextTExclude: 80, tVerified: 70 })).toThrow();
  });

  it("rejects a non-positive concurrency", () => {
    expect(() => assertAnalyzeConfig({ ...base, extractConcurrency: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze-config.test.ts`
Expected: FAIL — `Cannot find module './analyze-config'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/analyze/analyze-config.ts

export type AnalyzeConfig = {
  /** ~25 — the LENIENT snippet-pass exclude cutoff (cost gate, not the precision call). */
  readonly snippetTExclude: number;
  /** ~40 — the STRICTER full-text exclude cutoff (the precision call, made on the actual page). */
  readonly fullTextTExclude: number;
  /** ~70 — at/above → verified; shared by both passes. */
  readonly tVerified: number;
  /** Bounded per-Result fan-out (Extract + fused call) — keeps Tavily/Haiku in-flight bounded. */
  readonly extractConcurrency: number;
  /** The schema cap on the one validated free-text field (`takeaway`). */
  readonly takeawayMaxLength: number;
};

export const ANALYZE_CONFIG = Symbol("AnalyzeConfig");

/**
 * Asserts the lenient-snippet/strict-full-text invariant `snippetTExclude < fullTextTExclude ≤
 * tVerified` plus a positive concurrency, at config load. Returns the config so the provider can
 * `return assertAnalyzeConfig(...)`.
 */
export function assertAnalyzeConfig(config: AnalyzeConfig): AnalyzeConfig {
  if (!(config.snippetTExclude < config.fullTextTExclude)) {
    throw new Error("AnalyzeConfig: snippetTExclude must be strictly less than fullTextTExclude (lenient snippet gate)");
  }
  if (!(config.fullTextTExclude <= config.tVerified)) {
    throw new Error("AnalyzeConfig: fullTextTExclude must be ≤ tVerified");
  }
  if (!(config.extractConcurrency > 0)) {
    throw new Error("AnalyzeConfig: extractConcurrency must be a positive integer");
  }
  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/analyze/analyze-config.ts src/application/analyze/analyze-config.test.ts
git commit -m "feat(analyze): AnalyzeConfig + token + load-time cutoff invariant"
```

---

## Task 8: The three ports + tokens + normalized result types

**Files:**
- Create: `src/application/analyze/ports/snippet-judgement.port.ts`
- Create: `src/application/analyze/ports/content-extraction.port.ts`
- Create: `src/application/analyze/ports/full-text-analysis.port.ts`

These are pure interfaces (no runtime behaviour) — verification is a clean `tsc`, not a Vitest run.

- [ ] **Step 1: Write the port interfaces, types, and DI tokens**

```ts
// src/application/analyze/ports/snippet-judgement.port.ts
import type { BrandContext } from "../../../domain/resolve/brand-context";
import type { ContentType } from "../../../domain/analyze/content-type";

/** Title + snippet + URL only — the cheap Pass-1 evidence. */
export type SnippetEvidence = {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
};

export type SnippetVerifyInput = {
  readonly evidence: SnippetEvidence;
  readonly brandContext: BrandContext | null; // positive signal: value proposition / audience segments / products & services
  readonly negativeBoost: string; //             ADR 0001: collected collision contexts, verbatim — NOT pre-computed diffs
};

/** The two cheap Pass-1 judgements (Anthropic Haiku). */
export interface SnippetJudgementPort {
  /** snippet-Verify: returns ONLY the interim Match Score (0–100). Exclude-vs-proceed is DERIVED (classifyScore) — no verdict field. */
  verifySnippet(input: SnippetVerifyInput): Promise<{ interimMatchScore: number } | { failed: true }>;
  /** snippet-Classify: provisional Content Type from the same evidence (seven + other). */
  classifySnippet(evidence: SnippetEvidence): Promise<{ contentType: ContentType } | { failed: true }>;
}

export const SNIPPET_JUDGEMENT_PORT = Symbol("SnippetJudgementPort");
```

```ts
// src/application/analyze/ports/content-extraction.port.ts

/** Tavily Extract (server-side); we never "fetch" a Result page. */
export type ExtractionResult =
  | { readonly kind: "extracted"; readonly fullText: string }
  | { readonly kind: "extractionFailure" };

export interface ContentExtractionPort {
  /** Never throws — failure → { kind: "extractionFailure" }. */
  extract(url: string): Promise<ExtractionResult>;
}

export const CONTENT_EXTRACTION_PORT = Symbol("ContentExtractionPort");
```

```ts
// src/application/analyze/ports/full-text-analysis.port.ts
import type { BrandContext } from "../../../domain/resolve/brand-context";
import type { FusedAnalysis } from "../../../domain/analyze/fused-analysis";

export type FullTextAnalysisInput = {
  readonly fullText: string;
  readonly brandContext: BrandContext | null;
  readonly negativeBoost: string;
};

/** The ONE fused Haiku call per Extracted Result (ADR 0003), Zod-validated. */
export interface FullTextAnalysisPort {
  /** Returns the parsed, Zod-validated FusedAnalysis; a malformed/schema-violating response → { failed: true } (never an unvalidated object). */
  analyze(input: FullTextAnalysisInput): Promise<FusedAnalysis | { failed: true }>;
}

export const FULL_TEXT_ANALYSIS_PORT = Symbol("FullTextAnalysisPort");
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from the new port files (they only reference Task 1–7 domain types + Resolve's `BrandContext`).

- [ ] **Step 3: Commit**

```bash
git add src/application/analyze/ports/
git commit -m "feat(analyze): declare SnippetJudgement / ContentExtraction / FullTextAnalysis ports + tokens"
```

---

## Task 9: `ResultRepository` extension (the analyze writes + read-model)

**Files:**
- Modify: `src/application/search/ports/result-repository.port.ts` (add `AnalyzeResult`, `FullTextOutcome`, and the three analyze write methods)

> Read the current `result-repository.port.ts` first. Search declared `insertIncluded`; Filter added `findIncluded`/`recordExclusion` plus `FilterResult` and the `ExclusionCode` import. This task ADDS the analyze read-model + the four narrow writes onto the SAME interface; it touches nothing Search/Filter declared, and re-uses Filter's `recordExclusion` for the `off_topic` Exclusion (no new exclusion method). The `RESULT_REPOSITORY` token is unchanged.

- [ ] **Step 1: Add the analyze types + methods to the existing port**

Add these imports and types alongside the existing `FilterResult` / `ExclusionCode` content, and add the four methods to the `ResultRepository` interface:

```ts
// src/application/search/ports/result-repository.port.ts (additions for analyze)
import type { ContentType } from "../../../domain/analyze/content-type";
import type { Sentiment } from "../../../domain/analyze/sentiment";
import type { VerificationStatus } from "../../../domain/analyze/verification-status";

/**
 * The read-model analyze needs from the `included` pool. It is a STRUCTURAL SUBSET of Filter's
 * FilterResult, so `findIncluded(jobId)` is reused as-is — the shell reads the pool and uses the
 * id / url / title / snippet fields (match_score / published_date are already persisted).
 */
export type AnalyzeResult = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
};

/** The single durable write of the fused full-text pass (rung 3 + status + type + enhance). */
export type FullTextOutcome = {
  readonly matchScore: number; //                     final rung — overwrites interim
  readonly verificationStatus: VerificationStatus; //  verified | uncertain (only the full-text pass writes this)
  readonly contentType: ContentType | null; //         re-Classify; null if the field was unusable (Warning)
  readonly sentiment: Sentiment | null; //             Enhance; null if Enhance failed (Warning)
  readonly takeaway: string | null; //                 Enhance; null if Enhance failed (Warning)
};
```

Add to the `ResultRepository` interface (the existing `insertIncluded` / `findIncluded` / `recordExclusion` stay exactly as Search/Filter declared them):

```ts
  // analyze additions — each writes ONLY into reserved/owned nullable columns:
  setInterimMatchScore(resultId: string, score: number): Promise<void>; //          ratchet rung 2 (snippet-Verify) → already-reserved match_score
  setProvisionalContentType(resultId: string, type: ContentType): Promise<void>; //  snippet-Classify → already-reserved content_type
  applyFullTextOutcome(resultId: string, outcome: FullTextOutcome): Promise<void>; // the fused-call write → already-reserved columns
  setExtractedContent(resultId: string, content: string): Promise<void>; //          on Extract success → this stage's new extracted_content column (display-only, PRD 07)
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — the existing `ResultDrizzleRepository` (`src/infrastructure/persistence/result.repository.ts`) no longer satisfies `ResultRepository` (four methods unimplemented). This is expected; Task 15 implements them. Other call sites should still type-check. (If your `tsc` setup makes a failing repository block all later unit tasks, comment the four new method signatures back in only when reaching Task 15 — but prefer keeping them and implementing Task 15 next.)

- [ ] **Step 3: Commit**

```bash
git add src/application/search/ports/result-repository.port.ts
git commit -m "feat(analyze): extend ResultRepository port with AnalyzeResult + three analyze writes"
```

---

## Task 10: `AnalyzeStage` part 1 — shell, identity/no-brand-context, snippet gates + Extract gating

**Files:**
- Create: `src/application/analyze/analyze.stage.ts`
- Test: `src/application/analyze/analyze.stage.test.ts`

> The only impure unit. `name = "analyze"`. Constructed from the three ports, the `ResultRepository`, and `AnalyzeConfig`. This task builds the skeleton, the identity/no-brand-context handling, the pool read, the per-Result Pass-1 snippet gates (snippet-Verify → interim score + the snippet-pass `classifyScore` exclude/survive decision; snippet-Classify → provisional type), and the Extract gate. Pass 2 + roll-ups land in Task 11 (same file). Tested entirely with fakes. Adjust the `Stage`, `RunContext`, `createRunContext`, and Job-helper import paths to Foundation/Resolve's actual exports.

- [ ] **Step 1: Write the failing test (Pass-1 outcomes)**

```ts
// src/application/analyze/analyze.stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { AnalyzeStage } from "./analyze.stage";
import { createRunContext } from "../pipeline/run-context"; // adjust to Foundation's export
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { ANALYZE_WARNING } from "../../domain/analyze/analyze-warnings";
import type { AnalyzeConfig } from "./analyze-config";
import type { SnippetJudgementPort } from "./ports/snippet-judgement.port";
import type { ContentExtractionPort } from "./ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./ports/full-text-analysis.port";
import type { ResultRepository, FilterResult, FullTextOutcome } from "../search/ports/result-repository.port";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";

const config: AnalyzeConfig = {
  snippetTExclude: 25,
  fullTextTExclude: 40,
  tVerified: 70,
  extractConcurrency: 5,
  takeawayMaxLength: 400,
};

const richIdentity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [],
    brandContext: {
      tagline: "Beauty membership",
      mission: null,
      description: "Beauty startup",
      tags: ["beauty"],
      valueProposition: "Membership beauty",
      targetAudienceSegments: ["consumers"],
      productsAndServices: ["membership"],
    },
    nameCollisions: [],
    negativeBoost: "Aglow International (ministry); Aglow Air (freighter)",
  });

const nameOnlyIdentity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [],
    socialHandles: [],
    brandContext: null,
    nameCollisions: [],
    negativeBoost: "",
  });

const poolRow = (over: Partial<FilterResult> = {}): FilterResult => ({
  id: "r1",
  url: "https://news.example/aglow-funding",
  title: "Aglow raises a round",
  snippet: "Aglow announced funding...",
  publishedDate: "2026-01-02",
  ...over,
});

/** A fake repository recording every write so tests assert observable persisted facts. */
function fakeRepo(pool: FilterResult[]) {
  const interim = new Map<string, number>();
  const provisionalType = new Map<string, string>();
  const fullText = new Map<string, FullTextOutcome>();
  const extractedContent = new Map<string, string>();
  const exclusions: Array<{ id: string; code: ExclusionCode; detail: string | null }> = [];
  const repo: ResultRepository = {
    insertIncluded: vi.fn(async () => 0),
    findIncluded: vi.fn(async () => pool),
    recordExclusion: vi.fn(async (id: string, code: ExclusionCode, detail: string | null) => {
      exclusions.push({ id, code, detail });
    }),
    setInterimMatchScore: vi.fn(async (id: string, score: number) => {
      interim.set(id, score);
    }),
    setProvisionalContentType: vi.fn(async (id: string, type) => {
      provisionalType.set(id, type);
    }),
    applyFullTextOutcome: vi.fn(async (id: string, outcome: FullTextOutcome) => {
      fullText.set(id, outcome);
    }),
    setExtractedContent: vi.fn(async (id: string, content: string) => {
      extractedContent.set(id, content);
    }),
  };
  return { repo, interim, provisionalType, fullText, extractedContent, exclusions };
}

type Ports = { snippet: SnippetJudgementPort; extract: ContentExtractionPort; full: FullTextAnalysisPort };
const make = (ports: Ports, repo: ResultRepository) =>
  new AnalyzeStage(ports.snippet, ports.extract, ports.full, repo, config);

const runWith = async (ports: Ports, pool: FilterResult[], identity = richIdentity()) => {
  const f = fakeRepo(pool);
  const ctx = createRunContext(makeRunningJob());
  ctx.setResolvedIdentity(identity);
  await make(ports, f.repo).run(ctx);
  return { ctx, ...f };
};

describe("AnalyzeStage — Pass 1 (snippet gates + Extract gating)", () => {
  it("has name 'analyze'", () => {
    const ports: Ports = {
      snippet: { verifySnippet: vi.fn(), classifySnippet: vi.fn() },
      extract: { extract: vi.fn() },
      full: { analyze: vi.fn() },
    };
    const f = fakeRepo([]);
    expect(make(ports, f.repo).name).toBe("analyze");
  });

  it("throws a plain Error (programming fault) when resolvedIdentity is null", async () => {
    const ports: Ports = {
      snippet: { verifySnippet: vi.fn(), classifySnippet: vi.fn() },
      extract: { extract: vi.fn() },
      full: { analyze: vi.fn() },
    };
    const f = fakeRepo([]);
    const ctx = createRunContext(makeRunningJob()); // resolvedIdentity stays null
    await expect(make(ports, f.repo).run(ctx)).rejects.toThrow(/ResolvedIdentity/);
  });

  it("snippet Exclude: interim score < snippet T_exclude → off_topic/'LLM', never Extracted, keeps provisional type", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => ({ interimMatchScore: 10 })), // < 25
        classifySnippet: vi.fn(async () => ({ contentType: "blog_post" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extractionFailure" as const })) },
      full: { analyze: vi.fn() },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.exclusions).toEqual([{ id: "r1", code: "off_topic", detail: "LLM" }]);
    expect(out.interim.get("r1")).toBe(10); // interim rung kept
    expect(out.provisionalType.get("r1")).toBe("blog_post"); // snippet-Classify rode along
    expect(ports.extract.extract).not.toHaveBeenCalled(); // the cost gate
    expect(ports.full.analyze).not.toHaveBeenCalled();
  });

  it("no brand context: records one no_brand_context Warning and still runs with brandContext null", async () => {
    const verifySnippet = vi.fn(async () => ({ interimMatchScore: 80 }));
    const ports: Ports = {
      snippet: { verifySnippet, classifySnippet: vi.fn(async () => ({ contentType: "news_article" as const })) },
      extract: { extract: vi.fn(async () => ({ kind: "extracted" as const, fullText: "page" })) },
      full: {
        analyze: vi.fn(async () => ({ entityMatchScore: 80, contentType: "news_article" as const, sentiment: "neutral" as const, takeaway: "t" })),
      },
    };
    const out = await runWith(ports, [poolRow()], nameOnlyIdentity());
    expect(out.ctx.job.warnings.map((w) => w.type)).toContain(ANALYZE_WARNING.noBrandContext);
    expect(verifySnippet).toHaveBeenCalledWith(expect.objectContaining({ brandContext: null }));
  });

  it("snippet-Classify failure: content_type left NULL, one snippet_classify_failed Warning, still proceeds to Extract", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => ({ interimMatchScore: 80 })), // survives
        classifySnippet: vi.fn(async () => ({ failed: true as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extractionFailure" as const })) }, // skip fused call
      full: { analyze: vi.fn() },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.provisionalType.has("r1")).toBe(false); // NULL
    expect(out.ctx.job.warnings.map((w) => w.type)).toContain(ANALYZE_WARNING.snippetClassifyFailed);
    expect(ports.extract.extract).toHaveBeenCalledWith("https://news.example/aglow-funding"); // proceeded
  });

  it("snippet-Verify failure: no interim rung written, proceeds to Extract (a failed cheap gate must not Exclude)", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => ({ failed: true as const })),
        classifySnippet: vi.fn(async () => ({ contentType: "news_article" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extractionFailure" as const })) },
      full: { analyze: vi.fn() },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.interim.has("r1")).toBe(false); // provisional Tavily score stands
    expect(out.exclusions).toEqual([]); // a failed cheap gate never Excludes
    expect(ports.extract.extract).toHaveBeenCalledTimes(1); // proceeded to Extract
  });

  it("empty pool: returns normally, no writes (honest empty finding)", async () => {
    const ports: Ports = {
      snippet: { verifySnippet: vi.fn(), classifySnippet: vi.fn() },
      extract: { extract: vi.fn() },
      full: { analyze: vi.fn() },
    };
    const out = await runWith(ports, []);
    expect(out.exclusions).toEqual([]);
    expect(ports.snippet.verifySnippet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze.stage.test.ts`
Expected: FAIL — `Cannot find module './analyze.stage'`.

- [ ] **Step 3: Write minimal implementation (Pass 1 + the gate; Pass 2 calls `applyFullTextPass` added in Task 11)**

```ts
// src/application/analyze/analyze.stage.ts
import type { Stage } from "../pipeline/stage.port"; //          adjust to Foundation's path
import type { RunContext } from "../pipeline/run-context"; //    adjust to Foundation's path
import type { Warning } from "../../domain/job/warning";
import type { SnippetJudgementPort, SnippetEvidence } from "./ports/snippet-judgement.port";
import type { ContentExtractionPort } from "./ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./ports/full-text-analysis.port";
import type { ResultRepository, FilterResult } from "../search/ports/result-repository.port";
import type { AnalyzeConfig } from "./analyze-config";
import { ratchet } from "../../domain/analyze/match-score";
import { classifyScore } from "../../domain/analyze/verification-status";
import { offTopicExclusion } from "../../domain/analyze/exclusion-mapping";
import { survivedSnippetGates, type SnippetOutcome } from "../../domain/analyze/extract-gate";
import { analyzeWarnings, type ANALYZE_WARNING } from "../../domain/analyze/analyze-warnings";

/** Mutable per-Job tallies the shell rolls up into one Warning per kind (anti-echo: counts only). */
type WarningTally = {
  extractFailed: number;
  snippetClassifyFailed: number;
  fullTextClassifyFailed: number;
  enhanceFailed: number;
};

export class AnalyzeStage implements Stage {
  readonly name = "analyze";

  constructor(
    private readonly snippet: SnippetJudgementPort,
    private readonly extraction: ContentExtractionPort,
    private readonly fullText: FullTextAnalysisPort,
    private readonly repo: ResultRepository,
    private readonly config: AnalyzeConfig,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    const identity = ctx.resolvedIdentity;
    if (identity === null) {
      // Programming/ordering fault: Resolve must run first. Let it become an unexpected throw → fail.
      throw new Error("AnalyzeStage requires a ResolvedIdentity (Resolve must run first)");
    }
    if (identity.brandContext === null) {
      ctx.recordWarning(analyzeWarnings.noBrandContext());
    }

    const pool = await this.repo.findIncluded(ctx.job.id);
    const tally: WarningTally = { extractFailed: 0, snippetClassifyFailed: 0, fullTextClassifyFailed: 0, enhanceFailed: 0 };
    let anyContentTypeWritten = false;

    await this.forEachBounded(pool, this.config.extractConcurrency, async (result) => {
      const typed = await this.processResult(result, identity.brandContext, identity.negativeBoost, tally);
      if (typed) anyContentTypeWritten = true;
    });

    this.rollUpPerResultWarnings(ctx.recordWarning.bind(ctx), tally);
    this.rollUpClassifyTotalFailure(ctx.recordWarning.bind(ctx), pool.length, anyContentTypeWritten);
  }

  /** One Result's full pipeline. Returns true iff a content_type was written for it (any pass). */
  private async processResult(
    result: FilterResult,
    brandContext: Parameters<SnippetJudgementPort["verifySnippet"]>[0]["brandContext"],
    negativeBoost: string,
    tally: WarningTally,
  ): Promise<boolean> {
    const evidence: SnippetEvidence = { url: result.url, title: result.title, snippet: result.snippet };

    // Pass 1a (snippet-Verify) and Pass 1b (snippet-Classify) share no state — run concurrently.
    const [verify, classify] = await Promise.all([
      this.snippet.verifySnippet({ evidence, brandContext, negativeBoost }),
      this.snippet.classifySnippet(evidence),
    ]);

    // Pass 1b — provisional type rides along even into an Excluded row (it never gates).
    let provisionalTypeWritten = false;
    if ("contentType" in classify) {
      await this.repo.setProvisionalContentType(result.id, classify.contentType);
      provisionalTypeWritten = true;
    } else {
      tally.snippetClassifyFailed += 1;
    }

    // Pass 1a — the snippet-Verify gate (interim rung + lenient classifyScore).
    const outcome = await this.applySnippetVerify(result.id, verify);
    if (outcome.kind === "excluded") return provisionalTypeWritten; // never Extracted (cost gate)
    if (!survivedSnippetGates(outcome)) return provisionalTypeWritten;

    // Gate → Extract (only survivors). Pass 2 lands in applyFullTextPass (Task 11).
    return (await this.applyFullTextPass(result, brandContext, negativeBoost, tally)) || provisionalTypeWritten;
  }

  /**
   * Pass 1a. On a score: write the interim rung, then derive exclude/survive against the LENIENT
   * snippet cutoff. On exclude → off_topic/"LLM" and stop. On a failed cheap gate → survive with NO
   * interim rung (the provisional Tavily score stands) and proceed to Extract — a failed cheap gate
   * must not Exclude. snippet-Verify never writes verification_status (only the full-text pass does).
   */
  private async applySnippetVerify(
    resultId: string,
    verify: { interimMatchScore: number } | { failed: true },
  ): Promise<SnippetOutcome> {
    if ("failed" in verify) {
      return { kind: "survived", interimScore: Number.NaN, provisionalType: null }; // no interim rung written
    }
    const interim = ratchet("interim", verify.interimMatchScore);
    await this.repo.setInterimMatchScore(resultId, interim);
    const verdict = classifyScore(interim, { tExclude: this.config.snippetTExclude, tVerified: this.config.tVerified });
    if (verdict.kind === "exclude") {
      const { code, detail } = offTopicExclusion();
      await this.repo.recordExclusion(resultId, code, detail);
      return { kind: "excluded" };
    }
    return { kind: "survived", interimScore: interim, provisionalType: null };
  }

  /** Placeholder until Task 11 — Extract + the fused call. Implemented in the next task (same file). */
  protected async applyFullTextPass(
    _result: FilterResult,
    _brandContext: Parameters<SnippetJudgementPort["verifySnippet"]>[0]["brandContext"],
    _negativeBoost: string,
    _tally: WarningTally,
  ): Promise<boolean> {
    return false;
  }

  /** Bounded-concurrency worker pool over the included list (never an unbounded Promise.all). */
  private async forEachBounded<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await work(item);
      }
    });
    await Promise.all(runners);
  }

  private rollUpPerResultWarnings(record: (w: Warning) => void, tally: WarningTally): void {
    if (tally.extractFailed > 0) record(analyzeWarnings.extractFailed(tally.extractFailed));
    if (tally.snippetClassifyFailed > 0) record(analyzeWarnings.snippetClassifyFailed(tally.snippetClassifyFailed));
    if (tally.fullTextClassifyFailed > 0) record(analyzeWarnings.fullTextClassifyFailed(tally.fullTextClassifyFailed));
    if (tally.enhanceFailed > 0) record(analyzeWarnings.enhanceFailed(tally.enhanceFailed));
  }

  private rollUpClassifyTotalFailure(record: (w: Warning) => void, poolSize: number, anyContentTypeWritten: boolean): void {
    if (poolSize > 0 && !anyContentTypeWritten) record(analyzeWarnings.classifyTotallyFailed());
  }
}

// Re-export the tally type for the part-2 task implementing applyFullTextPass in the same file.
export type { WarningTally };
export type { ANALYZE_WARNING };
```

> Implementation note: `applyFullTextPass` is written as a `protected` placeholder here only so this task's Pass-1 tests are green in isolation; **Task 11 replaces the placeholder body in the SAME file with the real Extract + fused-call logic** (it is not a subclass and not a separate method — you overwrite the method body). The Pass-1 tests above either Exclude at snippet (no Extract) or set up `extract` to return `extractionFailure` so the placeholder's `false` return is consistent with the no-content-type expectation; after Task 11 these same tests still pass because an Extract failure genuinely returns no content type.

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze.stage.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/analyze/analyze.stage.ts src/application/analyze/analyze.stage.test.ts
git commit -m "feat(analyze): AnalyzeStage shell — identity gate, snippet gates, Extract gating (Pass 1)"
```

---

## Task 11: `AnalyzeStage` part 2 — Extract, the fused full-text pass, ratchet/mapping writes, roll-ups

**Files:**
- Modify: `src/application/analyze/analyze.stage.ts` (replace the `applyFullTextPass` placeholder body)
- Modify: `src/application/analyze/analyze.stage.test.ts` (add the Pass-2 / roll-up cases)

> This completes the shell: the real `applyFullTextPass` runs Extract on survivors, **persists the Extracted full text via `setExtractedContent` on Extract success** (display-only, for PRD 07's Page), then runs the one fused Haiku call, applies the STRICT full-text `classifyScore`, and writes either an `off_topic` Exclusion (the Verification flip) or one `applyFullTextOutcome`. A Result whose Extract *failed* leaves `extracted_content` NULL. The roll-ups (per-kind Warnings, total-Classify-failure) are already wired in Task 10; the new cases verify them end-to-end, including the `extracted_content` write-on-success / NULL-on-failure assertions.

- [ ] **Step 1: Add the failing Pass-2 / roll-up tests**

```ts
// src/application/analyze/analyze.stage.test.ts (append this describe block)
import type { Sentiment } from "../../domain/analyze/sentiment";
import type { ContentType } from "../../domain/analyze/content-type";

describe("AnalyzeStage — Pass 2 (Extract + fused full-text call)", () => {
  const surviving = { interimMatchScore: 80 }; // ≥ snippet T_exclude → survives the snippet gate

  it("snippet survive → full-text verify: interim then FINAL score (overwrite), verified, re-Classified, Enhanced in one write", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving),
        classifySnippet: vi.fn(async () => ({ contentType: "blog_post" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extracted" as const, fullText: "the full page text" })) },
      full: {
        analyze: vi.fn(async () => ({
          entityMatchScore: 88,
          contentType: "news_article" as ContentType,
          sentiment: "positive" as Sentiment,
          takeaway: "Aglow raised a Series A.",
        })),
      },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.interim.get("r1")).toBe(80); // interim rung written first
    expect(out.extractedContent.get("r1")).toBe("the full page text"); // persisted on Extract success for PRD 07's Page
    expect(out.fullText.get("r1")).toEqual({
      matchScore: 88, // final rung overwrites interim
      verificationStatus: "verified", // ≥ tVerified
      contentType: "news_article",
      sentiment: "positive",
      takeaway: "Aglow raised a Series A.",
    });
    expect(out.exclusions).toEqual([]);
  });

  it("snippet survive → full-text Exclude (the look-alike the snippet let through): off_topic at the STRICT cutoff", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving), // 80 survives lenient snippet gate
        classifySnippet: vi.fn(async () => ({ contentType: "news_article" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extracted" as const, fullText: "freighter logistics page" })) },
      full: {
        analyze: vi.fn(async () => ({
          entityMatchScore: 30, // < fullTextTExclude (40) → exclude on the page (the flip)
          contentType: "news_article" as ContentType,
          sentiment: "neutral" as Sentiment,
          takeaway: "Different company.",
        })),
      },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.exclusions).toEqual([{ id: "r1", code: "off_topic", detail: "LLM" }]);
    expect(out.fullText.has("r1")).toBe(false); // no Enhance write on an Excluded row
  });

  it("Extract failure: stays included, interim score + provisional type kept, verification_status NULL, extract_failed Warning, fused call never invoked", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving),
        classifySnippet: vi.fn(async () => ({ contentType: "trade_publication" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extractionFailure" as const })) },
      full: { analyze: vi.fn() },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.interim.get("r1")).toBe(80);
    expect(out.provisionalType.get("r1")).toBe("trade_publication");
    expect(out.fullText.has("r1")).toBe(false); // NULL verification_status (never written)
    expect(out.extractedContent.has("r1")).toBe(false); // Extract failed → extracted_content left NULL
    expect(out.exclusions).toEqual([]); // Extract failure is NEVER an Exclusion
    expect(out.ctx.job.warnings.map((w) => w.type)).toContain(ANALYZE_WARNING.extractFailed);
    expect(ports.full.analyze).not.toHaveBeenCalled();
  });

  it("fused-call failure: stays included, NULL status, full_text_classify_failed + enhance_failed Warnings", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving),
        classifySnippet: vi.fn(async () => ({ contentType: "podcast" as const })),
      },
      extract: { extract: vi.fn(async () => ({ kind: "extracted" as const, fullText: "page" })) },
      full: { analyze: vi.fn(async () => ({ failed: true as const })) },
    };
    const out = await runWith(ports, [poolRow()]);
    expect(out.fullText.has("r1")).toBe(false);
    expect(out.provisionalType.get("r1")).toBe("podcast"); // provisional type kept
    const types = out.ctx.job.warnings.map((w) => w.type);
    expect(types).toContain(ANALYZE_WARNING.fullTextClassifyFailed);
    expect(types).toContain(ANALYZE_WARNING.enhanceFailed);
  });

  it("total Classify failure: no Result carries any content_type → one classify_totally_failed Warning, Job not failed", async () => {
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving),
        classifySnippet: vi.fn(async () => ({ failed: true as const })), // no provisional type
      },
      extract: { extract: vi.fn(async () => ({ kind: "extracted" as const, fullText: "page" })) },
      full: { analyze: vi.fn(async () => ({ failed: true as const })) }, // no full-text type either
    };
    const out = await runWith(ports, [poolRow(), poolRow({ id: "r2", url: "https://news.example/2" })]);
    expect(out.ctx.job.warnings.map((w) => w.type)).toContain(ANALYZE_WARNING.classifyTotallyFailed);
    // The Job is not failed: run() returned normally (no throw).
  });

  it("bounded concurrency: in-flight Extract calls never exceed config.extractConcurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ports: Ports = {
      snippet: {
        verifySnippet: vi.fn(async () => surviving),
        classifySnippet: vi.fn(async () => ({ contentType: "news_article" as const })),
      },
      extract: {
        extract: vi.fn(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 1));
          inFlight -= 1;
          return { kind: "extracted" as const, fullText: "page" };
        }),
      },
      full: {
        analyze: vi.fn(async () => ({ entityMatchScore: 80, contentType: "news_article" as ContentType, sentiment: "neutral" as Sentiment, takeaway: "t" })),
      },
    };
    const pool = Array.from({ length: 20 }, (_, i) => poolRow({ id: `r${i}`, url: `https://news.example/${i}` }));
    await runWith(ports, pool);
    expect(maxInFlight).toBeLessThanOrEqual(config.extractConcurrency);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze.stage.test.ts`
Expected: FAIL — the full-text-verify case expects `applyFullTextOutcome` written; the placeholder writes nothing (`fullText.has("r1")` is false where the test expects an outcome).

- [ ] **Step 3: Replace the `applyFullTextPass` placeholder body with the real implementation**

Replace the placeholder method in `src/application/analyze/analyze.stage.ts` and add the two imports:

```ts
// add to the imports at the top of analyze.stage.ts:
import type { FullTextOutcome } from "../search/ports/result-repository.port";
```

```ts
  /**
   * Pass 2 — only for survivors of the snippet-Verify gate. Extract (Tavily, server-side), then the
   * ONE fused Haiku call. Apply the STRICT full-text classifyScore: exclude → off_topic (the
   * Verification flip, no Enhance write); verified/uncertain → one applyFullTextOutcome (final rung +
   * status + re-Classify + Enhance). Every external failure is a benign value → a Warning, never a
   * throw. Returns true iff a content_type was written for this Result on the full-text pass.
   */
  protected async applyFullTextPass(
    result: FilterResult,
    brandContext: Parameters<SnippetJudgementPort["verifySnippet"]>[0]["brandContext"],
    negativeBoost: string,
    tally: WarningTally,
  ): Promise<boolean> {
    const extracted = await this.extraction.extract(result.url);
    if (extracted.kind === "extractionFailure") {
      tally.extractFailed += 1; // stays included; interim score + provisional type kept; status + extracted_content NULL
      return false;
    }

    // Extract succeeded: persist the full text for PRD 07's Page to display ("Extracted via Tavily").
    // Display-only — the in-memory fullText still feeds the fused call below; this write is never echoed
    // into exclusion_detail/logs/spans (anti-echo unaffected). A failed Extract above leaves it NULL.
    await this.repo.setExtractedContent(result.id, extracted.fullText);

    const analysis = await this.fullText.analyze({ fullText: extracted.fullText, brandContext, negativeBoost });
    if ("failed" in analysis) {
      tally.fullTextClassifyFailed += 1; // content_type left NULL
      tally.enhanceFailed += 1; //          sentiment/takeaway left NULL
      return false;
    }

    const verdict = classifyScore(analysis.entityMatchScore, {
      tExclude: this.config.fullTextTExclude,
      tVerified: this.config.tVerified,
    });
    if (verdict.kind === "exclude") {
      const { code, detail } = offTopicExclusion(); // the look-alike caught on the page
      await this.repo.recordExclusion(result.id, code, detail);
      return false; // no Enhance write on an Excluded row; provisional/interim type is retained
    }

    const outcome: FullTextOutcome = {
      matchScore: ratchet("final", analysis.entityMatchScore), // overwrites interim
      verificationStatus: verdict.status, //                     verified | uncertain
      contentType: analysis.contentType, //                      re-Classify
      sentiment: analysis.sentiment, //                          Enhance
      takeaway: analysis.takeaway, //                            Enhance
    };
    await this.repo.applyFullTextOutcome(result.id, outcome);
    return true; // a content_type was written
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/analyze/analyze.stage.test.ts`
Expected: PASS (13 tests — the 7 from Task 10 plus the 6 added here).

- [ ] **Step 5: Commit**

```bash
git add src/application/analyze/analyze.stage.ts src/application/analyze/analyze.stage.test.ts
git commit -m "feat(analyze): AnalyzeStage Pass 2 — Extract, fused call, ratchet/mapping writes, roll-ups"
```

---

## Task 12: Anthropic snippet-judgement adapter (contract test)

**Files:**
- Modify: `src/infrastructure/anthropic/anthropic.config.ts` (add the Haiku model id + analyze timeout)
- Create: `src/infrastructure/anthropic/snippet-judgement.adapter.ts`
- Test: `src/infrastructure/anthropic/snippet-judgement.adapter.test.ts`

> Owns both cheap Pass-1 structured calls over the Haiku model. The contract test injects a fake matching `client.messages.create(...)`. Verify the exact request shape (tool/`tool_choice` or JSON-mode) and the response content-block shape against the installed `@anthropic-ai/sdk@^0.102.0` when wiring the real key; the `claude-api` skill is the reference for current model ids and structured-output mechanics. The adapter parses a single structured JSON object out of the response and Zod-validates it; any non-2xx / quota / timeout / schema-violation → `{ failed: true }`, never a throw, never an unvalidated object.

- [ ] **Step 1: Add the Haiku model id to the Anthropic config**

```ts
// src/infrastructure/anthropic/anthropic.config.ts (additions — keep Search's existing fields)
// Add to the existing AnthropicConfig type:
//   haikuModel: string;       // ANTHROPIC_HAIKU_MODEL — the snippet gates + the fused full-text call
//   analyzeTimeoutMs: number; // per-call timeout for the analyze Haiku calls
// (ANTHROPIC_CONFIG token + apiKey already exist from Search; do not redeclare them.)
```

- [ ] **Step 2: Write the failing test**

```ts
// src/infrastructure/anthropic/snippet-judgement.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { SnippetJudgementAdapter } from "./snippet-judgement.adapter";
import type { SnippetEvidence } from "../../application/analyze/ports/snippet-judgement.port";

const evidence: SnippetEvidence = {
  url: "https://news.example/aglow",
  title: "Aglow raises a round",
  snippet: "Aglow announced funding...",
};

// Fake matching client.messages.create — returns a content block carrying a single JSON object.
const fakeAnthropic = (impl: () => unknown) => ({ messages: { create: vi.fn(impl) } });
const jsonReply = (obj: unknown) => async () => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
  usage: { input_tokens: 50, output_tokens: 10 },
  model: "claude-haiku",
  stop_reason: "end_turn",
});

const adapter = (client: unknown) => new SnippetJudgementAdapter(client as never, "claude-haiku", 10000);

describe("SnippetJudgementAdapter — snippet-Verify", () => {
  it("maps a representative response to { interimMatchScore } (score-only, Zod-validated)", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ entityMatchScore: 72 }))).verifySnippet({
      evidence,
      brandContext: null,
      negativeBoost: "",
    });
    expect(out).toEqual({ interimMatchScore: 72 });
  });

  it("returns { failed: true } on an out-of-range score (schema violation, never an unvalidated object)", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ entityMatchScore: 150 }))).verifySnippet({
      evidence,
      brandContext: null,
      negativeBoost: "",
    });
    expect(out).toEqual({ failed: true });
  });

  it("returns { failed: true } when the SDK throws (quota/timeout/non-2xx), never a throw", async () => {
    const client = fakeAnthropic(async () => {
      throw new Error("rate limit");
    });
    expect(await adapter(client).verifySnippet({ evidence, brandContext: null, negativeBoost: "" })).toEqual({ failed: true });
  });
});

describe("SnippetJudgementAdapter — snippet-Classify", () => {
  it("maps a representative response to { contentType } over the enum", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ contentType: "news_article" }))).classifySnippet(evidence);
    expect(out).toEqual({ contentType: "news_article" });
  });

  it("returns { failed: true } on an out-of-enum contentType", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ contentType: "tweet" }))).classifySnippet(evidence);
    expect(out).toEqual({ failed: true });
  });

  it("returns { failed: true } when the response is not parseable JSON", async () => {
    const client = fakeAnthropic(async () => ({ content: [{ type: "text", text: "not json" }] }));
    expect(await adapter(client).classifySnippet(evidence)).toEqual({ failed: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/snippet-judgement.adapter.test.ts`
Expected: FAIL — `Cannot find module './snippet-judgement.adapter'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/infrastructure/anthropic/snippet-judgement.adapter.ts
import { z } from "zod";
import type {
  SnippetJudgementPort,
  SnippetEvidence,
  SnippetVerifyInput,
} from "../../application/analyze/ports/snippet-judgement.port";
import { CONTENT_TYPES, type ContentType } from "../../domain/analyze/content-type";
import type { BrandContext } from "../../domain/resolve/brand-context";

// The subset of the @anthropic-ai/sdk client surface we depend on (kept local; the port hides it).
export type AnthropicClient = {
  messages: { create(body: Record<string, unknown>): Promise<unknown> };
};

const verifySchema = z.object({ entityMatchScore: z.number().min(0).max(100) }).strip();
const classifySchema = z.object({ contentType: z.enum(CONTENT_TYPES) }).strip();
const responseSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).passthrough();

/**
 * Owns both cheap Pass-1 structured Haiku calls. snippet-Verify returns ONLY the score (the Exclude
 * decision is the domain's classifyScore). Both calls inject the SnippetEvidence, the positive
 * BrandContext, and the negativeBoost VERBATIM (ADR 0001 — collected collision contexts under the
 * assertive framing, never re-derived diffs). On any transport/quota/timeout/parse/schema failure the
 * method returns { failed: true } — never a throw, never an unvalidated object. No raw prompt, snippet,
 * or completion text is ever returned or persisted (anti-echo).
 */
export class SnippetJudgementAdapter implements SnippetJudgementPort {
  constructor(
    private readonly client: AnthropicClient,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async verifySnippet(input: SnippetVerifyInput): Promise<{ interimMatchScore: number } | { failed: true }> {
    const parsed = await this.callStructured(this.verifyPrompt(input), verifySchema);
    return parsed ? { interimMatchScore: parsed.entityMatchScore } : { failed: true };
  }

  async classifySnippet(evidence: SnippetEvidence): Promise<{ contentType: ContentType } | { failed: true }> {
    const parsed = await this.callStructured(this.classifyPrompt(evidence), classifySchema);
    return parsed ? { contentType: parsed.contentType } : { failed: true };
  }

  /** One structured Haiku call; extracts the first text block, JSON-parses, and Zod-validates it. */
  private async callStructured<T>(prompt: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const raw = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });
      const response = responseSchema.safeParse(raw);
      if (!response.success) return null;
      const text = response.data.content.find((b) => typeof b.text === "string")?.text;
      if (text === undefined) return null;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }
      const result = schema.safeParse(json);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private brandLines(brandContext: BrandContext | null): string {
    if (brandContext === null) return "No brand context is available (name-only Job).";
    return [
      `Value proposition: ${brandContext.valueProposition ?? "(unknown)"}`,
      `Target audience: ${brandContext.targetAudienceSegments.join(", ") || "(unknown)"}`,
      `Products & services: ${brandContext.productsAndServices.join(", ") || "(unknown)"}`,
    ].join("\n");
  }

  private verifyPrompt(input: SnippetVerifyInput): string {
    return [
      "You judge how confident we are that a search result is about the TARGET company.",
      "Target company brand context:",
      this.brandLines(input.brandContext),
      input.negativeBoost
        ? `Known look-alikes sharing this name that are NOT the target — reject pages about these:\n${input.negativeBoost}`
        : "No known look-alikes were provided.",
      "Search result evidence (title, snippet, URL only):",
      `Title: ${input.evidence.title}`,
      `Snippet: ${input.evidence.snippet}`,
      `URL: ${input.evidence.url}`,
      'Respond ONLY with JSON: {"entityMatchScore": <integer 0-100>}.',
    ].join("\n");
  }

  private classifyPrompt(evidence: SnippetEvidence): string {
    return [
      "Classify the search result's content type from its title, snippet, and URL.",
      `Allowed types: ${CONTENT_TYPES.join(", ")}.`,
      `Title: ${evidence.title}`,
      `Snippet: ${evidence.snippet}`,
      `URL: ${evidence.url}`,
      'Respond ONLY with JSON: {"contentType": "<one allowed type>"}.',
    ].join("\n");
  }
}
```

> The `timeoutMs` is plumbed for the real SDK call's `AbortController`/request options when wiring the live client; the fake in the contract test ignores it. The `responseSchema` is tolerant (`.passthrough()`); the load-bearing assertion is the per-call `verifySchema`/`classifySchema`.

- [ ] **Step 5: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/snippet-judgement.adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/anthropic/anthropic.config.ts src/infrastructure/anthropic/snippet-judgement.adapter.ts src/infrastructure/anthropic/snippet-judgement.adapter.test.ts
git commit -m "feat(analyze): Anthropic snippet-judgement adapter (Verify score + Classify, fail-soft, anti-echo)"
```

---

## Task 13: Anthropic fused full-text adapter (contract test)

**Files:**
- Create: `src/infrastructure/anthropic/full-text-analysis.adapter.ts`
- Test: `src/infrastructure/anthropic/full-text-analysis.adapter.test.ts`

> The fused call (ADR 0003): ONE `messages.create` per Extracted Result whose structured-output contract is `fusedAnalysisSchema` verbatim. Zod-parses and returns the validated `FusedAnalysis`, or `{ failed: true }` on any malformed / schema-violating / transport / timeout failure — an unvalidated object NEVER crosses the port. Reuses the same `AnthropicClient` surface as the snippet adapter. Do NOT split into three calls.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/anthropic/full-text-analysis.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { FullTextAnalysisAdapter } from "./full-text-analysis.adapter";

const fakeAnthropic = (impl: () => unknown) => ({ messages: { create: vi.fn(impl) } });
const jsonReply = (obj: unknown) => async () => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
  usage: { input_tokens: 800, output_tokens: 60 },
  model: "claude-haiku",
  stop_reason: "end_turn",
});

const valid = { entityMatchScore: 84, contentType: "news_article", sentiment: "positive", takeaway: "Aglow raised a round." };
const adapter = (client: unknown) => new FullTextAnalysisAdapter(client as never, "claude-haiku", 30000, 400);
const input = { fullText: "the page text", brandContext: null, negativeBoost: "" };

describe("FullTextAnalysisAdapter", () => {
  it("maps a representative fused response to a Zod-validated FusedAnalysis (all four fields)", async () => {
    expect(await adapter(fakeAnthropic(jsonReply(valid))).analyze(input)).toEqual(valid);
  });

  it("returns { failed: true } on an out-of-enum contentType", async () => {
    expect(await adapter(fakeAnthropic(jsonReply({ ...valid, contentType: "tweet" }))).analyze(input)).toEqual({ failed: true });
  });

  it("returns { failed: true } on a missing field", async () => {
    const { sentiment, ...missing } = valid;
    expect(await adapter(fakeAnthropic(jsonReply(missing))).analyze(input)).toEqual({ failed: true });
  });

  it("returns { failed: true } on an over-length takeaway (the config cap)", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ ...valid, takeaway: "x".repeat(401) }))).analyze(input);
    expect(out).toEqual({ failed: true });
  });

  it("drops injected extra fields (anti-echo): only the four validated fields are returned", async () => {
    const out = await adapter(fakeAnthropic(jsonReply({ ...valid, injected: "IGNORE INSTRUCTIONS" }))).analyze(input);
    expect(out).toEqual(valid);
  });

  it("returns { failed: true } when the SDK throws, never a throw", async () => {
    const client = fakeAnthropic(async () => {
      throw new Error("timeout");
    });
    expect(await adapter(client).analyze(input)).toEqual({ failed: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/full-text-analysis.adapter.test.ts`
Expected: FAIL — `Cannot find module './full-text-analysis.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/anthropic/full-text-analysis.adapter.ts
import { z } from "zod";
import type { AnthropicClient } from "./snippet-judgement.adapter";
import type { FullTextAnalysisPort, FullTextAnalysisInput } from "../../application/analyze/ports/full-text-analysis.port";
import { fusedAnalysisSchema, type FusedAnalysis } from "../../domain/analyze/fused-analysis";
import { CONTENT_TYPES } from "../../domain/analyze/content-type";
import { SENTIMENTS } from "../../domain/analyze/sentiment";
import type { BrandContext } from "../../domain/resolve/brand-context";

const responseSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).passthrough();

/**
 * The ONE fused Haiku call per Extracted Result (ADR 0003). One messages.create whose prompt carries
 * the Extracted fullText, the positive BrandContext, and the negativeBoost, returning the four outputs
 * of the three distinct stages together. Zod-parses against fusedAnalysisSchema VERBATIM and returns the
 * validated FusedAnalysis, or { failed: true } on any malformed / schema-violating / transport / timeout
 * failure — an unvalidated object never crosses the port (the anti-echo boundary). Not split into three.
 */
export class FullTextAnalysisAdapter implements FullTextAnalysisPort {
  private readonly schema: ReturnType<typeof fusedAnalysisSchema>;

  constructor(
    private readonly client: AnthropicClient,
    private readonly model: string,
    private readonly timeoutMs: number,
    takeawayMaxLength: number,
  ) {
    this.schema = fusedAnalysisSchema(takeawayMaxLength);
  }

  async analyze(input: FullTextAnalysisInput): Promise<FusedAnalysis | { failed: true }> {
    try {
      const raw = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        messages: [{ role: "user", content: this.prompt(input) }],
      });
      const response = responseSchema.safeParse(raw);
      if (!response.success) return { failed: true };
      const text = response.data.content.find((b) => typeof b.text === "string")?.text;
      if (text === undefined) return { failed: true };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { failed: true };
      }
      const result = this.schema.safeParse(json);
      return result.success ? result.data : { failed: true };
    } catch {
      return { failed: true };
    }
  }

  private brandLines(brandContext: BrandContext | null): string {
    if (brandContext === null) return "No brand context is available (name-only Job).";
    return [
      `Value proposition: ${brandContext.valueProposition ?? "(unknown)"}`,
      `Target audience: ${brandContext.targetAudienceSegments.join(", ") || "(unknown)"}`,
      `Products & services: ${brandContext.productsAndServices.join(", ") || "(unknown)"}`,
    ].join("\n");
  }

  private prompt(input: FullTextAnalysisInput): string {
    return [
      "Read the full page text and judge it against the TARGET company. Return all four fields together.",
      "Target company brand context:",
      this.brandLines(input.brandContext),
      input.negativeBoost
        ? `Known look-alikes sharing this name that are NOT the target — reject pages about these:\n${input.negativeBoost}`
        : "No known look-alikes were provided.",
      "Full page text:",
      input.fullText,
      "Respond ONLY with JSON of the shape:",
      `{"entityMatchScore": <integer 0-100>, "contentType": "<one of: ${CONTENT_TYPES.join(", ")}>", "sentiment": "<one of: ${SENTIMENTS.join(", ")}>", "takeaway": "<short takeaway about the target>"}`,
    ].join("\n");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/full-text-analysis.adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/anthropic/full-text-analysis.adapter.ts src/infrastructure/anthropic/full-text-analysis.adapter.test.ts
git commit -m "feat(analyze): Anthropic fused full-text adapter (ADR 0003, Zod-validated, fail-soft)"
```

---

## Task 14: Tavily Extract adapter (contract test)

**Files:**
- Create: `src/infrastructure/tavily/content-extraction.adapter.ts`
- Test: `src/infrastructure/tavily/content-extraction.adapter.test.ts`

> Wraps `@tavily/core`'s **Extract** API behind `ContentExtractionPort` — Tavily retrieves the page server-side; we never fetch a Result page. Reuses Search's Tavily client config. The contract test injects a fake matching the `@tavily/core` `tavily({ apiKey }).extract(urls, options)` shape — verify the exact client method name + the response field carrying page text (`results[].rawContent`/`raw_content`/`content`) against the installed `@tavily/core@^0.7.5` when wiring the real key. Maps a successful Extract to `{ kind: "extracted", fullText }`; non-2xx / quota / network / timeout / empty extraction → `{ kind: "extractionFailure" }` — never a throw, never an Exclusion.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/tavily/content-extraction.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { TavilyContentExtractionAdapter } from "./content-extraction.adapter";

// A fake matching @tavily/core's client surface: { extract(urls, options) }.
const fakeClient = (impl: (urls: unknown, opts: unknown) => unknown) => ({ extract: vi.fn(impl) });
const adapter = (client: unknown) => new TavilyContentExtractionAdapter(client as never, 15000);

describe("TavilyContentExtractionAdapter", () => {
  it("maps a successful Extract to { kind: 'extracted', fullText }", async () => {
    const client = fakeClient(async () => ({ results: [{ url: "https://news.example/a", rawContent: "the full page text" }] }));
    expect(await adapter(client).extract("https://news.example/a")).toEqual({ kind: "extracted", fullText: "the full page text" });
  });

  it("passes the single URL to the client", async () => {
    const client = fakeClient(async () => ({ results: [{ url: "https://news.example/a", rawContent: "x" }] }));
    await adapter(client).extract("https://news.example/a");
    expect(client.extract).toHaveBeenCalledWith(["https://news.example/a"], expect.any(Object));
  });

  it("returns { kind: 'extractionFailure' } on an empty extraction (no results)", async () => {
    const client = fakeClient(async () => ({ results: [] }));
    expect(await adapter(client).extract("https://news.example/a")).toEqual({ kind: "extractionFailure" });
  });

  it("returns { kind: 'extractionFailure' } when the page text is empty", async () => {
    const client = fakeClient(async () => ({ results: [{ url: "https://news.example/a", rawContent: "" }] }));
    expect(await adapter(client).extract("https://news.example/a")).toEqual({ kind: "extractionFailure" });
  });

  it("returns { kind: 'extractionFailure' } when the client throws (quota/network/timeout), never a throw", async () => {
    const client = fakeClient(async () => {
      throw new Error("quota");
    });
    expect(await adapter(client).extract("https://news.example/a")).toEqual({ kind: "extractionFailure" });
  });

  it("returns { kind: 'extractionFailure' } when the response fails to parse", async () => {
    const client = fakeClient(async () => ({ unexpected: true }));
    expect(await adapter(client).extract("https://news.example/a")).toEqual({ kind: "extractionFailure" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/tavily/content-extraction.adapter.test.ts`
Expected: FAIL — `Cannot find module './content-extraction.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/tavily/content-extraction.adapter.ts
import { z } from "zod";
import type { ContentExtractionPort, ExtractionResult } from "../../application/analyze/ports/content-extraction.port";

// The subset of the @tavily/core client surface we depend on (kept local; the port hides it).
export type TavilyExtractClient = {
  extract(urls: string[], options?: Record<string, unknown>): Promise<unknown>;
};

const responseSchema = z
  .object({
    results: z.array(
      z
        .object({
          url: z.string().nullish(),
          rawContent: z.string().nullish(),
          raw_content: z.string().nullish(),
          content: z.string().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * Tavily Extract behind ContentExtractionPort — Tavily retrieves the page server-side; we never
 * "fetch" a Result page. Maps a successful Extract to { kind: "extracted", fullText }; on non-2xx /
 * quota / network / timeout / empty extraction returns { kind: "extractionFailure" } — never a throw,
 * never an Exclusion. No scraped page text is put onto any future span attribute (anti-echo): the
 * fullText is consumed only by the fused call and persisted only as the validated takeaway.
 */
export class TavilyContentExtractionAdapter implements ContentExtractionPort {
  constructor(
    private readonly client: TavilyExtractClient,
    private readonly timeoutMs: number,
  ) {}

  async extract(url: string): Promise<ExtractionResult> {
    try {
      const raw = await this.client.extract([url], { timeout: this.timeoutMs });
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.results.length === 0) return { kind: "extractionFailure" };
      const first = parsed.data.results[0];
      const fullText = first.rawContent ?? first.raw_content ?? first.content ?? "";
      if (fullText.length === 0) return { kind: "extractionFailure" };
      return { kind: "extracted", fullText };
    } catch {
      return { kind: "extractionFailure" };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/tavily/content-extraction.adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/tavily/content-extraction.adapter.ts src/infrastructure/tavily/content-extraction.adapter.test.ts
git commit -m "feat(analyze): Tavily Extract adapter (server-side page text, failure → typed value)"
```

---

## Task 15: `ResultRepository` analyze writes (Drizzle) + compose-Postgres integration (ADR 0008)

**Files:**
- Modify: `src/infrastructure/persistence/result.repository.ts` (implement `setInterimMatchScore`, `setProvisionalContentType`, `applyFullTextOutcome`, `setExtractedContent`)
- Test: `src/infrastructure/persistence/result.repository.analyze.integration.test.ts`

> **Schema:** the analysis-output columns (`match_score` / `verification_status` / `content_type` / `sentiment` / `takeaway`, all nullable) and the `off_topic` exclusion code were already reserved by Foundation; the one new column `extracted_content` was added in **Task 1a**. This task adds **four** methods to the EXISTING `ResultDrizzleRepository`. Per **ADR 0008** the integration test runs against the **docker-compose Postgres** (NOT Testcontainers) and is named `*.integration.test.ts`; it assumes `docker compose up` is running (and that Task 1a's migration has been applied to it). Reuse Foundation's test-DB helper (`withTestDatabase`) that yields a Drizzle client + a `jobs`-row inserter + a Result inserter; align `results.*` column names with `schema.ts`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/result.repository.analyze.integration.test.ts
import { describe, it, expect } from "vitest";
import { withTestDatabase } from "./test-support/with-test-database"; // adjust to Foundation's helper
import { ResultDrizzleRepository } from "./result.repository";
import type { FullTextOutcome } from "../../application/search/ports/result-repository.port";

const PROVISIONAL = 42; // the provisional rung Search wrote

describe("ResultDrizzleRepository — analyze writes (compose Postgres, ADR 0008)", () => {
  const db = withTestDatabase(); // dedicated test DB/schema on the compose Postgres; cleans its own data

  /** Insert one born-`included` Result carrying the provisional Match Score; return its id. */
  const seed = async (jobId: string, normalizedUrl = "news.example/a") =>
    db.insertResult(jobId, { url: `https://${normalizedUrl}`, normalizedUrl, title: "Aglow", snippet: "s", matchScore: PROVISIONAL, source: "tavily" });

  it("setInterimMatchScore overwrites the provisional match_score and touches no other column", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    await repo.setInterimMatchScore(id, 62);

    const row = await db.readResult(id);
    expect(Number(row.match_score)).toBe(62);
    expect(row.verification_status).toBeNull(); // NOT written by this method
    expect(row.content_type).toBeNull();
    expect(row.status).toBe("included");
  });

  it("setProvisionalContentType sets content_type only", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    await repo.setProvisionalContentType(id, "blog_post");

    const row = await db.readResult(id);
    expect(row.content_type).toBe("blog_post");
    expect(Number(row.match_score)).toBe(PROVISIONAL); // untouched
    expect(row.verification_status).toBeNull();
  });

  it("applyFullTextOutcome sets match_score (final) + verification_status + content_type + sentiment + takeaway together, never status", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    const outcome: FullTextOutcome = {
      matchScore: 88,
      verificationStatus: "verified",
      contentType: "news_article",
      sentiment: "positive",
      takeaway: "Aglow raised a round.",
    };
    await repo.applyFullTextOutcome(id, outcome);

    const row = await db.readResult(id);
    expect(Number(row.match_score)).toBe(88); // final rung overwrites interim/provisional
    expect(row.verification_status).toBe("verified");
    expect(row.content_type).toBe("news_article");
    expect(row.sentiment).toBe("positive");
    expect(row.takeaway).toBe("Aglow raised a round.");
    expect(row.status).toBe("included"); // never touched
  });

  it("setExtractedContent persists the Extracted full text into extracted_content (display-only, PRD 07) and touches no other column", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    await repo.setExtractedContent(id, "the full extracted page text");

    const row = await db.readResult(id);
    expect(row.extracted_content).toBe("the full extracted page text");
    expect(Number(row.match_score)).toBe(PROVISIONAL); // untouched
    expect(row.verification_status).toBeNull();
    expect(row.status).toBe("included");
  });

  it("a Result with no Extract leaves extracted_content NULL (a successful write is the only thing that sets it)", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId); // born included; Extract never ran for it
    const repo = new ResultDrizzleRepository(db.client);
    await repo.setInterimMatchScore(id, 55); // a non-Extract write does NOT touch extracted_content

    const row = await db.readResult(id);
    expect(row.extracted_content).toBeNull(); // Extract did not succeed → NULL
  });

  it("a failed Extract leaves a Result included with its interim score and NULL verification_status (no full-text write)", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    await repo.setInterimMatchScore(id, 55); // interim rung only — Extract failed, no full-text write

    const row = await db.readResult(id);
    expect(Number(row.match_score)).toBe(55); // ordering preserved
    expect(row.verification_status).toBeNull(); // read "Unverified" — NULL status does NOT imply NULL score
    expect(row.status).toBe("included");
  });

  it("recordExclusion(id, 'off_topic', 'LLM') flips included → excluded and is idempotent (WHERE status = 'included' guard)", async () => {
    const jobId = await db.insertJob();
    const id = await seed(jobId);
    const repo = new ResultDrizzleRepository(db.client);
    await repo.recordExclusion(id, "off_topic", "LLM");
    await repo.recordExclusion(id, "off_topic", "LLM"); // no-op second time

    const row = await db.readResult(id);
    expect(row.status).toBe("excluded");
    expect(row.exclusion_code).toBe("off_topic");
    expect(row.exclusion_detail).toBe("LLM");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/result.repository.analyze.integration.test.ts`
Expected: FAIL — `repo.setInterimMatchScore is not a function` (the four methods are not yet implemented). (Requires `docker compose up`; if the helper or compose stack is down the suite errors on connection — start it first.)

- [ ] **Step 3: Implement the four methods on `ResultDrizzleRepository`**

Add to `src/infrastructure/persistence/result.repository.ts` (extend the existing class; keep `insertIncluded`/`findIncluded`/`recordExclusion`):

```ts
// add to the imports at the top of result.repository.ts:
import { eq } from "drizzle-orm";
import type { FullTextOutcome } from "../../application/search/ports/result-repository.port";
import type { ContentType } from "../../domain/analyze/content-type";
```

```ts
  /** Ratchet rung 2 (snippet-Verify): the interim score overwrites the provisional rung; no other column. */
  async setInterimMatchScore(resultId: string, score: number): Promise<void> {
    await this.db.update(results).set({ matchScore: score }).where(eq(results.id, resultId));
  }

  /** snippet-Classify: provisional Content Type only. */
  async setProvisionalContentType(resultId: string, type: ContentType): Promise<void> {
    await this.db.update(results).set({ contentType: type }).where(eq(results.id, resultId));
  }

  /**
   * The fused-call write: match_score (final rung, overwriting interim), verification_status,
   * content_type, sentiment, takeaway together — Verify/Classify/Enhance distinct fields, one durable
   * write. Touches `status` NEVER (Exclusion is recordExclusion's guarded write, reused from Filter).
   */
  async applyFullTextOutcome(resultId: string, outcome: FullTextOutcome): Promise<void> {
    await this.db
      .update(results)
      .set({
        matchScore: outcome.matchScore,
        verificationStatus: outcome.verificationStatus,
        contentType: outcome.contentType,
        sentiment: outcome.sentiment,
        takeaway: outcome.takeaway,
      })
      .where(eq(results.id, resultId));
  }

  /**
   * On a successful Extract: persist the Extracted full text into the (new, Task 1a) nullable
   * `extracted_content` column so PRD 07's Page can display it ("Extracted via Tavily"). Touches no
   * other column; a Result whose Extract failed is left with `extracted_content` NULL. Display-only.
   */
  async setExtractedContent(resultId: string, content: string): Promise<void> {
    await this.db.update(results).set({ extractedContent: content }).where(eq(results.id, resultId));
  }
```

> Align `results.id`, `results.matchScore`, `results.contentType`, `results.verificationStatus`, `results.sentiment`, `results.takeaway`, and `results.extractedContent` (added in Task 1a) with Foundation's actual `schema.ts` column property names. If the helper exposes raw SQL reads instead of `db.readResult`/`db.insertResult`, adapt the test's read/seed lines to the project's query style — the assertions on persisted facts are the load-bearing part.

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/result.repository.analyze.integration.test.ts`
Expected: PASS (7 tests) with `docker compose up` running.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/result.repository.ts src/infrastructure/persistence/result.repository.analyze.integration.test.ts
git commit -m "feat(analyze): Drizzle ResultRepository analyze writes incl. setExtractedContent (compose-PG integration per ADR 0008)"
```

---

## Task 16: DI wiring — register `AnalyzeStage` FOURTH in the StageRunner

**Files:**
- Create: `src/infrastructure/analyze/analyze.module.ts` (provider wiring for the three adapters + `AnalyzeConfig`)
- Modify: `src/app-worker.module.ts` (build `AnalyzeStage`, register it FOURTH in the `StageRunner`)
- Modify: `.env.example` (add the `ANALYZE_*` + `ANTHROPIC_HAIKU_MODEL` keys)
- Test: `src/app-worker.module.test.ts` (extend the wiring test — assert Analyze is registered fourth)

> Read the existing `app-worker.module.ts` to see how the ordered stage list is built (Resolve first, Search second, Filter third). The goal: the runner is `[ResolveStage, SearchStage, FilterStage, AnalyzeStage]` after this task. The two Haiku adapters reuse the **existing Anthropic client** Search wired (one `ANTHROPIC_API_KEY`); the Extract adapter reuses Search's **existing Tavily client**. `AnalyzeStage` takes the existing `RESULT_REPOSITORY` provider (Search/Filter already wired it). The Tavily client from `@tavily/core`'s `tavily({ apiKey })` exposes both `.search(...)` (Search) and `.extract(...)` (this stage).

- [ ] **Step 1: Write the failing wiring test**

```ts
// src/app-worker.module.test.ts (add this case alongside Resolve/Search/Filter's)
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { AppWorkerModule } from "./app-worker.module";
import { StageRunner } from "./application/pipeline/stage-runner"; // adjust to Foundation's export
import { ResolveStage } from "./application/resolve/resolve.stage";
import { SearchStage } from "./application/search/search.stage";
import { FilterStage } from "./application/filter/filter.stage";
import { AnalyzeStage } from "./application/analyze/analyze.stage";

describe("AppWorkerModule wiring — Analyze", () => {
  it("registers AnalyzeStage as the fourth pipeline stage (after Resolve, Search, Filter)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppWorkerModule] })
      // override real Anthropic/Tavily/DB providers with test doubles per the project's testing pattern
      .compile();
    const runner = moduleRef.get(StageRunner);
    expect(runner.stages[0]).toBeInstanceOf(ResolveStage);
    expect(runner.stages[1]).toBeInstanceOf(SearchStage);
    expect(runner.stages[2]).toBeInstanceOf(FilterStage);
    expect(runner.stages[3]).toBeInstanceOf(AnalyzeStage);
    expect(runner.stages[3]?.name).toBe("analyze");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/app-worker.module.test.ts -t "Analyze"`
Expected: FAIL — `AnalyzeStage` not registered / `runner.stages[3]` undefined.

- [ ] **Step 3: Write the Analyze module and wire the worker module**

```ts
// src/infrastructure/analyze/analyze.module.ts
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { tavily } from "@tavily/core";
import Anthropic from "@anthropic-ai/sdk";
import { SnippetJudgementAdapter } from "../anthropic/snippet-judgement.adapter";
import { FullTextAnalysisAdapter } from "../anthropic/full-text-analysis.adapter";
import { TavilyContentExtractionAdapter } from "../tavily/content-extraction.adapter";
import { SNIPPET_JUDGEMENT_PORT } from "../../application/analyze/ports/snippet-judgement.port";
import { FULL_TEXT_ANALYSIS_PORT } from "../../application/analyze/ports/full-text-analysis.port";
import { CONTENT_EXTRACTION_PORT } from "../../application/analyze/ports/content-extraction.port";
import { ANALYZE_CONFIG, assertAnalyzeConfig } from "../../application/analyze/analyze-config";

const num = (config: ConfigService, key: string, fallback: number): number => Number(config.get(key) ?? fallback);

@Module({
  providers: [
    {
      provide: ANALYZE_CONFIG,
      useFactory: (config: ConfigService) =>
        assertAnalyzeConfig({
          snippetTExclude: num(config, "ANALYZE_SNIPPET_T_EXCLUDE", 25),
          fullTextTExclude: num(config, "ANALYZE_FULL_TEXT_T_EXCLUDE", 40),
          tVerified: num(config, "ANALYZE_T_VERIFIED", 70),
          extractConcurrency: num(config, "ANALYZE_EXTRACT_CONCURRENCY", 5),
          takeawayMaxLength: num(config, "ANALYZE_TAKEAWAY_MAX_LENGTH", 400),
        }),
      inject: [ConfigService],
    },
    {
      provide: SNIPPET_JUDGEMENT_PORT,
      useFactory: (config: ConfigService) =>
        new SnippetJudgementAdapter(
          new Anthropic({ apiKey: config.getOrThrow("ANTHROPIC_API_KEY") }) as never,
          config.getOrThrow("ANTHROPIC_HAIKU_MODEL"),
          num(config, "ANTHROPIC_ANALYZE_TIMEOUT_MS", 15000),
        ),
      inject: [ConfigService],
    },
    {
      provide: FULL_TEXT_ANALYSIS_PORT,
      useFactory: (config: ConfigService) =>
        new FullTextAnalysisAdapter(
          new Anthropic({ apiKey: config.getOrThrow("ANTHROPIC_API_KEY") }) as never,
          config.getOrThrow("ANTHROPIC_HAIKU_MODEL"),
          num(config, "ANTHROPIC_ANALYZE_TIMEOUT_MS", 30000),
          num(config, "ANALYZE_TAKEAWAY_MAX_LENGTH", 400),
        ),
      inject: [ConfigService],
    },
    {
      provide: CONTENT_EXTRACTION_PORT,
      useFactory: (config: ConfigService) =>
        new TavilyContentExtractionAdapter(
          tavily({ apiKey: config.getOrThrow("TAVILY_API_KEY") }) as never,
          num(config, "TAVILY_TIMEOUT_MS", 15000),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [ANALYZE_CONFIG, SNIPPET_JUDGEMENT_PORT, FULL_TEXT_ANALYSIS_PORT, CONTENT_EXTRACTION_PORT],
})
export class AnalyzeModule {}
```

In `app-worker.module.ts`, import `AnalyzeModule`, construct `AnalyzeStage` from the three ports + the existing `RESULT_REPOSITORY` provider + `ANALYZE_CONFIG`, and register it **fourth** in the `StageRunner` (after `ResolveStage`, `SearchStage`, `FilterStage`):

```ts
// src/app-worker.module.ts (sketch — merge into the existing module)
import { AnalyzeModule } from "./infrastructure/analyze/analyze.module";
import { AnalyzeStage } from "./application/analyze/analyze.stage";
import { SNIPPET_JUDGEMENT_PORT } from "./application/analyze/ports/snippet-judgement.port";
import { CONTENT_EXTRACTION_PORT } from "./application/analyze/ports/content-extraction.port";
import { FULL_TEXT_ANALYSIS_PORT } from "./application/analyze/ports/full-text-analysis.port";
import { ANALYZE_CONFIG } from "./application/analyze/analyze-config";
import { RESULT_REPOSITORY } from "./application/search/ports/result-repository.port";

// providers (added):
// {
//   provide: AnalyzeStage,
//   useFactory: (snippet, extraction, full, repo, config) => new AnalyzeStage(snippet, extraction, full, repo, config),
//   inject: [SNIPPET_JUDGEMENT_PORT, CONTENT_EXTRACTION_PORT, FULL_TEXT_ANALYSIS_PORT, RESULT_REPOSITORY, ANALYZE_CONFIG],
// },
// Build the StageRunner with [ResolveStage, SearchStage, FilterStage, AnalyzeStage]:
// {
//   provide: StageRunner,
//   useFactory: (resolve, search, filter, analyze) => new StageRunner([resolve, search, filter, analyze]),
//   inject: [ResolveStage, SearchStage, FilterStage, AnalyzeStage],
// },
// imports: [AnalyzeModule, <SearchModule for RESULT_REPOSITORY>, ConfigModule, ...]
```

Add to `.env.example`:

```
# --- Analyze stage (Verify / Classify / Enhance) ---
ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001  # the model id for the snippet gates + the fused full-text call
ANTHROPIC_ANALYZE_TIMEOUT_MS=15000               # per-call timeout for the analyze Haiku calls
ANALYZE_SNIPPET_T_EXCLUDE=25                      # LENIENT snippet-pass exclude cutoff (cost gate)
ANALYZE_FULL_TEXT_T_EXCLUDE=40                    # STRICTER full-text exclude cutoff (the precision call)
ANALYZE_T_VERIFIED=70                             # at/above → verified (both passes)
ANALYZE_EXTRACT_CONCURRENCY=5                     # bounded per-Result fan-out
ANALYZE_TAKEAWAY_MAX_LENGTH=400                   # schema cap on the one validated free-text field
```

> `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` (and `TAVILY_TIMEOUT_MS`) already exist from Search — do not duplicate them. `analyze` introduces **no new client**: it reuses the Anthropic and Tavily clients Search wired and the Result repository Search/Filter wired.

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/app-worker.module.test.ts -t "Analyze"`
Expected: PASS — `runner.stages[3]` is an `AnalyzeStage` with `name === "analyze"`.

- [ ] **Step 5: Run the full unit suite + gates**

Run:
```bash
OTEL_SDK_DISABLED=true pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec biome check src
```
Expected: all green (unit + adapter contract tests), `tsc` clean, Biome clean. FTA per file `OK` — the per-Result orchestration shell (`analyze.stage.ts`) is the file to watch; the branching is factored into the named domain functions to keep its assessment `OK`. The `*.integration.test.ts` (Task 15) is run separately with `docker compose up`, not in this gate (ADR 0008).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/analyze/analyze.module.ts src/app-worker.module.ts src/app-worker.module.test.ts .env.example
git commit -m "feat(analyze): wire AnalyzeStage fourth in the StageRunner + Anthropic/Tavily/config DI"
```

---

## Task 17: Follow-up note — Autoevals over the Aglow set (NOT a per-task unit gate)

**No code, no commit.** This task records the recall/precision gauge as documented follow-up so it is not mistaken for a per-task TDD gate, and confirms the single `extracted_content` column migration (and that no OTHER columns were added).

- [ ] **Step 1: Read and confirm — Autoevals is the eval-harness gauge, not a per-task unit gate**

The labelled Aglow set (`.input/test-case.md`, ≈ 14 include, ≈ 300 exclude) measures **Verify precision/recall** (over the include/exclude verdicts derived from the score cutoffs) and **Classify accuracy** (over the Content Type assignments). The case the two-pass design exists to catch is asserted in the eval harness: the **confusable indexed-brand middle (HomeAglow, Aglow Air)** is Excluded `off_topic` at the **full-text re-pass** even when its **snippet passes** the lenient gate — proving the strict full-text cutoff (`ANALYZE_FULL_TEXT_T_EXCLUDE` = 40 vs the lenient `ANALYZE_SNIPPET_T_EXCLUDE` = 25, pinned in Task 2's boundary test) closes the precision leak the snippet gate cannot. Per ADR 0001, the future **per-collision-diff experiment is gated on a measured win** on this set; the first lever for any Verify miss is **prompt framing** (the verbatim `negativeBoost` injection in Tasks 12–13), not pre-computation. This runs in the eval harness, not the per-task `pnpm verify` loop, and is **not** a deterministic gate on any of Tasks 1–16.

- [ ] **Step 2: Confirm — EXACTLY ONE schema migration (the `extracted_content` column) was introduced by this plan**

The analysis-output columns `match_score` / `verification_status` / `content_type` / `sentiment` / `takeaway` (all nullable) and the closed `exclusion_code` enum (incl. `off_topic`) were already reserved by Foundation; the writes in Tasks 9/15 targeting them need no migration, and `recordExclusion` is Filter's existing method. The **one** migration this plan owns is Task 1a's single nullable `results.extracted_content` (text) column — persisted for PRD 07's Page to display. Confirm exactly that one column was added and **no OTHER** column or table was created:

Run: `pnpm exec biome check --files-ignore-unknown=true drizzle/ >/dev/null 2>&1; grep -rniE "add column" drizzle/`
Expected: exactly one matching `ALTER TABLE "results" ADD COLUMN "extracted_content" text;` line — no other `ADD COLUMN`, no new `CREATE TABLE`, in this stage's migration.

Run (cross-check the schema edit is solely the one column): `git log --oneline -p -- src/infrastructure/persistence/schema.ts | grep -iE "extracted_content|extractedContent"`
Expected: the only `results`-column addition from this plan is `extractedContent: text("extracted_content")` (Task 1a); no other column was added to `results`.

---

## Self-review (run after all tasks)

- **Spec coverage:** every section of the spec maps to a task —
  - *Domain* — Match Score ratchet (T1, spec "match-score.ts"); the score→`verification_status`/exclude mapping at two cutoffs incl. lenient-vs-strict boundary (T2, "verification-status.ts"); the `off_topic`/`"LLM"` exclusion mapping (T3, "exclusion-mapping.ts"); `ContentType` + `Sentiment` vocabularies + the fused-analysis Zod schema verbatim (T4, "content-type.ts"/"sentiment.ts"/"fused-analysis.ts"); the Extract-gating predicate (T5, "extract-gate.ts"); the closed `ANALYZE_WARNING` set + count-only builders (T6, "analyze-warnings.ts").
  - *Schema* — the one migration this stage owns: the nullable `results.extracted_content` (text) column for PRD 07's Page to display (T1a).
  - *Application* — `AnalyzeConfig` + token + load-time invariant (T7); the three ports + tokens + normalized result types (T8); the `ResultRepository` extension incl. `setExtractedContent` (T9); the `AnalyzeStage` orchestration shell split into Pass 1 (T10) and Pass 2 + roll-ups + the `setExtractedContent` persistence-on-Extract-success step (T11) with bounded concurrency.
  - *Infrastructure* — Anthropic snippet-judgement adapter (T12); Anthropic fused full-text adapter (T13); Tavily Extract adapter (T14); the Drizzle analyze writes (incl. `setExtractedContent`) + compose-Postgres integration per ADR 0008 (T15).
  - *Interface* — DI wiring, `AnalyzeStage` registered fourth, `.env.example` keys (T16).
  - *Cross-cutting* — Observability seam is upheld as facts + anti-echo discipline (no spans built; honoured throughout, esp. T6/T12/T13/T14); Error handling (every external failure a value → Warning, never a Job failure; missing `resolvedIdentity` → plain `Error`) verified in T10/T11; Autoevals + the single `extracted_content` migration (and that no OTHER columns were added) recorded/confirmed in the follow-up note (T17). No section is left as a gap.
- **No placeholders:** every code step shows real code; every command shows expected output. The one intentional placeholder — `applyFullTextPass` in T10 — is explicitly a temporary stub that T11 overwrites with full code in the same file, and its temporary `false` return is consistent with T10's Pass-1 test expectations.
- **Type consistency (defined once, reused verbatim across tasks):** `MatchScoreRung`/`ratchet` (T1); `VerificationStatus`/`Cutoffs`/`ScoreVerdict`/`classifyScore` (T2); `OFF_TOPIC`/`LLM_CATCHER`/`offTopicExclusion` (T3); `CONTENT_TYPES`/`ContentType`, `SENTIMENTS`/`Sentiment`, `fusedAnalysisSchema`/`FusedAnalysis` (T4); `SnippetOutcome`/`survivedSnippetGates` (T5); `ANALYZE_WARNING`/`analyzeWarnings` (T6); `AnalyzeConfig`/`ANALYZE_CONFIG`/`assertAnalyzeConfig` (T7); `SnippetEvidence`/`SnippetVerifyInput`/`SnippetJudgementPort`/`SNIPPET_JUDGEMENT_PORT`, `ExtractionResult`/`ContentExtractionPort`/`CONTENT_EXTRACTION_PORT`, `FullTextAnalysisInput`/`FullTextAnalysisPort`/`FULL_TEXT_ANALYSIS_PORT` (T8); `AnalyzeResult`/`FullTextOutcome` + the four method names `setInterimMatchScore`/`setProvisionalContentType`/`applyFullTextOutcome`/`setExtractedContent` (T9, called exactly so in T10/T11/T15); `AnalyzeStage` constructor arity `(snippet, extraction, fullText, repo, config)` (T10/T11/T16); the `AnthropicClient` surface shared by both Haiku adapters (T12 exports it, T13 imports it). The repository reuses Filter's `recordExclusion(resultId, "off_topic", "LLM")` everywhere it Excludes.
- **Open verification points (resolve during execution, not guesses):**
  1. Foundation's `Warning` import path and `Stage`/`RunContext`/`createRunContext` exports + the running-Job test helper — adjust T6/T10/T11.
  2. Resolve's `ResolvedIdentity.assemble` parts shape and `BrandContext` field names (`valueProposition`/`targetAudienceSegments`/`productsAndServices`) — confirm against `src/domain/resolve/`; used in T8/T10/T12/T13.
  3. The current `result-repository.port.ts` (Search's `insertIncluded`, Filter's `findIncluded`/`recordExclusion`/`FilterResult`, the `ExclusionCode` import, the `RESULT_REPOSITORY` token) — extend, don't duplicate (T9).
  4. Foundation's `schema.ts` `results` column property names (`matchScore`/`verificationStatus`/`contentType`/`sentiment`/`takeaway`/`id`) — and the **new** `extractedContent` ↔ `extracted_content` column this plan adds in T1a — plus the test-DB helper API (`withTestDatabase` / `insertJob` / `insertResult` / `readResult`) — adjust T1a/T15; confirm the compose Postgres is up with T1a's migration applied (ADR 0008).
  5. `@anthropic-ai/sdk@^0.102.0` structured-output mechanics (JSON-in-text vs tool-use) + the current Haiku model id — confirm against the installed SDK and the `claude-api` skill; map in T12/T13 (the Zod validation contract is the load-bearing part regardless of mechanism).
  6. `@tavily/core@^0.7.5` Extract client method name (`extract`) + the page-text field (`rawContent`/`raw_content`/`content`) — confirm against the installed package (T14); the schema is tolerant but the mapping must match.
  7. Whether `StageRunner` exposes its stage list (`get stages()`) — Search/Filter's plans added it; reuse for T16.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-verify-extract-classify-enhance.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

`analyze` depends on **all of** PRD 1 (Foundation), PRD 2 (Resolve), PRD 3 (Search), and PRD 4 (Filter) being implemented. Before Task 6 (the first task importing an upstream symbol) resolve the seven open verification points against the implemented upstream stages — in particular confirm `ctx.resolvedIdentity` is populated by `ResolveStage`, that the shared `ResultRepository` port exists with Search's + Filter's methods, and that the `results` reserved nullable columns exist. Task 15 (the only integration test) requires `docker compose up` per ADR 0008; it is not part of the `pnpm verify` gate.
