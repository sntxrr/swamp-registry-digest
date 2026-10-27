/**
 * Registry digest — a weekly issue of what changed in the swamp extension
 * registry: new extensions, updates, pre-releases, yanks and removals, with a
 * short summary of each change. Rendered as a static site (dated issue pages,
 * an index and an RSS feed) and announced by Discord webhook.
 *
 * The pipeline is eight methods, run in order by a workflow:
 *
 * | method      | reads                        | writes / touches                |
 * | ----------- | ---------------------------- | ------------------------------- |
 * | `collect`   | registry, cursor, catalog    | `issue`, pending catalog        |
 * | `classify`  | `issue`, release archives    | `issue` (minor updates moved)   |
 * | `summarize` | `issue`, release archives    | `summaries`                     |
 * | `community` | `issue`, feed, podcast pages | `community`                     |
 * | `render`    | issue, summaries, community  | `rendered` (+ files on disk)    |
 * | `publish`   | `rendered`                   | one commit on the Pages branch  |
 * | `announce`  | `rendered`                   | one Discord message             |
 * | `commit`    | all of the above             | cursor, catalog, archive        |
 *
 * Design decisions worth knowing before use:
 *
 * 1. **The window is a high-water mark, not "the last 7 days".** Each issue
 *    starts where the previous one ended, so a missed week folds into the next
 *    issue instead of disappearing. `commit` advances it, and refuses unless
 *    `publish` and `announce` both really ran (not dry-run) for this issue.
 * 2. **A catalog snapshot catches what timestamps cannot.** A yanked version
 *    makes `latestVersion` go backwards without moving `updatedAt`, and a
 *    yanked extension drops out of search. Both are found by diffing the
 *    catalog against the previous issue's snapshot.
 * 3. **Registry content is untrusted.** Descriptions, release notes and code
 *    are written by anyone who can publish. They are escaped everywhere they
 *    are rendered, Discord posts cannot mention anyone, and every LLM summary
 *    passes a validator that rejects links, markup and mentions. The
 *    summarizer command must run with no tools; see the README.
 * 4. **Authors can opt out** by adding the `no-digest` label to their
 *    extension. Opted-out extensions are left out of the issue entirely.
 * 5. **Remote effects default to dry-run.** `publish` and `announce` only
 *    write when called with `dryRun: false`.
 * 6. **Community sections fail on their own.** The podcast and feed are
 *    third-party pages; if one cannot be read, the issue says so and still
 *    goes out. `community` records the error, so a caller can alert on it.
 *
 * @module
 */
// extensions/models/registry_digest.ts
import { z } from "npm:zod@4";
import {
  type CatalogEntry,
  DEFAULT_REGISTRY_URL,
  RegistryClient,
} from "./_lib/registry.ts";
import {
  candidates,
  entriesFor,
  type Entry,
  groupItems,
  isSignificant,
  isStructural,
  issueWindow,
  type Item,
  itemId,
  mergeChannels,
  OPT_OUT_LABEL,
  removedEntry,
  toRows,
} from "./_lib/digest.ts";
import {
  changedLineCount,
  type CodeDiff,
  DEFAULT_LIMITS,
  diffArchives,
  readArchive,
} from "./_lib/codediff.ts";
import {
  buildPrompt,
  fallbackSummary,
  knownTextOf,
  runCommand,
  validateSummary,
  WITHHELD,
} from "./_lib/summarize.ts";
import {
  type ArchiveEntry,
  counts,
  type DiscordPayload,
  renderDiscord,
  renderFeed,
  renderIndex,
  renderIndexJson,
  renderIssue,
  renderIssueJson,
  renderLlmsTxt,
  renderRobots,
  renderSitemap,
  renderStylesheet,
  type SiteConfig,
  sitePath,
} from "./_lib/render.ts";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { publishFiles } from "./_lib/publish.ts";
import { fetchFeed, fetchPodcast } from "./_lib/community.ts";

const DEFAULT_DISCLAIMER =
  "Generated automatically from public swamp registry data. Summaries are machine-written descriptions of each change, " +
  "not reviews, and can be wrong; the registry and the extension's source are authoritative. " +
  "Authors can leave the digest by adding the `no-digest` label to their extension.";

