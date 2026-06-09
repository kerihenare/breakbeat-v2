# Verify / Extract / Classify / Enhance — Technical Design

**Date:** 2026-06-09
**PRD:** `docs/prd/05-verify-extract-classify-enhance.md`
**ADRs:** 0001 (Negative Boost is collected collision contexts), 0003 (the post-Extract full-text pass is one Haiku call), 0004 (OTel / process model — the single `analyze` Stage Span)
**Depends on:** Foundation & Job Lifecycle (`docs/superpowers/specs/2026-06-09-foundation-job-lifecycle-design.md`), Resolve Stage (`docs/superpowers/specs/2026-06-09-resolve-stage-design.md`), Search Stage (`docs/superpowers/specs/2026-06-09-search-stage-design.md`), Filter & Collapse (`docs/superpowers/specs/2026-06-09-filter-collapse-design.md`)
**Status:** ready for implementation plan

> This is the *technical* design beneath PRD 5. The product design (problem, solution, user
> stories, domain vocabulary) is settled by the PRD, `CONTEXT.md`, and ADRs 0001/0003 and is not
> re-litigated here. This document fixes the domain pure functions (the Match Score ratchet, the
> score→`verification_status` mapping at two cutoffs, the `off_topic` exclusion mapping, the
> Extract-gating predicate, the closed Warning set), the three new ports plus the `ResultRepository`
> extension Verify/Classify/Enhance need, the per-Result orchestration shell, the fused
> structured-output contract, and the test strategy. It assumes Foundation provides the `Stage`
> port, `RunContext` (with the `resolvedIdentity` slot and `recordWarning`), the `Job`, the
> `Warning` value object, the `Clock` port, and the Drizzle `results` table with the **already-
> reserved nullable stage columns** `match_score`, `verification_status`, `content_type`,
> `sentiment`, `takeaway` and the closed `exclusion_code` enum; that Resolve populates
> `ctx.resolvedIdentity` (companyName, brandContext with value proposition / target audience
> segments / products & services, the `negativeBoost` string, nameCollisions); that Search wrote the
> **provisional** Match Score and the coverage content (`url`, `title`, `snippet`, `published_date`)
> and owns the `ResultRepository` port; and that Filter has already soft-Excluded the structural
> noise, leaving the **`included` pool** this stage reads via `findIncluded` and re-using the
> `recordExclusion` Filter defined.

---

## Goal

Given a Job's `included` Results and its `ResolvedIdentity`, run the single **`analyze`** stage —
Verify, Classify, and Enhance, distinct domain stages whose full-text *execution* is fused (ADR
0003) — that produces, per surviving Result, the authoritative **Match Score**,
`verification_status`, `content_type`, `sentiment`, and `takeaway`, and soft-Excludes the look-alikes
`off_topic`. It runs **Verification in two passes around one Extract step**: a cheap **Pass 1** of two
snippet gates (snippet-Verify → interim Match Score; snippet-Classify → provisional Content Type) on
title + snippet + URL only; **Extract** (Tavily Extract, server-side, behind a port — never a *fetch*)
for the survivors of both gates only; and an authoritative **Pass 2** of **one fused Haiku call** per
Extracted Result returning `{entityMatchScore, contentType, sentiment, takeaway}`. Every shortfall is
a **Warning, never a Job failure** — a failed Extract leaves the Result `included` with its interim
score, its provisional Content Type, and a NULL `verification_status` read as "Unverified"; a total
Classify failure is one Job-level Warning; a name-only Job with no brand context yields the Unverified
reading. Only Zod-validated structured output is persisted (`exclusion_detail` is always `"LLM"`,
never model text). **One schema migration** — this stage adds a single nullable column
`results.extracted_content` (the Extracted full text, persisted for the Page to display; PRD 07);
every analysis-output column it writes (`match_score` / `verification_status` / `content_type` /
`sentiment` / `takeaway`) was already reserved by Foundation.

## Confirmed implementation choices

