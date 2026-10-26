// extensions/models/_lib/registry_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { RegistryClient } from "./registry.ts";

Deno.test("a 429 is retried, then the answer is used", async () => {
  let calls = 0;
  const f: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      calls < 3 ? new Response("{}", { status: 429 }) : new Response(
        JSON.stringify({
          versions: [{ version: "1", publishedAt: "2026-10-20T00:00:00Z" }],
          meta: { total: 1 },
        }),
      ),
    );
  };
  const v = await new RegistryClient("https://r.test", f, 1000, 0).versions(
    "@a/b",
  );
  assertEquals([calls, v.map((x) => x.version)], [3, ["1"]]);
});

Deno.test("a persistent 429 eventually fails loudly", async () => {
  const f: typeof fetch = () =>
    Promise.resolve(new Response("{}", { status: 429 }));
  await assertRejects(
    () => new RegistryClient("https://r.test", f, 1000, 0).versions("@a/b"),
    Error,
    "HTTP 429",
  );
});

Deno.test("a 404 is not retried", async () => {
  let calls = 0;
  const f: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      new Response(JSON.stringify({ error: "Extension not found" }), {
        status: 404,
      }),
    );
  };
  assertEquals(
    await new RegistryClient("https://r.test", f, 1000, 0).info("@a/b"),
    null,
  );
  assertEquals(calls, 1);
});