const GlobalArgsSchema = z.object({
  registryUrl: z.string().url().default(DEFAULT_REGISTRY_URL).describe(
    "Base URL of the swamp registry",
  ),
  timeZone: z.string().default("America/Los_Angeles").describe(
    "IANA time zone the weekly window is cut in",
  ),
  weekStartsOn: z.number().int().min(0).max(6).default(1).describe(
    "Day the issue week starts: 0 = Sunday, 1 = Monday",
  ),
  familyThreshold: z.number().int().min(2).default(3).describe(
    "Collapse a family (`@collective/group/*`) into one line once this many members changed in one section",
  ),
  siteTitle: z.string().default("Last Week in Swamp Club"),
  siteUrl: z.string().url().describe(
    "Public base URL of the published site, e.g. https://lastweekinswamp.club",
  ),
  disclaimer: z.string().default(DEFAULT_DISCLAIMER),
  summarizer: z.enum(["none", "command"]).default("none").describe(
    "`none` builds summaries from registry metadata; `command` runs `summarizerCommand` per item",
  ),
  summarizerCommand: z.array(z.string()).default([]).describe(
    "argv of the summarizer: prompt on stdin, summary (or Claude Code JSON) on stdout. It MUST run with no tools, " +
      'e.g. ["claude","-p","--tools","","--setting-sources","","--strict-mcp-config","--disable-slash-commands","--output-format","json"]',
  ),
  summarizerPassEnv: z.array(z.string()).default([
    "HOME",
    "PATH",
    "USER",
    "LOGNAME",
    "LANG",
    "TMPDIR",
  ]).describe(
    "The only environment variables the summarizer sees",
  ),
  summarizerTimeoutMs: z.number().int().positive().default(180000),
  summarizerConcurrency: z.number().int().min(1).max(8).default(2),
  maxSummaries: z.number().int().min(0).default(120).describe(
    "Cap on summarizer calls per issue; items beyond it get a metadata summary",
  ),
  maxSummaryChars: z.number().int().min(80).default(320),
  diffBudgetChars: z.number().int().min(1000).default(12000).describe(
    "Characters of unified diff given to the summarizer per extension",
  ),
  familyDiffSample: z.number().int().min(0).default(2).describe(
    "How many members of a collapsed family get a code diff",
  ),
  minChangedLines: z.number().int().min(0).default(10).describe(
    "An update with no API or structural change needs at least this many changed lines of code or config (version strings, lockfiles, generated code and docs excluded) to get a full line; below it, it is a minor update",
  ),
  minorUpdates: z.enum(["list", "count", "drop"]).default("list").describe(
    "How minor updates appear: `list` names them in one compact section, `count` shows only how many, `drop` leaves them out",
  ),
  communityFeedUrl: z.string().url().optional().describe(
    "RSS feed whose posts in the week get their own section, e.g. https://swamp-club.com/feed.xml. Unset: no section",
  ),
  podcastSitemapUrl: z.string().url().optional().describe(
    "Sitemap listing /podcast/YYYY-MM-DD episode pages; episodes dated in the week get a section, e.g. https://swamp-club.com/sitemap.xml. Unset: no section",
  ),
  siteAssetsDir: z.string().optional().describe(
    "Absolute path of a directory of static files (images, fonts, licences) published with the site at the same relative paths",
  ),
  bannerImage: z.string().optional().describe(
    "Site-relative path of the masthead banner (about 1600 px wide), e.g. assets/banner-1600.webp",
  ),
  bannerImageSmall: z.string().optional().describe(
    "Site-relative path of the banner for narrow screens (about 800 px wide)",
  ),
  bannerWidth: z.number().int().positive().optional(),
  bannerHeight: z.number().int().positive().optional(),
  bannerAlt: z.string().default("").describe(
    "Alt text for the banner; empty marks it decorative",
  ),
  displayFont: z.string().optional().describe(
    "Site-relative path of a WOFF2 display face for the masthead and headings",
  ),
  githubRepo: z.string().optional().describe(
    "owner/name of the Pages repository",
  ),
  githubBranch: z.string().default("gh-pages"),
  githubToken: z.string().optional().meta({ sensitive: true }).describe(
    "Token with contents:write on githubRepo only. Supply via vault.get().",
  ),
  discordWebhookUrl: z.string().optional().meta({ sensitive: true }).describe(
    "Discord channel webhook URL. A bearer credential: supply via vault.get().",
  ),
  heartbeatUrl: z.string().optional().meta({ sensitive: true }).describe(
    "Optional push URL (e.g. Uptime Kuma) pinged by `commit` after a fully published issue",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

// --- resource schemas -------------------------------------------------------

const EntrySchema = z.object({
  section: z.string(),
  name: z.string(),
  family: z.string().nullable(),
  fromVersion: z.string().nullable(),
  toVersion: z.string().nullable(),
  channel: z.string(),
  versions: z.array(z.string()),
  description: z.string(),
  labels: z.array(z.string()),
  repository: z.string().nullable(),
  repositoryVerified: z.boolean(),
  registrySummary: z.string(),
  methodsAdded: z.array(z.string()),
  methodsRemoved: z.array(z.string()),
  releaseNotes: z.string(),
  reason: z.string().nullable(),
  changedLines: z.number().nullable().default(null),
});

const ItemSchema = z.object({
  section: z.string(),
  key: z.string(),
  collapsed: z.boolean(),
  entries: z.array(EntrySchema),
});

const IssueSchema = z.object({
  slug: z.string(),
  start: z.string(),
  end: z.string(),
  lastDay: z.string(),
  generatedAt: z.string(),
  items: z.array(ItemSchema),
  counts: z.record(z.string(), z.number()),
  stats: z.object({
    catalogSize: z.number(),
    candidates: z.number(),
    removed: z.number(),
    optedOut: z.number(),
    firstRun: z.boolean(),
    classified: z.object({
      measured: z.number(),
      minor: z.number(),
      unmeasured: z.number(),
      minChangedLines: z.number(),
    }).optional(),
  }),
});

const CatalogSchema = z.object({
  forSlug: z.string(),
  takenAt: z.string(),
  rows: z.array(z.object({
    name: z.string(),
    latestVersion: z.string().nullable(),
    latestBeta: z.string().nullable(),
    latestRc: z.string().nullable(),
    updatedAt: z.string(),
    labels: z.array(z.string()),
  })),
});

const SummariesSchema = z.object({
  slug: z.string(),
  mode: z.string(),
  summaries: z.record(z.string(), z.string()),
  withheld: z.array(z.object({ id: z.string(), reasons: z.array(z.string()) })),
  errors: z.array(z.object({ id: z.string(), error: z.string() })),
  generated: z.number(),
  fallback: z.number(),
});

const SourceSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    configured: z.boolean(),
    ok: z.boolean(),
    error: z.string().nullable(),
    items: z.array(item),
  });

const CommunitySchema = z.object({
  slug: z.string(),
  podcast: SourceSchema(z.object({
    title: z.string(),
    episodeNumber: z.number().nullable(),
    date: z.string(),
    url: z.string(),
    description: z.string(),
    videoUrl: z.string().nullable(),
  })),
  feed: SourceSchema(z.object({
    title: z.string(),
    url: z.string(),
    author: z.string(),
    publishedAt: z.string(),
    summary: z.string(),
  })),
  /** Errors across both sources, for alerting. */
  errors: z.array(z.string()),
});

const RenderedSchema = z.object({
  slug: z.string(),
  files: z.record(z.string(), z.string()),
  discord: z.object({
    content: z.string(),
    allowed_mentions: z.object({ parse: z.array(z.string()) }),
    flags: z.number(),
  }),
  outDir: z.string().nullable(),
  /** Binary site files (images, fonts), base64, by site path. */
  assets: z.record(z.string(), z.string()).default({}),
});

const PublicationSchema = z.object({
  slug: z.string(),
  dryRun: z.boolean(),
  repo: z.string().nullable(),
  branch: z.string(),
  commitSha: z.string().nullable(),
  commitUrl: z.string().nullable(),
  files: z.array(z.string()),
  at: z.string(),
});

const AnnouncementSchema = z.object({
  slug: z.string(),
  dryRun: z.boolean(),
  status: z.number().nullable(),
  messageId: z.string().nullable(),
  content: z.string(),
  at: z.string(),
});

const CursorSchema = z.object({
  lastSlug: z.string(),
  lastEnd: z.string(),
  committedAt: z.string(),
});

const ArchiveSchema = z.object({
  issues: z.array(z.object({
    slug: z.string(),
    lastDay: z.string(),
    counts: z.record(z.string(), z.number()),
  })),
});

type Issue = z.infer<typeof IssueSchema>;
type Summaries = z.infer<typeof SummariesSchema>;
type CommunityData = z.infer<typeof CommunitySchema>;
type Rendered = z.infer<typeof RenderedSchema>;
type Publication = z.infer<typeof PublicationSchema>;
type Announcement = z.infer<typeof AnnouncementSchema>;
type Cursor = z.infer<typeof CursorSchema>;
type Archive = z.infer<typeof ArchiveSchema>;
type Catalog = z.infer<typeof CatalogSchema>;

// --- context ---------------------------------------------------------------

type Logger = {
  info: (message: string, props?: Record<string, unknown>) => void;
  warn: (message: string, props?: Record<string, unknown>) => void;
};

type Ctx = {
  globalArgs: GlobalArgs;
  logger: Logger;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  readResource?: (
    name: string,
    version?: number,
  ) => Promise<Record<string, unknown> | null>;
};

/** Test seam: inject fetch (and a clock) instead of reaching the network. */
type Seams = { _fetch?: typeof fetch; _now?: number };

async function read<T>(ctx: Ctx, name: string): Promise<T | null> {
  if (!ctx.readResource) {
    throw new Error("this swamp version does not provide readResource");
  }
  return (await ctx.readResource(name)) as T | null;
}

async function mustRead<T>(ctx: Ctx, name: string, hint: string): Promise<T> {
  const v = await read<T>(ctx, name);
  if (!v) throw new Error(`no "${name}" data yet: run \`${hint}\` first`);
  return v;
}

function siteConfig(g: GlobalArgs): SiteConfig {
  return {
    title: g.siteTitle,
    siteUrl: g.siteUrl.replace(/\/+$/, ""),
    registryUrl: g.registryUrl,
    disclaimer: g.disclaimer,
    theme: {
      banner: g.bannerImage,
      bannerSmall: g.bannerImageSmall,
      bannerWidth: g.bannerWidth,
      bannerHeight: g.bannerHeight,
      bannerAlt: g.bannerAlt,
      displayFont: g.displayFont,
    },
  };
}

const ASSET_TYPES = /\.(webp|avif|png|jpe?g|gif|ico|woff2|txt)$/i;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const PROVENANCE_SIDECAR = /\.(webp|avif|png|jpe?g|gif)\.json$/i;
const MAX_ASSETS = 50;

/**
 * Every publishable file under `dir`, base64 by site path. Only image, font
 * and text types; no dotfiles, no symlinks, nothing over 2 MB.
 */
export async function readSiteAssets(
  dir: string,
): Promise<Record<string, string>> {
  if (!dir.startsWith("/")) {
    throw new Error("siteAssetsDir must be an absolute path");
  }
  const root = dir.replace(/\/+$/, "");
  const out: Record<string, string> = {};
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(rel ? `${root}/${rel}` : root)) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith(".") || e.isSymlink) continue;
      // Provenance sidecars (`banner.webp.json`) and Markdown notes stay in
      // the repo, unpublished.
      if (PROVENANCE_SIDECAR.test(e.name) || /\.md$/i.test(e.name)) continue;
      if (e.isDirectory) {
        await walk(path);
        continue;
      }
      if (!ASSET_TYPES.test(e.name) || !sitePath(path)) {
        throw new Error(`siteAssetsDir: refusing ${path} (type or name)`);
      }
      const bytes = await Deno.readFile(`${root}/${path}`);
      if (bytes.length > MAX_ASSET_BYTES) {
        throw new Error(`siteAssetsDir: ${path} is over 2 MB`);
      }
      out[path] = encodeBase64(bytes);
      if (Object.keys(out).length > MAX_ASSETS) {
        throw new Error(`siteAssetsDir: more than ${MAX_ASSETS} files`);
      }
    }
  };
  await walk("");
  return out;
}