| Decision | Choice |
|---|---|
| Stage shape | One `AnalyzeStage implements Stage` (Foundation's port), `name = "analyze"`, registered **fourth** in the worker's `StageRunner` → `[ResolveStage, SearchStage, FilterStage, AnalyzeStage]` (ADR 0004: Verify/Classify/Enhance share the single `analyze` Stage Span) |
| Is this three stages? | **No.** One Stage, one Span. Verify/Classify/Enhance stay distinct in their *fields and semantics* (separate `verification_status` / `content_type` / `sentiment`+`takeaway`, separate failure rules), but execute as snippet-gates → Extract → one fused Haiku call (ADR 0003). Do **not** split the fused call back into three |
| How `analyze` reads the identity | Reads the read-only `ctx.resolvedIdentity` slot Resolve populated (positive Brand Context + the `negativeBoost` string); never re-derives or re-chooses the company |
| How `analyze` reads / writes Results | Extends the same `ResultRepository` port Search declared and Filter grew: reuses `findIncluded(jobId)` (the pool) and `recordExclusion(resultId, code, detail)` (for the `off_topic` Exclusion), and adds four narrow write methods for the interim score, the provisional type, the final fused outcome, and the Extracted full text (`setExtractedContent`, persisted for PRD 07's Page to display) |
| Two-pass structure (ADR 0003) | **Pass 1** — two *separate* cheap snippet judgements on title+snippet+URL: snippet-Verify → interim Match Score, snippet-Classify → provisional Content Type. **Extract** — only for Results that survive *both* gates. **Pass 2** — **one** fused Haiku call per Extracted Result returning the four outputs together |
| Match Score ratchet | A pure rule: provisional (Tavily, set in Search) → interim (snippet-Verify) → final (the fused call's `entityMatchScore`). Each rung **overwrites**; the persisted score is always the latest rung; the list sorts by it descending at every moment |
| `verification_status` & Exclude decision | **Both pure functions of the score** against two configured cutoffs — there is no independent verdict field. `< T_exclude` → Exclude `off_topic`; `[T_exclude, T_verified)` → `included` + `uncertain`; `≥ T_verified` → `included` + `verified`. Same mapping both passes; **snippet `T_exclude` deliberately more lenient** than the full-text `T_exclude` |
| Exclusion code | This stage writes exactly **one** code: `off_topic`, always with `exclusion_detail = "LLM"` (the *catcher*, never model text). It never writes the other codes and never `llm_excluded` |
| Ports (PRD "Module shape") | `SnippetJudgementPort` (the two cheap snippet judgements, Anthropic Haiku), `ContentExtractionPort` (Tavily Extract → `{ fullText } \| extractionFailure`), `FullTextAnalysisPort` (the fused Haiku call, Zod-validated). Plus the `ResultRepository` extension. Each port has a `Symbol` token |
| `AnalyzeConfig` | Injected from `@nestjs/config` (never literals): `snippetTExclude` (~25), `fullTextTExclude` (~40), `tVerified` (~70) — Aglow-tuned starting values |
| Orchestration | Per-Result, **bounded concurrency** over the `included` pool; snippet gates per Result, Extract gated on snippet survival, the fused call on Extract survivors. **Failure-tolerant per Result** |
| Failure semantics | All **Warnings**, never Job failures — see Error handling. Closed `ANALYZE_WARNING` set namespaced under `analyze.`, counts/ids only (anti-echo) |
| Anti-echo | Only Zod-validated structured output persisted; `exclusion_detail` is always `"LLM"`; the `takeaway` is the one validated free-text field, constrained by the schema before persistence |
| Schema | **One migration: add the nullable `results.extracted_content text` column** (the Extracted full text, persisted for PRD 07's Page to display) via a `drizzle-kit` migration owned by this stage — stages own their own migrations (Search added `url`/`title`/`snippet`/`published_date`; Summarise adds the `summaries` table; `analyze` adds `extracted_content`). Every analysis-output column (`match_score` / `verification_status` / `content_type` / `sentiment` / `takeaway`, all nullable) and the closed `exclusion_code` enum were **already reserved by Foundation** — this stage writes those into existing columns, exactly as Filter did |
| Unit tests | **Vitest, TDD throughout** with port fakes — the ratchet, the score→status mapping (incl. lenient-vs-strict boundary cases), the exclusion-code mapping, the Extract gating, anti-echo |
| Adapter tests | **Vitest** contract tests for the three adapters (Zod validation; a malformed / schema-violating response → the appropriate Warning, never an unvalidated persist) |
| Evals | **Autoevals** over the Aglow precision/recall set (`.input/test-case.md`): Verify precision/recall + Classify accuracy; the confusable indexed-brand middle (HomeAglow, Aglow Air) caught at the **full-text** re-pass even when the snippet passes — noted, not a per-task unit gate |
| OTel spans | **Out of scope here** — PRD 8 owns span emission. `analyze` only upholds the *facts* the single Stage Span will read (child spans per Haiku/Extract call; span events for the interesting minority) and the **anti-echo** discipline |

---

## Architecture

`analyze` is a vertical slice and a deep module behind a simple interface (`Stage.run`). It lives
inside Foundation's hexagonal layering; the dependency arrow points inward
(`interface → application → domain`, with `infrastructure` implementing `application`'s ports). The
Match Score ratchet, the score→`verification_status` mapping, the `off_topic` exclusion mapping, the
Extract-gating predicate, and the closed Warning set are pure **domain**; the three ports, the
`AnalyzeConfig`, the `ResultRepository` extension, and the orchestration shell are **application**;
the Anthropic (snippet + fused) and Tavily Extract adapters and the Drizzle repository methods are
**infrastructure**; DI wiring is **interface**. The domain functions are the richest unit-test
target; the adapters are the only impure edges; nothing above a port knows an SDK shape.

### Source layout (new files unless marked *modify*)

```
src/
  domain/analyze/
    match-score.ts             # MatchScoreRung + ratchet() — pure provisional→interim→final, latest-rung wins
    verification-status.ts     # VerificationStatus + classifyScore() — pure score→{ exclude | uncertain | verified } at one cutoff pair
    exclusion-mapping.ts       # OFF_TOPIC + offTopicExclusion() — the only code this stage writes ("LLM" catcher)
    content-type.ts            # ContentType union (seven + other) — the shared classify vocabulary
    sentiment.ts               # Sentiment union (positive | neutral | negative) — stance toward the TARGET
    extract-gate.ts            # survivedSnippetGates() — pure Extract-gating predicate
    fused-analysis.ts          # FusedAnalysis Zod schema + type (the ADR 0003 contract) — the validated structured output
    analyze-warnings.ts        # ANALYZE_WARNING closed set + builders (counts/ids only)
  application/analyze/
    ports/
      snippet-judgement.port.ts   # SnippetJudgementPort (snippet-Verify + snippet-Classify) + token
      content-extraction.port.ts  # ContentExtractionPort (Tavily Extract) + ExtractionResult + token
      full-text-analysis.port.ts  # FullTextAnalysisPort (the fused Haiku call) + token
    analyze-config.ts          # AnalyzeConfig type (the three cutoffs) + token
    analyze.stage.ts           # AnalyzeStage implements Stage — the impure per-Result orchestration shell
  application/search/ports/
    result-repository.port.ts  # *modify* — add AnalyzeResult read-model + the three analyze write methods
  infrastructure/
    anthropic/
      anthropic.config.ts          # *modify* — add Haiku model id + analyze timeout (from @nestjs/config)
      snippet-judgement.adapter.ts # SnippetJudgementPort over @anthropic-ai/sdk (two cheap structured calls)
      full-text-analysis.adapter.ts# FullTextAnalysisPort over @anthropic-ai/sdk (one fused structured call, Zod-validated)
    tavily/
      content-extraction.adapter.ts# ContentExtractionPort over @tavily/core Extract; failure → extractionFailure
    persistence/
      schema.ts                # *modify* — add the nullable `extracted_content` (text) column to `results` (the ONE migration this stage owns)
      result.repository.ts     # *modify* — implement the four analyze writes (incl. setExtractedContent)
  app-worker.module.ts         # *modify* — register the three adapters + AnalyzeConfig; AnalyzeStage FOURTH in StageRunner
```

The `infrastructure/anthropic/` directory already exists (Search's web-search backstop lives there);
`analyze` adds two Haiku adapters beside it and re-uses the existing Anthropic client wiring. The
`infrastructure/tavily/` directory already exists (Search's Tavily adapter); `analyze` adds the
Extract adapter beside it and re-uses the existing Tavily client config.

---

## Domain

All domain types are immutable and contain **no I/O**. They are the richest unit-test target — the
ratchet, the two-cutoff mapping, the exclusion mapping, and the Extract gate are pure and exhaustively
assertable without a single network call.

### `match-score.ts` — the three-rung ratchet

```ts
type MatchScoreRung = "provisional" | "interim" | "final";
function ratchet(rung: MatchScoreRung, score: number): number; // → clamp(round(score), 0, 100)
```

Match Score is the 0–100 ordering key the UI shows on every row (`CONTEXT.md`). It ratchets through
three resolutions, **each replacing the last**: **provisional** (Tavily's relevance, written by
Search), **interim** (snippet-Verify), **final/authoritative** (the fused call's `entityMatchScore`).
The number persisted on the Result is **always the latest rung reached** — there is no blend, no max,
no average; a later rung simply overwrites the earlier value. The list sorts by the persisted score
descending at every moment, so a Result climbs or settles as judgements land but never carries a stale
rung. The function is a pure clamp/round; *which* rung is being written is the orchestration shell's
decision, expressed by calling the matching repository write (interim vs final) — the domain never
reads or compares the prior persisted value, because "latest rung overwrites" needs no read.

### `verification-status.ts` — the score→status mapping (pure, one cutoff pair per call)

```ts
type VerificationStatus = "verified" | "uncertain"; // the two stored values; NULL ("Unverified") is never returned here

type Cutoffs = { readonly tExclude: number; readonly tVerified: number };
type ScoreVerdict =
  | { kind: "exclude" }                          // score < tExclude  → off_topic
  | { kind: "uncertain"; status: "uncertain" }   // tExclude ≤ score < tVerified
  | { kind: "verified"; status: "verified" };    // score ≥ tVerified

function classifyScore(score: number, cutoffs: Cutoffs): ScoreVerdict;
```

`verification_status` and the Exclude decision are **both pure functions of the score** — the
continuous confidence *is* the bucketing, so there is no independent verdict field the model returns.
`classifyScore` is the single source of truth: `< tExclude` → `{ kind: "exclude" }` (the caller writes
`off_topic`); `[tExclude, tVerified)` → `uncertain` (the Result stays `included`); `≥ tVerified` →
`verified`. The **same function** runs at both passes — the *only* difference is the `Cutoffs`
argument:

- **Snippet pass** uses `{ tExclude: config.snippetTExclude (~25), tVerified: config.tVerified }` —
  the **deliberately more lenient** `tExclude`. The snippet gate is a *cost* gate: its job is to stop
  us paying to Extract pages plainly about a different entity, **not** to make the final precision
  call. An over-aggressive snippet cut would Exclude a real Result whose snippet was thin but whose
  full text would have verified it — an *unrecoverable recall leak*, because Excluded means never
  Extracted. (At the snippet pass the `verified`/`uncertain` distinction is computed but **not
  persisted** as `verification_status` — only the full-text re-pass ever writes the status; see the
  shell. The snippet pass writes the interim *score* and may Exclude, nothing more.)
- **Full-text pass** uses `{ tExclude: config.fullTextTExclude (~40), tVerified: config.tVerified
  (~70) }` — the **stricter** `tExclude`. Reading the actual page, it can afford the sharper cut, and
  it is the only pass that writes `verification_status`.

`VerificationStatus` is `verified | uncertain`; the stored column is also nullable, and **NULL is read
by the UI as "Unverified"** — Verify did not run, was not configured, or had no brand context. NULL is
never a value this function returns; it is the *absence* of a full-text write. Crucially, **a NULL
`verification_status` does not imply a NULL Match Score**: a Result that passed the lenient snippet
gate but failed Extract keeps its interim numeric score for ordering *and* reads "Unverified".

### `exclusion-mapping.ts` — the only code this stage writes

```ts
const OFF_TOPIC = "off_topic" as const;     // the single exclusion_code analyze ever writes
const LLM_CATCHER = "LLM" as const;         // the exclusion_detail — the catcher, never model text
function offTopicExclusion(): { code: "off_topic"; detail: "LLM" };
```

When `classifyScore` returns `{ kind: "exclude" }` at *either* pass, the shell calls
`recordExclusion(resultId, "off_topic", "LLM")`. This stage writes **exactly one** code: `off_topic`,
always with `exclusion_detail = "LLM"`. It **never** writes `own_channel`, `aggregator`,
`ecommerce_review`, `out_of_window`, or `duplicate` (those are Filter's), and it **never** writes
`llm_excluded` (that names a stage, not a reason — `CONTEXT.md`). `exclusion_detail` records the
*catcher* string, never any text the model emitted — that is the prompt-injection echo channel. The
function takes no model output by design (the structural anti-echo proof): there is nowhere for model
text to enter the exclusion write.

### `content-type.ts` and `sentiment.ts` — the classify + enhance vocabularies

```ts
type ContentType =
  | "news_article" | "trade_publication" | "blog_post" | "press_release"
  | "major_social_post" | "newsletter" | "podcast"   // the brief's seven, verbatim
  | "other";                                          // the explicit escape hatch — never a default
type Sentiment = "positive" | "neutral" | "negative"; // stance toward the TARGET, not the article's mood
```

`other` is reserved for *genuine* type ambiguity; a Result whose classify *failed* is left
`content_type` NULL ("Unclassified"), never defaulted to `other`. `Sentiment` is the coverage's stance
*toward the target company* — an industry-downturn piece praising the target is `positive`, a glowing
piece mentioning it only as a cautionary aside is not.

### `fused-analysis.ts` — the ADR 0003 structured-output contract

The fused Haiku call's response is validated against this Zod schema **verbatim** before anything is
persisted; the parsed type is the only thing the full-text pass acts on (anti-echo).

```ts
import { z } from "zod";

const FusedAnalysisSchema = z.object({
  entityMatchScore: z.number().min(0).max(100),                 // re-Verify: final/authoritative Match Score
  contentType: z.enum([
    "news_article", "trade_publication", "blog_post", "press_release",
    "major_social_post", "newsletter", "podcast", "other",
  ]),                                                           // re-Classify
  sentiment: z.enum(["positive", "neutral", "negative"]),       // Enhance: stance toward the TARGET
  takeaway: z.string().min(1).max(/* config-tuned cap */),       // Enhance: short per-Result takeaway
});
type FusedAnalysis = z.infer<typeof FusedAnalysisSchema>;
```

This single call simultaneously **re-Verifies** (sets the final Match Score and catches the look-alike
whose snippet fooled the gate but whose full text gives it away), **re-Classifies** the Content Type
against the full text, and **Enhances** with Sentiment + takeaway. Verify, Classify, and Enhance remain
**distinct domain stages** — separate fields, separate failure semantics — but their full-text
*execution* is fused because all three read the same Extracted text at the same point, and one call is
~3× cheaper than three (ADR 0003). **Do not split this back into three calls.** The `takeaway` is the
**one validated free-text field**: it is constrained by the schema (non-empty, length-capped) before
persistence, and like all model output it is never copied into `exclusion_detail` or any telemetry.

### `extract-gate.ts` — the Extract-gating predicate

```ts
type SnippetOutcome =
  | { kind: "excluded" }                                  // snippet-Verify Excluded off_topic — never Extracted
  | { kind: "survived"; interimScore: number; provisionalType: ContentType | null };
function survivedSnippetGates(outcome: SnippetOutcome): outcome is { kind: "survived"; interimScore: number; provisionalType: ContentType | null };
```

Pure. Extract runs **only** for a Result whose snippet-Verify did *not* Exclude it (snippet-Classify
never gates — its provisional type rides along even into an Excluded row, harmlessly). This is the cost
gate: Tavily Extract spend tracks only the Results we actually intend to analyse. An Excluded-at-snippet
Result is never Extracted and never reaches the fused call.

### `analyze-warnings.ts` — closed Warning set

`analyze`'s Warnings reuse Foundation's `Warning` value object (`{ type, message }`); the `type` is
drawn from a **closed set** namespaced under `analyze.`:

```ts
const ANALYZE_WARNING = {
  extractFailed: "analyze.extract_failed",                 // per-Result: Extract failed; stays included, interim score + provisional type kept, verification_status NULL ("Unverified")
  snippetClassifyFailed: "analyze.snippet_classify_failed",// per-Result: snippet-Classify failed; provisional content_type NULL
  fullTextClassifyFailed: "analyze.full_text_classify_failed", // per-Result: re-Classify field unusable; content_type left NULL
  enhanceFailed: "analyze.enhance_failed",                 // per-Result: sentiment/takeaway NULL; row still shows
  classifyTotallyFailed: "analyze.classify_totally_failed",// Job-level: every Classify attempt failed across the Job (one Warning, never a failure)
  noBrandContext: "analyze.no_brand_context",              // Job-level: name-only Job, no brand context; Verify yields the Unverified (NULL) reading
} as const;
```

Each builder returns a `Warning` carrying **counts and ids only** — never raw snippet text, page text,
prompt, completion, or a provider error body (anti-echo). The per-Result Warnings are aggregated by the
shell (one Warning per *kind* carrying a count, not one per Result) so a collision-heavy Job does not
mint hundreds of Warnings; the Job-level Warnings fire at most once. No `analyze` condition is ever a
`JobFailedError` — see Error handling.

---

## Application

### `AnalyzeConfig`

```ts
type AnalyzeConfig = {
  snippetTExclude: number;  // ~25 — the LENIENT snippet-pass exclude cutoff (cost gate, not the precision call)
  fullTextTExclude: number; // ~40 — the STRICTER full-text exclude cutoff (made on the actual page)
  tVerified: number;        // ~70 — at/above → verified; shared by both passes
  extractConcurrency: number; // bounded per-Result fan-out (Extract + fused call) — keeps Tavily/Haiku in-flight bounded
  takeawayMaxLength: number;  // the schema cap on the one validated free-text field
};
const ANALYZE_CONFIG = Symbol("AnalyzeConfig");
```

Injected from `@nestjs/config` (never literals scattered through the mapping). The three cutoffs are
**Aglow-tuned starting values** validated against the precision/recall set, never magic constants. The
invariant `snippetTExclude < fullTextTExclude ≤ tVerified` encodes the lenient-snippet/strict-full-text
decision and is asserted at config load.

### Ports

```ts
// snippet-judgement.port.ts — the two cheap Pass-1 judgements (Anthropic Haiku), on title+snippet+URL only
type SnippetEvidence = {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
};
type SnippetVerifyInput = {
  readonly evidence: SnippetEvidence;
  readonly brandContext: BrandContext | null; // positive signal: value proposition / audience segments / products & services
  readonly negativeBoost: string;             // ADR 0001: collected collision contexts, verbatim — NOT pre-computed diffs
};
interface SnippetJudgementPort {
  // snippet-Verify: returns ONLY the interim Match Score (0–100). Exclude-vs-proceed is DERIVED (classifyScore) — no verdict field.
  verifySnippet(input: SnippetVerifyInput): Promise<{ interimMatchScore: number } | { failed: true }>;
  // snippet-Classify: provisional Content Type from the same evidence (seven + other).
  classifySnippet(evidence: SnippetEvidence): Promise<{ contentType: ContentType } | { failed: true }>;
}
const SNIPPET_JUDGEMENT_PORT = Symbol("SnippetJudgementPort");

// content-extraction.port.ts — Tavily Extract (server-side); we never "fetch" a Result page
type ExtractionResult =
  | { readonly kind: "extracted"; readonly fullText: string }
  | { readonly kind: "extractionFailure" };
interface ContentExtractionPort {
  extract(url: string): Promise<ExtractionResult>; // never throws; failure → { kind: "extractionFailure" }
}
const CONTENT_EXTRACTION_PORT = Symbol("ContentExtractionPort");

// full-text-analysis.port.ts — the ONE fused Haiku call per Extracted Result (ADR 0003), Zod-validated
type FullTextAnalysisInput = {
  readonly fullText: string;
  readonly brandContext: BrandContext | null;
  readonly negativeBoost: string;
};
interface FullTextAnalysisPort {
  // Returns the parsed, Zod-validated FusedAnalysis; a malformed/schema-violating response → { failed: true } (never an unvalidated object).
  analyze(input: FullTextAnalysisInput): Promise<FusedAnalysis | { failed: true }>;
}
const FULL_TEXT_ANALYSIS_PORT = Symbol("FullTextAnalysisPort");
```

**Failure translation is the adapters' job.** Each port returns a benign discriminated value on
transport / quota / timeout / parse failure — nothing escapes as a throw, so the orchestration shell
branches on values and records Warnings, never catches exceptions to decide outcomes. `verifySnippet`
returns **only** the score (the Exclude decision is the domain's `classifyScore`, not the model's);
`analyze` returns the **already-validated** `FusedAnalysis` or `{ failed: true }` — an unvalidated
object never crosses the port (anti-echo at the boundary).

### `ResultRepository` extension (modify the shared port)

Search declared `ResultRepository` with `insertIncluded`; Filter added `findIncluded` and
`recordExclusion`. `analyze` adds the read-model it needs and four narrow writes — and **re-uses
Filter's `recordExclusion`** for the `off_topic` Exclusion (no new exclusion method):

```ts
// result-repository.port.ts (additions for analyze)
type AnalyzeResult = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  // (match_score / published_date are already persisted; analyze needs the snippet evidence + id only)
};

interface ResultRepository {
  insertIncluded(jobId: string, results: readonly ResultInsert[]): Promise<number>; // (Search)
  findIncluded(jobId: string): Promise<FilterResult[]>;                              // (Filter — the pool; AnalyzeResult is a structural subset)
  recordExclusion(resultId: string, code: ExclusionCode, detail: string | null): Promise<void>; // (Filter — reused for off_topic/"LLM")
  // analyze additions — each writes ONLY into reserved/owned nullable columns:
  setInterimMatchScore(resultId: string, score: number): Promise<void>;             // ratchet rung 2 (snippet-Verify) → already-reserved match_score
  setProvisionalContentType(resultId: string, type: ContentType): Promise<void>;    // snippet-Classify → already-reserved content_type
  applyFullTextOutcome(resultId: string, outcome: FullTextOutcome): Promise<void>;  // the fused-call write (rung 3 + status + type + enhance) → already-reserved columns
  setExtractedContent(resultId: string, content: string): Promise<void>;           // on Extract success → this stage's new nullable extracted_content column (display-only, PRD 07)
}

type FullTextOutcome = {
  readonly matchScore: number;                       // final rung — overwrites interim
  readonly verificationStatus: VerificationStatus;   // verified | uncertain (only the full-text pass writes this)
  readonly contentType: ContentType | null;          // re-Classify; null if the field was unusable (Warning)
  readonly sentiment: Sentiment | null;              // Enhance; null if Enhance failed (Warning)
  readonly takeaway: string | null;                  // Enhance; null if Enhance failed (Warning)
};
const RESULT_REPOSITORY = Symbol("ResultRepository"); // (unchanged — the same token Search/Filter use)
```

`findIncluded` is reused as-is; `AnalyzeResult` is a structural subset of Filter's `FilterResult`, so no
new query is needed — the shell reads `findIncluded(jobId)` and uses the `id` / `url` / `title` /
`snippet` fields. The analysis-output writes (`setInterimMatchScore`, `setProvisionalContentType`,
`applyFullTextOutcome`) touch **only** the already-reserved nullable columns
(`match_score`, `verification_status`, `content_type`, `sentiment`, `takeaway`); `setExtractedContent`
writes the **one new column this stage adds**, the nullable `extracted_content` (display-only, PRD 07).
None of the four touches `status` (the only status transition this stage performs is `recordExclusion`,
Filter's method, guarded `WHERE status = 'included'`).

### `AnalyzeStage implements Stage` — the per-Result orchestration shell

The only impure unit. `name = "analyze"`. Constructed from `SnippetJudgementPort`,
`ContentExtractionPort`, `FullTextAnalysisPort`, the `ResultRepository`, `AnalyzeConfig`, and (for the
Match Score clamp) the domain functions. `run(ctx)`:

1. Read `identity = ctx.resolvedIdentity` (Resolve populated it). If `null`, that is a
   programming/ordering fault (Resolve must run first) — throw a plain `Error`; the runner routes an
   unexpected throw to `fail` (Foundation). It is **not** a degraded path.
2. **No-brand-context reading.** If `identity.brandContext === null` (a name-only Job that resolved no
   positioning), record `ctx.recordWarning(analyzeWarnings.noBrandContext())` **once**. The stage still
   runs: snippet-Verify and the fused call receive `brandContext: null` and the `negativeBoost` (which
   may be `""`), and any Result that reaches neither a confident Exclude nor a confident verify yields
   the **Unverified (NULL) reading** — never a failure (PRD stories 11, 20).
3. **Read the pool.** `const pool = await repo.findIncluded(ctx.job.id)` — the `included` Results Filter
   handed on. (An empty pool is a valid, reviewable outcome — the stage returns normally.)
4. **Per-Result work, bounded concurrency** (`config.extractConcurrency`), each Result fully
   failure-tolerant — one bad Result never sinks the stage:
   1. **Pass 1a — snippet-Verify.** `verifySnippet({ evidence, brandContext, negativeBoost })`.
      - On `{ interimMatchScore }`: write the **interim** rung —
        `setInterimMatchScore(id, ratchet("interim", interimMatchScore))`. Then
        `classifyScore(interimMatchScore, { tExclude: config.snippetTExclude, tVerified: config.tVerified })`:
        - `{ kind: "exclude" }` → `recordExclusion(id, "off_topic", "LLM")`; **stop this Result** (never
          Extracted — the cost gate). It keeps its interim score and (below) its provisional type;
          `verification_status` stays NULL — an Excluded row's status is moot.
        - otherwise (`uncertain` | `verified`) → the Result **survives**; do **not** write
          `verification_status` (only the full-text pass writes it).
      - On `{ failed: true }`: snippet-Verify failed — treat as *survived with no interim rung* (the
        provisional Tavily score stands), record a per-Result Warning bucket, and proceed to Extract
        (the full-text pass is authoritative; a failed cheap gate must not Exclude). *(Implementation
        note: a failed snippet-Verify is not in the closed set above because it degrades to "proceed to
        Extract" rather than a stored-field gap; it is folded into the partial-sweep accounting, not a
        new persisted NULL.)*
   2. **Pass 1b — snippet-Classify** (independent of 1a, runs for every pool Result including ones
      1a will Exclude — its provisional type rides along harmlessly, PRD story 17). `classifySnippet(evidence)`:
      - On `{ contentType }` → `setProvisionalContentType(id, contentType)`.
      - On `{ failed: true }` → leave `content_type` NULL; bucket an `analyze.snippet_classify_failed`
        per-Result Warning.
   3. **Gate.** If snippet-Verify Excluded the Result (4.1), **skip Extract and the fused call** — the
      Result is done (Excluded, with its provisional type). Otherwise the Result `survivedSnippetGates`.
   4. **Extract.** `extract(result.url)`:
      - `{ kind: "extractionFailure" }` → bucket an `analyze.extract_failed` per-Result Warning; the
        Result **stays `included`**, keeps its interim Match Score (ordering) and provisional Content
        Type, and has **NULL `verification_status`** (read "Unverified") **and NULL `extracted_content`**
        (no full text to display). **Skip the fused call.** (An Extract failure is a Warning, never an
        Exclusion — a NULL status does not imply a NULL score.)
      - `{ kind: "extracted"; fullText }` → **persist the full text:** `setExtractedContent(id, fullText)`
        (so PRD 07's Page can display the Extracted content, "Extracted via Tavily"). The in-memory
        `fullText` still feeds the fused call as before. Then proceed to Pass 2.
   5. **Pass 2 — the fused Haiku call.** `analyze({ fullText, brandContext, negativeBoost })`:
      - On `{ failed: true }` → the whole fused call failed: bucket `analyze.full_text_classify_failed`
        **and** `analyze.enhance_failed` per-Result Warnings; the Result stays `included` with its
        interim score, provisional type, and NULL `verification_status` (Unverified). (A failed fused
        call is symmetric to a failed Extract: the authoritative pass was not reached.)
      - On a validated `FusedAnalysis` → run
        `classifyScore(entityMatchScore, { tExclude: config.fullTextTExclude, tVerified: config.tVerified })`
        (the **stricter** cutoff):
        - `{ kind: "exclude" }` → `recordExclusion(id, "off_topic", "LLM")` — the look-alike whose
          snippet fooled the gate, caught on the page (the Verification *flip*). The final score is the
          authoritative rung; the row keeps its (now provisional/interim) type for the collapsed
          Excluded section. **Stop this Result** (no Enhance write on an Excluded row).
        - `{ status }` (`verified` | `uncertain`) → write the authoritative outcome:
          `applyFullTextOutcome(id, { matchScore: ratchet("final", entityMatchScore), verificationStatus: status, contentType, sentiment, takeaway })`.
          This single write overwrites the interim score with the final rung, sets the only
          `verification_status` the row will carry, re-Classifies, and Enhances — Verify/Classify/Enhance
          as distinct fields, one persisted outcome.
5. **Total-Classify-failure roll-up.** After the pool is processed, if **every** Classify attempt
   (snippet *and* full-text) across the Job failed — i.e. no Result carries any `content_type` — record
   `ctx.recordWarning(analyzeWarnings.classifyTotallyFailed())` once. This is a **Job-level Warning,
   never a Job failure**: the reviewable (if untyped) list is the Job's purpose and it exists.
6. **Return normally.** `analyze` never throws `JobFailedError`: a judged population that narrows (even
   to zero, all Excluded `off_topic`) is an honest empty finding, not a failure (`CONTEXT.md`). The Job
   ends `done` / `done_with_warnings`. The stage never sets `ctx.resolvedIdentity`, never fetches a
   page, and never writes a `content_type` of `other` as a *default* (only when the model genuinely
   returns `other`).

**Concurrency.** The per-Result pipeline (snippet gates → Extract → fused call) runs with a **bounded**
in-flight count (`config.extractConcurrency`) — a worker pool over the `included` list, not an
unbounded `Promise.all`, so a large collision-heavy pool does not open hundreds of simultaneous Tavily
Extract / Haiku calls. Within one Result, snippet-Verify and snippet-Classify may run concurrently
(they share no state); Extract gates on snippet-Verify's survival; the fused call gates on Extract.
Each external call is individually failure-tolerant (the port returns a value), so one failure degrades
exactly one Result to its honest partial state.

---

## Infrastructure

### Snippet-judgement adapter (`snippet-judgement.adapter.ts`)

Wraps the `@anthropic-ai/sdk` Messages API around the Haiku model id (from
`ANTHROPIC_HAIKU_MODEL`). Owns both cheap Pass-1 structured calls:

- **snippet-Verify** — one `messages.create` whose prompt carries the `SnippetEvidence`
  (title/snippet/URL), the positive `BrandContext` (value proposition / audience segments / products &
  services), and the `negativeBoost` string **verbatim** under its assertive framing ("Known
  look-alikes sharing this name that are NOT the target — reject pages about these: …", ADR 0001 — the
  Negative Boost is consumed as collected collision contexts, not pre-computed diffs, and not
  re-derived here). The structured-output contract returns **only** `{ entityMatchScore: number }`
  (0–100), Zod-validated; the adapter maps a parse failure / transport error / timeout to
  `{ failed: true }`. The adapter does **not** decide Exclude — it returns the score; the domain's
  `classifyScore` decides.
- **snippet-Classify** — a separate `messages.create` returning `{ contentType }` (the seven + `other`),
  Zod-validated against the `ContentType` enum; failure → `{ failed: true }`.

Both calls emit GenAI call metadata (model id, token usage, finish reason, derived cost) for PRD 8's
child spans, and never put raw prompt, snippet text, or completion text into a persisted column or any
future span attribute (anti-echo). On any non-2xx / quota / network / timeout / schema-violation the
method returns `{ failed: true }` — never a throw. Nothing above the port knows the SDK shape.

### Full-text-analysis adapter (`full-text-analysis.adapter.ts`) — the fused call (ADR 0003)

Wraps the same `@anthropic-ai/sdk` Haiku client in **one** `messages.create` per Extracted Result whose
prompt carries the Extracted `fullText`, the positive `BrandContext`, and the `negativeBoost`, and whose
structured-output contract is the `FusedAnalysisSchema` **verbatim**
(`{ entityMatchScore, contentType, sentiment, takeaway }`). The adapter **Zod-parses the response and
returns the validated `FusedAnalysis`**, or `{ failed: true }` on a malformed / schema-violating /
transport / timeout failure — **an unvalidated object never crosses the port** (the anti-echo boundary:
only schema-validated output is ever persisted, and `exclusion_detail` is set by the domain to `"LLM"`,
never from this response). One call returns all four outputs of the three distinct stages — it is **not
split into three**; the fusion and its ~3× cost saving are the point (ADR 0003). Emits the same GenAI
call metadata for PRD 8 without echoing prompt/page/completion text.

### Tavily Extract adapter (`content-extraction.adapter.ts`)

Wraps `@tavily/core`'s **Extract** API behind `ContentExtractionPort` — Tavily retrieves the page
server-side; **we never fetch a Result page** ("fetch" stays reserved for the Resolve homepage fetch,
`CONTEXT.md`). Re-uses Search's Tavily client config (API key from `TAVILY_API_KEY`, an
`AbortController`/timeout). Maps a successful Extract to `{ kind: "extracted", fullText }` (the
server-side page text); on non-2xx, quota, network error, timeout, or an empty extraction returns
`{ kind: "extractionFailure" }` — a per-Result Warning-grade value, **never a throw, never an
Exclusion**. The adapter surfaces per-call latency for PRD 8's child span and puts no scraped page text
onto any future span attribute (telemetry anti-echo). On success the `fullText` is consumed by the fused
call **and** persisted by the shell to `results.extracted_content` for PRD 07's Page to display
("Extracted via Tavily") — a **display-only** column that is never copied into `exclusion_detail`, a log,
or a span attribute.

### The four analyze writes + repository + the one migration (`schema.ts` / `result.repository.ts` *modify*)

**One schema migration — add the nullable `results.extracted_content text` column.** This stage owns a
single `drizzle-kit` migration: it adds `extracted_content` (nullable `text`) to the `results` table in
Foundation's `schema.ts`, then `pnpm drizzle-kit generate` emits the SQL migration committed with the
stage. (Stages own their own migrations — Search added `url`/`title`/`snippet`/`published_date`;
Summarise adds the `summaries` table; `analyze` adds exactly this one column. It is **one new column,
not a broad migration**.) The new column holds the **Extracted full text** so PRD 07's Page can display
it ("Extracted via Tavily"); it is written only when Extract succeeds and left NULL when Extract failed.

The **analysis-output** columns this stage writes are still Foundation's already-reserved nullable stage
columns `match_score`, `verification_status`, `content_type`, `sentiment`, and `takeaway` (verified
against Foundation's `schema.ts`: *"nullable stage columns: `match_score`, `verification_status`,
`content_type`, `sentiment`, `takeaway` (NULL = 'hasn't reached that stage', never a sentinel)"*), the
closed `exclusion_code` enum (which already includes `off_topic`), and nullable `exclusion_detail`.
Search wrote the provisional `match_score`; Filter writes `status` / `exclusion_*`. `analyze` writes the
analysis outputs **into these already-existing columns** — exactly as Filter did — and persists the
Extracted text into its **one new** column. The repository implements four methods on the existing
`ResultDrizzleRepository`:

- **`setInterimMatchScore(resultId, score)`** — `update results set match_score = :score where id =
  :resultId` (the interim rung overwrites the provisional rung; touches no other column).
- **`setProvisionalContentType(resultId, type)`** — `update results set content_type = :type where id =
  :resultId`.
- **`applyFullTextOutcome(resultId, outcome)`** — one `update` setting `match_score` (final rung,
  overwriting interim), `verification_status`, `content_type`, `sentiment`, `takeaway` together —
  Verify/Classify/Enhance distinct fields in one durable write. Touches `status` **never** (Exclusion is
  `recordExclusion`'s `WHERE status = 'included'` guarded write, reused from Filter).
- **`setExtractedContent(resultId, content)`** — `update results set extracted_content = :content where
  id = :resultId`, called on a **successful Extract** (the `ContentExtractionPort` returning
  `{ fullText }`) so the Page can display the full text. Touches no other column; a Result whose Extract
  failed is left with `extracted_content` NULL.

The `off_topic` Exclusion path uses **Filter's existing `recordExclusion(resultId, "off_topic",
"LLM")`** — its `WHERE status = 'included'` guard makes it idempotent and forecloses re-Excluding a row
Filter already moved. No new exclusion method; the **only** schema change is the single nullable
`extracted_content` column (and its `drizzle-kit` migration) documented above.

### DI wiring (`app-worker.module.ts` *modify*)

Register the three adapters as the providers for their ports — the snippet adapter
(→ `SNIPPET_JUDGEMENT_PORT`), the fused-call adapter (→ `FULL_TEXT_ANALYSIS_PORT`), and the Tavily
Extract adapter (→ `CONTENT_EXTRACTION_PORT`) — plus an `AnalyzeConfig` provider from `@nestjs/config`.
Construct `AnalyzeStage` from the three ports + the existing `RESULT_REPOSITORY` provider (Search/Filter
already wired it) + `ANALYZE_CONFIG`, and register it **fourth** in the `StageRunner`'s ordered list:
`[ResolveStage, SearchStage, FilterStage, AnalyzeStage]`. The two Haiku adapters re-use the **existing
Anthropic client** Search wired for its web-search backstop (one `ANTHROPIC_API_KEY`, ADR/`.env`
comment: "one key, three signals"); the Extract adapter re-uses Search's **existing Tavily client**.
`.env.example` gains:

```
# --- Analyze stage (Verify / Classify / Enhance) ---
ANTHROPIC_HAIKU_MODEL=claude-haiku-...        # the model id for the snippet gates + the fused full-text call
ANALYZE_SNIPPET_T_EXCLUDE=25                   # LENIENT snippet-pass exclude cutoff (cost gate)
ANALYZE_FULL_TEXT_T_EXCLUDE=40                 # STRICTER full-text exclude cutoff (the precision call)
ANALYZE_T_VERIFIED=70                          # at/above → verified (both passes)
ANALYZE_EXTRACT_CONCURRENCY=5                  # bounded per-Result fan-out
ANALYZE_TAKEAWAY_MAX_LENGTH=400                # schema cap on the one validated free-text field
```

(`ANTHROPIC_API_KEY` and `TAVILY_API_KEY` already exist from Search.) `analyze` introduces **no new
client** — it reuses the Anthropic and Tavily clients Search wired and the Result repository Search and
Filter wired.

---

## Observability (deferred to PRD 8 — the seam only)

Span emission, the single **`analyze`** Stage Span, its child spans, and its span events are **PRD 8's**
to build (ADR 0004 / the Observability spec `docs/superpowers/specs/2026-06-09-observability-otel-design.md`).
The `analyze` stage's obligations are the *facts* that span will read and the discipline it must not
violate — it builds **no spans** here:

- **One Stage Span owns it all.** Per ADR 0004, Verify/Classify/Enhance are distinct in *fields and
  semantics* but execute as snippet-gates → Extract → one fused call rather than separable time-ordered
  stages, so the single `analyze` Stage Span owns them. Its aggregate attributes (`results.in` =
  `findIncluded` count, `results.out` = survivors, `excluded.off_topic` count, `tokens.total`,
  `cost.total`, `warnings`) are all derivable from this stage's run and the persisted rows.
- **Child spans only for real external calls.** Each Haiku call (snippet-Verify, snippet-Classify, the
  fused call — each with GenAI semantic conventions + cost) and **each Tavily Extract call** is the unit
  that will become a child span under `analyze`. Extract is a child span **under `analyze`, never its
  own Stage Span** (ADR 0004). There is **no span per Result** — a collision-heavy Job must not mint
  thousands of spans.
- **Span events for the interesting minority only.** An `off_topic` **Exclusion**, a **Verification
  flip** at the full-text re-pass (a Result the snippet gate let through that the page Excludes, or vice
  versa), and a per-Result **Warning** are the per-Result outcomes worth a span event on the Stage Span.
  **Happy-path per-Result work emits nothing** — no span, no event; it lives in the aggregates and the
  metrics.
- **Warning is OK, never ERROR.** Every `analyze` Warning is an `OK` span with a span event, never a
  span-status `ERROR` and never a Bugsink issue — only an unexpected throw is.
- **Anti-echo (telemetry).** No raw prompt, completion, snippet text, or scraped page text on any span
  or log — counts, model id, finish reason, cost, and validated structured output only. The `takeaway`
  is validated output; the page `fullText`, the prompts, and any model free text are never emitted.
- **`extracted_content` is display-only — outside the echo channel.** The Extracted full text persisted
  to `results.extracted_content` exists **only** for PRD 07's Page to render it ("Extracted via Tavily").
  It is **never** copied into `exclusion_detail`, a log line, or any span attribute — the anti-echo
  discipline (which governs `exclusion_detail` and telemetry) is **unaffected** by persisting it, because
  the column is a display surface, not an exclusion reason or a telemetry field.

---

## Error handling

- **Every external-call failure is a value, not a throw** — the snippet adapter returns
  `{ failed: true }`, the Extract adapter returns `{ kind: "extractionFailure" }`, the fused adapter
  returns `{ failed: true }`. The shell branches on values and records Warnings; it never catches
  exceptions to decide an outcome. This is the load-bearing robustness contract.
- **Failed snippet-Classify or full-text Classify** → `content_type` left **NULL** (Unclassified, never
  defaulted to `other`) + a per-Result Warning (`analyze.snippet_classify_failed` /
  `analyze.full_text_classify_failed`). The row still shows.
- **Total Classify failure** (no Result across the Job carries any `content_type`) → **one Job-level
  Warning** (`analyze.classify_totally_failed`), **never a Job failure** — the reviewable (if untyped)
  list is the Job's purpose and it exists (`CONTEXT.md`).
- **Failed Enhance** (the fused call's Enhance fields unusable) → `sentiment` and `takeaway` **NULL** +
  a per-Result Warning (`analyze.enhance_failed`); the row still shows.
- **Failed Extract** → a per-Result Warning (`analyze.extract_failed`); the Result **stays `included`**,
  keeps its **interim Match Score** (ordering) and **provisional Content Type**, and has **NULL
  `verification_status`** (read "Unverified"). Extract failure is a Warning, **never an Exclusion**, and
  **a NULL `verification_status` does not imply a NULL score**.
- **No brand context** (name-only Job) → one Job-level Warning (`analyze.no_brand_context`); Verify runs
  with `brandContext: null` and yields the **Unverified (NULL) reading** for any Result it cannot
  confidently verify or Exclude — never a failure (PRD stories 11, 20).
- **`analyze` never throws `JobFailedError`** on any named condition. A judged population that narrows
  (even to zero, all Excluded `off_topic`) is a valid, reviewable outcome. The only throw is the
  **programming fault** of a missing `ctx.resolvedIdentity` (Resolve did not run), which the runner
  routes to `fail` (Foundation). It is not a degraded path.
- **A malformed / schema-violating LLM response** is downgraded inside the adapter to the benign
  `{ failed: true }` value — an unvalidated object never crosses the port, so it can never be persisted
  (anti-echo). The corresponding Warning fires; nothing throws into the pipeline.

---

## Testing strategy

TDD throughout — failing test first; assert on **observable outputs** (persisted fields, Exclusions,
scores, Warnings), never on which private method ran or the internal call shape. The pure domain
functions are the richest, cheapest target.

**Vitest unit (no I/O), fakes for all three ports + the repository:**
- *`ratchet`*: provisional → interim → final, each rung **overwriting** the last; the persisted score is
  always the latest rung (the shell writes interim then final, and the final write overwrites); clamps
  to 0–100; the list-sort-descending invariant holds at every rung (a Result re-sorts as the rung lands,
  never carries a stale rung).
- *`classifyScore` (the score→status mapping)*: `< tExclude` → `{ kind: "exclude" }`;
  `[tExclude, tVerified)` → `uncertain`; `≥ tVerified` → `verified`; the **exact boundary** scores at
  each cutoff bucket as specified (`tExclude` itself → `uncertain`, `tVerified` itself → `verified`).
  **The lenient-vs-strict boundary cases** pinned explicitly: a score in `[snippetTExclude,
  fullTextTExclude)` (e.g. 30 with snippet `T_exclude = 25`, full-text `T_exclude = 40`) **survives the
  snippet pass** (`uncertain`) but **Excludes at the full-text pass** — the recall-protecting design.
  No independent verdict field exists — the score is the single source of truth.
- *Exclusion mapping (`offTopicExclusion`)*: this stage only ever produces `off_topic` with
  `exclusion_detail = "LLM"`; assert via the shell that it **never** emits `own_channel` / `aggregator`
  / `ecommerce_review` / `out_of_window` / `duplicate` or `llm_excluded`.
- *Extract gating (`survivedSnippetGates`)*: Extract runs **only** for survivors of snippet-Verify; a
  snippet-Excluded Result is **never** Extracted (assert the fake `ContentExtractionPort.extract` is not
  called for it); a failed Extract **skips the fused call**, records the per-Result Warning, and
  **preserves** the interim score + provisional type while leaving `verification_status` NULL.
- *Anti-echo*: given a fused-call fake returning an object with injected free text in extra fields, only
  the Zod-validated fields are persisted and `exclusion_detail` is exactly `"LLM"`; given a malformed
  response, the adapter contract returns `{ failed: true }` and **nothing unvalidated is persisted**.
- *`AnalyzeStage` orchestration* (the integrating suite) with port + repo fakes — one test per outcome:
  - **snippet Exclude** (interim score < snippet `T_exclude`) → `off_topic`/`"LLM"`, **never Extracted**,
    keeps provisional type, `verification_status` NULL.
  - **snippet survive → full-text verify** → interim then **final** score (overwrite), `verified`
    status, re-Classified type, Sentiment + takeaway written in one `applyFullTextOutcome`.
  - **snippet survive → full-text Exclude** (the look-alike the snippet let through) → `off_topic` at the
    **strict** full-text cutoff after Extract — the Verification *flip*.
  - **Extract failure** → stays `included`, interim score + provisional type kept, `verification_status`
    NULL ("Unverified"), one `analyze.extract_failed` Warning, fused call never invoked.
  - **fused-call failure** → stays `included`, interim score + provisional type kept, NULL status,
    `full_text_classify_failed` + `enhance_failed` Warnings.
  - **snippet-Classify failure** → `content_type` NULL, one `snippet_classify_failed` Warning, the row
    still proceeds through Verify/Extract.
  - **Enhance failure** (fused call returns valid Verify/Classify but unusable Enhance) → `sentiment` /
    `takeaway` NULL, `enhance_failed` Warning, row still shows with its score + type + status.
  - **total Classify failure** → one Job-level `classify_totally_failed` Warning, **Job not failed**.
  - **no brand context** → one `no_brand_context` Warning, Verify yields Unverified (NULL) readings,
    **Job not failed**.
  - **empty pool / all-Excluded** → returns normally (honest empty finding), never `JobFailedError`.
  - **missing `resolvedIdentity`** → throws a plain `Error` (programming fault).
  - **bounded concurrency** → the fake ports observe an in-flight count never exceeding
    `config.extractConcurrency`.

**Vitest contract tests (adapters), SDKs stubbed:**
- *Snippet-judgement adapter*: snippet-Verify maps a representative Haiku response to
  `{ interimMatchScore }` (Zod-validated, score-only — no verdict field); snippet-Classify maps to
  `{ contentType }` over the enum; a malformed / schema-violating / timeout / non-2xx response →
  `{ failed: true }` (never throws, never an unvalidated object), and emits GenAI call metadata without
  echoing prompt/snippet/completion text.
- *Full-text-analysis adapter*: maps a representative fused response to a **Zod-validated**
  `FusedAnalysis` (all four fields, `contentType` in the enum, `sentiment` in the enum, `takeaway`
  within the length cap); a response with an out-of-enum `contentType`, a missing field, or an
  over-length `takeaway` → `{ failed: true }` (the malformed-→-Warning, not-unvalidated-persist
  contract); injected extra fields are dropped by the schema (anti-echo).
- *Tavily Extract adapter*: maps a representative Extract response to `{ kind: "extracted", fullText }`;
  a non-2xx / quota / network / timeout / empty extraction → `{ kind: "extractionFailure" }` (never
  throws, never an Exclusion); no scraped page text destined for a span attribute.

**Repository (`result.repository.ts`) — Vitest integration, Testcontainers (real Postgres):**
- `setInterimMatchScore` overwrites the provisional `match_score` and touches no other column;
  `setProvisionalContentType` sets `content_type` only; `applyFullTextOutcome` sets `match_score`
  (final, overwriting interim) + `verification_status` + `content_type` + `sentiment` + `takeaway`
  together and never touches `status`; `setExtractedContent(id, fullText)` sets `extracted_content` only
  (a successful Extract writes it; a Result with no Extract leaves it NULL); `recordExclusion(id,
  "off_topic", "LLM")` flips `included →
  excluded` with the code/detail and is idempotent (the `WHERE status = 'included'` guard); ordering by
  `match_score` descending reflects the latest rung; **exactly one migration was required** — the single
  nullable `extracted_content` column (the analysis-output columns already exist from Foundation; no
  OTHER column was added).

**Autoevals over the Aglow precision/recall set (`.input/test-case.md`) — noted, not a per-task unit
gate.** The labelled Aglow set (≈ 14 include, ≈ 300 exclude) measures **Verify precision/recall** (over
the include/exclude verdicts derived from the score cutoffs) and **Classify accuracy** (over the Content
Type assignments). The case the two-pass design exists to catch is asserted explicitly: the **confusable
indexed-brand middle (HomeAglow, Aglow Air)** is Excluded `off_topic` at the **full-text re-pass** even
when its **snippet passes** the lenient gate — proving the strict full-text cutoff closes the precision
leak the snippet gate cannot. Per ADR 0001, the future **per-collision-diff experiment is gated on a
measured win** on this set; the first lever for any Verify miss is **prompt framing**, not
pre-computation. This runs in the eval harness, not the per-task TDD loop.

**Gates:** Biome (format + lint) and `tsc` clean; FTA complexity `OK` per file (the per-Result
orchestration shell is the file to watch — keep the branching factored into the named domain
functions); `OTEL_SDK_DISABLED=true` in test/CI. Autoevals scores the LLM precision/recall work; it is
not a deterministic per-task gate.

---

## Out of scope (deferred)

- **The provisional Match Score.** Tavily's relevance is set as the provisional rung in the **Search**
  Stage; `analyze` only ratchets it to interim (snippet-Verify) and final (the fused call).
- **Resolve-stage computation of the Negative Boost.** Per ADR 0001 the Negative Boost is the collected
  Name Collision contexts produced at **Resolve** time; `analyze` *consumes* the `negativeBoost` string
  verbatim but does not build it, and injects no per-collision diffs.
- **Filter heuristics and Collapse.** `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`,
  and `duplicate` Exclusions, and the title-Collapse pass, all run **before** this stage (**Filter &
  Collapse**). `analyze` writes only `off_topic`/`"LLM"`.
- **The Own Channel Classify backstop on the degraded path** — the brief's "Classify backstop is the
  only Own Channel guard" for a name-only Job is realised by Classify running over the pool; `analyze`
  does not re-implement Filter's `own_channel` heuristic.
- **The Job-level Summary.** Sentiment and takeaways feed it, but the Summary itself is produced by the
  **Summarise** stage (`docs/superpowers/specs/2026-06-09-summarise-design.md`) at the pipeline tail.
- **The Tavily Research API and the Anthropic web-search backstop.** Recall sources, deferred/gated in
  the **Search** Stage (ADR 0002); not part of this stage. `analyze` uses Tavily's **Extract** API only.
- **Importance / prominence scoring.** "Coverage that matters" is a separate axis we do not score today;
  Match Score is **entity-relevance confidence** only — trust, not popularity.
- **Per-collision diff pre-computation.** Explicitly deferred by ADR 0001 pending a measured win on the
  Aglow set; the baseline is the collected-contexts Negative Boost.
- **The UI rendering** of scores, badges, the Verification labels (Unverified/Unclassified are *readings*
  of NULL the UI surfaces), filters, live updates, **and the Page's display of the Extracted full text** —
  **Web UI & SSE** (`docs/superpowers/specs/2026-06-09-web-ui-sse-design.md`). This stage only *persists*
  the full text to `results.extracted_content`; **PRD 07's Page reads `results.extracted_content`** and
  renders it ("Extracted via Tavily"). Persisting it (display-only) is in scope here; rendering it is not.
- **OTel span emission** — PRD 8 (`docs/superpowers/specs/2026-06-09-observability-otel-design.md`).
  `analyze` leaves the facts the single `analyze` Stage Span reads and the anti-echo discipline; it
  creates no spans.

## Vocabulary guardrails (from `CONTEXT.md`)

- The verb for removal is **Excluded** (soft, with a code) — never "dropped", "deleted", or "filtered
  out". A **Result** stays inspectable in the collapsed Excluded section with its reason.
- **"Extract"**, never "fetch". Tavily retrieves the page text server-side; we do not fetch a Result
  page. "Fetch" is reserved for the Resolve homepage fetch.
- **Match Score** is the 0–100 ordering key — Verify's **entity-relevance confidence**, *trust not
  popularity*, never importance/prominence/rank. It ratchets provisional → interim → final, **latest
  rung wins**; the list sorts by it descending at every moment.
- **Verification** runs in **two passes**; `verification_status` is `verified | uncertain | NULL`,
  **derived purely from the score** at two cutoffs — there is no independent verdict field. The **snippet
  `T_exclude` is deliberately more lenient** than the full-text one (cost gate vs precision gate). Only
  the **full-text re-pass** writes `verification_status`.
- **"Unverified"** and **"Unclassified"** are *readings of NULL* the UI surfaces (Verify/Classify did not
  run, was not configured, or had no brand context) — never stored values. A **NULL `verification_status`
  does not imply a NULL Match Score.**
- The closed `exclusion_code` set is Foundation's; `analyze` writes **only `off_topic`** with
  `exclusion_detail = "LLM"` (the **catcher**, never model free text). `llm_excluded` is never a code.
- **Content Type** is the brief's seven + `other` (the explicit escape hatch for *genuine* ambiguity,
  never a failure default). **Sentiment** is the coverage's stance *toward the target*, not the article's
  mood.
- A **Warning is a partial *success***, never an error: a failed Classify/Enhance/Extract, a total
  Classify failure, and a no-brand-context Job are all Warnings — `analyze` throws **no**
  `JobFailedError`.
- **Anti-echo:** only Zod-validated structured output is persisted; the `takeaway` is the one validated
  free-text field; no raw prompt, completion, snippet, or page text ever enters a stored column, a log,
  or a future span attribute.
- The fused full-text pass is **one Haiku call** (ADR 0003) — Verify/Classify/Enhance stay distinct in
  their fields and semantics, but the post-Extract **execution is fused**; do **not** split it back into
  three calls.
