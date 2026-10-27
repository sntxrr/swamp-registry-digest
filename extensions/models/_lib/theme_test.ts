// extensions/models/_lib/theme_test.ts
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  renderIndex,
  renderIssue,
  renderStylesheet,
  type SiteConfig,
  sitePath,
} from "./render.ts";
import { publishFiles } from "./publish.ts";
import { readSiteAssets } from "../registry_digest.ts";

const CFG: SiteConfig = {
  title: "LWIS",
  siteUrl: "https://site.test",
  registryUrl: "https://registry.test",
  disclaimer: "Machine-written.",
  theme: {
    banner: "assets/banner-1600.webp",
    bannerSmall: "assets/banner-800.webp",
    bannerWidth: 1600,
    bannerHeight: 640,
    bannerAlt: `Dusk "swamp" <art>`,
    displayFont: "assets/display.woff2",
  },
};
const META = {
  slug: "2026-10-19",
  start: "2026-10-19T07:00:00Z",
  end: "2026-10-26T07:00:00Z",
  lastDay: "2026-10-25",
  generatedAt: "2026-10-26T16:00:00Z",
};

Deno.test("sitePath accepts plain relative paths only", () => {
  assertEquals(sitePath("assets/banner-1600.webp"), "assets/banner-1600.webp");
  for (
    const bad of [
      "/etc/passwd",
      "../x.png",
      "assets/../../x",
      "https://evil.test/x.png",
      "a b.png",
      'x.png"><script>',
      "",
      undefined,
    ]
  ) assertEquals(sitePath(bad), null, String(bad));
});

Deno.test("issue page: assets resolve from ../, alt is escaped, font allowed by CSP", () => {
  const html = renderIssue(CFG, META, [], {});
  assert(html.includes(`src="../assets/banner-1600.webp"`));
  assert(
    html.includes(
      `srcset="../assets/banner-800.webp 800w, ../assets/banner-1600.webp 1600w"`,
    ),
  );
  assert(html.includes(`alt="Dusk &quot;swamp&quot; &lt;art&gt;"`));
  assert(html.includes(`<link rel="stylesheet" href="../site.css">`));
  assert(html.includes(`style-src 'self'; img-src 'self'; font-src 'self'`));
  assert(!html.includes("unsafe-inline"));
  assert(!html.includes("<style"));
  assert(!/ style="/.test(html));
  assert(!html.includes("script-src"));
  // The stylesheet is shared: the font path is relative to the site root.
  assert(renderStylesheet(CFG).includes(`url("assets/display.woff2")`));
  // One h1 per page; the site name in the masthead is not a heading.
  assertEquals(html.match(/<h1[ >]/g)?.length, 1);
});

Deno.test("index page: assets resolve from ./", () => {
  const html = renderIndex(CFG, []);
  assert(html.includes(`src="./assets/banner-1600.webp"`));
  assert(html.includes(`href="./site.css"`));
  assertEquals(html.match(/<h1[ >]/g)?.length, 1);
});

Deno.test("a theme path that is not a plain relative path is never rendered", () => {
  const html = renderIssue(
    {
      ...CFG,
      theme: {
        banner: "https://evil.test/x.webp",
        displayFont: "../../x.woff2",
      },
    },
    META,
    [],
    {},
  );
  assert(!html.includes("evil.test"));
  assert(!html.includes("x.woff2"));
  assert(html.includes(`class="mast plain"`));
});

Deno.test("readSiteAssets: images, fonts and text only; no dotfiles or symlinks", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/assets`);
    await Deno.writeFile(`${dir}/assets/a.webp`, new Uint8Array([1, 2, 3]));
    await Deno.writeTextFile(`${dir}/assets/OFL.txt`, "licence");
    await Deno.writeTextFile(`${dir}/.secret`, "no");
    await Deno.writeTextFile(`${dir}/assets/a.webp.json`, "{}");
    await Deno.writeTextFile(`${dir}/README.md`, "# notes");
    await Deno.symlink("/etc/hosts", `${dir}/assets/link.txt`);
    assertEquals(await readSiteAssets(dir), {
      "assets/a.webp": "AQID",
      "assets/OFL.txt": "bGljZW5jZQ==",
    });
    await Deno.writeTextFile(`${dir}/assets/page.html`, "<script>");
    await assertRejects(
      () => readSiteAssets(dir),
      Error,
      "refusing assets/page.html",
    );
    await assertRejects(
      () => readSiteAssets("relative/dir"),
      Error,
      "absolute",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("publish uploads binaries as base64 blobs and references them by sha", async () => {
  const calls: Array<{ method: string; path: string; body: any }> = [];
  const f: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/repos/o/r", "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", path, body });
    const json = (b: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(b), { status }));
    if (path === "/git/ref/heads/gh-pages") return json({}, 404);
    if (path === "/git/blobs") return json({ sha: "blob1" }, 201);
    if (path === "/git/trees") return json({ sha: "tree1" }, 201);
    if (path === "/git/commits") return json({ sha: "c1" }, 201);
    if (path === "/git/refs") return json({}, 201);
    return json({ message: "unexpected" }, 500);
  };
  const res = await publishFiles(
    { repo: "o/r", branch: "gh-pages", token: "t" },
    { "index.html": "<p>hi</p>" },
    "Issue",
    f,
    { "assets/a.webp": "AQID" },
  );
  const blob = calls.find((c) => c.path === "/git/blobs")!;
  assertEquals(blob.body, { content: "AQID", encoding: "base64" });
  const tree = calls.find((c) => c.path === "/git/trees")!.body.tree;
  assertEquals(tree, [
    { path: "index.html", mode: "100644", type: "blob", content: "<p>hi</p>" },
    { path: "assets/a.webp", mode: "100644", type: "blob", sha: "blob1" },
  ]);
  assertEquals(res.files, ["assets/a.webp", "index.html"]);
});
