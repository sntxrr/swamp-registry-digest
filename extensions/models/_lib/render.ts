/**
 * Rendering: the dated issue page, the archive index, the RSS feed and the
 * Discord announcement.
 *
 * Every string that came from the registry is escaped. A description holding
 * `<script>` would otherwise run on the site, and one holding `@everyone`
 * would ping a server. Links point only at the registry page and, when the
 * registry verified it, the extension's repository.
 *
 * @module
 */

import { type Item, itemId, type Section, SECTION_ORDER } from "./digest.ts";
import type { FeedPost, PodcastEpisode } from "./community.ts";

export interface IssueMeta {
  slug: string;
  start: string;
  end: string;
  lastDay: string;
  generatedAt: string;
}

export interface SiteConfig {
  title: string;
  /** Public base URL of the site, no trailing slash. */
  siteUrl: string;
  registryUrl: string;
  disclaimer: string;
  theme?: SiteTheme;
}

/**
 * Optional site art, as paths relative to the site root (files the site
 * itself serves: the page CSP allows images and fonts from 'self' only).
 */
export interface SiteTheme {
  /** Masthead banner, wide (about 1600 px). */
  banner?: string;
  /** The same banner for narrow screens (about 800 px). */
  bannerSmall?: string;
  /** Intrinsic size of the banner, for layout without a reflow. */
  bannerWidth?: number;
  bannerHeight?: number;
  bannerAlt?: string;
  /** WOFF2 display face for the masthead and headings. */
  displayFont?: string;
}

const SITE_PATH_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

/** A site-relative asset path, or null when it is not a plain relative path. */
export function sitePath(p: string | undefined): string | null {
  return p && SITE_PATH_RE.test(p) && !p.includes("..") ? p : null;
}

export interface ArchiveEntry {
  slug: string;
  lastDay: string;
  counts: Record<Section, number>;
}

/** One community source as the renderer sees it. */
export interface CommunitySource<T> {
  /** Unconfigured sources are left out of the issue entirely. */
  configured: boolean;
  ok: boolean;
  error: string | null;
  items: T[];
}

export interface Community {
  podcast: CommunitySource<PodcastEpisode>;
  feed: CommunitySource<FeedPost>;
}

export const NO_COMMUNITY: Community = {
  podcast: { configured: false, ok: true, error: null, items: [] },
  feed: { configured: false, ok: true, error: null, items: [] },
};

export const SECTION_TITLES: Record<Section, string> = {
  new: "New extensions",
  updated: "Updated",
  prerelease: "Pre-releases (beta and RC)",
  yanked: "Yanked versions",
  removed: "Removed from the registry",
  minor: "Minor updates",
};

/**
 * How updates below the significance threshold appear:
 * `list` = names only, in one compact section; `count` = a single line with
 * the number; `drop` = not at all.
 */
export type MinorMode = "list" | "count" | "drop";

export interface RenderOptions {
  minorMode: MinorMode;
  /** The threshold, quoted in the minor section's explanation. */
  minChangedLines: number;
}

export const DEFAULT_RENDER: RenderOptions = {
  minorMode: "list",
  minChangedLines: 10,
};

function shown(items: Item[], o: RenderOptions): Item[] {
  return o.minorMode === "drop"
    ? items.filter((i) => i.section !== "minor")
    : items;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/** Only http(s) URLs survive; anything else (javascript:, data:) is dropped. */
function safeUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:"
      ? p.toString()
      : null;
  } catch {
    return null;
  }
}

export function registryLink(cfg: SiteConfig, name: string): string {
  return `${cfg.registryUrl.replace(/\/+$/, "")}/extensions/${name}`;
}

export function counts(items: Item[]): Record<Section, number> {
  const c = {
    new: 0,
    updated: 0,
    prerelease: 0,
    yanked: 0,
    removed: 0,
    minor: 0,
  };
  for (const i of items) c[i.section] += i.entries.length;
  return c;
}

