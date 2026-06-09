# Summarise (`summarise` stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Summarise** stage — the fifth and final pipeline stage — that turns a Job's surviving (`included`) Results into **exactly one Job-level Summary**: a short digest of what the coverage, taken as a whole, says about the target company. It reads each surviving Result's **snippet** plus its per-Result Enhancement (`takeaway` + `sentiment`), makes **one Haiku call per Job** (never per Result), Zod-validates the structured output, and persists the single validated `Summary` to a one-row-per-Job `summaries` table. Excluded Results never feed the digest. Any shortfall — no surviving Results, an adapter error, or output that fails Zod validation — is recorded as a **Warning** and leaves the Summary absent. Summarise **never fails the Job** and never throws `JobFailedError`.

**Architecture:** Hexagonal on NestJS 11, inside Foundation's layering, after `analyze`. Pure domain (the input-selection rule, the `Summary` value object + `summarySchema`, the closed `SUMMARISE_WARNING` set + builders) + two application ports (`SummarisePort` over a Haiku adapter, `SummaryRepository`) + a read extension on the shared `ResultRepository` (`findIncludedForSummary`) + a `SummariseStage implements Stage` orchestration shell. The Anthropic Haiku adapter translates every transport / quota / SDK error **and** every Zod-validation failure into the same typed `{ ok: false }` value, so the shell branches on a value and records a single Warning — it never `try/catch`es to decide an outcome. One new `summaries` table via a `drizzle-kit` migration.

**Tech Stack:** TypeScript, NestJS 11, Zod, Drizzle/Postgres (postgres-js), `@anthropic-ai/sdk` (Haiku), Vitest (unit + adapter contract + compose-Postgres integration), Biome, FTA.

**Spec:** docs/superpowers/specs/2026-06-09-summarise-design.md
**PRD:** docs/prd/06-summarise.md · **ADRs:** 0002, 0004
---
## Prerequisites (read before starting)

- **Foundation (PRD 1), Resolve (PRD 2), Search (PRD 3), Filter & Collapse (PRD 4), and Analyze / Verify-Extract-Classify-Enhance (PRD 5) must be implemented.** Summarise sequences strictly after `analyze`: it reads the **final** `included` pool and the per-Result Enhancement columns (`takeaway`, `sentiment`) that `analyze` writes. If any upstream stage is missing, stop and implement it first.
- **This plan depends on and modifies these files:**
  - `src/domain/job/warning.ts` — Foundation's `Warning` value object `{ type, message }` (reused by `summarise-warnings.ts`).
  - `src/application/pipeline/stage.port.ts` — Foundation's `Stage` interface (`readonly name: string; run(ctx: RunContext): Promise<void>`).
  - `src/application/pipeline/run-context.ts` — Foundation's `RunContext` (`job`, `recordWarning(warning)`; Resolve added `resolvedIdentity` + `setResolvedIdentity()`). Summarise reads `ctx.job.id` and `ctx.resolvedIdentity.companyName` and calls `ctx.recordWarning(...)`; it never sets `resolvedIdentity`. Because Summarise runs **fifth / last**, Resolve has already populated `ctx.resolvedIdentity` (non-null) before Summarise runs.
  - `src/application/pipeline/stage-runner.ts` — Foundation's `StageRunner` (ordered, in-process, sequential). Summarise is registered **fifth / last**.
  - `src/application/search/ports/result-repository.port.ts` — **modify**: add the `SummariseResultRow` read-model + `findIncludedForSummary(jobId)` read method (Task 4).
  - `src/infrastructure/persistence/schema.ts` — **modify**: add the `summaries` table (Task 6). Foundation reserved `jobs` / `warnings` / `results` / `resolved_identity` but **no Summary storage**.
  - `src/infrastructure/persistence/result.repository.ts` — **modify**: implement `findIncludedForSummary` (Task 8).
  - `src/app-worker.module.ts` — **modify**: register the Summarise adapter + `SummaryRepository`, construct `SummariseStage`, register it fifth/last (Task 10).
- **Verify these upstream details against the implemented code before the first task that imports an upstream symbol (Task 1 imports `Warning`):**
  1. The exact import path/shape of `Warning` (`src/domain/job/warning.ts`) — adjust Task 1.
  2. The canonical source of the company name is **`ctx.resolvedIdentity.companyName`** — NOT `ctx.job.companyAnchorName`. Foundation's `CompanyAnchor` is a discriminated union whose `disambiguated` variant has no `name`, so the Job exposes no single reliable display name. Resolve's `ResolvedIdentity.companyName` is always present (precedence: canonical-brand → homepage-confirmed → anchor name). Summarise runs fifth / last, after Resolve, so `ctx.resolvedIdentity` is populated (non-null) by the time Summarise runs. Task 5's shell reads `ctx.resolvedIdentity.companyName`.
  3. The shape of `findIncluded` / `recordExclusion` already on `ResultRepository` (Filter + Analyze added them) and the exact `results` column names (`snippet`, `takeaway`, `sentiment`, `status`, `job_id`) — adjust Tasks 4 and 8.
  4. Foundation's Drizzle client type (postgres-js → `PostgresJsDatabase`) and the compose-Postgres test helper name (`withTestDatabase` here is a placeholder — use the project's actual helper) — adjust Tasks 7 and 8.
  5. The `jobs.id` column type/name for the `summaries.job_id` FK — adjust Task 6.
- **Test conventions (ADR 0008):** `*.test.ts` = unit / port-faked / pure, **no I/O**, part of `pnpm verify`. `*.integration.test.ts` = single-adapter against the **docker-compose Postgres** (NOT Testcontainers); needs `docker compose up`; not part of `pnpm verify`. Run unit/contract tests with `pnpm exec vitest run <path>` (a single test with `-t "<name>"`). Set `OTEL_SDK_DISABLED=true` in the test environment. `@anthropic-ai/sdk`, `zod`, `drizzle-orm`, `drizzle-kit`, `vitest` are all already in `package.json` — add nothing new.
- **Commit discipline:** one commit per task (after its tests pass). DRY, YAGNI, TDD red-green.

---

## Task 1: `Summary` value object + `summarySchema` (the one validated output)

**Files:**
- Create: `src/domain/summarise/summary.ts`
- Test: `src/domain/summarise/summary.test.ts`

> `summarySchema` is the **only** gate model output crosses. The adapter parses the structured response through it; nothing unvalidated and no raw model free-text ever reaches a stored field (anti-echo). The digest length cap is config-tunable — Task 2 carries the bound; the schema's own `max` is a hard ceiling so a runaway response can never reach the DB. Use a generous hard ceiling (4000) in the schema and let `SummariseConfig.digestMaxLength` (Task 2) be the tunable soft cap the adapter enforces.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/summarise/summary.test.ts
import { describe, it, expect } from "vitest";
import { summarySchema, type Summary } from "./summary";

