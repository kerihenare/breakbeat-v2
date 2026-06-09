# Web UI & SSE Delivery

**Status:** ready-for-agent
**Depends on:** Foundation & Job Lifecycle (and consumes all pipeline-stage outputs)

## Problem Statement

Breakbeat's value is filtering: it takes a single company name or domain and returns a trustworthy, scannable digest of third-party coverage about that company from the last 36 months, with the noise stripped out. All of that work happens inside a background pipeline — Resolve, Search, Filter, Collapse, Verify, Extract, Classify, Enhance, Summarise — but none of it is worth anything to a PR analyst, an internal operator, or a prospect evaluating the tool unless they can *see* it: start a Job from a single field, watch Results arrive while the pipeline runs, and review the surviving coverage ordered by trust.

There is no UI today. Without one there is no way to enqueue a Job, no way to disambiguate which company was meant at input (the choice that is frozen into the Job and never re-made later), no way to watch a running Job stream its Results, and no way to read a Resolved Identity, a Job-level Summary, a Match Score, a Content Type, a Verification reading, or a Sentiment. The pipeline emits a state machine that moves from `pending` to a terminal state (`done`, `done_with_warnings`, or `failed`) and a growing set of Results; the UI's job is to make that legible, calm under live load, and self-explanatory on first run.

The hard parts are specific to this product. First, **disambiguation at input**: a name like "Aglow" maps to several real companies, and the user must be able to pick the right one (via autocomplete, or via a list of matching options plus a domain fallback) before the Job is enqueued. Second, **live streaming without thrash**: Results arrive over time, the list re-sorts by Match Score as Verify ratchets scores from provisional to authoritative, and the page must update in real time via Server-Sent Events without violent reflow and while announcing arrivals to screen-reader users. Third, **trust made visible**: every Result row must show provenance (source, link to the original Page), its Match Score, its Content Type, and its Verification reading — including the honest NULL readings ("Unverified", "Unclassified") — so the user is never left wondering whether a Result is real, relevant, or merely not-yet-processed.

## Solution

A server-rendered web surface — NestJS 11 on Express, nunjucks templates, htmx for interaction, Lit only where htmx cannot reach, Tailwind v4 for styling — comprising four pages, all anchored on the Breakbeat design system (warm newsprint ground `#efe8e3`, FK Grotesk, ink-and-paper restraint).

1. **Homepage.** A single form, horizontally and vertically centred on the page: one input field (company name *or* domain) and a search button, with a link at the bottom to the Results list page. As the user types, the field offers autocomplete suggestions sourced from BrandFetch Brand Search. If the user picks a suggestion, that disambiguated brand is the anchor and the Job enqueues directly. If the user does *not* use autocomplete and submits raw text, the page presents a list of matching options from Brand Search **plus** a website-domain input as an explicit fallback; the user's choice (a matched brand, or a typed domain, or proceeding name-only) is the disambiguation that is frozen into the Job at input. Submitting enqueues the Job (the entry point owned by Foundation & Job Lifecycle) and navigates to that Job's Result page.

2. **Results (list).** A paginated list of the searches (Jobs), ordered most-recent first, each row showing the company (from the Resolved Identity anchor), the Job status (`pending` / running / `done` / `done_with_warnings` / `failed`) with a non-colour-only status badge, the count of included Results, and when the Job was run. Rows link to the Result page.

3. **Result (the live page).** The heart of the product. A company profile card built from the Resolved Identity (name, own domains, scraped social handles, description and tags from Brand Context, also-known-as, and any Resolve-time Warning such as negative-boosted Name Collisions), the Job-level **Summary** from the Summarise stage rendered as the "Enhancement details summary", a row of **Content Type** filter chips (each pairing a coloured-and-shaped icon with a text label), and a paginated list of **Result rows ordered by Match Score descending** that updates in real time via SSE. Each row is a flat flex line (never a card): a Content Type icon coloured *and* shaped *and* text-labelled by group, the headline linking to the Page, the source domain and date, and a **Match Score Indicator** (numeric score beside a thin confidence bar). A NULL Match Score reads "Unverified"; a NULL Content Type reads "Unclassified". New and updated rows arrive over a per-Job SSE stream and enter with a gentle (≤200ms) fade/slide into an ARIA live region; the stream also pushes Job status transitions and completes when the Job reaches a terminal state.

