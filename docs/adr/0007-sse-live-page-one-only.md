# Live SSE updates are scoped to page 1; pages 2+ are static snapshots

The Result page both paginates the Result list and live-re-sorts it by Match Score as Verify ratchets scores. These goals conflict — you cannot stably paginate a list that is continuously re-sorting. We resolve it by scope: **page 1 is the live region; pages 2+ are static snapshots; the whole list is frozen once the Job is terminal.**

- **Page 1 streams.** New Results and Verify score-flips insert and re-sort *within* page 1; a row pushed below the page-1 cutoff drops off the bottom and its slot is taken by the next-highest. Only the top N rows ever move. This is where "watch trust converge" lives.
- **Pages 2+ are static**, rendered from the read model at navigation time with no SSE mutation. Staleness is handled by re-querying on next page-nav (or a lightweight "list updated" affordance), not by live DOM mutation.
- **Terminal Job → fully stable.** Once `done` / `done_with_warnings` / `failed`, the list is frozen and pagination is stable everywhere — the normal case for reviewing a finished Job.

## Why

Live-mutating whatever page the user is on produces exactly the "violent reflow" and "the row I was about to click jumped to another page" thrash PRD 7 explicitly forbids. Scoping mutation to page 1 keeps the Lit SSE component tractable (the EventSource only ever touches the page-1 DOM), bounds the moving set, and matches the mockups' live-entrance behaviour. Deep pagination *during* an active run is an edge case; a calm static snapshot there is honest.

## Consequences

- The SSE client mutates only the page-1 DOM; pages 2+ render server-side and ignore the stream.
- The read-model query for page 1 must stay consistent with the client's in-place re-sort (both order by Match Score descending).
- Rejected alternatives: live updates across all pages (reflow thrash); suppressing pagination while running in favour of one growing live list (unbounded page-1 DOM, and still needs a frozen-pagination mode at terminal anyway).