/** Run `fn` over `xs` with at most `n` in flight, preserving order. */
async function pool<T, R>(
  xs: T[],
  n: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    }),
  );
  return out;
}

/**
 * Model type `@sntxrr/registry-digest`.
 *
 * @example
 * ```bash
 * swamp model create @sntxrr/registry-digest digest \
 *   --global-arg siteUrl=https://example.github.io/digest
 * swamp model @sntxrr/registry-digest method run collect digest
 * swamp model @sntxrr/registry-digest method run summarize digest
 * swamp model @sntxrr/registry-digest method run render digest --arg outDir=/tmp/site
 * ```
 */
export const model = {
  type: "@sntxrr/registry-digest",
  description:
    "Weekly digest of new, updated, pre-release, yanked and removed swamp registry extensions, published as a static site and announced on Discord",
  version: "2026.10.26.3",
  globalArguments: GlobalArgsSchema,
  resources: {
    issue: {
      description: "The current issue: its window and every item in it",
      schema: IssueSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    catalog: {
      description:
        "Catalog snapshot the next issue is diffed against (instances: catalog, catalogPending)",
      schema: CatalogSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    summaries: {
      description: "Validated summary per item, plus what was withheld and why",
      schema: SummariesSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    community: {
      description:
        "The week's podcast episodes and feed posts, and any error reading them",
      schema: CommunitySchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    rendered: {
      description:
        "Rendered site files and the Discord payload for the current issue",
      schema: RenderedSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    publication: {
      description: "Result of the last publish (or its dry run)",
      schema: PublicationSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    announcement: {
      description: "Result of the last Discord announcement (or its dry run)",
      schema: AnnouncementSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    cursor: {
      description: "High-water mark: where the last committed issue ended",
      schema: CursorSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
    archive: {
      description: "Every committed issue, for the index page and the feed",
      schema: ArchiveSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    collect: {
      description:
        "Snapshot the registry and build the next issue: every version published or yanked in the window, plus removals",
      arguments: z.object({}),
      execute: async (_args: Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const client = new RegistryClient(g.registryUrl, _args._fetch);
        const cursor = await read<Cursor>(ctx, "cursor");
        const previous = await read<Catalog>(ctx, "catalog");
        const w = issueWindow(
          _args._now ?? Date.now(),
          g.timeZone,
          cursor?.lastEnd ?? null,
          g.weekStartsOn,
        );
        ctx.logger.info("Collecting issue {slug}: {start} to {end}", { ...w });

        const [stable, beta, rc] = await Promise.all([
          client.searchAll("stable"),
          client.searchAll("beta"),
          client.searchAll("rc"),
        ]);
        const catalog = mergeChannels(stable, beta, rc);
        const cand = candidates(catalog, previous?.rows ?? null, w);
        ctx.logger.info(
          "Catalog {size} extensions; {n} candidates, {r} removed",
          {
            size: catalog.size,
            n: cand.changed.length,
            r: cand.removed.length,
          },
        );

        let optedOut = 0;
        const entries: Entry[] = [];
        const perExt = await pool(cand.changed, 3, async (name) => {
          const e = catalog.get(name) as CatalogEntry;
          if (e.labels.includes(OPT_OUT_LABEL)) return null;
          return entriesFor(e, await client.versions(name), w);
        });
        for (const es of perExt) {
          if (es === null) optedOut++;
          else entries.push(...es);
        }
        for (const row of cand.removed) {
          if (row.labels.includes(OPT_OUT_LABEL)) {
            optedOut++;
            continue;
          }
          const info = await client.info(row.name);
          const reason = info?.yankReason ?? info?.deprecationReason ?? null;
          entries.push(removedEntry(row, reason));
        }

        const items = groupItems(entries, g.familyThreshold);
        const issue: Issue = {
          ...w,
          generatedAt: new Date().toISOString(),
          items: items as Issue["items"],
          counts: counts(items),
          stats: {
            catalogSize: catalog.size,
            candidates: cand.changed.length,
            removed: cand.removed.length,
            optedOut,
            firstRun: previous === null,
          },
        };
        const handles = [
          await ctx.writeResource("issue", "issue", issue),
          await ctx.writeResource("catalog", "catalogPending", {
            forSlug: w.slug,
            takenAt: issue.generatedAt,
            rows: toRows(catalog),
          }),
        ];
        ctx.logger.info("Issue {slug}: {items} items", {
          slug: w.slug,
          items: items.length,
        });
        return { dataHandles: handles };
      },
    },

    classify: {
      description:
        "Measure each update's real code change and move those below the threshold (no API change, fewer than minChangedLines lines) to the minor section",
      arguments: z.object({}),
      execute: async (_args: Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const issue = await mustRead<Issue>(ctx, "issue", "collect");
        const client = new RegistryClient(g.registryUrl, _args._fetch);
        // Idempotent: a re-run restores minor entries to their real section first.
        const entries = (issue.items as Item[]).flatMap((i) => i.entries).map((
          e,
        ) => ({
          ...e,
          section: e.section === "minor"
            ? (e.channel === "stable" ? "updated" : "prerelease")
            : e.section,
        })) as Entry[];
        // API and structural changes are significant without downloading anything.
        const toMeasure = entries.filter((e) =>
          (e.section === "updated" || e.section === "prerelease") &&
          !isStructural(e) && e.fromVersion && e.toVersion
        );
        let unmeasured = 0;
        await pool(toMeasure, 3, async (e) => {
          try {
            const [a, b] = await Promise.all([
              client.download(e.name, e.fromVersion!, 10 * 1024 * 1024),
              client.download(e.name, e.toVersion!, 10 * 1024 * 1024),
            ]);
            e.changedLines = changedLineCount(
              await readArchive(a, DEFAULT_LIMITS),
              await readArchive(b, DEFAULT_LIMITS),
            );
          } catch (err) {
            e.changedLines = null;
            unmeasured++;
            ctx.logger.warn("Could not measure {name}: {err}", {
              name: e.name,
              err: String(err).slice(0, 200),
            });
          }
        });
        // One failed download keeps that entry visible; a registry outage fails loudly.
        if (toMeasure.length >= 10 && unmeasured / toMeasure.length > 0.2) {
          throw new Error(
            `could not measure ${unmeasured} of ${toMeasure.length} updates; refusing to classify on partial data`,
          );
        }
        let minor = 0;
        for (const e of entries) {
          if (!isSignificant(e, g.minChangedLines)) {
            e.section = "minor";
            minor++;
          }
        }
        const items = groupItems(entries, g.familyThreshold);
        const handle = await ctx.writeResource("issue", "issue", {
          ...issue,
          items,
          counts: counts(items),
          stats: {
            ...issue.stats,
            classified: {
              measured: toMeasure.length - unmeasured,
              minor,
              unmeasured,
              minChangedLines: g.minChangedLines,
            },
          },
        });
        ctx.logger.info(
          "Classified {slug}: {m} measured, {minor} minor, {u} unmeasured",
          {
            slug: issue.slug,
            m: toMeasure.length - unmeasured,
            minor,
            u: unmeasured,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    summarize: {
      description:
        "Summarize each item of the current issue, and validate every summary before keeping it",
      arguments: z.object({}),
      execute: async (_args: Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const issue = await mustRead<Issue>(ctx, "issue", "collect");
        const client = new RegistryClient(g.registryUrl, _args._fetch);
        const items = issue.items as Item[];
        const summaries: Record<string, string> = {};
        const withheld: Summaries["withheld"] = [];
        const errors: Summaries["errors"] = [];
        let generated = 0;
        let fallback = 0;

        // Yanks and removals are facts, not changes to describe. The rest are
        // ranked so the summarizer cap is spent on what readers care about.
        const describable = items.filter((i) =>
          ["new", "updated", "prerelease"].includes(i.section)
        )
          .sort((a, b) =>
            significance(b) - significance(a) ||
            itemId(a).localeCompare(itemId(b))
          );
        for (const i of items) {
          // Minor updates are never summarized: that is the point of them.
          if (!describable.includes(i) && i.section !== "minor") {
            summaries[itemId(i)] = deterministic(i);
          }
        }
        const viaCommand = g.summarizer === "command"
          ? describable.slice(0, g.maxSummaries)
          : [];
        for (const i of describable.slice(viaCommand.length)) {
          summaries[itemId(i)] = fallbackSummary(i);
          fallback++;
        }
        if (g.summarizer === "command" && g.summarizerCommand.length === 0) {
          throw new Error(
            "summarizer is `command` but summarizerCommand is empty",
          );
        }

        await pool(viaCommand, g.summarizerConcurrency, async (item) => {
          const id = itemId(item);
          try {
            const diffs = new Map<string, CodeDiff | { error: string }>();
            if (item.section !== "new") {
              for (
                const e of item.entries.slice(
                  0,
                  item.collapsed ? g.familyDiffSample : 1,
                )
              ) {
                if (!e.fromVersion || !e.toVersion) continue;
                diffs.set(e.name, await codeDiff(client, e, g.diffBudgetChars));
              }
            }
            const raw = await runCommand(
              {
                argv: g.summarizerCommand,
                timeoutMs: g.summarizerTimeoutMs,
                passEnv: g.summarizerPassEnv,
              },
              buildPrompt({ item, diffs }, g.maxSummaryChars),
            );
            const v = validateSummary(
              raw,
              g.maxSummaryChars,
              knownTextOf(item),
            );
            if (v.ok) {
              summaries[id] = v.text;
              generated++;
            } else {
              summaries[id] = WITHHELD;
              withheld.push({ id, reasons: v.reasons });
              ctx.logger.warn("Withheld summary for {id}: {reasons}", {
                id,
                reasons: v.reasons.join(", "),
              });
            }
          } catch (err) {
            summaries[id] = fallbackSummary(item);
            fallback++;
            errors.push({ id, error: String(err).slice(0, 300) });
            ctx.logger.warn("Summarizer failed for {id}: {err}", {
              id,
              err: String(err).slice(0, 200),
            });
          }
        });

        // One flaky call should not cost the week; a broken summarizer should fail loudly.
        if (viaCommand.length >= 5 && errors.length / viaCommand.length > 0.2) {
          throw new Error(
            `summarizer failed on ${errors.length} of ${viaCommand.length} items; first error: ${
              errors[0].error
            }`,
          );
        }

        const handle = await ctx.writeResource("summaries", "summaries", {
          slug: issue.slug,
          mode: g.summarizer,
          summaries,
          withheld,
          errors,
          generated,
          fallback,
        });
        ctx.logger.info(
          "Summaries for {slug}: {g} generated, {f} metadata, {w} withheld, {e} errors",
          {
            slug: issue.slug,
            g: generated,
            f: fallback,
            w: withheld.length,
            e: errors.length,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    community: {
      description:
        "Read the week's podcast episodes and community feed posts. A source that fails is recorded, not thrown: the issue says it is unavailable.",
      arguments: z.object({}),
      execute: async (_args: Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const issue = await mustRead<Issue>(ctx, "issue", "collect");
        const w = {
          start: issue.start,
          end: issue.end,
          firstDay: issue.slug,
          lastDay: issue.lastDay,
        };
        const errors: string[] = [];
        async function source<T>(
          what: string,
          url: string | undefined,
          get: (url: string) => Promise<T[]>,
        ) {
          if (!url) {
            return { configured: false, ok: true, error: null, items: [] };
          }
          try {
            return {
              configured: true,
              ok: true,
              error: null,
              items: await get(url),
            };
          } catch (err) {
            const error = `${what}: ${String(err).slice(0, 300)}`;
            errors.push(error);
            ctx.logger.warn("Community source failed: {error}", { error });
            return { configured: true, ok: false, error, items: [] as T[] };
          }
        }
        const podcast = await source(
          "podcast",
          g.podcastSitemapUrl,
          (u) => fetchPodcast(u, w, _args._fetch),
        );
        const feed = await source(
          "feed",
          g.communityFeedUrl,
          (u) => fetchFeed(u, w, _args._fetch),
        );
        ctx.logger.info(
          "Community for {slug}: {p} podcast episodes, {f} feed posts, {e} errors",
          {
            slug: issue.slug,
            p: podcast.items.length,
            f: feed.items.length,
            e: errors.length,
          },
        );
        const handle = await ctx.writeResource("community", "community", {
          slug: issue.slug,
          podcast,
          feed,
          errors,
        });
        return { dataHandles: [handle] };
      },
    },

    render: {
      description:
        "Render the issue page and its JSON copy, the index, feed, llms.txt, sitemap and Discord payload; optionally write the site to a directory",
      arguments: z.object({
        outDir: z.string().optional().describe(
          "Absolute directory to also write the site files into (for previewing)",
        ),
        minorUpdates: z.enum(["list", "count", "drop"]).optional().describe(
          "Override the minorUpdates global argument for this render (previews)",
        ),
      }),
      execute: async (
        args: { outDir?: string; minorUpdates?: "list" | "count" | "drop" },
        ctx: Ctx,
      ) => {
        const g = ctx.globalArgs;
        const issue = await mustRead<Issue>(ctx, "issue", "collect");
        const sums = await mustRead<Summaries>(ctx, "summaries", "summarize");
        if (sums.slug !== issue.slug) {
          throw new Error(
            `summaries are for ${sums.slug} but the issue is ${issue.slug}: run summarize again`,
          );
        }
        const archive = (await read<Archive>(ctx, "archive"))?.issues ?? [];
        const wantsCommunity = Boolean(
          g.communityFeedUrl || g.podcastSitemapUrl,
        );
        const comm = wantsCommunity
          ? await mustRead<CommunityData>(ctx, "community", "community")
          : null;
        if (comm && comm.slug !== issue.slug) {
          throw new Error(
            `community is for ${comm.slug} but the issue is ${issue.slug}: run community again`,
          );
        }
        const community = comm
          ? { podcast: comm.podcast, feed: comm.feed }
          : undefined;
        const cfg = siteConfig(g);
        const items = issue.items as Item[];
        const opts = {
          minorMode: args.minorUpdates ?? g.minorUpdates,
          minChangedLines: g.minChangedLines,
        };
        const meta = {
          slug: issue.slug,
          start: issue.start,
          end: issue.end,
          lastDay: issue.lastDay,
          generatedAt: issue.generatedAt,
        };
        // The index and feed include this issue, as they will once it is committed.
        const withThis: ArchiveEntry[] = [
          ...archive.filter((a) => a.slug !== issue.slug) as ArchiveEntry[],
          { slug: issue.slug, lastDay: issue.lastDay, counts: counts(items) },
        ];
        const files: Record<string, string> = {
          [`issues/${issue.slug}.html`]: renderIssue(
            cfg,
            meta,
            items,
            sums.summaries,
            opts,
            withThis,
            community,
          ),
          [`issues/${issue.slug}.json`]: renderIssueJson(
            cfg,
            meta,
            items,
            sums.summaries,
            opts,
            withThis,
            community,
          ),
          "site.css": renderStylesheet(cfg),
          "index.html": renderIndex(cfg, withThis),
          "index.json": renderIndexJson(cfg, withThis),
          "feed.xml": renderFeed(cfg, withThis),
          "llms.txt": renderLlmsTxt(cfg, withThis),
          "robots.txt": renderRobots(cfg),
          "sitemap.xml": renderSitemap(cfg, withThis),
          ".nojekyll": "",
        };
        const assets = g.siteAssetsDir
          ? await readSiteAssets(g.siteAssetsDir)
          : {};
        for (
          const [arg, path] of [
            ["bannerImage", g.bannerImage],
            ["bannerImageSmall", g.bannerImageSmall],
            ["displayFont", g.displayFont],
          ] as const
        ) {
          if (path === undefined) continue;
          if (!sitePath(path)) {
            throw new Error(`${arg} must be a plain site-relative path`);
          }
          if (!(path in assets)) {
            throw new Error(`${arg} ${path} is not in siteAssetsDir`);
          }
        }
        for (const path of Object.keys(assets)) {
          if (path in files) {
            throw new Error(`siteAssetsDir: ${path} collides with a page`);
          }
        }
        const discord: DiscordPayload = renderDiscord(
          cfg,
          meta,
          items,
          1900,
          opts,
          community,
        );

        if (args.outDir) {
          if (!args.outDir.startsWith("/")) {
            throw new Error("outDir must be an absolute path");
          }
          for (const [path, content] of Object.entries(files)) {
            const full = `${args.outDir.replace(/\/+$/, "")}/${path}`;
            await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), {
              recursive: true,
            });
            await Deno.writeTextFile(full, content);
          }
          for (const [path, b64] of Object.entries(assets)) {
            const full = `${args.outDir.replace(/\/+$/, "")}/${path}`;
            await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), {
              recursive: true,
            });
            await Deno.writeFile(full, decodeBase64(b64));
          }
          await Deno.writeTextFile(
            `${args.outDir.replace(/\/+$/, "")}/discord.json`,
            JSON.stringify(discord, null, 2),
          );
          ctx.logger.info("Wrote {n} files to {dir}", {
            n: Object.keys(files).length + 1,
            dir: args.outDir,
          });
        }
        const handle = await ctx.writeResource("rendered", "rendered", {
          slug: issue.slug,
          files,
          discord,
          outDir: args.outDir ?? null,
          assets,
        });
        return { dataHandles: [handle] };
      },
    },

    publish: {
      description:
        "Commit the rendered site to the Pages branch. Dry-run unless dryRun is false.",
      arguments: z.object({ dryRun: z.boolean().default(true) }),
      execute: async (args: { dryRun: boolean } & Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const r = await mustRead<Rendered>(ctx, "rendered", "render");
        const assets = r.assets ?? {};
        const files = [...Object.keys(r.files), ...Object.keys(assets)].sort();
        let result: Publication = {
          slug: r.slug,
          dryRun: args.dryRun,
          repo: g.githubRepo ?? null,
          branch: g.githubBranch,
          commitSha: null,
          commitUrl: null,
          files,
          at: new Date().toISOString(),
        };
        if (args.dryRun) {
          ctx.logger.info(
            "DRY RUN: would commit {n} files to {repo}@{branch}: {files}",
            {
              n: files.length,
              repo: g.githubRepo ?? "(githubRepo unset)",
              branch: g.githubBranch,
              files: files.join(", "),
            },
          );
        } else {
          if (!g.githubRepo || !g.githubToken) {
            throw new Error("publish needs githubRepo and githubToken");
          }
          const res = await publishFiles(
            {
              repo: g.githubRepo,
              branch: g.githubBranch,
              token: g.githubToken,
            },
            r.files,
            `Issue ${r.slug}`,
            args._fetch,
            assets,
          );
          result = {
            ...result,
            commitSha: res.commitSha,
            commitUrl: res.commitUrl,
          };
          ctx.logger.info("Published {slug} as {url}", {
            slug: r.slug,
            url: res.commitUrl,
          });
        }
        return {
          dataHandles: [
            await ctx.writeResource("publication", "publication", result),
          ],
        };
      },
    },

    announce: {
      description:
        "Post the issue announcement to the Discord webhook. Dry-run unless dryRun is false.",
      arguments: z.object({ dryRun: z.boolean().default(true) }),
      execute: async (args: { dryRun: boolean } & Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const r = await mustRead<Rendered>(ctx, "rendered", "render");
        let result: Announcement = {
          slug: r.slug,
          dryRun: args.dryRun,
          status: null,
          messageId: null,
          content: r.discord.content,
          at: new Date().toISOString(),
        };
        if (args.dryRun) {
          ctx.logger.info("DRY RUN: would post {n} chars to Discord", {
            n: r.discord.content.length,
          });
        } else {
          if (!g.discordWebhookUrl) {
            throw new Error("announce needs discordWebhookUrl");
          }
          const url = new URL(g.discordWebhookUrl);
          if (
            url.protocol !== "https:" ||
            !/(^|\.)discord(app)?\.com$/.test(url.hostname)
          ) {
            throw new Error(
              "discordWebhookUrl must be an https discord.com webhook URL",
            );
          }
          url.searchParams.set("wait", "true");
          const res = await (args._fetch ?? fetch)(url.toString(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(r.discord),
            signal: AbortSignal.timeout(15000),
          });
          const text = await res.text();
          if (!res.ok) {
            // Never echo the URL: it is the credential.
            throw new Error(
              `Discord webhook answered HTTP ${res.status}: ${
                text.slice(0, 200)
              }`,
            );
          }
          let id: string | null = null;
          try {
            id = String(JSON.parse(text).id ?? "") || null;
          } catch { /* wait=true returns JSON; tolerate an empty body */ }
          result = { ...result, status: res.status, messageId: id };
          ctx.logger.info("Announced {slug} on Discord (message {id})", {
            slug: r.slug,
            id: id ?? "?",
          });
        }
        return {
          dataHandles: [
            await ctx.writeResource("announcement", "announcement", result),
          ],
        };
      },
    },

    commit: {
      description:
        "Advance the high-water mark, keep the catalog snapshot and archive the issue. Refuses unless publish and announce really ran for it.",
      arguments: z.object({}),
      execute: async (_args: Seams, ctx: Ctx) => {
        const g = ctx.globalArgs;
        const issue = await mustRead<Issue>(ctx, "issue", "collect");
        const pending = await mustRead<Catalog>(
          ctx,
          "catalogPending",
          "collect",
        );
        const pub = await mustRead<Publication>(
          ctx,
          "publication",
          "publish --arg dryRun=false",
        );
        const ann = await mustRead<Announcement>(
          ctx,
          "announcement",
          "announce --arg dryRun=false",
        );
        const problems: string[] = [];
        if (pending.forSlug !== issue.slug) {
          problems.push(`catalog snapshot is for ${pending.forSlug}`);
        }
        if (pub.slug !== issue.slug || pub.dryRun || !pub.commitSha) {
          problems.push("issue was not published");
        }
        if (ann.slug !== issue.slug || ann.dryRun || !ann.status) {
          problems.push("issue was not announced");
        }
        if (problems.length) {
          throw new Error(
            `refusing to commit issue ${issue.slug}: ${problems.join("; ")}`,
          );
        }

        const archive = (await read<Archive>(ctx, "archive"))?.issues ?? [];
        const handles = [
          await ctx.writeResource("catalog", "catalog", pending),
          await ctx.writeResource("archive", "archive", {
            issues: [
              ...archive.filter((a) => a.slug !== issue.slug),
              {
                slug: issue.slug,
                lastDay: issue.lastDay,
                counts: issue.counts,
              },
            ],
          }),
          await ctx.writeResource("cursor", "cursor", {
            lastSlug: issue.slug,
            lastEnd: issue.end,
            committedAt: new Date().toISOString(),
          }),
        ];
        ctx.logger.info("Committed issue {slug}; next issue starts {end}", {
          slug: issue.slug,
          end: issue.end,
        });

        if (g.heartbeatUrl) {
          // The deadman signal. Visible when it fails, never fatal: the issue is out.
          try {
            const res = await (_args._fetch ?? fetch)(g.heartbeatUrl, {
              signal: AbortSignal.timeout(10000),
            });
            await res.body?.cancel();
            if (!res.ok) {
              ctx.logger.warn("Heartbeat answered HTTP {s}", { s: res.status });
            }
          } catch (err) {
            ctx.logger.warn("Heartbeat failed: {err}", {
              err: String(err).replace(/https?:\/\/\S+/g, "<url>"),
            });
          }
        }
        return { dataHandles: handles };
      },
    },
  },
};

/** New first, then families, then updates that change the API, then the rest. */
function significance(item: Item): number {
  if (item.section === "new") return 1000;
  if (item.collapsed) return 900;
  const e = item.entries[0];
  const api = e.methodsAdded.length + e.methodsRemoved.length;
  const base = item.section === "updated" ? 100 : 0;
  return base + Math.min(api, 50) * 10 + Math.min(e.versions.length, 9);
}

function deterministic(item: Item): string {
  const e = item.entries[0];
  if (item.collapsed) {
    return `${item.entries.length} packages in this family ${
      item.section === "yanked" ? "had versions yanked" : "were removed"
    }.`;
  }
  if (item.section === "yanked") return `Version ${e.toVersion} was yanked.`;
  return "No longer listed in the registry.";
}

async function codeDiff(
  client: RegistryClient,
  e: Entry,
  budget: number,
): Promise<CodeDiff | { error: string }> {
  try {
    const [a, b] = await Promise.all([
      client.download(e.name, e.fromVersion!, 10 * 1024 * 1024),
      client.download(e.name, e.toVersion!, 10 * 1024 * 1024),
    ]);
    return diffArchives(
      await readArchive(a, DEFAULT_LIMITS),
      await readArchive(b, DEFAULT_LIMITS),
      budget,
    );
  } catch (err) {
    return { error: String(err).slice(0, 200) };
  }
}
