# Contributing to agent-docs

This repo authors agent tooling **once** in Claude-native form, then emits per-target
adapter bundles for Claude, Codex, Copilot, Cursor, and Gemini with one command.

The canonical sources under `skills/`, `agents/`, and `commands/` are the single
source of truth.
Running `bun run build` transforms them into `adapters/<target>/` bundles plus the
installable `.claude-plugin/` manifests — no adapter file is ever hand-edited in the
common case.

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

> `agents/` and `commands/` are scaffolded but currently empty — the three shipped
> tools are all skills. The pipeline supports agents and commands when you add them.

## How a tool is named

A tool's `name` is **kebab-case** and MUST equal its source basename:

- skill: the directory name (`skills/doc-site/` -> `doc-site`).
- agent / command: the file stem (`agents/spec-author.md` -> `spec-author`).

A skill's `SKILL.md` frontmatter `name` must also agree with the manifest entry
`name` — the build cross-checks this and fails on a mismatch.
Names are unique per `(type, name)`, so a skill and a command may share a slug.

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

## How a build works

`bun run build` is the canonical local build.
Every paths-and-targets value is read from the `config` block in
`tools.manifest.json`, so the same emitter can be reused in another repository by
changing only that config.

| Command                       | What it does                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `bun run build`               | Emit all adapters, the coverage report, and `.claude-plugin/`.                             |
| `bun run build:check`         | Re-emit in memory and fail if the committed tree has drifted.                              |
| `bun run schema:gen`          | Regenerate `schemas/tools.manifest.schema.json`.                                           |
| `bun run schema:check`        | Fail if the committed schema has drifted.                                                  |
| `bun run build:diagram`       | Rebundle the diagram renderer CLI (`skills/diagram-generator/scripts/diagram-render.mjs`). |
| `bun run build:diagram:check` | Fail if the committed diagram bundle has drifted.                                          |
| `bun run gate`                | Full CI bar: compile, schema checks, typecheck, lint, format, test, drift checks.          |

Run `bun run gate` before pushing — it is the project's gate (the repo has no remote
CI configured).

## Source layout (`src/`)

The emitter is a small, pure TypeScript pipeline:

| Module          | Role                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `cli.ts`        | Entry point; `build` and `build --check` commands; writes plugin manifests.    |
| `emit.ts`       | Core in-memory transform: discover sources → per-target transform → aggregate. |
| `manifest.ts`   | Loads and validates `tools.manifest.json`, including cross-field checks.       |
| `discover.ts`   | Discovers skills/agents/commands and shared references/scripts.                |
| `config.ts`     | Resolves roots and targets from the manifest `config` block.                   |
| `model.ts`      | Core data model: enums, Zod schemas, `EmitResult`.                             |
| `targets/*.ts`  | Per-target transforms (`claude`, `codex`, `copilot`, `cursor`, `gemini`).      |
| `publish.ts`    | Atomic, path-confined disk publish of the adapter tree.                        |
| `overrides.ts`  | Loads and applies per-target whole-file overrides.                             |
| `plugin.ts`     | Generates `plugin.json` and `marketplace.json`.                                |
| `report.ts`     | Renders `adapters/GENERATION-REPORT.md`.                                       |
| `driftguard.ts` | Diffs a fresh emit against the committed tree; throws on drift.                |
| `diagram/`      | The diagram-generator runtime (schema, validate, render, png, cli).            |

Each target's transform records which Claude-native features it had to drop (for
example, Cursor and Copilot drop `argument-hint` and `metadata`). Those drops are
summarized per target in `adapters/GENERATION-REPORT.md`.

## The diagram renderer bundle

`skills/diagram-generator/scripts/diagram-render.mjs` is a generated, self-contained
Node bundle built from `src/diagram/cli.ts`.
Do not edit it by hand — change the source under `src/diagram/` and run
`bun run build:diagram`.
`bun run gate` includes `build:diagram:check`, so a stale bundle fails the gate.

### Regenerating the README sample diagrams

`assets/sample-architecture.{light,dark}.svg` (the `<picture>` pair in `README.md`)
are rendered from the spec below. The spec is intentionally **not** committed — the
diagram-generator skill treats specs as throwaway intermediates — so it lives here.
To refresh the samples (e.g. after a renderer change), write the spec to a temp file
and render both themes through the bundled CLI:

```bash
cat > /tmp/sample-architecture.spec.json << 'JSON'
{
  "diagramType": "architecture",
  "title": "agent-docs build pipeline",
  "description": "Canonical Claude-native skills are emitted by one build into per-target adapter bundles and a Claude plugin.",
  "nodes": [
    { "id": "skills", "label": "Canonical skills\n(skills/*/SKILL.md)", "role": "storage" },
    { "id": "manifest", "label": "tools.manifest.json", "role": "default" },
    { "id": "build", "label": "bun run build\n(emitter)", "role": "compute" },
    { "id": "adapters", "label": "adapters/<target>\nclaude · codex · copilot · cursor · gemini", "role": "backend" },
    { "id": "plugin", "label": ".claude-plugin\n(plugin + marketplace)", "role": "gateway" }
  ],
  "edges": [
    { "from": "skills", "to": "build", "label": "discover" },
    { "from": "manifest", "to": "build", "label": "config + registry" },
    { "from": "build", "to": "adapters", "label": "emit" },
    { "from": "build", "to": "plugin", "label": "generate" }
  ],
  "containers": [
    { "id": "authored", "label": "Authored once (Claude-native)", "children": ["skills", "manifest"] }
  ]
}
JSON
node skills/diagram-generator/scripts/diagram-render.mjs /tmp/sample-architecture.spec.json \
  --theme light --out-file assets/sample-architecture.light.svg
node skills/diagram-generator/scripts/diagram-render.mjs /tmp/sample-architecture.spec.json \
  --theme dark  --out-file assets/sample-architecture.dark.svg
```

The output is deterministic, so re-rendering an unchanged spec produces byte-identical
SVGs. The samples are transparent by default and embedded via a light/dark `<picture>`.

## Specs and architecture docs

Design intent lives outside this file:

- `specs/diagram-generator/` and `specs/doc-site-plugin/` — PRDs, tech specs, and
  numbered section specs with traceability.
- `docs/architecture/` — per-feature architecture, API reference, and guides.
