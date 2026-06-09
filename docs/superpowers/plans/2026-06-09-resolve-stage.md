# Resolve Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Resolve stage — the first pipeline stage — that turns a Job's frozen anchor into one immutable, job-scoped Resolved Identity (name, own domains, social handles, optional Brand Context, de-selfed Name Collisions, derived Negative Boost) at zero LLM cost, degrading every missing piece to a Warning.

**Architecture:** Hexagonal on NestJS 11, inside Foundation's layering. Pure domain value objects + four application ports (Brand Search, Brand, Brand Context, Homepage Fetch) + a `ResolvedIdentityRepository` + a `ResolveStage implements Stage` orchestration shell. Adapters translate every transport failure into a benign value so degraded paths become Warnings, never Job failures. Negative Boost is a pure synchronous derivation — Resolve has **no Anthropic dependency** (ADR 0001 structural guarantee).

**Tech Stack:** TypeScript, NestJS 11, Zod, Drizzle/Postgres, global `fetch` (Node 26), Vitest (unit + contract + Testcontainers integration), Biome, FTA.

**Spec:** `docs/superpowers/specs/2026-06-09-resolve-stage-design.md`
**PRD:** `docs/prd/02-resolve-stage.md` · **ADRs:** 0001, 0004

---

## Prerequisites (read before starting)

- **Foundation (PRD 1) must be implemented.** This plan modifies and depends on Foundation files: `src/domain/job/warning.ts` (the `Warning` value object `{ type, message }`), `src/domain/job/company-anchor.ts` (`CompanyAnchor` discriminated union), `src/application/pipeline/stage.port.ts` (`Stage`), `src/application/pipeline/run-context.ts` (`RunContext`), `src/application/pipeline/stage-runner.ts`, `src/infrastructure/persistence/schema.ts`, `src/app-worker.module.ts`, `src/app-web.module.ts`. If any is missing, stop and implement Foundation first.
- **Foundation's `CompanyAnchor` shape** (from its spec) is the input contract:
  ```ts
  type Provenance = "picked" | "url_provided" | "name_only";
  type CompanyAnchor =
    | { kind: "disambiguated"; domain: string | null; brandId: string | null; provenance: Provenance }
    | { kind: "name_only"; name: string; provenance: "name_only" };
  ```
- **Test runner:** Foundation added `vitest` and `@testcontainers/postgresql`. Run unit tests with `pnpm exec vitest run <path>` and a single test with `-t "<name>"`. Set `OTEL_SDK_DISABLED=true` in the test environment.
- **Commit discipline:** one commit per task (after its tests pass). DRY, YAGNI, TDD.

---

## Task 1: `registrableDomain` domain utility

**Files:**
- Create: `src/domain/resolve/registrable-domain.ts`
- Test: `src/domain/resolve/registrable-domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/resolve/registrable-domain.test.ts
import { describe, it, expect } from "vitest";
import { registrableDomain } from "./registrable-domain";

describe("registrableDomain", () => {
  it("lowercases and strips scheme, www, port, and path", () => {
    expect(registrableDomain("https://www.GetAglow.co/about?x=1")).toBe("getaglow.co");
    expect(registrableDomain("getaglow.co:443")).toBe("getaglow.co");
    expect(registrableDomain("HTTP://Aglow.ORG/")).toBe("aglow.org");
  });

  it("returns empty string for null/blank input", () => {
    expect(registrableDomain(null)).toBe("");
    expect(registrableDomain("  ")).toBe("");
  });

  it("matches two forms of the same host", () => {
    expect(registrableDomain("www.homeaglow.com")).toBe(registrableDomain("https://homeaglow.com/jobs"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/resolve/registrable-domain.test.ts`
Expected: FAIL — `Cannot find module './registrable-domain'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/resolve/registrable-domain.ts

/**
 * Normalizes a domain for *matching* (de-self comparisons): lowercase, strip scheme,
 * leading "www.", port, and path. A full public-suffix-list eTLD+1 is a deferred refinement
 * (see spec) and is not needed to compare an anchor domain against a Brand Search hit.
 */
export function registrableDomain(domain: string | null | undefined): string {
  if (!domain) return "";
  const trimmed = domain.trim().toLowerCase();
  if (trimmed === "") return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  return host.replace(/^www\./, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/resolve/registrable-domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/resolve/registrable-domain.ts src/domain/resolve/registrable-domain.test.ts
git commit -m "feat(resolve): add registrableDomain matching utility"
```

---

## Task 2: Resolved Identity value objects + `assemble`

**Files:**
- Create: `src/domain/resolve/own-domain.ts`
- Create: `src/domain/resolve/social-handle.ts`
- Create: `src/domain/resolve/brand-context.ts`
- Create: `src/domain/resolve/name-collision.ts`
- Create: `src/domain/resolve/resolved-identity.ts`
- Test: `src/domain/resolve/resolved-identity.test.ts`

- [ ] **Step 1: Write the value-object type modules**

```ts
// src/domain/resolve/own-domain.ts
export type DomainProvenance = "url_provided" | "brand_derived";
export type OwnDomain = { readonly domain: string; readonly provenance: DomainProvenance };
```

```ts
// src/domain/resolve/social-handle.ts
export type SocialHandle = {
  readonly platform: string;
  readonly handle: string;
  readonly url: string;
};
```

```ts
// src/domain/resolve/brand-context.ts
export type BrandContext = {
  readonly tagline: string | null;
  readonly mission: string | null;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly valueProposition: string | null;
  readonly targetAudienceSegments: readonly string[];
  readonly productsAndServices: readonly string[];
};

// A collision's mini brand-context has the same shape as the target's.
export type CollisionContext = BrandContext;
```

```ts
// src/domain/resolve/name-collision.ts
import type { CollisionContext } from "./brand-context";

export type NameCollision = {
  readonly brandId: string | null;
  readonly domain: string;
  readonly name: string;
  readonly context: CollisionContext | null; // null when its /v2/context call failed (Warning)
};
```

- [ ] **Step 2: Write the failing test**

```ts
// src/domain/resolve/resolved-identity.test.ts
import { describe, it, expect } from "vitest";
import { ResolvedIdentity } from "./resolved-identity";
import type { OwnDomain } from "./own-domain";
import type { SocialHandle } from "./social-handle";
import type { BrandContext } from "./brand-context";
import type { NameCollision } from "./name-collision";

const brandContext: BrandContext = {
  tagline: "Beauty membership",
  mission: null,
  description: "A Sydney beauty-membership startup",
  tags: ["beauty"],
  valueProposition: "Membership beauty",
  targetAudienceSegments: ["consumers"],
  productsAndServices: ["membership"],
};

describe("ResolvedIdentity.assemble", () => {
  it("composes name, own domains, handles, context, collisions and negative boost", () => {
    const ownDomains: OwnDomain[] = [{ domain: "getaglow.co", provenance: "url_provided" }];
    const handles: SocialHandle[] = [{ platform: "x", handle: "getaglow", url: "https://x.com/getaglow" }];
    const collisions: NameCollision[] = [
      { brandId: "b1", domain: "aglow.org", name: "Aglow International", context: null },
    ];

    const id = ResolvedIdentity.assemble({
      companyName: "Aglow",
      ownDomains,
      socialHandles: handles,
      brandContext,
      nameCollisions: collisions,
      negativeBoost: "Known look-alikes ...",
    });

    expect(id.companyName).toBe("Aglow");
    expect(id.ownDomains).toEqual(ownDomains);
    expect(id.socialHandles).toEqual(handles);
    expect(id.brandContext).toEqual(brandContext);
    expect(id.nameCollisions).toEqual(collisions);
    expect(id.negativeBoost).toBe("Known look-alikes ...");
  });

  it("freezes its arrays so later stages cannot mutate the anchor", () => {
    const id = ResolvedIdentity.assemble({
      companyName: "Aglow",
      ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
      socialHandles: [],
      brandContext: null,
      nameCollisions: [],
      negativeBoost: "",
    });
    expect(() => (id.ownDomains as OwnDomain[]).push({ domain: "x.com", provenance: "brand_derived" })).toThrow();
    expect(Object.isFrozen(id)).toBe(true);
  });

  it("rejects a blank company name (the anchor always yields at least a name)", () => {
    expect(() =>
      ResolvedIdentity.assemble({
        companyName: "  ",
        ownDomains: [],
        socialHandles: [],
        brandContext: null,
        nameCollisions: [],
        negativeBoost: "",
      }),
    ).toThrow(/company name/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/resolve/resolved-identity.test.ts`
Expected: FAIL — `Cannot find module './resolved-identity'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/domain/resolve/resolved-identity.ts
import type { OwnDomain } from "./own-domain";
import type { SocialHandle } from "./social-handle";
import type { BrandContext } from "./brand-context";
import type { NameCollision } from "./name-collision";

export type ResolvedIdentityParts = {
  companyName: string;
  ownDomains: readonly OwnDomain[];
  socialHandles: readonly SocialHandle[];
  brandContext: BrandContext | null;
  nameCollisions: readonly NameCollision[];
  negativeBoost: string;
};

/** Immutable, job-scoped anchor produced once per Job by the Resolve stage. */
export class ResolvedIdentity {
  readonly companyName: string;
  readonly ownDomains: readonly OwnDomain[];
  readonly socialHandles: readonly SocialHandle[];
  readonly brandContext: BrandContext | null;
  readonly nameCollisions: readonly NameCollision[];
  readonly negativeBoost: string;

  private constructor(parts: ResolvedIdentityParts) {
    this.companyName = parts.companyName;
    this.ownDomains = Object.freeze([...parts.ownDomains]);
    this.socialHandles = Object.freeze([...parts.socialHandles]);
    this.brandContext = parts.brandContext;
    this.nameCollisions = Object.freeze([...parts.nameCollisions]);
    this.negativeBoost = parts.negativeBoost;
    Object.freeze(this);
  }

  static assemble(parts: ResolvedIdentityParts): ResolvedIdentity {
    if (parts.companyName.trim() === "") {
      throw new Error("ResolvedIdentity requires a non-empty company name");
    }
    return new ResolvedIdentity(parts);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/resolve/resolved-identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/resolve/own-domain.ts src/domain/resolve/social-handle.ts src/domain/resolve/brand-context.ts src/domain/resolve/name-collision.ts src/domain/resolve/resolved-identity.ts src/domain/resolve/resolved-identity.test.ts
git commit -m "feat(resolve): add ResolvedIdentity value object and assemble"
```

---

## Task 3: `deriveNegativeBoost` (pure, zero-LLM — ADR 0001)

