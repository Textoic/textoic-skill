import {
  ErrorId,
  allProblems,
  editorial,
  grouped,
  place,
  proseProblems,
  sentences,
  spanOf,
  wordsIn
} from "./chunk-R5U767QC.mjs";
import {
  workRoot
} from "./chunk-MJOE2BNT.mjs";

// src/mechanical.ts
var DETERMINISTIC = [ErrorId.NO_SPECIAL_PUNCTUATION];
var swapFor = (error) => {
  const [offered] = error.suggestions ?? [];
  if (offered == null || offered.text === "") {
    return null;
  }
  const [start, end] = offered.range;
  return { start, end, replacement: offered.text, ruleId: error.id };
};
var overlaps = (one, other) => one.start < other.end && other.start < one.end;
var settled = (swaps) => [...swaps].sort((one, other) => one.start - other.start || one.end - other.end).reduce(
  (kept, swap) => kept.some((keeper) => overlaps(keeper, swap)) ? kept : [...kept, swap],
  []
);
var applied = (source, swaps) => settled(swaps).slice().reverse().reduce(
  (text, { start, end, replacement }) => text.slice(0, start) + replacement + text.slice(end),
  source
);
var swapsFor = (source, config) => settled(
  proseProblems(source, config).filter(({ id }) => DETERMINISTIC.includes(id)).flatMap((error) => {
    const swap = swapFor(error);
    return swap == null ? [] : [swap];
  })
);
var mechanically = (source, config) => {
  const swaps = swapsFor(source, config);
  return { text: applied(source, swaps), swaps };
};

// src/verify.ts
var countsOf = (errors) => errors.reduce(
  (counts, { id }) => counts.set(id, (counts.get(id) ?? 0) + 1),
  /* @__PURE__ */ new Map()
);
var ruleIdsIn = (before, after) => [
  ...new Set([...before, ...after].map(({ id }) => id))
];
var talliesFor = (before, after) => {
  const was = countsOf(before);
  const now = countsOf(after);
  return ruleIdsIn(before, after).map((ruleId) => ({
    ruleId,
    before: was.get(ruleId) ?? 0,
    after: now.get(ruleId) ?? 0
  })).sort(
    (one, other) => other.before - one.before || (one.ruleId < other.ruleId ? -1 : 1)
  );
};
var summed = (tallies, of) => tallies.reduce((total, tally) => total + of(tally), 0);
var verdictOf = (before, after) => {
  const byRule = talliesFor(before, after);
  return {
    asked: before.length,
    cleared: summed(
      byRule,
      ({ before: was, after: now }) => Math.max(was - now, 0)
    ),
    survived: summed(
      byRule,
      ({ before: was, after: now }) => Math.min(was, now)
    ),
    introduced: summed(
      byRule,
      ({ before: was, after: now }) => Math.max(now - was, 0)
    ),
    byRule
  };
};
var shortfall = ({ survived, introduced }) => [
  survived > 0 ? `${survived} still flagged` : "",
  introduced > 0 ? `${introduced} newly flagged` : ""
].filter((part) => part !== "");
var describeVerdict = (verdict) => {
  const missed = shortfall(verdict);
  return missed.length === 0 ? `cleared all ${verdict.asked}` : `cleared ${verdict.cleared} of ${verdict.asked}, ${missed.join(", ")}`;
};
var mean = (numbers) => numbers.length === 0 ? 0 : numbers.reduce((total, one) => total + one, 0) / numbers.length;
var sentenceLengths = (text) => sentences(text).map((tokens) => tokens.filter(({ xpos }) => xpos !== "PUNCT").length).filter((length) => length > 0);
var sentenceProfile = (text) => {
  const lengths = sentenceLengths(text);
  return {
    count: lengths.length,
    average: Math.round(mean(lengths)),
    longest: Math.max(0, ...lengths)
  };
};

