# Filter & Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Filter stage — the third pipeline stage — that soft-Excludes structurally-obvious noise from a Job's `included` Results (own-channel / aggregator / ecommerce-review / out-of-window heuristics) and then Collapses near-identical re-prints of one story to the earliest copy, all as pure deterministic logic with no network and no LLM, before any paid Verify/Extract/Enhance work begins.

**Architecture:** Hexagonal on NestJS 11, inside Foundation's layering, after Resolve and Search. Pure domain (host/eTLD+1 extraction, a maintained noise-host table, four heuristic predicates, a fixed-priority gate, title normalization, a distinctiveness gate, the Collapse clustering, a Warning set) + an extension to Search's `ResultRepository` port (`findIncluded` + idempotent `recordExclusion`) + a `FilterStage implements Stage` orchestration shell. No new outbound adapter, no new client, **no schema migration** — Filter writes only into `status`/`exclusion_code`/`exclusion_detail`, which Foundation reserved.

**Tech Stack:** TypeScript, NestJS 11, Drizzle/Postgres (postgres-js), Vitest (unit + Testcontainers integration), Biome, FTA.

**Spec:** `docs/superpowers/specs/2026-06-09-filter-collapse-design.md`
**PRD:** `docs/prd/04-filter-collapse.md` · **ADRs:** 0004, 0005

---

## Prerequisites (read before starting)

