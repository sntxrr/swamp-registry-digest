// extensions/models/_lib/community_test.ts
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  cleanText,
  episodesInSitemap,
  fetchPodcast,
  parseEpisode,
  parseFeed,
} from "./community.ts";
import {
  type Community,
  NO_COMMUNITY,
  renderDiscord,
  renderIssue,
  renderIssueJson,
  renderLlmsTxt,
  type SiteConfig,
} from "./render.ts";

const W = {
  start: "2026-10-19T07:00:00Z",
  end: "2026-10-26T07:00:00Z",
  firstDay: "2026-10-19",
  lastDay: "2026-10-25",
};

const item = (o: Record<string, string>) =>
  `<item><title>${o.title ?? "A post"}</title><link>${
    o.link ?? "https://club.test/feed/p/1/go"
  }</link><guid isPermaLink="true">${
    o.guid ?? "https://club.test/feed/p/1"
  }</guid><dc:creator>${o.by ?? "someone"}</dc:creator><pubDate>${
    o.at ?? "Tue, 20 Oct 2026 12:00:00 GMT"
  }</pubDate><description>${o.desc ?? "About things."}</description></item>`;

const rss = (...items: string[]) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Feed</title>${
    items.join("")
  }</channel></rss>`;

Deno.test("feed: only posts inside the window, oldest first", () => {
  const posts = parseFeed(
    rss(
      item({
        title: "Late",
        guid: "https://club.test/feed/p/3",
        at: "Sat, 24 Oct 2026 10:00:00 GMT",
      }),
      item({
        title: "Edge end",
        guid: "https://club.test/feed/p/4",
        at: "Mon, 26 Oct 2026 07:00:00 GMT",
      }),
      item({
        title: "Early",
        guid: "https://club.test/feed/p/2",
        at: "Mon, 19 Oct 2026 07:00:00 GMT",
      }),
      item({
        title: "Before",
        guid: "https://club.test/feed/p/0",
        at: "Mon, 19 Oct 2026 06:59:59 GMT",
      }),
    ),
    "https://club.test/feed.xml",
    W,
  );
  assertEquals(posts.map((p) => p.title), ["Early", "Late"]);
  assertEquals(posts[0].url, "https://club.test/feed/p/2");
});

Deno.test("feed: links must stay on the feed's own site", () => {
  const posts = parseFeed(
    rss(
      item({
        title: "Offsite",
        guid: "https://evil.test/x",
        link: "https://evil.test/y",
      }),
      item({
        title: "JS",
        guid: "javascript:alert(1)",
        link: "javascript:alert(1)",
      }),
      item({
        title: "Plain http",
        guid: "http://club.test/feed/p/9",
        link: "http://club.test/feed/p/9",
      }),
      item({ title: "Tracked", guid: "https://club.test/feed/p/5?utm=1#x" }),
    ),
    "https://club.test/feed.xml",
    W,
  );
  assertEquals(posts.map((p) => [p.title, p.url]), [
    ["Tracked", "https://club.test/feed/p/5"],
  ]);
});

Deno.test("feed: text is decoded, cleaned and capped, never trusted as markup", () => {
  const [p] = parseFeed(
    rss(item({
      title: "&lt;script&gt;alert(1)&lt;/script&gt;\u0007 Hi",
      desc: "x".repeat(1000),
    })),
    "https://club.test/feed.xml",
    W,
  );
  assertEquals(p.title, "<script>alert(1)</script> Hi");
  assertEquals(p.summary.length, 400);
  assert(p.summary.endsWith("…"));
  assertEquals(cleanText(42, 10), "");
});

Deno.test("feed: a page that is not RSS is an error, not an empty week", () => {
  assertThrows(() => parseFeed("<html></html>", "https://club.test/f", W));
});

const sitemap = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    locs.map((l) => `<url><loc>${l}</loc></url>`).join("")
  }</urlset>`;

Deno.test("podcast: episodes dated in the week, by calendar day", () => {
  assertEquals(
    episodesInSitemap(
      sitemap(
        "https://club.test/podcast",
        "https://club.test/podcast/2026-10-12",
        "https://club.test/podcast/2026-10-19",
        "https://club.test/podcast/2026-10-25",
        "https://club.test/podcast/2026-10-26",
        "https://club.test/manual/podcast/2026-10-20/x",
      ),
      W,
    ),
    [
      "https://club.test/podcast/2026-10-19",
      "https://club.test/podcast/2026-10-25",
    ],
  );
});