**Files:**
- Create: `src/domain/resolve/negative-boost.ts`
- Test: `src/domain/resolve/negative-boost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/resolve/negative-boost.test.ts
import { describe, it, expect } from "vitest";
import { deriveNegativeBoost } from "./negative-boost";
import type { NameCollision } from "./name-collision";

const ctx = (over: Partial<NameCollision["context"]> = {}) => ({
  tagline: null,
  mission: null,
  description: "desc",
  tags: [],
  valueProposition: "VP",
  targetAudienceSegments: ["aud"],
  productsAndServices: ["svc"],
  ...over,
});

describe("deriveNegativeBoost", () => {
  it("returns empty string when there are no collisions", () => {
    expect(deriveNegativeBoost([])).toBe("");
  });

  it("emits the assertive header and one line per look-alike", () => {
    const collisions: NameCollision[] = [
      { brandId: "b1", domain: "aglow.org", name: "Aglow International", context: ctx({ valueProposition: "A global Christian ministry" }) },
      { brandId: "b2", domain: "homeaglow.com", name: "HomeAglow", context: ctx({ valueProposition: "Home-cleaning marketplace" }) },
    ];
    const boost = deriveNegativeBoost(collisions);
    expect(boost).toMatch(/NOT the target — reject pages about these:/);
    expect(boost).toContain("Aglow International (aglow.org)");
    expect(boost).toContain("A global Christian ministry");
    expect(boost).toContain("HomeAglow (homeaglow.com)");
    expect(boost.trim().split("\n").length).toBe(3); // header + 2 lines
  });

  it("emits a name+domain-only line when a collision has no context", () => {
    const collisions: NameCollision[] = [
      { brandId: null, domain: "aglowair.example", name: "Aglow Air", context: null },
    ];
    const boost = deriveNegativeBoost(collisions);
    expect(boost).toContain("Aglow Air (aglowair.example)");
  });

  it("is synchronous and takes no injected dependency (structural zero-LLM proof)", () => {
    // deriveNegativeBoost has arity 1 (collisions only) and returns a string, not a Promise.
    expect(deriveNegativeBoost.length).toBe(1);
    const out = deriveNegativeBoost([]);
    expect(out).not.toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/resolve/negative-boost.test.ts`
