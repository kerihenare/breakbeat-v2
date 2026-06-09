# Verify / Extract / Classify / Enhance

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle, Resolve Stage, Search Stage, Filter & Collapse

## Problem Statement

By the time a Result reaches this part of the pipeline, the Search Stage has returned a hit and Filter & Collapse has already Excluded the cheap, structural noise — Own Channel surfaces, aggregators, ecommerce/review pages, out-of-window dates, and near-duplicate copies. What survives is a list of still-`included` Results that *look* like third-party coverage but have not yet been judged on the one question the product exists to answer: **is this page actually about the target company, or about a different entity that happens to share its name?**

This is the product's precision story, and it is hard for three reasons:

1. **Name Collisions are confusable.** "Aglow" surfaces the beauty-membership startup, the Aglow International ministry, Aglow Outdoors, HomeAglow (a cleaning marketplace), and Aglow Air (a Nigerian freighter startup). The festivals, garden-light events, and incidental "aglow with $86M" phrasings are rejected on positive grounds, but the genuinely confusable indexed-brand middle — real companies whose *business-news* coverage reads superficially like the target's — needs a sharper contrast. A Result's title and snippet alone can fool a relevance judgement; HomeAglow's funding coverage or Aglow Air's freighter news can pass a snippet glance and only give themselves away in the full page text.

2. **The judgement has to be cheap where it can be and authoritative where it must be.** Calling an LLM on every search hit's full page text — including the ones that are obviously off the target — would be slow and expensive, especially on a collision-heavy target. But a snippet-only judgement is not trustworthy enough to be the final word on the ordering key the UI shows on every row.

