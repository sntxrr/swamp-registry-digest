/**
 * Pure digest logic: the issue window, catalog diffing, classification and
 * family collapsing. No I/O, so every rule here is unit-tested directly.
 *
 * @module
 */

import {
  type CatalogEntry,
  isValidName,
  methodSet,
  type VersionRecord,
} from "./registry.ts";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

/** Offset of `timeZone` from UTC at `instant`, in ms (PDT is -7h). */
function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock calendar date of `instant` in `timeZone`. */
export function localDate(
  instant: number,
  timeZone: string,
): { y: number; m: number; d: number; dow: number } {
  const local = new Date(instant + tzOffsetMs(instant, timeZone));
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
  };
}

/** The UTC instant of local midnight on y-m-d in `timeZone` (DST-safe). */
export function localMidnight(
  y: number,
  m: number,
  d: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, timeZone);
  // A second pass settles the offset when the guess straddled a DST change.
  t = guess - tzOffsetMs(t, timeZone);
  return t;
}

/**
 * Start of the most recent week boundary at or before `now`: local midnight
 * of the latest `weekStartsOn` day (0 = Sunday, 1 = Monday).
 */
export function lastWeekBoundary(
  now: number,
  timeZone: string,
  weekStartsOn = 1,
): number {
  const { y, m, d, dow } = localDate(now, timeZone);
  const back = (dow - weekStartsOn + 7) % 7;
  const day = new Date(Date.UTC(y, m - 1, d) - back * DAY_MS);
  return localMidnight(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    timeZone,
  );
}