const episodePage = (ld: unknown, extra = "") =>
  `<html><head><meta property="og:title" content="October 19th, 2026 &amp; friends"/>
<meta property="og:description" content="Episode 12 &#8212; the news."/>
<script type="application/ld+json">{"@type":"Organization","name":"Club"}</script>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body>${extra}<iframe src="https://www.youtube-nocookie.com/embed/3Rn4kq4N5Bw?rel=0"></iframe></body></html>`;

const LD = {
  "@type": "PodcastEpisode",
  name: "October 19th, 2026",
  episodeNumber: 12,
  datePublished: "2026-10-19",
  url: "https://club.test/podcast/2026-10-19",
  partOfSeries: { "@type": "PodcastSeries", name: "AI Frontiers" },
};

Deno.test("podcast: episode page read from its JSON-LD", () => {
  const e = parseEpisode(
    episodePage(LD),
    "https://club.test/podcast/2026-10-19",
  );
  assertEquals(e, {
    title: "October 19th, 2026 & friends",
    episodeNumber: 12,
    date: "2026-10-19",
    url: "https://club.test/podcast/2026-10-19",
    description: "Episode 12 — the news.",
    videoUrl: "https://www.youtube.com/watch?v=3Rn4kq4N5Bw",
  });
});

Deno.test("podcast: an off-site url in the JSON-LD is replaced by the page URL", () => {
  const e = parseEpisode(
    episodePage({ ...LD, url: "https://evil.test/ep" }),
    "https://club.test/podcast/2026-10-19",
  );
  assertEquals(e.url, "https://club.test/podcast/2026-10-19");
});

Deno.test("podcast: a page without PodcastEpisode JSON-LD is an error", () => {
  assertThrows(() =>
    parseEpisode(
      "<html><title>x</title></html>",
      "https://club.test/podcast/2026-10-19",
    )
  );
});

Deno.test("podcast: never follows an episode link to another site", async () => {
  const seen: string[] = [];
  const f: typeof fetch = (input) => {
    const u = String(input);
    seen.push(u);
    return Promise.resolve(
      new Response(
        u.endsWith("sitemap.xml")
          ? sitemap(
            "https://evil.test/podcast/2026-10-20",
            "https://club.test/podcast/2026-10-19",
          )
          : episodePage(LD),
      ),
    );
  };
  const eps = await fetchPodcast("https://club.test/sitemap.xml", W, f);
  assertEquals(eps.length, 1);
  assertEquals(seen, [
    "https://club.test/sitemap.xml",
    "https://club.test/podcast/2026-10-19",
  ]);
});

const CFG: SiteConfig = {
  title: "LWIS",
  siteUrl: "https://site.test",
  registryUrl: "https://registry.test",
  disclaimer: "Machine-written.",
};
const META = {
  slug: "2026-10-19",
  start: W.start,
  end: W.end,
  lastDay: "2026-10-25",
  generatedAt: "2026-10-26T16:00:00Z",
};
const HOSTILE: Community = {
  podcast: {
    configured: true,
    ok: true,
    error: null,
    items: [{
      title: "</script><script>alert(1)</script>",
      episodeNumber: 1,
      date: "2026-10-19",
      url: "https://club.test/podcast/2026-10-19",
      description: "<img src=x onerror=alert(1)>",
      videoUrl: "javascript:alert(1)",
    }],
  },
  feed: {
    configured: true,
    ok: false,
    error: "feed: HTTP 503",
    items: [],
  },
};

Deno.test("issue page: community text escaped, unsafe video dropped, failed source noted", () => {
  const html = renderIssue(CFG, META, [], {}, undefined, [], HOSTILE);
  assert(!html.includes("<script>alert"));
  assert(!html.includes("<img src=x"));
  assert(html.includes("&lt;/script&gt;"));
  assert(!html.includes("javascript:"));
  assert(html.includes("The Swamp Club feed could not be read this week."));
  // The error text itself stays in swamp data, off the public page.
  assert(!html.includes("HTTP 503"));
});

Deno.test("issue page: JSON-LD cannot be closed by a title", () => {
  const html = renderIssue(
    { ...CFG, title: "</script><b>x" },
    META,
    [],
    {},
  );
  const ld = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )!;
  assert(!ld[1].includes("<"));
  assertEquals(
    JSON.parse(ld[1]).headline,
    "</script><b>x: week of Oct 19 – Oct 25, 2026",
  );
});