3. **The Result needs more than a verdict.** A surviving Result must also carry its Content Type (the brief's seven categories) and an Enhancement (Sentiment toward the target plus a short takeaway) so the list is scannable and the digest is meaningful. These are distinct domain judgements, but on the full page text they all read the same evidence at the same moment.

Without this stage, the list would sort by Tavily's query-relevance, mix the ministry's newsletters in with the startup's funding coverage, show no Content Type, and offer no stance signal. The reviewable list would not be trustworthy at a glance — which is the entire point.

## Solution

This stage is the entity-relevance, classification, and enrichment core. It runs **Verification in two passes** around a single **Extract** step, fuses the post-Extract work into one Haiku call, and produces the authoritative Match Score, verification_status, content_type, sentiment, and takeaway for each surviving Result.

**Pass 1 — the snippet gates (before Extract, cheap).** Two cheap LLM judgements run on a Result's title, snippet, and URL only:

- **snippet-Verify** weighs the positive Brand Context of the Resolved Identity ("is this about a beauty-membership startup?") against its Negative Boost — the collected Name Collision contexts ("...or is it one of these known look-alikes?"). A high-confidence mismatch Excludes the Result `off_topic` with `exclusion_detail = "LLM"` (recording the catcher, never free text from the model). Survivors keep an interim Match Score. This gate's job is to stop us paying to Extract pages that are plainly about a different entity.
- **snippet-Classify** assigns a provisional Content Type from the same snippet evidence, so even a Result that later fails Extract carries a best-effort type.

**Extract (between the passes).** For the Results that survive the snippet gates, the Tavily Extract API retrieves the full page text server-side. We never fetch a Result page ourselves — Tavily retrieves it; we consume what it returns.

**Pass 2 — the fused full-text re-pass (after Extract, authoritative).** Per ADR 0003, the post-Extract work is **one Haiku call per Extracted Result** returning `{entity-match score, content-type, sentiment, takeaway}` together. This single call simultaneously:

- **re-Verifies** entity relevance against the actual page — setting the final, authoritative Match Score and catching the look-alike whose snippet fooled the gate but whose full text gives it away (HomeAglow's funding, Aglow Air's freighters). A high-confidence mismatch here still Excludes the Result `off_topic`, even though it was already snippet-classified.
- **re-Classifies** the Content Type against the full text.
- **Enhances** still-`included` Results with Sentiment (the coverage's stance toward the target) and a short takeaway.

Verify, Classify, and Enhance remain **distinct domain stages** — separate fields, separate verification_status / content_type / sentiment, separate failure semantics. Only their full-text *execution* is fused, because all three read the same Extracted text at the same point and one call is roughly three times cheaper than three. This is deliberate; it is not to be split back into three calls.

**The Match Score ratchet.** Match Score is Verify's entity-relevance confidence, the 0–100 ordering key the UI shows on every row, and it ratchets through three resolutions, each replacing the last: provisional (Tavily's relevance, from the Search Stage, so streaming rows sort sensibly before any Verify), interim (the snippet gate), and final/authoritative (the full-text re-pass). The list always sorts by Match Score descending. Match Score is trust, not prominence — it is not importance or "coverage that matters."

**Anti-echo discipline.** Only the Zod-validated structured output of an LLM call is persisted. `exclusion_detail` records the catcher (`"LLM"`), never free text the model emitted — that is the prompt-injection echo channel. The same rule extends to telemetry (see the Observability PRD).

Failures degrade gracefully into Warnings, never Job failures: a failed Classify leaves a Result unclassified; a failed Enhance leaves it without Sentiment. The row still shows.

## User Stories

1. As a comms professional, I want each Result scored by how confident we are it is about the *target* company, so that the coverage most likely to be genuinely about my company rises to the top of the list.

2. As a reviewer, I want the list sorted by Match Score descending at every moment — even before Verify has run on a row — so that streaming rows always sit in a sensible order rather than jumping around as judgements land.

3. As a reviewer of a collision-heavy company (like "Aglow"), I want Results about a different entity that merely shares the name (the ministry, the outdoor-writers association, the cleaning marketplace) Excluded as `off_topic`, so that my list is about *my* company and not a namesake.

4. As a reviewer, I want a look-alike whose snippet looked plausible but whose full page text reveals it is a different company (HomeAglow's funding round, Aglow Air's freighters) to still be Excluded once we have read the page, so that the snippet gate fooling us once does not leak a wrong Result into the final list.

5. As a reviewer, I want each surviving Result tagged with one of the brief's seven Content Types (news article, trade publication, blog post, press release, major social post, newsletter, podcast), so that I can filter the list by the kind of coverage I care about.

6. As a reviewer, I want a Result whose type is genuinely ambiguous marked `other` rather than force-fit into a category, so that the escape hatch is honest and the seven categories stay meaningful.

7. As a reviewer, I want a Result whose classification failed to be shown as unclassified rather than silently defaulted to `other`, so that I can tell "we couldn't classify this" apart from "this is genuinely miscellaneous."

8. As a reviewer, I want each surviving Result to carry a Sentiment reflecting how *my company* is portrayed in the coverage — not the article's overall mood — so that an industry-downturn piece that praises us reads as positive and a glowing piece that mentions us only as a cautionary aside does not.

9. As a reviewer, I want a short per-Result takeaway drawn from the full page text, so that I can grasp what a piece says about my company without opening it.

10. As a reviewer, I want a Result's Verification shown as verified, uncertain, or Unverified, so that I can see at a glance how sure we are about each row and treat the uncertain ones with appropriate caution.

11. As a reviewer, I want "Unverified" to mean Verify simply has not run on this row yet (or had no brand context to run against) rather than a judgement of mismatch, so that mid-Job a not-yet-reached row reads as pending, not rejected.

12. As an operator running a collision-heavy company, I want the cheap snippet gate to Exclude obvious off-topic Results *before* we pay to Extract their full text, so that the Job does not spend Extract and full-text-Haiku budget on pages that are plainly about a different entity.

13. As an operator, I want the full-text judgement, content type, sentiment, and takeaway produced in a single Haiku call per Extracted Result, so that we spend roughly a third of what three separate calls would cost without losing any of the distinct domain outputs.

14. As an operator, I want Extract to run only for Results that survive both snippet gates, so that Tavily Extract spend tracks the Results we actually intend to analyse.

15. As a reviewer worried about trust, I want to see *why* a Result was Excluded via a machine-groupable code (`off_topic`) and a catcher detail (`"LLM"`), so that I can audit the verification gate and understand the filtering rather than face a black box.

16. As a security-minded operator, I want only the Zod-validated structured output of each LLM call persisted — never free text the model emitted into `exclusion_detail` or anywhere else — so that a page crafted to inject instructions cannot echo attacker-chosen text into our stored data.

17. As a reviewer, I want an Excluded Result that had already been snippet-classified to keep its Content Type, so that the collapsed Excluded section is still informative even for rows we later rejected on full text.

18. As an operator, I want a total Classify failure to be a Warning, not a Job failure, so that I still get a reviewable (if untyped) list rather than nothing.

19. As an operator, I want a failed Enhance to be a Warning that leaves the row visible without Sentiment, so that one page's enrichment failing does not cost me the row or the Job.

20. As an operator running a name-only Job that resolved no brand context, I want Verify to record an Unverified reading rather than fail, so that the degraded path still produces a list and the missing context is visible as a Warning, not a crash.

21. As a quality engineer, I want Verify and Classify quality measured against the labelled Aglow precision/recall set, so that changes to the prompts or gating logic are judged on measured precision and recall, not vibes.

22. As a quality engineer, I want the future "re-introduce per-collision diffs" experiment gated on a measured improvement against that same set, so that we only add Resolve-time cost if it demonstrably sharpens the confusable middle.

23. As a reviewer, I want the Match Score I see on a row to be the authoritative full-text score once it exists, not Tavily's query-relevance, so that the number I trust reflects our judgement of the page, not the search engine's guess about the query.

## Implementation Decisions

**Module shape (Hexagonal, Vertical Slice).** This stage is owned by a Verify/Classify/Enhance application module composed of small deep modules behind simple interfaces: a snippet-gate service (snippet-Verify + snippet-Classify), an Extract port, a full-text-analysis service wrapping the fused Haiku call, and a Match Score resolution service. External systems sit behind ports with adapters: a `ContentExtractionPort` (Tavily Extract adapter) and a `FullTextAnalysisPort` plus a `SnippetJudgementPort` (Anthropic Haiku adapters). The application stages depend only on the ports; the adapters depend on the SDKs. Stage outputs are written to the Result via the persistence layer owned by Foundation & Job Lifecycle.

**snippet-Verify gate (Pass 1).** A pure judgement function fed the Result's title, snippet, and URL plus the Resolved Identity's positive Brand Context (value proposition, target audience segments, products & services) and its **Negative Boost**. Per **ADR 0001**, the Negative Boost is consumed here as the **collected Name Collision contexts** — a compact one-line-per-look-alike list handed verbatim into the prompt — *not* pre-computed diffs. Verify does the target-vs-look-alike contrast inline against the page, primed by assertive framing ("Known look-alikes sharing this name that are NOT the target — reject pages about these: …"). The conceptual interface: `(snippet evidence, brand context, negative boost) -> { interimMatchScore: 0–100 }`. The model returns only the score; the **Exclude-vs-proceed decision is derived** from `interimMatchScore` against the (lenient) snippet `T_exclude` — no separate verdict field. Below the cutoff the Result is Excluded with `exclusion_code = off_topic`, `exclusion_detail = "LLM"`; survivors keep the `interimMatchScore` as the second ratchet rung.

**snippet-Classify gate (Pass 1).** A separate cheap judgement assigning a provisional Content Type from the same snippet evidence, against the seven categories plus `other`. Conceptual interface: `(snippet evidence) -> { contentType }`. Kept distinct from snippet-Verify (the pre-Extract gates are *not* fused; only the post-Extract pass is). The provisional type is what an Excluded-on-full-text Result retains.

**Tavily Extract adapter.** Behind `ContentExtractionPort`, the Tavily Extract API retrieves full page text server-side for the survivors of both snippet gates only. The domain term is **Extract** — Tavily retrieves the page, we do not fetch it. Conceptual interface: `extract(url) -> { fullText } | extractionFailure`. An Extract failure for a Result is a per-Result Warning that prevents the full-text re-pass for that Result. Such a Result stays **`included`** (Extract failure is a Warning, never an Exclusion) and carries: its snippet-derived **interim Match Score** (for ordering), its **provisional Content Type**, NULL `sentiment`/takeaway (not Enhanced), and — critically — **NULL `verification_status`, read by the UI as "Unverified".** The snippet gate is a *cost* gate, not the authoritative verdict (ADR 0003): only the full-text re-pass ever writes `verification_status`, so a row that never reached it is honestly Unverified. A Result can therefore display a mid-range numeric Match Score *and* read "Unverified" at once — the number is provisional ordering; the verdict was simply never reached. (NULL `verification_status` does **not** imply a NULL score.)

**The fused full-text Haiku call (Pass 2) — ADR 0003.** One Haiku call per Extracted Result behind `FullTextAnalysisPort`, returning the four outputs of the three distinct stages together. The structured-output contract (Zod-validated), which encodes ADR 0003 precisely:

```
{
  entityMatchScore: number,        // 0–100; final/authoritative Match Score (re-Verify)
  contentType: news_article | trade_publication | blog_post | press_release
             | major_social_post | newsletter | podcast | other,   // re-Classify
  sentiment: positive | neutral | negative,   // Enhance: stance toward the TARGET
  takeaway: string                 // Enhance: short per-Result takeaway
}
```

Verify, Classify, and Enhance remain **distinct domain stages** — they write separate fields (`verification_status`, `content_type`, `sentiment` + takeaway), have separate failure semantics, and the snippet-stage gates stay separate. Only the full-text *execution* is fused. Do **not** split this back into three calls; the fusion and its ~3× cost saving are the point.

**Match Score ratchet.** A small resolution rule, unit-testable in isolation: provisional (Tavily relevance, set in the Search Stage) → interim (snippet-Verify) → final/authoritative (the fused call's `entityMatchScore`). Each resolution overwrites the prior. The number persisted on the Result is always the latest rung reached; the list sorts by it descending at every moment.

**verification_status mapping (derived from the score; two config cutoffs).** `verification_status` and the Exclude decision are **both pure functions of `entityMatchScore`** — there is no independent verdict field the model returns; the score is the single source of truth (the continuous confidence *is* the bucketing). Two configured cutoffs turn the continuous 0–100 into the three outcomes: below `T_exclude` → Excluded (`off_topic`, `exclusion_detail = "LLM"`); `T_exclude` ≤ score < `T_verified` → `included` + `uncertain`; score ≥ `T_verified` → `included` + `verified`. `verification_status` is `verified | uncertain | NULL`.

The **same mapping applies at both passes**, on each pass's score rung — but `T_exclude` is **deliberately more lenient at the snippet gate than at the full-text pass**. The snippet gate's job is to stop *obvious* waste before we pay to Extract, not to make the final precision call; an over-aggressive snippet cut would Exclude a real Result whose snippet was thin but whose full text would have verified it — an unrecoverable recall leak, since Excluded means never Extracted. The full-text pass, reading the actual page, can afford the stricter cut. Starting values, **config not literals, tuned against the Aglow precision/recall set** (never magic constants): snippet `T_exclude = 25`; full-text `T_exclude = 40`, `T_verified = 70`. "Unverified" and "Unclassified" are **readings of NULL** (Verify/Classify did not run, was not configured, or had no brand context) surfaced by the UI — they are never stored values.

**Exclusion-code mapping.** This stage writes exactly one code from the closed set: `off_topic`, always with `exclusion_detail = "LLM"`. It does not write `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, or `duplicate` (those are Filter & Collapse's), and it never writes `llm_excluded` (that names a stage, not a reason). Exclusion is soft — the Result is marked `excluded`, never deleted, and still appears in the collapsed Excluded section with its reason.

**Anti-echo discipline.** Only Zod-validated structured output is persisted. `exclusion_detail` records the catcher string `"LLM"`, never any text the model produced. The takeaway is the one validated free-text field; it is constrained and validated by the structured-output schema before persistence, and like all model output it is never copied into `exclusion_detail` or telemetry. The same anti-echo rule governs Observability: no raw prompt, completion, or scraped page text on any span or log (see the Observability PRD).

**Failure semantics.** A failed snippet-Classify or full-text Classify leaves `content_type` NULL (unclassified) — a per-Result Warning; a *total* Classify failure is a Job-level Warning, never a Job failure (`done_with_warnings`). A failed Enhance leaves `sentiment` and takeaway NULL — a Warning; the row still shows. A failed Extract is a per-Result Warning that skips the full-text re-pass for that Result. Verify with no available brand context yields the Unverified (NULL) reading via a Warning, not a failure.

## Testing Decisions

TDD throughout: write the failing test first, against external behaviour, then implement. Tests target observable outputs (persisted fields, Exclusions, scores, Warnings), not internal call shapes.

**Vitest unit tests (pure logic, no I/O).**
- The Match Score ratchet: provisional → interim → final, each overwriting the last; the persisted score is always the latest rung; the list-sort invariant (descending) holds at every rung.
- The exclusion-code mapping: only `off_topic` with `exclusion_detail = "LLM"` is ever written here; assert this stage never emits the other codes or `llm_excluded`.
- The verification_status mapping as a pure function of `entityMatchScore` against the two cutoffs: `< T_exclude` → Excluded `off_topic`; `[T_exclude, T_verified)` → `uncertain`; `≥ T_verified` → `verified`; no brand context → NULL/Unverified reading via Warning. Assert the snippet pass uses the more-lenient snippet `T_exclude` and the full-text pass the stricter one, and that boundary scores at each cutoff bucket as specified.
- The gating logic: Extract runs only for survivors of both snippet gates; an Extract failure skips the full-text re-pass and records a per-Result Warning while preserving the interim score and provisional type.
- Anti-echo: given model output containing injected free text, assert `exclusion_detail` is exactly `"LLM"` and only schema-validated fields are persisted.

**Autoevals over the Aglow precision/recall set.** The Aglow test case (.input/test-case.md) is the labelled set — 14 include, ~300 exclude — used to evaluate Verify and Classify quality. Run precision/recall over the include/exclude verdicts (Verify) and the Content Type assignments (Classify) and track them as quality gates. The confusable indexed-brand middle (HomeAglow, Aglow Air) is the case the two-pass design exists to catch; assert these are Excluded at the full-text re-pass even when their snippet passes the gate. Per **ADR 0001**, the future per-collision-diff experiment is gated on a measured improvement on this set; the first lever for any Verify miss is prompt framing, not pre-computation.

**Contract tests for the adapters.** For the Tavily Extract adapter (`ContentExtractionPort`) and the Anthropic Haiku adapters (`SnippetJudgementPort`, `FullTextAnalysisPort`): assert the adapter maps real/recorded responses to the domain contract, that the fused call's response is Zod-validated, and that a malformed or schema-violating response surfaces as the appropriate Warning rather than persisting unvalidated data. Application-stage tests run against in-memory fakes of these ports so the gating, ratchet, and mapping logic are tested without live network calls.

## Out of Scope

- **Resolve-stage computation of the Negative Boost.** Per ADR 0001 the Negative Boost is the collected Name Collision contexts produced at Resolve time; this stage *consumes* it but does not build it. (Resolve Stage.)
- **The provisional Match Score.** Tavily's relevance is set as the provisional rung in the Search Stage; this stage only ratchets it to interim and final.
- **Filter heuristics and Collapse.** `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, and `duplicate` Exclusions, and the title-Collapse pass, all run before this stage. (Filter & Collapse.)
- **The Job-level Summary.** Sentiment and takeaways feed it, but the Summary itself is produced by the Summarise stage. (Summarise.)
- **The Tavily Research API and the Anthropic web-search backstop.** Recall sources, deferred/gated in the Search Stage (ADR 0002), not part of this stage.
- **Importance / prominence scoring.** "Coverage that matters" is a separate axis we do not score today; Match Score is entity-relevance confidence only.
- **Per-collision diff pre-computation.** Explicitly deferred by ADR 0001 pending a measured win on the Aglow set.
- **The UI rendering of scores, badges, filters, and live updates.** (Web UI & SSE Delivery.)
- **OpenTelemetry instrumentation of these stages.** The anti-echo rule for telemetry is honoured here, but span/metric design lives in the Observability PRD.

## Further Notes

- **Why two passes.** The snippet gate is a cost gate (stop paying to Extract obvious off-target pages); the full-text re-pass is the precision gate (catch the look-alike the snippet hid). Making Verify two-pass is symmetric to Classify's re-pass and closes the precision leak ADR 0003 identifies — the evidence to catch a snippet-fooling look-alike is already in hand once we have paid to Extract.
- **The fusion is load-bearing.** ADR 0003 is explicit that splitting the post-Extract call back into three "for separation of concerns" undoes the deliberate ~3× cost saving. The domain stages stay distinct in their fields and semantics; only execution is shared.
- **Trust, not popularity.** Match Score orders the list by how confident we are a page is about the target — never by how important or widely-read it is. The UI's "trust is the feature" framing depends on this.
- **The degraded path.** A name-only Job that resolved no brand context still runs this stage; Verify yields Unverified (NULL) readings via Warnings, and the Classify backstop is the only Own Channel guard. The list exists, just less audited.
- **Revisit trigger.** If Autoevals shows the confusable middle still leaking after prompt-framing iteration, ADR 0001's option B (per-collision diffs) becomes the experiment to run — adopted only on a measured precision/recall improvement on the Aglow set.
