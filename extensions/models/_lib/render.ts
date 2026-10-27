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

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1d1f1c;--muted:#5d625a;--rule:#dcdad2;--accent:#2f6b4f;--chip:#eef0ea}
@media (prefers-color-scheme:dark){:root{--bg:#141613;--fg:#e6e8e2;--muted:#9ba196;--rule:#2c302a;--accent:#7cc39c;--chip:#1f231e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1rem 4rem}
header p{color:var(--muted);margin:.25rem 0 0}h1{font-size:1.75rem;margin:0;letter-spacing:-.01em}
h2{font-size:1.1rem;margin:2.25rem 0 .5rem;padding-bottom:.35rem;border-bottom:1px solid var(--rule)}
a{color:var(--accent)}ul{list-style:none;padding:0;margin:0}
li{padding:.7rem 0;border-bottom:1px solid var(--rule)}li:last-child{border-bottom:0}
.name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92rem;font-weight:600;overflow-wrap:anywhere}
.ver{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;color:var(--muted)}
.sum{margin:.25rem 0 0}.members{color:var(--muted);font-size:.85rem;margin:.3rem 0 0;overflow-wrap:anywhere}
.counts{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0 0;padding:0}
.counts span{background:var(--chip);border-radius:999px;padding:.15rem .65rem;font-size:.85rem}
footer{margin-top:3rem;color:var(--muted);font-size:.85rem;border-top:1px solid var(--rule);padding-top:1rem}
.empty{color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.9rem;margin:0 0 1.5rem}
.earlier li{padding:.35rem 0}`;

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
    parts.push(`<section><h2>Podcast</h2>${body}</section>`);
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
    parts.push(`<section><h2>From the Swamp Club feed</h2>${body}</section>`);
  }
  return parts.join("\n");
}

function page(
  cfg: SiteConfig,
  title: string,
  description: string,
  body: string,
  head = "",
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'">
<meta name="referrer" content="no-referrer">
<link rel="alternate" type="application/rss+xml" title="${
    escapeHtml(cfg.title)
  }" href="${escapeHtml(cfg.siteUrl)}/feed.xml">
${head}<style>${STYLE}</style>
</head>
<body><main>
${body}
<footer><p>${escapeHtml(cfg.disclaimer)}</p></footer>
</main></body>
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

function countChips(c: Record<Section, number>): string {
  return `<p class="counts">${
    SECTION_ORDER.filter((s) => c[s] > 0).map((s) =>
      `<span>${c[s]} ${escapeHtml(SECTION_TITLES[s].toLowerCase())}</span>`
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
    return `<section><h2>${
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
  return `<section><h2>${
    escapeHtml(SECTION_TITLES.minor)
  } (${n})</h2><p class="members">${
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
    return `<section><h2>${escapeHtml(SECTION_TITLES[s])}</h2><ul>${
      its.map((i) => renderItem(cfg, i, summaries)).join("\n")
    }</ul></section>`;
  }).join("\n");
  const before = earlier(archive, meta.slug);
  const prev = before[0];
  const nav = `<nav aria-label="Issues"><a href="../index.html">${
    escapeHtml(cfg.title)
  }</a>${
    prev
      ? `<a rel="prev" href="./${escapeHtml(prev.slug)}.html">← Week of ${
        escapeHtml(dateRange(prev.slug, prev.lastDay))
      }</a>`
      : ""
  }<a href="../index.html#issues">All issues</a><a href="./${
    escapeHtml(meta.slug)
  }.json">JSON</a></nav>`;
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
  const body = `${nav}<header>
<h1>Week of ${escapeHtml(range)}</h1>
${items.length ? countChips(c) : ""}</header>
${items.length ? sections : `<p class="empty">Nothing new this week.</p>`}
${renderCommunity(community)}
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
    `swamp registry changes, ${range}`,
    body,
    head,
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
      }</a> <span class="ver">${total} changes</span></li>`;
    },
  ).join("\n");
  const body = `<header><h1>${escapeHtml(cfg.title)}</h1>
<p>A weekly digest of new and updated extensions in the swamp registry. <a href="./feed.xml">RSS</a> · <a href="./index.json">JSON</a> · <a href="./llms.txt">llms.txt</a></p></header>
<section id="issues"><h2>Issues</h2><ul>${
    rows || `<li class="empty">No issues yet.</li>`
  }</ul></section>`;
  return page(
    cfg,
    cfg.title,
    "A weekly digest of the swamp extension registry",
    body,
    `<link rel="alternate" type="application/json" href="${
      escapeHtml(cfg.siteUrl)
    }/index.json">\n`,
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
): DiscordPayload {
  const items = shown(allItems, o);
  const url = `${cfg.siteUrl}/issues/${meta.slug}.html`;
  const range = dateRange(meta.slug, meta.lastDay);
  const c = counts(items);
  const head = `**${escapeDiscord(cfg.title)}: week of ${
    escapeDiscord(range)
  }**`;
  if (items.length === 0) {
    return {
      content: `${head}\nNothing new this week.\n<${url}>`,
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
  let body = `${head}\n${escapeDiscord(line)}`;
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
