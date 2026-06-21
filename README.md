# agent-docs

Author your agent tooling **once** in Claude-native form, then emit per-target
adapter bundles for Claude, Codex, Copilot, Cursor, and Gemini with one command.

The canonical sources under `skills/`, `agents/`, and `commands/` are the single
source of truth. Running `bun run build` transforms them into `adapters/<target>/`
bundles plus the installable `.claude-plugin/` manifests — no adapter file is ever
hand-edited in the common case.

## Where a tool lives

A tool's canonical (Claude-native) source lives under one of three roots, by type:

| Type      | Canonical location       | Form                              |
| --------- | ------------------------ | --------------------------------- |
| `skill`   | `skills/<name>/SKILL.md` | a directory containing `SKILL.md` |
| `agent`   | `agents/<name>.md`       | a single markdown file            |
| `command` | `commands/<name>.md`     | a single markdown file            |

Two kinds of shared, tool-agnostic assets are copied verbatim to every target:

- `references/` — shared reference documents.
- `scripts/` — shared helper scripts.

A skill may also own its own `references/` (and `scripts/`) inside its directory
(e.g. `skills/<name>/references/…`); these are copied verbatim alongside the skill
in each target bundle.

The emitted output and overrides live in:

- `adapters/<target>/…` — generated bundles (committed, drift-guarded — do not edit).
- `overrides/<target>/<relpath>` — optional hand-authored whole-file replacements.
- `.claude-plugin/` — generated `plugin.json` + `marketplace.json` (committed).
- `schemas/tools.manifest.schema.json` — generated JSON Schema for the manifest.

## How a tool is named

A tool's `name` is **kebab-case** and MUST equal its source basename:

- skill: the directory name (`skills/docs-helper/` -> `docs-helper`).
- agent / command: the file stem (`agents/spec-author.md` -> `spec-author`).

A skill's `SKILL.md` frontmatter `name` must also agree with the manifest entry
`name` — the build cross-checks this and fails on a mismatch. Names are unique per
`(type, name)`, so a skill and a command may share a slug.

## How to add a tool

Adding a tool is three steps; no emitter source is touched.

1. **Author the canonical file** under `skills/`, `agents/`, or `commands/` (plus
   any shared `references/`/`scripts/`). Write it in Claude-native form.
2. **Register it** by adding a `ToolEntry` to `tools.manifest.json`:

   ```json
   {
     "name": "docs-helper",
     "type": "skill",
     "source": "skills/docs-helper",
     "description": "Helps write and review project documentation following the repo's house style."
   }
   ```

3. **Run the build**: `bun run build`. The adapters and plugin manifests regenerate.

   Commit the regenerated `adapters/` and `.claude-plugin/` output alongside your
   source change.

### Worked example: `docs-helper`

The repo ships one sample skill, `docs-helper`, demonstrating the full flow:

- Canonical source: `skills/docs-helper/SKILL.md` and its owned reference
  `skills/docs-helper/references/style-guide.md`.
- Manifest entry: the `docs-helper` skill in `tools.manifest.json`.
- After `bun run build`, it emits to all five targets, for example:
  - `adapters/claude/skills/docs-helper/SKILL.md` (canonical, no drops)
  - `adapters/codex/skills/docs-helper/SKILL.md`
  - `adapters/cursor/rules/docs-helper.mdc`
  - `adapters/gemini/skills/docs-helper/docs-helper.md` + `gemini-extension.json`
  - `adapters/copilot/instructions/docs-helper.instructions.md`

  Its owned `references/style-guide.md` is copied verbatim under each target, and
  per-target metadata drops are recorded in `adapters/GENERATION-REPORT.md`.

## How to run a build

| Command                | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `bun run build`        | Emit all adapters, the coverage report, and `.claude-plugin/`.                  |
| `bun run build:check`  | Re-emit in memory and fail if the committed tree has drifted.                   |
| `bun run schema:gen`   | Regenerate `schemas/tools.manifest.schema.json`.                                |
| `bun run schema:check` | Fail if the committed schema has drifted.                                       |
| `bun run gate`         | Full CI bar: compile, schema check, typecheck, lint, format, test, drift check. |

`bun run build` is the canonical local build. Every paths-and-targets value is
read from the `config` block in `tools.manifest.json`, so the same emitter can be
reused in another repository by changing only that config.