- **Foundation (PRD 1), Resolve (PRD 2), and Search (PRD 3) must be implemented.** This plan depends on and modifies their files: `src/domain/job/warning.ts` (`Warning` `{ type, message }`), `src/application/pipeline/stage.port.ts` (`Stage`), `src/application/pipeline/run-context.ts` (`RunContext` with `resolvedIdentity` + `recordWarning`), `src/application/pipeline/stage-runner.ts`, `src/application/ports/clock.port.ts` (`Clock` + its DI token), `src/domain/resolve/resolved-identity.ts` (`ResolvedIdentity` with `companyName`, `ownDomains: OwnDomain[]`, `socialHandles: SocialHandle[]`), `src/application/search/ports/result-repository.port.ts` (Search's `ResultRepository` + `ResultInsert`), `src/infrastructure/persistence/schema.ts` (the `results` table with `status` default `included`, the closed `exclusion_code` enum, nullable `exclusion_detail`, and Search's `url`/`title`/`snippet`/`published_date` columns), `src/infrastructure/persistence/result.repository.ts` (Search's `ResultDrizzleRepository`), and `src/app-worker.module.ts`. If any is missing, stop and implement the upstream PRD first.
- **The input contract** is Search's born-`included` Results (read via the repository) plus Resolve's `ResolvedIdentity` (read-only on `ctx.resolvedIdentity`). Filter **never** re-derives the company, never fetches, never calls an LLM.
- **The write target** is the existing `results` table. Filter performs **one** kind of write — `status: included → excluded` with an `exclusion_code` and a nullable `exclusion_detail`. **No migration is required** (Foundation reserved these columns; Search added the content columns). Confirm `exclusion_code`'s enum already includes `own_channel | aggregator | ecommerce_review | out_of_window | duplicate | off_topic` before Task 13.
- **Test runner:** Foundation added `vitest` and `@testcontainers/postgresql`. Run unit tests with `pnpm exec vitest run <path>` and a single test with `-t "<name>"`. Set `OTEL_SDK_DISABLED=true` in the test environment.
- **Commit discipline:** one commit per task (after its tests pass). DRY, YAGNI, TDD.

---

## Task 1: Filter type modules (`ExclusionCode`, `FilterResult`, `FilterConfig`)

**Files:**
- Create: `src/domain/filter/exclusion-code.ts`
- Create: `src/domain/filter/filter-result.ts`
- Create: `src/domain/filter/filter-config.ts`

These are pure types (no runtime behaviour) — verification is a clean `tsc`, not a Vitest run.

- [ ] **Step 1: Write the type modules**

```ts
// src/domain/filter/exclusion-code.ts

/** The closed Exclusion vocabulary (mirrors Foundation's Drizzle `exclusion_code` enum). */
export type ExclusionCode =
  | "own_channel"
  | "aggregator"
  | "ecommerce_review"
  | "out_of_window"
  | "duplicate"
  | "off_topic";

/** The subset Filter's heuristic pass may write (Collapse writes `duplicate`; `off_topic` is Verify's). */
export type HeuristicExclusionCode = "own_channel" | "ecommerce_review" | "aggregator" | "out_of_window";
```

```ts
// src/domain/filter/filter-result.ts

/** The read-model the heuristics + Collapse consume — exactly the Result fields Filter needs. */
export type FilterResult = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedDate: string | null; // ISO yyyy-mm-dd, or null
};
```

```ts
// src/domain/filter/filter-config.ts

/** Tuning for the deterministic rules; injected (never literals scattered through the predicates). */
export type FilterConfig = {
  horizonMonths: number;        // 36 — out_of_window
  collapseWindowDays: number;   // 14 — cluster window, anchored to the earliest member
  minDistinctiveTokens: number; // 5  — distinctiveness gate
  minClusterDomains: number;    // 2  — wire-syndication signature
};
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from the new type files.

- [ ] **Step 3: Commit**

```bash
git add src/domain/filter/exclusion-code.ts src/domain/filter/filter-result.ts src/domain/filter/filter-config.ts
git commit -m "feat(filter): declare ExclusionCode, FilterResult, and FilterConfig types"
```

---

## Task 2: `resultHost` + `registrableDomain` (pure host / eTLD+1 extraction)

**Files:**
- Create: `src/domain/filter/result-host.ts`
- Test: `src/domain/filter/result-host.test.ts`

> Filter keeps its **own** `registrableDomain` (distinct from Resolve's strip-`www`-only one) because Own Channel matching must include subdomains (`blog.getaglow.co` matches `getaglow.co`). A full Public-Suffix-List eTLD+1 is a noted deferred refinement; the multi-part-suffix set below is the pragmatic seed.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/result-host.test.ts
import { describe, it, expect } from "vitest";
import { resultHost, registrableDomain } from "./result-host";

describe("resultHost", () => {
  it("returns the lowercased host without port", () => {
    expect(resultHost("HTTPS://News.Example.com:443/a/b")).toBe("news.example.com");
  });
  it("degrades a non-URL to an empty string (never throws)", () => {
    expect(resultHost("not a url")).toBe("");
  });
});

describe("registrableDomain", () => {
  it("reduces a subdomain to its registrable parent", () => {
    expect(registrableDomain("blog.getaglow.co")).toBe("getaglow.co");
    expect(registrableDomain("www.getaglow.co")).toBe("getaglow.co");
    expect(registrableDomain("getaglow.co")).toBe("getaglow.co");
  });
  it("keeps three labels for a known multi-part public suffix", () => {
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/result-host.test.ts`
Expected: FAIL — `Cannot find module './result-host'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/result-host.ts

/** The lowercased host of a Result URL, no port. Degrades a non-URL to "" rather than throwing. */
export function resultHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Known multi-part public suffixes — seed list; a full PSL eTLD+1 is a deferred refinement.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "com.au", "net.au", "org.au", "co.nz",
  "co.za", "com.br", "co.jp", "co.in", "com.sg", "com.mx",
]);

/**
 * Registrable form (eTLD+1) so a subdomain matches its parent (blog.getaglow.co → getaglow.co).
 * Last two labels, or three when the host ends in a known multi-part suffix.
 */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const labels = h.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/result-host.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/result-host.ts src/domain/filter/result-host.test.ts
git commit -m "feat(filter): pure host + registrable-domain (eTLD+1) extraction"
```

---

## Task 3: `host-knowledge` (maintained noise-surface table + `accountKey`)

**Files:**
- Create: `src/domain/filter/host-knowledge.ts`
- Test: `src/domain/filter/host-knowledge.test.ts`

> The single, clearly-labelled home for the host/shape knowledge the rules lean on. New noise surfaces from evals are added **here**, never in the predicates. `AGGREGATOR_HOSTS` holds **full hosts** (matched after stripping `www.`); `ECOMMERCE_REVIEW_HOSTS` holds **registrable domains**. `accountKey` derives a stable `{ platform, id }` from any platform URL — the basis of the control-not-authorship Own Channel test.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/host-knowledge.test.ts
import { describe, it, expect } from "vitest";
import { AGGREGATOR_HOSTS, ECOMMERCE_REVIEW_HOSTS, accountKey } from "./host-knowledge";

describe("host knowledge sets", () => {
  it("holds aggregator full-hosts and ecommerce registrable-domains", () => {
    expect(AGGREGATOR_HOSTS.has("news.google.com")).toBe(true);
    expect(ECOMMERCE_REVIEW_HOSTS.has("amazon.com")).toBe(true);
    expect(ECOMMERCE_REVIEW_HOSTS.has("g2.com")).toBe(true);
  });
});

describe("accountKey", () => {
  it("derives a stable {platform,id} for each supported platform", () => {
    expect(accountKey("https://www.linkedin.com/company/getaglow")).toEqual({ platform: "linkedin", id: "getaglow" });
    expect(accountKey("https://x.com/getaglow")).toEqual({ platform: "x", id: "getaglow" });
    expect(accountKey("https://twitter.com/getaglow/status/123")).toEqual({ platform: "x", id: "getaglow" });
    expect(accountKey("https://www.instagram.com/aglow_app/")).toEqual({ platform: "instagram", id: "aglow_app" });
    expect(accountKey("https://getaglow.substack.com/p/post")).toEqual({ platform: "substack", id: "getaglow" });
    expect(accountKey("https://apps.apple.com/us/app/aglow/id123456789")).toEqual({ platform: "appstore", id: "id123456789" });
    expect(accountKey("https://play.google.com/store/apps/details?id=co.getaglow.app")).toEqual({ platform: "playstore", id: "co.getaglow.app" });
  });

  it("returns null for a non-platform URL", () => {
    expect(accountKey("https://businessnews.com.au/article/aglow-raises")).toBeNull();
    expect(accountKey("not a url")).toBeNull();
  });

  it("derives the same key from a Result URL and a scraped handle URL for one account", () => {
    expect(accountKey("https://x.com/getaglow/status/999")).toEqual(accountKey("https://x.com/getaglow"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/host-knowledge.test.ts`
Expected: FAIL — `Cannot find module './host-knowledge'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/host-knowledge.ts

// ── Aggregator / index / directory surfaces (matched against the FULL host, www stripped). ──
export const AGGREGATOR_HOSTS: ReadonlySet<string> = new Set([
  "news.google.com", "news.yahoo.com", "flipboard.com", "paper.li",
  "feedly.com", "scoop.it", "allsides.com", "smartnews.com",
]);

// ── Product / ecommerce / product-review / comparison surfaces (matched against the REGISTRABLE domain). ──
export const ECOMMERCE_REVIEW_HOSTS: ReadonlySet<string> = new Set([
  "amazon.com", "amazon.co.uk", "amazon.com.au", "ebay.com", "etsy.com",
  "g2.com", "capterra.com", "getapp.com", "trustpilot.com", "productreview.com.au",
]);

/** The account identity of a platform URL — same shape for a Result URL and a scraped handle URL. */
export type AccountKey = { readonly platform: string; readonly id: string };

/**
 * Derives a stable {platform, id} from any URL on a recognised third-party platform — the basis of
 * the Own Channel control-not-authorship test. A non-platform URL → null.
 */
export function accountKey(url: string): AccountKey | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);

  if (host === "linkedin.com" && segs[0] === "company" && segs[1]) return { platform: "linkedin", id: segs[1].toLowerCase() };
  if ((host === "x.com" || host === "twitter.com") && segs[0]) return { platform: "x", id: segs[0].toLowerCase() };
  if (host === "instagram.com" && segs[0]) return { platform: "instagram", id: segs[0].toLowerCase() };
  if (host === "facebook.com" && segs[0]) return { platform: "facebook", id: segs[0].toLowerCase() };
  if (host === "tiktok.com" && segs[0]?.startsWith("@")) return { platform: "tiktok", id: segs[0].slice(1).toLowerCase() };
  if (host.endsWith(".substack.com")) return { platform: "substack", id: host.slice(0, -".substack.com".length) };
  if (host === "apps.apple.com") {
    const idSeg = segs.find((s) => /^id\d+$/.test(s));
    if (idSeg) return { platform: "appstore", id: idSeg.toLowerCase() };
  }
  if (host === "play.google.com") {
    const pkg = u.searchParams.get("id");
    if (pkg) return { platform: "playstore", id: pkg.toLowerCase() };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/host-knowledge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/host-knowledge.ts src/domain/filter/host-knowledge.test.ts
git commit -m "feat(filter): maintained noise-host table + platform accountKey extractor"
```

---

## Task 4: `isOwnChannel` (control-not-authorship)

**Files:**
- Create: `src/domain/filter/own-channel.ts`
- Test: `src/domain/filter/own-channel.test.ts`

> The load-bearing rule: the test is *control of the surface*, not authorship. Verify the `ResolvedIdentity.assemble` shape against Resolve's actual export (`companyName`, `ownDomains: {domain, provenance}[]`, `socialHandles: {platform, handle, url}[]`, `brandContext`, `nameCollisions`, `negativeBoost`).

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/own-channel.test.ts
import { describe, it, expect } from "vitest";
import { isOwnChannel } from "./own-channel";
import { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";

const identity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [
      { platform: "instagram", handle: "aglow_app", url: "https://instagram.com/aglow_app" },
      { platform: "linkedin", handle: "getaglow", url: "https://www.linkedin.com/company/getaglow" },
    ],
    brandContext: null,
    nameCollisions: [],
    negativeBoost: "",
  });

const result = (url: string, over: Partial<FilterResult> = {}): FilterResult => ({
  id: "r1", url, title: "t", snippet: "s", publishedDate: null, ...over,
});

describe("isOwnChannel", () => {
  it("matches the company's own domain and its subdomains", () => {
    expect(isOwnChannel(result("https://getaglow.co/about"), identity())).toBe(true);
    expect(isOwnChannel(result("https://blog.getaglow.co/post"), identity())).toBe(true);
  });

  it("matches the company's named accounts on third-party platforms", () => {
    expect(isOwnChannel(result("https://www.instagram.com/aglow_app/"), identity())).toBe(true);
    expect(isOwnChannel(result("https://www.linkedin.com/company/getaglow"), identity())).toBe(true);
  });

  it("does NOT match a third party's post mentioning the company (control, not authorship)", () => {
    expect(isOwnChannel(result("https://x.com/some_journalist/status/123"), identity())).toBe(false);
    expect(isOwnChannel(result("https://instagram.com/a_customer"), identity())).toBe(false);
  });

  it("does NOT match a wire-distributed press release or a guest post on a third-party publication", () => {
    expect(isOwnChannel(result("https://www.prnewswire.com/news/aglow-raises"), identity())).toBe(false);
    expect(isOwnChannel(result("https://techcrunch.com/2026/01/02/aglow-guest-post"), identity())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/own-channel.test.ts`
Expected: FAIL — `Cannot find module './own-channel'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/own-channel.ts
import type { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";
import { resultHost, registrableDomain } from "./result-host";
import { accountKey } from "./host-knowledge";

/**
 * True iff the Result sits on a surface the company CONTROLS: one of its own domains (registrable
 * match, subdomains included) OR its named account on a recognised platform (by value-equal
 * account key). Authorship is NOT control — a press release, a guest post, or a third party's
 * post mentioning the company all fail both arms and stay in scope.
 */
export function isOwnChannel(result: FilterResult, identity: ResolvedIdentity): boolean {
  const host = resultHost(result.url);
  if (host !== "") {
    const rd = registrableDomain(host);
    if (identity.ownDomains.some((d) => registrableDomain(d.domain) === rd)) return true;
  }

  const key = accountKey(result.url);
  if (key !== null) {
    return identity.socialHandles.some((h) => {
      const hk = accountKey(h.url);
      return hk !== null && hk.platform === key.platform && hk.id === key.id;
    });
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/own-channel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/own-channel.ts src/domain/filter/own-channel.test.ts
git commit -m "feat(filter): own_channel control-not-authorship predicate"
```

---

## Task 5: `isEcommerceReview`

**Files:**
- Create: `src/domain/filter/ecommerce-review.ts`
- Test: `src/domain/filter/ecommerce-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/ecommerce-review.test.ts
import { describe, it, expect } from "vitest";
import { isEcommerceReview } from "./ecommerce-review";
import type { FilterResult } from "./filter-result";

const r = (url: string, snippet = ""): FilterResult => ({ id: "r", url, title: "t", snippet, publishedDate: null });

describe("isEcommerceReview", () => {
  it("matches known ecommerce / review hosts", () => {
    expect(isEcommerceReview(r("https://www.amazon.com/dp/B0001"))).toBe(true);
    expect(isEcommerceReview(r("https://www.g2.com/products/aglow/reviews"))).toBe(true);
  });
  it("matches product / cart path cues on any host", () => {
    expect(isEcommerceReview(r("https://shop.example.com/product/aglow-kit"))).toBe(true);
    expect(isEcommerceReview(r("https://store.example.com/checkout"))).toBe(true);
  });
  it("matches buy/rating snippet cues", () => {
    expect(isEcommerceReview(r("https://example.com/x", "Add to cart — in stock now"))).toBe(true);
  });
  it("does NOT match a genuine article on a news host", () => {
    expect(isEcommerceReview(r("https://businessnews.com.au/article/aglow-raises", "Aglow announced funding today"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/ecommerce-review.test.ts`
Expected: FAIL — `Cannot find module './ecommerce-review'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/ecommerce-review.ts
import type { FilterResult } from "./filter-result";
import { resultHost, registrableDomain } from "./result-host";
import { ECOMMERCE_REVIEW_HOSTS } from "./host-knowledge";

const PATH_CUES = /\/(dp|gp\/product|product|products|shop|store|cart|checkout|reviews?|compare)(\/|$)/i;
const SNIPPET_CUES = /\b(add to cart|buy now|in stock|out of stock|free shipping|customer reviews?|star rating)\b/i;

/** A place to buy or rate the product — not coverage about the company. Structural over host/path/snippet. */
export function isEcommerceReview(result: FilterResult): boolean {
  const host = resultHost(result.url);
  if (host !== "" && ECOMMERCE_REVIEW_HOSTS.has(registrableDomain(host))) return true;

  let path = "";
  try {
    path = new URL(result.url).pathname;
  } catch {
    path = "";
  }
  if (PATH_CUES.test(path)) return true;

  return SNIPPET_CUES.test(result.snippet);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/ecommerce-review.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/ecommerce-review.ts src/domain/filter/ecommerce-review.test.ts
git commit -m "feat(filter): ecommerce_review predicate (buy/rate surface, not coverage)"
```

---

## Task 6: `isAggregator`

**Files:**
- Create: `src/domain/filter/aggregator.ts`
- Test: `src/domain/filter/aggregator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/aggregator.test.ts
import { describe, it, expect } from "vitest";
import { isAggregator } from "./aggregator";
import type { FilterResult } from "./filter-result";

const r = (url: string): FilterResult => ({ id: "r", url, title: "t", snippet: "s", publishedDate: null });

describe("isAggregator", () => {
  it("matches known aggregator hosts (full host, www stripped)", () => {
    expect(isAggregator(r("https://news.google.com/articles/abc"))).toBe(true);
    expect(isAggregator(r("https://www.flipboard.com/topic/aglow"))).toBe(true);
  });
  it("matches directory / index structural cues", () => {
    expect(isAggregator(r("https://example.com/tag/aglow"))).toBe(true);
    expect(isAggregator(r("https://example.com/search?q=aglow"))).toBe(true);
  });
  it("does NOT match a genuine article on a news host", () => {
    expect(isAggregator(r("https://www.startupdaily.net/2026/01/aglow-funding"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/aggregator.test.ts`
Expected: FAIL — `Cannot find module './aggregator'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/aggregator.ts
import type { FilterResult } from "./filter-result";
import { resultHost } from "./result-host";
import { AGGREGATOR_HOSTS } from "./host-knowledge";

const DIR_CUES = /\/(topic|tag|tags|category|categories|directory|feed)(\/|$)|[?&]q=/i;

/** A link-aggregator / index / directory that re-lists rather than reporting. Conservative by design. */
export function isAggregator(result: FilterResult): boolean {
  const host = resultHost(result.url);
  if (host !== "" && AGGREGATOR_HOSTS.has(host.replace(/^www\./, ""))) return true;

  let pathAndQuery = "";
  try {
    const u = new URL(result.url);
    pathAndQuery = u.pathname + u.search;
  } catch {
    pathAndQuery = "";
  }
  return DIR_CUES.test(pathAndQuery);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/aggregator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/aggregator.ts src/domain/filter/aggregator.test.ts
git commit -m "feat(filter): aggregator predicate (re-lister, not reporter)"
```

---

## Task 7: `isOutOfWindow` (ADR 0005 recency precision backstop)

**Files:**
- Create: `src/domain/filter/out-of-window.ts`
- Test: `src/domain/filter/out-of-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/out-of-window.test.ts
import { describe, it, expect } from "vitest";
import { isOutOfWindow } from "./out-of-window";

const NOW = new Date("2026-06-09T00:00:00.000Z");

describe("isOutOfWindow", () => {
  it("excludes a date older than the 36-month horizon", () => {
    expect(isOutOfWindow("2022-01-01", NOW, 36)).toBe(true);
  });
  it("keeps a date inside the horizon", () => {
    expect(isOutOfWindow("2026-01-01", NOW, 36)).toBe(false);
    expect(isOutOfWindow("2023-07-01", NOW, 36)).toBe(false);
  });
  it("never excludes a NULL date (we don't guess a missing date into a rejection)", () => {
    expect(isOutOfWindow(null, NOW, 36)).toBe(false);
  });
  it("degrades an unparseable date to not-excluded", () => {
    expect(isOutOfWindow("not-a-date", NOW, 36)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/out-of-window.test.ts`
Expected: FAIL — `Cannot find module './out-of-window'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/out-of-window.ts

/**
 * ADR 0005: the recency PRECISION backstop. True when the Published Date is strictly older than
 * `now` minus `horizonMonths`. A NULL (or unparseable) date is NEVER excluded — symmetric with
 * Collapse's undated-copy rule. No network, no model.
 */
export function isOutOfWindow(publishedDate: string | null, now: Date, horizonMonths: number): boolean {
  if (publishedDate === null) return false;
  const published = Date.parse(publishedDate);
  if (Number.isNaN(published)) return false;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - horizonMonths);
  return published < cutoff.getTime();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/out-of-window.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/out-of-window.ts src/domain/filter/out-of-window.test.ts
git commit -m "feat(filter): out_of_window date predicate (NULL never excluded, ADR 0005)"
```

---

## Task 8: `heuristicExclusion` (the fixed-priority gate)

**Files:**
- Create: `src/domain/filter/heuristic-exclusion.ts`
- Test: `src/domain/filter/heuristic-exclusion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/heuristic-exclusion.test.ts
import { describe, it, expect } from "vitest";
import { heuristicExclusion } from "./heuristic-exclusion";
import { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";
import type { FilterConfig } from "./filter-config";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const config: FilterConfig = { horizonMonths: 36, collapseWindowDays: 14, minDistinctiveTokens: 5, minClusterDomains: 2 };

const identity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [],
    brandContext: null, nameCollisions: [], negativeBoost: "",
  });

const r = (over: Partial<FilterResult>): FilterResult => ({ id: "r", url: "https://x.example/a", title: "t", snippet: "s", publishedDate: null, ...over });

describe("heuristicExclusion", () => {
  it("returns the matching code per rule", () => {
    expect(heuristicExclusion(r({ url: "https://getaglow.co/about" }), identity(), NOW, config)).toBe("own_channel");
    expect(heuristicExclusion(r({ url: "https://www.amazon.com/dp/B01" }), identity(), NOW, config)).toBe("ecommerce_review");
    expect(heuristicExclusion(r({ url: "https://news.google.com/articles/x" }), identity(), NOW, config)).toBe("aggregator");
    expect(heuristicExclusion(r({ url: "https://news.site/a", publishedDate: "2021-01-01" }), identity(), NOW, config)).toBe("out_of_window");
  });

  it("returns null when no rule matches", () => {
    expect(heuristicExclusion(r({ url: "https://startupdaily.net/aglow", publishedDate: "2026-01-01" }), identity(), NOW, config)).toBeNull();
  });

  it("applies the fixed priority order (own_channel beats the rest)", () => {
    // An own-domain product page that is also old → own_channel wins (most specific surface first).
    const multi = r({ url: "https://getaglow.co/product/kit", publishedDate: "2020-01-01" });
    expect(heuristicExclusion(multi, identity(), NOW, config)).toBe("own_channel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/heuristic-exclusion.test.ts`
Expected: FAIL — `Cannot find module './heuristic-exclusion'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/heuristic-exclusion.ts
import type { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";
import type { FilterConfig } from "./filter-config";
import type { HeuristicExclusionCode } from "./exclusion-code";
import { isOwnChannel } from "./own-channel";
import { isEcommerceReview } from "./ecommerce-review";
import { isAggregator } from "./aggregator";
import { isOutOfWindow } from "./out-of-window";

/**
 * The fixed-priority gate: own_channel → ecommerce_review → aggregator → out_of_window. The first
 * match wins, so a Result qualifying for several codes gets one predictable, explainable code
 * (most-specific surface first; "merely too old" last). Returns null when no rule matches.
 */
export function heuristicExclusion(
  result: FilterResult,
  identity: ResolvedIdentity,
  now: Date,
  config: FilterConfig,
): HeuristicExclusionCode | null {
  if (isOwnChannel(result, identity)) return "own_channel";
  if (isEcommerceReview(result)) return "ecommerce_review";
  if (isAggregator(result)) return "aggregator";
  if (isOutOfWindow(result.publishedDate, now, config.horizonMonths)) return "out_of_window";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/heuristic-exclusion.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/heuristic-exclusion.ts src/domain/filter/heuristic-exclusion.test.ts
git commit -m "feat(filter): fixed-priority heuristic gate (single predictable code)"
```

---

## Task 9: `normalizeTitle` (the single shared "same title" key)

**Files:**
- Create: `src/domain/filter/normalize-title.ts`
- Test: `src/domain/filter/normalize-title.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/normalize-title.test.ts
import { describe, it, expect } from "vitest";
import { normalizeTitle } from "./normalize-title";

describe("normalizeTitle", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeTitle("  Aglow  Raises  $5M!! ")).toBe("aglow raises 5m");
  });
  it("strips a trailing source/site suffix after a known separator", () => {
    expect(normalizeTitle("Aglow raises $5M in seed funding — Business News Australia")).toBe("aglow raises 5m in seed funding");
    expect(normalizeTitle("Aglow raises $5M in seed funding | Startup Daily")).toBe("aglow raises 5m in seed funding");
  });
  it("does NOT strip a long tail that is unlikely to be a publisher name", () => {
    const t = "Aglow - a full sentence clause that runs well beyond a short publisher byline tail here";
    expect(normalizeTitle(t)).toContain("a full sentence clause");
  });
  it("maps two genuinely different titles to different keys", () => {
    expect(normalizeTitle("Aglow launches app")).not.toBe(normalizeTitle("Aglow raises funding"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/normalize-title.test.ts`
Expected: FAIL — `Cannot find module './normalize-title'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/normalize-title.ts

// Separators wire re-prints use to append a publisher tail (em dash, en dash, pipe, hyphen).
const SUFFIX_SEPARATORS = [" — ", " – ", " | ", " - "];

/**
 * The single shared "same title" key: lowercase, collapse whitespace, strip surrounding
 * punctuation, and drop a trailing source/site suffix (a SHORT tail after the last known
 * separator — a publisher name, not a meaningful clause). Defined once; shared by all tests.
 */
export function normalizeTitle(title: string): string {
  let head = title.trim();
  for (const sep of SUFFIX_SEPARATORS) {
    const idx = head.lastIndexOf(sep);
    if (idx > 0) {
      const tail = head.slice(idx + sep.length).trim();
      if (tail.split(/\s+/).length <= 6) head = head.slice(0, idx);
      break;
    }
  }
  return head
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/normalize-title.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/normalize-title.ts src/domain/filter/normalize-title.test.ts
git commit -m "feat(filter): shared title normalization (with publisher-suffix stripping)"
```

---

## Task 10: `isDistinctive` (the generic-title guard)

**Files:**
- Create: `src/domain/filter/distinctive-title.ts`
- Test: `src/domain/filter/distinctive-title.test.ts`

> Input is an already-normalized key (from Task 9). The gate removes the company-name tokens + stop-words and requires ≥ `minDistinctiveTokens` meaningful tokens remain.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/distinctive-title.test.ts
import { describe, it, expect } from "vitest";
import { isDistinctive } from "./distinctive-title";
import { normalizeTitle } from "./normalize-title";
import type { FilterConfig } from "./filter-config";

const config: FilterConfig = { horizonMonths: 36, collapseWindowDays: 14, minDistinctiveTokens: 5, minClusterDomains: 2 };

describe("isDistinctive", () => {
  it("rejects a bare company name or a generic phrase as a collapse key", () => {
    expect(isDistinctive(normalizeTitle("Aglow"), "Aglow", config)).toBe(false);
    expect(isDistinctive(normalizeTitle("Funding Announcement"), "Aglow", config)).toBe(false);
    expect(isDistinctive(normalizeTitle("Aglow — Company News"), "Aglow", config)).toBe(false);
  });

  it("accepts a distinctive, identifying title", () => {
    const key = normalizeTitle("Aglow raises $5M seed round to expand beauty membership platform nationwide");
    expect(isDistinctive(key, "Aglow", config)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/distinctive-title.test.ts`
Expected: FAIL — `Cannot find module './distinctive-title'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/distinctive-title.ts
import type { FilterConfig } from "./filter-config";
import { normalizeTitle } from "./normalize-title";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "as", "is",
  "are", "its", "new", "update", "updates", "news", "press", "release", "announcement", "announces",
  "report", "q1", "q2", "q3", "q4", "company", "inc", "ltd",
]);

/**
 * A normalized key may anchor a cluster only when it is DISTINCTIVE: ≥ minDistinctiveTokens
 * meaningful tokens remain after removing the company-name tokens and stop-words. A bare name or a
 * generic phrase ("Funding Announcement") is never a collapse key — each such Result stays a singleton.
 */
export function isDistinctive(normalizedKey: string, companyName: string, config: FilterConfig): boolean {
  const companyTokens = new Set(normalizeTitle(companyName).split(" ").filter(Boolean));
  const meaningful = normalizedKey
    .split(" ")
    .filter((t) => t !== "" && !STOP_WORDS.has(t) && !companyTokens.has(t));
  return meaningful.length >= config.minDistinctiveTokens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/distinctive-title.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/distinctive-title.ts src/domain/filter/distinctive-title.test.ts
git commit -m "feat(filter): distinctiveness gate against generic-title false merges"
```

---

## Task 11: `collapse` (pure clustering)

**Files:**
- Create: `src/domain/filter/collapse.ts`
- Test: `src/domain/filter/collapse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/collapse.test.ts
import { describe, it, expect } from "vitest";
import { collapse, type CollapseInput } from "./collapse";
import type { FilterConfig } from "./filter-config";

const config: FilterConfig = { horizonMonths: 36, collapseWindowDays: 14, minDistinctiveTokens: 5, minClusterDomains: 2 };
const TITLE = "Aglow raises $5M seed round to expand beauty membership platform";

const input = (over: Partial<CollapseInput>): CollapseInput => ({
  id: "x", title: TITLE, sourceDomain: "site.com", publishedDate: "2026-01-02", ...over,
});

describe("collapse", () => {
  it("collapses a distinctive title across >=2 domains within 14 days to the earliest winner", () => {
    const losers = collapse(
      [
        input({ id: "early", sourceDomain: "businessnews.com.au", publishedDate: "2026-01-01" }),
        input({ id: "late", sourceDomain: "startupdaily.net", publishedDate: "2026-01-05" }),
      ],
      "Aglow",
      config,
    );
    expect(losers).toEqual([{ loserId: "late", winnerId: "early" }]);
  });

  it("leaves same-title copies on a single domain as singletons", () => {
    const losers = collapse(
      [
        input({ id: "a", sourceDomain: "site.com", publishedDate: "2026-01-01" }),
        input({ id: "b", sourceDomain: "site.com", publishedDate: "2026-01-03" }),
      ],
      "Aglow",
      config,
    );
    expect(losers).toEqual([]);
  });

  it("does not cluster a copy outside the 14-day window (anchored to earliest)", () => {
    const losers = collapse(
      [
        input({ id: "a", sourceDomain: "d1.com", publishedDate: "2026-01-01" }),
        input({ id: "b", sourceDomain: "d2.com", publishedDate: "2026-02-01" }), // >14 days
      ],
      "Aglow",
      config,
    );
    expect(losers).toEqual([]); // two separate single-member clusters
  });

  it("never anchors a cluster on a generic/non-distinctive title", () => {
    const losers = collapse(
      [
        { id: "a", title: "Funding Announcement", sourceDomain: "d1.com", publishedDate: "2026-01-01" },
        { id: "b", title: "Funding Announcement", sourceDomain: "d2.com", publishedDate: "2026-01-02" },
      ],
      "Aglow",
      config,
    );
    expect(losers).toEqual([]);
  });

  it("joins an undated copy only under a single-cluster key", () => {
    const single = collapse(
      [
        input({ id: "early", sourceDomain: "d1.com", publishedDate: "2026-01-01" }),
        input({ id: "mid", sourceDomain: "d2.com", publishedDate: "2026-01-03" }),
        input({ id: "undated", sourceDomain: "d3.com", publishedDate: null }),
      ],
      "Aglow",
      config,
    );
    expect(single.map((l) => l.loserId).sort()).toEqual(["mid", "undated"]);
    expect(single.every((l) => l.winnerId === "early")).toBe(true);
  });

  it("leaves an undated copy included under a multi-cluster key", () => {
    const multi = collapse(
      [
        input({ id: "a", sourceDomain: "d1.com", publishedDate: "2026-01-01" }),
        input({ id: "b", sourceDomain: "d2.com", publishedDate: "2026-01-02" }),
        input({ id: "c", sourceDomain: "d3.com", publishedDate: "2026-03-01" }), // separate cluster (>14d)
        input({ id: "d4.com", sourceDomain: "d4.com", publishedDate: "2026-03-03" }),
        input({ id: "undated", sourceDomain: "d5.com", publishedDate: null }),
      ],
      "Aglow",
      config,
    );
    expect(multi.find((l) => l.loserId === "undated")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/collapse.test.ts`
Expected: FAIL — `Cannot find module './collapse'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/collapse.ts
import type { FilterConfig } from "./filter-config";
import { normalizeTitle } from "./normalize-title";
import { isDistinctive } from "./distinctive-title";

export type CollapseInput = {
  readonly id: string;
  readonly title: string;
  readonly sourceDomain: string;
  readonly publishedDate: string | null; // ISO yyyy-mm-dd, or null
};
export type CollapseLoser = { readonly loserId: string; readonly winnerId: string };

type DatedInput = CollapseInput & { publishedDate: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

/**
 * Pure clustering over normalized DISTINCTIVE title + publication date. Dated copies cluster within
 * `collapseWindowDays` of the cluster's EARLIEST member; a cluster collapses only across
 * `minClusterDomains` distinct source domains (the wire-syndication signature); the earliest-published
 * copy wins. An undated copy joins only under a single-cluster key. Bias to under-collapse.
 */
export function collapse(
  inputs: readonly CollapseInput[],
  companyName: string,
  config: FilterConfig,
): CollapseLoser[] {
  // 1. key + distinctiveness gate
  const keyed = inputs
    .map((input) => ({ input, key: normalizeTitle(input.title) }))
    .filter(({ key }) => isDistinctive(key, companyName, config));

  // 2. group by normalized key
  const groups = new Map<string, CollapseInput[]>();
  for (const { input, key } of keyed) {
    const existing = groups.get(key);
    if (existing) existing.push(input);
    else groups.set(key, [input]);
  }

  const losers: CollapseLoser[] = [];

  for (const members of groups.values()) {
    const dated = members
      .filter((m): m is DatedInput => m.publishedDate !== null)
      .sort((a, b) =>
        a.publishedDate === b.publishedDate ? a.id.localeCompare(b.id) : a.publishedDate.localeCompare(b.publishedDate),
      );
    const undated = members.filter((m) => m.publishedDate === null);

    // 3. cluster dated members greedily, anchored to the earliest member of each open cluster
    const clusters: DatedInput[][] = [];
    for (const m of dated) {
      const open = clusters[clusters.length - 1];
      if (open && daysBetween(open[0].publishedDate, m.publishedDate) <= config.collapseWindowDays) {
        open.push(m);
      } else {
        clusters.push([m]);
      }
    }
    if (clusters.length === 0) continue; // all undated → no anchor → stay included

    // 4. undated join only when the key produced exactly one cluster
    const memberships: CollapseInput[][] = clusters.map((c) => [...c]);
    if (clusters.length === 1 && undated.length > 0) memberships[0].push(...undated);

    // 5 + 6. collapsibility (>=2 members, dated copies span >= minClusterDomains) → earliest wins
    for (let i = 0; i < clusters.length; i++) {
      const datedDomains = new Set(clusters[i].map((m) => m.sourceDomain));
      const all = memberships[i];
      if (all.length < 2 || datedDomains.size < config.minClusterDomains) continue;
      const winnerId = clusters[i][0].id; // earliest-published
      for (const m of all) {
        if (m.id !== winnerId) losers.push({ loserId: m.id, winnerId });
      }
    }
  }

  return losers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/collapse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/collapse.ts src/domain/filter/collapse.test.ts
git commit -m "feat(filter): pure Collapse clustering (14-day, >=2 domains, earliest wins)"
```

---

## Task 12: Filter Warning closed set

**Files:**
- Create: `src/domain/filter/filter-warnings.ts`
- Test: `src/domain/filter/filter-warnings.test.ts`

> Confirm the import path/shape of `Warning` against Foundation's `src/domain/job/warning.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/filter/filter-warnings.test.ts
import { describe, it, expect } from "vitest";
import { FILTER_WARNING, filterWarnings } from "./filter-warnings";

describe("filter warnings", () => {
  it("exposes the closed set of filter warning types", () => {
    expect(Object.values(FILTER_WARNING)).toEqual(["filter.own_channel_degraded"]);
  });
  it("builds a non-echoing degraded-own-channel warning of the matching type", () => {
    const w = filterWarnings.ownChannelDegraded();
    expect(w.type).toBe(FILTER_WARNING.ownChannelDegraded);
    expect(w.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/filter/filter-warnings.test.ts`
Expected: FAIL — `Cannot find module './filter-warnings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/filter/filter-warnings.ts
import type { Warning } from "../job/warning";

export const FILTER_WARNING = {
  ownChannelDegraded: "filter.own_channel_degraded",
} as const;

// Message carries no raw URL and no model text (anti-echo) — the heuristics emit no model text at all.
export const filterWarnings = {
  ownChannelDegraded: (): Warning => ({
    type: FILTER_WARNING.ownChannelDegraded,
    message:
      "No resolved own domains; the own-channel heuristic ran on available signal only, deferring the rest to the Classify backstop.",
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/filter/filter-warnings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/filter/filter-warnings.ts src/domain/filter/filter-warnings.test.ts
git commit -m "feat(filter): closed Filter Warning set (degraded own-channel)"
```

---

## Task 13: `ResultRepository` extension + `FilterConfig` token

**Files:**
- Modify: `src/application/search/ports/result-repository.port.ts` (add `FilterResult`, `findIncluded`, `recordExclusion`)
- Create: `src/application/filter/filter-config.ts` (the `FILTER_CONFIG` DI token + re-export)

These are pure interfaces/types — verification is a clean `tsc`, not a Vitest run.

- [ ] **Step 1: Extend the repository port**

```ts
// src/application/search/ports/result-repository.port.ts (add to the EXISTING file)
import type { ExclusionCode } from "../../../domain/filter/exclusion-code";
import type { FilterResult } from "../../../domain/filter/filter-result";

// (keep the existing ResultSource / ResultInsert / RESULT_REPOSITORY exports)

// Re-export so Filter consumers can import the read-model from the port if convenient.
export type { FilterResult };

export interface ResultRepository {
  // existing (Search):
  insertIncluded(jobId: string, results: readonly ResultInsert[]): Promise<number>;

  // Filter additions:
  /** The Collapse pool: rows whose status = 'included' (an Excluded copy is never returned). */
  findIncluded(jobId: string): Promise<FilterResult[]>;
  /** The only status transition Filter performs: included → excluded. Idempotent (only WHERE status='included'). */
  recordExclusion(resultId: string, code: ExclusionCode, detail: string | null): Promise<void>;
}
```

> If the existing file declares `ResultRepository` with only `insertIncluded`, add the two methods to that same interface (do not create a second interface). Keep `RESULT_REPOSITORY`, `ResultInsert`, and `ResultSource` exactly as Search defined them.

```ts
// src/application/filter/filter-config.ts
export type { FilterConfig } from "../../domain/filter/filter-config";

export const FILTER_CONFIG = Symbol("FilterConfig");
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the Drizzle `ResultDrizzleRepository` will now fail to satisfy the interface — that is fixed in Task 15; if `tsc` flags it here, proceed to Task 14/15 which implement the methods).

> If `tsc` reports `ResultDrizzleRepository` no longer implements `ResultRepository`, that is expected — Task 15 adds the two methods. You may temporarily run `tsc` scoped to the application layer, or accept the single known error until Task 15. Do not add stub methods that throw.

- [ ] **Step 3: Commit**

```bash
git add src/application/search/ports/result-repository.port.ts src/application/filter/filter-config.ts
git commit -m "feat(filter): extend ResultRepository port (findIncluded + recordExclusion) + config token"
```

---

## Task 14: `FilterStage` orchestration (heuristic pass → Collapse pass)

**Files:**
- Create: `src/application/filter/filter.stage.ts`
- Test: `src/application/filter/filter.stage.test.ts`

> The only impure unit. It composes the repository + config + Foundation's `Clock`. Tested entirely with a fake repository. Adjust `ctx.job.id`, `ctx.resolvedIdentity`, the `Clock` import, the `Stage` import, `createRunContext`, and the test helper imports to Foundation's/Resolve's actual exports.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/filter/filter.stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { FilterStage } from "./filter.stage";
import { createRunContext } from "../pipeline/run-context";
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { FILTER_WARNING } from "../../domain/filter/filter-warnings";
import type { FilterResult, ResultRepository } from "../search/ports/result-repository.port";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import type { FilterConfig } from "../../domain/filter/filter-config";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const clock = { now: () => NOW };
const config: FilterConfig = { horizonMonths: 36, collapseWindowDays: 14, minDistinctiveTokens: 5, minClusterDomains: 2 };

const identity = (over: Partial<Parameters<typeof ResolvedIdentity.assemble>[0]> = {}) =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [],
    brandContext: null, nameCollisions: [], negativeBoost: "",
    ...over,
  });

/** A fake repo over a fixed pool: records exclusions, honours the included-only / idempotent contract. */
function fakeRepo(pool: FilterResult[]) {
  const excluded = new Map<string, { code: ExclusionCode; detail: string | null }>();
  return {
    excluded,
    insertIncluded: vi.fn(async () => 0),
    findIncluded: vi.fn(async () => pool.filter((r) => !excluded.has(r.id))),
    recordExclusion: vi.fn(async (id: string, code: ExclusionCode, detail: string | null) => {
      if (!excluded.has(id)) excluded.set(id, { code, detail }); // included-only / idempotent
    }),
  } satisfies ResultRepository & { excluded: Map<string, { code: ExclusionCode; detail: string | null }> };
}

const result = (over: Partial<FilterResult>): FilterResult => ({
  id: "r", url: "https://news.site/a", title: "t", snippet: "s", publishedDate: "2026-01-01", ...over,
});

const TITLE = "Aglow raises $5M seed round to expand its beauty membership platform";

describe("FilterStage", () => {
  it("has name 'filter'", () => {
    expect(new FilterStage(fakeRepo([]), config, clock).name).toBe("filter");
  });

  it("heuristic pass excludes the expected rows with the expected codes", async () => {
    const repo = fakeRepo([
      result({ id: "own", url: "https://getaglow.co/about" }),
      result({ id: "shop", url: "https://www.amazon.com/dp/B01" }),
      result({ id: "agg", url: "https://news.google.com/articles/x" }),
      result({ id: "old", url: "https://news.site/old", publishedDate: "2021-01-01" }),
      result({ id: "keep", url: "https://startupdaily.net/aglow", title: "Unique distinct headline alpha beta gamma delta epsilon" }),
    ]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await new FilterStage(repo, config, clock).run(ctx);

    expect(repo.excluded.get("own")?.code).toBe("own_channel");
    expect(repo.excluded.get("shop")?.code).toBe("ecommerce_review");
    expect(repo.excluded.get("agg")?.code).toBe("aggregator");
    expect(repo.excluded.get("old")?.code).toBe("out_of_window");
    expect(repo.excluded.has("keep")).toBe(false);
  });

  it("Collapse pass runs over survivors only and points losers at the winner", async () => {
    const repo = fakeRepo([
      result({ id: "early", url: "https://businessnews.com.au/a", title: TITLE, publishedDate: "2026-01-01" }),
      result({ id: "late", url: "https://startupdaily.net/a", title: TITLE, publishedDate: "2026-01-04" }),
    ]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await new FilterStage(repo, config, clock).run(ctx);

    expect(repo.excluded.get("late")).toEqual({ code: "duplicate", detail: "of:early" });
    expect(repo.excluded.has("early")).toBe(false);
  });

  it("records exactly one degraded-own-channel Warning when no own domains are resolved", async () => {
    const repo = fakeRepo([result({ id: "agg", url: "https://news.google.com/x" })]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity({ ownDomains: [] }));
    await new FilterStage(repo, config, clock).run(ctx);

    expect(ctx.job.warnings.map((w) => w.type)).toEqual([FILTER_WARNING.ownChannelDegraded]);
    expect(repo.excluded.get("agg")?.code).toBe("aggregator"); // independent rules still run
  });

  it("never throws JobFailedError (an empty population is a valid outcome)", async () => {
    const repo = fakeRepo([]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    await expect(new FilterStage(repo, config, clock).run(ctx)).resolves.toBeUndefined();
  });

  it("throws a plain Error when resolvedIdentity is missing (programming/ordering fault)", async () => {
    const repo = fakeRepo([]);
    const ctx = createRunContext(makeRunningJob()); // resolvedIdentity not set
    await expect(new FilterStage(repo, config, clock).run(ctx)).rejects.toThrow(/ResolvedIdentity/);
  });

  it("is idempotent: a second run records no new exclusions and rewrites no code", async () => {
    const repo = fakeRepo([result({ id: "own", url: "https://getaglow.co/x" })]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    const stage = new FilterStage(repo, config, clock);
    await stage.run(ctx);
    const callsAfterFirst = repo.recordExclusion.mock.calls.length;
    await stage.run(ctx);
    expect(repo.excluded.get("own")?.code).toBe("own_channel");
    expect(repo.recordExclusion.mock.calls.length).toBe(callsAfterFirst); // no new exclusion (pool is smaller)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/filter/filter.stage.test.ts`
Expected: FAIL — `Cannot find module './filter.stage'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/filter/filter.stage.ts
import type { Stage } from "../pipeline/stage.port";
import type { RunContext } from "../pipeline/run-context";
import type { Clock } from "../ports/clock.port"; // adjust to Foundation's Clock port path
import type { ResultRepository } from "../search/ports/result-repository.port";
import type { FilterConfig } from "../../domain/filter/filter-config";
import { heuristicExclusion } from "../../domain/filter/heuristic-exclusion";
import { collapse, type CollapseInput } from "../../domain/filter/collapse";
import { resultHost, registrableDomain } from "../../domain/filter/result-host";
import { filterWarnings } from "../../domain/filter/filter-warnings";

/**
 * The third pipeline stage. Soft-Excludes structurally-obvious noise (heuristic pass) and then
 * Collapses near-identical re-prints to the earliest copy (Collapse pass) — pure deterministic
 * logic, no network, no LLM. Never fails the Job; a degraded (name-only) identity is a Warning.
 */
export class FilterStage implements Stage {
  readonly name = "filter";

  constructor(
    private readonly repo: ResultRepository,
    private readonly config: FilterConfig,
    private readonly clock: Clock,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    const identity = ctx.resolvedIdentity;
    if (identity === null) {
      // Programming/ordering fault: Resolve must run first. The runner routes this to `fail`.
      throw new Error("FilterStage requires a ResolvedIdentity (Resolve must run first)");
    }

    if (identity.ownDomains.length === 0) {
      ctx.recordWarning(filterWarnings.ownChannelDegraded());
    }

    const now = this.clock.now();
    const pool = await this.repo.findIncluded(ctx.job.id);

    // Heuristic pass — Exclude the first matching code; survivors flow into Collapse.
    const survivors: typeof pool = [];
    for (const result of pool) {
      const code = heuristicExclusion(result, identity, now, this.config);
      if (code !== null) {
        await this.repo.recordExclusion(result.id, code, null);
      } else {
        survivors.push(result);
      }
    }

    // Collapse pass — over survivors only; losers point at the earliest-published winner.
    const inputs: CollapseInput[] = survivors.map((r) => ({
      id: r.id,
      title: r.title,
      sourceDomain: registrableDomain(resultHost(r.url)),
      publishedDate: r.publishedDate,
    }));
    for (const loser of collapse(inputs, identity.companyName, this.config)) {
      await this.repo.recordExclusion(loser.loserId, "duplicate", `of:${loser.winnerId}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/filter/filter.stage.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/filter/filter.stage.ts src/application/filter/filter.stage.test.ts
git commit -m "feat(filter): FilterStage orchestration (heuristic pass → Collapse pass)"
```

---

## Task 15: `findIncluded` + `recordExclusion` (Drizzle) + Testcontainers integration

**Files:**
- Modify: `src/infrastructure/persistence/result.repository.ts` (add the two methods to `ResultDrizzleRepository`)
- Test: `src/infrastructure/persistence/result.repository.filter.integration.test.ts`

> No schema change. Reuse Foundation's Testcontainers helper that boots Postgres, runs migrations, and yields a Drizzle client + a `jobs`-row inserter. Align `results.id`/`results.jobId`/`results.status`/`results.exclusionCode`/`results.exclusionDetail`/`results.publishedDate` with the actual column names in `schema.ts` (Foundation + Search). The `status` enum values are `'included' | 'excluded'`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/result.repository.filter.integration.test.ts
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

describe("ResultDrizzleRepository — Filter methods (Testcontainers)", () => {
  const db = withTestDatabase(); // container + migrations; exposes db.client and db.insertJob

  it("findIncluded returns only included rows with the content columns", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [
      insert({ url: "https://a/1", normalizedUrl: "a/1", title: "Keep me" }),
      insert({ url: "https://b/2", normalizedUrl: "b/2", title: "Exclude me" }),
    ]);
    const before = await repo.findIncluded(jobId);
    expect(before).toHaveLength(2);
    const excludeId = before.find((r) => r.title === "Exclude me")!.id;
    await repo.recordExclusion(excludeId, "aggregator", null);

    const after = await repo.findIncluded(jobId);
    expect(after.map((r) => r.title)).toEqual(["Keep me"]);
    expect(after[0]).toMatchObject({ url: "https://a/1", snippet: "Aglow raised...", publishedDate: "2026-01-02" });
  });

  it("recordExclusion flips included → excluded with code/detail and leaves match_score untouched", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [insert({ url: "https://d/1", normalizedUrl: "d/1", matchScore: 73 })]);
    const id = (await repo.findIncluded(jobId))[0].id;
    await repo.recordExclusion(id, "duplicate", "of:other-id");

    const row = (await db.client.execute(
      `select status, exclusion_code, exclusion_detail, match_score from results where id = '${id}'` as never,
    )) as unknown as { rows?: Array<Record<string, unknown>> };
    const r = row.rows?.[0] ?? (row as never as Array<Record<string, unknown>>)[0];
    expect(r.status).toBe("excluded");
    expect(r.exclusion_code).toBe("duplicate");
    expect(r.exclusion_detail).toBe("of:other-id");
    expect(Number(r.match_score)).toBe(73);
  });

  it("recordExclusion is idempotent: a second call never rewrites the code", async () => {
    const jobId = await db.insertJob();
    const repo = new ResultDrizzleRepository(db.client);
    await repo.insertIncluded(jobId, [insert({ url: "https://e/1", normalizedUrl: "e/1" })]);
    const id = (await repo.findIncluded(jobId))[0].id;
    await repo.recordExclusion(id, "own_channel", null);
    await repo.recordExclusion(id, "duplicate", "of:x"); // must be a no-op (status already 'excluded')

    const row = (await db.client.execute(
      `select exclusion_code from results where id = '${id}'` as never,
    )) as unknown as { rows?: Array<Record<string, unknown>> };
    const r = row.rows?.[0] ?? (row as never as Array<Record<string, unknown>>)[0];
    expect(r.exclusion_code).toBe("own_channel");
  });

  it("does not touch another Job's rows", async () => {
    const repo = new ResultDrizzleRepository(db.client);
    const jobA = await db.insertJob();
    const jobB = await db.insertJob();
    await repo.insertIncluded(jobA, [insert({ url: "https://a/x", normalizedUrl: "a/x" })]);
    await repo.insertIncluded(jobB, [insert({ url: "https://b/y", normalizedUrl: "b/y" })]);
    const idA = (await repo.findIncluded(jobA))[0].id;
    await repo.recordExclusion(idA, "aggregator", null);
    expect(await repo.findIncluded(jobB)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/persistence/result.repository.filter.integration.test.ts`
Expected: FAIL — `repo.findIncluded is not a function`.

- [ ] **Step 3: Write minimal implementation (add the two methods to the existing repository)**

```ts
// src/infrastructure/persistence/result.repository.ts (additions to ResultDrizzleRepository)
import { and, eq } from "drizzle-orm";
import type { FilterResult, ResultRepository } from "../../application/search/ports/result-repository.port";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import { results } from "./schema";

// Inside class ResultDrizzleRepository implements ResultRepository { ... add: }

  async findIncluded(jobId: string): Promise<FilterResult[]> {
    const rows = await this.db
      .select({
        id: results.id,
        url: results.url,
        title: results.title,
        snippet: results.snippet,
        publishedDate: results.publishedDate,
      })
      .from(results)
      .where(and(eq(results.jobId, jobId), eq(results.status, "included")));

    return rows.map((r) => ({
      id: String(r.id),
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      publishedDate: r.publishedDate ? String(r.publishedDate) : null,
    }));
  }

  async recordExclusion(resultId: string, code: ExclusionCode, detail: string | null): Promise<void> {
    // Idempotent + included-only: the WHERE guard forecloses re-Excluding with a different code.
    await this.db
      .update(results)
      .set({ status: "excluded", exclusionCode: code, exclusionDetail: detail })
      .where(and(eq(results.id, resultId), eq(results.status, "included")));
  }
```

> Ensure `and`/`eq` are imported (Search's file already imports `eq`/`desc`). Align the `set(...)` keys with Foundation's Drizzle column property names (`exclusionCode`/`exclusionDetail` map to `exclusion_code`/`exclusion_detail`). If Foundation's `results.id` is a uuid, `String(r.id)` is a safe pass-through.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/persistence/result.repository.filter.integration.test.ts`
Expected: PASS (4 tests). `tsc` is now clean (the interface is fully implemented).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/result.repository.ts src/infrastructure/persistence/result.repository.filter.integration.test.ts
git commit -m "feat(filter): Drizzle findIncluded + idempotent recordExclusion (included→excluded only)"
```

---

## Task 16: The Aglow precision fixture (deterministic stage assertion)

**Files:**
- Create: `src/application/filter/aglow-fixture.test.ts`

> The labelled Aglow set is this stage's primary deterministic precision fixture. Encode a representative subset (own-channel surfaces, an aggregator, an ecommerce/review page, the genuine third-party coverage that must survive, a different-entity same-name row that Filter must NOT touch, and a collapsible re-print pair) and assert the stage's outcome through a fake repository. Autoevals on end-to-end precision/recall belong to Verify/Classify, not here.

- [ ] **Step 1: Write the fixture test**

```ts
// src/application/filter/aglow-fixture.test.ts
import { describe, it, expect, vi } from "vitest";
import { FilterStage } from "./filter.stage";
import { createRunContext } from "../pipeline/run-context";
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type { FilterResult, ResultRepository } from "../search/ports/result-repository.port";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import type { FilterConfig } from "../../domain/filter/filter-config";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const clock = { now: () => NOW };
const config: FilterConfig = { horizonMonths: 36, collapseWindowDays: 14, minDistinctiveTokens: 5, minClusterDomains: 2 };

const aglow = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
    socialHandles: [
      { platform: "linkedin", handle: "getaglow", url: "https://www.linkedin.com/company/getaglow" },
      { platform: "instagram", handle: "aglow_app", url: "https://instagram.com/aglow_app" },
    ],
    brandContext: null, nameCollisions: [], negativeBoost: "",
  });

function fakeRepo(pool: FilterResult[]) {
  const excluded = new Map<string, ExclusionCode>();
  return {
    excluded,
    insertIncluded: vi.fn(async () => 0),
    findIncluded: vi.fn(async () => pool.filter((r) => !excluded.has(r.id))),
    recordExclusion: vi.fn(async (id: string, code: ExclusionCode) => {
      if (!excluded.has(id)) excluded.set(id, code);
    }),
  } satisfies ResultRepository & { excluded: Map<string, ExclusionCode> };
}

const COVERAGE_TITLE = "Aglow raises $5M seed round to expand its beauty membership platform";

const POOL: FilterResult[] = [
  // own_channel
  { id: "site", url: "https://getaglow.co/about", title: "About Aglow", snippet: "", publishedDate: "2026-02-01" },
  { id: "li", url: "https://www.linkedin.com/company/getaglow", title: "Aglow on LinkedIn", snippet: "", publishedDate: null },
  { id: "ig", url: "https://instagram.com/aglow_app", title: "Aglow (@aglow_app)", snippet: "", publishedDate: null },
  // aggregator / ecommerce_review
  { id: "agg", url: "https://news.google.com/articles/aglow", title: "Aglow - Google News", snippet: "", publishedDate: "2026-03-01" },
  { id: "g2", url: "https://www.g2.com/products/aglow/reviews", title: "Aglow Reviews", snippet: "", publishedDate: "2026-03-02" },
  // genuine third-party coverage (must survive) — collapsible re-print pair across 2 domains
  { id: "bna", url: "https://businessnews.com.au/article/aglow-seed", title: `${COVERAGE_TITLE} — Business News Australia`, snippet: "Aglow announced...", publishedDate: "2026-01-02" },
  { id: "sd", url: "https://startupdaily.net/2026/01/aglow-seed", title: `${COVERAGE_TITLE} | Startup Daily`, snippet: "Aglow announced...", publishedDate: "2026-01-05" },
  // different-entity same-name (Filter must NOT touch it — that is Verify's off_topic)
  { id: "ministry", url: "https://aglow.org/events/conference", title: "Aglow International womens ministry annual conference gathering", snippet: "prayer", publishedDate: "2026-02-10" },
];

describe("Filter — Aglow precision fixture", () => {
  it("Excludes own-channel/aggregator/ecommerce mass, collapses the re-print, preserves real coverage and leaves different-entity rows to Verify", async () => {
    const repo = fakeRepo([...POOL]);
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(aglow());
    await new FilterStage(repo, config, clock).run(ctx);

    // own_channel
    expect(repo.excluded.get("site")).toBe("own_channel");
    expect(repo.excluded.get("li")).toBe("own_channel");
    expect(repo.excluded.get("ig")).toBe("own_channel");
    // aggregator + ecommerce_review
    expect(repo.excluded.get("agg")).toBe("aggregator");
    expect(repo.excluded.get("g2")).toBe("ecommerce_review");
    // Collapse: earliest (bna) wins, later re-print (sd) Excluded duplicate
    expect(repo.excluded.has("bna")).toBe(false);
    expect(repo.excluded.get("sd")).toBe("duplicate");
    // different-entity same-name row is NOT Filter's job — it stays included
    expect(repo.excluded.has("ministry")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the fixture test**

Run: `pnpm exec vitest run src/application/filter/aglow-fixture.test.ts`
Expected: PASS (1 test). If a row lands under the wrong code, fix the **predicate or host-knowledge** (not the test) so the labelled expectation holds.

- [ ] **Step 3: Commit**

```bash
git add src/application/filter/aglow-fixture.test.ts
git commit -m "test(filter): Aglow precision fixture (own-channel/aggregator/ecommerce/collapse, coverage preserved)"
```

---

## Task 17: DI wiring (register FilterStage third) + full gates

**Files:**
- Modify: `src/app-worker.module.ts` (provide `FILTER_CONFIG`, build `FilterStage`, register it THIRD in the `StageRunner`)
- Modify: `.env.example` (add the `FILTER_*` knobs)
- Test: `src/app-worker.module.test.ts` (extend the wiring test — assert Filter is registered third)

> Read Foundation's + Resolve's + Search's `app-worker.module.ts` to see how the `StageRunner`'s ordered stage list is built. The goal: the worker's runner is `[ResolveStage, SearchStage, FilterStage]` after this task. Filter reuses the already-wired `RESULT_REPOSITORY` provider — no new adapter or client.

- [ ] **Step 1: Write the failing wiring test**

```ts
// src/app-worker.module.test.ts (add this case alongside Resolve's + Search's)
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { AppWorkerModule } from "./app-worker.module";
import { StageRunner } from "./application/pipeline/stage-runner"; // adjust to Foundation's export
import { ResolveStage } from "./application/resolve/resolve.stage";
import { SearchStage } from "./application/search/search.stage";
import { FilterStage } from "./application/filter/filter.stage";

describe("AppWorkerModule wiring — Filter", () => {
  it("registers FilterStage as the third pipeline stage (after Resolve, Search)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppWorkerModule] })
      // override real Tavily/Anthropic/DB providers with test doubles per the project's testing pattern
      .compile();
    const runner = moduleRef.get(StageRunner);
    expect(runner.stages[0]).toBeInstanceOf(ResolveStage);
    expect(runner.stages[1]).toBeInstanceOf(SearchStage);
    expect(runner.stages[2]).toBeInstanceOf(FilterStage);
    expect(runner.stages[2]?.name).toBe("filter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app-worker.module.test.ts -t "Filter"`
Expected: FAIL — `runner.stages[2]` undefined / `FilterStage` not registered.

- [ ] **Step 3: Wire the worker module**

In `app-worker.module.ts`, add the `FILTER_CONFIG` provider, construct `FilterStage` from the existing `RESULT_REPOSITORY` + `FILTER_CONFIG` + Foundation's `Clock`, and extend the `StageRunner` to `[ResolveStage, SearchStage, FilterStage]`:

```ts
// src/app-worker.module.ts (sketch — merge into the existing module)
import { ConfigService } from "@nestjs/config";
import { FilterStage } from "./application/filter/filter.stage";
import { FILTER_CONFIG } from "./application/filter/filter-config";
import { RESULT_REPOSITORY } from "./application/search/ports/result-repository.port";
import { CLOCK } from "./application/ports/clock.port"; // adjust to Foundation's Clock token

// providers (added):
// {
//   provide: FILTER_CONFIG,
//   useFactory: (config: ConfigService) => ({
//     horizonMonths: Number(config.get("FILTER_HORIZON_MONTHS") ?? 36),
//     collapseWindowDays: Number(config.get("FILTER_COLLAPSE_WINDOW_DAYS") ?? 14),
//     minDistinctiveTokens: Number(config.get("FILTER_MIN_DISTINCTIVE_TOKENS") ?? 5),
//     minClusterDomains: Number(config.get("FILTER_MIN_CLUSTER_DOMAINS") ?? 2),
//   }),
//   inject: [ConfigService],
// },
// {
//   provide: FilterStage,
//   useFactory: (repo, filterConfig, clock) => new FilterStage(repo, filterConfig, clock),
//   inject: [RESULT_REPOSITORY, FILTER_CONFIG, CLOCK],
// },
// Extend the StageRunner from [ResolveStage, SearchStage] to [ResolveStage, SearchStage, FilterStage]:
// {
//   provide: StageRunner,
//   useFactory: (resolve, search, filter) => new StageRunner([resolve, search, filter]),
//   inject: [ResolveStage, SearchStage, FilterStage],
// },
```

Add to `.env.example`:

```
FILTER_HORIZON_MONTHS=36
FILTER_COLLAPSE_WINDOW_DAYS=14
FILTER_MIN_DISTINCTIVE_TOKENS=5
FILTER_MIN_CLUSTER_DOMAINS=2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app-worker.module.test.ts -t "Filter"`
Expected: PASS — `runner.stages[2]` is a `FilterStage` with `name === "filter"`.

- [ ] **Step 5: Run the full suite + gates**

Run:
```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec biome check src
```
Expected: all green (unit + Testcontainers integration), `tsc` clean, Biome clean. FTA per file `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/app-worker.module.ts src/app-worker.module.test.ts .env.example
git commit -m "feat(filter): wire FilterStage as the third pipeline stage + FILTER_* config"
```

---

## Self-review (run after all tasks)

- **Spec coverage:** every PRD user story maps to a task — own website/blog Excluded (T4, story 1); named social accounts Excluded (T3/T4, story 2); third-party post about the company stays in scope (T4, story 3); wire press release stays in scope (T4, story 4); company-bylined guest post stays in scope (T4, story 5); app-store listings Excluded (T3/T4, story 6); aggregator/index/directory Excluded (T6, story 7); ecommerce/product pages Excluded (T5, story 8); product-review/comparison under the same code (T5, story 9); clear reason code on each Exclusion (T8/T11/T15, story 10); nothing deleted — soft Exclusion only (T15, story 11); code describes *why* not *which stage* (T1/T15, story 12); near-identical copies collapsed (T11, story 13); earliest-published winner (T11, story 14); duplicate records which Result it was a duplicate of (T11/T14, story 15); undated copy collapsed only under one obvious group (T11, story 16); ambiguous undated copy stays included (T11, story 17); already-Excluded copy never wins Collapse (T14 survivors-only + T15 included-only query, story 18); no network/LLM (the whole stage — no outbound port, T14/T17, story 19); exact-URL dedup left to Search (spec Out of Scope, story 20); same closed `exclusion_code` vocabulary (T1, story 21); no model text stored (T8/T11 emit none, story 22); degraded path applies available signal + defers to backstop (T12/T14, story 23); degraded path is a Warning, not a failure (T12/T14, story 24); aggregator/ecommerce independent of Resolve (T5/T6, story 25); rules are pure functions over Result + identity (T4–T8, story 26); Own Channel anchored on resolved facts (T4, story 27); Collapse is a deterministic clustering function (T11, story 28); precise title normalization (T9, story 29); Aglow encoded as a labelled fixture (T16, story 30); aggregate span facts without per-Result spans (spec Observability — facts derivable; span emission is PRD 8, stories 31–32); Match Score untouched (T14/T15, story 33); idempotent Exclusion (T14/T15, story 34); defined heuristic evaluation order (T8, story 35).
- **No placeholders:** every code step shows real code; every command shows expected output.
- **Type consistency:** `ExclusionCode`/`HeuristicExclusionCode`, `FilterResult`, `FilterConfig`, `AccountKey`, `CollapseInput`/`CollapseLoser`, `FILTER_WARNING`, `FILTER_CONFIG`, and `resultHost`/`registrableDomain`/`accountKey`/`isOwnChannel`/`isEcommerceReview`/`isAggregator`/`isOutOfWindow`/`heuristicExclusion`/`normalizeTitle`/`isDistinctive`/`collapse` are defined once and reused verbatim across tasks. `findIncluded`/`recordExclusion` keep one signature from the port (T13) through the impl (T15) and both consumers (T14/T16).
- **Open verification points (resolve during execution, not guesses):**
  1. Foundation's `Warning` import path + shape (`{ type, message }`) — T12.
  2. Foundation's `Clock` port path/token, `RunContext`/`createRunContext`, the `Job` accessors (`id`, `warnings`), and Resolve's `setResolvedIdentity` + `ResolvedIdentity.assemble` parameter shape — T4/T8/T14/T16.
  3. Search's `ResultRepository` exact export (does it already declare only `insertIncluded`?), `ResultInsert`/`ResultSource`, and the `RESULT_REPOSITORY` token — T13/T15/T17.
  4. Foundation's `results` Drizzle column property names (`id`, `jobId`, `status`, `exclusionCode`, `exclusionDetail`, `publishedDate`, `title`, `snippet`, `url`, `matchScore`), the `status` enum values (`'included' | 'excluded'`), and the Testcontainers helper name (`withTestDatabase` / Foundation's actual export) — T15.
  5. Confirm the `exclusion_code` enum already contains `own_channel | aggregator | ecommerce_review | out_of_window | duplicate | off_topic` so **no migration** is needed — before T15.
  6. Whether `StageRunner` exposes its stage list (`get stages()`); reuse the same accessor Resolve/Search's wiring test used — T17.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-filter-collapse.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Resolve the six open verification points against the implemented Foundation + Resolve + Search before starting Task 4 (the first task that imports an upstream symbol). Filter depends on **all three** of PRD 1, 2, and 3 being implemented — confirm `ctx.resolvedIdentity` is populated by `ResolveStage`, that `results` carries Search's content columns, and that `ResultRepository` is wired before Task 14.