4. **Page (individual Result).** A page-details card with the Content Type, headline, a clear link out to the original external Page, and the trust facts (source, published date, Match Score, Verification reading, Sentiment), followed by the Result's extracted full-text content and its per-Result Enhancement takeaway ("result summary").

Every page satisfies WCAG 2.2 AA, supports full keyboard navigation with a visible Accent-Blue focus ring, never encodes meaning in colour alone, and ships a `prefers-reduced-motion` alternative for every entrance and streaming animation.

## User Stories

1. As a prospect evaluating Breakbeat, I want a homepage that is a single centred form with one input and one button, so that on first run it is obvious what to do without instruction.

2. As a PR analyst, I want to type either a company name or a company domain into the same single field, so that I don't have to know or decide which identifier the tool wants.

3. As a user typing a company name, I want autocomplete suggestions from BrandFetch Brand Search to appear as I type, so that I can pick the exact company quickly and confidently.

4. As a user, I want each autocomplete suggestion to show enough to tell companies apart (name, domain, and logo where available), so that I can distinguish same-named companies before I commit.

5. As a user who picks an autocomplete suggestion, I want the Job to start against that disambiguated brand immediately, so that the company I chose is the one that gets researched.

6. As a user who ignores autocomplete and just submits what I typed, I want the page to show me a list of matching options from Brand Search plus a website-domain input as a fallback, so that I can still disambiguate, or supply a domain the search didn't surface.

7. As a user who can't find my company in the options list, I want to proceed name-only as an explicit choice, so that the Job still runs (degraded, with a Warning) rather than blocking me.

8. As a user, I want my disambiguation choice to be frozen into the Job at input, so that re-running the Job re-fetches fresh data for the same company and never silently re-decides which company it was.

9. As a user, I want a clear link from the homepage to the Results list, so that I can get to my past searches without starting a new one.

10. As a returning user, I want a paginated Results list of my searches ordered most-recent first, so that I can find a recent Job at a glance.

11. As a user scanning the Results list, I want each Job row to show the company, its status, its included-Result count, and when it was run, so that I can judge which Job to open.

12. As a user, I want a running Job in the Results list to read as in-progress (e.g. "Researching…") and distinguishable from `done`, `done_with_warnings`, and `failed` without relying on colour, so that I know a Job's state at a glance and accessibly.

13. As a user, I want to click a Job in the Results list and land on its Result page, so that I can review or watch that Job.

14. As a user on a Result page, I want a company profile card built from the Resolved Identity — name, own domains, social handles, description, and tags — so that I can confirm the tool researched the company I meant.

15. As a user, I want the profile card to surface a Resolve-time Warning when one exists (e.g. same-name companies that were negative-boosted, or that no homepage resolved), so that I understand any caveats on the Job's identity.

16. As a user, I want the Job-level Summary (the Enhancement details summary) shown near the top of the Result page, so that I get the gist of the coverage before I scan individual Results.

17. As a user, I want a paginated list of Result rows ordered by Match Score descending, so that the coverage we are most confident is about my company rises to the top.

18. As a user, I want each Result row to be a single flat line showing a Content Type icon, the headline, the source domain and date, and a Match Score Indicator, so that I can scan many Results quickly without visual clutter.

19. As a user, I want each Content Type signalled by icon shape and a text label as well as colour, so that I'm not disadvantaged if I can't distinguish the icon colours.

20. As a user, I want the Match Score shown as a number alongside a thin confidence bar, so that I can read relative confidence at a glance and compare rows down the list.

