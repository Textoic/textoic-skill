import {
  finalAnswerOf
} from "./chunk-JWUGAYSF.mjs";
import {
  allProblems,
  summary,
  wordsIn
} from "./chunk-R5U767QC.mjs";
import {
  createdDuring,
  leaveNote,
  turnOf
} from "./chunk-YSR7YX2K.mjs";
import "./chunk-APKFEWLS.mjs";
import {
  takePending,
  workRoot
} from "./chunk-MJOE2BNT.mjs";
import "./chunk-R7POPVJR.mjs";

// src/stop.ts
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
var text = (value) => typeof value === "string" ? value : "";
var readable = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
};
var answerOf = async (payload) => {
  const given = text(payload.last_assistant_message);
  const transcript = text(payload.transcript_path);
  return given !== "" || transcript === "" ? given : finalAnswerOf(transcript);
};
var writtenItems = (pending) => Promise.all(
  [...new Set(pending.wrote)].map(async (path) => ({ kind: "file", path, source: await readable(path) }))
);
var editedItems = (pending) => [...pending.edited].filter(([path]) => !pending.wrote.includes(path)).flatMap(([path, added]) => added.map((source) => ({ kind: "passage", path, source })));
var worthRewriting = (limits) => (item) => wordsIn(item.source) >= limits.words && allProblems(item.source, void 0, { shape: false }).length >= limits.issues;
var flaggedAnswer = (answer, limits) => {
  if (wordsIn(answer) < limits.words) {
    return "";
  }
  const findings = allProblems(answer);
  return findings.length < limits.issues ? "" : summary(answer, findings);
};
var HARNESSES = ["claude", "codex"];
var isCodexTurn = (payload) => typeof payload.turn_id === "string";
var harnessOf = (payload) => {
  const chosen = HARNESSES.find((harness) => harness === process.env.ENLINT_REWRITER);
  return chosen ?? (isCodexTurn(payload) ? "codex" : "claude");
};
var noteFor = (found) => `enlint: your previous answer had ${found}. Write this answer in the house style; do not mention this note.`;
var workerScript = () => fileURLToPath(new URL("../hooks/rewrite-worker.mjs", import.meta.url));
var launchWorker = async (job) => {
  const folder = join(workRoot(), "jobs");
  await mkdir(folder, { recursive: true });
  const jobPath = join(folder, `${Date.now()}-${process.pid}.json`);
  await writeFile(jobPath, JSON.stringify(job), "utf8");
  spawn(process.execPath, [workerScript(), jobPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
};
var notice = (found, items) => `enlint: ${[found === "" ? "" : `last answer: ${found}`, items.length === 0 ? "" : `${items.length} document passage(s) flagged`].filter((part) => part !== "").join("; ")}`;
var MOST_CREATED = 5;
var createdBy = async (session, writesThroughShell) => {
  const turn = writesThroughShell ? await turnOf(session) : null;
  return turn == null ? [] : createdDuring(turn);
};
var looksHandWritten = (unseen) => unseen.length <= MOST_CREATED;
var createdItems = async (session, pending, writesThroughShell) => {
  const known = /* @__PURE__ */ new Set([...pending.wrote, ...pending.edited.keys()]);
  const unseen = (await createdBy(session, writesThroughShell)).filter((path) => !known.has(path));
  const taken = looksHandWritten(unseen) ? unseen : [];
  return Promise.all(taken.map(async (path) => ({ kind: "file", path, source: await readable(path) })));
};
var documentItems = async (session, limits, writesThroughShell) => {
  const pending = await takePending(session);
  const items = [
    ...await writtenItems(pending),
    ...editedItems(pending),
    ...await createdItems(session, pending, writesThroughShell)
  ];
  return items.filter(worthRewriting(limits));
};
var atStop = async (payload, limits, launch = launchWorker) => {
  if (payload.stop_hook_active === true) {
    return null;
  }
  const session = text(payload.session_id);
  const items = await documentItems(session, limits, isCodexTurn(payload));
  const found = flaggedAnswer(await answerOf(payload), limits);
  await Promise.all([
    items.length === 0 || limits.notifyOnly ? null : launch({ items, harness: harnessOf(payload) }),
    found === "" || limits.notifyOnly ? null : leaveNote(session, noteFor(found))
  ]);
  const quiet = limits.notifyOnly === false || found === "" && items.length === 0;
  return quiet ? null : { continue: true, suppressOutput: true, systemMessage: notice(found, items) };
};
export {
  atStop,
  harnessOf,
  isCodexTurn,
  launchWorker
};