describe("summarySchema", () => {
  it("accepts a trimmed, non-empty digest string", () => {
    const parsed = summarySchema.parse({ summary: "Aglow's coverage is broadly positive." });
    expect(parsed).toEqual({ summary: "Aglow's coverage is broadly positive." });
  });

  it("trims surrounding whitespace", () => {
    expect(summarySchema.parse({ summary: "  digest  " })).toEqual({ summary: "digest" });
  });

  it("rejects an empty or whitespace-only summary", () => {
    expect(summarySchema.safeParse({ summary: "" }).success).toBe(false);
    expect(summarySchema.safeParse({ summary: "   " }).success).toBe(false);
  });

  it("rejects an over-long summary (the hard ceiling)", () => {
    expect(summarySchema.safeParse({ summary: "x".repeat(4001) }).success).toBe(false);
  });

  it("strips unexpected extra fields (anti-echo: only the digest is kept)", () => {
    const parsed = summarySchema.parse({ summary: "digest", injected: "ignore me" } as never);
    expect(parsed).toEqual({ summary: "digest" });
    expect("injected" in parsed).toBe(false);
  });

  it("the inferred Summary type is { summary: string }", () => {
    const s: Summary = { summary: "digest" };
    expect(s.summary).toBe("digest");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/summary.test.ts`
Expected: FAIL — `Cannot find module './summary'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/summarise/summary.ts
import { z } from "zod";

/** The hard ceiling the schema enforces. The config-tunable soft cap (SummariseConfig.digestMaxLength)
 *  is enforced by the adapter; this ceiling guarantees a runaway response can never reach the DB. */
export const SUMMARY_HARD_MAX_LENGTH = 4000;

/**
 * The one Job-level digest (CONTEXT.md: the Result page's "Enhancement details summary", NEVER a
 * "result summary"). `summarySchema` is the ONLY gate model output crosses — `.strip()` drops any
 * extra fields so no raw model free-text leaks past the boundary (anti-echo). A re-run produces a
 * fresh Summary; there is never more than one live Summary for a Job.
 */
export const summarySchema = z
  .object({
    summary: z.string().trim().min(1).max(SUMMARY_HARD_MAX_LENGTH),
  })
  .strip();

export type Summary = z.infer<typeof summarySchema>; // { summary: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/summary.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/summarise/summary.ts src/domain/summarise/summary.test.ts
git commit -m "feat(summarise): add Summary value object + summarySchema (the one validated output)"
```

---

## Task 2: `SummariseInput` types + `selectSummariseInput` (the pure selection rule)

**Files:**
- Create: `src/domain/summarise/summarise-input.ts`
- Create: `src/domain/summarise/select-input.ts`
- Test: `src/domain/summarise/select-input.test.ts`

> The pure, exhaustively-testable core of the stage. `selectSummariseInput` takes the rows the repository returned (already `status = 'included'`-only by query — Task 4/8) and the target company name, and shapes the `SummariseInput`. It encodes two load-bearing invariants: **only `included` Results feed the digest** (asserted here against a mixed-status fixture, as defence-in-depth behind the SQL `WHERE status = 'included'`), and **empty input is detectable** (`items.length === 0`). It maps each surviving row to a `SummariseInputItem` preserving order, carries `companyName`, and is a `null`-tolerant pass-through for Enhancement fields. It does **not** decide failure-vs-Warning and does **not** call the model.

- [ ] **Step 1: Write the input-type module**

```ts
// src/domain/summarise/summarise-input.ts

/** One surviving (`included`) Result's contribution to the digest: its snippet plus its per-Result
 *  Enhancement. takeaway/sentiment are nullable — Enhance is Warning-tolerant, so a surviving Result
 *  whose Enhance failed appears here carrying its snippet with null Enhancement fields. */
export type SummariseInputItem = {
  readonly snippet: string;
  readonly takeaway: string | null;
  readonly sentiment: "positive" | "neutral" | "negative" | null;
};

/** The SummarisePort's input contract: the target company (for the digest's framing) + one item per
 *  surviving (`included`) Result. The digest is over snippets + Enhancements, NEVER full page text. */
export type SummariseInput = {
  readonly companyName: string;
  readonly items: readonly SummariseInputItem[];
};

/** The repository's read-model row for the summarise input — re-exported here so the domain selection
 *  rule depends on a shape, not on the application port. Mirrors `SummariseResultRow` (Task 4). */
export type SelectableResultRow = {
  readonly snippet: string;
  readonly takeaway: string | null;
  readonly sentiment: "positive" | "neutral" | "negative" | null;
  readonly status?: "included" | "excluded"; // present only in the defence-in-depth mixed-status fixture
};
```

- [ ] **Step 2: Write the failing test**

```ts
// src/domain/summarise/select-input.test.ts
import { describe, it, expect } from "vitest";
import { selectSummariseInput } from "./select-input";
import type { SelectableResultRow } from "./summarise-input";

const row = (over: Partial<SelectableResultRow> = {}): SelectableResultRow => ({
  snippet: "Aglow raised a seed round.",
  takeaway: "Aglow is growing.",
  sentiment: "positive",
  status: "included",
  ...over,
});

describe("selectSummariseInput", () => {
  it("shapes each surviving row into a SummariseInputItem and carries the company name", () => {
    const input = selectSummariseInput([row()], "Aglow");
    expect(input.companyName).toBe("Aglow");
    expect(input.items).toEqual([
      { snippet: "Aglow raised a seed round.", takeaway: "Aglow is growing.", sentiment: "positive" },
    ]);
  });

  it("includes a surviving row with null Enhancement fields as snippet-only", () => {
    const input = selectSummariseInput([row({ takeaway: null, sentiment: null })], "Aglow");
    expect(input.items).toEqual([{ snippet: "Aglow raised a seed round.", takeaway: null, sentiment: null }]);
  });

  it("only `included` rows feed the digest — Excluded rows never appear (defence in depth)", () => {
    const rows = [
      row({ snippet: "keep me", status: "included" }),
      row({ snippet: "tempting excluded snippet", takeaway: "do not digest me", status: "excluded" }),
      row({ snippet: "keep me too", status: "included" }),
    ];
    const input = selectSummariseInput(rows, "Aglow");
    expect(input.items.map((i) => i.snippet)).toEqual(["keep me", "keep me too"]);
  });

  it("preserves the repository's order", () => {
    const rows = [row({ snippet: "first" }), row({ snippet: "second" }), row({ snippet: "third" })];
    expect(selectSummariseInput(rows, "Aglow").items.map((i) => i.snippet)).toEqual(["first", "second", "third"]);
  });

  it("yields an empty items array for zero rows (the detectable empty case)", () => {
    expect(selectSummariseInput([], "Aglow").items).toHaveLength(0);
  });

  it("is pure: same inputs produce an equal output", () => {
    const rows = [row()];
    expect(selectSummariseInput(rows, "Aglow")).toEqual(selectSummariseInput(rows, "Aglow"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/select-input.test.ts`
Expected: FAIL — `Cannot find module './select-input'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/domain/summarise/select-input.ts
import type { SelectableResultRow, SummariseInput, SummariseInputItem } from "./summarise-input";

/**
 * Pure, no I/O. Shapes the repository's `included` rows into the SummarisePort's input. The repository
 * query (findIncludedForSummary) is the PRIMARY "Excluded Results never feed the digest" guarantee;
 * this rule is the SECOND line of defence — if a `status` is carried on a row, an `excluded` row is
 * dropped here too, so the guarantee holds at the domain boundary, not just in SQL. Order is preserved
 * verbatim. takeaway/sentiment are passed through (null-tolerant): a surviving Result with a missing
 * Enhancement is digested snippet-only and is never dropped for it.
 */
export function selectSummariseInput(rows: readonly SelectableResultRow[], companyName: string): SummariseInput {
  const items: SummariseInputItem[] = rows
    .filter((r) => r.status !== "excluded")
    .map((r) => ({ snippet: r.snippet, takeaway: r.takeaway, sentiment: r.sentiment }));
  return { companyName, items };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/select-input.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/summarise/summarise-input.ts src/domain/summarise/select-input.ts src/domain/summarise/select-input.test.ts
git commit -m "feat(summarise): pure input-selection rule (only `included` rows feed the digest)"
```

---

## Task 3: `SUMMARISE_WARNING` closed set + builders

**Files:**
- Create: `src/domain/summarise/summarise-warnings.ts`
- Test: `src/domain/summarise/summarise-warnings.test.ts`

> Two Warning types, namespaced under `summarise.`. `summariseEmpty` is the empty-case Warning that flags an all-Excluded Job `done_with_warnings` (an honest empty finding, never `failed`). `summariseFailed` collapses both production failures — adapter error and Zod-validation failure — into one type (indistinguishable to the reviewer; the distinction lives in telemetry, PRD 8). Each builder returns a fixed, **non-echoing** message — never raw snippet text, model output, or a provider error body. There is no Job-failing path. Confirm `Warning`'s import path against Foundation's `src/domain/job/warning.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/summarise/summarise-warnings.test.ts
import { describe, it, expect } from "vitest";
import { SUMMARISE_WARNING, summariseWarnings } from "./summarise-warnings";

describe("summarise warnings", () => {
  it("exposes the closed set of summarise warning types, namespaced under `summarise.`", () => {
    expect(Object.values(SUMMARISE_WARNING).sort()).toEqual(
      ["summarise.summarise_empty", "summarise.summarise_failed"].sort(),
    );
  });

  it("empty-case builder produces a non-empty message of the matching type", () => {
    const w = summariseWarnings.summariseEmpty();
    expect(w.type).toBe(SUMMARISE_WARNING.summariseEmpty);
    expect(w.message.length).toBeGreaterThan(0);
  });

  it("failed builder produces a non-empty message of the matching type", () => {
    const w = summariseWarnings.summariseFailed();
    expect(w.type).toBe(SUMMARISE_WARNING.summariseFailed);
    expect(w.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/summarise-warnings.test.ts`
Expected: FAIL — `Cannot find module './summarise-warnings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/summarise/summarise-warnings.ts
import type { Warning } from "../job/warning"; // adjust to Foundation's actual export path

export const SUMMARISE_WARNING = {
  summariseEmpty: "summarise.summarise_empty", // no surviving (`included`) Results — nothing to digest
  summariseFailed: "summarise.summarise_failed", // adapter error OR Zod-validation failure — Summary absent
} as const;

// Messages are fixed and NON-ECHOING — never raw snippet text, raw model output, or a provider error body.
// Both are partial-success notes: the reviewable list is intact, only the digest is missing.
export const summariseWarnings = {
  summariseEmpty: (): Warning => ({
    type: SUMMARISE_WARNING.summariseEmpty,
    message: "No in-scope coverage survived to digest; the Job-level Summary was not produced.",
  }),
  summariseFailed: (): Warning => ({
    type: SUMMARISE_WARNING.summariseFailed,
    message: "The Summarise digest could not be produced; the reviewable list is unaffected.",
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/domain/summarise/summarise-warnings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/summarise/summarise-warnings.ts src/domain/summarise/summarise-warnings.test.ts
git commit -m "feat(summarise): closed Summarise Warning set and non-echoing builders"
```

---

## Task 4: `SummarisePort` + `SummaryRepository` ports + `SummariseConfig` + `ResultRepository` read extension

**Files:**
- Create: `src/application/summarise/ports/summarise.port.ts`
- Create: `src/application/summarise/ports/summary-repository.port.ts`
- Create: `src/application/summarise/summarise-config.ts`
- Modify: `src/application/search/ports/result-repository.port.ts` (add `SummariseResultRow` + `findIncludedForSummary`)

These are pure interfaces / types / tokens (no runtime behaviour) — verification is a clean `tsc`, not a Vitest run.

> **Read `result-repository.port.ts` first.** Search declared `insertIncluded`; Filter added `findIncluded` + `recordExclusion`; Analyze added `setInterimMatchScore` / `setProvisionalContentType` / `applyFullTextOutcome`. Summarise adds **one read-only method** and its read-model type. It performs **no writes** to `results`. `findIncludedForSummary` is distinct from Filter's `findIncluded` because Summarise needs the Enhancement columns (`takeaway`, `sentiment`) Filter does not carry, and never needs `id` / `url` / `title` / `published_date`.

- [ ] **Step 1: Write the two new port files + the config**

```ts
// src/application/summarise/ports/summarise.port.ts
import type { Summary } from "../../../domain/summarise/summary";
import type { SummariseInput } from "../../../domain/summarise/summarise-input";

/** The one digest call's outcome. The adapter Zod-validates BEFORE returning `ok: true`; a transport /
 *  quota / SDK error AND a schema-validation failure both surface as `ok: false` — NEVER a throw. */
export type SummariseResult =
  | { ok: true; summary: Summary }
  | { ok: false };

/** ONE call per Job (the digest is Job-level, never per Result). Never throws — failure is a value. */
export interface SummarisePort {
  summarise(input: SummariseInput): Promise<SummariseResult>;
}

export const SUMMARISE_PORT = Symbol("SummarisePort");
```

```ts
// src/application/summarise/ports/summary-repository.port.ts
import type { Summary } from "../../../domain/summarise/summary";

/** The one-row-per-Job Summary store. */
export interface SummaryRepository {
  // Upserts the Job's single Summary row (job_id PK conflict → update). Idempotent / re-entrant.
  save(jobId: string, summary: Summary): Promise<void>;
  // PRD 7's per-Job read model. `null` = absent/degraded — the Result page renders it as "no digest".
  findByJobId(jobId: string): Promise<Summary | null>;
}

export const SUMMARY_REPOSITORY = Symbol("SummaryRepository");
```

```ts
// src/application/summarise/summarise-config.ts

export type SummariseConfig = {
  model: string;          // the Haiku model id (SUMMARISE_MODEL)
  timeoutMs: number;      // the per-call timeout (SUMMARISE_TIMEOUT_MS)
  digestMaxLength: number;// the tunable soft cap the adapter enforces (SUMMARISE_DIGEST_MAX_LENGTH); ≤ SUMMARY_HARD_MAX_LENGTH
};

export const SUMMARISE_CONFIG = Symbol("SummariseConfig");
```

- [ ] **Step 2: Add the read extension to the shared `ResultRepository` port**

```ts
// src/application/search/ports/result-repository.port.ts (additions — merge into the existing interface)

/** Summarise's read-model: each surviving (`included`) Result's snippet + its Enhancement. No id/url/title. */
export type SummariseResultRow = {
  readonly snippet: string;
  readonly takeaway: string | null;                                 // Enhance's per-Result takeaway (nullable)
  readonly sentiment: "positive" | "neutral" | "negative" | null;   // Enhance's per-Result Sentiment (nullable)
};

// Add this method to the EXISTING `ResultRepository` interface (alongside insertIncluded / findIncluded /
// recordExclusion / setInterimMatchScore / setProvisionalContentType / applyFullTextOutcome):
//
//   // Summarise addition (read-only): only rows whose status = 'included' at the moment Summarise runs.
//   findIncludedForSummary(jobId: string): Promise<SummariseResultRow[]>;
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from the new port/config files. (If `tsc` reports `ResultDrizzleRepository` no longer satisfies `ResultRepository`, that is expected — Task 8 implements `findIncludedForSummary`. To keep the tree green between tasks, add the method to the interface here AND a throwing stub to the impl, replaced in Task 8; or accept a single red `tsc` between Task 4 and Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/application/summarise/ports/ src/application/summarise/summarise-config.ts src/application/search/ports/result-repository.port.ts
git commit -m "feat(summarise): declare SummarisePort / SummaryRepository / config + ResultRepository read extension"
```

---

## Task 5: `SummariseStage` orchestration (empty case, success, adapter-error, Zod-failure, one-per-Job)

**Files:**
- Create: `src/application/summarise/summarise.stage.ts`
- Test: `src/application/summarise/summarise.stage.test.ts`

> The only impure unit. `name = "summarise"` (the closed Stage-name set is `resolve | search | filter | analyze | summarise`). It is one read → empty-case Warning OR one model call → save Summary OR record Warning; strictly sequential, no concurrency, at most one model call per `run` (never per Result), and it **never** throws `JobFailedError`. Tested entirely with fakes. The company name comes from the Resolved Identity (`ctx.resolvedIdentity.companyName`), populated by Resolve, which runs first (see Prerequisites verification point 2). Adjust `ctx.job.id`, the `RunContext`/`createRunContext` helper, and the `Stage` import to Foundation's actual exports.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/summarise/summarise.stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { SummariseStage } from "./summarise.stage";
import { createRunContext } from "../pipeline/run-context"; // adjust to Foundation's helper
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity"; // Resolve's identity (companyName)
import { SUMMARISE_WARNING } from "../../domain/summarise/summarise-warnings";
import type { Summary } from "../../domain/summarise/summary";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import type { SummarisePort, SummariseResult } from "./ports/summarise.port";
import type { SummaryRepository } from "./ports/summary-repository.port";
import type { ResultRepository, SummariseResultRow } from "../search/ports/result-repository.port";

const SUMMARY: Summary = { summary: "Aglow's coverage is broadly positive." };

const row = (over: Partial<SummariseResultRow> = {}): SummariseResultRow => ({
  snippet: "Aglow raised a seed round.",
  takeaway: "Aglow is growing.",
  sentiment: "positive",
  ...over,
});

/** Minimal Resolved Identity exposing companyName — Resolve populates this before Summarise runs. */
const identity = (over: Partial<Parameters<typeof ResolvedIdentity.assemble>[0]> = {}) =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [], socialHandles: [], brandContext: null, nameCollisions: [], negativeBoost: "",
    ...over,
  });

/** A RunContext with the Resolved Identity set, exactly as the Search/Filter stage tests do — so
 *  `ctx.resolvedIdentity.companyName` resolves to "Aglow" (Resolve runs first; Summarise runs last). */
function makeCtx() {
  const ctx = createRunContext(makeRunningJob());
  ctx.setResolvedIdentity(identity());
  return ctx;
}

/** A fake repo: a settable `included` pool for reads + a one-row-per-Job upserting summaries store. */
function fakeRepos(pool: SummariseResultRow[]) {
  const saved = new Map<string, Summary>();
  const results: Pick<ResultRepository, "findIncludedForSummary"> = {
    findIncludedForSummary: vi.fn(async () => pool),
  };
  const summaries: SummaryRepository = {
    save: vi.fn(async (jobId: string, summary: Summary) => { saved.set(jobId, summary); }),
    findByJobId: vi.fn(async (jobId: string) => saved.get(jobId) ?? null),
  };
  return { results, summaries, saved };
}

const okPort = (summary: Summary): SummarisePort => ({ summarise: vi.fn(async (): Promise<SummariseResult> => ({ ok: true, summary })) });
const failPort = (): SummarisePort => ({ summarise: vi.fn(async (): Promise<SummariseResult> => ({ ok: false })) });

const make = (port: SummarisePort, r: ReturnType<typeof fakeRepos>) =>
  new SummariseStage(port, r.summaries, r.results as ResultRepository);

describe("SummariseStage", () => {
  it("has name 'summarise'", () => {
    const r = fakeRepos([]);
    expect(make(okPort(SUMMARY), r).name).toBe("summarise");
  });

  it("healthy digest: ≥1 surviving Result → exactly one summarise call → Summary saved once, no Warning", async () => {
    const r = fakeRepos([row(), row({ snippet: "second" })]);
    const port = okPort(SUMMARY);
    const ctx = makeCtx();
    await make(port, r).run(ctx);

    expect((port.summarise as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(r.summaries.save).toHaveBeenCalledTimes(1);
    expect(r.saved.get(ctx.job.id)).toEqual(SUMMARY);
    expect(ctx.job.warnings).toHaveLength(0);
  });

  it("never per-Result: the port is called at most once regardless of pool size", async () => {
    const r = fakeRepos([row(), row(), row(), row(), row()]);
    const port = okPort(SUMMARY);
    const ctx = makeCtx();
    await make(port, r).run(ctx);
    expect((port.summarise as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("the port receives only `included` rows' snippets+Enhancements (Excluded never feed it)", async () => {
    const r = fakeRepos([row({ snippet: "keep" }), row({ snippet: "keep too", takeaway: null, sentiment: null })]);
    const port = okPort(SUMMARY);
    const ctx = makeCtx();
    await make(port, r).run(ctx);
    const input = (port.summarise as ReturnType<typeof vi.fn>).mock.calls[0][0] as SummariseInput;
    expect(input.items.map((i) => i.snippet)).toEqual(["keep", "keep too"]);
    expect(input.items[1]).toEqual({ snippet: "keep too", takeaway: null, sentiment: null });
  });

  it("empty case: zero `included` Results → no summarise call, no save, one summarise_empty Warning", async () => {
    const r = fakeRepos([]);
    const port = okPort(SUMMARY);
    const ctx = makeCtx();
    await make(port, r).run(ctx);

    expect(port.summarise).not.toHaveBeenCalled();
    expect(r.summaries.save).not.toHaveBeenCalled();
    expect(ctx.job.warnings.map((w) => w.type)).toEqual([SUMMARISE_WARNING.summariseEmpty]);
  });

  it("adapter error: port returns { ok: false } → one summarise_failed Warning, Summary absent, no save", async () => {
    const r = fakeRepos([row()]);
    const ctx = makeCtx();
    await make(failPort(), r).run(ctx);

    expect(r.summaries.save).not.toHaveBeenCalled();
    expect(ctx.job.warnings.map((w) => w.type)).toEqual([SUMMARISE_WARNING.summariseFailed]);
  });

  it("Zod-validation failure: the adapter's typed { ok: false } is handled identically (summarise_failed)", async () => {
    // The application cannot tell an adapter error from a schema-validation failure — both are { ok: false }.
    const r = fakeRepos([row()]);
    const ctx = makeCtx();
    await make(failPort(), r).run(ctx);
    expect(ctx.job.warnings.map((w) => w.type)).toEqual([SUMMARISE_WARNING.summariseFailed]);
  });

  it("never throws JobFailedError on any shortfall (empty or failed)", async () => {
    const empty = fakeRepos([]);
    const ctx1 = makeCtx();
    await expect(make(okPort(SUMMARY), empty).run(ctx1)).resolves.toBeUndefined();

    const failed = fakeRepos([row()]);
    const ctx2 = makeCtx();
    await expect(make(failPort(), failed).run(ctx2)).resolves.toBeUndefined();
  });

  it("exactly one Summary per Job: a re-entrant run upserts (the fake enforces one row keyed by jobId)", async () => {
    const r = fakeRepos([row()]);
    const port = okPort(SUMMARY);
    const stage = make(port, r);
    const ctx = makeCtx();
    await stage.run(ctx);
    await stage.run(ctx); // re-entrant
    expect(r.saved.size).toBe(1);
    expect(r.saved.get(ctx.job.id)).toEqual(SUMMARY);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/summarise/summarise.stage.test.ts`
Expected: FAIL — `Cannot find module './summarise.stage'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/summarise/summarise.stage.ts
import type { Stage } from "../pipeline/stage.port";
import type { RunContext } from "../pipeline/run-context";
import type { ResultRepository } from "../search/ports/result-repository.port";
import type { SummarisePort } from "./ports/summarise.port";
import type { SummaryRepository } from "./ports/summary-repository.port";
import { selectSummariseInput } from "../../domain/summarise/select-input";
import { summariseWarnings } from "../../domain/summarise/summarise-warnings";

/**
 * The Summarise stage — fifth / last. One read of the `included` pool → empty-case Warning, OR one
 * Haiku call per Job → save the validated Summary, OR record a single failure Warning. It NEVER throws
 * JobFailedError, never sets ctx.resolvedIdentity, never writes to `results`, and never fetches a page.
 */
export class SummariseStage implements Stage {
  readonly name = "summarise";

  constructor(
    private readonly summarise: SummarisePort,
    private readonly summaries: SummaryRepository,
    private readonly results: ResultRepository,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    // 1. Read the surviving input (`included`-only by query).
    const rows = await this.results.findIncludedForSummary(ctx.job.id);
    const input = selectSummariseInput(rows, ctx.resolvedIdentity.companyName);

    // 2. Empty case — nothing to digest. The all-Excluded Job's `done_with_warnings` flag.
    if (input.items.length === 0) {
      ctx.recordWarning(summariseWarnings.summariseEmpty());
      return;
    }

    // 3. Digest — exactly ONE Haiku call per Job.
    const result = await this.summarise.summarise(input);

    // 4. Failure case — adapter error OR Zod-validation failure (both { ok: false }). Summary stays absent.
    if (!result.ok) {
      ctx.recordWarning(summariseWarnings.summariseFailed());
      return;
    }

    // 5. Success — persist the one validated Summary. No Warning.
    await this.summaries.save(ctx.job.id, result.summary);
  }
}
```

> The company name comes from the Resolved Identity (`ctx.resolvedIdentity.companyName`), which Resolve populates before Summarise runs (Resolve runs first; Summarise runs fifth / last). The test sets it up via `ctx.setResolvedIdentity(...)` exactly as the Search/Filter stage tests do.

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/application/summarise/summarise.stage.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/summarise/summarise.stage.ts src/application/summarise/summarise.stage.test.ts
git commit -m "feat(summarise): SummariseStage orchestration (empty / success / failure — never fails the Job)"
```

---

## Task 6: `summaries` table + `drizzle-kit` migration (one row per Job)

**Files:**
- Modify: `src/infrastructure/persistence/schema.ts` (add the `summaries` table)
- Create: migration via `drizzle-kit` (generated, then committed)

> **Read Foundation's current `schema.ts` first** to match its import style, the `jobs` table name, and `jobs.id`'s type/column name (the `summaries.job_id` FK target). Foundation reserved `jobs` / `warnings` / `results` / `resolved_identity` but **no Summary storage**. Add a **one-row-per-Job** `summaries` table — `job_id` as the **primary key** (not a surrogate id) structurally enforces one-Summary-per-Job: a second insert for the same Job is a key conflict, not a silent duplicate. A re-run is a new Job id with its own row. `summary` holds **only** the validated digest string (anti-echo).

- [ ] **Step 1: Add the `summaries` table to `schema.ts`**

```ts
// src/infrastructure/persistence/schema.ts (add this table definition; reuse Foundation's imports)
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
// `jobs` is already declared in this file by Foundation — reference it for the FK.

export const summaries = pgTable("summaries", {
  // One row per Job, owned by the Job. job_id is the PK (enforces one-Summary-per-Job structurally).
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  // The validated digest string ONLY — never raw model output, never snippet text (anti-echo).
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

> Match Foundation's actual column helpers (e.g. `timestamp(..., { withTimezone: true })` vs a custom `timestamptz`) and `jobs.id`'s type. If Foundation's `jobs` does not cascade elsewhere, `onDelete: "cascade"` here is still correct — it aligns a Job and its Summary's lifetimes. No change to `results`, `warnings`, or `resolved_identity`.

- [ ] **Step 2: Generate the migration**

Run: `pnpm exec drizzle-kit generate`
Expected: a new SQL migration under the configured migrations dir creating the `summaries` table (`job_id` uuid PK + FK → `jobs(id)` ON DELETE CASCADE, `summary` text NOT NULL, `created_at` timestamptz NOT NULL DEFAULT now()). No change to any existing table.

- [ ] **Step 3: Verify the migration applies against the compose Postgres**

Run (with `docker compose up` running — ADR 0008): `pnpm exec drizzle-kit migrate`
Expected: applies with no error; `\d summaries` shows the `job_id` PK and the FK to `jobs`.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/persistence/schema.ts <migrations dir>
git commit -m "feat(summarise): add one-row-per-Job summaries table (job_id PK/FK) + migration"
```

---

## Task 7: `SummaryRepository` (Drizzle) + compose-Postgres integration

**Files:**
- Create: `src/infrastructure/persistence/summary.repository.ts`
- Test: `src/infrastructure/persistence/summary.repository.integration.test.ts`

> ADR 0008: integration tests run against the **docker-compose Postgres**, NOT Testcontainers; suffix `*.integration.test.ts`; not part of `pnpm verify`. Reuse the project's existing test-DB helper that yields a Drizzle client + a `jobs`-row inserter (a Summary needs a Job FK) and isolates via a dedicated test DB / per-test cleanup. `save` is an upsert keyed by the `job_id` PK so a re-entrant run is idempotent; `findByJobId` maps a missing row to `null`. Align `summaries.jobId` / `summaries.summary` with Task 6's column names and the Drizzle client type with Foundation's `drizzle.module.ts`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/summary.repository.integration.test.ts
import { describe, it, expect } from "vitest";
import { withTestDatabase } from "./test-support/with-test-database"; // adjust to the project's helper
import { SummaryDrizzleRepository } from "./summary.repository";

describe("SummaryDrizzleRepository (compose Postgres)", () => {
  const db = withTestDatabase(); // compose DB + migrations; exposes db.client and db.insertJob

  it("round-trips a Summary keyed by job_id", async () => {
    const jobId = await db.insertJob();
    const repo = new SummaryDrizzleRepository(db.client);
    await repo.save(jobId, { summary: "Aglow coverage is positive." });
    expect(await repo.findByJobId(jobId)).toEqual({ summary: "Aglow coverage is positive." });
  });

  it("findByJobId returns null for a Job with no Summary (the degraded/absent reading)", async () => {
    const jobId = await db.insertJob();
    const repo = new SummaryDrizzleRepository(db.client);
    expect(await repo.findByJobId(jobId)).toBeNull();
  });

  it("a second save for the same Job upserts — one row, updated summary (one-per-Job PK invariant)", async () => {
    const jobId = await db.insertJob();
    const repo = new SummaryDrizzleRepository(db.client);
    await repo.save(jobId, { summary: "first digest" });
    await repo.save(jobId, { summary: "second digest (re-run)" });
    expect(await repo.findByJobId(jobId)).toEqual({ summary: "second digest (re-run)" });

    const rows = await db.client.execute(
      `select count(*)::int as n from summaries where job_id = '${jobId}'` as never,
    );
    const n = (rows as unknown as { rows: Array<{ n: number }> }).rows?.[0]?.n ?? (rows as never)[0].n;
    expect(n).toBe(1);
  });

  it("a re-run (new Job id) writes its own row, unaffected by another Job's Summary", async () => {
    const repo = new SummaryDrizzleRepository(db.client);
    const jobA = await db.insertJob();
    const jobB = await db.insertJob();
    await repo.save(jobA, { summary: "A digest" });
    await repo.save(jobB, { summary: "B digest" });
    expect(await repo.findByJobId(jobA)).toEqual({ summary: "A digest" });
    expect(await repo.findByJobId(jobB)).toEqual({ summary: "B digest" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (compose Postgres up): `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/summary.repository.integration.test.ts`
Expected: FAIL — `Cannot find module './summary.repository'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/persistence/summary.repository.ts
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"; // match Foundation's Drizzle client type
import type { SummaryRepository } from "../../application/summarise/ports/summary-repository.port";
import type { Summary } from "../../domain/summarise/summary";
import { summaries } from "./schema";

type Db = PostgresJsDatabase<Record<string, never>>; // align with Foundation's exported db type

export class SummaryDrizzleRepository implements SummaryRepository {
  constructor(private readonly db: Db) {}

  /** Upsert the Job's single Summary row. The job_id PK conflict target enforces one-per-Job; the
   *  upsert makes a re-entrant stage run idempotent (a re-read pool re-produces, save overwrites). */
  async save(jobId: string, summary: Summary): Promise<void> {
    await this.db
      .insert(summaries)
      .values({ jobId, summary: summary.summary })
      .onConflictDoUpdate({ target: summaries.jobId, set: { summary: summary.summary } });
  }

  /** Maps a missing row to null — the degraded/absent reading PRD 7 renders gracefully as "no digest". */
  async findByJobId(jobId: string): Promise<Summary | null> {
    const rows = await this.db
      .select({ summary: summaries.summary })
      .from(summaries)
      .where(eq(summaries.jobId, jobId))
      .limit(1);
    const row = rows[0];
    return row ? { summary: row.summary } : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (compose Postgres up): `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/summary.repository.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/summary.repository.ts src/infrastructure/persistence/summary.repository.integration.test.ts
git commit -m "feat(summarise): Drizzle SummaryRepository (upsert one-per-Job, null on absent)"
```

---

## Task 8: `findIncludedForSummary` (Drizzle) + compose-Postgres integration

**Files:**
- Modify: `src/infrastructure/persistence/result.repository.ts` (implement `findIncludedForSummary`)
- Test: `src/infrastructure/persistence/result.repository.summarise.integration.test.ts`

> No schema change — the `results` columns already exist (Foundation reserved `status` + `snippet`-bearing content; Search wrote `snippet`; Analyze wrote `takeaway` / `sentiment`). Implement **one read-only method** on the existing `ResultDrizzleRepository`. It returns **only** rows whose `status = 'included'` with their `snippet` / `takeaway` / `sentiment` — this query is the primary "Excluded Results never feed the digest" guarantee. Use the existing test-DB helper; you will need to insert `results` rows directly (or reuse Search's `insertIncluded` + Analyze's writes) and flip one to `excluded` via Filter's `recordExclusion`. Align column names with `schema.ts`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/result.repository.summarise.integration.test.ts
import { describe, it, expect } from "vitest";
import { withTestDatabase } from "./test-support/with-test-database"; // adjust to the project's helper
import { ResultDrizzleRepository } from "./result.repository";
import type { ResultInsert } from "../../application/search/ports/result-repository.port";

const insert = (over: Partial<ResultInsert> = {}): ResultInsert => ({
  url: "https://news.example/aglow-seed",
  normalizedUrl: "news.example/aglow-seed",
  title: "Aglow raises seed",
  snippet: "Aglow raised a seed round.",
  matchScore: 80,
  publishedDate: "2026-01-02",
  source: "tavily",
  ...over,
});

describe("ResultDrizzleRepository.findIncludedForSummary (compose Postgres)", () => {
  const db = withTestDatabase();

  it("returns only `included` rows with snippet + takeaway + sentiment; excludes every `excluded` row", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [
      insert({ url: "https://a/1", normalizedUrl: "a/1", snippet: "kept one" }),
      insert({ url: "https://a/2", normalizedUrl: "a/2", snippet: "kept two" }),
      insert({ url: "https://a/3", normalizedUrl: "a/3", snippet: "excluded one" }),
    ]);
    // Enhance writes takeaway + sentiment onto the surviving rows (Analyze's applyFullTextOutcome).
    const kept = await repo.findIncluded(jobId); // [{ id, url, title, snippet, publishedDate }]
    const byUrl = new Map(kept.map((r) => [r.url, r.id]));
    await repo.applyFullTextOutcome(byUrl.get("https://a/1") as string, {
      matchScore: 88, verificationStatus: "verified", contentType: "news_article",
      sentiment: "positive", takeaway: "Aglow is growing.",
    });
    // a/2 survives with NO Enhancement (Enhance Warned) → takeaway/sentiment NULL.
    // Exclude a/3 (off_topic) so it must NOT appear in the summarise input.
    await repo.recordExclusion(byUrl.get("https://a/3") as string, "off_topic", "LLM");

    const rows = await repo.findIncludedForSummary(jobId);
    expect(rows.map((r) => r.snippet).sort()).toEqual(["kept one", "kept two"]);
    const one = rows.find((r) => r.snippet === "kept one");
    expect(one).toEqual({ snippet: "kept one", takeaway: "Aglow is growing.", sentiment: "positive" });
    const two = rows.find((r) => r.snippet === "kept two");
    expect(two).toEqual({ snippet: "kept two", takeaway: null, sentiment: null });
  });

  it("returns [] for a Job whose every Result was Excluded (the empty case at the SQL boundary)", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [insert({ url: "https://b/1", normalizedUrl: "b/1" })]);
    const kept = await repo.findIncluded(jobId);
    await repo.recordExclusion(kept[0].id, "off_topic", "LLM");
    expect(await repo.findIncludedForSummary(jobId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (compose Postgres up): `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/result.repository.summarise.integration.test.ts`
Expected: FAIL — `repo.findIncludedForSummary is not a function` (method not implemented yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/persistence/result.repository.ts (add this method to the EXISTING ResultDrizzleRepository)
import { and, eq } from "drizzle-orm"; // ensure `and` is imported alongside the existing `eq`/`desc`
import type { SummariseResultRow } from "../../application/search/ports/result-repository.port";
// `results` is already imported from "./schema" in this file.

  /**
   * Summarise's read: only rows whose status = 'included' at the moment Summarise runs, each carrying
   * its snippet + Enhancement (takeaway/sentiment, both nullable). This query is the primary
   * "Excluded Results never feed the digest" guarantee. Reads no url/title/published_date.
   */
  async findIncludedForSummary(jobId: string): Promise<SummariseResultRow[]> {
    const rows = await this.db
      .select({
        snippet: results.snippet,
        takeaway: results.takeaway,
        sentiment: results.sentiment,
      })
      .from(results)
      .where(and(eq(results.jobId, jobId), eq(results.status, "included")));
    return rows.map((r) => ({
      snippet: r.snippet,
      takeaway: r.takeaway ?? null,
      sentiment: (r.sentiment as SummariseResultRow["sentiment"]) ?? null,
    }));
  }
```

> Add `findIncludedForSummary` to the class (and remove any throwing stub left from Task 4). Confirm `results.snippet` / `results.takeaway` / `results.sentiment` / `results.status` / `results.jobId` are the exact column references in Foundation's `schema.ts`. If `sentiment` is a `pgEnum`, the select already yields the union; the `as` cast is a defensive narrow — drop it if the column type already matches.

- [ ] **Step 4: Run test to verify it passes**

Run (compose Postgres up): `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/persistence/result.repository.summarise.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/result.repository.ts src/infrastructure/persistence/result.repository.summarise.integration.test.ts
git commit -m "feat(summarise): implement findIncludedForSummary (included-only snippet+Enhancement read)"
```

---

## Task 9: Anthropic Haiku Summarise adapter (contract test, SDK stubbed)

**Files:**
- Create: `src/infrastructure/anthropic/summarise.adapter.ts`
- Test: `src/infrastructure/anthropic/summarise.adapter.test.ts`

> Wraps the `@anthropic-ai/sdk` for **one** `messages.create` per Job against **Haiku**. It owns all client specifics (model id + timeout from `SummariseConfig`), builds the prompt from the `SummariseInput` (snippets + each Result's takeaway/sentiment, framed by `companyName`) requesting a single coverage digest, and **parses the structured response through `summarySchema`**. On a valid parse → `{ ok: true, summary }`; on a transport / quota / SDK error, a timeout, **or** a schema-validation failure → `{ ok: false }`. It **never throws** above the port and **never** lets raw model free-text escape — only the schema-validated digest is returned (anti-echo). The contract test injects a fake matching `client.messages.create(...)`. Verify the exact structured-output mechanism (the project's other Haiku adapters use a JSON/tool-shaped response, per the Analyze spec) and align the response-block extraction with `@anthropic-ai/sdk@0.102.0`; the Zod gate below is the load-bearing guarantee regardless of the extraction shape. The `claude-api` skill is the reference for the current Haiku model ids.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/anthropic/summarise.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { SummariseAdapter } from "./summarise.adapter";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import type { SummariseConfig } from "../../application/summarise/summarise-config";

const config: SummariseConfig = { model: "claude-haiku-4-5-20251001", timeoutMs: 20000, digestMaxLength: 1200 };

const input: SummariseInput = {
  companyName: "Aglow",
  items: [
    { snippet: "Aglow raised a seed round.", takeaway: "Funding momentum.", sentiment: "positive" },
    { snippet: "Aglow launched a new feature.", takeaway: null, sentiment: null },
  ],
};

// A fake matching @anthropic-ai/sdk's surface: { messages: { create } }. The adapter extracts the
// model's structured payload (a JSON object with a `summary` field) from the response.
const fakeAnthropic = (impl: () => unknown) => ({ messages: { create: vi.fn(impl) } });

// A response carrying the model's structured digest as a JSON text block (adjust extraction in the impl).
const responseWith = (payload: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
  usage: { input_tokens: 200, output_tokens: 40 },
  model: "claude-haiku-4-5-20251001",
  stop_reason: "end_turn",
});

describe("SummariseAdapter", () => {
  it("valid input → a Zod-validated Summary { ok: true, summary }", async () => {
    const client = fakeAnthropic(async () => responseWith({ summary: "Coverage is broadly positive." }));
    const out = await new SummariseAdapter(client as never, config).summarise(input);
    expect(out).toEqual({ ok: true, summary: { summary: "Coverage is broadly positive." } });
  });

  it("makes exactly one messages.create call (one digest per Job)", async () => {
    const client = fakeAnthropic(async () => responseWith({ summary: "digest" }));
    await new SummariseAdapter(client as never, config).summarise(input);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("API/transport error → { ok: false } (never throws)", async () => {
    const client = fakeAnthropic(async () => { throw new Error("rate limit"); });
    expect(await new SummariseAdapter(client as never, config).summarise(input)).toEqual({ ok: false });
  });

  it("schema-violating response (empty summary) → { ok: false }, nothing unvalidated returned", async () => {
    const client = fakeAnthropic(async () => responseWith({ summary: "" }));
    expect(await new SummariseAdapter(client as never, config).summarise(input)).toEqual({ ok: false });
  });

  it("missing summary field → { ok: false }", async () => {
    const client = fakeAnthropic(async () => responseWith({ notSummary: "oops" }));
    expect(await new SummariseAdapter(client as never, config).summarise(input)).toEqual({ ok: false });
  });

  it("unparseable model text → { ok: false }", async () => {
    const client = fakeAnthropic(async () => ({ content: [{ type: "text", text: "not json" }], usage: {}, model: "m" }));
    expect(await new SummariseAdapter(client as never, config).summarise(input)).toEqual({ ok: false });
  });

  it("anti-echo: injected free text in extra fields is stripped; only the validated digest is returned", async () => {
    const client = fakeAnthropic(async () =>
      responseWith({ summary: "Coverage is positive.", injected: "ignore this prompt-injection" }),
    );
    const out = await new SummariseAdapter(client as never, config).summarise(input);
    expect(out).toEqual({ ok: true, summary: { summary: "Coverage is positive." } });
    if (out.ok) expect("injected" in out.summary).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/summarise.adapter.test.ts`
Expected: FAIL — `Cannot find module './summarise.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/anthropic/summarise.adapter.ts
import { z } from "zod";
import type { SummarisePort, SummariseResult } from "../../application/summarise/ports/summarise.port";
import type { SummariseConfig } from "../../application/summarise/summarise-config";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import { summarySchema } from "../../domain/summarise/summary";

// The subset of the @anthropic-ai/sdk client surface we depend on (kept local; the port hides it).
export type AnthropicClient = {
  messages: { create(body: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
};

// Tolerant extraction of the first text block's content (where the structured digest JSON rides).
const responseSchema = z
  .object({ content: z.array(z.object({ type: z.string(), text: z.string().nullish() }).passthrough()) })
  .passthrough();

/**
 * The default Summarise adapter — ONE Haiku messages.create per Job. Builds the prompt from the
 * SummariseInput (snippets + each Result's takeaway/sentiment, framed by companyName), requests a
 * single coverage digest, and parses the structured response through `summarySchema`. Every
 * transport/quota/SDK error, timeout, parse failure, OR schema-validation failure → { ok: false }.
 * NEVER throws above the port; only the schema-validated digest is ever returned (anti-echo).
 * (Tavily Research API not wired — deferred, ADR 0002, a future alternative adapter behind this port.)
 */
export class SummariseAdapter implements SummarisePort {
  constructor(
    private readonly client: AnthropicClient,
    private readonly config: SummariseConfig,
  ) {}

  async summarise(input: SummariseInput): Promise<SummariseResult> {
    try {
      const raw = await this.client.messages.create(
        {
          model: this.config.model,
          max_tokens: 1024,
          messages: [{ role: "user", content: this.buildPrompt(input) }],
        },
        { timeout: this.config.timeoutMs },
      );

      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return { ok: false };

      const text = parsed.data.content.find((b) => b.type === "text")?.text;
      if (!text) return { ok: false };

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return { ok: false };
      }

      const summary = summarySchema.safeParse(payload);
      if (!summary.success) return { ok: false };
      if (summary.data.summary.length > this.config.digestMaxLength) return { ok: false };
      return { ok: true, summary: summary.data };
    } catch {
      return { ok: false };
    }
  }

  /** Frames the surviving snippets + each Result's Enhancement; the digest is over snippets, NEVER
   *  full page text (ADR 0002). Requests a single JSON object: { "summary": "<one short digest>" }. */
  private buildPrompt(input: SummariseInput): string {
    const lines = input.items.map((item, i) => {
      const takeaway = item.takeaway ? ` Takeaway: ${item.takeaway}` : "";
      const sentiment = item.sentiment ? ` Sentiment: ${item.sentiment}` : "";
      return `${i + 1}. ${item.snippet}${takeaway}${sentiment}`;
    });
    return [
      `Write one short digest of what the coverage below, taken as a whole, says about "${input.companyName}".`,
      `Read across ALL items; do not summarise any single one. Keep it under ${this.config.digestMaxLength} characters.`,
      `Respond with ONLY a JSON object of the form {"summary": "<digest>"} and no other text.`,
      "",
      "Coverage:",
      ...lines,
    ].join("\n");
  }
}
```

> The structured-output mechanism (a JSON text block here) must match how the project's other Haiku adapters extract structured output — if Analyze's fused adapter uses a tool/`response_format`-shaped contract, mirror it. The load-bearing guarantee is invariant either way: the response is parsed through `summarySchema` and only the validated `Summary` is returned. The adapter emits GenAI call metadata (model id, token usage, finish reason) for PRD 8's child span but puts no raw prompt/completion/snippet text into any returned or persisted value (anti-echo).

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/infrastructure/anthropic/summarise.adapter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/anthropic/summarise.adapter.ts src/infrastructure/anthropic/summarise.adapter.test.ts
git commit -m "feat(summarise): Anthropic Haiku Summarise adapter (Zod-gated, fail-soft, anti-echo)"
```

---

## Task 10: DI wiring (register SummariseStage fifth / last)

**Files:**
- Modify: `src/app-worker.module.ts` (register the Summarise port + `SummaryRepository`, build `SummariseStage`, register it fifth/last in the `StageRunner`)
- Modify: `.env.example` (add `SUMMARISE_*` env keys)
- Test: `src/app-worker.module.test.ts` (extend the wiring test — assert Summarise is registered fifth/last)

> Read the worker module to see how the `StageRunner`'s ordered stage list is built (Resolve→Search→Filter→Analyze registered themselves in order). The goal: the runner is `[ResolveStage, SearchStage, FilterStage, AnalyzeStage, SummariseStage]` after this task. Register the Summarise adapter (→ `SUMMARISE_PORT`) — reusing the **existing Anthropic client** Search/Analyze wired (one `ANTHROPIC_API_KEY`) — the Drizzle `SummaryRepository` (→ `SUMMARY_REPOSITORY`), and a `SummariseConfig` provider from `@nestjs/config`. Construct `SummariseStage` from `SUMMARISE_PORT` + `SUMMARY_REPOSITORY` + the existing `RESULT_REPOSITORY` provider (reused for `findIncludedForSummary` — no new Result repository).

- [ ] **Step 1: Write the failing wiring test**

```ts
// src/app-worker.module.test.ts (add this case alongside the existing stage-registration cases)
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { AppWorkerModule } from "./app-worker.module";
import { StageRunner } from "./application/pipeline/stage-runner"; // adjust to Foundation's export
import { SummariseStage } from "./application/summarise/summarise.stage";

describe("AppWorkerModule wiring — Summarise", () => {
  it("registers SummariseStage fifth / last in the pipeline", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppWorkerModule] })
      // override real Anthropic/DB providers with test doubles per the project's testing pattern
      .compile();
    const runner = moduleRef.get(StageRunner);
    expect(runner.stages).toHaveLength(5);
    expect(runner.stages[4]).toBeInstanceOf(SummariseStage);
    expect(runner.stages[4]?.name).toBe("summarise");
    expect(runner.stages.map((s) => s.name)).toEqual(["resolve", "search", "filter", "analyze", "summarise"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/app-worker.module.test.ts -t "Summarise"`
Expected: FAIL — `runner.stages` has length 4 / `stages[4]` undefined (`SummariseStage` not registered).

- [ ] **Step 3: Wire the worker module + `.env.example`**

In `src/app-worker.module.ts`, add the providers and extend the `StageRunner`'s ordered list. Reuse the existing Anthropic client and `RESULT_REPOSITORY` provider; build the Drizzle `SummaryRepository` from Foundation's DB connection.

```ts
// src/app-worker.module.ts (sketch — merge into the existing module)
import { ConfigService } from "@nestjs/config";
import { SummariseStage } from "./application/summarise/summarise.stage";
import { SummariseAdapter } from "./infrastructure/anthropic/summarise.adapter";
import { SummaryDrizzleRepository } from "./infrastructure/persistence/summary.repository";
import { SUMMARISE_PORT } from "./application/summarise/ports/summarise.port";
import { SUMMARY_REPOSITORY } from "./application/summarise/ports/summary-repository.port";
import { SUMMARISE_CONFIG, type SummariseConfig } from "./application/summarise/summarise-config";
import { RESULT_REPOSITORY } from "./application/search/ports/result-repository.port";
// ANTHROPIC_CLIENT and the DB token are the existing providers Search/Analyze/Foundation wired.

// providers (added):
// {
//   provide: SUMMARISE_CONFIG,
//   useFactory: (config: ConfigService): SummariseConfig => ({
//     model: config.get("SUMMARISE_MODEL") ?? "claude-haiku-4-5-20251001",
//     timeoutMs: Number(config.get("SUMMARISE_TIMEOUT_MS") ?? 20000),
//     digestMaxLength: Number(config.get("SUMMARISE_DIGEST_MAX_LENGTH") ?? 1200),
//   }),
//   inject: [ConfigService],
// },
// {
//   provide: SUMMARISE_PORT,
//   useFactory: (client, cfg: SummariseConfig) => new SummariseAdapter(client, cfg),
//   inject: [<ANTHROPIC_CLIENT token>, SUMMARISE_CONFIG],
// },
// {
//   provide: SUMMARY_REPOSITORY,
//   useFactory: (db) => new SummaryDrizzleRepository(db),
//   inject: [<DB token>],
// },
// {
//   provide: SummariseStage,
//   useFactory: (port, summaries, results) => new SummariseStage(port, summaries, results),
//   inject: [SUMMARISE_PORT, SUMMARY_REPOSITORY, RESULT_REPOSITORY],
// },
//
// Extend the StageRunner factory to [ResolveStage, SearchStage, FilterStage, AnalyzeStage, SummariseStage]:
// {
//   provide: StageRunner,
//   useFactory: (resolve, search, filter, analyze, summarise) =>
//     new StageRunner([resolve, search, filter, analyze, summarise]),
//   inject: [ResolveStage, SearchStage, FilterStage, AnalyzeStage, SummariseStage],
// },
```

Add to `.env.example` (under the existing Anthropic/Analyze keys — `ANTHROPIC_API_KEY` already exists):

```
# --- Summarise stage (Job-level digest) ---
SUMMARISE_MODEL=claude-haiku-4-5-20251001   # the Haiku model id for the one-per-Job digest call
SUMMARISE_TIMEOUT_MS=20000                  # per-call timeout for the digest
SUMMARISE_DIGEST_MAX_LENGTH=1200            # soft cap on the digest length (≤ the schema hard ceiling)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTEL_SDK_DISABLED=true pnpm exec vitest run src/app-worker.module.test.ts -t "Summarise"`
Expected: PASS — `runner.stages[4]` is a `SummariseStage` with `name === "summarise"` and the list is the five named stages in order.

- [ ] **Step 5: Run the full unit suite + gates**

Run:
```bash
OTEL_SDK_DISABLED=true pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec biome check src
```
Expected: all unit/contract tests green, `tsc` clean, Biome clean, FTA per non-test file `OK`. (The `*.integration.test.ts` suites from Tasks 7 and 8 run separately against the compose Postgres — `docker compose up` then `pnpm exec vitest run <integration path>` — and are not part of this gate, per ADR 0008.)

- [ ] **Step 6: Commit**

```bash
git add src/app-worker.module.ts src/app-worker.module.test.ts .env.example
git commit -m "feat(summarise): wire SummariseStage fifth/last + SummaryRepository + Haiku DI"
```

---

## Task 11 (note): Optional Autoevals for digest faithfulness / groundedness

> **Not a task to implement now — a documented follow-up gauge, not a unit gate.** Per the spec's Testing strategy and PRD 6's Testing Decisions: a small graded Autoevals suite can check that a produced Summary is **faithful to and grounded in** the supplied snippets — no claims absent from the input, and the digest reflects the **aggregate** coverage rather than any one Result's takeaway. It runs in the eval harness against representative `SummariseInput` fixtures (the Aglow set), **out of the deterministic unit path** (it scores LLM quality, not control flow), so it never gates a per-task TDD loop or `pnpm verify`. File a follow-up issue (`bd`) to add it once the stage is wired and producing real digests. No code in this plan depends on it.

---

## Self-review (run after all tasks)

- **Spec coverage — every section of `2026-06-09-summarise-design.md` maps to a task:**
  - *Domain — `Summary` + `summarySchema`* → Task 1.
  - *Domain — `SummariseInputItem` / `SummariseInput`* → Task 2.
  - *Domain — `selectSummariseInput` (only `included`; Excluded never feed it; null-tolerant; order preserved; empty detectable)* → Task 2.
  - *Domain — `SUMMARISE_WARNING` closed set + non-echoing builders; no Job-failing path* → Task 3.
  - *Application — `SummarisePort` (`{ ok: true, summary } | { ok: false }`, never throws) + `SummariseConfig`* → Task 4.
  - *Application — `SummaryRepository` (`save` / `findByJobId`)* → Task 4.
  - *Application — `ResultRepository` read extension (`SummariseResultRow` + `findIncludedForSummary`)* → Task 4 (port) + Task 8 (impl).
  - *Application — `SummariseStage` orchestration (empty / success / adapter-error / Zod-failure / one-per-Job / never-per-Result / never JobFailedError)* → Task 5.
  - *Infrastructure — `summaries` table + migration (one row per Job, `job_id` PK/FK)* → Task 6.
  - *Infrastructure — Drizzle `SummaryRepository` (upsert one-per-Job; null on absent; re-run new id)* → Task 7.
  - *Infrastructure — `findIncludedForSummary` (included-only snippet+Enhancement read)* → Task 8.
  - *Infrastructure — Anthropic Haiku adapter (valid → validated Summary; API/Zod failure → typed `{ ok: false }`; anti-echo; one call)* → Task 9.
  - *Interface — DI wiring (SummariseStage FIFTH/last; SUMMARISE_PORT + SUMMARY_REPOSITORY providers; `SUMMARISE_*` env)* → Task 10.
  - *Optional Autoevals (faithfulness/groundedness) — follow-up gauge* → Task 11 (note).
  - *Observability seam, deferred to PRD 8* — honoured as the facts + anti-echo discipline across Tasks 1, 3, 9 (no spans built here).
  - *Out of scope (Tavily Research API; full-text digesting; the per-Result takeaway/sentiment as products; upstream stages; PRD 7 rendering; OTel emission)* — none implemented; the adapter doc-comment records the ADR 0002 re-entry note.
- **No placeholders:** every code step shows real, runnable code; every command shows expected FAIL-then-PASS output; `OTEL_SDK_DISABLED=true` is in every test command.
- **Type consistency:** `Summary` / `summarySchema` / `SUMMARY_HARD_MAX_LENGTH`, `SummariseInput` / `SummariseInputItem` / `SelectableResultRow`, `selectSummariseInput`, `SUMMARISE_WARNING` / `summariseWarnings`, `SummarisePort` / `SummariseResult` / `SUMMARISE_PORT`, `SummaryRepository` / `SUMMARY_REPOSITORY`, `SummariseConfig` / `SUMMARISE_CONFIG`, `SummariseResultRow` / `findIncludedForSummary`, `SummariseStage`, `SummaryDrizzleRepository`, `SummariseAdapter`, and the `summaries` table are each defined once and reused verbatim across tasks. The `sentiment` union `"positive" | "neutral" | "negative" | null` is identical in the domain item, the repository read-model, and the adapter input.
- **Open verification points (resolve during execution, not guesses):**
  1. `Warning`'s import path/shape (Task 1/3) — Foundation's `src/domain/job/warning.ts`.
  2. The company name comes from `ctx.resolvedIdentity.companyName` (Task 5) — the canonical source, populated by Resolve, which runs first (Summarise runs fifth / last). Confirm Resolve's `ResolvedIdentity.companyName` and `RunContext.setResolvedIdentity` exports; keep the stage and its test consistent.
  3. The existing `ResultRepository` methods + the exact `results` column names `snippet` / `takeaway` / `sentiment` / `status` / `job_id` (Tasks 4, 8); the `sentiment` column's type (pgEnum vs text).
  4. Foundation's Drizzle client type and the compose-Postgres test-DB helper name (`withTestDatabase` is a placeholder) (Tasks 7, 8).
  5. `jobs.id` column type/name for the `summaries.job_id` FK (Task 6); Foundation's `timestamp` helper style.
  6. The Anthropic structured-output extraction the project's other Haiku adapters use (JSON text block vs tool/`response_format`) (Task 9) — mirror it; the `summarySchema` gate is invariant.
  7. Whether `StageRunner` exposes its ordered list (`get stages()`); the existing stage-list factory in `app-worker.module.ts` (Task 10).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-summarise.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, with checkpoints.

Resolve the seven open verification points against the implemented Foundation + Search + Filter + Analyze before Task 1 (the first task importing an upstream symbol). Summarise depends on **all** of PRDs 1–5 being implemented — confirm `ResultRepository` exists with `findIncluded` / `recordExclusion`, that `results` carries `snippet` / `takeaway` / `sentiment`, and that the worker `StageRunner` already holds `[ResolveStage, SearchStage, FilterStage, AnalyzeStage]` before Task 5.
