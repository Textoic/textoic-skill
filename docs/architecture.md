# Architecture notes

Newest first. One finding each.

## 2026-10-11, the hook rewrote 60 experiment texts and took a machine down

A Claude session ran experiments in `enlint-lab`. Its scripts wrote hundreds
of model texts as `.md` files under the working folder. The Stop hook's scan
for files born during the turn took each one for a document the agent wrote,
and the worker started one `claude` rewriter for every flagged file at once.
Twice that changed texts before LLM judges read them, and it changed 22 copies
of the author's own essays that served as the control. On the third run 660
new files appeared in one turn. The log holds 159 rewrite attempts in one
minute, the machine ran out of memory, and the session died.

Three changes. A Claude turn no longer scans the folder: Write and Edit reach
the hook with a path, so a file made through Bash is the output of a command.
A Codex turn still scans, because Codex on Windows writes through PowerShell,
but when it finds more than five new prose files that the hook has not seen
written, they count as the work of a program and none is touched. And
`runJob` keeps three rewriters running at a time whatever the size of the job.

Who wrote the turn is read from `turn_id`, which only Codex sends.
`ENLINT_REWRITER` picks the model that rewrites and no longer decides whether
the folder is scanned.

What a Claude turn loses: a document the agent writes with a shell heredoc is
no longer rewritten. The answer note still covers what the agent says.

Not capped: each turn end starts its own worker, so several quick turns or
several sessions can each run three rewriters. A Codex turn may still
rewrite up to five files that a program made.

## 2026-10-10, the card tells the agent to explain its names and to say what a method needs

A session reported for three days on a method it called "continuation" and
never said that the method runs on a local model only. Every sentence of those
reports could pass the lint. The fault was a missing fact, and a rule set that
reads sentences cannot see one. So the card has a fourth paragraph, about the
reader: explain a name the first time you use it, say what a method needs and
where it cannot run before you give results, and say what you did, checked and
left undone. It costs about 80 words of system prompt in every session.

The Stop hook still does not send a flagged answer back for a rewrite. Claude
Code shows an answer as the model writes it, and a hook that refuses the end of
a turn makes the model write a second answer under the first. The user reads
both. No hook runs between the model and the screen, so a rewrite of the answer
cannot be hidden.

## 2026-09-27, the project's textoic.config.json can switch rules off and ignore cases

The Textoic editors share an eslint-style config file, and enlint 0.2.0 can
ignore single cases of its list-based rules. A user who ignores "very dirty" in
VS Code expects the agent to stop flagging it too. `editorial` is now the house
style (every rule on) with two things from the nearest `textoic.config.json`
laid over it: rules set to `"off"` and each rule's `ignore` list. The file's
`extends` and severities are skipped, so a project on the editors'
`recommended` preset does not quietly weaken the agent's style. The file is
read once, from the working directory the hook runs in; a file that is not
JSON is skipped, because the Stop hook must never fail.

The reader is written here rather than imported from `enlint-lsp`: the plugin
needs two fields, and importing the server's config module would add its
dependency tree to a bundle that ships to every install.

## 2026-09-27 — The bundle is committed because nobody builds a plugin

Claude Code and Codex install a plugin by cloning its repository, and neither
runs `npm install` or a build script afterwards. So `bundle/`, with the two
`@textoic` packages and the 11 MB dictionary inside it, and
`output-styles/house-style.md` are committed, and a fresh clone runs with no
`node_modules`. `.gitattributes` marks both as generated so their churn stays
out of diffs. `dist/` stays ignored, because only the tests and the type check
read it.

Codex users who install from GitHub never run `install.mjs`, so the card
cannot depend on it. A SessionStart hook adds the card as context when the
transcript path names a Codex rollout file, and stays quiet when the Codex
config already carries it in `developer_instructions`, or in Claude, where the
output style already does the job.

## 2026-09-27 — Each harness rewrites with its own model

The first Codex version sent Codex's documents to Claude's Haiku, which made
Codex depend on Claude Code being installed and logged in. The worker now has
two backends. `codex exec --ephemeral --ignore-user-config -s read-only` on
`gpt-6-luna` at low effort takes the rewriter's instructions as
`developer_instructions` and the brief on stdin, and writes the reply through
`-o`. Ignoring the user config keeps enlint's own plugin, hooks and style card
out of the child. An 800-word document takes about 23 seconds. The Stop hook
picks the backend from `turn_id`, a field Codex adds to every hook payload and
Claude never sends.

Codex hooks copy Claude's format field for field, and Codex sets
`CLAUDE_PLUGIN_ROOT` for plugin hooks, so one `hooks/hooks.json` serves both.
Two things differ. Codex runs a plugin's hooks only after the user approves
them once in `/hooks`. And on Windows Codex often writes files through
PowerShell, which reaches hooks as a `Bash` call with no file path, so the Stop
hook also scans the working folder for prose files created during the turn.

On the same day `english-lint` became `enlint` and `nlp` became `artisan`, and
the old folders moved to `archived/`. Artisan's repository does not commit
`dist/` and has no `prepare` script, so a git dependency installs it unbuilt.
This project links `../artisan` instead, which must be built first.

