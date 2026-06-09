# Product

## Register

product

## Users

Breakbeat serves three overlapping audiences, all doing the same job:

- **Drumbeat customers** — PR, comms, and marketing professionals running media monitoring and company research as part of their work.
- **Internal Drumbeat team** — analysts and operators who run company research often; product-familiar and tolerant of density.
- **Prospects** — people evaluating the tool, who need it to be self-explanatory on first run.

**Context & job to be done:** A user pastes a company name or domain and wants a fast, trustworthy, reviewable digest of everything the outside world has published about that company in the last 36 months — filtered to signal. The mental model is: *"Show me what's been said about this company recently, with the noise stripped out, so I can scan it and act."*

## Product Purpose

Breakbeat accepts a single input (company name or domain), then runs a background research job: it disambiguates the company via BrandFetch (brand + context APIs, with name-collision negative-boosting), searches broadly (Tavily Search/Research + Anthropic web search), and runs each result through a verification gate, classification, full-content extraction, and enhancement (sentiment and more). It presents the surviving results as a scored, filterable, paginated list that updates in real time via Server-Sent Events.

It deliberately **excludes** the company's own channels, ecommerce and product-review pages, and link aggregators — coverage *about* the company, not *by* it.

**Success looks like:** a user trusts the results at a glance, scans a long list quickly, and lands on the coverage that matters without sifting through noise.

## Brand Personality

**Confident and precise — a sharp research instrument.** Editorial restraint with warmth: as readable as good docs (Mintlify), as calm under data density as a well-made dashboard (Stripe), and native to the existing Drumbeat brand. Polished to the level of Linear or the Stripe dashboard, never merely utilitarian.

- **Three words:** Precise. Trustworthy. Warm.
- **Voice:** clear and direct, never hyped. "Clean and clear, but definitely not boring."
- **Emotional goal:** the user feels they're holding a credible instrument, not querying a black box.

## Anti-references

- **Generic AI-SaaS template** — gradient heroes, identical icon-card grids, tiny uppercase tracked eyebrows, purple-blue gradients. The default-slop look.
- **Heavy enterprise dashboard** — chart junk, gray-on-gray density, every pixel filled, no breathing room.
- **Flat and lifeless** — so "clean" it's boring: pure white, one gray, no warmth, no motion, no point of view. ("Clean" must never tip into dull.)

## Design Principles

1. **Signal over noise.** The product's entire value is filtering. The interface must make high-confidence, high-relevance results obviously rise to the top, and make scoring and exclusions legible. The UI is an extension of the verification gate.
2. **Trust is the feature.** Show provenance (source, link to original), match score, and why a result was included or classified. Never leave the user wondering whether a result is real or relevant.
3. **Scannable first, detailed on demand.** Optimize the list for fast review; depth lives one click away on the result-row page, not crammed into every row.
4. **Calm under live load.** Results stream in via SSE. State changes and entrances should reassure that work is happening — never distract, flash, or cause layout thrash.
5. **Native to Drumbeat, carried by craft.** Anchor on Drumbeat's existing brand tokens (warm `#efe8e3` ground). Earn "not boring" through typography, spacing, rhythm, and restraint — not decoration.

## Accessibility & Inclusion

Target **WCAG 2.2 AA, with extra care** for this product's specifics *(default — adjust if the team wants a different bar)*:

- **Don't encode meaning in color alone.** Content-type groups use colored icons; pair color with a distinct icon shape and a text label so color-blind users aren't disadvantaged. Verify all content text hits AA contrast against the warm `#efe8e3` ground.
- **Announce live updates.** SSE-driven result rows must update an ARIA live region so screen-reader users learn that results are arriving and when the job completes.
- **Keyboard and focus.** Full keyboard navigation through the form, filters, and result lists; visible focus states throughout.
- **Reduced motion.** Every entrance/streaming animation needs a `prefers-reduced-motion` alternative (crossfade or instant).
