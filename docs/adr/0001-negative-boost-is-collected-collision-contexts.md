# Negative Boost is collected collision contexts, not pre-computed diffs

## Status

accepted

## Context

`search.md` (the input spec) prescribes building the **Negative Boost** at Resolve time as three Haiku calls *per* Name Collision (value-prop diff, products/services diff, audiences diff) plus a category-tag delta. On a collision-heavy target like the Aglow test case (15+ collisions) that is ~45 Haiku calls fired before any search runs.

## Decision

The Negative Boost is **just the collisions' own Brand Contexts, collected** — a compact one-line-per-look-alike list — handed verbatim into every Verify prompt. **No dedicated per-collision diff calls.** Verify does the target-vs-look-alike contrast inline, against the actual page, primed by assertive framing ("Known look-alikes sharing this name that are NOT the target — reject pages about these: …").

## Why

- **No information is lost.** The diffs are derived from the same collision Brand Contexts Verify already receives; the diff is a restatement, not new signal.
- **Per-page contrast is better.** Pre-computed diffs are page-blind; Verify can focus on the axis that decides *that* page (funding vs. ministry; "it's an event, not a company"; incidental word match like "aglow with $86M").
- **Leaner, not heavier.** Compact descriptions cost fewer Verify tokens than injecting ~45 diff statements into every per-Result call.
- **Fewer failure modes, zero Resolve-time LLM cost.**

## Consequences / revisit trigger

The one scenario where pre-computed diffs could win is the genuinely confusable business-news middle (e.g. HomeAglow, Aglow Air) if Haiku contrasts more sharply when it does nothing but diff. This is **testable**: the brief mandates Autoevals and the Aglow test case is a labelled precision/recall set (14 include, ~300 exclude).

**Experiment to run later (option B):** re-introduce per-collision diffing and compare precision/recall on the Aglow set against this collected-contexts baseline. Only adopt (b) if it measurably improves the confusable middle. Until then, the first lever for any Verify miss is prompt framing, not pre-computation.