## 2026-09-27 — The style card lives in the system prompt

The SessionStart hook put the card into the conversation as one early message,
which later turns bury and compaction can drop. A plugin can instead ship an
output style in `output-styles/`, and the frontmatter key `force-for-plugin:
true` switches it on whenever the plugin is enabled. With
`keep-coding-instructions: true` Claude Code appends the style to its own
system prompt rather than replacing it. That keeps the card in every request,
where it is cached, and survives compaction. A headless Haiku session quoted
the card back as part of its system prompt. `npm run build` writes the style
from `style/compact.md`, so the card has one source, and the SessionStart hook
is gone.

The list rule is gone too, from the linter and from every guide. Lists are a
legitimate shape for steps, options and reference material, and the rule
pushed agents to fold them into paragraphs that read worse.

## 2026-09-27 — Rewrites happen off the conversation, and answers are not rewritten

Handing a flagged turn back to the model with `decision: "block"` worked, and
it was the wrong design. For an answer, the model loaded the skill, spawned the
rewriter, read the rewrite back and sent the whole answer a second time, so
the user saw every answer twice and paid main-model tokens for all of it.
Claude Code prints an answer before any hook can read it, so an answer cannot
be corrected without being sent again. The Stop hook now never blocks and
never prints. For a flagged answer it leaves a one-line note that the
UserPromptSubmit hook adds to the next prompt, which costs about forty tokens
and shapes the next answer.

Documents are rewritten by a detached `node hooks/rewrite-worker.mjs`, which
runs `claude -p` on Haiku with the rewriter's instructions as the system prompt
and no tools, and takes the passage from stdout. `--setting-sources ""` drops
user settings, which switches the plugin off for that child, and
`ENLINT_DISABLE=1` covers the case where it does not. `--system-prompt`
replaces Claude Code's own prompt, which leaves about 800 input tokens, and
turning thinking off took an 800-word document from 71 seconds and six cents
to 10 seconds and under two cents. `--bare` would have been simpler but
refuses OAuth logins.

A rewrite nobody reviews needs guards a reviewed one does not. The worker
lints with the shape rules off and tells the model to keep headings, lists and
tables, because the author chose that structure. It refuses a rewrite that
changes a fence, inline code, a link target, a URL, a table row or quoted
text, compared with whitespace collapsed because a quote can break across
lines. In testing, Haiku twice turned the quoted word "delve" into "explore".
The linter now masks short quoted spans, so a quoted word draws no finding in
the first place. The worker writes only when the file still holds exactly what
it read, and it wraps changed paragraphs to the file's own width while leaving
untouched ones byte for byte, so the diff shows only what changed.

## 2026-09-27 — The answer is the text after the last tool call

`finalAnswerIn` used to join every assistant text block since the person's
last message. In a turn with tool calls, that sweeps in the progress notes
written between calls, so the rewriter was handed notes the reader had already
scrolled past, and the rewrite came back with them stitched into the answer.
The answer now starts after the last assistant entry that calls a tool, and an
entry that carries both text and a tool call counts as a call.

A subagent's `Write` fires the parent's PostToolUse hook with the parent's
`session_id`, so its documents land in the same log and the parent's Stop hook
lints them. The hook used to drop writes that carried an `agent_id`, only so
the rewriter's output would not be linted, but that output already lives in
enlint's temp folders, which the path filter skips.

## 2026-09-27 — The cached copy of the plugin cannot load its libraries

Claude Code copies a plugin from a directory marketplace into
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. The copy keeps
`node_modules`, but `english-lint` and `nlp` are `file:../` links, and the
copier rewrote them to point at `cache/<marketplace>/<plugin>/english-lint`,
which does not exist. Anything run from that copy throws
`ERR_MODULE_NOT_FOUND`.

It did not break the hooks here. On Claude Code 2.1.283 a directory marketplace
sets `CLAUDE_PLUGIN_ROOT` to the source folder, which the Stop hook proved by
naming `bin/enlint.mjs` in this checkout when it computed the path from its own
location. It would break an install from git or any source that is copied, so
the plugin now runs from `bundle/`. esbuild builds that with both libraries
inlined and the two dictionary files beside it. `src/nlp.ts` looks for
`./data/` beside itself first and falls back to the `nlp` package, which keeps
`dist/` and the tests working. `install.mjs doctor` runs the installed copy
too.

## 2026-09-27 — A Stop hook's systemMessage never reaches the model

The Stop hook reported findings in `systemMessage`, which Claude Code shows the
user and never puts in the model's context. So the model had no way to know an
answer was flagged, and no reason to call the skill; working as designed, the
hook could only ever produce a note the user had to act on. To make the model
act, a Stop hook returns `decision: "block"` with a `reason`, and the reason
becomes the model's next input. Claude Code sets `stop_hook_active` on the turn
that follows, and the hook returns early on it, which bounds the cost at one
extra turn.

