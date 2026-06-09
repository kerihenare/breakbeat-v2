# Web UI & SSE Delivery — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/07-web-ui-sse.md`
**ADRs:** 0004 (OTel / process model — the span-exclusion + SSE-metrics constraint), 0006 (SSE Redis Pub/Sub bridge), 0007 (live updates are page-1-only)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`) — and **consumes the outputs of every stage**: Resolve (`docs/superpowers/specs/2026-06-09-resolve-stage-design.md`), Search (`docs/superpowers/specs/2026-06-09-search-stage-design.md`), Filter & Collapse (`docs/superpowers/specs/2026-06-09-filter-collapse-design.md`), Verify/Extract/Classify/Enhance (`docs/superpowers/specs/2026-06-09-verify-extract-classify-enhance-design.md`), Summarise (`docs/superpowers/specs/2026-06-09-summarise-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 7. The product design (problem, solution, the 40+
> user stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, `DESIGN.md`, and ADRs
> 0006/0007 and is **not** re-litigated here. This document fixes the read-model ports, the pure
> view-model layer, the four pages (nunjucks + htmx), the two Lit islands, the SSE handler + Redis
> subscriber, and the test strategy. It assumes Foundation provides `app-web.module.ts`,
> `main.web.ts`, `jobs.controller.ts` (the `POST /jobs` submit + the minimal `GET /jobs/:id` seam),
> the `submitJob` use-case + Zod `submit-job.input.ts` (the enqueue entry point and the
> `CompanyAnchor` the disambiguation choice freezes into), the `RedisEventPublisher` (the **publish**
> side of the per-Job channel — this design builds the **subscriber**), and the Drizzle schema
> (`jobs`, `warnings`, `results`, `resolved_identity`) it queries as **read models**. It assumes
> Resolve registered `BrandSearchPort` on the web side (the homepage autocomplete + options list
> reuse that **same** adapter — no second BrandFetch client). **The UI is presentation only:** it
> queries read models and consumes the SSE stream; it runs no pipeline logic and **never computes or
> re-ranks Match Score** (it reads the score as it currently stands and sorts by it).

---

## Goal

Make the pipeline legible. Turn one frozen company anchor into a started Job (disambiguating *at
input*, never re-deciding later), then read the Job's growing outputs — Resolved Identity, Job-level
Summary, scored Results, Exclusions — and present them on four server-rendered pages, **calm under
live load**: page 1 of a running Job's Result list streams new and re-scored rows in over SSE,
re-sorting by Match Score descending without violent reflow, announcing arrivals to screen-reader
users, and freezing into a stable, paginated snapshot when the Job reaches a terminal state. Every
NULL is read honestly ("Unverified", "Unclassified"); nothing is faked, nothing is hidden, and no
meaning rides colour alone. WCAG 2.2 AA is the floor.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Rendering | **Server-rendered nunjucks** templates; **Tailwind v4** mapped to the `DESIGN.md` tokens; **htmx** for every request/response-and-swap |
| htmx surface | Form submit, raw-text options-list disambiguation, filter-chip selection, list pagination, the Excluded/lower-confidence disclosure — all server round-trips returning HTML fragments |
| Lit surface (exactly two islands) | (1) homepage **typeahead autocomplete** (debounced, keyboard listbox, `BrandSearchPort`-backed); (2) Result-page **live SSE stream** (EventSource mgmt, ≤200ms entrance, in-place re-sort by Match Score, ARIA live-region writes). **Nothing else is Lit.** |
| Read access | **Drizzle/Postgres read models only** — never against pipeline internals, never the stage repositories' write methods. Five read-model ports, web-side providers |
| View-model layer | A **pure**, framework-free presentation-logic module (the richest unit-test target): NULL readings, formatters, Match Score → bar+number, status/sentiment/content-type mappings, chip counts, pagination maths, the row-merge/re-sort |
| Match Score | Read **as-is** (provisional → interim → authoritative); the UI sorts by it descending and never recomputes it |
| Worker→web bridge (ADR 0006) | A `JobEventSubscriberPort` (ioredis) the web side subscribes per-Job channel; on each **id-only nudge** the SSE handler runs the read-model query against Postgres and emits the frame. **Content never rides the channel** |
| Live scope (ADR 0007) | EventSource mutates **only the page-1 DOM**; pages 2+ are static snapshots; terminal Job → frozen/stable everywhere |
| SSE replay | **None on connect.** Page 1 is server-rendered on load; SSE carries only subsequent deltas |
| Idempotency | Row-level by `resultId` — re-deliver/update → in place, **never** duplicate |
| Observability | **Deferred to PRD 8.** This design only *fixes the seam*: SSE + health routes excluded from HTTP spans; SSE health is metrics-only (active-connections gauge + messages-sent counter) |
| Unit tests | **Vitest** over the view-model/formatting layer (all NULL readings, formatters, mappings, chip counts, pagination maths, row-merge/re-sort) |
| Integration / E2E | **Playwright** (page flows + live SSE) with **axe-core** a11y inside it, against the **docker-compose** Postgres/Redis (ADR 0008) — not Testcontainers |
| Gates | Biome (format + lint) + `tsc` clean; FTA `OK` per non-test file; `OTEL_SDK_DISABLED=true` in test/CI |

---

## Architecture

The web surface is a thin **interface + presentation** slice over Foundation's hexagonal layering;
the dependency arrow still points inward (`interface → application → domain`, `infrastructure`
implements `application`'s ports). The **read-model ports** are application interfaces; the Drizzle
read adapters and the ioredis subscriber are **infrastructure**; the **view-models** are pure
domain-adjacent presentation logic (no I/O, no NestJS, no DOM); controllers, templates, the SSE
handler, and the two Lit islands are **interface/presentation**. The UI imports **no** stage class,
**no** `Stage` port, **no** write-side repository method (`insertIncluded`, `recordExclusion`, …) —
it reads its own purpose-built read models and nothing else.

### Source layout (new files unless marked *modify*)

```
src/
  presentation/                      # PURE view-models — no I/O, no NestJS, no DOM (Vitest target)
    null-readings.ts                 # readVerification(): NULL→"Unverified"; readContentType(): NULL→"Unclassified"
    match-score.vm.ts                # toScoreBar(): score→{ widthPct, numeric } | "Unverified" (independent of status)
    job-status.vm.ts                 # toStatusBadge(): JobState → { label, tone, dotKind } (non-colour-only)
    content-type.vm.ts               # toContentTypeChip(): type → { group, iconKey, label } (colour AND shape AND text)
    sentiment.vm.ts                  # toSentiment(): sentiment|NULL → { label, dotKind } | "—"
    exclusion.vm.ts                  # toExclusionReason(): code+detail → human label (reason, never the catching stage)
    format.vm.ts                     # formatDate(), formatSourceDomain(), formatRunTime() (relative + title)
    chips.vm.ts                      # deriveChips(): per-type counts → chip rows with zero-count disabling
    pagination.vm.ts                 # paginate(): total+page+size → { range, pages[], prevDisabled, nextDisabled }
    result-row.vm.ts                 # toResultRowVM(): a read-model row → the flat-row view-model the template/SSE share
    row-merge.ts                     # mergeRow(): insert/update-by-id + re-sort by Match Score desc (the live-list invariant)
  application/read/
    ports/
      jobs-list.read-port.ts         # JobsListReadPort + JobsListView + token
      resolved-identity.read-port.ts # ResolvedIdentityReadPort + ProfileCardView + token
      summary.read-port.ts           # SummaryReadPort + SummaryView + token
      results.read-port.ts           # ResultsReadPort + ResultsView (included + collapsed excluded) + token
      result-detail.read-port.ts     # ResultDetailReadPort + ResultDetailView + token
      job-event-subscriber.port.ts   # JobEventSubscriberPort (subscribe/unsubscribe per-Job channel) + nudge type + token
    read-config.ts                   # page sizes, autocomplete debounce/min-chars (from @nestjs/config) + token
  infrastructure/
    read/
      jobs-list.read.ts              # JobsListReadPort over Drizzle (jobs ⋈ resolved_identity ⋈ included-count)
      resolved-identity.read.ts      # ResolvedIdentityReadPort over Drizzle (the four resolved_identity tables)
      summary.read.ts                # SummaryReadPort over Drizzle
      results.read.ts                # ResultsReadPort over Drizzle (filter/sort/paginate; partition included|excluded)
      result-detail.read.ts          # ResultDetailReadPort over Drizzle (one Result by id within its Job)
    events/
      redis-event.subscriber.ts      # JobEventSubscriberPort over ioredis (the SUBSCRIBE side; status publish is Foundation's, result publish is the seam below)
    persistence/
      result.repository.ts           # *modify* — publish { jobId, kind:"result", id } after each committed Result write (the per-Result publish seam)
      job-event-publisher.port.ts    # *modify* — widen publish() to { jobId, kind:"status"|"result", id? } (Foundation owns the interface)
  interface/web/
    jobs.controller.ts               # *modify* — GET / (home), GET /searches, GET /jobs/:id (Result page),
                                      #            POST /jobs/disambiguate (options list), GET /jobs/:id/page/:resultId,
                                      #            htmx fragment routes for filter/pagination/excluded
    sse.controller.ts                # GET /jobs/:id/stream — the SSE handler (subscribe → query → emit frames)
    brand-search.controller.ts       # GET /brand-search?q= — autocomplete + options-list backing (BrandSearchPort)
    view-render.ts                   # nunjucks env config + the view-model → template-context glue
    templates/                       # nunjucks
      layout.njk  home.njk  searches.njk  result.njk  page.njk
      partials/   profile-card.njk  summary.njk  filter-chips.njk
                  result-row.njk  excluded-disclosure.njk  paginator.njk  status-badge.njk
    assets/
      bb-autocomplete.ts             # Lit island #1 — typeahead listbox (BrandSearch-backed)
      bb-result-stream.ts            # Lit island #2 — EventSource + entrance + re-sort + live-region writes
      tailwind.css                   # Tailwind v4 @theme mapped to DESIGN.md tokens
  app-web.module.ts                  # *modify* — register the five read ports, the subscriber, nunjucks, SSE/health span-exclusion
  app-worker.module.ts               # *modify* — inject JobEventPublisher into the ResultRepository adapter (the result-nudge publish seam)
  main.web.ts                        # *modify* — serve static assets; nunjucks view engine; SSE keep-alive headers
```

The `*.read.ts` adapters issue **read-only** SQL against the same Postgres the worker writes; they
hold no opinion on how a column got its value (that is the stages' job) and never mutate a row.

---

## Read models

All five reads go through Drizzle/Postgres and return **flat, presentation-shaped DTOs** — never
the stage aggregates, never the write-side repositories. Match Score is read as it currently stands;
NULLs are returned **as NULL** (the view-model reads them, not the query). Each port is the single
seam a page composes from; a page's controller calls one or more ports and hands the results to the
view-models.

### `JobsListReadPort` — the Searches list

```ts
type JobsListRow = {
  jobId: string;
  anchorName: string;            // the durable anchor's display name (anchor_name, or the resolved company_name when present)
  anchorDomain: string | null;   // anchor_domain when disambiguated; null for name-only
  state: JobState;               // 'pending' | 'running' | 'done' | 'done_with_warnings' | 'failed'
  includedCount: number;         // COUNT(results WHERE status='included')
  createdAt: Date;               // for "most-recent-first" order + run-time display
};
type JobsListView = { rows: JobsListRow[]; total: number; page: number; pageSize: number };
interface JobsListReadPort {
  list(page: number, pageSize: number): Promise<JobsListView>;
}
const JOBS_LIST_READ_PORT = Symbol("JobsListReadPort");
```

A single query: `jobs` left-joined to `resolved_identity` (the company name once Resolve has run,
else the anchor name) and a correlated/joined `included` count, **ordered `created_at` desc**,
`LIMIT/OFFSET` paginated, plus a `COUNT(*)` for the pagination range. A `running` Job's
`includedCount` is "so far" — the view-model labels it (mockup: "6 *so far*").

### `ResolvedIdentityReadPort` — the profile card

```ts
type ProfileCardView = {
  companyName: string;
  ownDomains: { domain: string; provenance: string }[];
  handles: { platform: string; handle: string; url: string }[];
  description: string | null;    // brandContext.description ?? tagline ?? mission
  tags: string[];
  alsoKnownAs: string[];         // from collision de-self / brand aliases where present
  collisions: { name: string; domain: string }[];  // the negative-boosted look-alikes, for the Warning note
  hasIdentity: boolean;          // false until Resolve has written the row (pending/early-running Jobs)
};
interface ResolvedIdentityReadPort {
  findByJobId(jobId: string): Promise<ProfileCardView | null>;
}
const RESOLVED_IDENTITY_READ_PORT = Symbol("ResolvedIdentityReadPort");
```

Reads the `resolved_identity` parent + its `own_domains` / `handles` / `collisions` child tables
(Resolve's schema). The Resolve-time Warning the card surfaces ("2 same-name companies were
negative-boosted out of results…") is rendered from `collisions` joined with the Job's `warnings`
rows of `resolve.*` type — the **reason** shown to the user, never the catching internals.

### `SummaryReadPort` — the Enhancement details summary

```ts
type SummaryView = { text: string | null };   // the Job-level Summary; null while Summarise hasn't run / warned-empty
interface SummaryReadPort { findByJobId(jobId: string): Promise<SummaryView>; }
const SUMMARY_READ_PORT = Symbol("SummaryReadPort");
```

One Job-level Summary (the Summarise stage's output — *not* the per-Result Enhancement takeaway,
which is a different thing per `CONTEXT.md`). NULL → the card omits the Summary block rather than
faking one. **Canonical columns:** the Summary read targets the one-row-per-Job `summaries` table
(`summaries.summary`, PRD 06); the `ResultDetailReadPort`'s extracted full-text read (its `fullText`
field) targets `results.extracted_content` (PRD 05) — the DB column is `extracted_content`, the
view-model field stays `fullText`.

### `ResultsReadPort` — the scored, filterable, partitioned list

```ts
type ResultRowRead = {
  resultId: string;
  headline: string;                  // results.title
  url: string;                       // the canonical external URL (for the Page link target lookup)
  sourceDomain: string;              // formatted from url (registrable host)
  publishedDate: Date | null;
  matchScore: number | null;         // read as-is; NULL is possible and does NOT imply NULL status, and vice-versa
  verificationStatus: "verified" | "uncertain" | null;
  contentType: string | null;        // one of the closed Content Type set, or NULL
};
type ExcludedRowRead = ResultRowRead & {
  exclusionCode: ExclusionCode;      // own_channel | aggregator | ecommerce_review | out_of_window | duplicate | off_topic
  exclusionDetail: string | null;    // the catcher / stable reference — surfaced as a reason, never as a stage name
};
type ContentTypeCount = { contentType: string | null; count: number };  // NULL bucket = "Unclassified"
type ResultsView = {
  included: ResultRowRead[];         // the page slice, status='included', ordered match_score DESC NULLS LAST, then id
  includedTotal: number;             // for pagination + the "· N included" header
  typeCounts: ContentTypeCount[];    // per content_type counts over ALL included rows (chip counts), incl. the NULL bucket
  excluded: ExcludedRowRead[];       // the collapsed lower-confidence/excluded set (no pagination — disclosure)
  excludedTotal: number;
};
interface ResultsReadPort {
  read(jobId: string, opts: { page: number; pageSize: number; contentType?: string | null }): Promise<ResultsView>;
}
const RESULTS_READ_PORT = Symbol("ResultsReadPort");
```

The load-bearing read. It **partitions** `results` into the high-signal `included` list (paginated,
ordered by `match_score` descending — `NULLS LAST` so an un-scored-but-included row sinks beneath
scored rows, matching the provisional-ordering intent) versus the collapsed `excluded` set (each
carrying `exclusion_code` + `exclusion_detail` for its reason). `typeCounts` is computed over **all
included rows** (not the current page) so the chips show true availability; the `contentType` filter
narrows the `included` slice while keeping the `match_score desc` order and pagination coherent.
"Lower-confidence" `included` rows (an `included` + `uncertain` Result the mockup shows inside the
disclosure as "Uncertain match") are a **view-model** partition decision driven by
`verificationStatus === "uncertain"`, not a separate query — see the view-model layer.

> **Page-1-only consistency (ADR 0007).** The `page === 1` slice and the Lit client's in-place
> re-sort **must** order by the same key — `match_score` descending. This is the single invariant
> that lets the server-rendered page 1 and the live-mutated page 1 stay identical; it is asserted
> on both sides (read-model integration test + view-model `mergeRow` unit test).

### `ResultDetailReadPort` — one Result (the Page)

```ts
type ResultDetailView = {
  resultId: string; jobId: string;
  headline: string;
  url: string;                        // the original external Page (the prominent "Read original" target)
  sourceDomain: string;
  publishedDate: Date | null;
  matchScore: number | null;
  verificationStatus: "verified" | "uncertain" | null;
  contentType: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  takeaway: string | null;            // the per-Result Enhancement takeaway ("result summary")
  fullText: string | null;            // the Extracted full-text content (results.extracted_content, PRD 05)
};
interface ResultDetailReadPort { findById(jobId: string, resultId: string): Promise<ResultDetailView | null>; }
const RESULT_DETAIL_READ_PORT = Symbol("ResultDetailReadPort");
```

One `results` row scoped to its Job (both ids in the query — a Result is Job-scoped). All trust
facts come straight off the row; NULLs are read honestly by the view-models.

---

## View-models

The pure presentation-logic layer — **no I/O, no NestJS, no DOM** — and the richest unit-test
target. Every mapping the rendered HTML and the SSE frames depend on lives here, once, so the
nunjucks template, the htmx fragment, and the Lit island all agree. These functions are total over
their inputs (a NULL is a valid input, never a crash).

### NULL readings — `null-readings.ts`

- `readVerification(status)`: `"verified" → "Verified"`, `"uncertain" → "Uncertain match"`,
  **`null → "Unverified"`**. "Unverified" is a *reading* of NULL computed at render — never a stored
  value, never written back.
- `readContentType(type)`: a known type → its label; **`null → "Unclassified"`** (same rule —
  reading, not storage; `other` is a real stored value and reads "Other", distinct from NULL).

### Match Score — `match-score.vm.ts` (independent of verification)

```ts
type ScoreVM = { kind: "scored"; numeric: number; widthPct: number } | { kind: "unscored" }; // unscored → "Unverified" reading
function toScoreBar(matchScore: number | null): ScoreVM;
```

`matchScore` clamps to `0–100`; `widthPct === numeric`; the bar fills in **Ink** (structural, not a
brand bright — the Match Score Indicator rule). **The score and the verification reading are
rendered independently and one NULL never implies the other:** an Extract-failed Result reads
"Unverified" (NULL `verification_status`) yet still shows its interim numeric Match Score — the
row-VM composes `toScoreBar(matchScore)` and `readVerification(status)` separately, and a unit test
pins exactly this case (`status = null`, `matchScore = 74` → bar at 74 *and* the "Unverified"
reading, both present).

### Job status — `job-status.vm.ts`

`toStatusBadge(state)` → `{ label, tone, dotKind }`, non-colour-only (a dot/glyph **plus** a word):
`pending → "Pending"`, `running → "Researching…"` (a pulsing-dot kind, with a reduced-motion
fallback), `done → "Done"`, `done_with_warnings → "Done · warnings"`, `failed → "Failed"`. `tone`
selects the palette step but is **never** the only signal — the label and dot kind carry it for
colour-blind users.

### Sentiment & Content Type

- `toSentiment(sentiment)` → `{ label, dotKind } | "—"`: `positive`/`neutral`/`negative` each a
  dot **and** a word; `null` reads "—" (Enhance didn't run / warned) — honest, not faked.
- `toContentTypeChip(type)` → `{ group, iconKey, label }`. The closed Content Type set maps to icon
  **groups** that carry colour **and** shape **and** text: editorial group (`news_article`,
  `trade_publication`, `press_release`) → blue tile; written group (`blog_post`, `newsletter`) →
  green tile; social group (`major_social_post`, `podcast`) → pink tile; `other` and the NULL
  ("Unclassified") reading → the neutral group. Group colour is a redundant signal atop the icon
  shape and the label — never alone.

### Chips — `chips.vm.ts`

`deriveChips(typeCounts, selectedType)` → an ordered chip list: an "All" chip (total included), then
one chip per Content Type in a fixed canonical order, each with its count and `selected` flag.
**Zero-count types are emitted `disabled`** (the mockup's disabled "Podcast · 0"). The NULL bucket
surfaces as an "Unclassified" chip when its count > 0. Counts come from `ResultsView.typeCounts`
(over all included rows), so the chips show availability independent of the current page or filter.

### Pagination — `pagination.vm.ts`

`paginate(total, page, pageSize)` → `{ rangeLabel, pages, prevDisabled, nextDisabled }`:
`rangeLabel` is "1–11 of 11" style (`from = (page-1)*size + 1`, `to = min(page*size, total)`, "0 of
0" when empty); `pages` is the windowed button list with ellipses (mockup: `1 2 3 … 4`);
`prevDisabled` at page 1, `nextDisabled` on the last page. Pure integer maths, exhaustively
unit-tested at the boundaries (single page, exact-fit last page, empty, page beyond range clamps).

### Exclusion reason — `exclusion.vm.ts`

`toExclusionReason(code, detail)` → a human label that surfaces the **reason**, never the catching
stage (`CONTEXT.md`): `own_channel → "Own channel"`, `aggregator → "Aggregator"`,
`ecommerce_review → "Ecommerce"`, `out_of_window → "Outside 36-month window"`,
`duplicate → "Duplicate"` (with the `"of:<id>"` detail rendered as "of <headline>" where the winner
is resolvable), `off_topic → "Off-topic · different entity"`. An `included` + `uncertain` row in the
disclosure reads "Uncertain match" (from `readVerification`, not an exclusion code — it is *not*
Excluded, just low-confidence). `exclusion_detail = "LLM"` is never shown verbatim (it records the
catcher; the user sees only the reason).

### The shared row VM — `result-row.vm.ts`

`toResultRowVM(row)` composes a read-model row (included **or** excluded) into the single flat-row
shape the `result-row.njk` partial and the Lit stream component both render: `{ resultId, headline,
pageHref, sourceDomain, dateLabel, score: ScoreVM, verification: <reading>, contentType: <chip>,
exclusionReason?: <reason>, lowConfidence: boolean }`. `lowConfidence = verificationStatus ===
"uncertain"` — the flag that, together with `excluded`, drives the disclosure partition. One VM
shape means **the SSE-inserted row is byte-identical to the server-rendered row** (story 24/25 — no
"live row looks different from a refreshed row").

### The live-list invariant — `row-merge.ts`

```ts
function mergeRow(rows: ResultRowVM[], incoming: ResultRowVM): ResultRowVM[];
```

The pure heart of the live list. `mergeRow`:

1. **De-dupes by `resultId`** — if a row with that id exists, it is **updated in place** (its score,
   verification reading, content-type chip replaced); if not, it is **inserted**. A re-delivered or
   re-scored Result by id **never** produces a duplicate (ADR 0006 row-level idempotency; PRD story
   25).
2. **Re-sorts by Match Score descending** (`scored` before `unscored`; ties broken by `resultId` for
   stability) — a Verify flip that *raises* a score moves the row up; one that lowers it moves it
   down; the order matches the `page === 1` read-model query exactly.

`mergeRow` is pure and Vitest-tested independent of the DOM; the Lit component calls it and then
reconciles the DOM to the returned order (the page-1-cutoff drop is the component's concern, below).
This separation is what keeps the live-list correctness testable without a browser.

---

## Pages & templates

Four pages, server-rendered nunjucks on a shared `layout.njk` (the newsprint ground, the top bar +
wordmark, the Tailwind tokens). htmx drives every interaction that is a server round-trip; the two
Lit islands are the only client-state components. The `view-render.ts` glue maps view-models to the
template context so templates contain **no logic beyond iteration and the booleans the VM already
computed**.

### 1. Homepage (`GET /` → `home.njk`)

A single form, horizontally and vertically centred, on a **floating** card — the one place the
**Warm-Shadow / Float** shadow is legitimate (a genuinely floating surface). One input (company name
*or* domain), one full-width primary submit (`button-primary`: Ink-Control fill), and a link to the
Searches list at the bottom.

- **Autocomplete (Lit island #1, `bb-autocomplete`).** A custom element wrapping the input: debounced
  (config'd ms) keystrokes call `GET /brand-search?q=…` (backed by `BrandSearchPort` — Resolve's
  adapter, reused, **not** a second client), rendering a keyboard-navigable `role="listbox"` of
  suggestions (name, domain, logo where available — story 4). The popover uses the **Float** shadow
  (a floating menu). Picking a suggestion fills the hidden disambiguated fields (`brandId` / `domain`
  + `provenance: "picked"`) and the form **submits directly** → `submitJob` → redirect to the new
  Job's Result page.
- **Raw-text disambiguation (htmx, no Lit).** If the user submits without picking a suggestion,
  `POST /jobs/disambiguate` returns an HTML fragment (htmx swap): a **list of Brand Search options**
  (the same `BrandSearchPort` query), **plus** a website-domain input as an explicit fallback, **plus**
  an explicit "Proceed name-only" choice (story 6/7). The user's selection — a matched brand, a typed
  domain (`provenance: "url_provided"`), or name-only (`provenance: "name_only"`) — is what
  `submitJob` freezes into the `CompanyAnchor`. The UI **passes the choice through and never
  re-decides it later** (Foundation owns the freeze; Resolve re-fetches but never re-chooses).
- On submit, `jobs.controller` calls Foundation's `submitJob` and **redirects to
  `GET /jobs/:id`** (the Result page).

### 2. Searches list (`GET /searches` → `searches.njk`)

`JobsListReadPort.list(page, size)` → the flat searches table (the **Result-Row-as-flat-row** rule
applied to Jobs too: hairline-separated rows, not cards). Per row: the company (anchor name + domain,
a logo tile), the **status badge** (`toStatusBadge` — dot + label, never colour-only), the
included-count ("N", or "N so far" while `running`, "—" when `failed`), and the run time
(`formatRunTime` — relative "2h ago" with an absolute `title`). Rows link to the Result page.
Pagination via the shared `paginator.njk` partial; htmx swaps the table body on page-nav.

### 3. Result page (`GET /jobs/:id` → `result.njk`) — the live page

Composes three reads scoped to the Job — `ResolvedIdentityReadPort` (profile card),
`SummaryReadPort` (the Enhancement details summary), and `ResultsReadPort` (page-1 slice + chip
counts + the excluded set) — server-renders the whole page (**page 1 is rendered on load; there is
no SSE replay**), then mounts the Lit stream island for live deltas.

- **Profile card** (`profile-card.njk`): an **in-flow** card — a 1px **Newsprint Border** + tonal
  layering, **not** the Float shadow (the Tonal-Before-Shadow rule; only the homepage form floats).
  Name, own domains, scraped handles, description, tags, also-known-as, and the Resolve-time Warning
  note when present (the negative-boosted look-alikes). A `pending`/early `running` Job whose Resolve
  hasn't written the identity yet shows a minimal anchor-only card (`hasIdentity: false`).
- **Summary** (`summary.njk`): the Job-level Summary as the "Summary" block near the top; omitted
  cleanly when NULL.
- **Filter chips** (`filter-chips.njk`): `deriveChips(...)` — pill chips, icon + label + count,
  selected fills Ink, **zero-count disabled** (the chip spec). Selecting a chip is an htmx round-trip
  (`GET /jobs/:id?type=…` returning the list fragment) that re-queries `ResultsReadPort` with the
  filter — ordering and pagination stay coherent under the filter.
- **Result rows** (`result-row.njk` ×N): flat flex rows (hairline-separated, **never cards**, no >1px
  coloured accent stripe) — the Content Type icon tile (colour + shape + label), the headline linking
  to the Page, source domain + date, the **Match Score Indicator** (numeric + 3px Ink bar). Wrapped
  in the polite **ARIA live region** (`<ul aria-live="polite">`).
- **Excluded disclosure** (`excluded-disclosure.njk`): a `<details>` collapsed by default holding the
  lower-confidence (`uncertain`) and Excluded rows, each with its reason (`toExclusionReason`).
  Opening it is htmx-lazy or pre-rendered-collapsed (the rows are already in `ResultsView.excluded`).
- **Empty / degraded states** (the honest distinctions):
  - **Empty-`done` / `done_with_warnings`** (terminal, zero `included`): the explicit empty state
    **"No third-party coverage found in the last 36 months"** — an honest finding (`CONTEXT.md`: a
    judged population narrowed to zero is *not* a failure).
  - **`failed`**: a distinct message explaining the run failed with **nothing to show** — visually
    and semantically different from the empty-`done` state ("we looked, nothing" vs "the run broke").
  - **`done_with_warnings`** with Results: the list renders normally with the warning state made
    plain on the status badge (the partial-success output is usable).
- **Live stream (Lit island #2)** — see *Live delivery* below.

### 4. Page (`GET /jobs/:id/page/:resultId` → `page.njk`)

`ResultDetailReadPort.findById(jobId, resultId)` → the page-details card (in-flow, bordered): Content
Type, headline, a **prominent, safe "Read original" link** (`target="_blank" rel="noopener
noreferrer"` to the external `url`), and the trust facts — source, published date, Match Score
(mini-bar + number), Verification reading, Sentiment — each read honestly (a NULL Sentiment/Verification
reads "—"/"Unverified", never hidden or faked, story 39). Below: the per-Result **Enhancement
takeaway** ("Summary") block and the **Extracted full-text content** (noted "Extracted via Tavily" per
the mockup). A `404` when the Result id doesn't belong to the Job.

---

## Live delivery (SSE + Redis bridge)

The Result page is the only live surface. Foundation built the publisher **interface**
(`JobEventPublisher`) and the **status** nudge (the `runJob` use-case publishes `{ jobId, kind:
"status" }` after each committed Job-state write — established as the seam PRD 7 grows from). This
design builds the rest: the **per-Result publish seam** (the `{ jobId, kind: "result", id }` nudges
Foundation did *not* build), the **subscriber**, and the SSE handler.

### Per-Result publish seam (worker-side, `result.repository.ts` *modify*; `app-worker.module.ts` *modify*)

Foundation's status nudge fires in `runJob`; there is **no** per-Result publish call site yet. Rather
than scatter publish calls across the Result-writing stages (Search's `insertIncluded`, Filter's
`recordExclusion`, Analyze's score/field writes — three stages, several write methods, and two of those
stage specs are frozen), this design wires the per-Result nudge **once, in the `ResultRepository`
Drizzle adapter**: after each committed write that creates or changes a Result row, the adapter
publishes `{ jobId, kind: "result", id: resultId }` via the injected `JobEventPublisher`. One seam
covers every Result change, the stages stay ignorant of SSE, and the publish is fire-and-forget *after*
commit (Postgres is the source of truth; a failed publish is logged and swallowed, exactly as
Foundation's status publish is — ADR 0006). The publisher contract is widened to
`publish(nudge: { jobId: string; kind: "status" | "result"; id?: string })` (Foundation's status nudge
omits `id`; the subscriber re-reads Job state for it). This is the **only** worker-side change this PRD
makes — it is the publish half of the SSE feature this PRD owns end-to-end; it touches no stage logic
and emits no content (anti-echo holds: id-only).

### `JobEventSubscriberPort` (ioredis adapter, ADR 0006)

```ts
type JobNudge = { jobId: string; kind: "result" | "status"; id?: string }; // id-only — NEVER content; id present on "result", omitted on "status"
interface JobEventSubscriberPort {
  subscribe(jobId: string, onNudge: (n: JobNudge) => void): Promise<() => Promise<void>>; // returns an unsubscribe fn
}
const JOB_EVENT_SUBSCRIBER_PORT = Symbol("JobEventSubscriberPort");
```

`redis-event.subscriber.ts` uses a **dedicated ioredis connection in subscriber mode** (a connection
in subscribe mode can't issue other commands — it is separate from the BullMQ/publisher connection),
subscribes to the per-Job channel Foundation publishes on, parses each message into `JobNudge`
(tolerant: a malformed/duplicate message is dropped, not thrown — harmless by design), and the
returned thunk unsubscribes and releases the connection on stream close.

### The SSE handler (`GET /jobs/:id/stream`)

A NestJS streaming response (`text/event-stream`, `Cache-Control: no-cache`, `Connection:
keep-alive`, periodic comment heartbeat to defeat idle proxies). On connect:

1. **No replay.** The handler emits **nothing** for already-rendered rows — page 1 was server-rendered
   on load; SSE carries only subsequent deltas (ADR 0006).
2. `subscribe(jobId, onNudge)`. On each nudge:
   - **`kind: "result"`** → run `ResultsReadPort` (or a single-row read) for `id`, build the
     `ResultRowVM`, and emit an SSE **Result event** carrying the row's *current* Match Score, Content
     Type reading, Verification reading, source, date, headline, and Page link. **The content is
     fetched from Postgres (source of truth) at emit time — it never rode the channel** (anti-echo for
     free; a dropped/duplicate nudge is harmless because the next nudge or a reconnect re-reads).
   - **`kind: "status"`** → read the Job's current state and emit a **Job status event**.
3. **Two SSE message kinds only:** `result` (a flat-row payload — pre-rendered HTML fragment **or** the
   `ResultRowVM` JSON; the implementation ships the VM JSON and lets the client render through the same
   template logic, guaranteeing parity) and `status`.
4. **Terminal completion:** when a `status` nudge resolves to a terminal state (`done` /
   `done_with_warnings` / `failed`), emit the final status event and **end the stream**; the client
   closes the EventSource. The list is then frozen.
5. On client disconnect (or terminal close), call the unsubscribe thunk — no leaked Redis
   subscriptions.

### The Lit stream client (`bb-result-stream`)

Owns the EventSource and **mutates only the page-1 DOM** (ADR 0007):

- On a **Result event**: build the `ResultRowVM`, call `mergeRow(currentPage1Rows, vm)` (insert/update
  by id + re-sort by Match Score desc — the shared pure function), then reconcile the DOM. A **new**
  row enters with a ≤200ms fade/slide; an **updated** row (a score flip) animates to its new position.
  A row pushed **below the page-1 cutoff** drops off the bottom (its slot taken by the next-highest);
  the page-1 DOM stays bounded at `pageSize`. Pages 2+ are static server snapshots and the component
  **never touches them**.
- On a **status event**: update the status badge; on a **terminal** status, stop streaming, close the
  EventSource, and leave the list frozen.
- **ARIA live region:** the component writes *concise* polite announcements — that Results are arriving
  (coalesced, not one per row) and the Job's terminal transition ("Done", "Done with warnings",
  "Failed") — into the live region. This is the accessibility counterpart of the fade/slide, **not** a
  per-row read-aloud.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, the entrance/re-sort fall back to an
  instant update / crossfade and the running-status pulse is stilled — updates still land, just without
  movement.
- **Reconnect:** a dropped connection re-reads page 1 (server-rendered) and re-opens the stream — no
  replay needed, no duplicate rows (idempotent by id). A reconnecting client is always correct because
  Postgres is the source of truth.

---

## Infrastructure & DI wiring

### Drizzle read adapters

Each `*.read.ts` implements its read port with **read-only** Drizzle queries against the shared
Postgres. They never call a write method and hold no transaction beyond the single read. `results.read.ts`
is the most involved: it issues the partitioned, filtered, ordered, paginated `included` query
(`order by match_score desc nulls last, result_id`), the over-all-included `typeCounts` aggregate
(grouped by `content_type`, including the NULL bucket), and the `excluded` set with `exclusion_code` /
`exclusion_detail`. These adapters are the only place SQL lives; the view-models stay pure.

### `app-web.module.ts` (*modify*) and `main.web.ts` (*modify*)

- Register the five read-port providers (→ their Drizzle adapters) and `JobEventSubscriberPort` (→
  `redis-event.subscriber.ts`, a dedicated subscriber ioredis connection from the shared connection
  config), plus a `ReadConfig` provider (`@nestjs/config`: `RESULTS_PAGE_SIZE`, `SEARCHES_PAGE_SIZE`,
  `AUTOCOMPLETE_DEBOUNCE_MS`, `AUTOCOMPLETE_MIN_CHARS`).
- `BrandSearchPort` is **already** registered web-side by Resolve — the autocomplete + options-list
  controllers consume that provider; **no second BrandFetch client** is wired here.
- Configure the **nunjucks** view engine + static-asset serving (the compiled Tailwind CSS + the two
  Lit bundles) in `main.web.ts`; set SSE-friendly headers on the stream route.
- **Span-exclusion seam (the only Observability wiring this PRD does):** mark `GET /jobs/:id/stream`
  and the Terminus health route as **excluded from HTTP span creation** (the hook PRD 8 reads). The UI
  exposes the hooks; PRD 8 wires the actual metrics.
- `.env.example` gains the read/autocomplete config keys above. No new external client, no new API key
  (BrandFetch is Resolve's; Postgres/Redis are Foundation's).

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, metrics, and the Bugsink/otel-lgtm split are **PRD 8's** to build (ADR 0004). This
design only **fixes the constraints** PRD 8 must honour and exposes the hooks:

- **Route hygiene (ADR 0004).** The **SSE stream route** (`GET /jobs/:id/stream`) and the **Terminus
  health route** are **excluded from HTTP span creation** — an SSE connection's lifetime is "how long
  the human watched," not a unit of work, and would otherwise mint a single span lasting the whole
  Job. This design registers the exclusion; PRD 8 reads it.
- **SSE health is metrics-only.** No span per nudge, no span per emitted frame. The shape PRD 8 wires:
  an **active-connections gauge** (incremented on connect, decremented on close/terminal) and a
  **messages-sent counter** (per emitted SSE frame). This design exposes the increment/decrement and
  count **hook points** in the SSE handler; it does not create the OTel instruments.
- **Anti-echo holds trivially here.** The nudge is id-only; the SSE frame carries Match Score, the
  Content Type/Verification readings, source, date, headline, and the Page link — **no model text, no
  scraped page text** ever rides the channel or a future span/log (`exclusion_detail` is rendered as a
  reason label, never echoed raw).
- **Read models are uninstrumented detail.** The auto-instrumented `postgres`/`ioredis` calls PRD 8
  enables are the read-side facts; no read-model query needs a manual span.

---

## Error handling

- **Degraded Job states render honestly.** `done_with_warnings` shows the list with the warning state
  plain; `failed` shows the distinct "nothing to show" message; an empty-`done`/`done_with_warnings`
  Job shows "No third-party coverage found in the last 36 months" — three honest, *distinct* facts
  (`CONTEXT.md`: empty-but-judged ≠ failed).
- **A dropped/duplicated SSE nudge is harmless.** The handler re-queries Postgres on the next nudge;
  `mergeRow` is idempotent by id; a reconnecting client re-reads page 1. This is the ADR 0006 robustness
  contract — content never rode the channel, so a lost message costs nothing.
- **A Redis subscriber failure** (connection drop) ends the SSE response cleanly; the client's
  EventSource auto-reconnects and re-reads page 1. The page is never wrong, only momentarily not-live.
- **A read-model query for a missing Job** → `404` (Result page) or an empty Searches list — never a
  500 for a normal absence.
- **A pending/early-running Job** (Resolve/Search/Summarise not yet written) renders the minimal cards
  and the empty/loading list, then fills in over SSE — there is no "blank page while loading" because
  page 1 is server-rendered from whatever exists at request time and the stream carries the rest.
- **A malformed external `url`** degrades in `formatSourceDomain` (returns the raw string, never
  throws); the "Read original" link still points at the stored `url`.

---

## Testing strategy

TDD throughout — failing test first; assert on **what the user observes** (rendered HTML, live
updates, announcements, navigation), never internal wiring.

**Vitest unit (no I/O) — the view-model/formatting layer (the big suite):**
- *NULL readings*: NULL `verification_status` → "Unverified"; NULL `content_type` → "Unclassified";
  `other` reads "Other" (distinct from NULL); a real status/type reads its label.
- *Match Score independence (the load-bearing case)*: `status = null, matchScore = 74` → bar at 74%
  **and** the "Unverified" reading, both present (one NULL never implies the other); `matchScore =
  null` → "unscored" ScoreVM; clamp/round at the 0/100 boundaries; the bar fills Ink, not a bright.
- *Mappings*: Job status → non-colour-only badge (label + dot kind for every state); Sentiment →
  dot + word, NULL → "—"; Content Type → group + iconKey + label (colour AND shape AND text) for
  every type incl. `other` and the NULL reading.
- *Chips*: counts derived over all included rows; zero-count types `disabled`; the "All" total; the
  NULL bucket surfaces as "Unclassified" only when > 0; canonical chip order stable.
- *Pagination maths*: range label at first/last/single/empty pages; windowed page list with ellipses;
  prev/next disabled at the ends; a page beyond range clamps.
- *Exclusion reasons*: each `exclusion_code` → its human reason (never the catching stage); `"LLM"`
  detail never shown verbatim; `duplicate` `"of:<id>"` renders "of <winner>"; an `uncertain` included
  row reads "Uncertain match", not an exclusion.
- *`mergeRow` (the live-list invariant)*: insert keeps Match Score desc order; update-by-id replaces
  in place (no duplicate); a score flip re-positions a row up/down; ties stable by id; `unscored`
  sinks beneath `scored` — the order matches the page-1 read-model ordering.
- *Row VM parity*: `toResultRowVM` produces one shape for both the server-render path and the SSE
  path (an SSE-inserted row is identical to a refreshed row).

**Playwright integration / E2E (the two-process spine, against docker-compose Postgres/Redis — ADR
0008):**
- *Homepage*: typing yields autocomplete suggestions (keyboard-navigable listbox); picking one
  enqueues a Job and navigates to its Result page; submitting raw text shows the options list **plus**
  the domain fallback **plus** the explicit name-only choice; choosing a matched brand, a typed domain,
  or proceeding name-only each enqueues the expected anchor; the Searches-list link works.
- *Searches list*: paginated, most-recent-first; each status renders distinctly and non-colour-only; a
  row navigates to its Result page.
- *Result page SSE*: with a per-Job stream — a `result` event inserts a row; an update event (a Verify
  score flip) re-positions the row so the list stays Match Score desc; **no duplicate row** on
  re-delivery by id; the ARIA live region receives concise announcements; the stream **completes and
  the client closes** on the terminal status — asserting `done`, `done_with_warnings`, `failed`, the
  **empty-`failed`** state, and the distinct **empty-`done`** state ("No third-party coverage found").
- *Page-1-only scope (ADR 0007)*: a score flip raising a page-2 row above the page-1 cutoff surfaces it
  on page 1 and drops the displaced row; navigating to page 2+ shows a static snapshot that does **not**
  mutate under the stream; a terminal Job's pagination is stable across all pages.
- *Filtering coherence*: selecting a Content Type chip narrows the list, counts are correct, zero-count
  chips disabled, ordering/pagination stay coherent under the filter.
- *Pagination ranges*: both lists yield the right ranges and disabled prev/next at the ends.
- *Excluded disclosure*: collapsed by default; each Excluded Result shows its reason.
- *Page detail*: the "Read original" link (`rel="noopener noreferrer"`, new tab), the trust facts, the
  extracted content, and the Enhancement takeaway render; a NULL Verification/Sentiment reads honestly.
- *Keyboard nav*: the full form (incl. the autocomplete listbox), chips, rows, disclosure, and
  paginator are operable from the keyboard with a visible **Accent-Blue** focus ring.
- *Reduced motion*: under emulated `prefers-reduced-motion: reduce`, row entrances and the status pulse
  fall back to crossfade/instant while updates still land.

**Automated accessibility (axe-core inside Playwright, WCAG 2.2 AA):** run against **every page**
(homepage, Searches, Result, Page) **and the Result page mid-stream** (post-SSE DOM) — contrast on the
newsprint ground, the live-region wiring, focus-ring visibility, `listbox`/`dialog`/`details` roles for
the autocomplete and disclosures, and **no colour-only signal** anywhere (status, content type,
sentiment, score). Running inside Playwright exercises the real rendered DOM including live state.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per non-test file;
`OTEL_SDK_DISABLED=true` in test/CI. Integration/E2E need `docker compose up` and are **not** part of
`pnpm verify` (ADR 0008); unit/view-model tests are the hermetic fast gate.

---

## Out of scope (deferred)

- **The pipeline stages, the Job state machine, and the enqueue entry point** — Foundation + the stage
  PRDs. This surface consumes their outputs and read models; it computes nothing.
- **How Match Score / Verification / Content Type / Sentiment / Summary / Exclusions are computed or
  stored** — the stage specs. This surface reads and renders them; it never recomputes or re-ranks.
- **Auth, accounts, and multi-tenant scoping** of the Searches list — not in this PRD.
- **A dedicated re-run affordance** (a one-click "Re-run" button) — deferred; re-running is achieved by
  submitting the same company through the homepage form (Foundation handles *submit* against the same
  frozen anchor: no re-disambiguation, fresh Job). Editing/deleting/exporting Jobs or Results is also
  out (nothing is ever deleted — Results are Excluded, never dropped).
- **OTel span emission, the SSE metrics instruments, the Bugsink/otel-lgtm split** — PRD 8 (ADR 0004).
  This design fixes only the route span-exclusion + SSE-metrics *shape* and exposes the hooks.
- **Notifications, email, or any push outside the in-page SSE stream.**
- **BrandFetch Brand Search internals** beyond consuming `BrandSearchPort` for autocomplete + the
  options list (resolution/freezing of the chosen anchor is Foundation + Resolve).
- **SSE coalescing / batching** (debounced status + batched result-ids) — the ADR 0006 later
  optimisation behind the same channel shape; not built now.

---

## Design-system & vocabulary guardrails

**`DESIGN.md` named rules (cited and applied):**
- **Ink-and-Paper Rule:** ink + newsprint carry every page; the brights (blue/green/pink) appear only
  as Content Type icon fills, semantic state, and the focus ring — never backgrounds or body text.
- **Newsprint Contrast Rule:** body-size secondary text on the `#efe8e3` ground uses **Ink Toned
  `#5c5959`**, never Ink Muted; the muted step only on the `#fcfaf9` surface or ≥18px.
- **Colored-Text Demotion Rule:** any coloured text (links, error/reason copy) uses the darker
  `*-text` step (`#1071b3`, `#a02c38`, `#127541`).
- **Warm-Shadow / Tonal-Before-Shadow Rules:** the single warm-tinted **Float** shadow only on
  genuinely floating surfaces (the **homepage form card**, the autocomplete popover); in-flow cards
  (profile, Page detail) use a 1px **Newsprint Border** + tonal layering.
- **One Voice / Fixed-Scale Rules:** FK Grotesk only; hierarchy by the fixed rem scale + weight; no
  second face, no `clamp()`.
- **Result Row as a flat row, NOT a card:** the list (Results **and** Searches) is flat flex rows
  separated by hairlines; cards-in-a-list is banned; no >1px coloured left/right accent stripe.
- **Match Score Indicator:** numeric score in Label type beside a 3px **Ink-filled** bar (Ink, not a
  bright — score is structural), with a tooltip explaining what was matched.
- **Filter chip spec:** pill, icon-plus-label, selected fills Ink with surface-white text, a count
  badge inline, **zero-count disabled**.
- **Full interactive state sets + Accent-Blue focus ring** on every control (default, hover,
  focus-visible, active, disabled, error), focus ring visible throughout.

**`CONTEXT.md` vocabulary (rendered exactly):**
- A **Result** is `included` or `excluded` (born `included`; Exclusion is the only transition) — never
  "dropped"/"deleted". An Excluded Result stays **inspectable** in the disclosure.
- **Match Score** is the 0–100 sort key (provisional → interim → authoritative); the UI **reads** it,
  never computes it; the list always sorts by it descending.
- **"Unverified"** is a *reading* of NULL `verification_status`; **"Unclassified"** a *reading* of NULL
  `content_type` — computed at render, never stored, never written back. A NULL status does **not**
  imply a NULL score.
- An **Exclusion** displays its `exclusion_code` (+ `exclusion_detail` as a reason) — **never** the
  catching stage; `"LLM"` is never echoed verbatim.
- The **Summary** is the Job-level Enhancement details summary (Summarise); the per-Result **takeaway**
  on the Page is a different thing.
- Keep the **anchor** (frozen at input) and the **Resolved Identity** (derived per-run) strictly
  separate — the UI freezes the anchor at submit and reads the identity for the profile card; it never
  re-decides the company.
