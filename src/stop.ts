import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item, Job } from "./background.js";
import { wordsIn } from "./document.js";
import { leaveNote } from "./feedback.js";
import { allProblems } from "./lint.js";
import { takePending, workRoot, type Pending } from "./pending.js";
import { summary } from "./report.js";
import type { Harness } from "./rewriter.js";
import { finalAnswerOf } from "./transcript.js";
import { createdDuring, turnOf } from "./turns.js";

export type StopPayload = {
  session_id?: unknown;
  transcript_path?: unknown;
  last_assistant_message?: unknown;
  turn_id?: unknown;
  stop_hook_active?: unknown;
};

export type Limits = { words: number; issues: number; notifyOnly: boolean };

export type Launch = (job: Job) => Promise<void>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

const readable = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
};

const answerOf = async (payload: StopPayload) => {
  const given = text(payload.last_assistant_message);
  const transcript = text(payload.transcript_path);
  return given !== "" || transcript === "" ? given : finalAnswerOf(transcript);
};

const writtenItems = (pending: Pending) =>
  Promise.all(
    [...new Set(pending.wrote)].map(async (path): Promise<Item> => ({ kind: "file", path, source: await readable(path) })),
  );

const editedItems = (pending: Pending): Item[] =>
  [...pending.edited]
    .filter(([path]) => !pending.wrote.includes(path))
    .flatMap(([path, added]) => added.map((source): Item => ({ kind: "passage", path, source })));

const worthRewriting = (limits: Limits) => (item: Item) =>
  wordsIn(item.source) >= limits.words &&
  allProblems(item.source, undefined, { shape: false }).length >= limits.issues;

const flaggedAnswer = (answer: string, limits: Limits) => {
  if (wordsIn(answer) < limits.words) {
    return "";
  }

  const findings = allProblems(answer);
  return findings.length < limits.issues ? "" : summary(answer, findings);
};

const HARNESSES: Harness[] = ["claude", "codex"];

export const isCodexTurn = (payload: StopPayload) => typeof payload.turn_id === "string";

export const harnessOf = (payload: StopPayload): Harness => {
  const chosen = HARNESSES.find((harness) => harness === process.env.ENLINT_REWRITER);
  return chosen ?? (isCodexTurn(payload) ? "codex" : "claude");
};

const noteFor = (found: string) =>
  `enlint: your previous answer had ${found}. Write this answer in the house style; do not mention this note.`;

const workerScript = () => fileURLToPath(new URL("../hooks/rewrite-worker.mjs", import.meta.url));

export const launchWorker: Launch = async (job) => {
  const folder = join(workRoot(), "jobs");
  await mkdir(folder, { recursive: true });
  const jobPath = join(folder, `${Date.now()}-${process.pid}.json`);
  await writeFile(jobPath, JSON.stringify(job), "utf8");
  spawn(process.execPath, [workerScript(), jobPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
};

const notice = (found: string, items: Item[]) =>
  `enlint: ${[found === "" ? "" : `last answer: ${found}`, items.length === 0 ? "" : `${items.length} document passage(s) flagged`]
    .filter((part) => part !== "")
    .join("; ")}`;

const MOST_CREATED = 5;

const createdBy = async (session: string, writesThroughShell: boolean) => {
  const turn = writesThroughShell ? await turnOf(session) : null;
  return turn == null ? [] : createdDuring(turn);
};

const looksHandWritten = (unseen: string[]) => unseen.length <= MOST_CREATED;

const createdItems = async (session: string, pending: Pending, writesThroughShell: boolean): Promise<Item[]> => {
  const known = new Set([...pending.wrote, ...pending.edited.keys()]);
  const unseen = (await createdBy(session, writesThroughShell)).filter((path) => !known.has(path));
  const taken = looksHandWritten(unseen) ? unseen : [];
  return Promise.all(taken.map(async (path): Promise<Item> => ({ kind: "file", path, source: await readable(path) })));
};

const documentItems = async (session: string, limits: Limits, writesThroughShell: boolean) => {
  const pending = await takePending(session);
  const items = [
    ...(await writtenItems(pending)),
    ...editedItems(pending),
    ...(await createdItems(session, pending, writesThroughShell)),
  ];
  return items.filter(worthRewriting(limits));
};

export const atStop = async (payload: StopPayload, limits: Limits, launch: Launch = launchWorker) => {
  if (payload.stop_hook_active === true) {
    return null;
  }

  const session = text(payload.session_id);
  const items = await documentItems(session, limits, isCodexTurn(payload));
  const found = flaggedAnswer(await answerOf(payload), limits);
  await Promise.all([
    items.length === 0 || limits.notifyOnly ? null : launch({ items, harness: harnessOf(payload) }),
    found === "" || limits.notifyOnly ? null : leaveNote(session, noteFor(found)),
  ]);

  const quiet = limits.notifyOnly === false || (found === "" && items.length === 0);
  return quiet ? null : { continue: true, suppressOutput: true, systemMessage: notice(found, items) };
};