// src/brief.ts
var HEADINGS = {
  shape: "Pass 1 - shape of the passage",
  sentences: "Pass 2 - how sentences are built",
  words: "Pass 3 - word choice"
};
var ORDER = ["shape", "sentences", "words"];
var swapsOffered = (finding) => (finding.suggestions ?? []).filter(
  ({ range: [from, to] }) => from === finding.start && to === finding.end
).map(({ text }) => text).filter((text) => text !== "");
var shapeLine = (source, finding) => {
  const { line } = place(source, finding.start);
  return `- line ${line}: ${finding.message}`;
};
var proseLine = (source, finding) => {
  const { line } = place(source, finding.start);
  const swaps = swapsOffered(finding);
  const offered = swaps.length === 0 ? "" : `
  Replacements the rule offers, any of which you may use: ${swaps.join(
    ", "
  )}`;
  return `- line ${line}, "${spanOf(source, finding)}" \u2014 ${finding.message}${offered}`;
};
var section = (source, scope, found) => `### ${HEADINGS[scope]} (${found.length})

${found.map(
  (finding) => scope === "shape" ? shapeLine(source, finding) : proseLine(source, finding)
).join("\n")}`;
var rhythm = (source) => {
  const { count, average, longest } = sentenceProfile(source);
  return count < 2 ? "" : `The passage runs ${count} sentences, averaging ${average} words, longest ${longest}. Hand back one with the same shape: about ${count} sentences, not twice that, and the same spread between longest and shortest. A run of ${count * 2} short sentences all the same size is a failed edit however many flags it clears.`;
};
var PASSES = "Work the three passes in order: shape first, then sentence construction, then word choice.";
var KEEP_SHAPE = "The author chose this document's structure. Keep every heading, list item and bold label where it is, skip the shape pass, and fix the sentences and words inside them. Table rows come back untouched.";
var deliveryFor = (outPath) => outPath == null ? "**Reply with the finished passage and nothing else.** Your reply replaces the passage exactly as you write it." : `**Write the finished passage, and nothing else, to this file:**

    ${outPath}`;
var brief = ({
  source,
  findings,
  outPath,
  label,
  keepShape = false
}) => {
  const by = grouped(findings);
  const sections = ORDER.filter(
    (scope) => (by.get(scope) ?? []).length > 0
  ).map((scope) => section(source, scope, by.get(scope)));
  return `# Rewrite brief

Source: ${label} \u2014 ${wordsIn(source)} words, ${findings.length} flagged.

Rewrite the passage at the end of this file so it follows the style guide in
your instructions and clears the findings below. ${keepShape ? KEEP_SHAPE : PASSES}

${deliveryFor(outPath)}

Keep every idea and every fact. You are repacking the passage, not summarising
it: the result should be about as long as what you were given. Code blocks,
inline code, links, URLs and quoted text come back untouched, character for character.

${rhythm(source)}

## What the linter found

${sections.join("\n\n")}

## The passage to rewrite

${source}
`;
};

// src/background.ts
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

