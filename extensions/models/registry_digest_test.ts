// extensions/models/registry_digest_test.ts
// Assertions read loosely typed JSON written by the methods under test.
// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { createModelTestContext } from "jsr:@swamp-club/swamp-testing@0.20261024.62";
import { model } from "./registry_digest.ts";

type Ctx = Parameters<typeof model.methods.collect.execute>[1];

const GLOBAL = {
  registryUrl: "https://registry.test",
  timeZone: "America/Los_Angeles",
  weekStartsOn: 1,
  familyThreshold: 3,
  siteTitle: "Last Week in Swamp",
  siteUrl: "https://site.test",
  disclaimer: "Machine-written.",
  summarizer: "none" as const,
  summarizerCommand: [],
  summarizerPassEnv: [],
  summarizerTimeoutMs: 1000,
  summarizerConcurrency: 1,
  maxSummaries: 10,
  maxSummaryChars: 320,
  diffBudgetChars: 5000,
  familyDiffSample: 1,
  githubBranch: "gh-pages",
};

function ctx(
  stored: Record<string, unknown> = {},
  globalArgs: Record<string, unknown> = GLOBAL,
) {
  const c = createModelTestContext({
    globalArgs,
    storedResources: stored as Record<string, Record<string, unknown>>,
  });
  return { ...c, context: c.context as unknown as Ctx };
}

const NOW = Date.parse("2026-10-27T17:00:00Z"); // Tue; week = Oct 19-25

const ext = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  description: "Thing.",
  labels: [],
  repository: null,
  repositoryVerified: false,
  latestVersion: "2026.10.21.1",
  latestBeta: null,
  latestRc: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  ...over,
});

/** A fake registry: stable catalog, empty beta/rc, versions per name. */
function registry(
  catalog: unknown[],
  versions: Record<string, unknown[]>,
  info: Record<string, unknown> = {},
) {
  const seen: string[] = [];
  const f: typeof fetch = (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    seen.push(url.pathname + url.search);
    const json = (b: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(b), { status }));
    if (url.pathname === "/api/v1/extensions/search") {
      const list = url.searchParams.get("channel") ? [] : catalog;
      return json({
        extensions: url.searchParams.get("page") === "1" ? list : [],
        meta: { total: list.length },
      });
    }
    const v = url.pathname.match(/^\/api\/v1\/extensions\/(.+)\/versions$/);
    if (v) {
      return json({
        versions: versions[v[1]] ?? [],
        meta: { total: (versions[v[1]] ?? []).length },
      });
    }
    const i = url.pathname.match(/^\/api\/v1\/extensions\/(.+)$/);
    if (i) {
      return i[1] in info
        ? json(info[i[1]])
        : json({ error: "Extension not found" }, 404);
    }
    return json({ error: "unexpected" }, 500);
  };
  return { f, seen };
}

const v = (
  version: string,
  publishedAt: string,
  over: Record<string, unknown> = {},
) => ({
  version,
  publishedAt,
  channel: "stable",
  yankedAt: null,
  models: [],
  ...over,
});

Deno.test("collect builds the backfill issue and honours no-digest", async () => {
  const { f } = registry(
    [
      ext("@a/updated"),
      ext("@a/new", { createdAt: "2026-10-20T00:00:00Z" }),
      ext("@a/private", { labels: ["no-digest"] }),
      ext("@a/quiet", { updatedAt: "2026-09-01T00:00:00Z" }),
    ],
    {
      "@a/updated": [
        v("2026.10.21.1", "2026-10-21T00:00:00Z"),
        v("2026.10.01.1", "2026-10-01T00:00:00Z"),
      ],
      "@a/new": [v("2026.10.20.1", "2026-10-20T00:00:00Z")],
      "@a/private": [v("2026.10.21.1", "2026-10-21T00:00:00Z")],
    },
  );
  const { context, getWrittenResources } = ctx();
  await model.methods.collect.execute({ _fetch: f, _now: NOW }, context);
  const issue = getWrittenResources().find((r) => r.name === "issue")!
    .data as Record<string, any>;
  assertEquals(issue.slug, "2026-10-19");
  assertEquals(issue.items.map((i: any) => `${i.section}:${i.key}`), [
    "new:@a/new",
    "updated:@a/updated",
  ]);
  assertEquals(issue.stats.optedOut, 1);
  assertEquals(issue.stats.firstRun, true);
  const pending = getWrittenResources().find((r) =>
    r.name === "catalogPending"
  )!.data as Record<string, any>;
  assertEquals(pending.rows.length, 4);
});

