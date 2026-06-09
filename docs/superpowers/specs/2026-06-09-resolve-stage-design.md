# Resolve Stage — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/02-resolve-stage.md`
**ADRs:** 0001 (Negative Boost is collected collision contexts), 0004 (OTel / process model)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 2. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADR 0001 and is not
> re-litigated here. This document fixes the domain value objects, the four ports, the stage
> orchestration, the durable `resolved_identity` schema, and the test strategy. It assumes
> Foundation is already implemented and provides the `Stage` port, `RunContext`, `Job`,
> `CompanyAnchor`, the `StageRunner`, the Drizzle schema seam, and the two NestJS entrypoints.

---

## Goal

Produce, exactly once per Job and at **zero Resolve-time LLM cost**, an immutable job-scoped
**Resolved Identity** — company name, zero-or-more own domains (each with provenance), scraped
social handles, an optional Brand Context, zero-or-more de-selfed Name Collisions (each with a
mini brand-context), and a derived Negative Boost string — assembled behind four ports (Brand
Search, Brand, Brand Context, Homepage Fetch) from a Job's **frozen anchor**, degrading every
missing piece to a **Warning** rather than failing the Job, and never re-choosing which company
the Job is about.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Stage shape | A `ResolveStage implements Stage` (Foundation's port), registered **first** in the worker's `StageRunner` |
| How later stages read the identity | `RunContext` gains a `resolvedIdentity` slot + `setResolvedIdentity()`; Resolve populates it in-process |
| Durability | One `resolved_identity` row per Job (Foundation reserved the table); written after assembly so PRD 7 / re-runs can read it |
| BrandFetch access | Three thin adapters behind three ports; tolerant Zod parse of the documented subset; adapters own retry/timeout and translate transport failure into degraded-path signals, never Job-failing throws |
| The one true fetch | A single `HomepageFetchPort` over global `fetch` (Node 26); social handles scraped by a pure HTML extractor — no second outbound fetcher anywhere |
| Negative Boost | Pure synchronous derivation from collected collision contexts (ADR 0001). **No Anthropic dependency is injected into Resolve at all** — the zero-LLM guarantee is structural, not behavioural |
| De-selfing | `brandId` exact match (strongest) → registrable-domain match (fallback) → name-only top-hit inference + Warning |
| Anchor → domain | (1) anchor domain; (2) brand-id → Brand port → primary domain; (3) neither → genuine name-only degraded path |
| Unit tests | **Vitest** with fakes for all four ports (pure assembly, derivation, de-self, every degraded path) |
| Adapter tests | **Vitest** contract tests with `fetch` stubbed (`vi.stubGlobal`): request shape, Zod parse, timeout/error/empty → degraded signal |
| Repository test | **Vitest** integration against real Postgres via **Testcontainers** (round-trip of the full nested identity) |
| OTel spans | **Out of scope here** — PRD 8 owns span emission. Resolve only upholds the *facts* a span will read (counts, statuses) and the **anti-echo** discipline (no scraped text / raw payloads leave the adapter as anything but validated structured output) |

---

## Architecture

Resolve is a vertical slice and a deep module behind a simple interface (`Stage.run`). It lives
inside Foundation's hexagonal layering; the dependency arrow still points inward
(`interface → application → domain`, `infrastructure` implements `application`'s ports). The
domain Resolved Identity is pure TypeScript; the four ports are application interfaces; the
BrandFetch and homepage adapters and the Drizzle repository are infrastructure; DI wiring is
interface.

### Source layout (new files unless marked *modify*)

```
src/
  domain/resolve/
    resolved-identity.ts          # ResolvedIdentity aggregate value object (immutable, job-scoped)
    own-domain.ts                 # OwnDomain + DomainProvenance
    social-handle.ts              # SocialHandle value object
    brand-context.ts              # BrandContext + CollisionContext positioning fields
    name-collision.ts             # NameCollision value object
    negative-boost.ts             # deriveNegativeBoost() — pure, zero-LLM (ADR 0001)
    de-self.ts                    # deSelfCollisions() — pure de-self decision + inference flag
    registrable-domain.ts         # registrableDomain() — pure domain normalization for matching
    resolve-warnings.ts           # RESOLVE_WARNING closed-set constants + builders
  application/resolve/
    ports/
      brand-search.port.ts        # discovers collisions for a name (shared w/ PRD 7 autocomplete)
      brand.port.ts               # resolves the canonical brand for the anchor (→ brandId + domain)
      brand-context.port.ts       # domain-keyed Brand Context (target + per-collision)
      homepage-fetch.port.ts      # the one true outbound HTTP fetch (name confirm + handle scrape)
      resolved-identity-repository.port.ts  # persist one identity per Job
    resolve-anchor-domain.ts      # pure: anchor + canonical brand → { domain, ownDomain } | none
    assemble-resolved-identity.ts # pure: composes port outputs → ResolvedIdentity + Warning[]
    resolve.stage.ts              # ResolveStage implements Stage — the impure orchestration shell
  infrastructure/
    brandfetch/
      brandfetch.config.ts        # base URL, API key, timeout (from @nestjs/config)
      brandfetch.http.ts          # shared fetch-with-timeout + Bearer auth + status handling
      brand-search.adapter.ts     # BrandSearchPort over GET /v2/search/{query}
      brand.adapter.ts            # BrandPort over GET /v2/brands/{idOrDomain}
      brand-context.adapter.ts    # BrandContextPort over GET /v2/context/{domain}
    homepage/
      homepage-fetch.adapter.ts   # HomepageFetchPort over global fetch
      scrape-handles.ts           # pure: HTML string → SocialHandle[]
    persistence/
      resolved-identity.repository.ts   # ResolvedIdentityRepository impl over Drizzle
      schema.ts                         # *modify* — define resolved_identity columns + child tables
  application/pipeline/
    run-context.ts                # *modify* — add resolvedIdentity slot + setResolvedIdentity()
  app-worker.module.ts            # *modify* — register adapters, repo, ResolveStage into StageRunner
  app-web.module.ts               # *modify* — register BrandSearchPort provider (PRD 7 autocomplete reuse)
```

---

## Domain

All domain types are immutable (`readonly` fields, frozen at construction) and contain **no
I/O**. They are the richest unit-test target.

### `ResolvedIdentity`

```ts
class ResolvedIdentity {
  readonly companyName: string;
  readonly ownDomains: readonly OwnDomain[];
  readonly socialHandles: readonly SocialHandle[];
  readonly brandContext: BrandContext | null;
  readonly nameCollisions: readonly NameCollision[];
  readonly negativeBoost: string;   // formatted one-line-per-look-alike; "" when no collisions

  private constructor(...);         // freezes all arrays
  static assemble(parts: ResolvedIdentityParts): ResolvedIdentity;
}
```

`assemble` is the single constructor; it `Object.freeze`s the arrays so no later stage can
mutate the anchor (PRD story 20). `companyName` is never empty — its precedence is **canonical
brand name → homepage-confirmed name → anchor name** (a name-only Job always has at least the
anchor name).

### `OwnDomain` and `DomainProvenance`

```ts
type DomainProvenance = "url_provided" | "brand_derived";
type OwnDomain = { readonly domain: string; readonly provenance: DomainProvenance };
```

`url_provided` = a host the user pasted (kept even when the homepage fetch fails — story 8);
`brand_derived` = the primary domain the Brand port resolved from a brand-id anchor.

### `SocialHandle`

```ts
type SocialHandle = {
  readonly platform: string;   // "linkedin" | "x" | "substack" | ... (open string; scraper sets it)
  readonly handle: string;     // account identifier
  readonly url: string;        // the scraped href
};
```

### `BrandContext` and `CollisionContext`

The target's positioning, and the mini-context each collision carries. Same shape — a collision
context is just a Brand Context fetched for a look-alike's domain.

```ts
type BrandContext = {
  readonly tagline: string | null;
  readonly mission: string | null;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly valueProposition: string | null;        // Verify leans on these three
  readonly targetAudienceSegments: readonly string[];
  readonly productsAndServices: readonly string[];
};
type CollisionContext = BrandContext;
```

### `NameCollision`

```ts
type NameCollision = {
  readonly brandId: string | null;
  readonly domain: string;
  readonly name: string;
  readonly context: CollisionContext | null;   // null when its /v2/context call failed (Warning)
};
```

### `deriveNegativeBoost(collisions): string` — ADR 0001

Pure, synchronous, **no LLM**. Collects each collision's context into one compact line under
assertive framing, for verbatim injection into every Verify prompt:

```
Known look-alikes sharing this name that are NOT the target — reject pages about these:
- {name} ({domain}): {valueProposition or description}; offers {productsAndServices}; for {targetAudienceSegments}
- ...
```

Collisions with a `null` context contribute a name+domain-only line (still a useful negative
signal). Empty collision list → empty string. This function takes **no async, no injected
dependency** — that is the structural proof of zero Resolve-time LLM cost (ADR 0001).

### `deSelfCollisions(hits, canonicalBrand, anchor): { collisions, inferredTarget }` — correctness

Drops the target from the Brand Search hit set before any boost is derived (PRD "De-selfing the
collision set"). Decision order:

1. **brandId match (strongest):** drop the hit whose `brandId === canonicalBrand.brandId`.
2. **registrable-domain match (fallback):** drop the hit whose `registrableDomain(hit.domain) ===
   registrableDomain(canonicalBrand.primaryDomain ?? anchor.domain)`.
3. **name-only inference:** when there is no resolvable brand-id and no domain, treat the single
   best hit (top relevance / exact name) as the target, drop it, and set `inferredTarget = true`
   so the caller raises the `collision_target_inferred` Warning.

Returns the remaining hits as the collision candidate set. The function is pure; fetching each
candidate's context happens in the orchestration shell.

### `registrableDomain(domain): string`

Pure normalization sufficient for *matching* (lowercase, strip scheme, leading `www.`, port, and
path). A full public-suffix-list eTLD+1 is a deferred refinement — noted, not built — and is not
needed to compare an anchor domain against a Brand Search hit's domain.

### `resolve-warnings.ts` — closed Warning set

Resolve's Warnings reuse Foundation's `Warning` value object (`{ type, message }`). The `type`
field is drawn from a **closed set** namespaced under `resolve.`:

```ts
const RESOLVE_WARNING = {
  homepageUnresolved: "resolve.homepage_unresolved",
  homepageFetchFailed: "resolve.homepage_fetch_failed",
  brandContextAbsent: "resolve.brand_context_absent",
  collisionContextFetchFailed: "resolve.collision_context_fetch_failed",
  collisionTargetInferred: "resolve.collision_target_inferred",
} as const;
```

Each has a builder returning a `Warning` with a fixed, non-echoing message (counts/identifiers
only — never scraped text). These map one-to-one to the PRD's "Warning conditions (closed list)."

---

## Application

### The four ports

```ts
// brand-search.port.ts — shared with PRD 7 input-time autocomplete
interface BrandSearchPort {
  search(name: string): Promise<BrandSearchHit[]>;   // [] on empty/failure (never throws)
}
type BrandSearchHit = {
  brandId: string | null;
  name: string;
  domain: string | null;
  relevance: number | null;   // BrandFetch's ranking, used to pick the top hit for name-only inference
};

// brand.port.ts
interface BrandPort {
  resolveBrand(ref: { domain?: string; brandId?: string }): Promise<CanonicalBrand | null>;
}
type CanonicalBrand = {
  brandId: string | null;
  name: string | null;
  primaryDomain: string | null;
};

// brand-context.port.ts
interface BrandContextPort {
  fetchContext(domain: string): Promise<BrandContext | null>;   // null on absent/failure
}

// homepage-fetch.port.ts — the one true outbound fetch
interface HomepageFetchPort {
  fetch(domain: string): Promise<HomepageFetchResult | null>;   // null on fetch failure
}
type HomepageFetchResult = {
  confirmedName: string | null;
  handles: SocialHandle[];
};

// resolved-identity-repository.port.ts
interface ResolvedIdentityRepository {
  save(jobId: string, identity: ResolvedIdentity): Promise<void>;
  findByJobId(jobId: string): Promise<ResolvedIdentity | null>;   // for PRD 7 read model
}
```

**Failure translation is the adapters' job.** Every BrandFetch/homepage port returns a benign
value (`null` / `[]`) on timeout, error status, or empty result. Nothing escapes as a throw, so
the orchestration shell branches on values, not exceptions — degraded paths become Warnings, not
Job failures (PRD "BrandFetch ports").

### `resolveAnchorDomain(anchor, brandPort)` — anchor resolution order

Pure decision over the anchor plus (when needed) a Brand port lookup, returning the working
domain and the `OwnDomain` it implies:

| Anchor | Domain used | OwnDomain produced |
|---|---|---|
| `disambiguated` with `domain` | that domain | `{ domain, provenance: "url_provided" or "picked"→treated as supplied }` |
| `disambiguated` with `brandId` only | Brand port → `primaryDomain` | `{ domain, provenance: "brand_derived" }` |
| `name_only`, or brand-id resolves no domain | **none** | none → genuine name-only degraded path |

A disambiguated brand-id anchor is a **strong** anchor and gets the full Brand Context + homepage
fetch + collision treatment, identical to a domain anchor (PRD "a brand-id anchor is NOT
degraded"). Provenance for a user-supplied host follows the anchor's `provenance`
(`url_provided`); a Brand-port-resolved domain is `brand_derived`.

### `assembleResolvedIdentity(parts)` — pure composition

Given everything the shell fetched (canonical brand, target context, homepage result, de-selfed
collisions with their contexts, the working own domain, the anchor), composes one
`ResolvedIdentity` and returns the accompanying `Warning[]`. Pure and side-effect-free; never
re-chooses the company. Owns: company-name precedence; own-domain list assembly (dedup,
provenance); handle merge; Negative Boost derivation; collecting the Warning list from the flags
the shell passed in.

### `ResolveStage implements Stage` — the orchestration shell

The only impure unit. `name = "resolve"`. `run(ctx)`:

1. `resolveAnchorDomain(anchor, brandPort)` → working domain (or none) + canonical brand.
2. If a domain exists: `brandContextPort.fetchContext(domain)` → target context (null → `brandContextAbsent` Warning).
3. If a domain exists: `homepageFetchPort.fetch(domain)` → confirmed name + handles.
   - name-only / no domain → `homepageUnresolved` Warning; no handles.
   - url-provided host but fetch returns null → `homepageFetchFailed` Warning; **keep the host as `url_provided` own domain**; no handles.
4. `brandSearchPort.search(companyName)` → hits → `deSelfCollisions(...)` → candidate collisions
   (inference → `collisionTargetInferred` Warning).
5. For each candidate: `brandContextPort.fetchContext(candidate.domain)`; any failure → one
   `collisionContextFetchFailed` Warning (aggregate, not per-collision) and a `context: null`
   collision.
6. `assembleResolvedIdentity(...)` → identity + warnings. `warnings.forEach(ctx.recordWarning)`.
7. `ctx.setResolvedIdentity(identity)` (in-process hand-off to Search/Filter/Verify/Classify).
8. `resolvedIdentityRepository.save(ctx.job.id, identity)` (durable; PRD 7 read model).
9. **Returns normally** in every degraded case — Resolve fails the Job only if Foundation's
   lifecycle dictates a hard failure for the stage; absence of domains/handles/context/collisions
   is always a Warning (PRD "Degraded-path handling").

The collision context fetches run concurrently (`Promise.all`) but each is individually
failure-tolerant (adapter returns null), so one bad look-alike never sinks the batch.

### `RunContext` modification

Foundation reserved the slot. Add to the concrete context:

```ts
interface RunContext {
  readonly job: Job;
  recordWarning(warning: Warning): void;
  readonly resolvedIdentity: ResolvedIdentity | null;   // null until Resolve runs
  setResolvedIdentity(identity: ResolvedIdentity): void; // idempotent-by-run; set once per Job run
}
```

Set-once semantics: `setResolvedIdentity` throws if called twice in one run (defends story 20's
"single consistent anchor").

---

## Infrastructure

### BrandFetch adapters

A shared `brandfetch.http.ts` wraps global `fetch` with: Bearer auth from
`BRANDFETCH_API_KEY`, base URL from `BRANDFETCH_BASE_URL`, an `AbortController` timeout
(`BRANDFETCH_TIMEOUT_MS`, default 5000), and status handling that maps non-2xx / network error /
timeout to the port's benign value. Each adapter Zod-parses the **documented subset** it consumes
(tolerant: unknown fields ignored, consumed fields `.optional().nullable()` where BrandFetch may
omit them) and projects into the port's return type:

- **`brand-search.adapter.ts`** — `GET /v2/search/{query}` → `BrandSearchHit[]` (maps
  `brandId`/`name`/`domain` plus a relevance score). Empty array on no results / failure.
- **`brand.adapter.ts`** — `GET /v2/brands/{idOrDomain}` → `CanonicalBrand` (brandId, name,
  primary domain). `null` on failure.
- **`brand-context.adapter.ts`** — `GET /v2/context/{domain}` → `BrandContext` (tagline, mission,
  description, tags, value proposition, audience segments, products & services). `null` on
  absent/failure. Used for both target and each collision.

A Zod parse failure is treated as a transport failure (→ benign value + the adapter logs a
structured, non-echoing warning), never a throw into the pipeline.

### Homepage fetch adapter (the one true fetch)

`homepage-fetch.adapter.ts` over global `fetch` (same timeout/abort pattern, no Bearer). On
2xx it hands the HTML body to the pure `scrapeHandles(html)` extractor and reads `<title>` /
`og:site_name` for `confirmedName`. `scrapeHandles` matches `href`s against a known platform
table (linkedin.com/company, x.com / twitter.com, substack.com, …) and returns `SocialHandle[]`
— **no network, no DOM library**, regex over hrefs. Non-2xx / network error / timeout → `null`
(the `homepageFetchFailed` / `homepageUnresolved` signal). This is the *only* sanctioned outbound
fetcher (PRD "The one true fetch").

### `resolved_identity` schema + repository

Foundation reserved `resolved_identity` (one row per Job). PRD 2 defines the columns via a new
`drizzle-kit` migration:

- **`resolved_identity`** — `job_id` PK/FK → `jobs.id`; `company_name`; `brand_context` JSONB
  nullable (the seven positioning fields); `negative_boost` text (the derived string, possibly
  empty); `created_at`.
- **`resolved_identity_own_domains`** — many per identity: `id`, `job_id` FK, `domain`,
  `provenance` enum (`url_provided | brand_derived`).
- **`resolved_identity_handles`** — many per identity: `id`, `job_id` FK, `platform`, `handle`,
  `url`.
- **`resolved_identity_collisions`** — many per identity: `id`, `job_id` FK, `brand_id` nullable,
  `domain`, `name`, `context` JSONB nullable.

The JSONB columns hold **Zod-validated structured output only** — never raw BrandFetch payloads
or scraped HTML (anti-echo, PRD story 17). The repository `save` writes the parent row plus its
child rows in one transaction; `findByJobId` reconstitutes a `ResolvedIdentity` via
`ResolvedIdentity.assemble`. A re-run is a new Job id with its own rows; Resolve never mutates a
prior Job's identity (immutable, job-scoped — story 20).

### DI wiring

- **`app-worker.module.ts`** — register the three BrandFetch adapters, the homepage adapter, and
  the `ResolvedIdentityRepository` as the providers for their ports; construct `ResolveStage` and
  register it **first** in the `StageRunner`'s ordered stage list.
- **`app-web.module.ts`** — register the `BrandSearchPort` provider so PRD 7's autocomplete
  consumes the same adapter (PRD story 21). No other Resolve wiring on the web side.
- Config via `@nestjs/config`: `BRANDFETCH_API_KEY`, `BRANDFETCH_BASE_URL`,
  `BRANDFETCH_TIMEOUT_MS`, `HOMEPAGE_FETCH_TIMEOUT_MS` (added to `.env.example`).

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, the `resolve` Stage Span, per-call child spans, and Warning span events are **PRD
8's** to build (ADR 0004). PRD 2's obligations are the *facts* those spans will read and the
discipline they must not violate:

- Resolve records every shortfall as a Foundation `Warning` (`OK`, never `ERROR`) via
  `ctx.recordWarning` — already the right signal for ADR 0004's "Warning = OK + span event."
- Resolve never lets a scraped page string or a raw BrandFetch payload into a persisted column, a
  log line, or any value that will later become a span attribute — only Zod-validated structured
  output and counts (anti-echo, story 17).
- The aggregatable facts a future `resolve` span needs (collision count, own-domain count,
  warning count, external-call outcomes) are all derivable from the `ResolvedIdentity` and the
  Job's warning list. No per-collision span noise is designed in.

---

## Error handling

- **Every BrandFetch / homepage failure is a value, not a throw** — adapters return `null`/`[]`,
  the shell branches to a Warning, the Job proceeds (PRD degraded paths). This is the load-bearing
  robustness contract.
- **Resolve fails the Job only** when Foundation's lifecycle dictates a hard failure for the stage
  (e.g. an *unexpected* throw escaping the shell — a programming error, not a degraded BrandFetch
  call). Absence of domains/handles/context/collisions is **always** a Warning. Resolve does not
  throw `JobFailedError` for any of its named degraded paths — its purpose (a usable anchor) is
  met by the company name alone.
- **`setResolvedIdentity` called twice** → throws (programming error; a stage ran Resolve twice).
- **A Zod parse failure** in an adapter is downgraded to the degraded-path value plus a
  structured log — never surfaced as a Job-failing throw.

---

## Testing strategy

TDD throughout — failing test first; assert on the produced `ResolvedIdentity` shape, the Warning
list, and persisted facts, never on which private method ran.

**Vitest unit (no I/O), fakes for all four ports:**
- *ResolvedIdentity / value objects*: `assemble` composes name, own domains (correct provenance),
  handles, brand context, collisions; arrays frozen (mutation throws); company-name precedence
  (canonical → homepage → anchor).
- *`deriveNegativeBoost`* (the ADR 0001 guarantee): produces the compact one-line-per-look-alike
  list from collected contexts; empty list → `""`; null-context collision → name+domain line; the
  function is **synchronous with no injected dependency** (the structural zero-LLM proof — the
  test imports it and asserts no port/Anthropic argument exists).
- *`deSelfCollisions`*: brandId match drops the target; domain-fallback match when no brandId;
  name-only inference drops the top hit and flags `inferredTarget`; a hit that is neither is kept.
- *`resolveAnchorDomain`*: domain anchor → that domain (`url_provided`/supplied provenance);
  brand-id anchor → Brand port domain (`brand_derived`); name-only / unresolved brand-id → none.
- *`ResolveStage` orchestration* (the big suite) with port fakes — one test per outcome:
  - happy path (domain anchor): full identity, no Warnings, `ctx.resolvedIdentity` set, repo saved.
  - name-only, no homepage → no domains/handles/context; one `homepageUnresolved` Warning; proceeds.
  - url-provided, homepage fetch fails → host kept as `url_provided` own domain; no handles; one
    `homepageFetchFailed` Warning; proceeds.
  - absent target Brand Context → identity without positioning; one `brandContextAbsent` Warning.
  - one collision context fetch fails → that collision `context: null`; one
    `collisionContextFetchFailed` Warning; proceeds.
  - name-only collision inference → `collisionTargetInferred` Warning; top hit excluded.
  - re-run semantics: assembly re-fetches for the same frozen anchor and never re-chooses the
    company (assert the company identity is anchor-derived, not search-derived).
  - **zero LLM**: assert the `ResolveStage` is constructed with only the four ports + repository —
    no Anthropic client is a dependency (structural ADR 0001 guarantee).

**Vitest contract tests (adapters), `fetch` stubbed via `vi.stubGlobal`:**
- Each BrandFetch adapter: pins the request (URL, Bearer header), Zod-parses a representative
  response into the port type, and on timeout / non-2xx / empty body returns the benign value
  (`null`/`[]`) — verifying transport failures surface as degraded-path signals, never throws.
- Homepage adapter: success (handles scraped from a sample HTML fixture, name read from
  `<title>`/`og:site_name`); non-2xx / network error → `null`.
- `scrapeHandles`: pure unit over HTML fixtures — finds known platforms, ignores unknown links,
  dedups.

**Vitest integration — Testcontainers (real Postgres):**
- `ResolvedIdentityRepository` round-trips a full nested identity (own domains with provenance,
  handles, collisions with and without context, brand context JSON, negative boost string).
- A re-run (new Job id) writes its own rows; the prior Job's identity rows are unchanged.

**Out of this suite (downstream):** Autoevals on the Aglow set measure whether the Negative Boost
sharpens the confusable middle — that is the **Verify** PRD's evaluation; Resolve asserts the
*shape and cost* of the boost it hands over, not Verify's precision. End-to-end name-only /
url-provided Job coverage is the Web UI PRD's Playwright integration.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file;
`OTEL_SDK_DISABLED=true` in test/CI.

---

## Out of scope (deferred)

- **Input-time disambiguation** (autocomplete UI, options list, the name-only fallback choice) —
  Web UI / Foundation. Resolve consumes the frozen anchor and never re-chooses.
- **Per-collision LLM diffing** — explicitly excluded by ADR 0001; the collected-contexts boost is
  the baseline. The revisit is an eval-gated experiment, not this stage.
- **The Verify contrast itself** (weighing positive context vs Negative Boost per page) — PRD 5.
  Resolve only *supplies* both signals.
- **Own Channel exclusion logic** — Resolve supplies own domains + handles; Filter's `own_channel`
  heuristic and the Classify backstop apply them (PRDs 4, 5).
- **OTel span emission** — PRD 8. PRD 2 leaves the facts and the anti-echo discipline; it does not
  create spans.
- **The web read model / profile card** that displays the Resolved Identity — PRD 7. PRD 2 makes
  the durable row; PRD 7 renders it.
- **Job lifecycle / terminal-state computation** — Foundation. Resolve emits Warnings and respects
  the lifecycle; how Warnings roll into `done_with_warnings` is not re-implemented here.

## Vocabulary guardrails (from `CONTEXT.md`)

- "Fetch" is **only** the Resolve homepage fetch — a second outbound fetcher anywhere is a smell.
- A **Name Collision** is a different company sharing the name — never a "competitor" or
  "namesake"; it exists to be *contrasted against*, never confused with the target.
- The **Negative Boost** is a *sharpener* for the confusable indexed-brand middle, never the
  primary rejection path (Filter heuristics + Verify's positive check are primary).
- Keep the **anchor** (frozen at input) and the **Resolved Identity** (derived per-run) strictly
  separate — conflating them reintroduces the disambiguation bug.
- A **Warning** is a partial *success*, never an error.