/** "Oct 19 – Oct 25, 2026" from two local dates. */
export function dateRange(firstDay: string, lastDay: string): string {
  const fmt = (d: string, year: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return `${fmt(firstDay, false)} – ${fmt(lastDay, true)}`;
}

/**
 * Dusk on the bayou: the frame (masthead and footer) is always dusk, from
 * the banner art; the reading column follows the reader's colour scheme,
 * dusk or morning mist. Colours are sampled from the artwork.
 */
export function renderStylesheet(cfg: SiteConfig): string {
  const font = sitePath(cfg.theme?.displayFont);
  return `${
    font
      ? `@font-face{font-family:"Display";src:url("${font}") format("woff2");font-weight:500 800;font-display:swap}`
      : ""
  }
:root{color-scheme:light dark;
--dusk:#0b2a26;--dusk-ink:#e4ead8;--dusk-ink-2:#aebda4;--lantern:#fff1c4;
--ground:#eaf0ea;--ink:#0d2a25;--ink-2:#3d554f;--rule:#c4d2c8;
--firefly:#94470a;--bloom:#6a3a9c;
--water-a:#7b48b5;--water-b:#d9792b;--water-c:#e2b93b;
--display:"Display",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
--text:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{
--ground:#0b2a26;--ink:#e4ead8;--ink-2:#a9b89e;--rule:#22453e;
--firefly:#f0a63a;--bloom:#c193ef;
--water-a:#c193ef;--water-b:#f0a63a;--water-c:#fde36a}}
*{box-sizing:border-box}
html{background:var(--dusk);scrollbar-color:var(--firefly) var(--ground)}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 var(--text);-webkit-text-size-adjust:100%}
::selection{background:var(--bloom);color:var(--ground)}
a{color:var(--firefly);text-decoration-thickness:1px;text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--firefly);outline-offset:3px;border-radius:2px}
ul{list-style:none;padding:0;margin:0}
.wrap{max-width:50rem;margin:0 auto;padding:0 1.25rem}

.mast{background:var(--dusk);color:var(--dusk-ink)}
.mast a,footer a{color:#f0a63a}
.art{position:relative;margin:0;overflow:hidden;background:var(--dusk)}
.art img{display:block;width:100%;height:auto;aspect-ratio:5/2;max-height:34rem;min-height:12.5rem;object-fit:cover;object-position:60% 70%}
.art::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,var(--dusk) 0,rgb(11 42 38/.8) 13%,rgb(11 42 38/0) 42%)}
.title{position:absolute;z-index:1;left:0;right:0;bottom:0;padding-bottom:.9rem}
.mast.plain .title{position:static;padding:2.5rem 0 .5rem}
.site{font:700 clamp(1.75rem,5vw,3.25rem)/1 var(--display);letter-spacing:-.025em;margin:0;color:var(--lantern);text-wrap:balance}
.site a{color:inherit;text-decoration:none}
.tagline{margin:.4rem 0 0;color:var(--dusk-ink-2);font-size:.95rem}
.bar{display:flex;flex-wrap:wrap;gap:.35rem 1.4rem;padding:.75rem 0 1rem;font-size:.92rem;border-bottom:1px solid #22453e}
.bar a{text-decoration:none}.bar a:hover{text-decoration:underline}
main.wrap{padding-top:2.5rem;padding-bottom:3.5rem}
h1{font:700 clamp(1.6rem,4.2vw,2.35rem)/1.15 var(--display);letter-spacing:-.02em;margin:0;text-wrap:balance}
h2{font:650 1.3rem/1.25 var(--display);letter-spacing:-.01em;margin:3rem 0 .4rem;padding-bottom:.55rem;scroll-margin-top:1rem;
background:linear-gradient(90deg,var(--water-a),var(--water-b) 55%,var(--water-c)) no-repeat 0 100%/100% 2px}
h2 small{font:600 .9rem var(--text);color:var(--bloom);margin-left:.45rem;font-variant-numeric:tabular-nums}
.counts{display:flex;flex-wrap:wrap;gap:.4rem 1.6rem;margin:1.1rem 0 0;padding:0}
.counts a{color:var(--ink-2);font-size:.9rem;text-decoration:none}
.counts b{display:block;font:700 1.75rem/1.1 var(--display);color:var(--firefly);font-variant-numeric:tabular-nums}
.counts a:hover span{text-decoration:underline}
.toc{margin:1.25rem 0 0;padding:.7rem 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);font-size:.92rem;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:.3rem 1.25rem}
.toc a{text-decoration:none}.toc a:hover{text-decoration:underline}
.meta{font-size:.85rem;color:var(--bloom);font-variant-numeric:tabular-nums}
.arrow{width:.85em;height:.85em;vertical-align:-.08em;margin-right:.3em}
footer code,main code{font:.92em var(--mono)}
li{padding:.8rem 0;border-bottom:1px solid var(--rule)}li:last-child{border-bottom:0}
.name{font:600 .95rem/1.4 var(--mono);overflow-wrap:anywhere}
.ver{font:.8rem var(--mono);color:var(--ink-2)}
.ver a{color:var(--ink-2)}
.sum{margin:.3rem 0 0;max-width:68ch}
.members{color:var(--ink-2);font-size:.86rem;margin:.35rem 0 0;overflow-wrap:anywhere}
.community li{padding:1rem 0 1.15rem}.community li .name{font:650 1.02rem/1.35 var(--display);letter-spacing:-.005em}
.community .ver{font-family:var(--text);font-size:.85rem}
.empty{color:var(--ink-2)}
.earlier li{padding:.45rem 0}

footer{background:var(--dusk);color:var(--dusk-ink-2);font-size:.86rem;padding:0 0 2.5rem}
.shore{position:relative;margin:0 0 1.5rem;overflow:hidden}
.shore img{display:block;width:100%;height:clamp(4.5rem,9vw,7.5rem);object-fit:cover;object-position:62% 66%}
.shore-gap{height:1.75rem}
.shore::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,var(--ground) 0,rgb(11 42 38/0) 55%,var(--dusk) 100%)}
footer .bar{border:0;padding:0 0 1rem}
footer p{margin:0;max-width:68ch}
@media (max-width:30rem){.art img{aspect-ratio:auto;height:12.5rem}.art::after{background:linear-gradient(to top,var(--dusk) 0,rgb(11 42 38/.9) 38%,rgb(11 42 38/.35) 70%,rgb(11 42 38/0) 100%)}.wrap{padding:0 1rem}h2{margin-top:2.5rem}.counts{gap:.4rem 1.2rem}.counts b{font-size:1.45rem}}`;
}

/**
 * JSON for a `<script type="application/ld+json">` block. `<` is escaped so
 * no string can close the script element.
 */
export function jsonLd(o: unknown): string {
  return `<script type="application/ld+json">${
    JSON.stringify(o).replace(/</g, "\\u003c")
  }</script>\n`;
}

const issueUrl = (cfg: SiteConfig, slug: string, ext = "html") =>
  `${cfg.siteUrl}/issues/${slug}.${ext}`;

/** Archive entries before `slug`, newest first. */
function earlier(archive: ArchiveEntry[], slug: string): ArchiveEntry[] {
  return archive.filter((a) => a.slug < slug).sort((a, b) =>
    b.slug.localeCompare(a.slug)
  );
}

function renderCommunity(c: Community): string {
  const parts: string[] = [];
  const unavailable = (what: string) =>
    `<p class="empty">The ${what} could not be read this week.</p>`;
  if (c.podcast.configured) {
    const body = !c.podcast.ok
      ? unavailable("podcast")
      : c.podcast.items.length === 0
      ? `<p class="empty">No episode this week.</p>`
      : `<ul>${
        c.podcast.items.map((e) => {
          const video = safeUrl(e.videoUrl);
          return `<li><a class="name" href="${escapeHtml(e.url)}">${
            escapeHtml(e.title)
          }</a>${
            video
              ? ` <span class="ver">· <a href="${
                escapeHtml(video)
              }" rel="nofollow noopener">video</a></span>`
              : ""
          }${
            e.description
              ? `<p class="sum">${escapeHtml(e.description)}</p>`
              : ""
          }</li>`;
        }).join("\n")
      }</ul>`;
    parts.push(
      `<section class="community" id="podcast"><h2>Podcast</h2>${body}</section>`,
    );
  }
  if (c.feed.configured) {
    const body = !c.feed.ok
      ? unavailable("Swamp Club feed")
      : c.feed.items.length === 0
      ? `<p class="empty">No new posts this week.</p>`
      : `<ul>${
        c.feed.items.map((p) =>
          `<li><a class="name" href="${escapeHtml(p.url)}">${
            escapeHtml(p.title)
          }</a>${
            p.author
              ? ` <span class="ver">by ${escapeHtml(p.author)}</span>`
              : ""
          }${
            p.summary ? `<p class="sum">${escapeHtml(p.summary)}</p>` : ""
          }</li>`
        ).join("\n")
      }</ul>`;
    parts.push(
      `<section class="community" id="feed"><h2>From the Swamp Club feed</h2>${body}</section>`,
    );
  }
  return parts.join("\n");
}

/**
 * The masthead: the banner art with the site name set over its dusk scrim,
 * then the navigation bar. Without art it is a plain dusk band.
 */
function masthead(cfg: SiteConfig, root: string, nav: string): string {
  const t = cfg.theme ?? {};
  const big = sitePath(t.banner);
  const small = sitePath(t.bannerSmall);
  const name =
    `<div class="title"><div class="wrap"><p class="site"><a href="${root}index.html">${
      escapeHtml(cfg.title)
    }</a></p><p class="tagline">Each week in swamp: new and updated extensions, the podcast, and Swamp Club posts.</p></div></div>`;
  if (!big) {
    return `<header class="mast plain">${name}<div class="wrap"><nav class="bar" aria-label="Site">${nav}</nav></div></header>`;
  }
  const size = t.bannerWidth && t.bannerHeight
    ? ` width="${t.bannerWidth}" height="${t.bannerHeight}"`
    : "";
  const srcset = small
    ? ` srcset="${root}${small} 800w, ${root}${big} 1600w" sizes="100vw"`
    : "";
  return `<header class="mast"><figure class="art"><img src="${root}${big}"${srcset}${size} alt="${
    escapeHtml(t.bannerAlt ?? "")
  }" decoding="async" fetchpriority="high">${name}</figure><div class="wrap"><nav class="bar" aria-label="Site">${nav}</nav></div></header>`;
}

/** A low strip of the banner's waterline, closing the page. Same file, no new bytes. */
function shore(cfg: SiteConfig, root: string): string {
  const big = sitePath(cfg.theme?.banner);
  const small = sitePath(cfg.theme?.bannerSmall);
  const art = small ?? big;
  const srcset = small && big
    ? ` srcset="${root}${small} 800w, ${root}${big} 1600w" sizes="100vw"`
    : "";
  return art
    ? `<div class="shore" aria-hidden="true"><img src="${root}${art}"${srcset} alt="" decoding="async" loading="lazy"></div>`
    : `<div class="shore-gap"></div>`;
}

/** Escape, then set `backticked` spans as code. */
function withCode(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

const ARROW =
  `<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function page(
  cfg: SiteConfig,
  title: string,
  description: string,
  body: string,
  head = "",
  root = "./",
  nav = "",
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'">
<meta name="referrer" content="no-referrer">
<link rel="alternate" type="application/rss+xml" title="${
    escapeHtml(cfg.title)
  }" href="${escapeHtml(cfg.siteUrl)}/feed.xml">
${head}<link rel="stylesheet" href="${root}site.css">
</head>
<body>
${masthead(cfg, root, nav)}
<main class="wrap">
${body}
</main>
<footer>${
    shore(cfg, root)
  }<div class="wrap"><nav class="bar" aria-label="Site, again">${nav}</nav><p>${
    withCode(cfg.disclaimer)
  }</p></div></footer>
</body>
</html>
`;
}

function versionText(item: Item): string {
  if (item.collapsed) return "";
  const e = item.entries[0];
  if (item.section === "removed") {
    return e.fromVersion ? `was ${e.fromVersion}` : "";
  }
  if (item.section === "yanked") return e.toVersion ?? "";
  if (e.fromVersion && e.toVersion) return `${e.fromVersion} → ${e.toVersion}`;
  return e.toVersion ?? "";
}

function renderItem(
  cfg: SiteConfig,
  item: Item,
  summaries: Record<string, string>,
): string {
  const summary = summaries[itemId(item)] ?? "";
  const e = item.entries[0];
  const name = item.collapsed
    ? `<span class="name">${
      escapeHtml(item.key)
    }</span> — ${item.entries.length} packages`
    : item.section === "removed"
    ? `<span class="name">${escapeHtml(e.name)}</span>`
    : `<a class="name" href="${escapeHtml(registryLink(cfg, e.name))}">${
      escapeHtml(e.name)
    }</a>`;
  const ver = versionText(item);
  const repo = !item.collapsed && e.repositoryVerified
    ? safeUrl(e.repository)
    : null;
  const extra: string[] = [];
  if (repo) {
    extra.push(
      `<a href="${escapeHtml(repo)}" rel="nofollow noopener">source</a>`,
    );
  }
  if (item.section === "yanked" || item.section === "removed") {
    if (e.reason) extra.push(`reason: ${escapeHtml(e.reason.slice(0, 200))}`);
  }
  const members = item.collapsed
    ? `<p class="members">${
      item.entries.map((m) =>
        `<a href="${escapeHtml(registryLink(cfg, m.name))}">${
          escapeHtml(m.name.slice(item.key.length + 1))
        }</a>`
      ).join(", ")
    }</p>`
    : "";
  return `<li>${name}${
    ver ? ` <span class="ver">${escapeHtml(ver)}</span>` : ""
  }${extra.length ? ` <span class="ver">· ${extra.join(" · ")}</span>` : ""}${
    summary ? `<p class="sum">${escapeHtml(summary)}</p>` : ""
  }${members}</li>`;
}

/** "Pre-releases (beta and RC)" → "pre-releases (beta and RC)". */
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function countChips(c: Record<Section, number>): string {
  return `<p class="counts">${
    SECTION_ORDER.filter((s) => c[s] > 0).map((s) =>
      `<a href="#${s}"><b>${c[s]}</b> <span>${
        escapeHtml(lowerFirst(SECTION_TITLES[s]))
      }</span></a>`
    )
      .join("")
  }</p>`;
}

/** The minor section: never summaries, only names (list) or a number (count). */
function renderMinor(cfg: SiteConfig, its: Item[], o: RenderOptions): string {
  const n = its.reduce((x, i) => x + i.entries.length, 0);
  const why =
    `Version bumps and changes under ${o.minChangedLines} lines of code, with no API change.`;
  if (o.minorMode === "count") {
    return `<section id="minor"><h2>${
      escapeHtml(SECTION_TITLES.minor)
    }</h2><p class="empty">${n} ${
      n === 1 ? "extension" : "extensions"
    } published minor updates. ${escapeHtml(why)}</p></section>`;
  }
  const names = its.map((i) =>
    i.collapsed
      ? `<span class="name">${escapeHtml(i.key)}</span> (${i.entries.length})`
      : `<a href="${escapeHtml(registryLink(cfg, i.key))}">${
        escapeHtml(i.key)
      }</a>`
  ).join(", ");
  return `<section id="minor"><h2>${
    escapeHtml(SECTION_TITLES.minor)
  } <small>${n}</small></h2><p class="members">${
    escapeHtml(why)
  }</p><p class="sum">${names}</p></section>`;
}

export function renderIssue(
  cfg: SiteConfig,
  meta: IssueMeta,
  allItems: Item[],
  summaries: Record<string, string>,
  o: RenderOptions = DEFAULT_RENDER,
  archive: ArchiveEntry[] = [],
  community: Community = NO_COMMUNITY,
): string {
  const items = shown(allItems, o);
  const range = dateRange(meta.slug, meta.lastDay);
  const c = counts(items);
  const sections = SECTION_ORDER.map((s) => {
    const its = items.filter((i) => i.section === s);
    if (its.length === 0) return "";
    if (s === "minor") return renderMinor(cfg, its, o);
    return `<section id="${s}"><h2>${escapeHtml(SECTION_TITLES[s])} <small>${
      its.reduce((x, i) => x + i.entries.length, 0)
    }</small></h2><ul>${
      its.map((i) => renderItem(cfg, i, summaries)).join("\n")
    }</ul></section>`;
  }).join("\n");
  const before = earlier(archive, meta.slug);
  const prev = before[0];
  const nav = `${
    prev
      ? `<a rel="prev" href="./${escapeHtml(prev.slug)}.html">${ARROW}Week of ${
        escapeHtml(dateRange(prev.slug, prev.lastDay))
      }</a>`
      : ""
  }<a href="../index.html#issues">All issues</a><a href="../feed.xml">RSS</a><a href="./${
    escapeHtml(meta.slug)
  }.json">JSON</a>`;
  // Community sections get plain links; registry sections are reached from
  // their counts above.
  const toc: string[] = [];
  if (community.podcast.configured) {
    toc.push(`<a href="#podcast">Podcast</a>`);
  }
  if (community.feed.configured) {
    toc.push(
      `<a href="#feed">From the Swamp Club feed${
        community.feed.items.length ? ` (${community.feed.items.length})` : ""
      }</a>`,
    );
  }
  const contents = toc.length
    ? `<nav class="toc" aria-label="This week in Swamp Club">${
      toc.join("")
    }</nav>`
    : "";
  const recent = before.slice(0, 8);
  const earlierList = recent.length
    ? `<section class="earlier"><h2>Earlier issues</h2><ul>${
      recent.map((a) =>
        `<li><a href="./${escapeHtml(a.slug)}.html">Week of ${
          escapeHtml(dateRange(a.slug, a.lastDay))
        }</a></li>`
      ).join("\n")
    }</ul></section>`
    : "";
  const body = `<h1>Week of ${escapeHtml(range)}</h1>
${items.length ? countChips(c) : ""}
${contents}
${renderCommunity(community)}
${items.length ? sections : `<p class="empty">Nothing new this week.</p>`}
${earlierList}`;
  const head = `<link rel="alternate" type="application/json" href="${
    escapeHtml(issueUrl(cfg, meta.slug, "json"))
  }">
${
    prev
      ? `<link rel="prev" href="${escapeHtml(issueUrl(cfg, prev.slug))}">\n`
      : ""
  }${
    jsonLd({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: `${cfg.title}: week of ${range}`,
      datePublished: meta.generatedAt,
      url: issueUrl(cfg, meta.slug),
      isPartOf: { "@type": "Periodical", name: cfg.title, url: cfg.siteUrl },
      about: "Changes in the swamp extension registry",
      encoding: {
        "@type": "MediaObject",
        encodingFormat: "application/json",
        contentUrl: issueUrl(cfg, meta.slug, "json"),
      },
    })
  }`;
  return page(
    cfg,
    `${cfg.title}: ${range}`,
    `Swamp extensions, podcast and Swamp Club posts, ${range}`,
    body,
    head,
    "../",
    nav,
  );
}

export function renderIndex(cfg: SiteConfig, archive: ArchiveEntry[]): string {
  const rows = [...archive].sort((a, b) => b.slug.localeCompare(a.slug)).map(
    (a) => {
      // Minor updates are not "changes" a reader would count.
      const total = Object.entries(a.counts).filter(([s]) => s !== "minor")
        .reduce((x, [, y]) => x + y, 0);
      return `<li><a href="./issues/${escapeHtml(a.slug)}.html">Week of ${
        escapeHtml(dateRange(a.slug, a.lastDay))
      }</a> <span class="meta">${total} changes</span></li>`;
    },
  ).join("\n");
  const body = `<h1>All issues</h1>
<p class="sum">A weekly digest of the swamp extension registry: new extensions, updates, pre-releases, yanks and removals, each with a short machine-written summary of the change, plus the week's Swamp Club podcast episode and feed posts.</p>
<section id="issues"><h2>Every week</h2><ul>${
    rows || `<li class="empty">No issues yet.</li>`
  }</ul></section>`;
  return page(
    cfg,
    cfg.title,
    "A weekly digest of swamp: new and updated extensions, the podcast, and Swamp Club posts",
    body,
    `<link rel="alternate" type="application/json" href="${
      escapeHtml(cfg.siteUrl)
    }/index.json">\n`,
    "./",
    `<a href="./feed.xml">RSS</a><a href="./index.json">JSON</a><a href="./llms.txt">llms.txt</a>`,
  );
}

export function renderFeed(cfg: SiteConfig, archive: ArchiveEntry[]): string {
  const x = (s: string) => escapeHtml(s);
  const items = [...archive].sort((a, b) => b.slug.localeCompare(a.slug)).slice(
    0,
    20,
  ).map((a) => {
    const url = `${cfg.siteUrl}/issues/${a.slug}.html`;
    const parts = SECTION_ORDER.filter((s) => a.counts[s] > 0).map((s) =>
      `${a.counts[s]} ${SECTION_TITLES[s].toLowerCase()}`
    );
    return `<item><title>${
      x(`Week of ${dateRange(a.slug, a.lastDay)}`)
    }</title><link>${x(url)}</link><guid>${x(url)}</guid><pubDate>${
      new Date(`${a.lastDay}T23:59:59Z`).toUTCString()
    }</pubDate><description>${
      x(parts.join(", ") || "Nothing new")
    }</description></item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>${x(cfg.title)}</title><link>${
    x(cfg.siteUrl)
  }/</link><description>A weekly digest of the swamp extension registry</description>
${items}
</channel></rss>
`;
}

/**
 * Escape Discord markdown so a name can never format, spoil or link. Only the
 * characters that act mid-line; lines never start with registry text, so
 * `#`, `-` and `>` headings, lists and quotes cannot trigger.
 */
export function escapeDiscord(s: string): string {
  return s.replace(/([\\*_~`|\[\]])/g, "\\$1");
}

/**
 * New extensions as Discord lines, grouping a collective with `threshold` or
 * more new names into one line ("`@reset`: 45 new"), the same way families
 * collapse on the page.
 */
function newLines(items: Item[], threshold = 3): string[] {
  const byCollective = new Map<string, number>();
  for (const i of items) {
    const c = i.key.split("/")[0];
    byCollective.set(c, (byCollective.get(c) ?? 0) + i.entries.length);
  }
  const out: string[] = [];
  const done = new Set<string>();
  for (const i of items) {
    const c = i.key.split("/")[0];
    const n = byCollective.get(c)!;
    if (n >= threshold) {
      if (!done.has(c)) out.push(`${c}: ${n} new`);
      done.add(c);
    } else {
      out.push(i.collapsed ? `${i.key} (${i.entries.length} packages)` : i.key);
    }
  }
  return out;
}

export interface DiscordPayload {
  content: string;
  allowed_mentions: { parse: never[] };
  flags: number;
}

/**
 * The announcement: counts, the new extensions by name, and the link.
 * Summaries stay on the page; Discord gets the headline. `flags: 4`
 * suppresses link embeds, and `allowed_mentions` with an empty `parse` means
 * no text in the message can ping anyone.
 */
export function renderDiscord(
  cfg: SiteConfig,
  meta: IssueMeta,
  allItems: Item[],
  maxChars = 1900,
  o: RenderOptions = DEFAULT_RENDER,
  community: Community = NO_COMMUNITY,
): DiscordPayload {
  const items = shown(allItems, o);
  const url = `${cfg.siteUrl}/issues/${meta.slug}.html`;
  const range = dateRange(meta.slug, meta.lastDay);
  const c = counts(items);
  const head = `**${escapeDiscord(cfg.title)}: week of ${
    escapeDiscord(range)
  }**`;
  // One line per episode. The title is third-party: escaped and capped; the
  // URL was pinned to the podcast's own site by the reader, and angle
  // brackets keep Discord from embedding it.
  const podcast = community.podcast.ok
    ? community.podcast.items.flatMap((e) => {
      const u = safeUrl(e.url);
      return u
        ? [`\nPodcast: ${escapeDiscord(e.title.slice(0, 120))} <${u}>`]
        : [];
    }).join("")
    : "";
  if (items.length === 0) {
    return {
      content: `${head}\nNothing new this week.${podcast}\n<${url}>`,
      allowed_mentions: { parse: [] },
      flags: 4,
    };
  }
  // The headline counts real changes; minor updates trail in brackets.
  const line = SECTION_ORDER.filter((s) => s !== "minor" && c[s] > 0).map((
    s,
  ) => `${c[s]} ${SECTION_TITLES[s].toLowerCase()}`).join(" · ") +
    (c.minor > 0 ? ` (+${c.minor} minor)` : "");
  const tail = `\nFull issue: <${url}>`;
  let body = `${head}\n${escapeDiscord(line)}${podcast}`;
  const fresh = newLines(items.filter((i) => i.section === "new"));
  if (fresh.length) {
    body += "\n\n**New**";
    let shown = 0;
    for (const l of fresh) {
      const next = `\n• ${escapeDiscord(l)}`;
      const more = `\n…and ${fresh.length - shown} more`;
      if (body.length + next.length + more.length + tail.length > maxChars) {
        body += more;
        break;
      }
      body += next;
      shown++;
    }
  }
  return { content: body + tail, allowed_mentions: { parse: [] }, flags: 4 };
}

// --- machine-readable copies ------------------------------------------------
//
// The same issue for agents and scripts: one JSON document per issue, a JSON
// index, an llms.txt (https://llmstxt.org) pointing at both, and a sitemap.
// They carry exactly what the HTML shows, so they are no more trusted than
// it is: summaries are machine-written and community text is third-party.

export const JSON_SCHEMA_VERSION = 1;

export function renderIssueJson(
  cfg: SiteConfig,
  meta: IssueMeta,
  allItems: Item[],
  summaries: Record<string, string>,
  o: RenderOptions = DEFAULT_RENDER,
  archive: ArchiveEntry[] = [],
  community: Community = NO_COMMUNITY,
): string {
  const items = shown(allItems, o);
  const prev = earlier(archive, meta.slug)[0];
  const source = <T>(s: CommunitySource<T>) =>
    s.configured ? { available: s.ok, items: s.ok ? s.items : [] } : undefined;
  const doc = {
    schemaVersion: JSON_SCHEMA_VERSION,
    title: `${cfg.title}: week of ${dateRange(meta.slug, meta.lastDay)}`,
    slug: meta.slug,
    url: issueUrl(cfg, meta.slug),
    window: {
      start: meta.start,
      end: meta.end,
      firstDay: meta.slug,
      lastDay: meta.lastDay,
    },
    generatedAt: meta.generatedAt,
    previous: prev
      ? { slug: prev.slug, url: issueUrl(cfg, prev.slug, "json") }
      : null,
    counts: counts(items),
    disclaimer: cfg.disclaimer,
    sections: SECTION_ORDER.flatMap((s) => {
      const its = items.filter((i) => i.section === s);
      if (its.length === 0) return [];
      const minorCountOnly = s === "minor" && o.minorMode === "count";
      return [{
        section: s,
        title: SECTION_TITLES[s],
        count: its.reduce((x, i) => x + i.entries.length, 0),
        items: minorCountOnly ? [] : its.map((i) => {
          const e = i.entries[0];
          const repo = !i.collapsed && e.repositoryVerified
            ? safeUrl(e.repository)
            : null;
          return {
            name: i.key,
            family: i.collapsed,
            fromVersion: i.collapsed ? null : e.fromVersion,
            toVersion: i.collapsed ? null : e.toVersion,
            summary: s === "minor" ? null : summaries[itemId(i)] ?? null,
            registryUrl: s === "removed" || i.collapsed
              ? null
              : registryLink(cfg, e.name),
            repository: repo,
            members: i.collapsed
              ? i.entries.map((m) => ({
                name: m.name,
                registryUrl: registryLink(cfg, m.name),
              }))
              : undefined,
          };
        }),
      }];
    }),
    podcast: source(community.podcast),
    feed: source(community.feed),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

export function renderIndexJson(
  cfg: SiteConfig,
  archive: ArchiveEntry[],
): string {
  return JSON.stringify(
    {
      schemaVersion: JSON_SCHEMA_VERSION,
      title: cfg.title,
      url: `${cfg.siteUrl}/`,
      feed: `${cfg.siteUrl}/feed.xml`,
      issues: [...archive].sort((a, b) => b.slug.localeCompare(a.slug)).map(
        (a) => ({
          slug: a.slug,
          firstDay: a.slug,
          lastDay: a.lastDay,
          url: issueUrl(cfg, a.slug),
          json: issueUrl(cfg, a.slug, "json"),
          counts: a.counts,
        }),
      ),
    },
    null,
    2,
  ) + "\n";
}

/** llms.txt: what the site is and where the machine-readable copies live. */
export function renderLlmsTxt(
  cfg: SiteConfig,
  archive: ArchiveEntry[],
): string {
  const issues = [...archive].sort((a, b) => b.slug.localeCompare(a.slug));
  const line = (a: ArchiveEntry) =>
    `- [Week of ${dateRange(a.slug, a.lastDay)}](${
      issueUrl(cfg, a.slug, "json")
    }): JSON; HTML at ${issueUrl(cfg, a.slug)}`;
  return `# ${cfg.title}

> A weekly digest of the swamp extension registry: new extensions, updates, pre-releases, yanks and removals, with a short machine-written summary of each change, plus the week's Swamp Club podcast episode and feed posts.

Each issue covers Monday to Sunday and is published the following Monday. Every issue has an HTML page and a JSON copy with the same content (\`issues/<first-day>.html\` and \`.json\`). The JSON index lists every issue, newest first.

${cfg.disclaimer}

## Issues

- [Index of all issues](${cfg.siteUrl}/index.json): JSON, newest first
${issues.slice(0, 12).map(line).join("\n")}

## Optional

- [RSS feed](${cfg.siteUrl}/feed.xml)
- [swamp extension registry](${
    cfg.registryUrl.replace(/\/+$/, "")
  }/extensions): the authoritative source for every extension
`;
}

export function renderRobots(cfg: SiteConfig): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`;
}

export function renderSitemap(
  cfg: SiteConfig,
  archive: ArchiveEntry[],
): string {
  const x = (s: string) => escapeHtml(s);
  const urls = [
    `${cfg.siteUrl}/`,
    ...[...archive].sort((a, b) => b.slug.localeCompare(a.slug)).map((a) =>
      issueUrl(cfg, a.slug)
    ),
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${x(u)}</loc></url>`).join("\n")}
</urlset>
`;
}
