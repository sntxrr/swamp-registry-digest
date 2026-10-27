/**
 * Community content for an issue: the week's posts from a community RSS feed
 * and the week's podcast episode.
 *
 * Both are third-party text. Nothing here reaches the summarizer: titles and
 * descriptions are length-capped, stripped of control characters and shown
 * as written (escaped by the renderer). URLs are rebuilt from what was
 * validated, never passed through: a post must link back to the feed's own
 * site, a video must be a YouTube video id.
 *
 * Swamp Club publishes no API for either, so the podcast is read from the
 * sitemap (`/podcast/YYYY-MM-DD` pages) and each episode page's schema.org
 * `PodcastEpisode` JSON-LD. Both sources are optional and fail per section:
 * the caller records the error and the issue says the section is
 * unavailable, rather than holding back the registry digest.
 *
 * @module
 */

import { XMLParser } from "npm:fast-xml-parser@5.11.2";

export interface FeedPost {
  title: string;
  /** Permalink on the feed's own site. */
  url: string;
  author: string;
  publishedAt: string;
  summary: string;
}

export interface PodcastEpisode {
  title: string;
  episodeNumber: number | null;
  /** YYYY-MM-DD, as dated by the publisher. */
  date: string;
  url: string;
  description: string;
  /** https://www.youtube.com/watch?v=<id>, when the page has one. */
  videoUrl: string | null;
}

export interface Window {
  /** ISO instants: start inclusive, end exclusive. */
  start: string;
  end: string;
  /** Local calendar days, inclusive. */
  firstDay: string;
  lastDay: string;
}

export const USER_AGENT =
  "registry-digest (+https://github.com/sntxrr/swamp-registry-digest)";
const MAX_BYTES = 2 * 1024 * 1024;

type Fetch = typeof fetch;

/** Collapse whitespace, drop control characters, cap the length. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // deno-lint-ignore no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(
    /\s+/g,
    " ",
  ).trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

async function getText(
  url: string,
  fetchFn: Fetch,
  accept: string,
): Promise<string> {
  const res = await fetchFn(url, {
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GET ${url}: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw new Error(`GET ${url}: more than ${MAX_BYTES} bytes`);
  }
  return text;
}

/** An https URL on `origin`, or null. Query and fragment are dropped. */
function sameSite(u: unknown, origin: string): string | null {
  if (typeof u !== "string") return null;
  try {
    const p = new URL(u);
    if (p.protocol !== "https:" || p.origin !== origin) return null;
    return `${p.origin}${p.pathname}`;
  } catch {
    return null;
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === "item" || name === "url",
  processEntities: true,
  htmlEntities: true,
});

/** Posts published in [start, end), oldest first. */
export function parseFeed(xml: string, feedUrl: string, w: Window): FeedPost[] {
  const origin = new URL(feedUrl).origin;
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item;
  if (!Array.isArray(items)) throw new Error("feed has no rss/channel/item");
  const lo = Date.parse(w.start);
  const hi = Date.parse(w.end);
  const out: FeedPost[] = [];
  for (const i of items) {
    const t = Date.parse(String(i?.pubDate ?? ""));
    if (!Number.isFinite(t) || t < lo || t >= hi) continue;
    // The guid is the post's permalink on the feed's site; `link` may be a
    // click-through redirect.
    const url = sameSite(i.guid, origin) ?? sameSite(i.link, origin);
    const title = cleanText(i.title, 200);
    if (!url || !title) continue;
    out.push({
      title,
      url,
      author: cleanText(i["dc:creator"], 60),
      publishedAt: new Date(t).toISOString(),
      summary: cleanText(i.description, 400),
    });
  }
  return out.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

export async function fetchFeed(
  feedUrl: string,
  w: Window,
  fetchFn: Fetch = fetch,
): Promise<FeedPost[]> {
  return parseFeed(
    await getText(
      feedUrl,
      fetchFn,
      "application/rss+xml, application/xml;q=0.9",
    ),
    feedUrl,
    w,
  );
}

/** Episode page URLs from a sitemap whose date lies in the window. */
export function episodesInSitemap(xml: string, w: Window): string[] {
  const doc = parser.parse(xml);
  const urls = doc?.urlset?.url;
  if (!Array.isArray(urls)) throw new Error("sitemap has no urlset/url");
  const out: string[] = [];
  for (const u of urls) {
    const loc = typeof u?.loc === "string" ? u.loc : "";
    const m = loc.match(/\/podcast\/(\d{4}-\d{2}-\d{2})\/?$/);
    if (m && m[1] >= w.firstDay && m[1] <= w.lastDay) out.push(loc);
  }
  return out.sort();
}

const YOUTUBE_ID =
  /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{11})(?![\w-])/;

/** One episode page: its PodcastEpisode JSON-LD, description and video. */
export function parseEpisode(html: string, pageUrl: string): PodcastEpisode {
  const origin = new URL(pageUrl).origin;
  let ld: Record<string, unknown> | null = null;
  for (
    const m of html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )
  ) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.["@type"] === "PodcastEpisode") ld = j;
    } catch { /* another block */ }
  }
  if (!ld) throw new Error(`${pageUrl}: no PodcastEpisode JSON-LD`);
  const date = String(ld.datePublished ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${pageUrl}: datePublished is not a date`);
  }
  const og = (p: string) => {
    const m = html.match(
      new RegExp(`<meta[^>]*property="og:${p}"[^>]*content="([^"]*)"`),
    );
    return m ? m[1] : "";
  };
  const decode = (s: string) => {
    try {
      return String(parser.parse(`<x>${s}</x>`)?.x ?? "");
    } catch {
      return s;
    }
  };
  const series = (ld.partOfSeries as { name?: unknown } | undefined)?.name;
  const title = cleanText(decode(og("title")), 200) ||
    cleanText(
      [series, ld.name].filter((x) => typeof x === "string").join(": "),
      200,
    );
  const yt = html.match(YOUTUBE_ID);
  const n = Number(ld.episodeNumber);
  return {
    title,
    episodeNumber: Number.isInteger(n) && n > 0 ? n : null,
    date,
    url: sameSite(ld.url, origin) ?? sameSite(pageUrl, origin) ?? pageUrl,
    description: cleanText(decode(og("description")), 400),
    videoUrl: yt ? `https://www.youtube.com/watch?v=${yt[1]}` : null,
  };
}

export async function fetchPodcast(
  sitemapUrl: string,
  w: Window,
  fetchFn: Fetch = fetch,
): Promise<PodcastEpisode[]> {
  const pages = episodesInSitemap(
    await getText(sitemapUrl, fetchFn, "application/xml"),
    w,
  );
  const origin = new URL(sitemapUrl).origin;
  const out: PodcastEpisode[] = [];
  for (const p of pages) {
    // Only follow episode pages on the sitemap's own site.
    const url = sameSite(p, origin);
    if (!url) continue;
    out.push(parseEpisode(await getText(url, fetchFn, "text/html"), url));
  }
  return out;
}
