---
name: Breakbeat
description: A warm, editorial research instrument for reading what the outside world has published about a company.
colors:
  newsprint: "#efe8e3"
  newsprint-surface: "#fcfaf9"
  newsprint-raised: "#f7f3ef"
  newsprint-sunken: "#f3ece7"
  newsprint-border: "#ebe0d8"
  newsprint-border-strong: "#d8cbc0"
  ink: "#292a2a"
  ink-strong: "#1d1e1e"
  ink-control: "#3f3e3e"
  ink-toned: "#5c5959"
  ink-muted: "#6f6b6b"
  ink-dimmed: "#8c8888"
  accent-blue: "#46bbff"
  accent-blue-text: "#1071b3"
  accent-green: "#56e69a"
  accent-green-text: "#127541"
  accent-pink: "#fd9aa4"
  accent-pink-text: "#a02c38"
  focus: "#46bbff"
  success: "#56e69a"
  warning: "#fec2c8"
  error: "#fd9aa4"
  error-text: "#a02c38"
typography:
  display:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-sm:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  caption:
    fontFamily: "FK Grotesk, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink-control}"
    textColor: "{colors.newsprint-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.newsprint-surface}"
  button-secondary:
    backgroundColor: "{colors.newsprint-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-secondary-hover:
    backgroundColor: "{colors.newsprint-sunken}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.newsprint-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  card:
    backgroundColor: "{colors.newsprint-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "32px"
  chip:
    backgroundColor: "{colors.newsprint-surface}"
    textColor: "{colors.ink-toned}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.newsprint-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
---

# Design System: Breakbeat

## 1. Overview

**Creative North Star: "The Clippings Desk"**

