// extensions/models/_lib/digest_test.ts
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  candidates,
  entriesFor,
  firstSentence,
  groupItems,
  issueWindow,
  lastWeekBoundary,
  mergeChannels,
} from "./digest.ts";
import type { CatalogEntry, VersionRecord } from "./registry.ts";

const TZ = "America/Los_Angeles";

Deno.test("week boundary is Monday 00:00 Pacific, in PDT and PST", () => {
  // Wed 2026-10-28 10:00 PDT -> Mon 2026-10-26 00:00 PDT = 07:00Z
  assertEquals(
    new Date(lastWeekBoundary(Date.parse("2026-10-28T17:00:00Z"), TZ))
      .toISOString(),
    "2026-10-26T07:00:00.000Z",
  );
  // Wed 2026-12-02 10:00 PST -> Mon 2026-11-30 00:00 PST = 08:00Z
  assertEquals(
    new Date(lastWeekBoundary(Date.parse("2026-12-02T18:00:00Z"), TZ))
      .toISOString(),
    "2026-11-30T08:00:00.000Z",
  );
  // Exactly on the boundary counts as that boundary.
  assertEquals(
    new Date(lastWeekBoundary(Date.parse("2026-10-26T07:00:00Z"), TZ))
      .toISOString(),
    "2026-10-26T07:00:00.000Z",
  );
  // One second before is still the previous week.
  assertEquals(
    new Date(lastWeekBoundary(Date.parse("2026-10-26T06:59:59Z"), TZ))
      .toISOString(),
    "2026-10-19T07:00:00.000Z",
  );
});

Deno.test("first issue backfills one local week, across the DST change", () => {
  // Week of Mon 2026-11-02 PST back to Mon 2026-10-26 PDT (DST ended Nov 1).
  const w = issueWindow(Date.parse("2026-11-02T17:00:00Z"), TZ, null);
  assertEquals(w.start, "2026-10-26T07:00:00.000Z");
  assertEquals(w.end, "2026-11-02T08:00:00.000Z");
  assertEquals(w.slug, "2026-10-26");
  assertEquals(w.lastDay, "2026-11-01");
});

Deno.test("later issues start at the high-water mark, folding a missed week in", () => {
  const w = issueWindow(
    Date.parse("2026-11-16T17:00:00Z"),
    TZ,
    "2026-11-02T08:00:00.000Z",
  );
  assertEquals(w.start, "2026-11-02T08:00:00.000Z");
  assertEquals(w.end, "2026-11-16T08:00:00.000Z");
  assertEquals(w.slug, "2026-11-02");
  assertEquals(w.lastDay, "2026-11-15");
});

Deno.test("an already-covered week refuses instead of publishing an empty issue", () => {
  assertThrows(
    () =>
      issueWindow(
        Date.parse("2026-11-03T17:00:00Z"),
        TZ,
        "2026-11-02T08:00:00.000Z",
      ),
    Error,
    "nothing to publish",
  );
});

const W = {
  start: "2026-10-19T07:00:00.000Z",
  end: "2026-10-26T07:00:00.000Z",
  slug: "2026-10-19",
  lastDay: "2026-10-25",
};

function cat(name: string, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    name,
    description: "Does a thing. And more.",
    labels: [],
    repository: "https://github.com/x/y",
    repositoryVerified: true,
    latestVersion: "2026.10.20.1",
    latestBeta: null,
    latestRc: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    ...over,
  };
}

function ver(
  version: string,
  publishedAt: string,
  over: Partial<VersionRecord> = {},
): VersionRecord {
  return {
    version,
    publishedAt,
    channel: "stable",
    yankedAt: null,
    yankReason: null,
    releaseNotes: null,
    labels: [],
    diff: null,
    models: [],
    ...over,
  };
}

Deno.test("candidates: updated in window, versions moved, and removed", () => {
  const current = mergeChannels(
    [
      cat("@a/fresh"),
      cat("@a/old", { updatedAt: "2026-09-01T00:00:00Z" }),
      cat("@a/rolledback", {
        updatedAt: "2026-09-01T00:00:00Z",
        latestVersion: "2026.09.01.1",
      }),
    ],
    [],
    [],
  );
  const previous = [
    {
      name: "@a/old",
      latestVersion: "2026.10.20.1",
      latestBeta: null,
      latestRc: null,
      updatedAt: "2026-09-01T00:00:00Z",
      labels: [],
    },
    {
      name: "@a/rolledback",
      latestVersion: "2026.10.21.1",
      latestBeta: null,
      latestRc: null,
      updatedAt: "2026-09-01T00:00:00Z",
      labels: [],
    },
    {
      name: "@a/gone",
      latestVersion: "1",
      latestBeta: null,
      latestRc: null,
      updatedAt: "2026-09-01T00:00:00Z",
      labels: [],
    },
  ];
  const c = candidates(current, previous, W);
  assertEquals(c.changed, ["@a/fresh", "@a/rolledback"]);
  assertEquals(c.removed.map((r) => r.name), ["@a/gone"]);
});

