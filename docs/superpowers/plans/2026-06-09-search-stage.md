# Search Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Search stage — the second pipeline stage — that turns a Job's `ResolvedIdentity` into a population of born-`included` Results (each with a provisional Match Score and a nullable Published Date) by running a few broad Tavily queries first and escalating, only on a thin yield, to the Angle Query set + a couple of long-tail type-targeted queries + the Anthropic web-search backstop. Title + snippet only; no page fetch; no dedup stage (a DB unique constraint does it); fails the Job only when every query across every source fails.

**Architecture:** Hexagonal on NestJS 11, inside Foundation's layering, after Resolve. Pure domain (URL normalizer, time-slice + query builder, escalation gate, provisional-score map, Warning set) + three application ports (Tavily Search, Anthropic web-search backstop, Result repository) + a `SearchStage implements Stage` orchestration shell. Adapters translate every transport failure into `{ hits: [], failed: true }` so partial failure is a Warning and only total failure (`JobFailedError`) fails the Job. Insert-time URL-dedup is the `(job_id, normalized_url)` unique constraint via `onConflictDoNothing`.

**Tech Stack:** TypeScript, NestJS 11, Zod, Drizzle/Postgres (postgres-js), `@tavily/core`, `@anthropic-ai/sdk` (`web_search` tool), Vitest (unit + contract + Testcontainers integration), Biome, FTA.

**Spec:** `docs/superpowers/specs/2026-06-09-search-stage-design.md`
**PRD:** `docs/prd/03-search-stage.md` · **ADRs:** 0002, 0004, 0005

---

## Prerequisites (read before starting)

- **Foundation (PRD 1) and Resolve (PRD 2) must be implemented.** This plan depends on and modifies their files: `src/domain/job/warning.ts` (`Warning` `{ type, message }`), `src/domain/job/job-errors.ts` (`JobFailedError`), `src/application/pipeline/stage.port.ts` (`Stage`), `src/application/pipeline/run-context.ts` (`RunContext` with the `resolvedIdentity` slot Resolve added), `src/application/pipeline/stage-runner.ts`, `src/application/ports/clock.port.ts` (the `Clock` port), `src/domain/resolve/resolved-identity.ts` (`ResolvedIdentity`), `src/infrastructure/persistence/schema.ts` (the reserved `results` table + `(job_id, normalized_url)` unique index), and `src/app-worker.module.ts`. If any is missing, stop and implement the upstream PRD first.
- **The input contract** is Resolve's `ResolvedIdentity` (read-only on `ctx.resolvedIdentity`): `companyName: string`, `ownDomains: readonly OwnDomain[]`, `socialHandles`, `brandContext: BrandContext | null`, `nameCollisions`, `negativeBoost`. Search reads it and **never** re-derives or re-chooses the company.
- **The write target** is Foundation's reserved `results` table. It already enforces born-`included` status and the `(job_id, normalized_url)` unique constraint. Search adds the coverage-content columns (Task 12) and writes provisional `match_score` only — never `verification_status`.
- **Test runner:** Foundation added `vitest` and `@testcontainers/postgresql`. Run unit tests with `pnpm exec vitest run <path>` and a single test with `-t "<name>"`. Set `OTEL_SDK_DISABLED=true` in the test environment. `@tavily/core` and `@anthropic-ai/sdk` are already in `package.json` dependencies.
- **Commit discipline:** one commit per task (after its tests pass). DRY, YAGNI, TDD.

---

## Task 1: `normalizeUrl` (the dedup key)

**Files:**
- Create: `src/domain/search/normalize-url.ts`
- Test: `src/domain/search/normalize-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/search/normalize-url.test.ts
import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("normalizeUrl", () => {
  it("lowercases host, strips scheme, www, default port, trailing slash and fragment", () => {
    expect(normalizeUrl("HTTPS://WWW.Example.com:443/Article/?#top")).toBe("example.com/Article");
    expect(normalizeUrl("http://example.com/")).toBe("example.com");
  });

  it("keeps distinct paths and meaningful query strings distinct", () => {
    expect(normalizeUrl("https://news.site/a")).not.toBe(normalizeUrl("https://news.site/b"));
    expect(normalizeUrl("https://site/p?id=1")).not.toBe(normalizeUrl("https://site/p?id=2"));
  });

  it("strips tracking params and sorts the remaining query", () => {
    expect(normalizeUrl("https://site/p?id=1&utm_source=x&gclid=y")).toBe(normalizeUrl("https://site/p?id=1"));
    expect(normalizeUrl("https://site/p?b=2&a=1")).toBe(normalizeUrl("https://site/p?a=1&b=2"));
  });

  it("normalizes two forms of the same article to the same key", () => {
    expect(normalizeUrl("https://www.site.com/story?utm_campaign=z")).toBe(normalizeUrl("http://site.com/story/"));
  });

  it("degrades a non-URL string without throwing", () => {
    expect(normalizeUrl("  Not A Url ")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/normalize-url.test.ts`
Expected: FAIL — `Cannot find module './normalize-url'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/search/normalize-url.ts

const TRACKING_PARAMS = [/^utm_/i, /^gclid$/i, /^fbclid$/i, /^ref$/i, /^mc_/i];

/**
 * Produces the value stored in `results.normalized_url` and compared by the `(job_id, normalized_url)`
 * unique constraint — the ONLY dedup mechanism Search owns (near-duplicate title Collapse is Filter's).
 * Lowercases the host, strips scheme/www/default-port/trailing-slash/fragment, drops tracking params,
 * and sorts the surviving query so two forms of one article collapse to one key. A non-URL degrades
 * to its trimmed, lowercased self rather than throwing.
 */
export function normalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return input.trim().toLowerCase();
  }

  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, ""); // drop trailing slash(es)

  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.some((p) => p.test(key)))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";

  return `${host}${path}${query}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/normalize-url.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/search/normalize-url.ts src/domain/search/normalize-url.test.ts
git commit -m "feat(search): add normalizeUrl dedup-key utility"
```

---

## Task 2: `buildTimeSlices` (12-month windows over 36 months — ADR 0005)

**Files:**
- Create: `src/domain/search/time-slice.ts`
- Test: `src/domain/search/time-slice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/search/time-slice.test.ts
import { describe, it, expect } from "vitest";
import { buildTimeSlices } from "./time-slice";

const NOW = new Date("2026-06-09T00:00:00.000Z");

