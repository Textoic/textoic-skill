# enlint

Makes a coding agent write English like a person, in Claude Code and in Codex.
It wraps [`@textoic/enlint`](https://www.npmjs.com/package/@textoic/enlint),
which holds the rules, and
[`@textoic/artisan`](https://www.npmjs.com/package/@textoic/artisan), which
parses the text, into something an agent applies
to its own output, both before it writes and after.

Three pieces do that. The style card sits in Claude's system prompt as an
output style, so the agent knows the rules before it writes a word and keeps
them for the whole session. A hook reads the final answer of every turn,
and every prose document the agent wrote in it, and lints them, which costs no
tokens at all because linting is a subprocess rather than a model call. When
a document needs rewriting, a background process hands it to a
subagent on a cheap model that carries the full style guide in its own
instructions, so the passage, the guide and the findings never enter the
context of the agent you are actually talking to.

That last part is the whole design. A rewrite needs perhaps three thousand
tokens of guide and passage in somebody's context. Putting them in Haiku's
costs a fraction of putting them in Opus's, and the caller only ever handles a
summary line, two file paths and a verdict — under a hundred tokens for a full
detect-and-rewrite cycle.

## What it catches

Fourteen rules across three scopes. The word rules are a list of 451 flagged
words and expressions plus the explained antonyms ("not harmful" for
"harmless"), explained intensifiers ("very bad" for "awful"), similes, and the
em dash. The sentence rules are passives, noun stacks, nested clauses, negated
contrasts ("not just X but Y"), absolute phrases and sentences packed too
densely with nouns. The shape rule flags a bold phrase at the head of a
paragraph. It does not exist in `enlint` because it is a line-level
markdown judgement rather than a sentence-level one, and a bold lead-in on every
paragraph is one of the fastest ways to recognise machine writing. Lists are
fine, and nothing flags them.

Code is safe. Fenced blocks, inline code, URLs and link targets are masked
before anything is parsed, so no rule can fire inside them.

## Installing

You need Node.js 20 or newer on your PATH, because every hook runs under
`node`. Nothing else: the repository ships a self-contained build in `bundle/`
with the rules, the parser and the dictionary inside it, so there is no
`npm install` step.

### Claude Code

The repository is a Claude Code plugin and a one-plugin marketplace:

    /plugin marketplace add Textoic/textoic-skill
    /plugin install enlint@textoic-skill

Restart Claude Code afterwards, because hooks load at session start. The style
card arrives as an output style, so it sits in the system prompt of every
session. Flagged documents are rewritten in the background by `claude -p` on
Haiku, which uses your existing Claude Code login.

To update, run `/plugin marketplace update textoic-skill` and then
`/plugin update enlint@textoic-skill`.

### Codex

The same repository is a Codex plugin and marketplace. With the Codex CLI:

    codex plugin marketplace add Textoic/textoic-skill
    codex plugin add enlint@textoic-skill

If you use Codex through the ChatGPT desktop app, you have the CLI already, but
not on your PATH: it lives at
`%LOCALAPPDATA%\OpenAI\Codex\bin\<version>\codex.exe` on Windows. Run the two
commands with that path in place of `codex`.

Codex runs a plugin's hooks only after you approve them once. In the ChatGPT
app, a **Review hooks** button appears in the Codex composer while a hook waits
for approval, and the plugin's page under Plugins and the Hooks section of
Settings offer the same review. In the terminal CLI, run `/hooks`. Until you
approve them, the plugin does nothing.

The style card reaches Codex through the session-start hook, which adds it as
context at the start of every session. For a stronger hold, put it in
`developer_instructions` in `~/.codex/config.toml`, which Codex sends as a
developer message in every request. A clone does that for you:

    git clone https://github.com/Textoic/textoic-skill
    node textoic-skill/scripts/install.mjs codex

That writes the card between `# enlint:begin` and `# enlint:end` markers, saves
your old config as `config.toml.enlint-backup` on the first run, refuses to run
if you already set `developer_instructions` yourself, and installs the plugin
from the clone with whichever Codex CLI it finds. Once the card is in the
config, the session-start hook stops adding its own copy.

Flagged documents are rewritten in the background by `codex exec` on
`gpt-6-luna` at low reasoning effort, run ephemeral and read-only with
`--ignore-user-config`, so the rewrite loads no plugins, no hooks and no style
card and saves no session. Set `ENLINT_CODEX` if the installer cannot find your
Codex CLI.

To update, run `codex plugin marketplace upgrade textoic-skill` and then
`codex plugin add enlint@textoic-skill` again.

### Checking the install

From a clone, `node scripts/install.mjs doctor` checks the build and runs the
copy each harness installed, so it tells you whether the plugin can actually
lint rather than whether its files exist.

## How the two harnesses differ

Codex hooks copy Claude's format field for field, and Codex sets
`CLAUDE_PLUGIN_ROOT` for plugin hooks, so one `hooks/hooks.json` serves both.
The Stop hook tells the two apart by the `turn_id` field that only Codex sends,
and sends each harness's documents to that harness's own model.

Codex on Windows often writes files through PowerShell rather than its patch
tool, and no hook sees what a shell command wrote. So the Stop hook also looks
for prose files created during the turn, under the folder the agent runs in. It
takes only files born during the turn, because for a file that already existed
it cannot tell the agent's text from yours. When a turn creates more than five
prose files, a program wrote them and the hook leaves all of them alone. Claude
does not get this check: its Write and Edit calls reach the hook with a path,
so a file a Claude turn makes through Bash is the output of a command and stays
as it is. The background worker runs three rewriters at a time.

## Developing

Clone the repository and build it:

    npm install
    npm run build
    npm test

`npm run build` compiles `src/` into `dist/` and then bundles it, with
`@textoic/enlint`, `@textoic/artisan` and the dictionary, into `bundle/`. It
also writes `output-styles/house-style.md` from `style/compact.md`. Commit
`bundle/` and `output-styles/`: both harnesses install a plugin by cloning it
and never run a build, so those files are the plugin. `.gitattributes` marks
them as generated, which keeps them out of diffs.

To release, bump `version` in `package.json`, `.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json` together, rebuild, and push. Both harnesses compare
the version to decide whether an update exists.

To try a change without pushing, point either harness at the clone:
`/plugin marketplace add ./textoic-skill` in Claude Code, or
`codex plugin marketplace add ./textoic-skill` in Codex.

## Testing it yourself

Start with the linter, which needs neither harness. A deliberately bad fixture
ships with the repository:

    node bin/enlint.mjs check test/fixtures/bad-prose.md

You should see twelve findings on 136 words, each with its line, column,
scope, rule and the flagged span, and a one-line summary underneath. It takes
about a third of a second, most of which is loading an eleven-megabyte
dictionary. Pipe your own writing through it with `node bin/enlint.mjs check -`.

Now the rewrite loop, by hand, the way the skill drives it:

    node bin/enlint.mjs fix test/fixtures/bad-prose.md

It applies the fixes that need no judgement — one em dash, in this case — and
prints a summary with two paths, one to a brief and one to where a rewrite
belongs. Read the brief to see what the subagent is told; then never read one
again, because reading it in your main context is the cost the whole design
exists to avoid. Adding `--write` saves those free fixes back into the file,
which is the only part of the pipeline that changes anything without asking a
model. Write a rewrite by hand to the second path, or ask an agent to, and
score it:

    node bin/enlint.mjs verify test/fixtures/bad-prose.md <the rewrite>

which reports how many problems cleared, how many survived, how many the
rewrite introduced, and the word count on both sides. It exits 1 while anything
is still flagged, and warns when the rewrite lost half the passage — a model
that summarises instead of rewriting produces text that lints perfectly and is
worse than what you gave it, so the word count is the check that matters most.

To watch the turn-end hook work without waiting for a turn, feed it a payload
by hand. Any Claude Code transcript will do; this takes the newest one you
have:

    T=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
    W=$(echo "$T" | sed 's|^/c/|C:/|')
    printf '{"session_id":"try","transcript_path":"%s","stop_hook_active":false}' "$W" | ENLINT_DEBUG=1 node hooks/stop-lint.mjs

It prints the JSON it would hand Claude Code, or nothing when the answer was
clean or too short. The path substitution matters on Windows: a Git Bash path
like `/c/Users/...` resolves to `C:\c\Users\...` and produces a misleading
file-not-found. To include documents, first send `hooks/record-write.mjs` one
`{"session_id":"try","tool_name":"Write","tool_input":{"file_path":"..."}}`
payload per file, with the same session id.

Once the plugin is installed, the end-to-end test is to ask Claude to write a
markdown document of a few paragraphs in a corporate voice. Nothing appears in
the conversation. About ten seconds after the turn ends the file changes on
disk, and `node bin/enlint.mjs log` shows the rewrite, what it cleared and what
it cost.

## Turning it down

The hook says nothing below 60 words or 3 findings, so short factual replies
never draw a note. `ENLINT_MODE=notify` shows you what was flagged and rewrites
nothing. `ENLINT_DOCUMENTS=0` stops it recording the documents Claude writes,
`ENLINT_FEEDBACK=0` drops the note about a flagged answer, and
`ENLINT_CLAUDE_MODEL` and `ENLINT_CODEX_MODEL` pick the background model for
each harness, `haiku` and `gpt-6-luna` by default. `ENLINT_REWRITER=claude` or
`codex` forces one backend for both. Both thresholds are environment variables, `ENLINT_MIN_WORDS`
and `ENLINT_MIN_ISSUES`; raise them if it still speaks up more than you want.
The style card is a plugin output style that switches itself on, and it is
built from `style/compact.md` by `npm run build`. Choosing another style in
`/config` replaces it, and disabling the plugin removes it.
`ENLINT_DISABLE=1` turns off every hook and leaves the command line working.
`ENLINT_DEBUG=1` makes the hook print what it swallowed, which is the only way
to tell a broken hook from a clean answer, since it exits 0 on every path by
design.

Individual rules come off with `--off`, which takes a comma-separated list of
rule ids; `node bin/enlint.mjs rules` names all fourteen. Switch one off for
prose where it genuinely does not apply, not for prose you could not fix.

The plugin also reads the `textoic.config.json` (or `.textoicrc.json`) nearest
the working directory, the file the Textoic editors and
[enlint-lsp](https://github.com/Textoic/enlint-lsp) use. A rule set to `"off"`
there is off here too, and cases listed under `ignore` are not reported:

```json
{
  "rules": {
    "no-passive-sentences": "off",
    "no-explained-intensifiers": ["warn", { "ignore": ["dirty"] }]
  }
}
```

Only those two settings carry over. The plugin keeps every other rule on,
whatever the file's `extends` says, because the house style is stricter than
an editor's defaults.

## What it will not do

A chat answer is never rewritten. Claude Code shows the answer before any hook
can read it, so the only way to fix one is to send it twice, and that costs the
tokens and the screen space this plugin exists to save. The hook leaves a
one-line note that reaches Claude with your next message instead, so the next
answer follows the style.

A background rewrite keeps headings, lists, tables, code, links and quoted text
exactly as they were, and wraps changed paragraphs to the width the file
already uses. It keeps the original when the rewrite changed any of those, when
it cleared no more than it introduced, when it lost half the words, or when the
file changed while it ran. Every attempt lands in `node bin/enlint.mjs log`.

The hook lints the answer you read at the end of a turn, which is the text
after Claude's last tool call, and skips the progress notes before it. It lints
documents that subagents write as well as Claude's own. It never sees a file
written through a shell command, such as a heredoc or a script, because only
the `Write`, `Edit` and `MultiEdit` tools pass through it. It also skips prose
inside source files, and documents under a `.claude` folder, which holds memory
and settings rather than anything a person reads.

The rules encode one person's house style, not a general theory of good
English. `no-special-punctuation` objects to the em dash because it is eight
times more common in a model's prose than in a person's, which is a fact about
detection rather than about quality. If you disagree with a rule, switch it off
rather than writing around it.

## Layout

`src/` holds the library, `bundle/` the self-contained build the plugin runs,
and `bin/enlint.mjs` the command line. `skills/`,
`agents/`, `commands/`, `hooks/` and `output-styles/` are the Claude Code
plugin, discovered by convention. `style/` holds the four guides: the compact
card that becomes the output style, and the three full ones the rewriter
carries. `.codex-plugin/` and `.agents/plugins/` make the same folder a Codex
plugin and marketplace.

Six modules under `src/` were copied from a private research repository
rather than imported, to keep this installable without dragging it behind.
`docs/architecture.md` records that trade and the rest of the decisions, newest
first, and `CLAUDE.md` is the working agreement for changing any of it.
