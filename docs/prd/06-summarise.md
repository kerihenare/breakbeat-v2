# Summarise

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle, Verify / Extract / Classify / Enhance

## Problem Statement

A finished Job is a long, scored, reviewable list of Results. That list is the product's payload, but it does not answer the first question a reviewer asks: *"At a glance, what is the outside world saying about this company right now?"* Scanning dozens of rows to form that gestalt is exactly the sifting work Breakbeat exists to remove.

There is no Job-level digest. Each surviving (`included`) Result already carries its own per-Result Enhancement takeaway, but those are atomised — one row at a time — and a reviewer cannot read the whole coverage picture from them without doing the aggregation in their own head. The Result page reserves a slot for an "Enhancement details summary", and today there is nothing to put in it.

The digest is a convenience, not the Job's reason for existing. The reviewable list is the purpose, and it stands on its own. So a digest that cannot be produced must never take the list down with it: if Summarise fails, the Job still succeeds, the list still shows, and the absence is recorded as a Warning — never a Job failure.

## Solution

The **Summarise** stage runs at the tail of the pipeline, after Verify / Extract / Classify / Enhance has settled which Results survive. It reads the snippets of the surviving (`included`) Results, together with their Enhancements, and produces exactly **one Job-level Summary** — a short digest of what the coverage, taken as a whole, says about the target company. This is the "Enhancement details summary" the Result page shows. **One Summary per Job.**

The Summary is distinct from the per-Result Enhancement takeaway: a takeaway is one row's reading; the Summary is the Job's reading across all the surviving rows. CONTEXT.md is explicit that "Summary" is never a "result summary".

