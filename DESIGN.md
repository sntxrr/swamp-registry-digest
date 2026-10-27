---
name: Last Week in Swamp Club
description: A weekly field journal of the swamp extension registry, kept at dusk on the bayou.
colors:
  dusk: "#0b2a26"
  dusk-ink: "#e4ead8"
  dusk-ink-2: "#aebda4"
  dusk-rule: "#22453e"
  lantern: "#fff1c4"
  firefly: "#f0a63a"
  bloom: "#c193ef"
  sun: "#fde36a"
  dusk-ink-muted: "#a9b89e"
  mist: "#eaf0ea"
  mist-ink: "#0d2a25"
  mist-ink-2: "#3d554f"
  mist-rule: "#c4d2c8"
  firefly-mist: "#94470a"
  bloom-mist: "#6a3a9c"
  water-a-mist: "#7b48b5"
  water-b-mist: "#d9792b"
  water-c-mist: "#e2b93b"
typography:
  display:
    fontFamily: "Bricolage Grotesque (self-hosted as \"Display\"), ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.75rem, 5vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 4.2vw, 2.35rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  count:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: "tnum"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  focus: "2px"
spacing:
  gutter: "1.25rem"
  gutter-phone: "1rem"
  item: "0.8rem"
  section: "3rem"
  section-phone: "2.5rem"
  column: "50rem"
  measure: "68ch"
components:
  masthead:
    backgroundColor: "{colors.dusk}"
    textColor: "{colors.dusk-ink}"
  masthead-site-name:
    textColor: "{colors.lantern}"
    typography: "{typography.display}"
  masthead-link:
    textColor: "{colors.firefly}"
    typography: "{typography.label}"
  reading-column-dark:
    backgroundColor: "{colors.dusk}"
    textColor: "{colors.dusk-ink}"
    width: "{spacing.column}"
    padding: "0 1.25rem"
  reading-column-mist:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.mist-ink}"
    width: "{spacing.column}"
    padding: "0 1.25rem"
  count-figure:
    textColor: "{colors.firefly}"
    typography: "{typography.count}"
  section-heading:
    typography: "{typography.title}"
    padding: "0 0 0.55rem"
  entry-name:
    textColor: "{colors.firefly}"
    typography: "{typography.mono}"
  entry:
    padding: "0.8rem 0"
  footer:
    backgroundColor: "{colors.dusk}"
    textColor: "{colors.dusk-ink-2}"
---

# Design System: Last Week in Swamp Club

## Overview

**Creative North Star: "The Dusk Field Journal"**

A field journal kept at dusk on the bayou. The owner's artwork owns the frame: a full-bleed banner opens every page and a cropped strip of the same art (the "shore") closes it, and both stay at dusk whatever the reader's colour mode. Between them the reading column is calm and dense enough to scan ~300 entries: a single 50rem column, system sans text, hairline dividers, and colour spent only on links, counts and the waterline under each section heading.

The palette is sampled from the artwork, not invented: bayou-teal sky for the ground, firefly amber for everything you can click, violet bloom for secondary emphasis, and sun gold only at the far end of the waterline. The reading column follows `prefers-color-scheme`: dusk at night, "morning mist" (a pale green-grey ground with bayou-teal ink) by day. The frame never brightens.

It is a static page under a strict CSP (`default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'`): no scripts, no inline styles, no third-party anything. Every page links one shared `/site.css`, so a change to the stylesheet restyles every back issue; asset files are never renamed. There is no motion by design.

**Key Characteristics:**
- Dusk frame (masthead and footer) in both colour modes; reading column flips dusk / morning mist.
- Firefly amber is the only link and count colour; violet bloom marks secondary metadata.
- One display face, Bricolage Grotesque, for the site name, headings and figures; system sans for reading; mono only for extension names and versions.
- Section openers sit on a 2px violet → amber → sun gradient rule (the waterline).
- Flat: no shadows, no cards, no rounded containers, no motion.

## Colors

A dusk bayou palette taken from the owner's artwork: deep teal ground, warm firefly and sun light, one violet.

### Primary
- **Firefly Amber** (`firefly` dark / `firefly-mist` light): every link, the masthead and footer nav, the issue counts, the focus ring and the scrollbar thumb. The dark value is also hard-set on masthead and footer links so the frame stays at dusk in light mode. Light-mode value is darkened to an ember brown for AA on mist (5.74:1, the lowest body pair measured).

### Secondary
- **Violet Bloom** (`bloom` dark / `bloom-mist` light): secondary emphasis only: section counts beside an h2, `.meta` dates on the index, text selection background, and the left end of the waterline.

### Tertiary
- **Sun Gold** (`sun`): the right end of the waterline in dark mode (`water-c-mist` is its light counterpart). Never used for text or fills.
- **Lantern** (`lantern`): the site name over the artwork, nowhere else.

### Neutral
- **Bayou Dusk** (`dusk`): the frame background (masthead, footer, `html`), the scrim colour over the art, and the dark-mode reading ground.
- **Dusk Ink / Dusk Ink 2** (`dusk-ink`, `dusk-ink-2`): text and secondary text on the frame. `dusk-ink-muted` is the dark-mode secondary ink in the reading column.
- **Dusk Rule** (`dusk-rule`): hairlines in dark mode and the masthead nav underline in both modes.
- **Morning Mist** (`mist`), **Mist Ink** (`mist-ink`), **Mist Ink 2** (`mist-ink-2`), **Mist Rule** (`mist-rule`): the light-mode reading column ground, text, secondary text and hairlines.

### Named Rules
**The Dusk Frame Rule.** Masthead and footer are always dusk, in both colour modes. Only the reading column follows `prefers-color-scheme`. Frame colours are fixed values, never the mode-switching variables.