21. As a user, I want a Result row whose Match Score is NULL to read "Unverified", so that I understand the score is absent (Verify didn't run or had no basis), not zero.

22. As a user, I want a Result row whose Content Type is NULL to read "Unclassified", so that I understand classification hasn't been applied rather than seeing it mislabelled.

23. As a user, I want a Result row's headline to link to its Page, so that I can drill into the detail when a row looks worth reading.

24. As a user watching a Job that is still running, I want new and updated Result rows to appear in real time via Server-Sent Events, so that I can start reviewing coverage before the whole Job finishes.

25. As a user, I want streaming rows to enter with a gentle (≤200ms) fade/slide and the list to re-sort by Match Score without violent reflow, so that live updates reassure me work is happening rather than distracting me.

26. As a user, I want the score and ordering to settle as Verify ratchets each Match Score from provisional to interim to authoritative, so that the list converges on a trustworthy order as the Job completes.

27. As a screen-reader user, I want SSE-driven Result arrivals and the Job's completion announced via an ARIA live region, so that I learn that Results are arriving and when the Job is done without watching the screen.

28. As a user, I want the page to reflect the Job's status transition to its terminal state (`done`, `done_with_warnings`, or `failed`) and stop streaming when the Job completes, so that I know the list is final.

29. As a user on a `done_with_warnings` Job, I want the Result page to still show its list with the warning state made plain, so that I can use the partial-success output and understand it may be incomplete or untyped.

30. As a user on a `failed` Job, I want the page to explain that the Job failed with nothing to show, so that I'm not left staring at an empty list wondering whether it's still loading.

30a. As a user on a `done` / `done_with_warnings` Job that found no in-scope coverage, I want an explicit empty-state message ("No third-party coverage found in the last 36 months") that is clearly distinct from a `failed` Job, so that I can tell "we looked and there's nothing" apart from "the run broke" — both honest, but different facts.

31. As a user, I want Content Type filter chips that let me narrow the list to one type, so that I can focus on, say, only news articles or only podcasts.

32. As a user, I want each filter chip to show a count and disable types with zero Results, so that I know what's available before I click.

33. As a user, I want filtering to keep the Match Score ordering and pagination coherent, so that narrowing by Content Type still shows the most-confident matches first.

34. As a user, I want a way to review lower-confidence and Excluded Results separately from the main list (collapsed by default), with each Excluded Result showing why it was Excluded, so that the primary list stays high-signal while I can still audit what was set aside.

35. As a user, I want to page through a long Result list, so that I can review all the coverage without an unmanageably long page.

36. As a user opening a Result row, I want a Page with a details card — Content Type, headline, source, published date, Match Score, Verification reading, and Sentiment — so that I can see the full trust picture for one piece of coverage.

37. As a user on a Page, I want a clear, prominent link to the original external page (opening safely in a new tab), so that I can read the source itself.

38. As a user on a Page, I want the extracted full-text content shown along with the per-Result Enhancement takeaway, so that I can read the substance without leaving Breakbeat, and see our one-line read on it.

39. As a user on a Page whose Sentiment or Verification is absent, I want those facts to read honestly (e.g. "Unverified") rather than be hidden or faked, so that I trust what the tool tells me.

40. As a keyboard-only user, I want to operate the homepage form and its autocomplete, the filter chips, the Result rows, and the paginator entirely from the keyboard with a visible Accent-Blue focus ring, so that I can use the whole product without a mouse.

41. As a user who prefers reduced motion, I want every entrance and streaming animation to fall back to a crossfade or instant update, so that live streaming doesn't trigger discomfort.

42. As a user on a small screen, I want the profile card, Result rows, filter chips, and paginator to reflow sensibly, so that the product is usable on mobile.

43. As a colour-blind user, I want score, Job status, Content Type, and Sentiment each to carry a non-colour signal (shape, label, or text), so that no meaning is lost to me anywhere in the product.

## Implementation Decisions

**Rendering approach.** Pages are server-rendered HTML via nunjucks templates, styled with Tailwind v4 against the Breakbeat design tokens. htmx drives interaction wherever a request/response-and-swap is sufficient: form submission, the options-list disambiguation step, filter-chip selection, pagination, and the excluded/lower-confidence disclosure. **Lit is reserved** for the two places htmx alone is awkward: the typeahead autocomplete on the homepage (debounced input, keyboard-navigable suggestion listbox, BrandFetch-backed) and the live SSE Result stream on the Result page (managing the EventSource connection, applying ≤200ms entrance transitions, re-sorting by Match Score in place, and writing to the ARIA live region). Everything else stays htmx/nunjucks. The UI is presentation only: it queries read models and consumes the SSE stream; it does not run pipeline logic.

**Pages and their conceptual contracts.**

- *Homepage* renders the centred search form and a link to the Results list. On submit, if the input is an unambiguous autocomplete selection it hands the chosen anchor to the enqueue entry point (owned by Foundation & Job Lifecycle) and redirects to the new Job's Result page. If the input is raw text, it renders the disambiguation step: a list of Brand Search options plus a domain-input fallback and an explicit name-only proceed. The user's selection — matched brand, typed domain, or name-only — is what is frozen into the Job; the UI passes the choice through and never re-decides it later (see Foundation & Job Lifecycle and Resolve Stage).
- *Results list* queries a paginated read model of Jobs ordered by created-time descending, showing the company anchor, Job status, included-Result count, and run time per row.
- *Result page* composes three read-model reads scoped to one Job: the Resolved Identity (for the profile card), the Job-level Summary (for the Enhancement details summary), and the page-1 slice of Result rows ordered by Match Score descending (with per-Content-Type counts for the chips). It then opens the per-Job SSE stream for live updates. A terminal Job with **zero `included` Results** renders the explicit empty-state ("No third-party coverage found in the last 36 months"), which is visually and semantically distinct from the `failed`-empty state ("the run broke") — an empty `done`/`done_with_warnings` Job is an honest finding, not a failure.
- *Page* queries one Result by id within its Job: the trust facts (source, published date, Match Score, Verification reading, Content Type, Sentiment), the extracted full-text content, and the per-Result Enhancement takeaway.

**Read models the UI queries.** All UI reads go through Drizzle/Postgres read models — never against pipeline internals. The UI needs: a Jobs list view (anchor, status, included count, run time); a per-Job Resolved Identity view; the per-Job Summary; a Results view filterable by Content Type, sorted by Match Score descending, paginated, and partitioned into the high-signal `included` list versus the collapsed lower-confidence/`excluded` set (each Excluded Result carrying its `exclusion_code` and human-readable detail for display); and a single-Result detail view. Match Score is the sort key throughout and is read as it currently stands (provisional → interim → authoritative); the UI does not compute or re-rank it.

**Worker→web bridge (ADR 0006).** The pipeline runs on `breakbeat-worker`; the open SSE connections live on `breakbeat-web`. They are bridged by **Redis Pub/Sub**: after each DB write commits, the worker publishes an **id-only nudge** (`{ jobId, kind: "result" | "status", id }`) on a per-Job channel; the web SSE handler subscribes for the Job it is streaming and, on each nudge, runs the read-model query against Postgres and emits the SSE frame. **Postgres is the source of truth; the nudge carries only ids, never content** — so a dropped or duplicated message is harmless (row-level idempotency and the server-rendered page-1 reload both cover it), and no model or page text ever rides the channel. The worker publishes whether or not anyone is connected, preserving the Foundation process-decoupling. Granularity is **per-Result with no SSE replay on connect** (page 1 is server-rendered on load; SSE carries only subsequent deltas).

**SSE stream contract.** The Result page subscribes to a per-Job SSE stream. The stream pushes two kinds of message: a **Result event** (a new or updated Result row — its current Match Score, Content Type reading, Verification reading, source, date, headline, and Page link, pre-rendered or rendered client-side into the flat row) and a **Job status event** (a transition such as `running → done | done_with_warnings | failed`). The client inserts new rows and updates existing rows in place, keeping the list ordered by Match Score descending (a Verify flip that changes a score moves the row to its correct position rather than appending). The stream **completes when the Job reaches a terminal state**; the client then closes the connection and renders the final status. The stream is resumable/idempotent at the row level — re-delivering or updating a known Result by id must not duplicate it. **Live updates are scoped to page 1 only (ADR 0007):** new Results and Verify score-flips insert/re-sort *within* page 1, and a row pushed below the page-1 cutoff drops off the bottom (its slot taken by the next-highest); **pages 2+ are static snapshots** rendered from the read model at navigation time with no SSE mutation (staleness handled by re-querying on page-nav). Once the Job is terminal the whole list is frozen and pagination is stable everywhere. The EventSource therefore only ever mutates the page-1 DOM — this is what keeps live load calm and the client tractable, and avoids the "row jumped to another page" thrash. (Note for the Observability PRD: the SSE route and the health route are **excluded from HTTP span creation**; SSE health is metrics-only — an active-connections gauge and a messages-sent counter, no span-per-message.)

**ARIA live region.** The Result list is (or contains) a polite ARIA live region. New Result arrivals and the Job's terminal transition produce concise spoken announcements (e.g. that Results are arriving, and that the Job is done / done with warnings / failed) without reading every row aloud on every update. The live region is the accessibility counterpart of the visual fade/slide entrance.

**NULL-state labelling.** "Unverified" and "Unclassified" are *readings* of NULL, computed at render time — they are never stored values and never written back. Mid-Job a NULL Match Score or Content Type simply means the Result hasn't reached that stage yet; at a terminal state it means the stage didn't run or had no basis. The view-model layer maps NULL `verification_status` to "Unverified" and NULL `content_type` to "Unclassified" consistently across the row, the chips, and the Page detail. **A NULL `verification_status` does not imply a NULL Match Score**: an Extract-failed Result reads "Unverified" yet still shows its interim numeric score (provisional ordering) — the view-model must render the two independently and never assume one NULL entails the other. Excluded Results display their `exclusion_code` (and `exclusion_detail` where present) as the reason; the UI surfaces the reason, never the catching stage.

**Design-system adherence (DESIGN.md named rules).**

- **Ink-and-Paper Rule:** ink and newsprint carry every screen; the brand brights (blue/green/pink) appear only as Content Type icon fills, semantic state, and the focus ring — never as backgrounds or body text.
- **Newsprint Contrast Rule:** body-size secondary text on the `#efe8e3` ground uses Ink Toned `#5c5959`, never Ink Muted; the muted step is only for the lighter surface or ≥18px.
- **Colored-Text Demotion Rule:** any coloured text (links, error copy) uses the darker `*-text` step.
- **Warm-Shadow Rule** and **Tonal-Before-Shadow Rule:** the single warm-tinted Float shadow is used only for genuinely floating surfaces (the homepage form card, popovers, the autocomplete menu); in-flow cards (profile, Page detail) use a 1px Newsprint Border and tonal layering instead.
- **One Voice Rule** and **Fixed-Scale Rule:** FK Grotesk only, hierarchy by the fixed rem scale and weight; no second face, no `clamp()`.
- **Result Row as a flat row, NOT a card:** the list is flat flex rows separated by hairlines; cards-in-a-list is banned, and no >1px coloured left/right accent stripe.
- **Match Score Indicator:** numeric score in Label type beside a 3px Ink-filled bar (Ink, not a brand bright — score is structural, not categorical), with a tooltip explaining what was matched.
- Filter chips follow the chip spec: pill, icon-plus-label, selected fills Ink with surface-white text; a count badge inline; zero-count types disabled.
- Every interactive control ships its full state set (default, hover, focus-visible, active, disabled, error) with the visible Accent-Blue focus ring throughout.

**Accessibility & motion.** WCAG 2.2 AA is the bar. No meaning is encoded in colour alone anywhere: Job status pairs a dot with a label, Content Type pairs colour with shape and text, Sentiment pairs a dot with a word, score pairs the bar with the number. Full keyboard navigation across the form, autocomplete listbox, chips, rows, disclosure, and paginator, with the Accent-Blue focus ring visible at all times. Every entrance and streaming animation has a `prefers-reduced-motion` alternative (crossfade or instant), including the row entrance and the running-status pulse.

## Testing Decisions

TDD throughout: write the failing test against external behaviour first, then implement. Tests assert what the user observes (rendered HTML, live updates, announcements, navigation), never internal wiring.

**Playwright (integration / E2E)** covers the page flows and live behaviour:
- Homepage: typing yields autocomplete suggestions; selecting one enqueues a Job and navigates to its Result page; submitting raw text shows the options list plus the domain fallback; choosing an option, a typed domain, or proceeding name-only each enqueues the expected Job; the link to the Results list works.
- Results list: paginated, ordered most-recent first; each status renders distinctly and non-colour-only; a row navigates to its Result page.
- Result page SSE: with a per-Job stream, new Result events insert rows, updated events (a Verify score flip) re-position rows so the list stays ordered by Match Score descending, no duplicate rows appear on re-delivery, the ARIA live region receives announcements, and the stream completes (and the client closes) on the terminal status — asserting `done`, `done_with_warnings`, and `failed` paths, including the empty `failed` state and the distinct empty-but-`done` state ("No third-party coverage found"). Assert **page-1-only live scope (ADR 0007)**: a flip raising a page-2 row above the page-1 cutoff surfaces it on page 1 and drops the displaced row; navigating to page 2+ shows a static snapshot that does not mutate under the stream; a terminal Job's pagination is stable across all pages.
- Filtering: selecting a Content Type chip narrows the list, counts are correct, zero-count chips are disabled, and ordering/pagination remain coherent under a filter.
- Pagination: paging through both the Results list and the Result rows yields the right ranges and disabled prev/next at the ends.
- Excluded disclosure: the lower-confidence/Excluded set is collapsed by default and each Excluded Result shows its reason.
- Page: the original-link, trust facts, extracted content, and Enhancement takeaway render; NULL Verification/Sentiment read honestly.
- Keyboard navigation: the full form (including the autocomplete listbox), chips, rows, disclosure, and paginator are operable from the keyboard with a visible focus ring.
- Reduced motion: under emulated `prefers-reduced-motion: reduce`, row entrances and the status pulse fall back to crossfade/instant while updates still land.

**Vitest (unit)** covers the view-model and formatting logic in isolation: the NULL → "Unverified" / "Unclassified" readings; date and source-domain formatting; Match Score → bar-width and numeric display; Job-status → badge mapping; Sentiment → label mapping; Content Type → icon-group + label mapping; chip count derivation and zero-count disabling; pagination range maths; and the row-merge/re-sort logic that keeps the live list ordered by Match Score on insert and update.

**Automated accessibility checks** run against every page (homepage, Results list, Result, Page) and against the Result page mid-stream, asserting WCAG 2.2 AA: contrast on the newsprint ground, the live-region wiring, focus-ring visibility, listbox/dialog roles for autocomplete and disclosures, and that no signal is colour-only. These run inside the Playwright suite so they exercise the real rendered DOM, including post-SSE state.

## Out of Scope

- The pipeline stages themselves (Resolve, Search, Filter, Collapse, Verify, Extract, Classify, Enhance, Summarise) and the Job state machine and enqueue entry point — owned by the Foundation & Job Lifecycle PRD and the stage PRDs. This PRD consumes their outputs and read models.
- How Match Score, Verification, Content Type, Sentiment, the Summary, and Exclusions are computed or stored — this PRD only reads and renders them.
- Authentication, accounts, and multi-tenant scoping of the Results list.
- The full observability instrumentation — owned by the Observability PRD. This PRD only states the SSE/health route span-exclusion and the SSE metrics shape as a constraint for that PRD.
- A **dedicated re-run affordance** (a one-click "Re-run" button) is deferred. Re-running is achieved today by submitting the same company through the existing homepage form, which Foundation handles as *submit* re-invoked against the same frozen anchor (no re-disambiguation, fresh Job + Results) — so the three Foundation re-run user stories are satisfiable without a new UI control. Editing, deleting, or exporting Jobs and Results from the UI is also out of scope (nothing is ever deleted — Results are Excluded, never dropped).
- Notifications, email, or any push outside the in-page SSE stream.
- BrandFetch Brand Search integration internals beyond consuming it for autocomplete and the options list (the resolution/freezing of the chosen anchor is detailed in Foundation & Job Lifecycle and Resolve Stage).

## Further Notes

The reference mockups in `mockups/` are the visual intent for this PRD and should be treated as design direction, not code to transcribe:
- `mockups/results-list.html` — the Results (list) page: the flat searches table with status badges (done / running / warnings / failed / pending), included-Result counts, run times, and the shared paginator.
- `mockups/result.html` — the Result (live) page: the company profile card from the Resolved Identity (including a negative-boost Warning note and an also-known-as), the Summary block, the Content Type filter chips with counts and a disabled zero-count chip, the flat Result rows with Content Type icon tiles + Match Score Indicators, the `row--new` SSE entrance, the `aria-live="polite"` results list, the collapsed lower-confidence/Excluded disclosure (with `off_topic`, `own_channel`, `ecommerce` reasons and an "Uncertain match" reading), and the reduced-motion fallback.
- `mockups/page.html` — the Page (individual Result): the page-details card with the prominent "Read original" link, the trust facts (source, published, Match Score, Verification, Sentiment), the per-Result summary block, and the extracted full-text content noted as extracted via Tavily.

The mockups demonstrate the named DESIGN.md rules in practice — flat rows over cards, the Ink-filled Match Score bar, icon+shape+label Content Types, warm-tinted shadows only on floating surfaces, and the `prefers-reduced-motion` block. Where a mockup detail (exact icon set, breakpoints, the precise wording of an announcement) and this PRD's prose diverge, the domain vocabulary in CONTEXT.md and the named rules in DESIGN.md are authoritative; the mockup shows the feel.

One terminology note for implementers: the original brief mentioned ETA templates, but this product standardises on **nunjucks** for server-rendered templates (with htmx and Lit as described above); follow this PRD and its siblings, not the brief, on the template engine.