Summarise is a small but real deep module with a single clear shape: a well-defined input (the `included` Results' snippets plus their Enhancements) maps through one validated LLM call to one validated Summary output. It depends on the surviving Results and their Enhancements being in place, so it is sequenced last, and it consumes nothing downstream except the Web UI's Result page.

A failed Summarise is a **Warning**, never a Job failure. The reviewable list is the Job's purpose and it still exists. The Job reaches `done_with_warnings`, the Result page renders without the digest, and the failure is recorded as an `OK` span with a span event — never an error (consistent with the Signal Split rule).

ADR 0002 leaves a documented door open here: the deferred Tavily Research API's natural re-entry point is feeding *this* stage, should snippet-based digests prove too thin. That is a future option, called out below, not current scope.

## User Stories

1. As a PR or comms professional, I want a single short digest of what's been published about a company over the last 36 months, so that I can grasp the overall coverage picture in seconds before deciding which Results to read in full.
2. As an internal Drumbeat analyst, I want the Job-level Summary to read across all the surviving (`included`) Results rather than any single one, so that I get the aggregate signal rather than re-reading one row's takeaway.
3. As a reviewer, I want the Summary to draw on the same coverage that survived the verification gate, so that the digest reflects only trusted, in-scope coverage and not the noise that was already Excluded.
4. As a reviewer, I want the reviewable list to remain complete and usable even when the digest could not be produced, so that a Summarise failure never costs me the Results — I just see a recorded Warning where the digest would be, and carry on.
5. As an operator, I want a failed or skipped Summarise to surface as a Warning on the Job (not an error), so that I can tell a degraded digest apart from a genuine Job failure and trust that `done_with_warnings` means "the list is here, one extra was missing".

## Implementation Decisions

**Module.** Summarise is a vertical slice and a deep module behind a simple, testable interface, following the ports/adapters discipline of the rest of the pipeline. It exposes one application-level operation invoked at the tail of the Job's pipeline run: given a Job whose Results have settled, produce and persist its one Summary, or record a Warning.

**The Summarise port.** The conceptual interface is a single port that takes a digest request and returns a validated Summary (or a typed failure the application turns into a Warning). The port's input contract is the surviving Results' material: for each still-`included` Result, its snippet plus its Enhancement (the per-Result takeaway and Sentiment). The port does not read full Extracted page text — the digest is over **snippets**, per CONTEXT.md and the Summarise definition. The port's output is one validated Summary suitable for the Result page's "Enhancement details summary" slot. Validation is via Zod on the structured model output; nothing unvalidated and no raw model free-text leaks past the boundary.

**Input-selection rule.** The stage selects only Results whose `status` is `included` at the point Summarise runs — after Collapse has Excluded duplicates and after the full-text re-pass may have Excluded look-alikes `off_topic`. Excluded Results never feed the digest. If there are no surviving Results, the stage produces no Summary and records this as the empty case (a Warning, not a failure — there is simply nothing to digest). This empty-case Warning is also what flags the **all-Excluded Job** (Search returned hits but every one was Excluded) as `done_with_warnings`: that is an honest empty finding, never a `failed` Job (per Foundation's reworded "nothing to show = no population to judge" rule).

**One-Summary-per-Job rule.** Exactly one Summary is produced and stored per Job, owned by the Job. A re-run produces fresh Results and therefore a fresh Summary; there is never more than one live Summary for a Job.

**Warning-on-failure.** Any failure of the stage — the adapter call erroring, output failing validation, or no surviving Results to digest — is recorded as a Warning on the Job and leaves the Summary absent. It never fails the Job and never marks a span `ERROR`. Per the Warning definition, a stage failure fails the Job only when it leaves nothing to show; the reviewable list is always still there, so Summarise can only ever Warn. The Job's terminal state becomes `done_with_warnings` whenever its warning list is non-empty.

**The Anthropic adapter.** The default Summarise adapter is an Anthropic (Haiku) adapter behind the port. It takes the selected snippets-plus-Enhancements input, prompts for a single coverage digest, and returns the validated Summary. It is one LLM call per Job (not per Result — the digest is Job-level). Observability follows the Stage Span convention: the Haiku call is a child span carrying GenAI semantic-convention attributes and cost; only counts, model id, finish reason, cost, and validated structured output appear on spans or logs — never raw prompt, completion, or snippet text (the same anti-echo rule as Exclusion's `exclusion_detail` and the Signal Split).

**Deferred Research API re-entry point (ADR 0002).** ADR 0002 defers the Tavily Research API and names *this* stage as its natural re-entry point: if snippet-based digests prove too thin, the Research API's synthesized-report-with-citations shape could feed Summarise to produce a richer Job-level digest. Because the stage is a port with a swappable adapter, that future change is an alternative adapter behind the same Summarise port, not a re-architecture. This is a documented future option, not current scope.

## Testing Decisions

Test external behaviour, not internals, and build the stage test-first (TDD throughout — red/green/refactor).

- **Vitest unit tests** for the input-selection logic and the Warning logic — the stage's own deep behaviour, with the port's adapter faked:
  - Only `included` Results (and their Enhancements) are selected; Excluded Results never feed the digest.
  - No surviving Results yields no Summary and records a Warning (the empty case), not a Job failure.
  - An adapter error, or output that fails Zod validation, records a Warning and leaves the Summary absent — the Job still reaches a terminal state with the list intact.
  - Exactly one Summary is produced and stored per Job.
- **Contract test for the Anthropic adapter** — pin the adapter's behaviour against the port: given a representative snippets-plus-Enhancements input, it returns a Summary that satisfies the validated output contract, and surfaces upstream/API failure as the typed failure the application maps to a Warning. No raw model text escapes the boundary.
- **Optional Autoevals** for digest quality — a small graded suite checking the Summary is faithful to and grounded in the supplied snippets (no claims absent from the input, reflects the aggregate coverage). Quality-gauge, kept out of the deterministic unit path.

## Out of Scope

- **The Tavily Research API integration itself.** It is deferred per ADR 0002; this PRD only records that Summarise is its natural future re-entry point. Building that integration is not part of this stage.
- **The per-Result Enhancement takeaway.** That is produced by the Enhance stage (in the post-Extract full-text re-pass) and is a different thing from the Job-level Summary. Summarise consumes the takeaways as input but does not produce or own them.
- Full-text-based digesting. The Summary is over snippets; reading Extracted full page text into the digest is explicitly not done today (it is the Research-API-shaped future option).

## Further Notes

- The vocabulary distinction is load-bearing and must hold in code, prompts, and UI copy: **Summary** is the one Job-level digest (the Result page's "Enhancement details summary"); the per-Result **Enhancement** takeaway is a separate field on each Result. Never call the Summary a "result summary".
- The Result page (see Web UI & SSE Delivery) presents the Summary in its "Enhancement details summary" slot and must render gracefully when it is absent (the Warning/degraded case) — the missing digest is expected behaviour, not an error.
- Summarise sequences strictly after Verify / Extract / Classify / Enhance and after Collapse, so the `included` set it reads is final for the run.
- Because the digest is one Haiku call per Job (not per Result), its observability footprint is a single external-call child span under the Summarise Stage Span — cheap and easy to read in the Job Trace.