Deno.test("collect reports a removed extension with its yank reason", async () => {
  const { f } = registry(
    [ext("@a/kept", { updatedAt: "2026-09-01T00:00:00Z" })],
    {},
    {
      "@a/gone": {
        name: "@a/gone",
        yankedAt: "2026-10-22T00:00:00Z",
        yankReason: "superseded",
      },
    },
  );
  const previous = {
    forSlug: "2026-10-12",
    takenAt: "",
    rows: [
      {
        name: "@a/kept",
        latestVersion: "2026.10.21.1",
        latestBeta: null,
        latestRc: null,
        updatedAt: "2026-09-01T00:00:00Z",
        labels: [],
      },
      {
        name: "@a/gone",
        latestVersion: "3",
        latestBeta: null,
        latestRc: null,
        updatedAt: "2026-09-01T00:00:00Z",
        labels: [],
      },
    ],
  };
  const { context, getWrittenResources } = ctx({
    catalog: previous,
    cursor: {
      lastSlug: "2026-10-12",
      lastEnd: "2026-10-19T07:00:00.000Z",
      committedAt: "",
    },
  });
  await model.methods.collect.execute({ _fetch: f, _now: NOW }, context);
  const issue = getWrittenResources().find((r) => r.name === "issue")!
    .data as Record<string, any>;
  assertEquals(issue.items.length, 1);
  assertEquals(issue.items[0].section, "removed");
  assertEquals(issue.items[0].entries[0].reason, "superseded");
});

Deno.test("collect fails loudly on a truncated catalog rather than reporting mass removals", async () => {
  const f: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ extensions: [ext("@a/x")], meta: { total: 500 } }),
      ),
    );
  // page 2+ returns the same single row forever; the loop must not spin or accept it
  let calls = 0;
  const g: typeof fetch = (i) => {
    calls++;
    const u = new URL(String(i));
    if (u.searchParams.get("page") !== "1") {
      return Promise.resolve(
        new Response(JSON.stringify({ extensions: [], meta: { total: 500 } })),
      );
    }
    return f(i);
  };
  const { context } = ctx();
  await assertRejects(
    () => model.methods.collect.execute({ _fetch: g, _now: NOW }, context),
    Error,
    "incomplete",
  );
  assert(calls < 20);
});

const ISSUE = {
  slug: "2026-10-19",
  start: "2026-10-19T07:00:00.000Z",
  end: "2026-10-26T07:00:00.000Z",
  lastDay: "2026-10-25",
  generatedAt: "",
  items: [],
  counts: { new: 0, updated: 0, prerelease: 0, yanked: 0, removed: 0 },
  stats: {
    catalogSize: 0,
    candidates: 0,
    removed: 0,
    optedOut: 0,
    firstRun: true,
  },
};
const PENDING = { forSlug: "2026-10-19", takenAt: "", rows: [] };
const RENDERED = {
  slug: "2026-10-19",
  files: { "index.html": "<html></html>" },
  discord: { content: "hi", allowed_mentions: { parse: [] }, flags: 4 },
  outDir: null,
};

Deno.test("publish and announce dry-runs never touch the network", async () => {
  const boom: typeof fetch = () => {
    throw new Error("network used in dry run");
  };
  const { context, getWrittenResources } = ctx({ rendered: RENDERED });
  await model.methods.publish.execute({ dryRun: true, _fetch: boom }, context);
  await model.methods.announce.execute({ dryRun: true, _fetch: boom }, context);
  const names = getWrittenResources().map((
    r,
  ) => [r.name, (r.data as any).dryRun]);
  assertEquals(names, [["publication", true], ["announcement", true]]);
});

Deno.test("announce refuses a webhook URL that is not Discord, and sends no mentions", async () => {
  const sent: any[] = [];
  const f: typeof fetch = (_u, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "42" }), { status: 200 }),
    );
  };
  const bad = ctx({ rendered: RENDERED }, {
    ...GLOBAL,
    discordWebhookUrl: "https://evil.test/api/webhooks/1/x",
  });
  await assertRejects(
    () =>
      model.methods.announce.execute({ dryRun: false, _fetch: f }, bad.context),
    Error,
    "discord.com",
  );
  const good = ctx({ rendered: RENDERED }, {
    ...GLOBAL,
    discordWebhookUrl: "https://discord.com/api/webhooks/1/x",
  });
  await model.methods.announce.execute(
    { dryRun: false, _fetch: f },
    good.context,
  );
  assertEquals(sent[0].allowed_mentions, { parse: [] });
});

Deno.test("commit refuses after a dry run, and advances the cursor after a real one", async () => {
  const dry = ctx({
    issue: ISSUE,
    catalogPending: PENDING,
    publication: { slug: "2026-10-19", dryRun: true, commitSha: null },
    announcement: { slug: "2026-10-19", dryRun: true, status: null },
  });
  const err = await assertRejects(
    () => model.methods.commit.execute({}, dry.context),
    Error,
  );
  assertStringIncludes(err.message, "not published");
  assertStringIncludes(err.message, "not announced");

  const real = ctx({
    issue: ISSUE,
    catalogPending: PENDING,
    publication: { slug: "2026-10-19", dryRun: false, commitSha: "abc" },
    announcement: { slug: "2026-10-19", dryRun: false, status: 200 },
  });
  await model.methods.commit.execute({}, real.context);
  const cursor = real.getWrittenResources().find((r) => r.name === "cursor")!
    .data as any;
  assertEquals(cursor.lastEnd, "2026-10-26T07:00:00.000Z");
});

