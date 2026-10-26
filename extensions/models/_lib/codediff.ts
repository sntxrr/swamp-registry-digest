/**
 * Text diff between two extension archives.
 *
 * Archives are third-party input. They are unpacked in memory only: nothing is
 * written to disk, so a hostile path (`../../x`) has nowhere to land. Both the
 * decompressed total and each file are capped, so a gzip bomb fails the one
 * entry instead of the run.
 *
 * @module
 */

import { UntarStream } from "jsr:@std/tar@0.1.10/untar-stream";
import { structuredPatch } from "npm:diff@9.0.0";

export interface ArchiveLimits {
  /** Cap on decompressed bytes read from one archive. */
  maxTotalBytes: number;
  /** Files larger than this are listed as changed but not diffed. */
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxTotalBytes: 20 * 1024 * 1024,
  maxFileBytes: 256 * 1024,
};

const TEXT_EXT = /\.(ts|tsx|js|mjs|json|jsonc|ya?ml|md|txt|toml|sh|py)$/i;
// Generated or vendored content says nothing about intent and eats the budget.
const SKIP =
  /(^|\/)(deno\.lock|package-lock\.json|node_modules\/|\.bundle\/|bundles?\/|vendor\/)|\.min\.js$|\.js\.map$/;

/** Path inside the archive, normalised: no leading `./` or `package/`. */
function normalise(path: string): string {
  return path.replace(/^\.?\//, "").replace(/^package\//, "");
}

/** Unpack a `.tar.gz` into a map of text files. */
export async function readArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits = DEFAULT_LIMITS,
): Promise<Map<string, string>> {
  let total = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      total += chunk.byteLength;
      if (total > limits.maxTotalBytes) {
        ctl.error(
          new Error(`archive decompresses past ${limits.maxTotalBytes} bytes`),
        );
        return;
      }
      ctl.enqueue(chunk);
    },
  });
  const files = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const stream = new Blob([bytes as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(counter)
    .pipeThrough(new UntarStream());
  for await (const entry of stream) {
    const path = normalise(entry.path);
    const keep = entry.readable && TEXT_EXT.test(path) && !SKIP.test(path) &&
      entry.header.size <= limits.maxFileBytes;
    if (!keep) {
      await entry.readable?.cancel();
      if (entry.readable && TEXT_EXT.test(path) && !SKIP.test(path)) {
        files.set(
          path,
          `<<file too large to diff: ${entry.header.size} bytes>>`,
        );
      }
      continue;
    }
    const buf = new Uint8Array(
      await new Response(entry.readable).arrayBuffer(),
    );
    files.set(path, decoder.decode(buf));
  }
  return files;
}

export interface CodeDiff {
  added: string[];
  removed: string[];
  modified: string[];
  /** Unified hunks, truncated to the budget. */
  patch: string;
  truncated: boolean;
}

/**
 * Unified diff of two file maps, capped at `budget` characters.
 *
 * Manifest and source files go first, docs last, so a tight budget still
 * shows what the code does.
 */
export function diffArchives(
  before: Map<string, string>,
  after: Map<string, string>,
  budget: number,
): CodeDiff {
  const names = [...new Set([...before.keys(), ...after.keys()])];
  const rank = (p: string) =>
    /manifest\.ya?ml$/.test(p)
      ? 0
      : /\.(ts|tsx|js|mjs|py|sh)$/.test(p)
      ? 1
      : /\.md$/.test(p)
      ? 3
      : 2;
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let patch = "";
  let truncated = false;

  for (const name of names) {
    const a = before.get(name);
    const b = after.get(name);
    if (a === b) continue;
    if (a === undefined) added.push(name);
    else if (b === undefined) removed.push(name);
    else modified.push(name);

    if (truncated) continue;
    const p = structuredPatch(
      `a/${name}`,
      `b/${name}`,
      a ?? "",
      b ?? "",
      "",
      "",
      {
        context: 2,
      },
    );
    let text = `--- a/${name}\n+++ b/${name}\n`;
    for (const h of p.hunks) {
      text +=
        `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${
          h.lines.join("\n")
        }\n`;
    }
    if (patch.length + text.length > budget) {
      const room = budget - patch.length;
      if (room > 200) patch += text.slice(0, room) + "\n<<truncated>>\n";
      truncated = true;
      continue;
    }
    patch += text;
  }
  return { added, removed, modified, patch, truncated };
}