Deno.test("issue page: links to the previous week and lists earlier issues", () => {
  const archive = [
    { slug: "2026-10-05", lastDay: "2026-10-11", counts: {} as never },
    { slug: "2026-10-12", lastDay: "2026-10-18", counts: {} as never },
    { slug: "2026-10-19", lastDay: "2026-10-25", counts: {} as never },
  ];
  const html = renderIssue(CFG, META, [], {}, undefined, archive);
  assert(
    html.includes(
      `<a rel="prev" href="./2026-10-12.html">← Week of Oct 12 – Oct 18, 2026</a>`,
    ),
  );
  assert(html.includes(`<a href="./2026-10-05.html">`));
  assert(html.includes(`href="https://site.test/issues/2026-10-19.json"`));
  // The first issue has no previous link and no earlier list.
  const first = renderIssue(CFG, META, [], {}, undefined, archive.slice(2));
  assert(!first.includes(`rel="prev"`));
  assert(!first.includes("Earlier issues"));
});

Deno.test("issue JSON: same content, failed sources marked unavailable, absent ones omitted", () => {
  const j = JSON.parse(
    renderIssueJson(CFG, META, [], {}, undefined, [], HOSTILE),
  );
  assertEquals(j.schemaVersion, 1);
  assertEquals(j.url, "https://site.test/issues/2026-10-19.html");
  assertEquals(j.feed, { available: false, items: [] });
  assertEquals(j.podcast.items[0].title, "</script><script>alert(1)</script>");
  assert(!JSON.stringify(j).includes("HTTP 503"));
  const none = JSON.parse(
    renderIssueJson(CFG, META, [], {}, undefined, [], NO_COMMUNITY),
  );
  assert(!("podcast" in none) && !("feed" in none));
});

Deno.test("llms.txt points at the JSON copies", () => {
  const t = renderLlmsTxt(CFG, [
    { slug: "2026-10-19", lastDay: "2026-10-25", counts: {} as never },
  ]);
  assert(t.startsWith("# LWIS\n\n> "));
  assert(t.includes("(https://site.test/index.json)"));
  assert(t.includes("(https://site.test/issues/2026-10-19.json)"));
});

const ITEM = {
  section: "new" as const,
  key: "@a/thing",
  collapsed: false,
  entries: [{
    section: "new" as const,
    name: "@a/thing",
    family: null,
    fromVersion: null,
    toVersion: "2026.10.20.1",
    channel: "stable",
    versions: ["2026.10.20.1"],
    description: "Thing.",
    labels: [],
    repository: null,
    repositoryVerified: false,
    registrySummary: "",
    methodsAdded: [],
    methodsRemoved: [],
    releaseNotes: "",
    reason: null,
    changedLines: null,
  }],
};

const EPISODE: Community = {
  podcast: {
    configured: true,
    ok: true,
    error: null,
    items: [{
      title: "Ep **12** @everyone [x](https://evil.test)",
      episodeNumber: 12,
      date: "2026-10-19",
      url: "https://club.test/podcast/2026-10-19",
      description: "",
      videoUrl: null,
    }],
  },
  feed: NO_COMMUNITY.feed,
};

Deno.test("issue page: community sections come before the registry sections", () => {
  const html = renderIssue(
    CFG,
    META,
    [ITEM as never],
    {},
    undefined,
    [],
    EPISODE,
  );
  const pod = html.indexOf("<h2>Podcast</h2>");
  const reg = html.indexOf("<h2>New extensions</h2>");
  assert(pod > 0 && reg > pod);
});

Deno.test("Discord: one escaped podcast line, none when unavailable or unconfigured", () => {
  const p = renderDiscord(CFG, META, [ITEM as never], 1900, undefined, EPISODE);
  assert(
    p.content.includes(
      "\nPodcast: Ep \\*\\*12\\*\\* @everyone \\[x\\](https://evil.test) <https://club.test/podcast/2026-10-19>",
    ),
  );
  assertEquals(p.allowed_mentions.parse, []);
  const quiet = renderDiscord(CFG, META, [], 1900, undefined, EPISODE);
  assert(quiet.content.includes("Nothing new this week.\nPodcast: "));
  const down = renderDiscord(CFG, META, [ITEM as never], 1900, undefined, {
    ...EPISODE,
    podcast: { ...EPISODE.podcast, ok: false },
  });
  assert(!down.content.includes("Podcast"));
  assert(
    !renderDiscord(CFG, META, [ITEM as never]).content.includes("Podcast"),
  );
});