**The Firefly Rule.** Amber means "you can go here" (or a count that is itself a link). Don't use it for decoration, headings or body emphasis.

**The Paired Value Rule.** Every reading-column colour ships as a dark/mist pair and both values must pass WCAG AA on their own ground. A new colour without its mist partner is incomplete.

## Typography

**Display Font:** Bricolage Grotesque, self-hosted woff2 as family "Display" (variable wght 500–800, opsz 72), with ui-sans-serif / system-ui fallback
**Body Font:** system sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`)
**Label/Mono Font:** system mono (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`)

**Character:** A chunky, slightly quirky grotesque for the voice of the journal, against an invisible system sans that gets out of the way for long lists.

### Hierarchy
- **Display** (700, clamp 1.75–3.25rem, 1, −0.025em): the site name over the artwork, balanced.
- **Headline** (700, clamp 1.6–2.35rem, 1.15, −0.02em): the page H1, "Week of …".
- **Title** (650, 1.3rem, 1.25, −0.01em): section h2s on the waterline; community entry names use the display face at 650, 1.02rem.
- **Count** (700, 1.75rem / 1.45rem on phones, tabular figures): the issue counts.
- **Body** (400, 16px, 1.6): summaries, capped at 68ch.
- **Label** (0.85–0.92rem): nav bar, contents line, count captions, versions, members, footer.
- **Mono** (600, 0.95rem, 1.4): extension names; versions at 0.8rem regular.

### Named Rules
**The Mono Is For Names Rule.** Mono is reserved for extension names, version strings and inline `code`. Podcast and feed titles use the display face instead.

**The Tabular Figures Rule.** Every number the reader compares (counts, section totals, dates) uses `font-variant-numeric: tabular-nums`.

## Layout

A single centred column (max 50rem, 1.25rem gutters; 1rem at ≤30rem). The banner is full-bleed above it at 5:2, max 34rem tall, cropped at 60% 70% toward the synth desk and campfire; at ≤30rem it is a fixed 12.5rem with a denser scrim so the site name and tagline stay legible (tagline ≥5.0:1, title ≥8.9:1 against the brightest 1% of art). The site name sits over the scrim's base; the nav bar follows on solid dusk.

Rhythm: main content opens 2.5rem below the masthead; h2 sections open 3rem apart (2.5rem on phones); list items are 0.8rem top/bottom with a hairline between, community entries 1rem/1.15rem, earlier-issue lists 0.45rem. Inline groups (nav bar, counts, contents line) are wrapping flex rows with column gaps of 1.2–1.6rem.

The footer opens with the shore: a strip of the artwork clamp 4.5–7.5rem tall, fading from the reading ground at top into dusk at the bottom.

## Elevation & Depth

Flat. No `box-shadow` anywhere. Depth comes only from the artwork itself and its two linear-gradient scrims (masthead: dusk rising from the base; shore: reading ground fading into dusk). Content separation is by hairline rules, never by raised surfaces.

### Named Rules
**The Art Is The Only Depth Rule.** Gradients exist only as scrims over the artwork and as the waterline. Don't add shadows, glows or tinted panels to the reading column.

## Shapes

Square. No container radii, no cards, no pills. Lines are 1px hairlines (`rule` colours) between list items and around the contents line, and the 2px waterline under h2s. The only rounding is the 2px corner on the focus outline. The only icon is a small inline SVG chevron on the previous-week link, stroke `currentColor`.

## Components

### Navigation (masthead bar and footer bar)
- **Style:** a wrapping row of plain amber links at 0.92rem, no underline at rest, underline on hover; 1px dusk-rule line beneath in the masthead, none in the footer.
- **Contents:** ← previous week (inline SVG chevron) · All issues · RSS · JSON.

### Issue counts
- **Style:** each count is a link: a display-face tabular figure in amber stacked over a muted caption; hover underlines the caption, not the figure.

### Contents line
- **Style:** a wrapping row of amber section links between two hairlines, muted ink, no underline at rest.

### Section heading on the waterline (signature)
- **Style:** display-face h2 with a 2px gradient underline painted as a background (violet → amber at 55% → sun). An optional count follows in a small violet tabular `small`.

### Entry list item
- **Style:** unstyled list, 0.8rem vertical padding, hairline between items, none after the last. Name in amber mono 600, version in muted mono 0.8rem, summary in body text (68ch max), members in muted 0.86rem; long names break anywhere.
- **Community variant:** names in the display face (650, 1.02rem), version line in system sans.

### Links and focus
- **Links:** amber, 1px underline offset 0.2em; hover thickens it to 2px.
- **Focus:** 2px solid amber outline, 3px offset, 2px radius.

## Do's and Don'ts

### Do:
- **Do** keep masthead and footer at dusk in both modes, using fixed frame colours, not the mode variables.
- **Do** ship every reading-column colour as a dark/mist pair that passes WCAG AA on its own ground.
- **Do** put all styling in the one shared `/site.css`; it restyles every back issue.
- **Do** use Bricolage Grotesque only for the site name, headings, community titles and counts; system sans for everything read.
- **Do** keep scrims over the artwork dense enough for the tagline to hold ≥5.0:1 against the brightest 1% of the art, including at 390px.

### Don't:
- **Don't** add scripts, inline styles or any off-site asset; the CSP forbids them.
- **Don't** rename asset files; published issues reference them.
- **Don't** add shadows, cards, rounded containers or tinted panels to the reading column.
- **Don't** add motion; the system has none by design.
- **Don't** use amber for anything that is not a link or a linked count.
- **Don't** make it neon-on-black or a plain changelog on white (the owner's anti-references).