/** `YYYY-MM-DD` of `instant` in `timeZone`. */
export function isoLocalDate(instant: number, timeZone: string): string {
  const { y, m, d } = localDate(instant, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface IssueWindow {
  /** Inclusive start, ISO UTC. */
  start: string;
  /** Exclusive end, ISO UTC. */
  end: string;
  /** Local date of the first day, used as the issue slug. */
  slug: string;
  /** Local date of the last day included. */
  lastDay: string;
}

/**
 * The window the next issue covers.
 *
 * It ends at the latest week boundary and starts where the previous issue
 * ended (the high-water mark), so a missed week is folded into the next issue
 * instead of being dropped. With no previous issue it backfills one week.
 */
export function issueWindow(
  now: number,
  timeZone: string,
  previousEnd: string | null,
  weekStartsOn = 1,
): IssueWindow {
  const end = lastWeekBoundary(now, timeZone, weekStartsOn);
  const start = previousEnd ? Date.parse(previousEnd) : end - 7 * DAY_MS;
  if (!Number.isFinite(start)) {
    throw new Error(`previous issue end is not a timestamp: ${previousEnd}`);
  }
  if (start >= end) {
    throw new Error(
      `nothing to publish: the previous issue already covers up to ${
        new Date(start).toISOString()
      } ` +
        `and the current week ends ${new Date(end).toISOString()}`,
    );
  }
  // Correct for a start that lands across a DST change from end - 7 days.
  const startLocal = localDate(start + DAY_MS / 2, timeZone);
  const startMidnight = previousEnd
    ? start
    : localMidnight(startLocal.y, startLocal.m, startLocal.d, timeZone);
  return {
    start: new Date(startMidnight).toISOString(),
    end: new Date(end).toISOString(),
    slug: isoLocalDate(startMidnight + DAY_MS / 2, timeZone),
    lastDay: isoLocalDate(end - DAY_MS / 2, timeZone),
  };
}

export function inWindow(
  ts: string | null | undefined,
  w: IssueWindow,
): boolean {
  return !!ts && ts >= w.start && ts < w.end;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** The slice of a catalog row kept between runs to detect changes. */
export interface CatalogRow {
  name: string;
  latestVersion: string | null;
  latestBeta: string | null;
  latestRc: string | null;
  updatedAt: string;
  labels: string[];
}

export const OPT_OUT_LABEL = "no-digest";

export function mergeChannels(
  stable: CatalogEntry[],
  beta: CatalogEntry[],
  rc: CatalogEntry[],
): Map<string, CatalogEntry> {
  const out = new Map<string, CatalogEntry>();
  for (const list of [stable, beta, rc]) {
    for (const e of list) {
      if (!isValidName(e.name)) continue;
      const prev = out.get(e.name);
      if (!prev) {
        out.set(e.name, { ...e });
        continue;
      }
      prev.latestVersion ??= e.latestVersion;
      prev.latestBeta ??= e.latestBeta;
      prev.latestRc ??= e.latestRc;
      if (e.updatedAt > prev.updatedAt) prev.updatedAt = e.updatedAt;
    }
  }
  return out;
}

export function toRows(catalog: Map<string, CatalogEntry>): CatalogRow[] {
  return [...catalog.values()]
    .map((e) => ({
      name: e.name,
      latestVersion: e.latestVersion,
      latestBeta: e.latestBeta,
      latestRc: e.latestRc,
      updatedAt: e.updatedAt,
      labels: e.labels,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Candidates {
  /** Still listed, and may have versions or yanks in the window. */
  changed: string[];
  /** Listed in the previous snapshot and gone now. */
  removed: CatalogRow[];
}

/**
 * Which extensions need their version history read.
 *
 * `updatedAt` alone misses a version yank (the latest version moves
 * backwards, `updatedAt` does not move forwards) and a whole-extension yank
 * (it drops out of search). Comparing against the previous snapshot catches
 * both.
 */
export function candidates(
  current: Map<string, CatalogEntry>,
  previous: CatalogRow[] | null,
  w: IssueWindow,
): Candidates {
  const prev = new Map((previous ?? []).map((r) => [r.name, r]));
  const changed: string[] = [];
  for (const e of current.values()) {
    const p = prev.get(e.name);
    const versionsMoved = p !== undefined && (
      p.latestVersion !== e.latestVersion ||
      p.latestBeta !== e.latestBeta ||
      p.latestRc !== e.latestRc
    );
    if (e.updatedAt >= w.start || versionsMoved) changed.push(e.name);
  }
  const removed = previous ? previous.filter((r) => !current.has(r.name)) : [];
  return { changed: changed.sort(), removed };
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export type Section =
  | "new"
  | "updated"
  | "prerelease"
  | "yanked"
  | "removed"
  | "minor";

export interface Entry {
  section: Section;
  name: string;
  /** `@collective/group` for names with three or more segments. */
  family: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  channel: string;
  /** Versions published in the window, oldest first. */
  versions: string[];
  description: string;
  labels: string[];
  repository: string | null;
  repositoryVerified: boolean;
  /** The registry's own structural diff summaries, deduplicated. */
  registrySummary: string;
  methodsAdded: string[];
  methodsRemoved: string[];
  releaseNotes: string;
  /** Yank or removal reason, when there is one. */
  reason: string | null;
  /**
   * Changed lines of code and config between fromVersion and toVersion, with
   * version strings, lockfiles, generated code and docs ignored. Null until
   * `classify` measures it, or when it could not be measured.
   */
  changedLines: number | null;
}

export function familyOf(name: string): string | null {
  const parts = name.split("/");
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : null;
}

/** First sentence of a description, capped, as plain text. */
export function firstSentence(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : flat;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Turn one extension's version history into digest entries.
 *
 * An extension can land in several sections at once: a stable update and a
 * yank of an older version in the same week are both news.
 */
export function entriesFor(
  e: CatalogEntry,
  history: VersionRecord[],
  w: IssueWindow,
): Entry[] {
  const out: Entry[] = [];
  const base = {
    name: e.name,
    family: familyOf(e.name),
    description: firstSentence(e.description),
    labels: e.labels,
    repository: e.repository,
    repositoryVerified: e.repositoryVerified,
    reason: null,
    changedLines: null,
  };
  // history is newest first; work oldest first for readability.
  const oldestFirst = [...history].reverse();

  for (const channel of ["stable", "prerelease"] as const) {
    const pick = (v: VersionRecord) =>
      channel === "stable" ? v.channel === "stable" : v.channel !== "stable";
    const inWin = oldestFirst.filter((v) =>
      pick(v) && inWindow(v.publishedAt, w) && !v.yankedAt
    );
    if (inWin.length === 0) continue;
    const newest = inWin[inWin.length - 1];
    // Baseline: the newest version of any channel published before the window.
    const before = history.find((v) =>
      v.publishedAt < w.start && !v.yankedAt
    ) ?? null;
    const isNew = channel === "stable" && inWindow(e.createdAt, w) &&
      before === null;
    const nowMethods = methodSet(newest);
    const thenMethods = methodSet(before);
    const summaries = [
      ...new Set(
        inWin.map((v) => v.diff?.summary?.trim()).filter((s): s is string =>
          !!s
        ),
      ),
    ];
    out.push({
      ...base,
      section: isNew ? "new" : channel === "stable" ? "updated" : "prerelease",
      fromVersion: before?.version ?? null,
      toVersion: newest.version,
      channel: channel === "stable" ? "stable" : newest.channel,
      versions: inWin.map((v) => v.version),
      registrySummary: summaries.join("; "),
      // A first release "adds" every method it has; that is what it does.
      methodsAdded: [...nowMethods].filter((m) => !thenMethods.has(m)).sort(),
      methodsRemoved: before
        ? [...thenMethods].filter((m) => !nowMethods.has(m)).sort()
        : [],
      releaseNotes: inWin.map((v) => v.releaseNotes ?? "").filter(Boolean).join(
        "\n\n",
      ),
    });
  }

  for (const v of oldestFirst) {
    if (!inWindow(v.yankedAt, w)) continue;
    out.push({
      ...base,
      section: "yanked",
      fromVersion: null,
      toVersion: v.version,
      channel: v.channel,
      versions: [v.version],
      registrySummary: "",
      methodsAdded: [],
      methodsRemoved: [],
      releaseNotes: "",
      reason: v.yankReason,
    });
  }
  return out;
}

export function removedEntry(row: CatalogRow, reason: string | null): Entry {
  return {
    section: "removed",
    name: row.name,
    family: familyOf(row.name),
    fromVersion: row.latestVersion,
    toVersion: null,
    channel: "stable",
    versions: [],
    description: "",
    labels: row.labels,
    repository: null,
    repositoryVerified: false,
    registrySummary: "",
    methodsAdded: [],
    methodsRemoved: [],
    releaseNotes: "",
    reason,
    changedLines: null,
  };
}

/** The registry or the method list says the shape of the extension changed. */
export function isStructural(e: Entry): boolean {
  return e.methodsAdded.length > 0 || e.methodsRemoved.length > 0 ||
    e.registrySummary.trim().length > 0;
}

/**
 * Whether an update or pre-release deserves a full line: it changed the API
 * or structure, or it changed at least `minLines` lines of real code. An
 * update whose size could not be measured stays significant, because hiding
 * a release on a failed download is worse than showing a bump.
 */
export function isSignificant(e: Entry, minLines: number): boolean {
  if (e.section !== "updated" && e.section !== "prerelease") return true;
  if (isStructural(e)) return true;
  if (e.changedLines === null) return true;
  return e.changedLines >= minLines;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** One line in the digest: a single extension or a collapsed family. */
export interface Item {
  section: Section;
  /** Extension name, or the family prefix when collapsed. */
  key: string;
  collapsed: boolean;
  entries: Entry[];
}

export const SECTION_ORDER: Section[] = [
  "new",
  "updated",
  "prerelease",
  "yanked",
  "removed",
  "minor",
];

/**
 * Collapse families. A family with at least `threshold` members in one section
 * becomes a single line ("`@swamp/gcp`: 40 packages updated"), which is what
 * keeps a bulk regeneration from burying everything else.
 */
export function groupItems(entries: Entry[], threshold = 3): Item[] {
  const items: Item[] = [];
  for (const section of SECTION_ORDER) {
    const inSection = entries.filter((e) => e.section === section);
    const byFamily = new Map<string, Entry[]>();
    for (const e of inSection) {
      if (!e.family) continue;
      byFamily.set(e.family, [...(byFamily.get(e.family) ?? []), e]);
    }
    const collapsedNames = new Set<string>();
    for (const [family, members] of byFamily) {
      if (members.length < threshold) continue;
      members.sort((a, b) => a.name.localeCompare(b.name));
      items.push({ section, key: family, collapsed: true, entries: members });
      for (const m of members) collapsedNames.add(m.name);
    }
    for (const e of inSection) {
      if (collapsedNames.has(e.name)) continue;
      items.push({ section, key: e.name, collapsed: false, entries: [e] });
    }
  }
  return items.sort((a, b) =>
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    a.key.localeCompare(b.key)
  );
}

/** Stable id for an item, used to key its summary. */
export function itemId(item: Item): string {
  return `${item.section}:${item.key}`;
}
