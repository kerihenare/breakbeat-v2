# Recency enforcement is split: Time Slices for recall (Search), `out_of_window` for precision (Filter)

The 36-month recency horizon is enforced in two distinct places, not one. **Search** applies 12-month **Time Slices** only to date-reliable *angle queries* (news, press releases) to fish each window for recall — it Excludes nothing. **Filter** writes the **`out_of_window`** exclusion code as a cheap deterministic date-arithmetic rule against each Result's **Published Date** (captured nullable by Search from Tavily hit metadata). A Result with a NULL Published Date is never Excluded `out_of_window` (we don't guess, symmetric with Collapse's undated-copy rule).

## Why

`out_of_window` was orphaned in the original PRDs: Search deferred it "downstream", Filter disclaimed it as a "Search/Time-Slice concern", and Verify writes only `off_topic`. No stage wrote it, yet it sits in the closed exclusion-code set, the Observability metric labels, and the UI's excluded-reasons display.

Time Slices cannot *be* the recency filter: they apply only to news/PR queries, so date-unreliable types (blog, social, podcast, newsletter) run unsliced and a years-old blog post can return. Something downstream must reject it on its date. Filter is the right home — it is already pure deterministic logic, already reads Published Date for Collapse, and runs before any paid LLM work, so out-of-window Results are Excluded before they cost Verify/Extract tokens.

## Consequences

- Search's normalized hit shape gains `published_date` (nullable); it is persisted on the Result at insert.
- Filter's heuristic priority order gains an `out_of_window` rule. (Ordering vs `own_channel`/`aggregator`/`ecommerce_review` is a Filter-PRD detail; structural-control codes are generally preferred over `out_of_window` when a Result qualifies for both, so the Excluded reason names *what kind of surface* it was.)
- Dates are only as reliable as Tavily's metadata; an undated in-window-feeling Result stays `included` rather than being Excluded on a guess. This is deliberate — recall over a guessed rejection.
