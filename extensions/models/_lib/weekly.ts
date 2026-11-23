/**
 * Swamp Weekly: the swamp team's short Friday video on what shipped in the
 * swamp binary that week. It is posted only as a Discord attachment, which
 * this job cannot fetch, so each video is summarised by hand into one YAML
 * file per video:
 *
 * ```yaml
 * # <swampWeeklyDir>/2026-11-20.yaml -- the filename is the video's date
 * host: Seth
 * url: https://discord.com/channels/<guild>/<channel>/<message>
 * stories:
 *   - title: Restarts that keep your runs going
 *     summary: A planned restart parks each run at a step boundary ...
 *   - title: Many hosted workspaces behind one serve
 *     summary: One service that knows about all your workspaces ...
 *     inProgress: true
 * ```
 *
 * Files are operator-written but the text is still rendered escaped, capped
 * and stripped of control characters, like every other source. A link must be
 * https and is rebuilt without its query string; a Discord attachment link is
 * refused outright, because its signature expires within a day or so and the
 * archived issue would keep a dead link. Link the message instead.
 *
 * @module
 */

import { parse } from "jsr:@std/yaml@1.3.0";
import { z } from "npm:zod@4";
import { cleanText, type Window } from "./community.ts";

export interface WeeklyStory {
  title: string;
  summary: string;
  /** Announced as in progress, not yet shipped. */
  inProgress: boolean;
}

export interface WeeklyEpisode {
  /** YYYY-MM-DD, from the filename. */
  date: string;
  title: string;
  host: string;
  /** Where to watch it, or null. */
  url: string | null;
  stories: WeeklyStory[];
}

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.ya?ml$/;
const EXPIRING_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

const FileSchema = z.strictObject({
  title: z.string().optional(),
  host: z.string().optional(),
  url: z.string().optional(),
  stories: z.array(z.strictObject({
    title: z.string().min(1),
    summary: z.string().optional(),
    inProgress: z.boolean().optional(),
  })).min(1).max(12),
});

/** An https URL with no query or fragment; throws on anything else. */
function watchUrl(u: string, file: string): string {
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    throw new Error(`${file}: url is not a URL`);
  }
  if (p.protocol !== "https:") throw new Error(`${file}: url must be https`);
  if (EXPIRING_HOSTS.has(p.hostname)) {
    throw new Error(
      `${file}: url is a Discord attachment link, which expires; link the message instead`,
    );
  }
  return `${p.origin}${p.pathname}`;
}

/** One video's file. `file` names it in errors. */
export function parseWeekly(
  text: string,
  date: string,
  file = `${date}.yaml`,
): WeeklyEpisode {
  const got = FileSchema.safeParse(parse(text));
  if (!got.success) {
    const first = got.error.issues[0];
    throw new Error(
      `${file}: ${first.path.join(".") || "(file)"}: ${first.message}`,
    );
  }
  const d = got.data;
  return {
    date,
    title: cleanText(d.title, 80) || "Swamp Weekly",
    host: cleanText(d.host, 60),
    url: d.url ? watchUrl(d.url, file) : null,
    stories: d.stories.map((s) => ({
      title: cleanText(s.title, 120),
      summary: cleanText(s.summary, 600),
      inProgress: s.inProgress ?? false,
    })),
  };
}

const realDate = (d: string) =>
  !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) &&
  new Date(`${d}T12:00:00Z`).toISOString().startsWith(d);

/** Videos dated inside the window's calendar days, oldest first. */
export async function readWeekly(
  dir: string,
  w: Window,
): Promise<WeeklyEpisode[]> {
  const found: { date: string; name: string }[] = [];
  for await (const e of Deno.readDir(dir)) {
    const m = e.isFile ? e.name.match(FILE_RE) : null;
    if (!m) continue;
    if (!realDate(m[1])) throw new Error(`${e.name}: not a real date`);
    if (m[1] < w.firstDay || m[1] > w.lastDay) continue;
    found.push({ date: m[1], name: e.name });
  }
  found.sort((a, b) => a.date.localeCompare(b.date));
  const out: WeeklyEpisode[] = [];
  for (const f of found) {
    out.push(
      parseWeekly(
        await Deno.readTextFile(`${dir.replace(/\/+$/, "")}/${f.name}`),
        f.date,
        f.name,
      ),
    );
  }
  return out;
}
