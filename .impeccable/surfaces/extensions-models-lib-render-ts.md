---
version: 1
slug: "extensions-models-lib-render-ts"
primary_target: "extensions/models/_lib/render.ts"
related_targets: []
---

## Scope

The Last Week in Swamp Club site: issue pages and the index, rendered by `extensions/models/_lib/render.ts`. Mode: **Read**. Build path: code-led (Read surface).

## Audience and job

Swamp Club members from the Discord link scanning a week of registry changes in minutes; authors checking their entry; agents use the JSON copies. Constraints: CSP with no scripts, assets only from the site, light and dark, fast on a phone. Owner guardrails: not hard to scan, not generic neon, not heavy, not timid.

## Direction contract

THESIS: A field journal kept at dusk on the bayou. The owner's artwork owns the frame, a dusk masthead in every colour mode, and the reading column stays calm. It refuses the category default of a plain changelog list on white, and it refuses neon-on-black.

OWN-WORLD: Ground is bayou teal sampled from the sky (#0b2a26). Firefly amber, sampled at #e89b2e and shipped as #f0a63a dark / #94470a light for contrast, marks links and the counts. Violet bloom, sampled at #9951c9 and shipped as #c193ef dark / #6a3a9c light, marks section counts and meta figures. Section openers sit on a waterline rule that runs violet → amber → sun gold like the sunset on water. Display type is Bricolage Grotesque, self-hosted. Text and code are set in the system sans and mono. Light mode is "morning mist", a pale mist ground with bayou-teal ink; the masthead stays at dusk in both modes.

STORY: The reader sees the week, its counts and a contents line. They jump to the podcast, the feed posts and the new extensions, scan names and summaries, and click through to the registry. They leave by previous week or all issues.

FIRST VIEWPORT: A full-bleed banner, the artwork at 5:2 on desktop (max 34rem tall, cropped toward the synth desk and campfire band), with a dusk scrim at its base. On phones (≤30rem) the banner is a fixed 12.5rem with a denser scrim, which is shorter than 5:2: the site name and tagline must stay legible over the art at 390px (measured: tagline ≥5.0:1 and title ≥8.9:1 against the brightest 1% of the art behind them). The site name and nav (previous week with a drawn chevron · All issues · RSS · JSON) are set over the scrim. Below it come the H1 "Week of …", the counts in Bricolage tabular figures, and the contents line linking every section.

FORM: Pinned by the brief: the owner's artwork. Seed: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
