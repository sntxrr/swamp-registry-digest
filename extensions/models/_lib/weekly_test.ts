// extensions/models/_lib/weekly_test.ts
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.19";
import { parseWeekly, readWeekly } from "./weekly.ts";

const W = {
  start: "2026-11-16T08:00:00Z",
  end: "2026-11-23T08:00:00Z",
  firstDay: "2026-11-16",
  lastDay: "2026-11-22",
};

const FILE = `host: Seth
url: https://discord.com/channels/1/2/3?utm=x#frag
stories:
  - title: Restarts that keep your runs going
    summary: "A planned restart parks each run at a step boundary.\\u0007"
  - title: Many hosted workspaces behind one serve
    inProgress: true
`;

Deno.test("weekly: a file becomes one episode, cleaned, with defaults", () => {
  assertEquals(parseWeekly(FILE, "2026-11-20"), {
    date: "2026-11-20",
    title: "Swamp Weekly",
    host: "Seth",
    url: "https://discord.com/channels/1/2/3",
    stories: [
      {
        title: "Restarts that keep your runs going",
        summary: "A planned restart parks each run at a step boundary.",
        inProgress: false,
      },
      {
        title: "Many hosted workspaces behind one serve",
        summary: "",
        inProgress: true,
      },
    ],
  });
});

Deno.test("weekly: rejects expiring attachment links, non-https, typos, empty", () => {
  const story = "stories:\n  - title: x\n";
  for (
    const [text, msg] of [
      [
        `url: https://cdn.discordapp.com/attachments/1/2/v.mp4?ex=1\n${story}`,
        "expires",
      ],
      [`url: http://example.test/\n${story}`, "must be https"],
      [`url: javascript:alert(1)\n${story}`, "must be https"],
      [`${story}    sumary: typo\n`, "sumary"],
      ["stories: []\n", "stories"],
      ["- just a list\n", "(file)"],
    ]
  ) {
    assertThrows(() => parseWeekly(text, "2026-11-20"), Error, msg);
  }
});

Deno.test("weekly: reads only files dated inside the window, oldest first", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const one = (t: string) => `stories:\n  - title: ${t}\n`;
    await Deno.writeTextFile(`${dir}/2026-11-15.yaml`, one("before"));
    await Deno.writeTextFile(`${dir}/2026-11-22.yml`, one("last day"));
    await Deno.writeTextFile(`${dir}/2026-11-16.yaml`, one("first day"));
    await Deno.writeTextFile(`${dir}/2026-11-23.yaml`, one("after"));
    await Deno.writeTextFile(`${dir}/README.md`, "not a video");
    const got = await readWeekly(dir, W);
    assertEquals(got.map((e) => e.stories[0].title), ["first day", "last day"]);
    // A broken file in the window fails the whole source, naming the file.
    await Deno.writeTextFile(`${dir}/2026-11-20.yaml`, "stories: nope\n");
    await assertRejects(() => readWeekly(dir, W), Error, "2026-11-20.yaml");
    await Deno.remove(`${dir}/2026-11-20.yaml`);
    await Deno.writeTextFile(`${dir}/2026-02-30.yaml`, one("no such day"));
    await assertRejects(() => readWeekly(dir, W), Error, "not a real date");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
