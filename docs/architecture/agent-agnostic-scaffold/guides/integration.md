# Integration Guide

Two integration paths are common: **reusing the emitter in another repository**, and
**adding a new target** to the emitter itself. This guide covers both.

## A. Reuse the emitter in another repo

The emitter is path-agnostic: every path and the target list come from the `config`
block of `tools.manifest.json` (`REQ-REUSE-01`). To run it over a different repo's
layout, you change only that config — no source edits.

### 1. Provide a manifest

Drop a `tools.manifest.json` at the consuming repo's root. The `config` block maps
the emitter to that repo's directory names (all fields optional — omit to accept the
defaults in the table below):

```json
{
  "version": 1,
  "config": {
    "skillsDir": "ai/skills",
    "agentsDir": "ai/agents",
    "commandsDir": "ai/commands",
    "referencesDir": "ai/references",
    "scriptsDir": "ai/scripts",
    "overridesDir": "ai/overrides",
    "adaptersDir": "ai/adapters",
    "targets": ["claude", "codex", "gemini"]
  },
  "tools": [
    {
      "name": "docs-helper",
      "type": "skill",
      "source": "ai/skills/docs-helper",
      "description": "Helps write and review project documentation."
    }
  ]
}
```

| Field | Default |
| --- | --- |
| `skillsDir` / `agentsDir` / `commandsDir` | `skills` / `agents` / `commands` |
| `referencesDir` / `scriptsDir` | `references` / `scripts` |
| `overridesDir` / `adaptersDir` | `overrides` / `adapters` |
| `targets` | all five, in canonical order |

### 2. Drive it programmatically (optional)

If you don't want the bundled CLI's repo-root assumption, compose the public API
yourself. The shape mirrors `src/cli.ts::prepare()`:

```ts
import { loadManifest, emit, emitPlugin } from "agent-docs";
// (resolveConfig / publish / report are internal helpers you'd import from the package)

const repoRoot = process.cwd();
const manifest = loadManifest(`${repoRoot}/tools.manifest.json`, repoRoot);
const result   = emit(manifest, roots, { name: pkg.name, version: pkg.version });
// → overlay overrides → render report → publish atomically
```

The single most important rule: **thread a real `identity`** (`{ name, version }`,
typically from the consuming repo's `package.json`) into `emit`, because the gemini
aggregate manifest embeds it. The CLI does this via `assemblePluginMeta`.

### 3. Wire the CI guard

Commit the generated `adaptersDir`/`.claude-plugin/` output and add the drift check
to CI so the bundles can't silently fall out of sync with source:

```sh
bun run build        # locally, after any source/manifest change — then commit the diff
bun run build:check  # in CI — exits nonzero on drift with a remediation message
bun run gate         # full bar: compile, schema check, typecheck, lint, format, test, drift
```

### Gotchas

- **Determinism is a contract.** If you extend a transform, never introduce
  `Date.now`, `Math.random`, or unordered `Map`/`Object.keys` iteration into emitted
  bytes — it breaks `build:check` and the determinism suite.
- **Stale overrides are non-fatal.** Removing a tool leaves any
  `overrides/<target>/<oldpath>` as a `staleOverrides` line in the report, not an
  error. Clean them up, but they won't block a build.
- **Path confinement.** All writes go through a confined writer; a `source` or
  override path escaping the resolved roots raises `PathEscapeError`. Keep everything
  under the repo root.

## B. Add a new target

Targets are a closed set in the type system, so adding one is a localized,
type-checked change. The registry is `Record<Target, TargetTransform>`, which means
the moment you add a `Target` literal, the compiler forces you to implement it.

### Steps

1. **Add the literal.** Extend the `Target` enum in `src/model.ts`, add it to
   `TARGET_ORDER`, and to the `EmitterConfig.targets` default if it should emit by
   default.
2. **Implement the transform.** Create `src/targets/<newtarget>.ts` exporting a
   `TargetTransform` (`src/targets/_shared.ts`):

   ```ts
   import type { TargetTransform } from "./_shared.js";
   export const newTarget: TargetTransform = {
     target: "newtarget",
     transformSkill(skill)   { /* → files[], drops[], manifestEntries[] */ },
     transformAgent(agent)   { /* … */ },
     transformCommand(cmd)   { /* … or best-effort fallback + a DropRecord */ },
     aggregateManifest(entries, identity) { return null; }, // or build one EmittedFile
   };
   ```

   Reuse the shared helpers: `orderFrontmatter`, `renderFrontmatter` (provenance),
   `dropAllClaudeKeys`, `hintValue`, `skillVerbatimRecords`. Keep every function
   **pure** — no I/O, no clock, no RNG.
3. **Register it.** Add it to the `TRANSFORMS` map in `src/targets/index.ts`. (The
   `Record<Target, TargetTransform>` type will fail to compile until you do.)
4. **Record what you can't represent.** Any construct the target lacks
   (`argument-hint`, an agent `model` key, slash commands) MUST emit a `DropRecord`
   (`kind: "fallback"` if the body still emits, `"skipped"` if nothing does) with a
   human-readable `reason` — never drop silently (`REQ-EMIT-03`).
5. **Add an aggregate schema (if any).** If the target has an aggregate manifest, add
   its Zod schema and a branch in `src/validate-manifests.ts::validateTargetManifest`.
6. **Test it.** Add `src/targets/<newtarget>.test.ts` (per-construct emission +
   provenance form + drop records), then run `bun run build` and commit the new
   `adapters/<newtarget>/` tree. `bun run gate` must stay green — including the
   determinism and drift suites.

### Where to look

- The contract: `src/targets/_shared.ts` (`TargetTransform` / `TransformOutput`).
- A clean reference with no fallbacks: `src/targets/claude.ts`.
- A reference with structural drops + an aggregate: `src/targets/codex.ts`,
  `src/targets/gemini.ts`.
- The spec for per-target rules: `specs/agent-agnostic-scaffold/04-transforms.md`
  (the code is the source of truth for current behavior).