describe("buildTimeSlices", () => {
  it("tiles 36 months back from now as 3 consecutive 12-month windows", () => {
    const slices = buildTimeSlices(NOW, 36, 12);
    expect(slices).toEqual([
      { startDate: "2025-06-09", endDate: "2026-06-09" },
      { startDate: "2024-06-09", endDate: "2025-06-09" },
      { startDate: "2023-06-09", endDate: "2024-06-09" },
    ]);
  });

  it("windows are contiguous and non-overlapping (each end == previous start)", () => {
    const slices = buildTimeSlices(NOW, 36, 12);
    expect(slices[0].startDate).toBe(slices[1].endDate);
    expect(slices[1].startDate).toBe(slices[2].endDate);
  });

  it("is deterministic for a pinned now", () => {
    expect(buildTimeSlices(NOW, 36, 12)).toEqual(buildTimeSlices(NOW, 36, 12));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/time-slice.test.ts`
Expected: FAIL — `Cannot find module './time-slice'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/search/time-slice.ts

/** One 12-month start/end window (ISO yyyy-mm-dd). A recall tactic — never the recency filter. */
export type TimeSlice = { readonly startDate: string; readonly endDate: string };

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const minusMonths = (from: Date, months: number): Date => {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

/**
 * ADR 0005: consecutive non-overlapping windows tiling `horizonMonths` backward from `now`
 * (default 3 × 12-month windows over 36 months). `now` is injected so the plan is deterministic
 * under test. Slices shape which window a query fishes; they Exclude nothing.
 */
export function buildTimeSlices(now: Date, horizonMonths = 36, windowMonths = 12): TimeSlice[] {
  const slices: TimeSlice[] = [];
  for (let offset = 0; offset < horizonMonths; offset += windowMonths) {
    slices.push({
      startDate: isoDate(minusMonths(now, offset + windowMonths)),
      endDate: isoDate(minusMonths(now, offset)),
    });
  }
  return slices;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/time-slice.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/search/time-slice.ts src/domain/search/time-slice.test.ts
git commit -m "feat(search): build 12-month Time Slice windows over the 36-month horizon (ADR 0005)"
```

---

## Task 3: `SearchQuery` types + `buildQueryPlan` (the pure builder)

**Files:**
- Create: `src/domain/search/search-query.ts`
- Create: `src/domain/search/query-plan.ts`
- Test: `src/domain/search/query-plan.test.ts`

- [ ] **Step 1: Write the value-type module**

```ts
// src/domain/search/search-query.ts
import type { TimeSlice } from "./time-slice";

export type SearchQueryKind = "broad" | "angle" | "type_targeted";

export type SearchQuery = {
  readonly text: string;
  readonly kind: SearchQueryKind;
  readonly timeSlice: TimeSlice | null; // set only on news / press-release angle queries
};
```

- [ ] **Step 2: Write the failing test**

```ts
// src/domain/search/query-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildQueryPlan } from "./query-plan";
import { ResolvedIdentity } from "../resolve/resolved-identity";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const config = { horizonMonths: 36, windowMonths: 12 };

const richIdentity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [],
    brandContext: {
      tagline: "Beauty membership", mission: null, description: "Beauty startup", tags: ["beauty"],
      valueProposition: "Membership beauty", targetAudienceSegments: ["consumers"], productsAndServices: ["membership"],
    },
    nameCollisions: [],
    negativeBoost: "",
  });

const nameOnlyIdentity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow", ownDomains: [], socialHandles: [],
    brandContext: null, nameCollisions: [], negativeBoost: "",
  });

describe("buildQueryPlan", () => {
  it("always produces a broad set built from the company name", () => {
    const plan = buildQueryPlan(richIdentity(), NOW, config);
    expect(plan.broad.length).toBeGreaterThan(0);
    expect(plan.broad.every((q) => q.kind === "broad")).toBe(true);
    expect(plan.broad.some((q) => q.text.includes("Aglow"))).toBe(true);
    expect(plan.broad.every((q) => q.timeSlice === null)).toBe(true);
  });

  it("still yields a usable broad set for a name-only degraded identity", () => {
    const plan = buildQueryPlan(nameOnlyIdentity(), NOW, config);
    expect(plan.broad.length).toBeGreaterThan(0);
    expect(plan.broad.some((q) => q.text.includes("Aglow"))).toBe(true);
  });

  it("emits event-type angle queries unsliced", () => {
    const plan = buildQueryPlan(richIdentity(), NOW, config);
    const events = plan.angle.filter((q) => /funding|acquisition|partnership/.test(q.text));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((q) => q.timeSlice === null)).toBe(true);
  });

  it("emits news and press-release angles once per 12-month window with start/end dates", () => {
    const plan = buildQueryPlan(richIdentity(), NOW, config);
    const news = plan.angle.filter((q) => /news/i.test(q.text));
    expect(news).toHaveLength(3); // one per 12-month window over 36 months
    expect(news.every((q) => q.timeSlice !== null)).toBe(true);
    expect(news.map((q) => q.timeSlice?.endDate)).toContain("2026-06-09");

    const pr = plan.angle.filter((q) => /press release/i.test(q.text));
    expect(pr).toHaveLength(3);
    expect(pr.every((q) => q.timeSlice !== null)).toBe(true);
  });

  it("emits exactly the podcast and newsletter type-targeted long-tail", () => {
    const plan = buildQueryPlan(richIdentity(), NOW, config);
    const texts = plan.typeTargeted.map((q) => q.text);
    expect(plan.typeTargeted.every((q) => q.kind === "type_targeted")).toBe(true);
    expect(texts.some((t) => /podcast/i.test(t))).toBe(true);
    expect(texts.some((t) => /newsletter/i.test(t))).toBe(true);
  });

  it("is pure: same inputs produce an equal plan", () => {
    expect(buildQueryPlan(richIdentity(), NOW, config)).toEqual(buildQueryPlan(richIdentity(), NOW, config));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/query-plan.test.ts`
Expected: FAIL — `Cannot find module './query-plan'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/domain/search/query-plan.ts
import type { ResolvedIdentity } from "../resolve/resolved-identity";
import type { SearchQuery } from "./search-query";
import { buildTimeSlices } from "./time-slice";

export type QueryPlan = {
  readonly broad: readonly SearchQuery[];
  readonly angle: readonly SearchQuery[];
  readonly typeTargeted: readonly SearchQuery[];
};

export type QueryPlanConfig = { horizonMonths: number; windowMonths: number };

const EVENT_ANGLES = ["funding", "acquisition", "partnership", "launch"];
const SLICED_ANGLES = ["news", "press release"]; // date-reliable → Time Sliced (ADR 0005)
const RARE_TYPES = ["podcast", "newsletter"];

/**
 * Pure builder over the ResolvedIdentity (PRD story 21). Effort order: broad → angle → type-targeted.
 * The builder does NOT decide what runs — the stage runs broad always and the rest only on escalation.
 * `now` and config are injected so the entire plan is assertable.
 */
export function buildQueryPlan(identity: ResolvedIdentity, now: Date, config: QueryPlanConfig): QueryPlan {
  const name = identity.companyName;
  const positioning =
    identity.brandContext?.valueProposition ??
    identity.brandContext?.tagline ??
    identity.brandContext?.tags[0] ??
    null;

  const broad: SearchQuery[] = [
    { text: name, kind: "broad", timeSlice: null },
    { text: `"${name}" coverage`, kind: "broad", timeSlice: null },
  ];
  if (positioning) broad.push({ text: `"${name}" ${positioning}`, kind: "broad", timeSlice: null });

  const slices = buildTimeSlices(now, config.horizonMonths, config.windowMonths);
  const angle: SearchQuery[] = [
    ...EVENT_ANGLES.map((event): SearchQuery => ({ text: `"${name}" ${event}`, kind: "angle", timeSlice: null })),
    ...SLICED_ANGLES.flatMap((topic) =>
      slices.map((timeSlice): SearchQuery => ({ text: `"${name}" ${topic}`, kind: "angle", timeSlice })),
    ),
  ];

  const typeTargeted: SearchQuery[] = RARE_TYPES.map((type) => ({
    text: `"${name}" ${type}`,
    kind: "type_targeted",
    timeSlice: null,
  }));

  return { broad, angle, typeTargeted };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/query-plan.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/search/search-query.ts src/domain/search/query-plan.ts src/domain/search/query-plan.test.ts
git commit -m "feat(search): pure query builder (broad / angle / type-targeted) over Resolved Identity"
```

---

## Task 4: `shouldEscalate` (the low-yield gate)

**Files:**
- Create: `src/domain/search/escalation.ts`
- Test: `src/domain/search/escalation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/search/escalation.test.ts
import { describe, it, expect } from "vitest";
import { shouldEscalate } from "./escalation";

describe("shouldEscalate", () => {
  it("escalates when distinct broad Results are below the threshold", () => {
    expect(shouldEscalate(0, 10)).toBe(true);
    expect(shouldEscalate(9, 10)).toBe(true);
  });

  it("does not escalate at or above the threshold (boundary)", () => {
    expect(shouldEscalate(10, 10)).toBe(false);
    expect(shouldEscalate(25, 10)).toBe(false);
  });

  it("measures DISTINCT post-dedup Results, not raw hits (documented semantics)", () => {
    // The caller passes the count of rows actually inserted (post-URL-dedup). Many raw hits that
    // dedup down to 3 distinct Results still escalate against a threshold of 10.
    const distinctAfterDedup = 3;
    expect(shouldEscalate(distinctAfterDedup, 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/escalation.test.ts`
Expected: FAIL — `Cannot find module './escalation'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/search/escalation.ts

/**
 * The single low-yield gate (ADR 0002). `distinctBroadResults` is the count of Results ACTUALLY
 * inserted by the broad set (post-URL-dedup) — never raw hits returned: overlapping broad queries
 * return one story many times, and counting raw hits would let duplicates mask a thin run and
 * suppress the escalation a borderline company most needs. One scalar threshold authorises BOTH the
 * Angle/type-targeted expansion and the Anthropic backstop.
 */
export function shouldEscalate(distinctBroadResults: number, threshold: number): boolean {
  return distinctBroadResults < threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/escalation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/search/escalation.ts src/domain/search/escalation.test.ts
git commit -m "feat(search): low-yield escalation gate over distinct post-dedup Results (ADR 0002)"
```

---

## Task 5: Provisional Match Score (Tavily scaling + backstop floor)

**Files:**
- Create: `src/domain/search/provisional-score.ts`
- Test: `src/domain/search/provisional-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/search/provisional-score.test.ts
import { describe, it, expect } from "vitest";
import { tavilyProvisionalScore, BACKSTOP_PROVISIONAL_SCORE } from "./provisional-score";

describe("tavilyProvisionalScore", () => {
  it("scales Tavily's 0-1 relevance into the 0-100 Match Score key", () => {
    expect(tavilyProvisionalScore(0.9)).toBe(90);
    expect(tavilyProvisionalScore(0.123)).toBe(12);
    expect(tavilyProvisionalScore(1)).toBe(100);
  });

  it("never scores a returned hit at 0 (a returned hit has some relevance)", () => {
    expect(tavilyProvisionalScore(0)).toBe(1);
    expect(tavilyProvisionalScore(null)).toBe(1);
    expect(tavilyProvisionalScore(0.001)).toBe(1);
  });

  it("places the backstop floor strictly beneath every Tavily-scored row", () => {
    expect(BACKSTOP_PROVISIONAL_SCORE).toBe(0);
    expect(BACKSTOP_PROVISIONAL_SCORE).toBeLessThan(tavilyProvisionalScore(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/provisional-score.test.ts`
Expected: FAIL — `Cannot find module './provisional-score'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/search/provisional-score.ts

/**
 * A backstop hit has no native relevance, so it takes a fixed floor that sorts BENEATH every
 * Tavily-scored row until Verify ratchets it. Honest (least-provenanced rescue) and transient
 * (Verify's interim score replaces it within seconds).
 */
export const BACKSTOP_PROVISIONAL_SCORE = 0;

/**
 * The provisional rung of the three-stage Match Score ratchet (Verify writes interim then final).
 * Maps Tavily's native 0-1 relevance into the 0-100 ordering key; a RETURNED hit always scores ≥ 1.
 */
export function tavilyProvisionalScore(relevance: number | null): number {
  if (relevance === null || relevance <= 0) return 1;
  return Math.min(100, Math.max(1, Math.round(relevance * 100)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/provisional-score.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/search/provisional-score.ts src/domain/search/provisional-score.test.ts
git commit -m "feat(search): provisional Match Score (Tavily relevance + backstop floor)"
```

---

## Task 6: Search Warning closed set

**Files:**
- Create: `src/domain/search/search-warnings.ts`
- Test: `src/domain/search/search-warnings.test.ts`

> Confirm the import path/shape of `Warning` against Foundation's `src/domain/job/warning.ts`. If Foundation exports `Warning` from a different path, fix the import here and in later tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/search/search-warnings.test.ts
import { describe, it, expect } from "vitest";
import { SEARCH_WARNING, searchWarnings } from "./search-warnings";

describe("search warnings", () => {
  it("exposes the closed set of search warning types", () => {
    expect(Object.values(SEARCH_WARNING).sort()).toEqual(
      ["search.backstop_failed", "search.queries_partially_failed"].sort(),
    );
  });

  it("partial-failure builder records a count, never raw query text", () => {
    const w = searchWarnings.queriesPartiallyFailed(4);
    expect(w.type).toBe(SEARCH_WARNING.queriesPartiallyFailed);
    expect(w.message).toContain("4");
  });

  it("backstop-failed builder produces a non-empty message of the matching type", () => {
    const w = searchWarnings.backstopFailed();
    expect(w.type).toBe(SEARCH_WARNING.backstopFailed);
    expect(w.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/search/search-warnings.test.ts`
Expected: FAIL — `Cannot find module './search-warnings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/search/search-warnings.ts
import type { Warning } from "../job/warning";

export const SEARCH_WARNING = {
  queriesPartiallyFailed: "search.queries_partially_failed",
  backstopFailed: "search.backstop_failed",
} as const;

// Messages carry counts only — never raw query text, snippet text, or provider error bodies (anti-echo).
export const searchWarnings = {
  queriesPartiallyFailed: (failedCount: number): Warning => ({
    type: SEARCH_WARNING.queriesPartiallyFailed,
    message: `${failedCount} search query/queries failed; a partial sweep was returned.`,
  }),
  backstopFailed: (): Warning => ({
    type: SEARCH_WARNING.backstopFailed,
    message: "The Anthropic web-search backstop call failed during escalation; Tavily Results were still returned.",
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/search/search-warnings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/search/search-warnings.ts src/domain/search/search-warnings.test.ts
git commit -m "feat(search): closed Search Warning set and builders"
```

---

## Task 7: Ports + config (interfaces)

**Files:**
- Create: `src/application/search/ports/tavily-search.port.ts`
- Create: `src/application/search/ports/web-search-backstop.port.ts`
- Create: `src/application/search/ports/result-repository.port.ts`
- Create: `src/application/search/search-config.ts`

These are pure interfaces (no runtime behaviour) — verification is a clean `tsc`, not a Vitest run.

- [ ] **Step 1: Write the port interfaces, types, and DI tokens**

```ts
// src/application/search/ports/tavily-search.port.ts
import type { SearchQuery } from "../../../domain/search/search-query";

export type NormalizedHit = {
  url: string;
  title: string;
  snippet: string;
  relevance: number | null;     // Tavily's native 0-1 score; null for the backstop
  publishedDate: string | null; // nullable, from hit metadata (ADR 0005)
};

export type SearchSourceResult = {
  hits: NormalizedHit[];
  failed: boolean; // true ⇒ this call failed as a transport/quota error (Warning-grade)
};

/** Primary recall, always run. Never throws — failure surfaces as { hits: [], failed: true }. */
export interface TavilySearchPort {
  search(query: SearchQuery): Promise<SearchSourceResult>;
}

export const TAVILY_SEARCH_PORT = Symbol("TavilySearchPort");
```

```ts
// src/application/search/ports/web-search-backstop.port.ts
import type { SearchSourceResult } from "./tavily-search.port";

/** Escalation BACKSTOP only (Anthropic web_search). Invoked solely when the stage's gate authorises it. */
export interface WebSearchBackstopPort {
  search(companyName: string): Promise<SearchSourceResult>; // same normalized shape; relevance/date null
}

export const WEB_SEARCH_BACKSTOP_PORT = Symbol("WebSearchBackstopPort");
```

```ts
// src/application/search/ports/result-repository.port.ts
export type ResultSource = "tavily" | "web_search_backstop";

export type ResultInsert = {
  url: string;
  normalizedUrl: string;
  title: string;
  snippet: string;
  matchScore: number;           // provisional only
  publishedDate: string | null;
  source: ResultSource;
};

/** Writes born-`included` Results; insert-time URL-dedup is the DB unique constraint, not app code. */
export interface ResultRepository {
  // Skips rows that violate (job_id, normalized_url); returns the number ACTUALLY inserted (post-dedup).
  insertIncluded(jobId: string, results: readonly ResultInsert[]): Promise<number>;
}

export const RESULT_REPOSITORY = Symbol("ResultRepository");
```

```ts
// src/application/search/search-config.ts
export type SearchConfig = {
  lowYieldThreshold: number; // distinct broad Results below which escalation fires (~10, Aglow-tuned)
  horizonMonths: number;     // 36
  windowMonths: number;      // 12
};

export const SEARCH_CONFIG = Symbol("SearchConfig");
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from the new port/config files.

- [ ] **Step 3: Commit**

```bash
git add src/application/search/ports/ src/application/search/search-config.ts
git commit -m "feat(search): declare Tavily / web-search-backstop / Result-repository ports + config"
```

---

## Task 8: `toResultInsert` (pure NormalizedHit → ResultInsert)

**Files:**
- Create: `src/application/search/to-result-insert.ts`
- Test: `src/application/search/to-result-insert.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/application/search/to-result-insert.test.ts
import { describe, it, expect } from "vitest";
import { toResultInsert } from "./to-result-insert";
import type { NormalizedHit } from "./ports/tavily-search.port";
import { BACKSTOP_PROVISIONAL_SCORE } from "../../domain/search/provisional-score";

const hit = (over: Partial<NormalizedHit> = {}): NormalizedHit => ({
  url: "https://www.example.com/story/?utm_source=x",
  title: "Aglow raises a round",
  snippet: "Aglow announced funding...",
  relevance: 0.8,
  publishedDate: "2026-01-02",
  ...over,
});

describe("toResultInsert", () => {
  it("maps a Tavily hit: provisional score from relevance, normalized url, passed-through date", () => {
    const r = toResultInsert(hit(), "tavily");
    expect(r.matchScore).toBe(80);
    expect(r.normalizedUrl).toBe("example.com/story");
    expect(r.url).toBe("https://www.example.com/story/?utm_source=x");
    expect(r.publishedDate).toBe("2026-01-02");
    expect(r.source).toBe("tavily");
  });

  it("maps a backstop hit to the floor score and backstop source", () => {
    const r = toResultInsert(hit({ relevance: null, publishedDate: null }), "web_search_backstop");
    expect(r.matchScore).toBe(BACKSTOP_PROVISIONAL_SCORE);
    expect(r.publishedDate).toBeNull();
    expect(r.source).toBe("web_search_backstop");
  });

  it("never carries a verification status (Search writes provisional only)", () => {
    expect("verificationStatus" in toResultInsert(hit(), "tavily")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/search/to-result-insert.test.ts`
Expected: FAIL — `Cannot find module './to-result-insert'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/search/to-result-insert.ts
import type { NormalizedHit, SearchSourceResult } from "./ports/tavily-search.port";
import type { ResultInsert, ResultSource } from "./ports/result-repository.port";
import { normalizeUrl } from "../../domain/search/normalize-url";
import { tavilyProvisionalScore, BACKSTOP_PROVISIONAL_SCORE } from "../../domain/search/provisional-score";

/**
 * Pure mapping of a normalized hit + its source into an insertable born-`included` Result.
 * Tavily → provisional score from relevance; backstop → the fixed floor. Search writes the
 * provisional Match Score and the coverage facts only — no verification_status, type, or exclusion.
 */
export function toResultInsert(hit: NormalizedHit, source: ResultSource): ResultInsert {
  return {
    url: hit.url,
    normalizedUrl: normalizeUrl(hit.url),
    title: hit.title,
    snippet: hit.snippet,
    matchScore: source === "tavily" ? tavilyProvisionalScore(hit.relevance) : BACKSTOP_PROVISIONAL_SCORE,
    publishedDate: hit.publishedDate,
    source,
  };
}

/** Convenience: map a whole source result's hits. */
export function toResultInserts(result: SearchSourceResult, source: ResultSource): ResultInsert[] {
  return result.hits.map((h) => toResultInsert(h, source));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/search/to-result-insert.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/search/to-result-insert.ts src/application/search/to-result-insert.test.ts
git commit -m "feat(search): pure NormalizedHit → ResultInsert mapping with provisional score"
```

---

## Task 9: `SearchStage` orchestration (happy path, escalation, every failure path)

**Files:**
- Create: `src/application/search/search.stage.ts`
- Test: `src/application/search/search.stage.test.ts`

> The only impure unit. It composes the three ports + config + Foundation's `Clock`, threads through the broad-then-escalate flow, and decides Warning-vs-fail from how many calls succeeded. Tested entirely with fakes. Adjust `ctx.job.id`, `ctx.resolvedIdentity`, the `Clock` import, the `Stage` import, and `JobFailedError`'s import path to Foundation's actual exports.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/search/search.stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { SearchStage } from "./search.stage";
import { createRunContext } from "../pipeline/run-context";
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { SEARCH_WARNING } from "../../domain/search/search-warnings";
import { JobFailedError } from "../../domain/job/job-errors"; // adjust to Foundation's export
import type { NormalizedHit, SearchSourceResult, TavilySearchPort } from "./ports/tavily-search.port";
import type { WebSearchBackstopPort } from "./ports/web-search-backstop.port";
import type { ResultRepository, ResultInsert } from "./ports/result-repository.port";
import type { SearchConfig } from "./search-config";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const clock = { now: () => NOW };
const config: SearchConfig = { lowYieldThreshold: 10, horizonMonths: 36, windowMonths: 12 };

const identity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow", ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [], brandContext: null, nameCollisions: [], negativeBoost: "",
  });

const hits = (n: number, base = "https://site.example/a"): NormalizedHit[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `${base}${i}`, title: `t${i}`, snippet: `s${i}`, relevance: 0.5, publishedDate: null,
  }));

const ok = (h: NormalizedHit[]): SearchSourceResult => ({ hits: h, failed: false });
const fail = (): SearchSourceResult => ({ hits: [], failed: true });

/** A fake repo that enforces the (job_id, normalized_url) dedup and returns rows actually inserted. */
function fakeRepo() {
  const seen = new Set<string>();
  const rows: ResultInsert[] = [];
  return {
    rows,
    insertIncluded: vi.fn(async (_jobId: string, inserts: readonly ResultInsert[]) => {
      let inserted = 0;
      for (const r of inserts) {
        if (seen.has(r.normalizedUrl)) continue;
        seen.add(r.normalizedUrl);
        rows.push(r);
        inserted += 1;
      }
      return inserted;
    }),
  };
}

type Fakes = { tavily: TavilySearchPort; backstop: WebSearchBackstopPort; repo: ReturnType<typeof fakeRepo> };
const make = (f: Fakes) => new SearchStage(f.tavily, f.backstop, f.repo, config, clock);

describe("SearchStage", () => {
  it("has name 'search'", () => {
    const f = { tavily: { search: vi.fn(async () => ok([])) }, backstop: { search: vi.fn(async () => ok([])) }, repo: fakeRepo() };
    expect(make(f).name).toBe("search");
  });

  it("healthy yield: broad set meets the threshold → no escalation, no backstop, no warning", async () => {
    const f = {
      tavily: { search: vi.fn(async () => ok(hits(12))) }, // 12 distinct ≥ threshold 10
      backstop: { search: vi.fn(async () => ok(hits(5))) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx);

    // Only broad queries ran; backstop never called; angle/type-targeted never sent.
    expect(f.backstop.search).not.toHaveBeenCalled();
    expect(ctx.job.warnings).toHaveLength(0);
    // every Tavily call this run carried a broad query
    for (const call of (f.tavily.search as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0].kind).toBe("broad");
    }
  });

  it("thin yield: broad set below threshold → escalates angle + type-targeted + backstop", async () => {
    const f = {
      tavily: { search: vi.fn(async () => ok(hits(2))) }, // 2 distinct per query, dedups thin
      backstop: { search: vi.fn(async () => ok(hits(3, "https://rescue.example/r"))) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx);

    expect(f.backstop.search).toHaveBeenCalledWith("Aglow");
    const kinds = new Set((f.tavily.search as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].kind));
    expect(kinds.has("broad")).toBe(true);
    expect(kinds.has("angle")).toBe(true);
    expect(kinds.has("type_targeted")).toBe(true);
  });

  it("provisional score: Tavily rows get scaled relevance, backstop rows get the floor", async () => {
    const f = {
      tavily: { search: vi.fn(async () => ok([{ url: "https://t.example/1", title: "t", snippet: "s", relevance: 0.9, publishedDate: null }])) },
      backstop: { search: vi.fn(async () => ok([{ url: "https://b.example/1", title: "b", snippet: "s", relevance: null, publishedDate: null }])) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx); // 1 distinct broad < 10 → escalates → backstop runs

    const tavilyRow = f.repo.rows.find((r) => r.source === "tavily");
    const backstopRow = f.repo.rows.find((r) => r.source === "web_search_backstop");
    expect(tavilyRow?.matchScore).toBe(90);
    expect(backstopRow?.matchScore).toBe(0);
    expect(f.repo.rows.every((r) => !("verificationStatus" in r))).toBe(true);
  });

  it("partial failure: some queries fail but others succeed → one warning, Results still returned", async () => {
    let call = 0;
    const f = {
      tavily: { search: vi.fn(async () => (call++ % 2 === 0 ? ok(hits(15)) : fail())) },
      backstop: { search: vi.fn(async () => ok([])) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx);

    expect(ctx.job.warnings.map((w) => w.type)).toContain(SEARCH_WARNING.queriesPartiallyFailed);
    expect(f.repo.rows.length).toBeGreaterThan(0);
  });

  it("backstop failure on escalation: Tavily produced → backstop_failed warning, no Job failure", async () => {
    const f = {
      tavily: { search: vi.fn(async () => ok(hits(2))) }, // thin → escalate
      backstop: { search: vi.fn(async () => fail()) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx);
    expect(ctx.job.warnings.map((w) => w.type)).toContain(SEARCH_WARNING.backstopFailed);
  });

  it("total failure: every call across every source fails → throws JobFailedError", async () => {
    const f = {
      tavily: { search: vi.fn(async () => fail()) },
      backstop: { search: vi.fn(async () => fail()) },
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await expect(make(f).run(ctx)).rejects.toBeInstanceOf(JobFailedError);
  });

  it("insert-time dedup: a URL returned by two sources is inserted once and counted once", async () => {
    const dupe = [{ url: "https://dupe.example/x", title: "t", snippet: "s", relevance: 0.5, publishedDate: null }];
    const f = {
      tavily: { search: vi.fn(async () => ok(dupe)) }, // 1 distinct broad < 10 → escalate
      backstop: { search: vi.fn(async () => ok(dupe)) }, // same URL
      repo: fakeRepo(),
    };
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await make(f).run(ctx);
    expect(f.repo.rows.filter((r) => r.normalizedUrl === "dupe.example/x")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/search/search.stage.test.ts`
Expected: FAIL — `Cannot find module './search.stage'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/search/search.stage.ts
import type { Stage } from "../pipeline/stage.port";
import type { RunContext } from "../pipeline/run-context";
import type { Clock } from "../ports/clock.port"; // adjust to Foundation's Clock port path
import type { TavilySearchPort, SearchSourceResult } from "./ports/tavily-search.port";
import type { WebSearchBackstopPort } from "./ports/web-search-backstop.port";
import type { ResultRepository } from "./ports/result-repository.port";
import type { SearchConfig } from "./search-config";
import type { SearchQuery } from "../../domain/search/search-query";
import { buildQueryPlan } from "../../domain/search/query-plan";
import { shouldEscalate } from "../../domain/search/escalation";
import { searchWarnings } from "../../domain/search/search-warnings";
import { JobFailedError } from "../../domain/job/job-errors"; // adjust to Foundation's export
import { toResultInserts } from "./to-result-insert";

type CallTally = { succeeded: number; failed: number };

export class SearchStage implements Stage {
  readonly name = "search";

  constructor(
    private readonly tavily: TavilySearchPort,
    private readonly backstop: WebSearchBackstopPort,
    private readonly repo: ResultRepository,
    private readonly config: SearchConfig,
    private readonly clock: Clock,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    const identity = ctx.resolvedIdentity;
    if (identity === null) {
      // Programming/ordering fault: Resolve must run first. Let it become an unexpected throw.
      throw new Error("SearchStage requires a ResolvedIdentity (Resolve must run first)");
    }
    const jobId = ctx.job.id;
    const plan = buildQueryPlan(identity, this.clock.now(), this.config);
    const tally: CallTally = { succeeded: 0, failed: 0 };
    let backstopFailed = false;

    // 1. Broad set — always. Sum the rows ACTUALLY inserted (post-URL-dedup) = distinct broad Results.
    const broadResults = await Promise.all(plan.broad.map((q) => this.runTavily(jobId, q, tally)));
    const distinctBroad = broadResults.reduce((sum, n) => sum + n, 0);

    // 2. Gate — after the broad set has fully inserted and dedup settled (never mid-sweep).
    if (shouldEscalate(distinctBroad, this.config.lowYieldThreshold)) {
      const escalatedQueries = [...plan.angle, ...plan.typeTargeted];
      await Promise.all([
        ...escalatedQueries.map((q) => this.runTavily(jobId, q, tally)),
        this.runBackstop(jobId, identity.companyName, tally).then((failed) => {
          backstopFailed = failed;
        }),
      ]);
    }

    // 3. Outcome.
    if (tally.succeeded === 0) {
      // Nothing to show: every attempted call across every attempted source failed.
      throw new JobFailedError("All search queries across all sources failed");
    }
    if (tally.failed > 0) ctx.recordWarning(searchWarnings.queriesPartiallyFailed(tally.failed));
    if (backstopFailed) ctx.recordWarning(searchWarnings.backstopFailed());
  }

  private async runTavily(jobId: string, query: SearchQuery, tally: CallTally): Promise<number> {
    const result = await this.tavily.search(query);
    return this.absorb(jobId, result, "tavily", tally);
  }

  /** Returns true iff the backstop CALL failed (so the caller can raise the backstop_failed Warning). */
  private async runBackstop(jobId: string, companyName: string, tally: CallTally): Promise<boolean> {
    const result = await this.backstop.search(companyName);
    await this.absorb(jobId, result, "web_search_backstop", tally);
    return result.failed;
  }

  private async absorb(
    jobId: string,
    result: SearchSourceResult,
    source: "tavily" | "web_search_backstop",
    tally: CallTally,
  ): Promise<number> {
    if (result.failed) {
      tally.failed += 1;
      return 0;
    }
    tally.succeeded += 1;
    return this.repo.insertIncluded(jobId, toResultInserts(result, source));
  }
}
```

> The `backstopFailed` Warning and the partial-failure Warning both fire when the backstop call fails — that is intentional and matches the spec (a failed backstop call is one of the `tally.failed`, so `queriesPartiallyFailed` also counts it). If you prefer the backstop failure to be reported *only* as `backstop_failed`, do not count it in `tally.failed`; the test `backstop failure on escalation` only asserts `backstop_failed` is present, so either choice passes. Keep both for an honest failed-call count on the future span.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/search/search.stage.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/search/search.stage.ts src/application/search/search.stage.test.ts
git commit -m "feat(search): SearchStage orchestration (broad-then-escalate, Warning-vs-fail)"
```

---

## Task 10: Tavily Search adapter

**Files:**
- Create: `src/infrastructure/tavily/tavily.config.ts`
- Create: `src/infrastructure/tavily/tavily-search.adapter.ts`
- Test: `src/infrastructure/tavily/tavily-search.adapter.test.ts`

> The adapter owns all `@tavily/core` specifics. The contract test injects a fake client matching the `@tavily/core` `tavily({ apiKey }).search(query, opts)` shape — verify the exact client method/option names against the installed `@tavily/core@0.7.5` when wiring the real key; the Zod schema is tolerant but the field mapping (`score`→`relevance`, `publishedDate`/`published_date`, `content`/`snippet`) must match what the client returns. A `timeSlice` maps to the client's date parameters (`startDate`/`endDate` in `@tavily/core`).

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/tavily/tavily-search.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { TavilySearchAdapter } from "./tavily-search.adapter";
import type { SearchQuery } from "../../domain/search/search-query";

const broad: SearchQuery = { text: "Aglow", kind: "broad", timeSlice: null };
const sliced: SearchQuery = {
  text: '"Aglow" news', kind: "angle",
  timeSlice: { startDate: "2025-06-09", endDate: "2026-06-09" },
};

// A fake matching @tavily/core's client surface: { search(query, options) }.
const fakeClient = (impl: (q: string, o: unknown) => unknown) => ({ search: vi.fn(impl) });

describe("TavilySearchAdapter", () => {
  it("maps the client response to NormalizedHit", async () => {
    const client = fakeClient(async () => ({
      results: [
        { url: "https://site/a", title: "A", content: "snippet A", score: 0.91, publishedDate: "2026-01-01" },
        { url: "https://site/b", title: "B", content: "snippet B", score: 0.4, publishedDate: null },
      ],
    }));
    const adapter = new TavilySearchAdapter(client as never);
    const out = await adapter.search(broad);
    expect(out.failed).toBe(false);
    expect(out.hits).toEqual([
      { url: "https://site/a", title: "A", snippet: "snippet A", relevance: 0.91, publishedDate: "2026-01-01" },
      { url: "https://site/b", title: "B", snippet: "snippet B", relevance: 0.4, publishedDate: null },
    ]);
  });

  it("passes a Time Slice through as the client's date parameters", async () => {
    const client = fakeClient(async () => ({ results: [] }));
    await new TavilySearchAdapter(client as never).search(sliced);
    const [query, options] = client.search.mock.calls[0];
    expect(query).toBe('"Aglow" news');
    expect(options).toMatchObject({ startDate: "2025-06-09", endDate: "2026-06-09" });
  });

  it("returns { hits: [], failed: true } when the client throws", async () => {
    const client = fakeClient(async () => { throw new Error("quota"); });
    expect(await new TavilySearchAdapter(client as never).search(broad)).toEqual({ hits: [], failed: true });
  });

  it("returns { hits: [], failed: true } when the response fails to parse", async () => {
    const client = fakeClient(async () => ({ unexpected: true }));
    expect(await new TavilySearchAdapter(client as never).search(broad)).toEqual({ hits: [], failed: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/tavily/tavily-search.adapter.test.ts`
Expected: FAIL — `Cannot find module './tavily-search.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/tavily/tavily.config.ts
export type TavilyConfig = { apiKey: string; timeoutMs: number };
export const TAVILY_CONFIG = Symbol("TavilyConfig");
```

```ts
// src/infrastructure/tavily/tavily-search.adapter.ts
import { z } from "zod";
import type { TavilySearchPort, SearchSourceResult } from "../../application/search/ports/tavily-search.port";
import type { SearchQuery } from "../../domain/search/search-query";

// The subset of the @tavily/core client surface we depend on (kept local; the port hides it).
export type TavilyClient = {
  search(query: string, options?: Record<string, unknown>): Promise<unknown>;
};

const responseSchema = z
  .object({
    results: z.array(
      z
        .object({
          url: z.string(),
          title: z.string().nullish(),
          content: z.string().nullish(),
          snippet: z.string().nullish(),
          score: z.number().nullish(),
          publishedDate: z.string().nullish(),
          published_date: z.string().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Primary recall. Translates every transport/quota/parse failure into { hits: [], failed: true }. */
export class TavilySearchAdapter implements TavilySearchPort {
  constructor(private readonly client: TavilyClient) {}

  async search(query: SearchQuery): Promise<SearchSourceResult> {
    try {
      const options: Record<string, unknown> = {};
      if (query.timeSlice) {
        options.startDate = query.timeSlice.startDate;
        options.endDate = query.timeSlice.endDate;
      }
      const raw = await this.client.search(query.text, options);
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return { hits: [], failed: true };
      return {
        failed: false,
        hits: parsed.data.results.map((r) => ({
          url: r.url,
          title: r.title ?? "",
          snippet: r.content ?? r.snippet ?? "",
          relevance: r.score ?? null,
          publishedDate: r.publishedDate ?? r.published_date ?? null,
        })),
      };
    } catch {
      return { hits: [], failed: true };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/tavily/tavily-search.adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/tavily/tavily.config.ts src/infrastructure/tavily/tavily-search.adapter.ts src/infrastructure/tavily/tavily-search.adapter.test.ts
git commit -m "feat(search): Tavily Search adapter (normalize hits, Time Slice dates, fail-soft)"
```

---

## Task 11: Anthropic web-search backstop adapter

**Files:**
- Create: `src/infrastructure/anthropic/web-search-backstop.adapter.ts`
- Test: `src/infrastructure/anthropic/web-search-backstop.adapter.test.ts`

> Wraps the `@anthropic-ai/sdk` `web_search` server tool. The contract test injects a fake matching `client.messages.create(...)`. Verify the exact `web_search` tool name, the request shape, and the response content-block shape against the installed `@anthropic-ai/sdk@0.102.0` when wiring the real key (the SDK exposes web-search results as `web_search_tool_result` content blocks). The Zod schema below is tolerant; map the documented result fields (`url`, `title`, page text/snippet) into `NormalizedHit` with `relevance: null`, `publishedDate: null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/anthropic/web-search-backstop.adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { WebSearchBackstopAdapter } from "./web-search-backstop.adapter";

// Fake matching client.messages.create — returns content blocks including a web_search_tool_result.
const fakeAnthropic = (impl: () => unknown) => ({ messages: { create: vi.fn(impl) } });

describe("WebSearchBackstopAdapter", () => {
  it("maps web_search tool results to NormalizedHit with null relevance and date", async () => {
    const client = fakeAnthropic(async () => ({
      content: [
        { type: "text", text: "Here are results" },
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", url: "https://rescue/1", title: "Rescue 1", page_age: "2026" },
            { type: "web_search_result", url: "https://rescue/2", title: "Rescue 2" },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
    }));
    const out = await new WebSearchBackstopAdapter(client as never, "claude-haiku-4-5-20251001").search("Aglow");
    expect(out.failed).toBe(false);
    expect(out.hits).toEqual([
      { url: "https://rescue/1", title: "Rescue 1", snippet: "", relevance: null, publishedDate: null },
      { url: "https://rescue/2", title: "Rescue 2", snippet: "", relevance: null, publishedDate: null },
    ]);
  });

  it("returns { hits: [], failed: true } when the SDK throws", async () => {
    const client = fakeAnthropic(async () => { throw new Error("rate limit"); });
    expect(await new WebSearchBackstopAdapter(client as never, "m").search("Aglow")).toEqual({ hits: [], failed: true });
  });

  it("returns no hits (not a failure) when the model used no web_search tool", async () => {
    const client = fakeAnthropic(async () => ({ content: [{ type: "text", text: "no search" }], usage: {}, model: "m" }));
    const out = await new WebSearchBackstopAdapter(client as never, "m").search("Aglow");
    expect(out).toEqual({ hits: [], failed: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/anthropic/web-search-backstop.adapter.test.ts`
Expected: FAIL — `Cannot find module './web-search-backstop.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/anthropic/web-search-backstop.adapter.ts
import { z } from "zod";
import type { WebSearchBackstopPort } from "../../application/search/ports/web-search-backstop.port";
import type { SearchSourceResult } from "../../application/search/ports/tavily-search.port";

// The subset of the @anthropic-ai/sdk client surface we depend on (kept local; the port hides it).
export type AnthropicClient = {
  messages: { create(body: Record<string, unknown>): Promise<unknown> };
};

const resultBlockSchema = z
  .object({
    type: z.literal("web_search_tool_result"),
    content: z.array(
      z.object({ url: z.string(), title: z.string().nullish() }).passthrough(),
    ),
  })
  .passthrough();

const responseSchema = z.object({ content: z.array(z.unknown()) }).passthrough();

/**
 * Escalation BACKSTOP only. Issues one web_search-enabled message around the company name and
 * harvests result URLs/titles. Anthropic gives neither a relevance score nor a publish date, so both
 * are null. Emits no raw model text into any persisted/observable surface (anti-echo). Errors → failed.
 */
export class WebSearchBackstopAdapter implements WebSearchBackstopPort {
  constructor(
    private readonly client: AnthropicClient,
    private readonly model: string,
  ) {}

  async search(companyName: string): Promise<SearchSourceResult> {
    try {
      const raw = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          { role: "user", content: `Find recent third-party news and coverage about the company "${companyName}".` },
        ],
      });
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return { hits: [], failed: true };

      const hits = parsed.data.content.flatMap((block) => {
        const result = resultBlockSchema.safeParse(block);
        if (!result.success) return [];
        return result.data.content.map((r) => ({
          url: r.url,
          title: r.title ?? "",
          snippet: "",
          relevance: null,
          publishedDate: null,
        }));
      });
      return { hits, failed: false };
    } catch {
      return { hits: [], failed: true };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/anthropic/web-search-backstop.adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/anthropic/web-search-backstop.adapter.ts src/infrastructure/anthropic/web-search-backstop.adapter.test.ts
git commit -m "feat(search): Anthropic web-search backstop adapter (escalation recall rescue)"
```

---

## Task 12: `results` content columns + migration

**Files:**
- Modify: `src/infrastructure/persistence/schema.ts` (add the coverage-content columns Search writes)
- Create: migration via `drizzle-kit` (generated, then committed)

> **Read Foundation's current `schema.ts` first.** Foundation reserved `results` with `status` (default `included`), the closed `exclusion_code` set, the nullable stage columns (`match_score`, `verification_status`, `content_type`, `sentiment`, `takeaway`), and the `(job_id, normalized_url)` unique index. Add ONLY the columns that are missing: `url`, `title`, `snippet`, `published_date` (nullable), and the `source` enum. `normalized_url` and `match_score` already exist (Foundation created them). Do not redeclare existing columns or the unique index.

- [ ] **Step 1: Add the missing columns to the `results` table in `schema.ts`**

```ts
// src/infrastructure/persistence/schema.ts (extend Foundation's existing `results` table definition)
import { pgEnum } from "drizzle-orm/pg-core";

// New enum for Result provenance (telemetry / debugging only).
export const resultSourceEnum = pgEnum("result_source", ["tavily", "web_search_backstop"]);

// Add these columns to the EXISTING `results` pgTable definition (do not create a second table):
//   url:           text("url").notNull(),
//   title:         text("title").notNull().default(""),
//   snippet:       text("snippet").notNull().default(""),
//   publishedDate: date("published_date"),                 // nullable — ADR 0005 (never Excludes here)
//   source:        resultSourceEnum("source").notNull(),
// (normalizedUrl + the (job_id, normalized_url) unique index and match_score already exist from Foundation.)
```

> Import `date` from `drizzle-orm/pg-core` if Foundation didn't already. Keep `match_score` as Foundation declared it (likely `integer`/`numeric`, nullable — Search writes the provisional value into it).

- [ ] **Step 2: Generate the migration**

Run: `pnpm exec drizzle-kit generate`
Expected: a new SQL migration under the configured migrations dir adding `url`/`title`/`snippet`/`published_date`/`source` to `results` and creating the `result_source` enum.

- [ ] **Step 3: Verify the migration applies against a throwaway Postgres**

Run (Testcontainers covers this in Task 13; for a quick manual check use the dev DB): `pnpm exec drizzle-kit migrate`
Expected: applies with no error.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/persistence/schema.ts <migrations dir>
git commit -m "feat(search): add results coverage-content columns (url/title/snippet/published_date/source)"
```

---

## Task 13: `ResultRepository` (Drizzle) + Testcontainers integration

**Files:**
- Create: `src/infrastructure/persistence/result.repository.ts`
- Test: `src/infrastructure/persistence/result.repository.integration.test.ts`

> Mirrors Foundation's Testcontainers pattern. Reuse Foundation's test helper that boots Postgres, runs migrations, and yields a Drizzle client + a `jobs`-row inserter (a Result needs a Job FK). Align the Drizzle client type with Foundation's `drizzle.module.ts` (postgres-js → `PostgresJsDatabase`).

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/result.repository.integration.test.ts
import { describe, it, expect } from "vitest";
import { withTestDatabase } from "./test-support/with-test-database"; // adjust to Foundation's helper
import { ResultDrizzleRepository } from "./result.repository";
import type { ResultInsert } from "../../application/search/ports/result-repository.port";

const insert = (over: Partial<ResultInsert> = {}): ResultInsert => ({
  url: "https://www.example.com/story",
  normalizedUrl: "example.com/story",
  title: "Aglow funding",
  snippet: "Aglow raised...",
  matchScore: 80,
  publishedDate: "2026-01-02",
  source: "tavily",
  ...over,
});

describe("ResultDrizzleRepository (Testcontainers)", () => {
  const db = withTestDatabase(); // container + migrations; exposes db.client and db.insertJob

  it("inserts born-`included` Results carrying the provisional Match Score, no verification_status", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    const n = await repo.insertIncluded(jobId, [insert()]);
    expect(n).toBe(1);

    const rows = await db.client.execute(
      // raw read to assert persisted facts; adjust to Foundation's query style
      `select status, match_score, verification_status from results where job_id = '${jobId}'` as never,
    );
    const row = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows?.[0] ?? (rows as never)[0];
    expect(row.status).toBe("included");
    expect(Number(row.match_score)).toBe(80);
    expect(row.verification_status).toBeNull();
  });

  it("absorbs a duplicate (job_id, normalized_url) — inserted once, reported as 0 the second time", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    expect(await repo.insertIncluded(jobId, [insert()])).toBe(1);
    expect(await repo.insertIncluded(jobId, [insert({ title: "different title, same url" })])).toBe(0);
  });

  it("dedups across sources within one batch (same url from tavily and backstop) → one row", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    const n = await repo.insertIncluded(jobId, [insert(), insert({ source: "web_search_backstop", matchScore: 0 })]);
    expect(n).toBe(1);
  });

  it("orders by Match Score descending: Tavily rows above the backstop floor", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [
      insert({ url: "https://a/1", normalizedUrl: "a/1", matchScore: 0, source: "web_search_backstop" }),
      insert({ url: "https://b/1", normalizedUrl: "b/1", matchScore: 90 }),
    ]);
    const ordered = await repo.findOrderedByScore(jobId); // test-only read helper on the repo
    expect(ordered.map((r) => r.matchScore)).toEqual([90, 0]);
  });

  it("a re-run (new job id) writes its own rows; the prior Job's Results are unchanged", async () => {
    const repo = new ResultDrizzleRepository(db.client);
    const jobA = await db.insertJob();
    const jobB = await db.insertJob();
    await repo.insertIncluded(jobA, [insert({ url: "https://a/x", normalizedUrl: "a/x" })]);
    await repo.insertIncluded(jobB, [insert({ url: "https://b/y", normalizedUrl: "b/y" })]);
    expect(await repo.insertIncluded(jobA, [insert({ url: "https://a/x", normalizedUrl: "a/x" })])).toBe(0);
    expect((await repo.findOrderedByScore(jobB)).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/persistence/result.repository.integration.test.ts`
Expected: FAIL — `Cannot find module './result.repository'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/persistence/result.repository.ts
import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"; // match Foundation's Drizzle client type
import type { ResultRepository, ResultInsert } from "../../application/search/ports/result-repository.port";
import { results } from "./schema";

type Db = PostgresJsDatabase<Record<string, never>>; // align with Foundation's exported db type

export class ResultDrizzleRepository implements ResultRepository {
  constructor(private readonly db: Db) {}

  async insertIncluded(jobId: string, inserts: readonly ResultInsert[]): Promise<number> {
    if (inserts.length === 0) return 0;
    const inserted = await this.db
      .insert(results)
      .values(
        inserts.map((r) => ({
          jobId,
          url: r.url,
          normalizedUrl: r.normalizedUrl,
          title: r.title,
          snippet: r.snippet,
          matchScore: r.matchScore,
          publishedDate: r.publishedDate,
          source: r.source,
          // status defaults to `included`; verification_status/content_type/etc. stay NULL.
        })),
      )
      .onConflictDoNothing({ target: [results.jobId, results.normalizedUrl] })
      .returning({ id: results.id });
    return inserted.length;
  }

  /** Test-only read helper: Results for a Job ordered by Match Score descending. */
  async findOrderedByScore(jobId: string): Promise<Array<{ matchScore: number; source: string }>> {
    const rows = await this.db
      .select({ matchScore: results.matchScore, source: results.source })
      .from(results)
      .where(eq(results.jobId, jobId))
      .orderBy(desc(results.matchScore));
    return rows.map((r) => ({ matchScore: Number(r.matchScore), source: String(r.source) }));
  }
}
```

> Align `results.id`, `results.jobId`, `results.normalizedUrl`, and `results.matchScore` with Foundation's actual column names in `schema.ts`. If Foundation's `results` PK is a uuid named differently, adjust the `.returning(...)` projection. The `onConflictDoNothing` target must name the exact columns Foundation's unique index covers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/persistence/result.repository.integration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/result.repository.ts src/infrastructure/persistence/result.repository.integration.test.ts
git commit -m "feat(search): Drizzle ResultRepository with insert-time URL-dedup (onConflictDoNothing)"
```

---

## Task 14: DI wiring + config (register SearchStage as the second stage)

**Files:**
- Create: `src/infrastructure/search/search.module.ts` (provider wiring for the Tavily + Anthropic adapters and the Result repository)
- Modify: `src/app-worker.module.ts` (register the ports + build `SearchStage`, registered SECOND in the `StageRunner`)
- Modify: `.env.example` (add `TAVILY_*`, `ANTHROPIC_API_KEY`, `SEARCH_LOW_YIELD_THRESHOLD`)
- Test: `src/app-worker.module.test.ts` (extend Resolve's wiring test — assert Search is registered second)

> Read Foundation's + Resolve's `app-worker.module.ts` to see how the `StageRunner`'s ordered stage list is built (Resolve registered itself first). The goal: the worker's runner is `[ResolveStage, SearchStage]` after this task, with the three Search ports bound to their adapters and config from `@nestjs/config`. The Tavily client is constructed from `@tavily/core`'s `tavily({ apiKey })`; the Anthropic client from `new Anthropic({ apiKey })`.

- [ ] **Step 1: Write the failing wiring test**

```ts
// src/app-worker.module.test.ts (add this case alongside Resolve's)
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { AppWorkerModule } from "./app-worker.module";
import { StageRunner } from "./application/pipeline/stage-runner"; // adjust to Foundation's export
import { ResolveStage } from "./application/resolve/resolve.stage";
import { SearchStage } from "./application/search/search.stage";

describe("AppWorkerModule wiring — Search", () => {
  it("registers SearchStage as the second pipeline stage (after Resolve)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppWorkerModule] })
      // override real Tavily/Anthropic/DB providers with test doubles per the project's testing pattern
      .compile();
    const runner = moduleRef.get(StageRunner);
    expect(runner.stages[0]).toBeInstanceOf(ResolveStage);
    expect(runner.stages[1]).toBeInstanceOf(SearchStage);
    expect(runner.stages[1]?.name).toBe("search");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app-worker.module.test.ts -t "Search"`
Expected: FAIL — `SearchStage` not registered / `runner.stages[1]` undefined.

- [ ] **Step 3: Write the Search module and wire the worker module**

```ts
// src/infrastructure/search/search.module.ts
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { tavily } from "@tavily/core";
import Anthropic from "@anthropic-ai/sdk";
import { TavilySearchAdapter } from "../tavily/tavily-search.adapter";
import { WebSearchBackstopAdapter } from "../anthropic/web-search-backstop.adapter";
import { TAVILY_SEARCH_PORT } from "../../application/search/ports/tavily-search.port";
import { WEB_SEARCH_BACKSTOP_PORT } from "../../application/search/ports/web-search-backstop.port";
import { SEARCH_CONFIG } from "../../application/search/search-config";

@Module({
  providers: [
    {
      provide: TAVILY_SEARCH_PORT,
      useFactory: (config: ConfigService) =>
        new TavilySearchAdapter(tavily({ apiKey: config.getOrThrow("TAVILY_API_KEY") })),
      inject: [ConfigService],
    },
    {
      provide: WEB_SEARCH_BACKSTOP_PORT,
      useFactory: (config: ConfigService) =>
        new WebSearchBackstopAdapter(
          new Anthropic({ apiKey: config.getOrThrow("ANTHROPIC_API_KEY") }) as never,
          config.get("ANTHROPIC_BACKSTOP_MODEL") ?? "claude-haiku-4-5-20251001",
        ),
      inject: [ConfigService],
    },
    {
      provide: SEARCH_CONFIG,
      useFactory: (config: ConfigService) => ({
        lowYieldThreshold: Number(config.get("SEARCH_LOW_YIELD_THRESHOLD") ?? 10),
        horizonMonths: 36,
        windowMonths: 12,
      }),
      inject: [ConfigService],
    },
  ],
  exports: [TAVILY_SEARCH_PORT, WEB_SEARCH_BACKSTOP_PORT, SEARCH_CONFIG],
})
export class SearchModule {}
```

In `app-worker.module.ts`, import `SearchModule`, register the `RESULT_REPOSITORY` provider (the Drizzle impl, built from Foundation's DB connection), construct `SearchStage` from the three ports + config + Foundation's `Clock`, and register it **second** in the `StageRunner` (after `ResolveStage`):

```ts
// src/app-worker.module.ts (sketch — merge into the existing module)
import { SearchModule } from "./infrastructure/search/search.module";
import { SearchStage } from "./application/search/search.stage";
import { ResultDrizzleRepository } from "./infrastructure/persistence/result.repository";
import { RESULT_REPOSITORY } from "./application/search/ports/result-repository.port";
import { TAVILY_SEARCH_PORT } from "./application/search/ports/tavily-search.port";
import { WEB_SEARCH_BACKSTOP_PORT } from "./application/search/ports/web-search-backstop.port";
import { SEARCH_CONFIG } from "./application/search/search-config";
import { CLOCK } from "./application/ports/clock.port"; // adjust to Foundation's Clock token

// providers (added):
// { provide: RESULT_REPOSITORY, useFactory: (db) => new ResultDrizzleRepository(db), inject: [<DB token>] },
// {
//   provide: SearchStage,
//   useFactory: (tavily, backstop, repo, config, clock) => new SearchStage(tavily, backstop, repo, config, clock),
//   inject: [TAVILY_SEARCH_PORT, WEB_SEARCH_BACKSTOP_PORT, RESULT_REPOSITORY, SEARCH_CONFIG, CLOCK],
// },
// Build the StageRunner with [ResolveStage, SearchStage] (extend Resolve's [ResolveStage]):
// { provide: StageRunner, useFactory: (resolve, search) => new StageRunner([resolve, search]), inject: [ResolveStage, SearchStage] },
// imports: [SearchModule, <Foundation persistence module>, ConfigModule, ...]
```

Add to `.env.example`:

```
TAVILY_API_KEY=
TAVILY_TIMEOUT_MS=10000
ANTHROPIC_API_KEY=
ANTHROPIC_BACKSTOP_MODEL=claude-haiku-4-5-20251001
SEARCH_LOW_YIELD_THRESHOLD=10
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app-worker.module.test.ts -t "Search"`
Expected: PASS — `runner.stages[1]` is a `SearchStage` with `name === "search"`.

- [ ] **Step 5: Run the full suite + gates**

Run:
```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec biome check src
```
Expected: all green (unit + contract + Testcontainers integration), `tsc` clean, Biome clean. FTA per file `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/search/search.module.ts src/app-worker.module.ts src/app-worker.module.test.ts .env.example
git commit -m "feat(search): wire SearchStage as the second pipeline stage + Tavily/Anthropic DI"
```

---

## Self-review (run after all tasks)

- **Spec coverage:** every PRD user story maps to a task — broad-first sweep (T3, T9 story 1–2), automatic escalation on thin yield (T4, T9 story 3), angles-not-slices + the type-targeted exception (T3 stories 4–5), backstop on the same trigger + suppressed on a healthy yield (T9 stories 6–7), Time Slices only on news/PR (T2–T3 stories 8–9), provisional Match Score from Tavily relevance + backstop floor (T5, T8 story 10), title+snippet only / never fetch a page (the stage never retrieves page text — stories 11–12), born-`included` (T8/T13 story 13), insert-time URL-dedup via the unique constraint (T1, T13 stories 14, 25), Collapse explicitly out-of-stage (spec Out of Scope, story 15), single low-yield threshold governs both escalations (T4, T9 story 16), partial-failure Warning vs all-fail JobFailedError (T6, T9 stories 17–18), query builder derives from the Resolved Identity incl. name-only degraded (T3 stories 21–22), ports for unit/contract testability (T7, T10–T11 stories 23–24), escalation computed from yield already seen (T4, T9 story 26), Tavily Research kept out (spec Out of Scope, story 27). Observability stories 19–20 are honoured as the facts + anti-echo discipline; span emission is explicitly PRD 8 (spec Observability section).
- **No placeholders:** every code step shows real code; every command shows expected output.
- **Type consistency:** `TimeSlice`, `SearchQuery`/`SearchQueryKind`, `QueryPlan`, `NormalizedHit`, `SearchSourceResult`, `ResultInsert`/`ResultSource`, `SearchConfig`, `SEARCH_WARNING`, `BACKSTOP_PROVISIONAL_SCORE`, the three port symbols + `SEARCH_CONFIG`, and `normalizeUrl`/`tavilyProvisionalScore`/`shouldEscalate`/`buildQueryPlan`/`toResultInsert` are defined once and reused verbatim across tasks. `toResultInserts` (plural) is the batch helper used by the stage.
- **Open verification points (resolve during execution, not guesses):**
  1. Foundation's exact `Job` accessors (`id`, warnings list) and the `Warning` + `JobFailedError` import paths — adjust T6/T9.
  2. Foundation's `Clock` port path/token and `RunContext`/`createRunContext` (with Resolve's `setResolvedIdentity`) — adjust T9.
  3. Foundation's `results` table: which content columns already exist vs. which T12 must add; the exact unique-index columns for `onConflictDoNothing`; the `match_score` column type; the Drizzle client type (postgres-js → `PostgresJsDatabase`) and the test-DB helper name — adjust T12/T13.
  4. `@tavily/core@0.7.5` client method/option names (`search(query, { startDate, endDate })`) and response field names (`results[].score`/`content`/`publishedDate`) — confirm against the installed package; the Zod schema is tolerant but the mapping must match (T10).
  5. `@anthropic-ai/sdk@0.102.0` `web_search` tool type string (`web_search_20250305`) and the `web_search_tool_result` content-block shape — confirm against the installed SDK; map the documented result fields (T11). The `claude-api` skill is the reference for the current tool version + model ids.
  6. Whether `StageRunner` exposes its stage list (Resolve's plan added a read-only `get stages()` if not) — reuse it for T14.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-search-stage.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Resolve the six open verification points against the implemented Foundation + Resolve before starting Task 6 (the first task that imports an upstream symbol). Search depends on **both** PRD 1 and PRD 2 being implemented — confirm `ctx.resolvedIdentity` is populated by `ResolveStage` and that `results` exists with its unique index before Task 9.