Breakbeat is a researcher's warm-papered desk where verified press clippings are laid out and sorted by signal. The metaphor is literal in the brand's own token names, inherited from Drumbeat: the warm paper ground is `newsprint`, the dark text is `screen` (printer's ink). The whole product is an act of filtering coverage *about* a company down to what matters, then arranging it for fast, trustworthy review. The interface is the desk: calm, legible, unhurried, with the verification gate made visible in scores and provenance rather than hidden behind a black box.

The system is **light, warm, and editorial** — not the cool gray of a generic dashboard, not the pure-white flatness of a "clean" SaaS template. It is anchored on Drumbeat's `#efe8e3` newsprint ground, with near-white `#fcfaf9` cards floating on it under a single soft, warm-tinted shadow. Type is one confident grotesque (FK Grotesk) doing all the work through scale and weight; there is no display/body pairing, no decorative font. Color is held in reserve: ink and paper carry 90% of every screen, and the three brand brights (blue, green, pink) appear only as content-type icon fills, semantic states, and the focus ring. Motion is functional — state changes and live-stream entrances that reassure work is happening, never choreography for its own sake.

This system explicitly rejects three things, carried straight from PRODUCT.md. It is **not** a generic AI-SaaS template: no gradient heroes, no purple-blue gradients, no tiny tracked uppercase eyebrows, no identical icon-card grids. It is **not** a heavy enterprise dashboard: no chart junk, no gray-on-gray density, breathing room is mandatory. And it is **not flat and lifeless**: "clean" must never tip into dull — warmth, rhythm, and a point of view are earned through the paper, the type, and the spacing, never through decoration.

**Key Characteristics:**
- Warm newsprint ground (`#efe8e3`), near-white floating cards, ink-on-paper contrast.
- One grotesque type family (FK Grotesk); hierarchy through size and weight, never a second face.
- Restrained color: ink + paper dominate; brand brights are reserved for icons, states, and focus.
- Trust made visible: source, match score, and classification accompany every result.
- Calm under live load: SSE entrances reassure, never flash or thrash.

## 2. Colors

A warm two-axis palette: a `newsprint` paper ramp (warm, low-chroma) for grounds and surfaces, a `screen` ink ramp (cool charcoal) for text and controls, and three desaturated brand brights held in reserve.

### Primary
- **Ink** (`#292a2a`): The default text color and the voice of the system. Near-black with a faint warm-cool balance; used for all primary body text, headings, and labels on paper surfaces.
- **Ink Control** (`#3f3e3e`): The primary-action surface. The fill behind the main button ("Sign In", "Search"). One shade lighter than body ink so a filled button reads as an object, not a hole.
- **Ink Strong** (`#1d1e1e`): Reserved for the heaviest emphasis — the wordmark, a hovered primary control, a sticky header on scroll.

### Secondary (neutrals — the workhorses)
- **Newsprint** (`#efe8e3`): The page ground. Every screen sits on this warm paper. This is the inherited Drumbeat brand color and the single most important token.
- **Newsprint Surface** (`#fcfaf9`): Card and panel fill. A near-white that floats one step above the ground.
- **Newsprint Raised / Sunken** (`#f7f3ef` / `#f3ece7`): Subtle tonal layering — raised for hover/selected rows, sunken for inset wells and toolbars.
- **Newsprint Border** (`#ebe0d8`): The default 1px hairline on inputs, cards, and dividers. Warm, never cool gray.
- **Newsprint Border Strong** (`#d8cbc0`): A more present border for secondary buttons and emphasized separators.

### Tertiary (muted text ramp)
- **Ink Toned** (`#5c5959`): Secondary text at body size on the newsprint ground (5.7:1 — AA safe). The correct muted color for captions and helper text on paper.
- **Ink Muted** (`#6f6b6b`): Links and tertiary text. Only AA-safe (5.1:1) on the near-white *surface*; on the `#efe8e3` ground it is 4.35:1 — below body-text AA. See the Newsprint Contrast Rule.
- **Ink Dimmed** (`#8c8888`): Placeholders and disabled glyphs only. Never essential text.

### Accents (the brand brights — reserved)
- **Accent Blue** (`#46bbff`): The focus ring, the `info` state, and one content-type group's icon. Also the keyboard-focus indicator across the whole product.
- **Accent Green** (`#56e69a`): The `success` state (job complete, verified) and one content-type group's icon.
- **Accent Pink** (`#fd9aa4`): The `error`/`warning` fill and one content-type group's icon. The required-field asterisk.
- **Accent *-text** (`#1071b3` / `#127541` / `#a02c38`): The darker ramp steps used whenever a brand hue must carry *text* (error message copy, a colored link). The 400-level brights are for fills, icons, dots, and rings — never body text on a light surface.

### Named Rules
**The Ink-and-Paper Rule.** Ink and newsprint carry at least 90% of every screen. If a brand bright (blue/green/pink) is filling more than icons, states, and the focus ring on a given view, it is overused. Their rarity is what makes them legible as signal.

**The Newsprint Contrast Rule.** Body-size secondary text on the `#efe8e3` ground uses **Ink Toned `#5c5959`** (5.7:1), never Ink Muted `#6f6b6b` (4.35:1, fails AA at body size). `#6f6b6b` is permitted for secondary text only on the lighter `#fcfaf9` surface, or at ≥18px. Placeholders use `#8c8888` on white inputs only.

**The Colored-Text Demotion Rule.** A brand hue carrying text drops to its darker step: error copy is `#a02c38`, not `#fd9aa4`; a colored link is `#1071b3`, not `#46bbff`. The bright 400s are fills and indicators only.

## 3. Typography

**Display Font:** FK Grotesk (Drumbeat's proprietary grotesque) — with `-apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif` as the fallback stack.
**Body Font:** FK Grotesk — the same family. There is no second face.
**Label/Mono Font:** None. Labels and data use FK Grotesk at smaller sizes and heavier weights.

**Character:** FK Grotesk is a clean, slightly geometric grotesque with a confident, contemporary editorial feel — neither warm-humanist nor coldly technical. One family carries everything; hierarchy comes from a fixed rem scale and weight contrast (400 / 500 / 600), never from a competing typeface. This is a product surface: type disappears into the task.

### Hierarchy
- **Display** (600, `3rem` / 48px, line-height 1.05): Page titles only — the one big heading per screen ("Sign in", a company name on the result page). Letter-spacing `-0.01em`.
- **Headline** (600, `1.875rem` / 30px, 1.15): Section headers and the company name in the profile card.
- **Title** (600, `1.25rem` / 20px, 1.3): Card titles, result-row headlines, dialog titles.
- **Body** (400, `1rem` / 16px, 1.55): Prose, summaries, descriptions. Capped at **65–75ch** for reading passages (enhancement summaries, extracted content).
- **Body Small** (400, `0.875rem` / 14px, 1.5): The dense-UI default — table cells, input values, metadata, the workhorse of list rows.
- **Label** (500, `0.875rem` / 14px, 1.4): Form labels, button text, chip text, column headers.
- **Caption** (400, `0.8125rem` / 13px, 1.45): Timestamps, source domains, helper text. Use Ink Toned `#5c5959` on the ground.

### Named Rules
**The One Voice Rule.** FK Grotesk is the only typeface. No serif for "editorial warmth," no mono for "technical credibility." Warmth comes from the paper; credibility comes from the data. A second font family is prohibited.

**The Fixed-Scale Rule.** Sizes are fixed rem, never `clamp()`. A heading that fluidly shrinks inside a sidebar or a dense list looks worse, not designed. Users view this product at a consistent DPI; the scale is fixed at ~1.2–1.25 between steps.

## 4. Elevation

The system is **tonal-first with a single soft shadow.** Depth is conveyed primarily by tonal layering — the warm `#efe8e3` ground, the `#fcfaf9` surface one step above it, the `#f7f3ef` raised state — not by stacked shadows. Exactly one ambient, warm-tinted shadow lifts genuinely floating surfaces (the centered homepage form card, popovers, the focused result detail). Borders (`#ebe0d8`) do the structural separating work that shadows do in heavier systems. Surfaces are flat at rest within a panel; the shadow marks "this floats above the page," not "this is a box."

### Shadow Vocabulary
- **Float** (`box-shadow: 0 1px 2px rgba(41, 42, 42, 0.04), 0 10px 28px rgba(61, 51, 43, 0.07)`): The one card/panel shadow. Warm-tinted (the second layer uses the deep newsprint hue `#3d332b`, not neutral black) so it reads as paper on paper. Used on the homepage form and any modal/popover.
- **Lifted** (`box-shadow: 0 2px 4px rgba(41, 42, 42, 0.05), 0 16px 40px rgba(61, 51, 43, 0.10)`): A hovered or actively-dragged floating element only. Slightly deeper, same warm tint.

### Named Rules
**The Warm-Shadow Rule.** Shadows are tinted with the newsprint deep hue (`#3d332b`), never neutral or cool black. A cool gray drop-shadow on warm paper is the tell of an off-brand component.

**The Tonal-Before-Shadow Rule.** Reach for a tonal step (`newsprint-raised`, `newsprint-sunken`) or a border before reaching for a shadow. Shadows are for things that genuinely float above the page; everything else layers tonally.

## 5. Components

Every interactive component must ship its full state set: default, hover, focus-visible, active, disabled, and where relevant loading and error. A control with only a default state is unfinished.

### Buttons
- **Shape:** Gently rounded (8px / `rounded.md`). Never pill-shaped, never square.
- **Primary:** Ink-control fill (`#3f3e3e`) with surface-white text, padding `10px 18px`, label type (14px / 500). Hover deepens to Ink `#292a2a`; active to Ink Strong `#1d1e1e`. Focus-visible adds a 2px Accent Blue ring (`#46bbff`) with a 2px offset. The homepage search submit is a full-width primary button.
- **Secondary / Ghost:** Surface or transparent fill, 1px Newsprint Border Strong (`#d8cbc0`), Ink text. Hover fills Newsprint Sunken (`#f3ece7`). For lower-priority actions (filters reset, "view all searches").
- **Disabled:** Reduce to Newsprint Sunken fill, Ink Dimmed text, `cursor: not-allowed`, no shadow. Never a faded primary.

### Chips (content-type filter buttons)
- **Style:** Pill (`rounded.pill`), Newsprint Surface fill, 1px Newsprint Border, Ink Toned label text, padding `6px 14px`. Each chip pairs a content-type **icon** (colored by group) with its **text label** — color is never the only signal.
- **State:** Selected fills Ink (`#292a2a`) with surface-white text and the icon in white. Unselected on hover fills Newsprint Raised. A count badge may sit inline in Caption type.

### Cards / Containers
- **Corner Style:** 16px (`rounded.lg`) for cards and panels; 8px for nested controls inside them.
- **Background:** Newsprint Surface (`#fcfaf9`) on the `#efe8e3` ground.
- **Shadow Strategy:** The single **Float** shadow for genuinely floating cards (homepage form, popovers). Static in-flow cards (company profile, result detail) use a 1px Newsprint Border and tonal contrast instead — see the Tonal-Before-Shadow Rule.
- **Internal Padding:** `32px` (`2xl`) for primary cards; `16px`–`24px` for dense list containers.

### Inputs / Fields
- **Style:** White (`#fcfaf9`/`#fff`) fill, 1px Newsprint Border (`#ebe0d8`), 8px radius, padding `9px 12px`, Body Small type. Label above in Label type; required fields mark with an Accent Pink asterisk.
- **Focus:** Border shifts to Accent Blue (`#46bbff`) plus a 3px Accent-Blue ring at low alpha. No glow, no scale.
- **Error:** Border and helper text in Error-Text `#a02c38`; the message sits below the field in Caption type. Disabled: Newsprint Sunken fill, Ink Dimmed text.

### Navigation
- **Style:** Top bar on the Newsprint ground, no heavy shadow — a 1px Newsprint Border separates it. Links in Ink Muted (`#6f6b6b`) default, Ink (`#292a2a`) on hover and for the active route; weight steps from 500 to 600 on active. Current page is also marked structurally (underline or weight), not by color alone. Mobile: collapse to a single row with the wordmark and a menu trigger.

### Result Row (signature component)
The core of the product — the unit of the scored, filterable, SSE-streamed list. Each row is a flex line, not a card (cards-in-a-list is banned): a **content-type icon** (colored and shaped by group, with a `title`/`aria-label`), the result **headline** (Title type, links to the result-row page), the **source domain** and date (Caption, Ink Toned), and a **match score** rendered as a small numeric indicator with a thin confidence bar — high scores rise to the top of the list. New rows arrive via SSE with a gentle fade/slide entrance (≤200ms) into an ARIA live region; rows never reflow violently as the stream lands. Hover fills Newsprint Raised; the whole row is one keyboard-focusable target.

### Match Score Indicator
A compact trust primitive: the numeric score in Label type beside a 3px-tall bar filled proportionally in Ink (not a brand bright — score is structural, not categorical). Pair with a tooltip explaining what was matched. This is "trust is the feature" made literal.

## 6. Do's and Don'ts

### Do:
- **Do** anchor every screen on the Newsprint ground `#efe8e3` with `#fcfaf9` surfaces — the inherited Drumbeat brand, non-negotiable.
- **Do** use Ink Toned `#5c5959` for body-size secondary text on the ground (the Newsprint Contrast Rule); reserve `#6f6b6b` for the white surface or ≥18px.
- **Do** demote brand hues to their darker step for any colored text (`#a02c38` error copy, `#1071b3` links) — the Colored-Text Demotion Rule.
- **Do** pair every content-type color with a distinct icon shape **and** a text label, so color-blind users are never disadvantaged.
- **Do** carry all six interaction states on every control (default, hover, focus-visible, active, disabled, error), with a visible Accent-Blue focus ring throughout.
- **Do** announce SSE result arrivals via an ARIA live region, and give every entrance a `prefers-reduced-motion` crossfade/instant alternative.
- **Do** tint shadows with the deep newsprint hue `#3d332b`, and prefer tonal layering or a border before a shadow.
- **Do** keep FK Grotesk as the only typeface; build hierarchy with the fixed rem scale and weight.

### Don't:
- **Don't** ship the generic AI-SaaS template: no gradient heroes, no purple-blue gradients, no tiny uppercase tracked eyebrows above sections, no identical icon-card grids.
- **Don't** build a heavy enterprise dashboard: no chart junk, no gray-on-gray density, no filling every pixel — breathing room is required.
- **Don't** let "clean" tip into flat and lifeless: pure white, one gray, no warmth, no point of view is a failure. Warmth lives in the paper, the type, and the spacing.
- **Don't** use a cool or neutral-black drop shadow on the warm paper — it reads instantly as an off-brand component.
- **Don't** put a brand bright (`#46bbff` / `#56e69a` / `#fd9aa4`) on body text or let it fill more than icons, states, and the focus ring.
- **Don't** wrap result rows in cards (no nested cards, no card-per-row lists); the list is flat rows separated by hairlines.
- **Don't** use `clamp()`/fluid headings, a second font family, or a display face in UI labels, buttons, or data.
- **Don't** encode meaning in color alone — score, state, and content type each need a non-color signal too.
- **Don't** use `border-left`/`border-right` greater than 1px as a colored accent stripe on rows, cards, or alerts.