Deno.test("commit refuses when the publication is for a different issue", async () => {
  const c = ctx({
    issue: ISSUE,
    catalogPending: PENDING,
    publication: { slug: "2026-10-12", dryRun: false, commitSha: "abc" },
    announcement: { slug: "2026-10-19", dryRun: false, status: 200 },
  });
  await assertRejects(
    () => model.methods.commit.execute({}, c.context),
    Error,
    "not published",
  );
});

const ISSUE_ONLY = {
  slug: "2026-10-19",
  start: "2026-10-19T07:00:00Z",
  end: "2026-10-26T07:00:00Z",
  lastDay: "2026-10-25",
  generatedAt: "2026-10-26T16:00:00Z",
  items: [],
  counts: {},
  stats: {
    catalogSize: 0,
    candidates: 0,
    removed: 0,
    optedOut: 0,
    firstRun: true,
  },
};

const COMMUNITY_ARGS = {
  ...GLOBAL,
  communityFeedUrl: "https://club.test/feed.xml",
  podcastSitemapUrl: "https://club.test/sitemap.xml",
};

Deno.test("community records a failed source instead of failing the run", async () => {
  const f: typeof fetch = (input) => {
    const u = String(input);
    return Promise.resolve(
      u.endsWith("feed.xml")
        ? new Response(
          `<rss><channel><item><title>Post</title><guid>https://club.test/feed/p/1</guid><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
        )
        : new Response("down", { status: 503 }),
    );
  };
  const { context, getWrittenResources } = ctx(
    { issue: ISSUE_ONLY },
    COMMUNITY_ARGS,
  );
  await model.methods.community.execute({ _fetch: f }, context);
  const c = getWrittenResources().find((r) => r.name === "community")!
    .data as Record<string, any>;
  assertEquals(c.slug, "2026-10-19");
  assertEquals(c.feed.ok, true);
  assertEquals(c.feed.items.map((p: any) => p.title), ["Post"]);
  assertEquals(c.podcast.ok, false);
  assertEquals(c.errors.length, 1);
  assertStringIncludes(
    c.errors[0],
    "podcast: Error: GET https://club.test/sitemap.xml: HTTP 503",
  );
});

Deno.test("community with no sources configured touches nothing", async () => {
  const f: typeof fetch = () => {
    throw new Error("network touched");
  };
  const { context, getWrittenResources } = ctx({ issue: ISSUE_ONLY });
  await model.methods.community.execute({ _fetch: f }, context);
  const c = getWrittenResources().find((r) => r.name === "community")!
    .data as Record<string, any>;
  assertEquals([c.feed.configured, c.podcast.configured, c.errors], [
    false,
    false,
    [],
  ]);
});

Deno.test("render requires this week's community data once a source is configured", async () => {
  const sums = {
    slug: "2026-10-19",
    mode: "none",
    summaries: {},
    withheld: [],
    errors: [],
    generated: 0,
    fallback: 0,
  };
  const missing = ctx({ issue: ISSUE_ONLY, summaries: sums }, COMMUNITY_ARGS);
  await assertRejects(
    () => model.methods.render.execute({}, missing.context),
    Error,
    "run `community` first",
  );
  const empty = { configured: true, ok: true, error: null, items: [] };
  const stale = ctx({
    issue: ISSUE_ONLY,
    summaries: sums,
    community: { slug: "2026-10-12", podcast: empty, feed: empty, errors: [] },
  }, COMMUNITY_ARGS);
  await assertRejects(
    () => model.methods.render.execute({}, stale.context),
    Error,
    "run community again",
  );
  const good = ctx({
    issue: ISSUE_ONLY,
    summaries: sums,
    community: { slug: "2026-10-19", podcast: empty, feed: empty, errors: [] },
  }, COMMUNITY_ARGS);
  await model.methods.render.execute({}, good.context);
  const r = good.getWrittenResources().find((x) => x.name === "rendered")!
    .data as Record<string, any>;
  assertEquals(Object.keys(r.files).sort(), [
    ".nojekyll",
    "feed.xml",
    "index.html",
    "index.json",
    "issues/2026-10-19.html",
    "issues/2026-10-19.json",
    "llms.txt",
    "robots.txt",
    "site.css",
    "sitemap.xml",
  ]);
  assertStringIncludes(
    r.files["issues/2026-10-19.html"],
    "No episode this week.",
  );
});
