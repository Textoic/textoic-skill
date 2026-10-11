import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runJob, type Job } from "../src/background.js";
import { atPrompt } from "../src/feedback.js";
import { record } from "../src/pending.js";
import { eventsFor, isDocument } from "../src/record.js";
import { atStop } from "../src/stop.js";

const limits = { words: 60, issues: 3, notifyOnly: false };

const project = join(homedir(), "enlint-test-project");

const BAD = `The optimization of the serialization of the payload was performed by the platform team, enabling downstream consumers to scale. This is not just a performance improvement, but also a correctness fix. The report that the analyst who the board hired drafted was circulated, highlighting the need for a more nuanced approach. It is not uncommon for the system to delve into edge cases.
`;

const GOOD = `The platform team shrank the payload so that downstream consumers can grow. The change makes the service faster and fixes a bug. The analyst the board hired wrote a report, and the report says we need a better plan. The system handles edge cases well.
`;

const rewriteTo = (text: string) => async () => ({ text, cost: 0.001 });

const tempFolder = () => mkdtemp(join(tmpdir(), "enlint-test-"));

const transcriptWith = async (folder: string, answer: string) => {
  const path = join(folder, "transcript.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "Write me a plan." } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: answer }] } },
  ];
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return path;
};

test("treats markdown and text outside agent folders as documents", () => {
  assert.equal(isDocument(join(project, "notes", "plan.md")), true);
  assert.equal(isDocument(join(project, "src", "index.ts")), false);
  assert.equal(isDocument(join(homedir(), ".claude", "projects", "p", "memory", "a.md")), false);
  assert.equal(isDocument(join(tmpdir(), "enlint", "x.rewritten.md")), false);
});

test("records a whole write, and only the text an edit added", () => {
  const wrote = eventsFor({ tool_name: "Write", cwd: project, tool_input: { file_path: "plan.md" } });
  assert.deepEqual(wrote, [{ kind: "wrote", path: join(project, "plan.md") }]);

  const edited = eventsFor({
    tool_name: "MultiEdit",
    tool_input: { file_path: join(project, "plan.md"), edits: [{ new_string: "one" }, { new_string: "" }] },
  });
  assert.deepEqual(edited, [{ kind: "edited", path: join(project, "plan.md"), text: "one" }]);
});

test("records documents a subagent writes", () => {
  const byAgent = { tool_name: "Write", agent_id: "a1", tool_input: { file_path: join(project, "report.md") } };
  assert.deepEqual(eventsFor(byAgent), [{ kind: "wrote", path: join(project, "report.md") }]);
});

test("sends a flagged document to the background and says nothing", async () => {
  const folder = await tempFolder();
  const document = join(folder, "plan.md");
  await writeFile(document, BAD, "utf8");
  const session = `test-doc-${Date.now()}`;
  await record(session, [{ kind: "wrote", path: document }]);

  const launched: Job[] = [];
  const reply = await atStop({ session_id: session }, limits, async (job) => {
    launched.push(job);
  });

  assert.equal(reply, null);
  assert.deepEqual(launched, [{ items: [{ kind: "file", path: document, source: BAD }], harness: "claude" }]);
  assert.equal(await atStop({ session_id: session }, limits, async () => assert.fail("nothing left to send")), null);
});

test("leaves a flagged answer a note for the next prompt, once", async () => {
  const folder = await tempFolder();
  const session = `test-note-${Date.now()}`;
  const transcript = await transcriptWith(folder, BAD);

  assert.equal(await atStop({ session_id: session, transcript_path: transcript }, limits, async () => {}), null);
  const note = await atPrompt({ session_id: session });
  assert.match(note?.hookSpecificOutput.additionalContext ?? "", /^enlint: your previous answer had/u);
  assert.equal(await atPrompt({ session_id: session }), null);
});

test("prefers the answer the harness hands over", async () => {
  const session = `test-given-${Date.now()}`;
  await atStop({ session_id: session, last_assistant_message: BAD, transcript_path: "missing.jsonl" }, limits, async () => {});
  assert.notEqual(await atPrompt({ session_id: session }), null);
});

