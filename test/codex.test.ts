import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Job } from "../src/background.js";
import { atPrompt } from "../src/feedback.js";
import { patchEvents } from "../src/patch.js";
import { eventsFor } from "../src/record.js";
import { atStop } from "../src/stop.js";
import { createdDuring } from "../src/turns.js";

const limits = { words: 60, issues: 3, notifyOnly: false };

const BAD = `The optimization of the serialization of the payload was performed by the platform team, enabling downstream consumers to scale. This is not just a performance improvement, but also a correctness fix. The report that the analyst who the board hired drafted was circulated, highlighting the need for a more nuanced approach. It is not uncommon for the system to delve into edge cases.
`;

test("reads a new file and each run of added lines out of a patch", () => {
  const cwd = join(tmpdir(), "project");
  const patch = [
    "*** Begin Patch",
    "*** Add File: guide.md",
    "+First line.",
    "*** Update File: notes.md",
    "@@",
    " kept",
    "+added one",
    "+added two",
    "-removed",
    "+added three",
    "*** End Patch",
  ].join("\n");

  assert.deepEqual(patchEvents(patch, cwd), [
    { kind: "wrote", path: join(cwd, "guide.md") },
    { kind: "edited", path: join(cwd, "notes.md"), text: "added one\nadded two" },
    { kind: "edited", path: join(cwd, "notes.md"), text: "added three" },
  ]);
});

test("records Codex patches to prose files only", () => {
  const cwd = join(tmpdir(), "project");
  const command = "*** Begin Patch\n*** Add File: plan.md\n+Hi.\n*** Add File: src/app.ts\n+x\n*** End Patch";
  assert.deepEqual(eventsFor({ tool_name: "apply_patch", cwd, tool_input: { command } }), [
    { kind: "wrote", path: join(cwd, "plan.md") },
  ]);
});

test("finds prose files created during the turn, skipping hidden and vendored folders", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "prose-turn-"));
  const at = Date.now();
  await writeFile(join(cwd, "fresh.md"), "x", "utf8");
  await writeFile(join(cwd, "code.ts"), "x", "utf8");
  const found = await createdDuring({ at, cwd });
  assert.deepEqual(found, [join(cwd, "fresh.md")]);
  assert.deepEqual(await createdDuring({ at: Date.now() + 60_000, cwd }), []);
});

const turnWith = async (names: string[]) => {
  const cwd = await mkdtemp(join(tmpdir(), "prose-turn-"));
  const session = `test-shell-${Date.now()}-${names.length}`;
  await atPrompt({ session_id: session, cwd }, { notes: true, turns: true });
  await Promise.all(names.map((name) => writeFile(join(cwd, name), BAD, "utf8")));
  return { cwd, session };
};

const launchedAtStop = async (payload: Parameters<typeof atStop>[0]) => {
  const launched: Job[] = [];
  await atStop(payload, limits, async (job) => {
    launched.push(job);
  });
  return launched;
};

test("sends a document Codex wrote through the shell to the background", async () => {
  const { cwd, session } = await turnWith(["notes.md"]);
  assert.deepEqual(await launchedAtStop({ session_id: session, cwd, turn_id: "t1" }), [
    { items: [{ kind: "file", path: join(cwd, "notes.md"), source: BAD }], harness: "codex" },
  ]);
});

test("leaves alone a file a Claude turn made through the shell", async () => {
  const { cwd, session } = await turnWith(["notes.md"]);
  assert.deepEqual(await launchedAtStop({ session_id: session, cwd }), []);
});

test("keeps a Claude turn out of the folder scan when Codex is forced as the rewriter", async () => {
  const { cwd, session } = await turnWith(["notes.md"]);
  const previous = process.env.ENLINT_REWRITER;
  process.env.ENLINT_REWRITER = "codex";
  try {
    assert.deepEqual(await launchedAtStop({ session_id: session, cwd }), []);
  } finally {
    if (previous == null) {
      delete process.env.ENLINT_REWRITER;
    } else {
      process.env.ENLINT_REWRITER = previous;
    }
  }
});

test("leaves alone a batch of files a program wrote during a Codex turn", async () => {
  const names = Array.from({ length: 6 }, (_, index) => `text-${index}.md`);
  const { cwd, session } = await turnWith(names);
  assert.deepEqual(await launchedAtStop({ session_id: session, cwd, turn_id: "t1" }), []);
});

test("rewrites a Codex turn with Codex and a Claude turn with Claude", async () => {
  const { harnessOf } = await import("../src/stop.js");
  assert.equal(harnessOf({ turn_id: "t1" }), "codex");
  assert.equal(harnessOf({ session_id: "s" }), "claude");
});

test("offers the style card at session start in Codex only", async () => {
  const { atSessionStart, isCodexSession } = await import("../src/session.js");
  const codex = { transcript_path: join(tmpdir(), "sessions", "2026", "rollout-2026-09-27T10-00-00-abc.jsonl") };
  const claude = { transcript_path: join(tmpdir(), "projects", "p", "0b3c5d9e-1111-2222-3333-444455556666.jsonl") };
  assert.equal(isCodexSession(codex), true);
  assert.equal(isCodexSession(claude), false);
  assert.equal(await atSessionStart(claude), null);

  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = await mkdtemp(join(tmpdir(), "codex-home-"));
  try {
    const reply = await atSessionStart(codex);
    assert.match(reply?.hookSpecificOutput.additionalContext ?? "", /^# House style for prose/u);
    await writeFile(join(process.env.CODEX_HOME, "config.toml"), "# enlint:begin\n", "utf8");
    assert.equal(await atSessionStart(codex), null);
  } finally {
    process.env.CODEX_HOME = previous;
  }
});
