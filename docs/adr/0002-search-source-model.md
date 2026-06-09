# Search source model: Tavily primary, Anthropic as escalation backstop, Research API deferred

## Status

accepted

## Context

`search.md` and the brief list three search sources, run as always-on parallel inputs: Tavily Search, the Tavily **Research** API, and Anthropic web search (the latter two both fed the "Search prompt"). The brief lists the Research API under External Services with its endpoint.

## Decision

Search has **two** sources, layered behind a single low-yield escalation gate:

- **Tavily Search** — primary recall, always run (broad queries by default; Angle Query set + long-tail type-targeted queries on escalation).
- **Anthropic web search** — an **escalation backstop**, not always-on. Fires on the *same* low-Tavily-yield trigger as the angle queries, as a recall rescue for thin runs (name-only inputs, obscure companies).

The **Tavily Research API is deferred** — it is not in the recall path. It returns a synthesized report with citations, which fits the "many Results → verify/classify each" pipeline awkwardly, costs more, and is slower.

## Why

- An always-on parallel Anthropic search against a rich Tavily yield mostly produces duplicates we pay for and then URL-dedup away; reserving it for low-yield runs is where it actually rescues recall.
- The Research API's report-with-citations shape doesn't match a hit-list-then-verify pipeline; keeping the source model at two clean recall sources is simpler and cheaper.

## Consequences / revisit triggers

- **(a) Anthropic always-on vs backstop** — revisit later: if eval recall on thin runs is still weak with the backstop, or if duplicate cost turns out negligible, reconsider running it always-on. Note left for a future pass.
- **(b) Tavily Research API** — deferred, not rejected. The natural re-entry point is **feeding the Summarise stage** (a Job-level digest) if snippet-based summaries prove too thin — not recall. Reconsider at that later stage.