test("stays quiet on the retry turn and on a short answer", async () => {
  const folder = await tempFolder();
  const transcript = await transcriptWith(folder, "Done. The test passes.");
  assert.equal(await atStop({ session_id: "x", stop_hook_active: true }, limits), null);
  assert.equal(await atStop({ session_id: `test-short-${Date.now()}`, transcript_path: transcript }, limits), null);
});

test("replaces a document in place when the rewrite is better", async () => {
  const document = join(await tempFolder(), "plan.md");
  await writeFile(document, BAD, "utf8");

  const [outcome] = await runJob({ items: [{ kind: "file", path: document, source: BAD }] }, rewriteTo(GOOD));
  assert.equal(outcome.applied, true);
  assert.equal(await readFile(document, "utf8"), GOOD);
});

test("runs at most three rewriters at a time and keeps the order of the items", async () => {
  const folder = await tempFolder();
  const names = Array.from({ length: 8 }, (_, index) => join(folder, `plan-${index}.md`));
  await Promise.all(names.map((path) => writeFile(path, BAD, "utf8")));
  const running = { now: 0, most: 0 };
  const slowly = async () => {
    running.now += 1;
    running.most = Math.max(running.most, running.now);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running.now -= 1;
    return { text: GOOD, cost: 0 };
  };

  const outcomes = await runJob({ items: names.map((path) => ({ kind: "file", path, source: BAD })) }, slowly);
  assert.equal(running.most, 3);
  assert.deepEqual(
    outcomes.map(({ applied }) => applied),
    names.map(() => true),
  );
  assert.deepEqual(await runJob({ items: [] }, slowly), []);
});

test("replaces only the passage an edit added", async () => {
  const document = join(await tempFolder(), "notes.md");
  await writeFile(document, `# Notes\n\nKept as it was.\n\n${BAD}\nAlso kept.\n`, "utf8");

  const [outcome] = await runJob({ items: [{ kind: "passage", path: document, source: BAD }] }, rewriteTo(GOOD));
  assert.equal(outcome.applied, true);
  assert.equal(await readFile(document, "utf8"), `# Notes\n\nKept as it was.\n\n${GOOD}\nAlso kept.\n`);
});

test("leaves the file alone when it changed during the rewrite", async () => {
  const document = join(await tempFolder(), "plan.md");
  await writeFile(document, `${BAD}\nA line the agent added later.\n`, "utf8");

  const [outcome] = await runJob({ items: [{ kind: "file", path: document, source: BAD }] }, rewriteTo(GOOD));
  assert.equal(outcome.applied, false);
  assert.match(await readFile(document, "utf8"), /A line the agent added later/u);
});

test("rejects a rewrite that touches code or drops structure", async () => {
  const document = join(await tempFolder(), "plan.md");
  const source = `## Steps\n\n${BAD}\nRun \`npm test\` first.\n`;
  await writeFile(document, source, "utf8");

  const [outcome] = await runJob({ items: [{ kind: "file", path: document, source }] }, rewriteTo(`${GOOD}\nRun \`npm run test\` first.\n`));
  assert.equal(outcome.applied, false);
  assert.equal(await readFile(document, "utf8"), source);
});

test("keeps the original when the rewrite is no better", async () => {
  const document = join(await tempFolder(), "plan.md");
  await writeFile(document, BAD, "utf8");

  const [outcome] = await runJob({ items: [{ kind: "file", path: document, source: BAD }] }, rewriteTo("Too short."));
  assert.equal(outcome.applied, false);
  assert.equal(await readFile(document, "utf8"), BAD);
});

test("rejects a rewrite that changes a table row", async () => {
  const document = join(await tempFolder(), "plan.md");
  const table = "| Channel | Plan |\n| --- | --- |\n| Reddit | Lead with the method, link last |\n";
  const source = `${BAD}\n${table}`;
  await writeFile(document, source, "utf8");

  const changed = table.replace("Lead with the method, link last", "Lead with the method. Link last.");
  const [outcome] = await runJob({ items: [{ kind: "file", path: document, source }] }, rewriteTo(`${GOOD}\n${changed}`));
  assert.equal(outcome.applied, false);
});
