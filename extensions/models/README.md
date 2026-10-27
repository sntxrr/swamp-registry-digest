# @sntxrr/registry-digest

A weekly digest of the swamp extension registry: new extensions, updates,
pre-releases (beta and RC), yanked versions and removals, each with a short
summary of what changed, plus (optionally) the week's podcast episode and
community feed posts. It renders a static site (one dated page per issue with
a JSON copy, an index, an RSS feed, `llms.txt` and a sitemap), commits it to
a GitHub Pages branch, and announces each issue with a Discord webhook.

## Methods

Run in this order, normally from one workflow:

| method      | what it does                                                                                     | remote effect                           |
| ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `collect`   | Snapshots the registry and builds the next issue from every version published or yanked in the window | reads the registry                      |
| `classify`  | Measures each update's real code change and moves those below the threshold to "Minor updates" | downloads both versions of each update |
| `summarize` | Summarizes each item and validates every summary                                                  | runs your summarizer command            |
| `community` | Reads the week's podcast episodes and feed posts; a source that fails is recorded, not thrown    | reads `podcastSitemapUrl`, `communityFeedUrl` |
| `render`    | Renders the issue page and JSON, index, feed, `llms.txt`, sitemap and Discord payload; `outDir` also writes them to disk for preview | none                                   |
| `publish`   | Commits the site to `githubRepo`@`githubBranch` (default `gh-pages`) as one commit               | **only with `dryRun: false`**           |
| `announce`  | Posts the announcement to `discordWebhookUrl`                                                    | **only with `dryRun: false`**           |
| `commit`    | Advances the high-water mark, keeps the catalog snapshot, archives the issue, pings `heartbeatUrl` | refuses unless publish and announce really ran |

### The window

An issue covers whole weeks in `timeZone` (default `America/Los_Angeles`),
starting on `weekStartsOn` (default Monday). Each issue starts where the
previous one ended. A missed week is folded into the next issue rather than
dropped, and the first issue backfills one week.

Version history is read for every extension whose `updatedAt` moved, or whose
latest version changed since the previous snapshot. Yanks don't move
`updatedAt`, which is why the snapshot is needed. Extensions that vanish from
the catalog are reported as removed, with the registry's yank or deprecation
reason when it gives one.

### Significant updates and minor updates

Most weekly releases are version bumps. An update or pre-release gets a full
line (and a summary) only when it is **significant**:

- it adds or removes a method or resource, or the registry reports a
  structural change (files, dependencies, labels), or
- `classify` measures at least `minChangedLines` (default 10) changed lines of
  code or config between the previous and the new version. Version strings
  (any CalVer literal, the manifest `version:` line), lockfiles, generated or
  vendored files and docs are ignored.

Everything else is a **minor update**: never summarized, and shown according
to `minorUpdates`: `list` (one compact section of names), `count` (only how
many), or `drop` (not at all). An update that could not be measured (a failed
download) stays significant, because hiding a release is worse than showing
a bump. A family splits: members that really changed keep a family line, and
its bumps become one minor line.

### Families

A family of at least `familyThreshold` (default 3) names under one
`@collective/group/` prefix that changed in the same section becomes one line:
"`@swamp/aws`: 293 packages". In the Discord post, a collective with three or
more new extensions is grouped the same way.

### Community sections

Two optional sources, each off until its argument is set:

