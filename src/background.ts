import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { brief } from "./brief.js";
import { editorial } from "./config.js";
import { wordsIn } from "./document.js";
import { allProblems } from "./lint.js";
import { mechanically } from "./mechanical.js";
import { workRoot } from "./pending.js";
import { verdictOf, type Verdict } from "./verify.js";
import { rewrapLike } from "./wrap.js";
import type { Harness, Rewriter } from "./rewriter.js";

export type Item = { kind: "file" | "passage"; path: string; source: string };

export type Job = { items: Item[]; harness?: Harness };

type Outcome = { applied: boolean; why: string; verdict?: Verdict; cost?: number };

const problemsIn = (text: string) => allProblems(text, editorial, { shape: false });

const FENCED = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1/gmu;

const INLINE = [/`[^`]*`/gu, /\]\([^)]*\)/gu, /\b[a-z][\w+.-]*:\/\/\S+/giu, /"[^"]{1,80}"/gu, /“[^”]{1,80}”/gu];

const STRUCTURE = /^[ \t]*(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|\|)/gmu;

const TABLE_ROW = /^[ \t]*\|.*$/gmu;

const collapsed = (text: string) => text.replace(FENCED, " ").replace(TABLE_ROW, " ").replace(/\s+/gu, " ");

const protectedIn = (text: string) =>
  [...(text.match(FENCED) ?? []), ...(text.match(TABLE_ROW) ?? []).map((row) => row.trim()), ...INLINE.flatMap((pattern) => collapsed(text).match(pattern) ?? [])]
    .sort()
    .join("\u0000");

const structureOf = (text: string) => (text.match(STRUCTURE) ?? []).map((marker) => marker.trim()).join(" ");

const keepsEverything = (before: string, after: string) =>
  protectedIn(before) === protectedIn(after) && structureOf(before) === structureOf(after);

const trailingNewline = (like: string, text: string) =>
  like.endsWith("\n") ? `${text.replace(/\s+$/u, "")}\n` : text.replace(/\s+$/u, "");

const isBetter = (verdict: Verdict, before: string, after: string) =>
  verdict.cleared > verdict.introduced && wordsIn(after) >= wordsIn(before) / 2;

const rewritten = async (item: Item, rewrite: Rewriter) => {
  const { text } = mechanically(item.source, editorial);
  const findings = problemsIn(text);
  if (findings.length === 0) {
    return { text, cost: 0 };
  }

  const reply = await rewrite(brief({ source: text, findings, label: basename(item.path), keepShape: true }));
  return { text: trailingNewline(item.source, reply.text), cost: reply.cost };
};

const occurrences = (text: string, part: string) => text.split(part).length - 1;

const placed = async (item: Item, text: string) => {
  const current = await readFile(item.path, "utf8");
  if (item.kind === "file") {
    return current === item.source ? text : null;
  }

  return occurrences(current, item.source) === 1 ? current.replace(item.source, () => text) : null;
};

const judged = async (item: Item, text: string, cost: number): Promise<Outcome> => {
  const verdict = verdictOf(problemsIn(item.source), problemsIn(text));
  if (!keepsEverything(item.source, text)) {
    return { applied: false, why: "the rewrite changed code, links or structure", verdict, cost };
  }

  if (!isBetter(verdict, item.source, text)) {
    return { applied: false, why: "the rewrite was no better", verdict, cost };
  }

  const whole = await placed(item, trailingNewline(item.source, rewrapLike(item.source, text)));
  if (whole == null) {
    return { applied: false, why: "the file changed while the rewrite ran", verdict, cost };
  }

  await writeFile(item.path, whole, "utf8");
  return { applied: true, why: "applied", verdict, cost };
};

const logLine = (item: Item, outcome: Outcome, via: Harness) => ({
  at: new Date().toISOString(),
  path: item.path,
  kind: item.kind,
  applied: outcome.applied,
  why: outcome.why,
  cleared: outcome.verdict?.cleared ?? 0,
  survived: outcome.verdict?.survived ?? 0,
  introduced: outcome.verdict?.introduced ?? 0,
  cost: outcome.cost ?? 0,
  via,
});

export const historyPath = () => join(workRoot(), "rewrites.jsonl");

const logged = async (item: Item, outcome: Outcome, via: Harness) => {
  await mkdir(workRoot(), { recursive: true });
  await appendFile(historyPath(), `${JSON.stringify(logLine(item, outcome, via))}\n`, "utf8");
};

const failed = (error: unknown): Outcome => ({
  applied: false,
  why: error instanceof Error ? error.message : String(error),
});

const attempt = (item: Item, rewrite: Rewriter) =>
  rewritten(item, rewrite)
    .then(({ text, cost }) => judged(item, text, cost))
    .catch(failed);

const worthRetrying = (outcome: Outcome) => !outcome.applied && outcome.verdict != null && !outcome.why.includes("changed while");

const withCost = (outcome: Outcome, spent: number): Outcome => ({ ...outcome, cost: (outcome.cost ?? 0) + spent });

const settleItem = async (item: Item, rewrite: Rewriter, via: Harness) => {
  const first = await attempt(item, rewrite);
  const outcome = worthRetrying(first) ? withCost(await attempt(item, rewrite), first.cost ?? 0) : first;
  await logged(item, outcome, via);
  return outcome;
};

const AT_ONCE = 3;

const inLanes = async <Given, Made>(given: Given[], make: (one: Given) => Promise<Made>) => {
  const made: Made[] = [];
  const waiting = given.map((one, index) => ({ one, index }));
  const lane = async (): Promise<void> => {
    const next = waiting.shift();
    if (next == null) {
      return;
    }

    made[next.index] = await make(next.one);
    await lane();
  };

  await Promise.all(Array.from({ length: AT_ONCE }, lane));
  return made;
};

export const runJob = (job: Job, rewrite: Rewriter) =>
  inLanes(job.items, (item) => settleItem(item, rewrite, job.harness ?? "claude"));