Deno.test("mergeChannels drops names that are not valid extension names", () => {
  const m = mergeChannels(
    [cat("@ok/name"), cat("<script>"), cat("@x/<b>")],
    [],
    [],
  );
  assertEquals([...m.keys()], ["@ok/name"]);
});

Deno.test("entriesFor: update collapses repeat bumps and diffs methods against the pre-window baseline", () => {
  const history = [
    ver("3", "2026-10-22T00:00:00Z", {
      models: [{ type: "@a/x", methods: ["get", "sync"] }],
      diff: { summary: "Added 1 behaviors" },
    }),
    ver("2", "2026-10-20T00:00:00Z", {
      models: [{ type: "@a/x", methods: ["get"] }],
    }),
    ver("1", "2026-10-01T00:00:00Z", {
      models: [{ type: "@a/x", methods: ["get", "old"] }],
    }),
  ];
  const [e] = entriesFor(cat("@a/x"), history, W);
  assertEquals(e.section, "updated");
  assertEquals(e.fromVersion, "1");
  assertEquals(e.toVersion, "3");
  assertEquals(e.versions, ["2", "3"]);
  assertEquals(e.methodsAdded, ["@a/x.sync"]);
  assertEquals(e.methodsRemoved, ["@a/x.old"]);
  assertEquals(e.registrySummary, "Added 1 behaviors");
  assertEquals(e.description, "Does a thing.");
});

Deno.test("entriesFor: new, pre-release and yank are separate sections", () => {
  const created = cat("@a/n", { createdAt: "2026-10-20T00:00:00Z" });
  const [n] = entriesFor(created, [
    ver("1", "2026-10-20T00:00:00Z", { models: [{ methods: ["run"] }] }),
  ], W);
  assertEquals(n.section, "new");
  assertEquals(n.methodsAdded, ["run"]);

  const es = entriesFor(cat("@a/p"), [
    ver("5-beta", "2026-10-23T00:00:00Z", { channel: "beta" }),
    ver("4", "2026-10-21T00:00:00Z"),
    ver("3", "2026-10-02T00:00:00Z", {
      yankedAt: "2026-10-22T00:00:00Z",
      yankReason: "broken",
    }),
    ver("2", "2026-10-01T00:00:00Z"),
  ], W);
  assertEquals(es.map((e) => e.section).sort(), [
    "prerelease",
    "updated",
    "yanked",
  ]);
  const y = es.find((e) => e.section === "yanked")!;
  assertEquals([y.toVersion, y.reason], ["3", "broken"]);
  // The yanked version is never a diff baseline.
  assertEquals(es.find((e) => e.section === "updated")!.fromVersion, "2");
});

Deno.test("entriesFor: versions after the window belong to the next issue", () => {
  assertEquals(
    entriesFor(cat("@a/x"), [
      ver("2", "2026-10-26T08:00:00Z"),
      ver("1", "2026-10-01T00:00:00Z"),
    ], W),
    [],
  );
});

Deno.test("groupItems collapses a family at the threshold, per section", () => {
  const mk = (name: string, section: "updated" | "new") => ({
    ...entriesFor(cat(name), [
      ver("2", "2026-10-20T00:00:00Z"),
      ver("1", "2026-10-01T00:00:00Z"),
    ], W)[0],
    section,
  });
  const items = groupItems([
    mk("@swamp/aws/ec2", "updated"),
    mk("@swamp/aws/ecs", "updated"),
    mk("@swamp/aws/efs", "updated"),
    mk("@swamp/aws/s3", "new"),
    mk("@solo/thing", "updated"),
  ], 3);
  assertEquals(
    items.map((i) => [i.section, i.key, i.collapsed, i.entries.length]),
    [
      ["new", "@swamp/aws/s3", false, 1],
      ["updated", "@solo/thing", false, 1],
      ["updated", "@swamp/aws", true, 3],
    ],
  );
});

Deno.test("firstSentence flattens and caps", () => {
  assertEquals(firstSentence("One\nline. Two."), "One line.");
  const long = firstSentence("x".repeat(400), 50);
  assert(long.length === 50 && long.endsWith("…"));
});
