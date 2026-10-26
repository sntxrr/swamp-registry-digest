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

export const SECTION_TITLES: Record<Section, string> = {
  new: "New extensions",
  updated: "Updated",
  prerelease: "Pre-releases (beta and RC)",
  yanked: "Yanked versions",
  removed: "Removed from the registry",
};

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
  const c = { new: 0, updated: 0, prerelease: 0, yanked: 0, removed: 0 };
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
.empty{color:var(--muted)}`;

function page(
  cfg: SiteConfig,
  title: string,
  description: string,
  body: string,
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
<style>${STYLE}</style>
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

export function renderIssue(
  cfg: SiteConfig,
  meta: IssueMeta,
  items: Item[],
  summaries: Record<string, string>,
): string {
  const range = dateRange(meta.slug, meta.lastDay);
  const c = counts(items);
  const sections = SECTION_ORDER.map((s) => {
    const its = items.filter((i) => i.section === s);
    if (its.length === 0) return "";
    return `<section><h2>${escapeHtml(SECTION_TITLES[s])}</h2><ul>${
      its.map((i) => renderItem(cfg, i, summaries)).join("\n")
    }</ul></section>`;
  }).join("\n");
  const body = `<header><p><a href="./../index.html">${
    escapeHtml(cfg.title)
  }</a></p>
<h1>Week of ${escapeHtml(range)}</h1>
${items.length ? countChips(c) : ""}</header>
${items.length ? sections : `<p class="empty">Nothing new this week.</p>`}`;
  return page(
    cfg,
    `${cfg.title}: ${range}`,
    `swamp registry changes, ${range}`,
    body,
  );
}

export function renderIndex(cfg: SiteConfig, archive: ArchiveEntry[]): string {
  const rows = [...archive].sort((a, b) => b.slug.localeCompare(a.slug)).map(
    (a) => {
      const total = Object.values(a.counts).reduce((x, y) => x + y, 0);
      return `<li><a href="./issues/${escapeHtml(a.slug)}.html">Week of ${
        escapeHtml(dateRange(a.slug, a.lastDay))
      }</a> <span class="ver">${total} changes</span></li>`;
    },
  ).join("\n");
  const body = `<header><h1>${escapeHtml(cfg.title)}</h1>
<p>A weekly digest of new and updated extensions in the swamp registry. <a href="./feed.xml">RSS</a></p></header>
<section><h2>Issues</h2><ul>${
    rows || `<li class="empty">No issues yet.</li>`
  }</ul></section>`;
  return page(
    cfg,
    cfg.title,
    "A weekly digest of the swamp extension registry",
    body,
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
  items: Item[],
  maxChars = 1900,
): DiscordPayload {
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
  const line = SECTION_ORDER.filter((s) => c[s] > 0).map((s) =>
    `${c[s]} ${SECTION_TITLES[s].toLowerCase()}`
  ).join(" · ");
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