Documents take a different path because a Stop hook sees only the transcript.
A PostToolUse hook on `Write|Edit|MultiEdit` appends the path, or for an edit
only the text added, to a per-session log in the temp folder. It loads nothing
but that log module, so it costs about as much as starting node. The Stop hook
reads the log, lints each document once with the dictionary already loaded,
and records what it reported so the rewrite does not get flagged again.

## 2026-09-14 — Documentation about a linter trips the linter

Linting this repository's own prose reports 31 problems in `README.md` and 16
in this file, and most of the word-level ones are the rules matching the text
that documents them. `no-explained-antonyms` fires on "not harmful", and
`no-explained-intensifiers` fires on `("very bad"`, because the README quotes
both as examples of what those rules catch. `no-negated-contrasts` fires on the
style card's own "not A, but B".

Those are not defects in the prose and they are not defects in the rules. They
are the same effect `enlint-lab` records for transcripts: a document that
discusses a vocabulary contains that vocabulary. Expect it in anything written
about this project, and read a rate measured over these files as a fact about
self-reference rather than about writing quality.

The em dashes the same run found are real, and the README still has them.

## 2026-09-14 — The style card must obey the style card

`style/compact.md` opened three paragraphs with a bold lead-in while telling the
model not to open paragraphs with bold lead-ins, and used an em dash while
telling it not to. The card is injected into every session as instructions, so
its shape teaches by example, and an instruction that demonstrates its own
violation is worse than no instruction. It is now written as the running prose
it asks for.

Check it with `node bin/enlint.mjs check style/compact.md` after any edit. The
negated contrast it still reports is the rule quoting itself, per the note
above.

## 2026-09-14 — Windows paths must go through pathToFileURL

`hooks/stop-lint.mjs` loaded the compiled library with
``import(`file://${root}/dist/${name}`)``. On Windows `root` is
`C:\Users\...`, so that builds `file://C:\Users\...`, which is not a valid URL.
The import threw, the catch-all swallowed it, and the hook exited 0 with no
output — indistinguishable from "the answer was clean". Use `pathToFileURL`.

The same shape of bug is invisible by construction: a hook that must never
break a session catches everything, and a hook that catches everything cannot
tell you it is broken. `ENLINT_DEBUG=1` prints the stack to stderr and exists
only for that reason. Test the hook by feeding it a payload with a real
Windows path; a Git Bash path like `/c/Users/...` resolves to `C:\c\Users\...`
and produces a misleading ENOENT.

## 2026-09-14 — The main agent never reads the brief

The point of the split is that detection is free and rewriting is not. Linting
is a subprocess: it costs no tokens, so the Stop hook can run on every turn.
Rewriting needs the style guide, the flagged spans and the whole passage in
some model's context, and the cheapest place to put them is a subagent running
a small model.

So `enlint fix` writes the brief to a temp file and prints only its path. The
caller passes that path to `prose-rewriter` and never opens it. The full style
guide lives in `agents/prose-rewriter.md`, which loads into the subagent's
context and never into the caller's. What the caller spends on a rewrite is
the summary line, two paths, and the verdict — under a hundred tokens.

If a change makes the main agent read the brief, the guide, or the passage, it
has given up the only reason this is shaped the way it is.

## 2026-09-14 — Advisory, not blocking, on Stop

The Stop hook reports and never blocks. Blocking would mean the agent cannot
finish its turn while its answer trips a rule, which is the only way to make
the model fix prose before the user sees it — and also a way to loop forever on
a passage no rewrite will clear. A flagged answer is usually still a correct
answer, and a short factual reply that trips one rule should not cost a turn.

The consequence, which the design accepts: advice arrives after the answer is
already on screen. The note names `/enlint-fix` so the fix is one command away
rather than something the model must re-derive.

Thresholds keep it quiet: nothing is said below 60 words or 3 findings
(`ENLINT_MIN_WORDS`, `ENLINT_MIN_ISSUES`). Without them every two-line answer
would draw a note and the whole thing would read as nagging.

## 2026-09-14 — Six modules were copied from enlint-lab, not imported

`markdown.ts`, `document.ts`, `structure.ts`, `config.ts`, `verify.ts` and the
deterministic half of `punctuate.ts` (here `mechanical.ts`) came from
`../enlint-lab` almost verbatim.

Importing the lab instead would have dragged in express, hyparquet and a corpus
store to get four hundred lines of text handling, and would have made a skill
that anyone can install depend on a research repo that is gitignored in the
parts that matter. Copying costs divergence: a bug fixed in one is not fixed in
the other. That trade is recorded here so the next person checks both.

`english-lint` and `nlp` are real dependencies, linked with `file:`. They are
built artefacts (`dist/`), so both must be built before this package runs.

## 2026-09-14 — Shape rules are not in english-lint

`no-lists` and `no-bold-lead-ins` are line-level markdown judgements, not
sentence-level ones, so they never belonged in a rule set that takes parsed
sentences. They live in `structure.ts` and are merged into the findings list by
`lint.ts`. They matter more than any single word rule for this use case: a
bulleted answer with a bold phrase at the head of each paragraph is the fastest
way to recognise machine writing, and it is the default shape of an agent's
output.