Expected: FAIL — `Cannot find module './negative-boost'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/resolve/negative-boost.ts
import type { NameCollision } from "./name-collision";

const HEADER = "Known look-alikes sharing this name that are NOT the target — reject pages about these:";

/**
 * ADR 0001: the Negative Boost is the collisions' own Brand Contexts *collected* into a compact
 * one-line-per-look-alike list — NOT pre-computed per-collision diffs. Pure, synchronous, no LLM,
 * no injected dependency. Zero Resolve-time LLM cost is a structural property of this signature.
 */
export function deriveNegativeBoost(collisions: readonly NameCollision[]): string {
  if (collisions.length === 0) return "";
  const lines = collisions.map((c) => {
    const head = `- ${c.name} (${c.domain})`;
    if (!c.context) return head;
    const gist = c.context.valueProposition ?? c.context.description ?? "";
    const offers = c.context.productsAndServices.length ? `; offers ${c.context.productsAndServices.join(", ")}` : "";
    const aud = c.context.targetAudienceSegments.length ? `; for ${c.context.targetAudienceSegments.join(", ")}` : "";
    return `${head}: ${gist}${offers}${aud}`;
  });
  return `${HEADER}\n${lines.join("\n")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/resolve/negative-boost.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/resolve/negative-boost.ts src/domain/resolve/negative-boost.test.ts
git commit -m "feat(resolve): derive Negative Boost from collected collision contexts (ADR 0001)"
```

---

## Task 4: `deSelfCollisions` (correctness — drop the target)

**Files:**
- Create: `src/domain/resolve/de-self.ts`
- Test: `src/domain/resolve/de-self.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/resolve/de-self.test.ts
import { describe, it, expect } from "vitest";
import { deSelfCollisions, type BrandSearchHitLike, type CanonicalBrandLike } from "./de-self";

const hit = (over: Partial<BrandSearchHitLike>): BrandSearchHitLike => ({
  brandId: null, name: "Aglow", domain: null, relevance: null, ...over,
});

describe("deSelfCollisions", () => {
  it("drops the hit whose brandId equals the canonical brand (strongest)", () => {
    const hits = [hit({ brandId: "target", domain: "getaglow.co" }), hit({ brandId: "other", domain: "aglow.org" })];
    const brand: CanonicalBrandLike = { brandId: "target", primaryDomain: "getaglow.co" };
    const { collisions, inferredTarget } = deSelfCollisions(hits, brand, null);
    expect(collisions.map((c) => c.brandId)).toEqual(["other"]);
    expect(inferredTarget).toBe(false);
  });

  it("falls back to registrable-domain match when there is no brandId key", () => {
    const hits = [hit({ domain: "www.getaglow.co" }), hit({ domain: "homeaglow.com" })];
    const brand: CanonicalBrandLike = { brandId: null, primaryDomain: "getaglow.co" };
    const { collisions } = deSelfCollisions(hits, brand, null);
    expect(collisions.map((c) => c.domain)).toEqual(["homeaglow.com"]);
  });

  it("uses the anchor domain when the brand has no primary domain", () => {
    const hits = [hit({ domain: "getaglow.co" }), hit({ domain: "aglow.org" })];
    const { collisions } = deSelfCollisions(hits, { brandId: null, primaryDomain: null }, "getaglow.co");
    expect(collisions.map((c) => c.domain)).toEqual(["aglow.org"]);
  });

  it("infers the top relevance hit as the target for a name-only anchor with no key", () => {
    const hits = [
      hit({ name: "Aglow", domain: "aglow.org", relevance: 0.5 }),
      hit({ name: "Aglow Inc", domain: "getaglow.co", relevance: 0.9 }),
    ];
    const { collisions, inferredTarget } = deSelfCollisions(hits, { brandId: null, primaryDomain: null }, null);
    expect(inferredTarget).toBe(true);
    expect(collisions.map((c) => c.domain)).toEqual(["aglow.org"]); // top (0.9) dropped as target
  });

  it("keeps a hit that matches neither key", () => {
    const hits = [hit({ brandId: "x", domain: "aglow.org" })];
    const { collisions } = deSelfCollisions(hits, { brandId: "target", primaryDomain: "getaglow.co" }, null);
    expect(collisions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/resolve/de-self.test.ts`
Expected: FAIL — `Cannot find module './de-self'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/resolve/de-self.ts
import { registrableDomain } from "./registrable-domain";

// Structural shapes (the ports' return types satisfy these; kept local so the domain has no port import).
export type BrandSearchHitLike = {
  brandId: string | null;
  name: string;
  domain: string | null;
  relevance: number | null;
};
export type CanonicalBrandLike = { brandId: string | null; primaryDomain: string | null };

export type DeSelfResult = {
  collisions: BrandSearchHitLike[];
  inferredTarget: boolean;
};

/**
 * Removes the target itself from a Brand Search hit set before the Negative Boost is derived.
 * brandId match (strongest) → registrable-domain match (fallback) → name-only top-relevance
 * inference (sets inferredTarget so the caller raises the collision_target_inferred Warning).
 */
export function deSelfCollisions(
  hits: readonly BrandSearchHitLike[],
  brand: CanonicalBrandLike,
  anchorDomain: string | null,
): DeSelfResult {
  if (hits.length === 0) return { collisions: [], inferredTarget: false };

  if (brand.brandId) {
    return { collisions: hits.filter((h) => h.brandId !== brand.brandId), inferredTarget: false };
  }

  const targetDomain = registrableDomain(brand.primaryDomain ?? anchorDomain);
  if (targetDomain !== "") {
    return { collisions: hits.filter((h) => registrableDomain(h.domain) !== targetDomain), inferredTarget: false };
  }

  // Name-only with no resolvable key: infer the single best hit as the target and Warn.
  const top = hits.reduce((best, h) => ((h.relevance ?? 0) > (best.relevance ?? 0) ? h : best), hits[0]);
  return { collisions: hits.filter((h) => h !== top), inferredTarget: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/resolve/de-self.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/resolve/de-self.ts src/domain/resolve/de-self.test.ts
git commit -m "feat(resolve): de-self the collision set against the resolved anchor"
```

---

## Task 5: Resolve Warning closed set

**Files:**
- Create: `src/domain/resolve/resolve-warnings.ts`
- Test: `src/domain/resolve/resolve-warnings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/resolve/resolve-warnings.test.ts
import { describe, it, expect } from "vitest";
import { RESOLVE_WARNING, resolveWarnings } from "./resolve-warnings";

describe("resolve warnings", () => {
  it("exposes the closed set of resolve warning types", () => {
    expect(Object.values(RESOLVE_WARNING).sort()).toEqual(
      [
        "resolve.brand_context_absent",
        "resolve.collision_context_fetch_failed",
        "resolve.collision_target_inferred",
        "resolve.homepage_fetch_failed",
        "resolve.homepage_unresolved",
      ].sort(),
    );
  });

  it("builders produce a Warning with the matching type and a non-empty message", () => {
    const w = resolveWarnings.homepageUnresolved();
    expect(w.type).toBe(RESOLVE_WARNING.homepageUnresolved);
    expect(w.message.length).toBeGreaterThan(0);
  });

  it("collision fetch failure builder records a count, never scraped text", () => {
    const w = resolveWarnings.collisionContextFetchFailed(3);
    expect(w.type).toBe(RESOLVE_WARNING.collisionContextFetchFailed);
    expect(w.message).toContain("3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/domain/resolve/resolve-warnings.test.ts`
Expected: FAIL — `Cannot find module './resolve-warnings'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/resolve/resolve-warnings.ts
import type { Warning } from "../job/warning";

export const RESOLVE_WARNING = {
  homepageUnresolved: "resolve.homepage_unresolved",
  homepageFetchFailed: "resolve.homepage_fetch_failed",
  brandContextAbsent: "resolve.brand_context_absent",
  collisionContextFetchFailed: "resolve.collision_context_fetch_failed",
  collisionTargetInferred: "resolve.collision_target_inferred",
} as const;

// Messages carry counts/identifiers only — never scraped page text or raw payloads (anti-echo).
export const resolveWarnings = {
  homepageUnresolved: (): Warning => ({
    type: RESOLVE_WARNING.homepageUnresolved,
    message: "No homepage resolved; proceeding without own domains or scraped handles.",
  }),
  homepageFetchFailed: (): Warning => ({
    type: RESOLVE_WARNING.homepageFetchFailed,
    message: "Homepage fetch failed; kept the supplied host as an own domain, handles not scraped, name not confirmed.",
  }),
  brandContextAbsent: (): Warning => ({
    type: RESOLVE_WARNING.brandContextAbsent,
    message: "No Brand Context resolved for the target; Verify runs without positive context.",
  }),
  collisionContextFetchFailed: (count: number): Warning => ({
    type: RESOLVE_WARNING.collisionContextFetchFailed,
    message: `${count} Name Collision context fetch(es) failed; affected collisions carry no mini-context.`,
  }),
  collisionTargetInferred: (): Warning => ({
    type: RESOLVE_WARNING.collisionTargetInferred,
    message: "Name-only anchor: target was inferred (not exactly matched) when de-selfing the collision set.",
  }),
};
```

> **Note:** Confirm the import path/shape of `Warning` against Foundation's `src/domain/job/warning.ts`. If Foundation exports `Warning` from a different path, fix the import here and in later tasks.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/domain/resolve/resolve-warnings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/resolve/resolve-warnings.ts src/domain/resolve/resolve-warnings.test.ts
git commit -m "feat(resolve): add closed Resolve Warning set and builders"
```

---

## Task 6: The four ports + repository port (interfaces)

**Files:**
- Create: `src/application/resolve/ports/brand-search.port.ts`
- Create: `src/application/resolve/ports/brand.port.ts`
- Create: `src/application/resolve/ports/brand-context.port.ts`
- Create: `src/application/resolve/ports/homepage-fetch.port.ts`
- Create: `src/application/resolve/ports/resolved-identity-repository.port.ts`

These are pure interfaces (no runtime behaviour) — verification is a clean `tsc`, not a Vitest run.

- [ ] **Step 1: Write the port interfaces and DI tokens**

```ts
// src/application/resolve/ports/brand-search.port.ts
export type BrandSearchHit = {
  brandId: string | null;
  name: string;
  domain: string | null;
  relevance: number | null;
};

/** Discovers Name Collisions for a company name. Shared with PRD 7 input-time autocomplete. */
export interface BrandSearchPort {
  search(name: string): Promise<BrandSearchHit[]>; // [] on empty/failure — never throws
}

export const BRAND_SEARCH_PORT = Symbol("BrandSearchPort");
```

```ts
// src/application/resolve/ports/brand.port.ts
export type CanonicalBrand = {
  brandId: string | null;
  name: string | null;
  primaryDomain: string | null;
};

/** Resolves the canonical brand for the anchor (by domain or brandId). */
export interface BrandPort {
  resolveBrand(ref: { domain?: string; brandId?: string }): Promise<CanonicalBrand | null>;
}

export const BRAND_PORT = Symbol("BrandPort");
```

```ts
// src/application/resolve/ports/brand-context.port.ts
import type { BrandContext } from "../../../domain/resolve/brand-context";

/** Domain-keyed Brand Context — used for the target and once per collision. */
export interface BrandContextPort {
  fetchContext(domain: string): Promise<BrandContext | null>; // null on absent/failure
}

export const BRAND_CONTEXT_PORT = Symbol("BrandContextPort");
```

```ts
// src/application/resolve/ports/homepage-fetch.port.ts
import type { SocialHandle } from "../../../domain/resolve/social-handle";

export type HomepageFetchResult = {
  confirmedName: string | null;
  handles: SocialHandle[];
};

/** The ONE sanctioned outbound HTTP fetch in Breakbeat. */
export interface HomepageFetchPort {
  fetch(domain: string): Promise<HomepageFetchResult | null>; // null on fetch failure
}

export const HOMEPAGE_FETCH_PORT = Symbol("HomepageFetchPort");
```

```ts
// src/application/resolve/ports/resolved-identity-repository.port.ts
import type { ResolvedIdentity } from "../../../domain/resolve/resolved-identity";

export interface ResolvedIdentityRepository {
  save(jobId: string, identity: ResolvedIdentity): Promise<void>;
  findByJobId(jobId: string): Promise<ResolvedIdentity | null>;
}

export const RESOLVED_IDENTITY_REPOSITORY = Symbol("ResolvedIdentityRepository");
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from the new port files.

- [ ] **Step 3: Commit**

```bash
git add src/application/resolve/ports/
git commit -m "feat(resolve): declare Brand Search/Brand/Brand Context/Homepage ports and repo port"
```

---

## Task 7: `resolveAnchorDomain` (anchor resolution order)

**Files:**
- Create: `src/application/resolve/resolve-anchor-domain.ts`
- Test: `src/application/resolve/resolve-anchor-domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/application/resolve/resolve-anchor-domain.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveAnchorDomain } from "./resolve-anchor-domain";
import type { BrandPort } from "./ports/brand.port";
import type { CompanyAnchor } from "../../domain/job/company-anchor";

const fakeBrandPort = (domain: string | null): BrandPort => ({
  resolveBrand: vi.fn(async () => ({ brandId: "b1", name: "Aglow", primaryDomain: domain })),
});

describe("resolveAnchorDomain", () => {
  it("uses the anchor domain directly with url_provided provenance", async () => {
    const anchor: CompanyAnchor = { kind: "disambiguated", domain: "getaglow.co", brandId: null, provenance: "url_provided" };
    const brandPort = fakeBrandPort("getaglow.co");
    const out = await resolveAnchorDomain(anchor, brandPort);
    expect(out.domain).toBe("getaglow.co");
    expect(out.ownDomain).toEqual({ domain: "getaglow.co", provenance: "url_provided" });
    expect(out.canonicalBrand?.brandId).toBe("b1"); // still resolves the brand for de-self + name
  });

  it("resolves a brand-id-only anchor to a domain via the Brand port (brand_derived)", async () => {
    const anchor: CompanyAnchor = { kind: "disambiguated", domain: null, brandId: "b1", provenance: "picked" };
    const out = await resolveAnchorDomain(anchor, fakeBrandPort("getaglow.co"));
    expect(out.domain).toBe("getaglow.co");
    expect(out.ownDomain).toEqual({ domain: "getaglow.co", provenance: "brand_derived" });
  });

  it("returns no domain for a name-only anchor (genuine degraded trigger)", async () => {
    const anchor: CompanyAnchor = { kind: "name_only", name: "Aglow", provenance: "name_only" };
    const out = await resolveAnchorDomain(anchor, fakeBrandPort(null));
    expect(out.domain).toBeNull();
    expect(out.ownDomain).toBeNull();
  });

  it("returns no domain when a brand-id anchor resolves no primary domain", async () => {
    const anchor: CompanyAnchor = { kind: "disambiguated", domain: null, brandId: "b1", provenance: "picked" };
    const out = await resolveAnchorDomain(anchor, fakeBrandPort(null));
    expect(out.domain).toBeNull();
    expect(out.ownDomain).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/resolve/resolve-anchor-domain.test.ts`
Expected: FAIL — `Cannot find module './resolve-anchor-domain'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/resolve/resolve-anchor-domain.ts
import type { CompanyAnchor } from "../../domain/job/company-anchor";
import type { OwnDomain } from "../../domain/resolve/own-domain";
import type { BrandPort, CanonicalBrand } from "./ports/brand.port";

export type AnchorResolution = {
  domain: string | null;
  ownDomain: OwnDomain | null;
  canonicalBrand: CanonicalBrand | null;
  anchorName: string | null; // name_only carries a name; disambiguated does not
};

/**
 * Anchor resolution order (PRD): (1) anchor domain; (2) brand-id → Brand port → primary domain;
 * (3) neither → genuine name-only degraded path. A disambiguated brand-id is a STRONG anchor and
 * gets the full treatment — never treated as degraded just because it stored an id.
 */
export async function resolveAnchorDomain(anchor: CompanyAnchor, brandPort: BrandPort): Promise<AnchorResolution> {
  if (anchor.kind === "name_only") {
    const canonicalBrand = await brandPort.resolveBrand({}).catch(() => null);
    return { domain: null, ownDomain: null, canonicalBrand, anchorName: anchor.name };
  }

  if (anchor.domain) {
    const canonicalBrand = await brandPort.resolveBrand({ domain: anchor.domain });
    return {
      domain: anchor.domain,
      ownDomain: { domain: anchor.domain, provenance: "url_provided" },
      canonicalBrand,
      anchorName: null,
    };
  }

  if (anchor.brandId) {
    const canonicalBrand = await brandPort.resolveBrand({ brandId: anchor.brandId });
    const domain = canonicalBrand?.primaryDomain ?? null;
    return {
      domain,
      ownDomain: domain ? { domain, provenance: "brand_derived" } : null,
      canonicalBrand,
      anchorName: null,
    };
  }

  return { domain: null, ownDomain: null, canonicalBrand: null, anchorName: null };
}
```

> The name-only branch passes `{}` to `resolveBrand`; the adapter returns `null` for an empty ref (no domain/brandId to look up). The `.catch(() => null)` keeps a misbehaving fake from failing the pure path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/resolve/resolve-anchor-domain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/resolve/resolve-anchor-domain.ts src/application/resolve/resolve-anchor-domain.test.ts
git commit -m "feat(resolve): resolve the frozen anchor to a working domain"
```

---

## Task 8: `assembleResolvedIdentity` (pure composition)

**Files:**
- Create: `src/application/resolve/assemble-resolved-identity.ts`
- Test: `src/application/resolve/assemble-resolved-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/application/resolve/assemble-resolved-identity.test.ts
import { describe, it, expect } from "vitest";
import { assembleResolvedIdentity, type AssemblyInput } from "./assemble-resolved-identity";
import { RESOLVE_WARNING } from "../../domain/resolve/resolve-warnings";

const base: AssemblyInput = {
  canonicalBrandName: "Aglow",
  homepageConfirmedName: null,
  anchorName: null,
  anchorDomainForName: "getaglow.co",
  ownDomain: { domain: "getaglow.co", provenance: "url_provided" },
  handles: [],
  brandContext: {
    tagline: null, mission: null, description: "d", tags: [],
    valueProposition: "vp", targetAudienceSegments: [], productsAndServices: [],
  },
  collisions: [{ brandId: "x", domain: "aglow.org", name: "Aglow International", context: null }],
  flags: { homepageUnresolved: false, homepageFetchFailed: false, collisionContextFailures: 0, targetInferred: false },
};

describe("assembleResolvedIdentity", () => {
  it("prefers the canonical brand name, then homepage, then anchor name, then domain", () => {
    expect(assembleResolvedIdentity(base).identity.companyName).toBe("Aglow");
    expect(assembleResolvedIdentity({ ...base, canonicalBrandName: null, homepageConfirmedName: "Aglow HP" }).identity.companyName).toBe("Aglow HP");
    expect(assembleResolvedIdentity({ ...base, canonicalBrandName: null, homepageConfirmedName: null, anchorName: "Aglow Name" }).identity.companyName).toBe("Aglow Name");
    expect(assembleResolvedIdentity({ ...base, canonicalBrandName: null, homepageConfirmedName: null, anchorName: null }).identity.companyName).toBe("getaglow.co");
  });

  it("derives the negative boost from the collisions", () => {
    const out = assembleResolvedIdentity(base);
    expect(out.identity.negativeBoost).toContain("Aglow International (aglow.org)");
  });

  it("emits the matching warnings from the flags", () => {
    const out = assembleResolvedIdentity({
      ...base,
      brandContext: null,
      flags: { homepageUnresolved: true, homepageFetchFailed: false, collisionContextFailures: 2, targetInferred: true },
    });
    const types = out.warnings.map((w) => w.type).sort();
    expect(types).toEqual(
      [
        RESOLVE_WARNING.brandContextAbsent,
        RESOLVE_WARNING.collisionContextFetchFailed,
        RESOLVE_WARNING.collisionTargetInferred,
        RESOLVE_WARNING.homepageUnresolved,
      ].sort(),
    );
  });

  it("includes the own domain when present and omits it when null", () => {
    expect(assembleResolvedIdentity(base).identity.ownDomains).toHaveLength(1);
    expect(assembleResolvedIdentity({ ...base, ownDomain: null }).identity.ownDomains).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/resolve/assemble-resolved-identity.test.ts`
Expected: FAIL — `Cannot find module './assemble-resolved-identity'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/resolve/assemble-resolved-identity.ts
import type { Warning } from "../../domain/job/warning";
import type { OwnDomain } from "../../domain/resolve/own-domain";
import type { SocialHandle } from "../../domain/resolve/social-handle";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { NameCollision } from "../../domain/resolve/name-collision";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { deriveNegativeBoost } from "../../domain/resolve/negative-boost";
import { resolveWarnings } from "../../domain/resolve/resolve-warnings";

export type AssemblyFlags = {
  homepageUnresolved: boolean;
  homepageFetchFailed: boolean;
  collisionContextFailures: number;
  targetInferred: boolean;
};

export type AssemblyInput = {
  canonicalBrandName: string | null;
  homepageConfirmedName: string | null;
  anchorName: string | null;
  anchorDomainForName: string | null; // last-resort name for a disambiguated anchor with nothing else
  ownDomain: OwnDomain | null;
  handles: readonly SocialHandle[];
  brandContext: BrandContext | null;
  collisions: readonly NameCollision[];
  flags: AssemblyFlags;
};

export type AssemblyOutput = { identity: ResolvedIdentity; warnings: Warning[] };

/** Pure composition of port outputs into one Resolved Identity + its Warnings. Never re-chooses. */
export function assembleResolvedIdentity(input: AssemblyInput): AssemblyOutput {
  const companyName =
    nonBlank(input.canonicalBrandName) ??
    nonBlank(input.homepageConfirmedName) ??
    nonBlank(input.anchorName) ??
    nonBlank(input.anchorDomainForName) ??
    "unknown";

  const identity = ResolvedIdentity.assemble({
    companyName,
    ownDomains: input.ownDomain ? [input.ownDomain] : [],
    socialHandles: input.handles,
    brandContext: input.brandContext,
    nameCollisions: input.collisions,
    negativeBoost: deriveNegativeBoost(input.collisions),
  });

  const warnings: Warning[] = [];
  if (input.flags.homepageUnresolved) warnings.push(resolveWarnings.homepageUnresolved());
  if (input.flags.homepageFetchFailed) warnings.push(resolveWarnings.homepageFetchFailed());
  if (input.brandContext === null) warnings.push(resolveWarnings.brandContextAbsent());
  if (input.flags.collisionContextFailures > 0)
    warnings.push(resolveWarnings.collisionContextFetchFailed(input.flags.collisionContextFailures));
  if (input.flags.targetInferred) warnings.push(resolveWarnings.collisionTargetInferred());

  return { identity, warnings };
}

function nonBlank(s: string | null): string | null {
  return s && s.trim() !== "" ? s : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/resolve/assemble-resolved-identity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/resolve/assemble-resolved-identity.ts src/application/resolve/assemble-resolved-identity.test.ts
git commit -m "feat(resolve): pure assembly of ResolvedIdentity and its Warnings"
```

---

## Task 9: Extend `RunContext` with the Resolved Identity slot

**Files:**
- Modify: `src/application/pipeline/run-context.ts`
- Test: `src/application/pipeline/run-context.test.ts` (create if Foundation didn't, else extend)

> Foundation reserved `// resolvedIdentity?: ResolvedIdentity // reserved for PRD 2`. This task fills the slot. Read the current `run-context.ts` first and adapt the edit to its concrete shape (it may be an interface plus a concrete factory). The code below assumes a concrete `createRunContext(job)` factory that returns the context object; adjust names to match Foundation.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/pipeline/run-context.test.ts (add these cases)
import { describe, it, expect } from "vitest";
import { createRunContext } from "./run-context";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
// import a Job test factory from Foundation's test helpers:
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper

const identity = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow", ownDomains: [], socialHandles: [],
    brandContext: null, nameCollisions: [], negativeBoost: "",
  });

describe("RunContext resolvedIdentity slot", () => {
  it("starts null and is readable after setResolvedIdentity", () => {
    const ctx = createRunContext(makeRunningJob());
    expect(ctx.resolvedIdentity).toBeNull();
    const id = identity();
    ctx.setResolvedIdentity(id);
    expect(ctx.resolvedIdentity).toBe(id);
  });

  it("throws if set twice in one run (single consistent anchor)", () => {
    const ctx = createRunContext(makeRunningJob());
    ctx.setResolvedIdentity(identity());
    expect(() => ctx.setResolvedIdentity(identity())).toThrow(/already set/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/pipeline/run-context.test.ts -t "resolvedIdentity"`
Expected: FAIL — `setResolvedIdentity is not a function` / `resolvedIdentity` undefined.

- [ ] **Step 3: Modify `run-context.ts`**

Add to the `RunContext` interface and its concrete implementation (merge into Foundation's existing definitions, do not duplicate the `job`/`recordWarning` members):

```ts
import type { ResolvedIdentity } from "../../domain/resolve/resolved-identity";

export interface RunContext {
  readonly job: Job;
  recordWarning(warning: Warning): void;
  readonly resolvedIdentity: ResolvedIdentity | null;
  setResolvedIdentity(identity: ResolvedIdentity): void;
}

export function createRunContext(job: Job): RunContext {
  let resolvedIdentity: ResolvedIdentity | null = null;
  return {
    job,
    recordWarning: (warning) => job.recordWarning(warning),
    get resolvedIdentity() {
      return resolvedIdentity;
    },
    setResolvedIdentity(identity) {
      if (resolvedIdentity !== null) {
        throw new Error("ResolvedIdentity already set for this run");
      }
      resolvedIdentity = identity;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/pipeline/run-context.test.ts`
Expected: PASS (existing Foundation cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/application/pipeline/run-context.ts src/application/pipeline/run-context.test.ts
git commit -m "feat(resolve): add resolvedIdentity slot to RunContext (set-once per run)"
```

---

## Task 10: `ResolveStage` orchestration (happy path + every degraded path)

**Files:**
- Create: `src/application/resolve/resolve.stage.ts`
- Test: `src/application/resolve/resolve.stage.test.ts`

> The only impure unit. It composes the four ports + the repository and threads the result onto `RunContext`. Tested entirely with fakes.

- [ ] **Step 1: Write the failing test**

```ts
// src/application/resolve/resolve.stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { ResolveStage } from "./resolve.stage";
import { createRunContext } from "../pipeline/run-context";
import { makeRunningJob } from "../../domain/job/job.test-helpers"; // adjust to Foundation's helper
import { RESOLVE_WARNING } from "../../domain/resolve/resolve-warnings";
import type { BrandSearchPort } from "./ports/brand-search.port";
import type { BrandPort } from "./ports/brand.port";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { HomepageFetchPort } from "./ports/homepage-fetch.port";
import type { ResolvedIdentityRepository } from "./ports/resolved-identity-repository.port";
import type { CompanyAnchor } from "../../domain/job/company-anchor";

const ctxData = () => ({
  tagline: null, mission: null, description: "d", tags: [],
  valueProposition: "vp", targetAudienceSegments: [], productsAndServices: [],
});

type Fakes = {
  brandSearch: BrandSearchPort;
  brand: BrandPort;
  brandContext: BrandContextPort;
  homepage: HomepageFetchPort;
  repo: ResolvedIdentityRepository;
};

function makeFakes(over: Partial<Record<keyof Fakes, unknown>> = {}): Fakes {
  return {
    brandSearch: { search: vi.fn(async () => [{ brandId: "other", name: "Aglow International", domain: "aglow.org", relevance: 0.4 }]) },
    brand: { resolveBrand: vi.fn(async () => ({ brandId: "target", name: "Aglow", primaryDomain: "getaglow.co" })) },
    brandContext: { fetchContext: vi.fn(async () => ctxData()) },
    homepage: { fetch: vi.fn(async () => ({ confirmedName: "Aglow", handles: [{ platform: "x", handle: "getaglow", url: "https://x.com/getaglow" }] })) },
    repo: { save: vi.fn(async () => {}), findByJobId: vi.fn(async () => null) },
    ...(over as Fakes),
  };
}

const make = (f: Fakes) => new ResolveStage(f.brandSearch, f.brand, f.brandContext, f.homepage, f.repo);

const urlAnchor: CompanyAnchor = { kind: "disambiguated", domain: "getaglow.co", brandId: null, provenance: "url_provided" };
const nameAnchor: CompanyAnchor = { kind: "name_only", name: "Aglow", provenance: "name_only" };

describe("ResolveStage", () => {
  it("has name 'resolve'", () => {
    expect(make(makeFakes()).name).toBe("resolve");
  });

  it("happy path (domain anchor): full identity, no warnings, sets ctx, saves repo", async () => {
    const f = makeFakes();
    const ctx = createRunContext(makeRunningJob({ anchor: urlAnchor }));
    await make(f).run(ctx);

    const id = ctx.resolvedIdentity!;
    expect(id.companyName).toBe("Aglow");
    expect(id.ownDomains).toEqual([{ domain: "getaglow.co", provenance: "url_provided" }]);
    expect(id.socialHandles).toHaveLength(1);
    expect(id.brandContext).not.toBeNull();
    expect(id.nameCollisions).toHaveLength(1); // "other" survives de-self
    expect(id.negativeBoost).toContain("Aglow International");
    expect(ctx.job.warnings).toHaveLength(0);
    expect(f.repo.save).toHaveBeenCalledOnce();
  });

  it("name-only, no homepage: degraded with homepage_unresolved warning, proceeds", async () => {
    const f = makeFakes({
      brand: { resolveBrand: vi.fn(async () => null) },
      homepage: { fetch: vi.fn(async () => null) },
      brandSearch: { search: vi.fn(async () => [
        { brandId: null, name: "Aglow", domain: "aglow.org", relevance: 0.9 },
        { brandId: null, name: "HomeAglow", domain: "homeaglow.com", relevance: 0.3 },
      ]) },
    });
    const ctx = createRunContext(makeRunningJob({ anchor: nameAnchor }));
    await make(f).run(ctx);

    const id = ctx.resolvedIdentity!;
    expect(id.companyName).toBe("Aglow");
    expect(id.ownDomains).toHaveLength(0);
    expect(id.socialHandles).toHaveLength(0);
    expect(id.brandContext).toBeNull();
    const types = ctx.job.warnings.map((w) => w.type);
    expect(types).toContain(RESOLVE_WARNING.homepageUnresolved);
    expect(types).toContain(RESOLVE_WARNING.collisionTargetInferred); // top hit inferred as target
    expect(f.homepage.fetch).not.toHaveBeenCalled();
  });

  it("url-provided, homepage fetch fails: keeps host as own domain, warns, proceeds", async () => {
    const f = makeFakes({ homepage: { fetch: vi.fn(async () => null) } });
    const ctx = createRunContext(makeRunningJob({ anchor: urlAnchor }));
    await make(f).run(ctx);

    const id = ctx.resolvedIdentity!;
    expect(id.ownDomains).toEqual([{ domain: "getaglow.co", provenance: "url_provided" }]);
    expect(id.socialHandles).toHaveLength(0);
    expect(ctx.job.warnings.map((w) => w.type)).toContain(RESOLVE_WARNING.homepageFetchFailed);
  });

  it("absent target brand context: warns, proceeds without positioning", async () => {
    const f = makeFakes({ brandContext: { fetchContext: vi.fn(async (d: string) => (d === "getaglow.co" ? null : ctxData())) } });
    const ctx = createRunContext(makeRunningJob({ anchor: urlAnchor }));
    await make(f).run(ctx);
    expect(ctx.resolvedIdentity!.brandContext).toBeNull();
    expect(ctx.job.warnings.map((w) => w.type)).toContain(RESOLVE_WARNING.brandContextAbsent);
  });

  it("a collision context fetch failing: that collision has null context, one aggregate warning", async () => {
    const f = makeFakes({
      brandSearch: { search: vi.fn(async () => [
        { brandId: "c1", name: "HomeAglow", domain: "homeaglow.com", relevance: 0.4 },
        { brandId: "c2", name: "Aglow Air", domain: "aglowair.example", relevance: 0.2 },
      ]) },
      brandContext: { fetchContext: vi.fn(async (d: string) => (d === "aglowair.example" ? null : ctxData())) },
    });
    const ctx = createRunContext(makeRunningJob({ anchor: urlAnchor }));
    await make(f).run(ctx);
    const collisions = ctx.resolvedIdentity!.nameCollisions;
    expect(collisions.find((c) => c.domain === "aglowair.example")!.context).toBeNull();
    expect(collisions.find((c) => c.domain === "homeaglow.com")!.context).not.toBeNull();
    expect(ctx.job.warnings.map((w) => w.type)).toContain(RESOLVE_WARNING.collisionContextFetchFailed);
  });

  it("re-run semantics: company identity comes from the frozen anchor, never re-chosen from search", async () => {
    // brand search returns a different top company; identity name must still come from the anchor's brand.
    const f = makeFakes({
      brand: { resolveBrand: vi.fn(async () => ({ brandId: "target", name: "Aglow", primaryDomain: "getaglow.co" })) },
      brandSearch: { search: vi.fn(async () => [{ brandId: "other", name: "HomeAglow", domain: "homeaglow.com", relevance: 0.99 }]) },
    });
    const ctx = createRunContext(makeRunningJob({ anchor: urlAnchor }));
    await make(f).run(ctx);
    expect(ctx.resolvedIdentity!.companyName).toBe("Aglow");
  });

  it("structural zero-LLM guarantee: stage takes only the 4 ports + repo (no Anthropic dep)", () => {
    expect(ResolveStage.length).toBe(5); // brandSearch, brand, brandContext, homepage, repo
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/application/resolve/resolve.stage.test.ts`
Expected: FAIL — `Cannot find module './resolve.stage'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/application/resolve/resolve.stage.ts
import type { Stage } from "../pipeline/stage.port";
import type { RunContext } from "../pipeline/run-context";
import type { BrandSearchPort } from "./ports/brand-search.port";
import type { BrandPort } from "./ports/brand.port";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { HomepageFetchPort } from "./ports/homepage-fetch.port";
import type { ResolvedIdentityRepository } from "./ports/resolved-identity-repository.port";
import type { NameCollision } from "../../domain/resolve/name-collision";
import type { SocialHandle } from "../../domain/resolve/social-handle";
import { deSelfCollisions } from "../../domain/resolve/de-self";
import { resolveAnchorDomain } from "./resolve-anchor-domain";
import { assembleResolvedIdentity, type AssemblyFlags } from "./assemble-resolved-identity";

export class ResolveStage implements Stage {
  readonly name = "resolve";

  constructor(
    private readonly brandSearch: BrandSearchPort,
    private readonly brand: BrandPort,
    private readonly brandContext: BrandContextPort,
    private readonly homepage: HomepageFetchPort,
    private readonly repo: ResolvedIdentityRepository,
  ) {}

  async run(ctx: RunContext): Promise<void> {
    const anchor = ctx.job.anchor;
    const flags: AssemblyFlags = {
      homepageUnresolved: false,
      homepageFetchFailed: false,
      collisionContextFailures: 0,
      targetInferred: false,
    };

    // 1. Resolve the anchor to a working domain (+ canonical brand for name & de-self).
    const resolution = await resolveAnchorDomain(anchor, this.brand);

    // 2 & 3. Target Brand Context + the one true homepage fetch (only when we have a domain).
    let brandContext = null;
    let handles: SocialHandle[] = [];
    let homepageConfirmedName: string | null = null;

    if (resolution.domain) {
      brandContext = await this.brandContext.fetchContext(resolution.domain);
      const homepage = await this.homepage.fetch(resolution.domain);
      if (homepage) {
        handles = homepage.handles;
        homepageConfirmedName = homepage.confirmedName;
      } else {
        // url-provided host given but fetch failed → keep host, warn (handles not scraped).
        flags.homepageFetchFailed = true;
      }
    } else {
      // genuine name-only / no domain → no homepage to fetch.
      flags.homepageUnresolved = true;
    }

    // 4. Discover + de-self collisions.
    const companyNameForSearch = resolution.canonicalBrand?.name ?? resolution.anchorName ?? "";
    const hits = companyNameForSearch ? await this.brandSearch.search(companyNameForSearch) : [];
    const { collisions: candidates, inferredTarget } = deSelfCollisions(
      hits,
      { brandId: resolution.canonicalBrand?.brandId ?? null, primaryDomain: resolution.canonicalBrand?.primaryDomain ?? null },
      resolution.domain,
    );
    flags.targetInferred = inferredTarget;

    // 5. Per-collision context (concurrent, individually failure-tolerant).
    const collisions: NameCollision[] = await Promise.all(
      candidates.map(async (hit) => {
        const context = hit.domain ? await this.brandContext.fetchContext(hit.domain) : null;
        if (hit.domain && context === null) flags.collisionContextFailures += 1;
        return { brandId: hit.brandId, domain: hit.domain ?? "", name: hit.name, context };
      }),
    );

    // 6. Assemble + record warnings.
    const { identity, warnings } = assembleResolvedIdentity({
      canonicalBrandName: resolution.canonicalBrand?.name ?? null,
      homepageConfirmedName,
      anchorName: resolution.anchorName,
      anchorDomainForName: resolution.domain,
      ownDomain: resolution.ownDomain,
      handles,
      brandContext,
      collisions,
      flags,
    });
    for (const w of warnings) ctx.recordWarning(w);

    // 7 & 8. Hand off in-process + persist for PRD 7 / re-run read model.
    ctx.setResolvedIdentity(identity);
    await this.repo.save(ctx.job.id, identity);
  }
}
```

> Adjust `ctx.job.anchor`, `ctx.job.id`, and `ctx.job.warnings` accessors to Foundation's actual `Job` API (its spec exposes `anchor` read-only and an id; the warnings list may be `job.warnings` or a getter). The `Stage` import path must match Foundation's `stage.port.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/application/resolve/resolve.stage.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/resolve/resolve.stage.ts src/application/resolve/resolve.stage.test.ts
git commit -m "feat(resolve): ResolveStage orchestration with degraded-path Warnings"
```

---

## Task 11: Shared BrandFetch HTTP client

**Files:**
- Create: `src/infrastructure/brandfetch/brandfetch.config.ts`
- Create: `src/infrastructure/brandfetch/brandfetch.http.ts`
- Test: `src/infrastructure/brandfetch/brandfetch.http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/brandfetch/brandfetch.http.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { BrandfetchHttp } from "./brandfetch.http";

const config = { apiKey: "key", baseUrl: "https://api.brandfetch.io/v2", timeoutMs: 50 };

afterEach(() => vi.unstubAllGlobals());

describe("BrandfetchHttp.getJson", () => {
  it("sends a Bearer-authenticated GET to baseUrl + path and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const http = new BrandfetchHttp(config);
    const out = await http.getJson("/search/Aglow");
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brandfetch.io/v2/search/Aglow");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer key" });
  });

  it("returns null on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await new BrandfetchHttp(config).getJson("/x")).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await new BrandfetchHttp(config).getJson("/x")).toBeNull();
  });

  it("returns null on timeout (AbortError)", async () => {
    vi.stubGlobal("fetch", vi.fn((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    ));
    expect(await new BrandfetchHttp({ ...config, timeoutMs: 10 }).getJson("/x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brandfetch.http.test.ts`
Expected: FAIL — `Cannot find module './brandfetch.http'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/brandfetch/brandfetch.config.ts
export type BrandfetchConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

export const BRANDFETCH_CONFIG = Symbol("BrandfetchConfig");
```

```ts
// src/infrastructure/brandfetch/brandfetch.http.ts
import type { BrandfetchConfig } from "./brandfetch.config";

/**
 * Shared GET-with-timeout + Bearer auth over global fetch. Translates every transport failure
 * (non-2xx, network error, timeout) into `null` so callers branch on values, never exceptions.
 */
export class BrandfetchHttp {
  constructor(private readonly config: BrandfetchConfig) {}

  async getJson(path: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null; // network error or AbortError (timeout) — degraded-path signal
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brandfetch.http.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/brandfetch/brandfetch.config.ts src/infrastructure/brandfetch/brandfetch.http.ts src/infrastructure/brandfetch/brandfetch.http.test.ts
git commit -m "feat(resolve): shared BrandFetch HTTP client with fail-soft GET"
```

---

## Task 12: Brand Search adapter

**Files:**
- Create: `src/infrastructure/brandfetch/brand-search.adapter.ts`
- Test: `src/infrastructure/brandfetch/brand-search.adapter.test.ts`

> The BrandFetch Brand Search endpoint is `GET /v2/search/{query}` returning an array of brand summaries. The Zod schema pins only the subset we consume and tolerates unknown fields. Verify field names against current BrandFetch docs when wiring the real key; the contract test fixture encodes the expected shape.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/brandfetch/brand-search.adapter.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { BrandSearchAdapter } from "./brand-search.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = { apiKey: "k", baseUrl: "https://api.brandfetch.io/v2", timeoutMs: 50 };
const adapter = () => new BrandSearchAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandSearchAdapter", () => {
  it("requests /search/{query} and maps hits into the port shape", async () => {
    const body = [
      { brandId: "b1", name: "Aglow", domain: "getaglow.co", score: 0.9 },
      { brandId: "b2", name: "HomeAglow", domain: "homeaglow.com", score: 0.4 },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const hits = await adapter().search("Aglow");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.brandfetch.io/v2/search/Aglow");
    expect(hits).toEqual([
      { brandId: "b1", name: "Aglow", domain: "getaglow.co", relevance: 0.9 },
      { brandId: "b2", name: "HomeAglow", domain: "homeaglow.com", relevance: 0.4 },
    ]);
  });

  it("URL-encodes the query", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await adapter().search("Aglow & Co");
    expect(fetchMock.mock.calls[0][0]).toContain("/search/Aglow%20%26%20Co");
  });

  it("returns [] on transport failure (null body)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    expect(await adapter().search("Aglow")).toEqual([]);
  });

  it("returns [] when the payload fails to parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ not: "an array" }), { status: 200 })));
    expect(await adapter().search("Aglow")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand-search.adapter.test.ts`
Expected: FAIL — `Cannot find module './brand-search.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/brandfetch/brand-search.adapter.ts
import { z } from "zod";
import type { BrandSearchPort, BrandSearchHit } from "../../application/resolve/ports/brand-search.port";
import type { BrandfetchHttp } from "./brandfetch.http";

const hitSchema = z
  .object({
    brandId: z.string().nullish(),
    name: z.string(),
    domain: z.string().nullish(),
    score: z.number().nullish(),
  })
  .passthrough();
const responseSchema = z.array(hitSchema);

export class BrandSearchAdapter implements BrandSearchPort {
  constructor(private readonly http: BrandfetchHttp) {}

  async search(name: string): Promise<BrandSearchHit[]> {
    const raw = await this.http.getJson(`/search/${encodeURIComponent(name)}`);
    if (raw === null) return [];
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.map((h) => ({
      brandId: h.brandId ?? null,
      name: h.name,
      domain: h.domain ?? null,
      relevance: h.score ?? null,
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand-search.adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/brandfetch/brand-search.adapter.ts src/infrastructure/brandfetch/brand-search.adapter.test.ts
git commit -m "feat(resolve): Brand Search adapter (collision discovery + autocomplete source)"
```

---

## Task 13: Brand adapter

**Files:**
- Create: `src/infrastructure/brandfetch/brand.adapter.ts`
- Test: `src/infrastructure/brandfetch/brand.adapter.test.ts`

> `GET /v2/brands/{idOrDomain}` returns the canonical brand. We map `id`/`name` and pick the primary domain from the `domains`/`domain` field.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/brandfetch/brand.adapter.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { BrandAdapter } from "./brand.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = { apiKey: "k", baseUrl: "https://api.brandfetch.io/v2", timeoutMs: 50 };
const adapter = () => new BrandAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandAdapter", () => {
  it("resolves by domain → canonical brand", async () => {
    const body = { id: "b1", name: "Aglow", domain: "getaglow.co" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const brand = await adapter().resolveBrand({ domain: "getaglow.co" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.brandfetch.io/v2/brands/getaglow.co");
    expect(brand).toEqual({ brandId: "b1", name: "Aglow", primaryDomain: "getaglow.co" });
  });

  it("resolves by brandId when no domain given", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "b1", name: "Aglow", domain: "getaglow.co" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await adapter().resolveBrand({ brandId: "b1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.brandfetch.io/v2/brands/b1");
  });

  it("returns null when neither domain nor brandId is given", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await adapter().resolveBrand({})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on transport/parse failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    expect(await adapter().resolveBrand({ domain: "getaglow.co" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand.adapter.test.ts`
Expected: FAIL — `Cannot find module './brand.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/brandfetch/brand.adapter.ts
import { z } from "zod";
import type { BrandPort, CanonicalBrand } from "../../application/resolve/ports/brand.port";
import type { BrandfetchHttp } from "./brandfetch.http";

const brandSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    domain: z.string().nullish(),
  })
  .passthrough();

export class BrandAdapter implements BrandPort {
  constructor(private readonly http: BrandfetchHttp) {}

  async resolveBrand(ref: { domain?: string; brandId?: string }): Promise<CanonicalBrand | null> {
    const key = ref.domain ?? ref.brandId;
    if (!key) return null;
    const raw = await this.http.getJson(`/brands/${encodeURIComponent(key)}`);
    if (raw === null) return null;
    const parsed = brandSchema.safeParse(raw);
    if (!parsed.success) return null;
    return {
      brandId: parsed.data.id ?? null,
      name: parsed.data.name ?? null,
      primaryDomain: parsed.data.domain ?? null,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand.adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/brandfetch/brand.adapter.ts src/infrastructure/brandfetch/brand.adapter.test.ts
git commit -m "feat(resolve): Brand adapter (anchor → canonical brand + primary domain)"
```

---

## Task 14: Brand Context adapter

**Files:**
- Create: `src/infrastructure/brandfetch/brand-context.adapter.ts`
- Test: `src/infrastructure/brandfetch/brand-context.adapter.test.ts`

> `GET /v2/context/{domain}` returns positioning. The schema pins the seven fields the `BrandContext` type needs and tolerates the rest; missing fields default to `null`/`[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/brandfetch/brand-context.adapter.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { BrandContextAdapter } from "./brand-context.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = { apiKey: "k", baseUrl: "https://api.brandfetch.io/v2", timeoutMs: 50 };
const adapter = () => new BrandContextAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandContextAdapter", () => {
  it("requests /context/{domain} and maps the positioning fields", async () => {
    const body = {
      tagline: "Beauty membership",
      mission: "Make beauty accessible",
      description: "Sydney beauty-membership startup",
      tags: ["beauty", "membership"],
      valueProposition: "Membership-based beauty services",
      targetAudienceSegments: ["consumers", "members"],
      productsAndServices: ["membership", "bookings"],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = await adapter().fetchContext("getaglow.co");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.brandfetch.io/v2/context/getaglow.co");
    expect(ctx).toEqual(body);
  });

  it("defaults missing fields to null / empty arrays", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ description: "d" }), { status: 200 })));
    const ctx = await adapter().fetchContext("getaglow.co");
    expect(ctx).toEqual({
      tagline: null, mission: null, description: "d", tags: [],
      valueProposition: null, targetAudienceSegments: [], productsAndServices: [],
    });
  });

  it("returns null on transport failure (absent context = Warning upstream)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 404 })));
    expect(await adapter().fetchContext("getaglow.co")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand-context.adapter.test.ts`
Expected: FAIL — `Cannot find module './brand-context.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/brandfetch/brand-context.adapter.ts
import { z } from "zod";
import type { BrandContextPort } from "../../application/resolve/ports/brand-context.port";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { BrandfetchHttp } from "./brandfetch.http";

const contextSchema = z
  .object({
    tagline: z.string().nullish(),
    mission: z.string().nullish(),
    description: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    valueProposition: z.string().nullish(),
    targetAudienceSegments: z.array(z.string()).nullish(),
    productsAndServices: z.array(z.string()).nullish(),
  })
  .passthrough();

export class BrandContextAdapter implements BrandContextPort {
  constructor(private readonly http: BrandfetchHttp) {}

  async fetchContext(domain: string): Promise<BrandContext | null> {
    const raw = await this.http.getJson(`/context/${encodeURIComponent(domain)}`);
    if (raw === null) return null;
    const parsed = contextSchema.safeParse(raw);
    if (!parsed.success) return null;
    const d = parsed.data;
    return {
      tagline: d.tagline ?? null,
      mission: d.mission ?? null,
      description: d.description ?? null,
      tags: d.tags ?? [],
      valueProposition: d.valueProposition ?? null,
      targetAudienceSegments: d.targetAudienceSegments ?? [],
      productsAndServices: d.productsAndServices ?? [],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/brandfetch/brand-context.adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/brandfetch/brand-context.adapter.ts src/infrastructure/brandfetch/brand-context.adapter.test.ts
git commit -m "feat(resolve): Brand Context adapter (domain-keyed positioning)"
```

---

## Task 15: `scrapeHandles` (pure HTML → social handles)

**Files:**
- Create: `src/infrastructure/homepage/scrape-handles.ts`
- Test: `src/infrastructure/homepage/scrape-handles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/homepage/scrape-handles.test.ts
import { describe, it, expect } from "vitest";
import { scrapeHandles } from "./scrape-handles";

const html = `
  <a href="https://www.linkedin.com/company/getaglow">LinkedIn</a>
  <a href="https://x.com/getaglow">X</a>
  <a href="https://twitter.com/getaglow">Twitter</a>
  <a href="https://getaglow.substack.com">Substack</a>
  <a href="https://example.com/about">About</a>
`;

describe("scrapeHandles", () => {
  it("extracts known social platforms and ignores unrelated links", () => {
    const handles = scrapeHandles(html);
    const platforms = handles.map((h) => h.platform).sort();
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("x");
    expect(platforms).toContain("substack");
    expect(platforms).not.toContain("example");
  });

  it("dedups the same platform+handle", () => {
    const dupe = `<a href="https://x.com/getaglow">a</a><a href="https://x.com/getaglow">b</a>`;
    expect(scrapeHandles(dupe).filter((h) => h.platform === "x")).toHaveLength(1);
  });

  it("returns [] for HTML with no social links", () => {
    expect(scrapeHandles("<p>no links</p>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/homepage/scrape-handles.test.ts`
Expected: FAIL — `Cannot find module './scrape-handles'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/homepage/scrape-handles.ts
import type { SocialHandle } from "../../domain/resolve/social-handle";

const PLATFORMS: { platform: string; pattern: RegExp }[] = [
  { platform: "linkedin", pattern: /linkedin\.com\/(?:company|in)\/([A-Za-z0-9._-]+)/i },
  { platform: "x", pattern: /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i },
  { platform: "substack", pattern: /([A-Za-z0-9-]+)\.substack\.com/i },
  { platform: "instagram", pattern: /instagram\.com\/([A-Za-z0-9._]+)/i },
  { platform: "facebook", pattern: /facebook\.com\/([A-Za-z0-9.]+)/i },
  { platform: "youtube", pattern: /youtube\.com\/(?:@|c\/|channel\/)?([A-Za-z0-9._-]+)/i },
];

/** Pure: extracts named social accounts from anchor hrefs. No network, no DOM library. */
export function scrapeHandles(html: string): SocialHandle[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const handles: SocialHandle[] = [];
  for (const url of hrefs) {
    for (const { platform, pattern } of PLATFORMS) {
      const match = url.match(pattern);
      if (!match) continue;
      const handle = match[1];
      const key = `${platform}:${handle.toLowerCase()}`;
      if (seen.has(key)) break;
      seen.add(key);
      handles.push({ platform, handle, url });
      break;
    }
  }
  return handles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/homepage/scrape-handles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/homepage/scrape-handles.ts src/infrastructure/homepage/scrape-handles.test.ts
git commit -m "feat(resolve): pure social-handle scraper over homepage HTML"
```

---

## Task 16: Homepage fetch adapter (the one true fetch)

**Files:**
- Create: `src/infrastructure/homepage/homepage-fetch.adapter.ts`
- Test: `src/infrastructure/homepage/homepage-fetch.adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/homepage/homepage-fetch.adapter.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { HomepageFetchAdapter } from "./homepage-fetch.adapter";

const adapter = () => new HomepageFetchAdapter({ timeoutMs: 50 });
afterEach(() => vi.unstubAllGlobals());

describe("HomepageFetchAdapter", () => {
  it("fetches https://{domain}, reads the name and scrapes handles", async () => {
    const html = `<html><head><title>Aglow — beauty</title></head><body>
      <a href="https://x.com/getaglow">X</a></body></html>`;
    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await adapter().fetch("getaglow.co");
    expect(fetchMock.mock.calls[0][0]).toBe("https://getaglow.co");
    expect(out?.confirmedName).toBe("Aglow — beauty");
    expect(out?.handles.map((h) => h.platform)).toContain("x");
  });

  it("prefers og:site_name over <title> when present", async () => {
    const html = `<head><meta property="og:site_name" content="Aglow"><title>Home | Aglow</title></head>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200 })));
    expect((await adapter().fetch("getaglow.co"))?.confirmedName).toBe("Aglow");
  });

  it("returns null on non-2xx (homepage fetch failed → Warning upstream)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    expect(await adapter().fetch("getaglow.co")).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    expect(await adapter().fetch("getaglow.co")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/homepage/homepage-fetch.adapter.test.ts`
Expected: FAIL — `Cannot find module './homepage-fetch.adapter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/homepage/homepage-fetch.adapter.ts
import type { HomepageFetchPort, HomepageFetchResult } from "../../application/resolve/ports/homepage-fetch.port";
import { scrapeHandles } from "./scrape-handles";

export type HomepageFetchOptions = { timeoutMs: number };

/** The ONE sanctioned outbound HTTP fetch. Confirms the name and scrapes social handles. */
export class HomepageFetchAdapter implements HomepageFetchPort {
  constructor(private readonly options: HomepageFetchOptions) {}

  async fetch(domain: string): Promise<HomepageFetchResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const res = await fetch(`https://${domain}`, { method: "GET", signal: controller.signal });
      if (!res.ok) return null;
      const html = await res.text();
      return { confirmedName: extractName(html), handles: scrapeHandles(html) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractName(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const title = html.match(/<title>([^<]+)<\/title>/i);
  return title ? title[1].trim() : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/homepage/homepage-fetch.adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/homepage/homepage-fetch.adapter.ts src/infrastructure/homepage/homepage-fetch.adapter.test.ts
git commit -m "feat(resolve): homepage fetch adapter (the one true outbound fetch)"
```

---

## Task 17: `resolved_identity` schema + migration

**Files:**
- Modify: `src/infrastructure/persistence/schema.ts` (define the reserved `resolved_identity` + child tables)
- Create: migration via `drizzle-kit` (generated, then committed)

> Foundation created `resolved_identity` as a reserved empty table. Read the current `schema.ts` first and extend it. Define the parent + three child tables. JSONB columns hold Zod-validated structured output only — never raw payloads or scraped HTML (anti-echo).

- [ ] **Step 1: Add the schema definitions to `schema.ts`**

```ts
// src/infrastructure/persistence/schema.ts (add — keep Foundation's existing tables)
import { pgTable, uuid, text, jsonb, timestamp, serial, pgEnum } from "drizzle-orm/pg-core";
import { jobs } from "./schema"; // if jobs is defined in this same file, reference it directly

export const domainProvenanceEnum = pgEnum("domain_provenance", ["url_provided", "brand_derived"]);

export const resolvedIdentity = pgTable("resolved_identity", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
  companyName: text("company_name").notNull(),
  brandContext: jsonb("brand_context"), // BrandContext | null (validated structured output only)
  negativeBoost: text("negative_boost").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resolvedIdentityOwnDomains = pgTable("resolved_identity_own_domains", {
  id: serial("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  domain: text("domain").notNull(),
  provenance: domainProvenanceEnum("provenance").notNull(),
});

export const resolvedIdentityHandles = pgTable("resolved_identity_handles", {
  id: serial("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  platform: text("platform").notNull(),
  handle: text("handle").notNull(),
  url: text("url").notNull(),
});

export const resolvedIdentityCollisions = pgTable("resolved_identity_collisions", {
  id: serial("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  brandId: text("brand_id"),
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  context: jsonb("context"), // CollisionContext | null
});
```

> If Foundation already declared a placeholder `resolved_identity`, replace its body with the above rather than declaring a duplicate. Keep the `jobs` import consistent with how Foundation exports it.

- [ ] **Step 2: Generate the migration**

Run: `pnpm exec drizzle-kit generate`
Expected: a new SQL migration file under the configured migrations dir creating `resolved_identity` + the three child tables and the `domain_provenance` enum.

- [ ] **Step 3: Verify the migration applies against a throwaway Postgres**

Run (Testcontainers covers this in Task 18; for a quick manual check use the dev DB): `pnpm exec drizzle-kit migrate`
Expected: applies with no error.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/persistence/schema.ts <migrations dir>
git commit -m "feat(resolve): resolved_identity schema (parent + own domains/handles/collisions)"
```

---

## Task 18: `ResolvedIdentityRepository` (Drizzle) + Testcontainers integration

**Files:**
- Create: `src/infrastructure/persistence/resolved-identity.repository.ts`
- Test: `src/infrastructure/persistence/resolved-identity.repository.integration.test.ts`

> Mirrors Foundation's Testcontainers pattern. Reuse Foundation's test helper that boots a Postgres container, runs migrations, and yields a Drizzle client. A Job row must exist first (FK), so insert a `jobs` row (use Foundation's `JobRepository` or a raw insert helper) before saving an identity.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/infrastructure/persistence/resolved-identity.repository.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTestDatabase } from "./test-support/with-test-database"; // adjust to Foundation's helper
import { ResolvedIdentityDrizzleRepository } from "./resolved-identity.repository";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";

const sample = () =>
  ResolvedIdentity.assemble({
    companyName: "Aglow",
    ownDomains: [
      { domain: "getaglow.co", provenance: "url_provided" },
      { domain: "aglow.app", provenance: "brand_derived" },
    ],
    socialHandles: [{ platform: "x", handle: "getaglow", url: "https://x.com/getaglow" }],
    brandContext: {
      tagline: "t", mission: null, description: "d", tags: ["beauty"],
      valueProposition: "vp", targetAudienceSegments: ["consumers"], productsAndServices: ["membership"],
    },
    nameCollisions: [
      { brandId: "b1", domain: "homeaglow.com", name: "HomeAglow", context: {
          tagline: null, mission: null, description: "cleaning", tags: [],
          valueProposition: "cleaning marketplace", targetAudienceSegments: [], productsAndServices: ["cleaning"] } },
      { brandId: null, domain: "aglowair.example", name: "Aglow Air", context: null },
    ],
    negativeBoost: "Known look-alikes ...",
  });

describe("ResolvedIdentityDrizzleRepository (Testcontainers)", () => {
  const db = withTestDatabase(); // sets up container + migrations; exposes db.client and db.insertJob

  it("round-trips the full nested identity", async () => {
    const jobId = await db.insertJob(); // helper inserts a running Job, returns its id
    const repo = new ResolvedIdentityDrizzleRepository(db.client);
    const original = sample();
    await repo.save(jobId, original);

    const loaded = await repo.findByJobId(jobId);
    expect(loaded).not.toBeNull();
    expect(loaded!.companyName).toBe("Aglow");
    expect(loaded!.ownDomains).toEqual(original.ownDomains);
    expect(loaded!.socialHandles).toEqual(original.socialHandles);
    expect(loaded!.brandContext).toEqual(original.brandContext);
    expect(loaded!.nameCollisions).toEqual(original.nameCollisions);
    expect(loaded!.negativeBoost).toBe("Known look-alikes ...");
  });

  it("returns null for a job with no identity", async () => {
    const jobId = await db.insertJob();
    const repo = new ResolvedIdentityDrizzleRepository(db.client);
    expect(await repo.findByJobId(jobId)).toBeNull();
  });

  it("a re-run (new job id) writes its own rows; the prior identity is unchanged", async () => {
    const repo = new ResolvedIdentityDrizzleRepository(db.client);
    const jobA = await db.insertJob();
    const jobB = await db.insertJob();
    await repo.save(jobA, sample());
    await repo.save(jobB, ResolvedIdentity.assemble({
      companyName: "Aglow Rerun", ownDomains: [], socialHandles: [],
      brandContext: null, nameCollisions: [], negativeBoost: "",
    }));
    expect((await repo.findByJobId(jobA))!.companyName).toBe("Aglow");
    expect((await repo.findByJobId(jobB))!.companyName).toBe("Aglow Rerun");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/persistence/resolved-identity.repository.integration.test.ts`
Expected: FAIL — `Cannot find module './resolved-identity.repository'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/infrastructure/persistence/resolved-identity.repository.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres"; // match Foundation's Drizzle client type
import type { ResolvedIdentityRepository } from "../../application/resolve/ports/resolved-identity-repository.port";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { NameCollision } from "../../domain/resolve/name-collision";
import {
  resolvedIdentity,
  resolvedIdentityOwnDomains,
  resolvedIdentityHandles,
  resolvedIdentityCollisions,
} from "./schema";

type Db = NodePgDatabase<Record<string, never>>; // align with Foundation's exported db type

export class ResolvedIdentityDrizzleRepository implements ResolvedIdentityRepository {
  constructor(private readonly db: Db) {}

  async save(jobId: string, identity: ResolvedIdentity): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(resolvedIdentity).values({
        jobId,
        companyName: identity.companyName,
        brandContext: identity.brandContext as BrandContext | null,
        negativeBoost: identity.negativeBoost,
      });
      if (identity.ownDomains.length) {
        await tx.insert(resolvedIdentityOwnDomains).values(
          identity.ownDomains.map((d) => ({ jobId, domain: d.domain, provenance: d.provenance })),
        );
      }
      if (identity.socialHandles.length) {
        await tx.insert(resolvedIdentityHandles).values(
          identity.socialHandles.map((h) => ({ jobId, platform: h.platform, handle: h.handle, url: h.url })),
        );
      }
      if (identity.nameCollisions.length) {
        await tx.insert(resolvedIdentityCollisions).values(
          identity.nameCollisions.map((c) => ({
            jobId, brandId: c.brandId, domain: c.domain, name: c.name, context: c.context as object | null,
          })),
        );
      }
    });
  }

  async findByJobId(jobId: string): Promise<ResolvedIdentity | null> {
    const [row] = await this.db.select().from(resolvedIdentity).where(eq(resolvedIdentity.jobId, jobId));
    if (!row) return null;
    const [domains, handles, collisions] = await Promise.all([
      this.db.select().from(resolvedIdentityOwnDomains).where(eq(resolvedIdentityOwnDomains.jobId, jobId)),
      this.db.select().from(resolvedIdentityHandles).where(eq(resolvedIdentityHandles.jobId, jobId)),
      this.db.select().from(resolvedIdentityCollisions).where(eq(resolvedIdentityCollisions.jobId, jobId)),
    ]);
    return ResolvedIdentity.assemble({
      companyName: row.companyName,
      ownDomains: domains.map((d) => ({ domain: d.domain, provenance: d.provenance })),
      socialHandles: handles.map((h) => ({ platform: h.platform, handle: h.handle, url: h.url })),
      brandContext: (row.brandContext as BrandContext | null) ?? null,
      nameCollisions: collisions.map(
        (c): NameCollision => ({ brandId: c.brandId, domain: c.domain, name: c.name, context: (c.context as NameCollision["context"]) ?? null }),
      ),
      negativeBoost: row.negativeBoost,
    });
  }
}
```

> Align the Drizzle client type (`NodePgDatabase` vs the `postgres`-js `PostgresJsDatabase`) with whatever Foundation's `drizzle.module.ts` constructs — `package.json` lists `postgres` (postgres-js), so it is likely `PostgresJsDatabase`. Import the matching type.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/infrastructure/persistence/resolved-identity.repository.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/resolved-identity.repository.ts src/infrastructure/persistence/resolved-identity.repository.integration.test.ts
git commit -m "feat(resolve): Drizzle ResolvedIdentityRepository with nested round-trip"
```

---

## Task 19: DI wiring + config (register ResolveStage as the first stage)

**Files:**
- Create: `src/infrastructure/brandfetch/brandfetch.module.ts` (provider wiring for the BrandFetch + homepage adapters)
- Modify: `src/app-worker.module.ts` (register adapters + repo + `ResolveStage` first in the `StageRunner`)
- Modify: `src/app-web.module.ts` (register `BrandSearchPort` provider for PRD 7 autocomplete reuse)
- Modify: `.env.example` (add `BRANDFETCH_*` + `HOMEPAGE_FETCH_TIMEOUT_MS`)
- Test: `src/app-worker.module.test.ts` (extend or create — assert Resolve is registered first)

> Read Foundation's `app-worker.module.ts` to see how it builds the `StageRunner`'s ordered stage list (Foundation ships it empty). The goal: the worker's runner has exactly `[ResolveStage]` after this task, with all four ports bound to their adapters and the repository bound to the Drizzle impl. Use `@nestjs/config` for the BrandFetch config object.

- [ ] **Step 1: Write the failing wiring test**

```ts
// src/app-worker.module.test.ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { AppWorkerModule } from "./app-worker.module";
import { StageRunner } from "./application/pipeline/stage-runner"; // adjust to Foundation's export
import { ResolveStage } from "./application/resolve/resolve.stage";

describe("AppWorkerModule wiring", () => {
  it("registers ResolveStage as the first pipeline stage", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppWorkerModule] })
      // override real BrandFetch/DB providers with test doubles per Foundation's testing pattern
      .compile();
    const runner = moduleRef.get(StageRunner);
    // Foundation exposes the ordered stages (e.g. runner.stages) — adjust accessor to match.
    expect(runner.stages[0]).toBeInstanceOf(ResolveStage);
    expect(runner.stages[0]?.name).toBe("resolve");
  });
});
```

> If Foundation's `StageRunner` does not expose its stage list, add a read-only `get stages()` to it (small, test-only-justified change) or assert ordering via a behavioural test that runs the pipeline against fakes and observes Resolve ran. Prefer the read-only getter.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app-worker.module.test.ts`
Expected: FAIL — `ResolveStage` not registered / `runner.stages[0]` undefined.

- [ ] **Step 3: Write the BrandFetch module and wire the worker/web modules**

```ts
// src/infrastructure/brandfetch/brandfetch.module.ts
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrandfetchHttp } from "./brandfetch.http";
import { BrandSearchAdapter } from "./brand-search.adapter";
import { BrandAdapter } from "./brand.adapter";
import { BrandContextAdapter } from "./brand-context.adapter";
import { HomepageFetchAdapter } from "../homepage/homepage-fetch.adapter";
import { BRAND_SEARCH_PORT } from "../../application/resolve/ports/brand-search.port";
import { BRAND_PORT } from "../../application/resolve/ports/brand.port";
import { BRAND_CONTEXT_PORT } from "../../application/resolve/ports/brand-context.port";
import { HOMEPAGE_FETCH_PORT } from "../../application/resolve/ports/homepage-fetch.port";

const httpFactory = (config: ConfigService) =>
  new BrandfetchHttp({
    apiKey: config.getOrThrow("BRANDFETCH_API_KEY"),
    baseUrl: config.get("BRANDFETCH_BASE_URL") ?? "https://api.brandfetch.io/v2",
    timeoutMs: Number(config.get("BRANDFETCH_TIMEOUT_MS") ?? 5000),
  });

@Module({
  providers: [
    { provide: BrandfetchHttp, useFactory: httpFactory, inject: [ConfigService] },
    { provide: BRAND_SEARCH_PORT, useFactory: (h: BrandfetchHttp) => new BrandSearchAdapter(h), inject: [BrandfetchHttp] },
    { provide: BRAND_PORT, useFactory: (h: BrandfetchHttp) => new BrandAdapter(h), inject: [BrandfetchHttp] },
    { provide: BRAND_CONTEXT_PORT, useFactory: (h: BrandfetchHttp) => new BrandContextAdapter(h), inject: [BrandfetchHttp] },
    {
      provide: HOMEPAGE_FETCH_PORT,
      useFactory: (config: ConfigService) =>
        new HomepageFetchAdapter({ timeoutMs: Number(config.get("HOMEPAGE_FETCH_TIMEOUT_MS") ?? 5000) }),
      inject: [ConfigService],
    },
  ],
  exports: [BRAND_SEARCH_PORT, BRAND_PORT, BRAND_CONTEXT_PORT, HOMEPAGE_FETCH_PORT],
})
export class BrandfetchModule {}
```

In `app-worker.module.ts`, import `BrandfetchModule`, register the `RESOLVED_IDENTITY_REPOSITORY` provider (Drizzle impl, built from the connection Foundation's persistence module provides), construct `ResolveStage` from the injected ports + repo, and register it first in the `StageRunner`:

```ts
// src/app-worker.module.ts (sketch — merge into Foundation's module)
import { RESOLVED_IDENTITY_REPOSITORY } from "./application/resolve/ports/resolved-identity-repository.port";
import { ResolvedIdentityDrizzleRepository } from "./infrastructure/persistence/resolved-identity.repository";
import { BrandfetchModule } from "./infrastructure/brandfetch/brandfetch.module";
import { ResolveStage } from "./application/resolve/resolve.stage";
import { BRAND_SEARCH_PORT } from "./application/resolve/ports/brand-search.port";
import { BRAND_PORT } from "./application/resolve/ports/brand.port";
import { BRAND_CONTEXT_PORT } from "./application/resolve/ports/brand-context.port";
import { HOMEPAGE_FETCH_PORT } from "./application/resolve/ports/homepage-fetch.port";

// providers (added):
// { provide: RESOLVED_IDENTITY_REPOSITORY, useFactory: (db) => new ResolvedIdentityDrizzleRepository(db), inject: [<DB token>] },
// {
//   provide: ResolveStage,
//   useFactory: (bs, b, bc, hp, repo) => new ResolveStage(bs, b, bc, hp, repo),
//   inject: [BRAND_SEARCH_PORT, BRAND_PORT, BRAND_CONTEXT_PORT, HOMEPAGE_FETCH_PORT, RESOLVED_IDENTITY_REPOSITORY],
// },
// Build the StageRunner with [ResolveStage] (replace Foundation's empty list):
// { provide: StageRunner, useFactory: (resolve) => new StageRunner([resolve]), inject: [ResolveStage] },
// imports: [BrandfetchModule, <Foundation persistence module>, ConfigModule, ...]
```

In `app-web.module.ts`, import `BrandfetchModule` (or just register the `BRAND_SEARCH_PORT` provider) so PRD 7's autocomplete consumes the same adapter. No other Resolve wiring on the web side.

Add to `.env.example`:

```
BRANDFETCH_API_KEY=
BRANDFETCH_BASE_URL=https://api.brandfetch.io/v2
BRANDFETCH_TIMEOUT_MS=5000
HOMEPAGE_FETCH_TIMEOUT_MS=5000
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app-worker.module.test.ts`
Expected: PASS — `runner.stages[0]` is a `ResolveStage` with `name === "resolve"`.

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
git add src/infrastructure/brandfetch/brandfetch.module.ts src/app-worker.module.ts src/app-web.module.ts src/app-worker.module.test.ts .env.example
git commit -m "feat(resolve): wire ResolveStage as the first pipeline stage + BrandFetch DI"
```

---

## Self-review (run after all tasks)

- **Spec coverage:** every PRD user story maps to a task — Resolved Identity assembly (T2), Negative Boost zero-LLM (T3), de-self (T4), Warnings closed set (T5), ports (T6), anchor resolution incl. brand-id-not-degraded (T7), degraded-path Warnings (T8, T10), in-process hand-off (T9, T10), the four ports' adapters + the one true fetch (T11–T16), provenance + immutability persisted (T17, T18), shared Brand Search for autocomplete + Resolve-first registration (T19). Observability stories 15–17 are honoured as the facts + anti-echo discipline; span emission is explicitly PRD 8 (noted in spec Out of Scope).
- **No placeholders:** every code step shows real code; every command shows expected output.
- **Type consistency:** `ResolvedIdentity`, `OwnDomain`/`DomainProvenance`, `SocialHandle`, `BrandContext`/`CollisionContext`, `NameCollision`, `BrandSearchHit`, `CanonicalBrand`, `HomepageFetchResult`, `RESOLVE_WARNING`, the four port symbols, and the repo symbol are defined once and reused verbatim across tasks.
- **Open verification points (resolve during execution, not guesses):**
  1. Foundation's exact `Job` accessors (`anchor`, `id`, warnings list) and `Warning` import path — adjust T5/T9/T10 imports.
  2. Foundation's Drizzle client type (postgres-js → `PostgresJsDatabase`) and its test-DB helper name — adjust T18.
  3. Whether `StageRunner` exposes its stage list; add a read-only getter if not — T19.
  4. BrandFetch response field names for `/search`, `/brands/{id}`, `/context/{domain}` — confirm against current docs; the Zod schemas are tolerant but the field mapping (`score`→`relevance`, `domain`, `id`/`name`) must match.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-09-resolve-stage.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Resolve the four open verification points against the implemented Foundation before starting Task 5 (the first task that imports a Foundation symbol).