// src/wrap.ts
var FENCE = /^[ \t]*(`{3,}|~{3,})/u;
var STRUCTURED = /^(?:[ \t]|#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|\||>|<)/u;
var blocksOf = (text) => text.split(/\n{2,}/u);
var isPlainParagraph = (block) => block.trim() !== "" && !block.split("\n").some((line) => FENCE.test(line) || STRUCTURED.test(line));
var allButLast = (block) => block.trim().split("\n").slice(0, -1);
var percentile90 = (values) => [...values].sort((one, other) => one - other)[Math.floor(values.length * 0.9)];
var wrapWidth = (source) => {
  const plain = blocksOf(source).filter(isPlainParagraph);
  const wrapped = plain.filter((block) => block.trim().includes("\n"));
  if (wrapped.length === 0 || wrapped.length * 2 < plain.length) {
    return 0;
  }
  return percentile90(wrapped.flatMap(allButLast).map((line) => line.length));
};
var filled = (block, width) => block.trim().split(/\s+/u).reduce((lines, word) => {
  const last = lines[lines.length - 1];
  if (last !== void 0 && last.length + 1 + word.length <= width) {
    lines[lines.length - 1] = `${last} ${word}`;
  } else {
    lines.push(word);
  }
  return lines;
}, []).join("\n");
var normal = (block) => block.trim().replace(/\s+/gu, " ");
var originalsOf = (source) => new Map(blocksOf(source).map((block) => [normal(block), block.replace(/^\n+|\n+$/gu, "")]));
var laidOut = (block, width, originals) => originals.get(normal(block)) ?? (width > 0 && isPlainParagraph(block) ? filled(block, width) : block);
var rewrapLike = (source, text) => {
  const width = wrapWidth(source);
  const originals = originalsOf(source);
  return blocksOf(text).map((block) => laidOut(block, width, originals)).join("\n\n");
};

// src/background.ts
var problemsIn = (text) => allProblems(text, editorial, { shape: false });
var FENCED = /^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1/gmu;
var INLINE = [/`[^`]*`/gu, /\]\([^)]*\)/gu, /\b[a-z][\w+.-]*:\/\/\S+/giu, /"[^"]{1,80}"/gu, /“[^”]{1,80}”/gu];
var STRUCTURE = /^[ \t]*(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|\|)/gmu;
var TABLE_ROW = /^[ \t]*\|.*$/gmu;
var collapsed = (text) => text.replace(FENCED, " ").replace(TABLE_ROW, " ").replace(/\s+/gu, " ");
var protectedIn = (text) => [...text.match(FENCED) ?? [], ...(text.match(TABLE_ROW) ?? []).map((row) => row.trim()), ...INLINE.flatMap((pattern) => collapsed(text).match(pattern) ?? [])].sort().join("\0");
var structureOf = (text) => (text.match(STRUCTURE) ?? []).map((marker) => marker.trim()).join(" ");
var keepsEverything = (before, after) => protectedIn(before) === protectedIn(after) && structureOf(before) === structureOf(after);
var trailingNewline = (like, text) => like.endsWith("\n") ? `${text.replace(/\s+$/u, "")}
` : text.replace(/\s+$/u, "");
var isBetter = (verdict, before, after) => verdict.cleared > verdict.introduced && wordsIn(after) >= wordsIn(before) / 2;
var rewritten = async (item, rewrite) => {
  const { text } = mechanically(item.source, editorial);
  const findings = problemsIn(text);
  if (findings.length === 0) {
    return { text, cost: 0 };
  }
  const reply = await rewrite(brief({ source: text, findings, label: basename(item.path), keepShape: true }));
  return { text: trailingNewline(item.source, reply.text), cost: reply.cost };
};
var occurrences = (text, part) => text.split(part).length - 1;
var placed = async (item, text) => {
  const current = await readFile(item.path, "utf8");
  if (item.kind === "file") {
    return current === item.source ? text : null;
  }
  return occurrences(current, item.source) === 1 ? current.replace(item.source, () => text) : null;
};
var judged = async (item, text, cost) => {
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
var logLine = (item, outcome, via) => ({
  at: (/* @__PURE__ */ new Date()).toISOString(),
  path: item.path,
  kind: item.kind,
  applied: outcome.applied,
  why: outcome.why,
  cleared: outcome.verdict?.cleared ?? 0,
  survived: outcome.verdict?.survived ?? 0,
  introduced: outcome.verdict?.introduced ?? 0,
  cost: outcome.cost ?? 0,
  via
});
var historyPath = () => join(workRoot(), "rewrites.jsonl");
var logged = async (item, outcome, via) => {
  await mkdir(workRoot(), { recursive: true });
  await appendFile(historyPath(), `${JSON.stringify(logLine(item, outcome, via))}
`, "utf8");
};
var failed = (error) => ({
  applied: false,
  why: error instanceof Error ? error.message : String(error)
});
var attempt = (item, rewrite) => rewritten(item, rewrite).then(({ text, cost }) => judged(item, text, cost)).catch(failed);
var worthRetrying = (outcome) => !outcome.applied && outcome.verdict != null && !outcome.why.includes("changed while");
var withCost = (outcome, spent) => ({ ...outcome, cost: (outcome.cost ?? 0) + spent });
var settleItem = async (item, rewrite, via) => {
  const first = await attempt(item, rewrite);
  const outcome = worthRetrying(first) ? withCost(await attempt(item, rewrite), first.cost ?? 0) : first;
  await logged(item, outcome, via);
  return outcome;
};
var AT_ONCE = 3;
var inLanes = async (given, make) => {
  const made = [];
  const waiting = given.map((one, index) => ({ one, index }));
  const lane = async () => {
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
var runJob = (job, rewrite) => inLanes(job.items, (item) => settleItem(item, rewrite, job.harness ?? "claude"));

// src/rewriter.ts
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile as readFile2, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var pathFolders = () => (process.env.PATH ?? "").split(delimiter).filter((folder) => folder !== "");
var onPath = (candidates) => candidates.flatMap((parts) => pathFolders().map((folder) => join2(folder, ...parts))).find(existsSync);
var claudeBinary = () => process.env.ENLINT_CLAUDE || onPath([["claude.exe"], ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"], ["claude"]]) || "claude";
var newestIn = (folder, name) => {
  try {
    return readdirSync(folder).map((entry) => join2(folder, entry, name)).filter(existsSync).sort((one, other) => statSync(other).mtimeMs - statSync(one).mtimeMs)[0];
  } catch {
    return void 0;
  }
};
var desktopCodex = () => process.env.LOCALAPPDATA == null ? void 0 : newestIn(join2(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin"), "codex.exe");
var codexBinary = () => process.env.ENLINT_CODEX || process.env.CODEX_CLI_PATH || onPath([["codex.exe"], ["codex"]]) || desktopCodex() || "codex";
var NO_TOOLS = "The brief arrives as the user message. You have no tools: your reply is the finished passage and nothing else, starting at its first character, with no note about what you changed or how many words you wrote.\n\n";
var DELIVERY = /Read the brief you were given\.[\s\S]*?\n\n/u;
var withoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/u, "");
var rewriterPrompt = async () => {
  const agent = fileURLToPath(new URL("../agents/prose-rewriter.md", import.meta.url));
  const body = withoutFrontmatter((await readFile2(agent, "utf8")).replace(/\r\n/gu, "\n"));
  return body.replace(DELIVERY, () => NO_TOOLS).trim();
};
var TIMEOUT_MS = 18e4;
var run = (binary, args, input) => new Promise((done, fail) => {
  const child = spawn(binary, args, {
    env: { ...process.env, ENLINT_DISABLE: "1" },
    windowsHide: true,
    timeout: TIMEOUT_MS
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.resume();
  child.on("error", fail);
  child.on(
    "close",
    (code) => code === 0 ? done(Buffer.concat(chunks).toString("utf8")) : fail(new Error(`the rewriter exited with ${code}`))
  );
  child.stdin.end(input, "utf8");
});
var claudeArgs = (system) => [
  "-p",
  "--model",
  process.env.ENLINT_CLAUDE_MODEL || process.env.ENLINT_REWRITE_MODEL || "haiku",
  "--setting-sources",
  "",
  "--tools",
  "",
  "--no-session-persistence",
  "--settings",
  JSON.stringify({ alwaysThinkingEnabled: false }),
  "--output-format",
  "json",
  "--system-prompt",
  system
];
var claudeReply = (stdout) => {
  const parsed = JSON.parse(stdout);
  if (parsed.is_error === true || typeof parsed.result !== "string") {
    throw new Error(`the rewriter failed: ${stdout.slice(0, 300)}`);
  }
  return { text: parsed.result, cost: Number(parsed.total_cost_usd) || 0 };
};
var claudeRewriter = async (brief2) => claudeReply(await run(claudeBinary(), claudeArgs(await rewriterPrompt()), brief2));
var codexArgs = (system, folder, out) => [
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--skip-git-repo-check",
  "-s",
  "read-only",
  "-C",
  folder,
  "-m",
  process.env.ENLINT_CODEX_MODEL || "gpt-6-luna",
  "-c",
  'model_reasoning_effort="low"',
  "-c",
  `developer_instructions=${JSON.stringify(system)}`,
  "-o",
  out,
  "-"
];
var codexRewriter = async (brief2) => {
  const folder = await mkdtemp(join2(tmpdir(), "enlint-codex-"));
  const out = join2(folder, "reply.md");
  try {
    await run(codexBinary(), codexArgs(await rewriterPrompt(), folder, out), brief2);
    return { text: await readFile2(out, "utf8"), cost: 0 };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};
var REWRITERS = { claude: claudeRewriter, codex: codexRewriter };
var rewriterFor = (harness) => REWRITERS[harness ?? "claude"] ?? claudeRewriter;

export {
  mechanically,
  verdictOf,
  describeVerdict,
  brief,
  historyPath,
  runJob,
  codexBinary,
  rewriterFor
};
