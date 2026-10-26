// extensions/models/_lib/significance_test.ts
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1.0.19";
import { changedLineCount } from "./codediff.ts";
import { type Entry, groupItems, isSignificant } from "./digest.ts";

const files = (o: Record<string, string>) => new Map(Object.entries(o));

const MODEL = (v: string, body = "") =>
  `export const model = {\n  type: "@a/x",\n  version: "${v}",\n${body}};\n`;

Deno.test("a pure republish measures zero: manifest, model version and CalVer literals", () => {
  const before = files({
    "manifest.yaml": "name: '@a/x'\nversion: \"2026.10.01.1\"\n",
    "x.ts": MODEL("2026.10.01.1"),
  });
  const after = files({
    "manifest.yaml": "name: '@a/x'\nversion: \"2026.10.20.1\"\n",
    "x.ts": MODEL("2026.10.20.1"),
  });
  assertEquals(changedLineCount(before, after), 0);
});

Deno.test("docs-only changes do not count", () => {
  assertEquals(
    changedLineCount(
      files({ "README.md": "a\n" }),
      files({ "README.md": "a\nb\nc\n" }),
    ),
    0,
  );
});

Deno.test("real code changes count added plus removed lines", () => {
  const before = files({ "x.ts": "const a = 1;\nconst b = 2;\n" });
  const after = files({ "x.ts": "const a = 1;\nconst b = 3;\nconst c = 4;\n" });
  assertEquals(changedLineCount(before, after), 3); // -b=2, +b=3, +c=4
});

Deno.test("a new code file counts every line", () => {
  assertEquals(changedLineCount(files({}), files({ "y.ts": "1\n2\n3\n" })), 3);
});

function upd(name: string, over: Partial<Entry> = {}): Entry {
  return {
    section: "updated",
    name,
    family: name.split("/").length >= 3
      ? name.split("/").slice(0, 2).join("/")
      : null,
    fromVersion: "1",
    toVersion: "2",
    channel: "stable",
    versions: ["2"],
    description: "",
    labels: [],
    repository: null,
    repositoryVerified: false,
    registrySummary: "",
    methodsAdded: [],
    methodsRemoved: [],
    releaseNotes: "",
    reason: null,
    changedLines: 0,
    ...over,
  };
}

Deno.test("significance: API, structure or lines; unmeasured stays visible", () => {
  assertFalse(isSignificant(upd("@a/x", { changedLines: 9 }), 10));
  assert(isSignificant(upd("@a/x", { changedLines: 10 }), 10));
  assert(isSignificant(upd("@a/x", { methodsAdded: ["@a/x.sync"] }), 10));
  assert(isSignificant(upd("@a/x", { registrySummary: "updated labels" }), 10));
  assert(isSignificant(upd("@a/x", { changedLines: null }), 10));
  assert(isSignificant({ ...upd("@a/x"), section: "new" }, 10));
});

Deno.test("a family splits: real changes stay in updated, bumps go to minor", () => {
  const members = [
    upd("@swamp/cf/a", { changedLines: 40 }),
    upd("@swamp/cf/b", { changedLines: 25 }),
    upd("@swamp/cf/c", { changedLines: 30 }),
    ...Array.from({ length: 5 }, (_, i) => upd(`@swamp/cf/bump${i}`)),
  ].map((e) => isSignificant(e, 10) ? e : { ...e, section: "minor" as const });
  const items = groupItems(members, 3);
  assertEquals(items.map((i) => [i.section, i.key, i.entries.length]), [
    ["updated", "@swamp/cf", 3],
    ["minor", "@swamp/cf", 5],
  ]);
});

Deno.test("dependency bumps in import specifiers do not count", () => {
  const a = files({
    "x.ts":
      'import { z } from "npm:zod@4.3.6";\nimport { C } from "npm:@aws-sdk/client-cloudcontrol@3.1147.0";\n',
  });
  const b = files({
    "x.ts":
      'import { z } from "npm:zod@4.6.7";\nimport { C } from "npm:@aws-sdk/client-cloudcontrol@3.1156.0";\n',
  });
  assertEquals(changedLineCount(a, b), 0);
});

Deno.test("a no-op upgrade entry added by a bump does not count; a real one does", () => {
  const head = "export const model = {\n  upgrades: [\n";
  const tail = "  ],\n};\n";
  const old =
    '    {\n      toVersion: "2026.10.01.1",\n      description: "Initial",\n      upgradeAttributes: (old) => old,\n    },\n';
  const noop =
    '    {\n      toVersion: "2026.10.20.1",\n      description: "No schema changes",\n      upgradeAttributes: (old) => old,\n    },\n';
  const real =
    '    {\n      toVersion: "2026.10.20.1",\n      description: "Rename host",\n      upgradeAttributes: (old) => ({ ...old, url: old.host }),\n    },\n';
  assertEquals(
    changedLineCount(
      files({ "x.ts": head + old + tail }),
      files({ "x.ts": head + old + noop + tail }),
    ),
    0,
  );
  assert(
    changedLineCount(
      files({ "x.ts": head + old + tail }),
      files({ "x.ts": head + old + real + tail }),
    ) > 0,
  );
});

Deno.test("a real upgrade followed by a no-op one is still counted", () => {
  const head = "export const model = {\n  upgrades: [\n";
  const tail = "  ],\n};\n";
  const real =
    '    {\n      toVersion: "2026.10.20.1",\n      description: "Rename host",\n      upgradeAttributes: (old) => ({ ...old, url: old.host }),\n    },\n';
  const noop =
    '    {\n      toVersion: "2026.10.21.1",\n      description: "No schema changes",\n      upgradeAttributes: (old) => old,\n    },\n';
  assert(
    changedLineCount(
      files({ "x.ts": head + tail }),
      files({ "x.ts": head + real + noop + tail }),
    ) >= 4,
  );
});