- **`communityFeedUrl`**: an RSS feed (e.g. `https://swamp-club.com/feed.xml`).
  Posts whose `pubDate` falls in the window get a section, linked to their
  permalink (the item's `guid`) on the feed's own site.
- **`podcastSitemapUrl`**: a sitemap listing `/podcast/YYYY-MM-DD` episode
  pages (e.g. `https://swamp-club.com/sitemap.xml`). Episodes dated inside the
  window are read from their schema.org `PodcastEpisode` JSON-LD and linked,
  with their YouTube video when the page has one.

If a source cannot be read, the issue says "could not be read this week" and
still goes out; the error is kept in the `community` data (`errors`) so the
caller can alert on it. Videos and episodes are links, never embeds: the page
CSP allows no frames.

### For agents

Every issue is also published as `issues/<first-day>.json` with the same
content (`schemaVersion: 1`), linked from the page with `rel="alternate"`.
`index.json` lists every issue, `llms.txt` describes the site and points at
both, each issue page carries schema.org `Article` JSON-LD, and `robots.txt`
and `sitemap.xml` are generated. Each page links to the previous week and
lists the eight before it.

## Opting out

Authors can leave the digest by adding the label **`no-digest`** to their
extension. An opted-out extension is left out entirely: no line, no summary.
The label is read from the current catalog on every run.

## Security: registry content is untrusted

Descriptions, release notes and code are written by anyone who can publish.
The digest assumes any of it may be hostile.

- **Every summary is validated before publication.** A summary that contains
  a URL, a domain, a markdown link, HTML, a code fence, `@everyone`/`@here` or
  a Discord mention, or that is too long, is replaced with "Summary withheld"
  and recorded in the `summaries` data with the reason.
- **Every registry string is escaped**, on the page and in Discord. The page
  sends a `Content-Security-Policy` that allows no scripts. Links go only to
  the registry page and, when the registry verified it, the repository.
- **Discord posts cannot ping anyone:** `allowed_mentions: {"parse": []}`,
  and link previews are suppressed.
- **Community text is third-party too.** Feed and podcast titles and
  descriptions never reach the summarizer. They are decoded, stripped of
  control characters, length-capped and escaped. Post links must be https on
  the feed's own site, episode pages must be on the sitemap's site, and a
  video must parse as a YouTube video id; the URL is rebuilt from that id.
- **Archives are read in memory only**, with caps on compressed size,
  decompressed size and per-file size. Nothing from an archive is written to
  disk.

### The summarizer must have no tools

`summarizer: command` runs `summarizerCommand` once per item, with the prompt
on **stdin** (never argv), in an empty temporary directory. Only the
variables listed in `summarizerPassEnv` are passed; everything else is
cleared. The command must be text in, text out. **Do not give it tools.** A
summarizer that can run commands, read files or fetch URLs lets anyone who
publishes an extension act on your machine.

With Claude Code:

```yaml
summarizer: command
summarizerCommand:
  - /path/to/claude
  - "-p"
  - "--model"
  - claude-haiku-5-5         # pin a small model; the default may be the largest
  - "--tools"
  - ""                       # no tools at all
  - "--setting-sources"
  - ""                       # ignore every settings file, so no allow rules are merged in
  - "--strict-mcp-config"    # no MCP servers
  - "--disable-slash-commands"
  - "--output-format"
  - json
```

Pin `--model`. Without it, `claude -p` uses the account default (measured: the
largest model). On a subscription, every call counts against the same usage
limits as your interactive sessions.

`--tools ""` alone is not enough if settings files are loaded: allow rules from
user and project settings are merged with the command line. Keep
`--setting-sources ""`.

**Prove it before the first real run**, and again after any change to the
command or to Claude Code:

```bash
deno run --allow-run --allow-env --allow-read --allow-write \
  scripts/injection_check.ts /path/to/claude
```

This builds a real prompt around an extension whose description, release
notes and diff try to make the model run a command and post a link. It passes
only if the model is offered zero tools, makes zero tool calls, the canary
file is never created, and the production path either produces a clean
summary or withholds it. `--negative-control` offers the model `Bash`, and the
check must then **fail**.

**Better: gate every run on it.** Claude Code updates itself, so a check that
passed last week proves nothing about this week. `--command-json='[...]'`
tests the exact deployed `summarizerCommand` (pass it from
`swamp model get <name> --json`). Run it before the workflow and refuse to run
if it fails or cannot run. It costs two small calls.

`summarizer: none` (the default) needs no LLM. It builds summaries from
registry metadata: the registry's own structural diff and the methods that
were added or removed.

## Configuration

Secrets come from a vault (`${{ vault.get(...) }}`) and are marked sensitive:

| argument            | what                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `githubToken`       | fine-grained token with Contents read/write on `githubRepo` only        |
| `discordWebhookUrl` | channel webhook URL (a bearer credential; never logged)                 |
| `heartbeatUrl`      | optional push URL (e.g. Uptime Kuma) pinged after a committed issue     |

Other useful arguments: `siteUrl` (required), `siteTitle`, `disclaimer`,
`maxSummaries` (cap on summarizer calls per issue; the rest get metadata
summaries), `summarizerConcurrency`, `diffBudgetChars`, `familyDiffSample`,
`communityFeedUrl`, `podcastSitemapUrl`.

## Example workflow

Steps in a job run in parallel unless they depend on each other, so each step
depends on the one before it:

```yaml
name: registry-digest
trigger:
  schedule: "0 17 * * 1"  # cron is UTC: Monday 09:00 PST / 10:00 PDT. The window is cut in timeZone regardless.
jobs:
  - name: issue
    steps:
      - name: collect
        task:
          type: behavior
          behavior: digest
          methodName: collect
      - name: classify
        dependsOn:
          - step: collect
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: classify
      - name: summarize
        dependsOn:
          - step: classify
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: summarize
      - name: community
        dependsOn:
          - step: summarize
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: community
      - name: render
        dependsOn:
          - step: community
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: render
      - name: publish
        dependsOn:
          - step: render
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: publish
          inputs:
            dryRun: false
      - name: announce
        dependsOn:
          - step: publish
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: announce
          inputs:
            dryRun: false
      - name: commit
        dependsOn:
          - step: announce
            condition:
              type: succeeded
        task:
          type: behavior
          behavior: digest
          methodName: commit
```

## Registry API

The digest reads the same unauthenticated endpoints as `swamp extension`:
`/api/v1/extensions/search`, `/api/v1/extensions/<name>/versions` and
`/api/v1/extensions/<name>@<version>/download`. It honours `429` with
backoff. The registry rate-limits bursts, so version reads run three at a
time.
