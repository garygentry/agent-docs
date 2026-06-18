# agent-agnostic-scaffold

Author your agent tooling **once** in Claude-native form, then emit per-target
adapter bundles for **Claude, Codex, Copilot, Cursor, and Gemini** with a single
`bun run build`.

This feature is the emitter that powers that workflow: a deterministic,
manifest-driven transform pipeline that reads canonical sources under `skills/`,
`agents/`, and `commands/`, and writes committed, drift-guarded adapter bundles
into `adapters/<target>/` plus the installable `.claude-plugin/` manifests.

> For the **end-user** workflow (where a tool lives, how to add one, how to run a
> build), see the repo-root [`README.md`](../../../README.md). This document is the
> **architecture reference** for developers maintaining or extending the emitter
> itself.

## What it does

- **One source of truth.** A tool's Claude-native source is canonical. Every other
  target's form is a *transform of* the Claude form — never hand-authored in the
  common case (`CON-03`).
- **Five targets, one command.** `bun run build` discovers every tool in
  `tools.manifest.json` and emits all five adapter bundles plus the coverage report
  and plugin manifests.
- **Deterministic & drift-guarded.** Output is byte-stable across runs
  (`REQ-EMIT-05/06`). `bun run build:check` re-emits in memory and fails CI if the
  committed tree has drifted, so the adapters can be trusted as committed artifacts.
- **Best-effort fallback.** Constructs a target can't represent (e.g. a slash
  command on Copilot, an agent `model` key on Cursor) are downgraded to the nearest
  representable form and recorded as drops in `adapters/GENERATION-REPORT.md`
  (`REQ-EMIT-03`) — nothing fails silently.
- **File-level overrides.** A hand-authored file under `overrides/<target>/<relpath>`
  replaces the generated file wholesale and survives every rebuild (`REQ-EMIT-04`).

## When to use it

- You maintain agent tooling (skills / subagents / slash commands) that must run
  across more than one agent CLI, and you don't want to hand-maintain N copies.
- You want the per-target bundles **committed** to the repo (reviewable diffs,
  no build step for consumers) with a CI guard that they match source.
- You want to reuse the same emitter in another repository by changing only the
  `config` block of its manifest (`REQ-REUSE-01`).

## When NOT to use it

- You only ever target Claude. The canonical sources *are* the Claude form; the
  emitter adds no value for a single-target repo.
- You need to hand-tune most per-target output. Overrides exist for the occasional
  file, but if the majority of a target's bundle is overridden you're fighting the
  tool — the transform rules (`src/targets/`) are the right place to fix that.
- You need runtime/dynamic generation. The emitter is a build-time, file-in →
  file-out transform; there is no server, daemon, or live API.

## Key concepts

| Concept | Meaning |
| --- | --- |
| **Canonical source** | The Claude-native file under `skills/`, `agents/`, or `commands/`. The single source of truth. |
| **Manifest** | `tools.manifest.json` — the explicit, Zod-validated registry of every tool plus the paths/targets `config` block. The sole discovery input. |
| **Target** | One of `claude`, `codex`, `copilot`, `cursor`, `gemini`. `claude` is the privileged/canonical form. |
| **Transform** | A `TargetTransform` (`src/targets/<target>.ts`) — pure functions mapping one canonical record to one target's files + drop records. |
| **Drop** | A construct that couldn't be faithfully represented for a target; downgraded (`fallback`) or omitted (`skipped`) and reported. |
| **Override** | A whole-file replacement under `overrides/<target>/…` that overlays the generated file and survives rebuilds. |
| **Verbatim copy** | A shared `references/`/`scripts/` file (or skill-owned ref) copied byte-identical into every bundle, with no provenance header. |
| **Drift** | A committed adapter file that no longer matches a fresh emit (`content` / `orphan` / `missing`). The CI guard fails on any. |

## Build commands

| Command | What it does |
| --- | --- |
| `bun run build` | Emit all adapters, the coverage report, and `.claude-plugin/`. |
| `bun run build:check` | Re-emit in memory and fail if the committed tree drifted. |
| `bun run schema:gen` | Regenerate `schemas/tools.manifest.schema.json` from the Zod model. |
| `bun run schema:check` | Fail if the committed JSON Schema drifted from the Zod source. |
| `bun run gate` | Full CI bar: compile → schema check → typecheck → lint → format → test → drift check. |

## Further reading

- [Architecture](./architecture.md) — pipeline data flow, determinism model, the
  target-transform contract, and the key design decisions.
- [API Reference](./api-reference.md) — the public barrel, core types, manifest
  config, and the error hierarchy.
- [Integration Guide](./guides/integration.md) — reusing the emitter in another
  repo, and adding a new target.
