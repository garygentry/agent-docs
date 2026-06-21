# 01 — Architecture & Layout

How the agent-agnostic scaffold is structured in the `agent-docs` repo: directory
tree, project manifest, build/compiler config, and the module export surface. This
is greenfield — the repo currently has no `package.json` (CON-01). Bun + TypeScript
is the CON-01 org mandate; per-tool conventions (tsconfig, vitest, Zod, ESLint,
Prettier) are adopted from rauf, which is itself a pnpm monorepo we do NOT mirror
topologically (tech-spec §3.1).

## Requirement Coverage

| REQ ID        | Requirement                                             | Section |
| ------------- | ------------------------------------------------------- | ------- |
| REQ-STRUCT-01 | Canonical layout separating source / adapters / scripts | 2       |
| REQ-STRUCT-02 | Adapters in committed in-repo adapters/<target>/        | 2       |
| REQ-STRUCT-03 | Claude artifacts are canonical source of truth          | 2       |
| REQ-STRUCT-04 | Authoring conventions documented                        | 2.3     |
| CON-01        | Bun + TypeScript                                        | 3, 4    |
| CON-02        | Adapters committed in-repo                              | 2       |
| REQ-EMIT-01   | Local build command                                     | 5       |
| REQ-DISC-03   | Manifest JSON Schema                                    | 2, 5    |
| REQ-REUSE-01  | Config-driven, path-agnostic                            | 4       |

## 2. Directory tree

```
agent-docs/
  package.json                         # §3
  tsconfig.json                        # §4
  vitest.config.ts
  eslint.config.mjs
  .prettierrc.json
  .bun-version                         # 1.3.10
  bun.lock
  .gitignore                           # node_modules/, dist/, *.tmp-*, NOT adapters/

  tools.manifest.json                  # config block + tool registry (00 §2.4)
  schemas/
    tools.manifest.schema.json         # generated from Zod, committed (REQ-DISC-03)

  # --- canonical (Claude-native) source — single source of truth (REQ-STRUCT-03)
  skills/
    <name>/
      SKILL.md
      references/…                     # skill-owned (optional)
      scripts/…                        # skill-owned (optional)
  agents/<name>.md
  commands/<name>.md                   # slash commands (REQ-TOOLS-03)
  references/…                         # shared references (REQ-TOOLS-04)
  scripts/…                            # shared scripts (REQ-TOOLS-04)

  # --- author-supplied per-target overrides (REQ-EMIT-04)
  overrides/<target>/<relpath>         # file-level overlay onto adapters/<target>/

  # --- generated, committed output (REQ-STRUCT-02, CON-02)
  adapters/
    GENERATION-REPORT.md               # coverage report (REQ-VALID-05)
    claude/   codex/   copilot/   cursor/   gemini/
  .claude-plugin/
    plugin.json                        # REQ-PKG-01
    marketplace.json

  # --- emitter implementation
  src/
    index.ts                           # barrel — re-exports all of 00 + core fns
    cli.ts                             # `build`, `build --check` (REQ-EMIT-01)
    config.ts                          # resolve EmitterConfig → absolute roots
    manifest.ts                        # Zod load/validate (02)
    schema-gen.ts                      # zod-to-json-schema + --check (02)
    discover.ts                        # canonical source → records (03)
    frontmatter.ts                     # parse/serialize YAML frontmatter (03)
    model.ts                           # re-export of 00 record types (03)
    targets/
      index.ts                         # target registry (Target → TargetTransform)
      claude.ts  codex.ts  copilot.ts  cursor.ts  gemini.ts   # (04)
    emit.ts                            # orchestrate discover→transform→merge (04/05)
    overrides.ts                       # load + overlay overrides/ (05)
    publish.ts                         # atomic write, stale cleanup, confinement (05)
    driftguard.ts                      # re-emit + diff (06)
    report.ts                          # ReportModel → GENERATION-REPORT.md (06)
    plugin.ts                          # emit .claude-plugin/ manifests (07)
    errors.ts                          # re-export of 00 error hierarchy
    paths.ts                           # path-confinement helpers (05, REQ-SEC-01)
    test/
      __fixtures__/…                   # tiny canonical trees for unit tests (08)
      __golden__/<target>/…            # expected sample-tool output (06/07/08)
      *.test.ts                        # co-located + here (08)
```

Note: `adapters/` is intentionally **committed** (CON-02) and NOT gitignored;
`.gitignore` excludes `node_modules/`, `dist/` (generated build output, not
committed), and the `*.tmp-*` staging dirs.

### 2.3 Authoring conventions (REQ-STRUCT-04)

A contributor adds a tool by: (1) authoring the canonical file under
`skills/`/`agents/`/`commands/` (or shared `references/`/`scripts/`); (2) adding a
`ToolEntry` to `tools.manifest.json`; (3) running `bun run build`. No adapter file
is hand-edited in the common case (SC-01). This flow is documented in the repo
README (generated/maintained alongside, not part of the emitter source).

## 3. Project manifest (`package.json`)

```json
{
  "name": "agent-docs-scaffold",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "agent-docs-build": "dist/cli.js" },
  "scripts": {
    "build": "bun run src/cli.ts build",
    "build:check": "bun run src/cli.ts build --check",
    "schema:gen": "bun run src/schema-gen.ts",
    "schema:check": "bun run src/schema-gen.ts --check",
    "compile": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "gate": "bun run compile && bun run schema:check && bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build:check"
  },
  "dependencies": {
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.24.0",
    "yaml": "^2.6.0",
    "smol-toml": "^1.3.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest",
    "vitest": "^3.0.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.4.0"
  }
}
```

`bun run build` is the canonical local build command (REQ-EMIT-01). `gate` is the
CI bar (CON-05): it runs `build:check` (the drift guard) and `schema:check` last.

> Note: distinguish runtime deps (`zod`, `zod-to-json-schema`, `yaml`, `smol-toml`)
> from dev deps (everything else). `yaml` is required at runtime for byte-stable
> frontmatter + the codex `openai.yaml` aggregate. `smol-toml` is required for
> byte-stable TOML emission — Codex agents (`.codex/agents/*.toml`) and Gemini
> commands (`.gemini/commands/*.toml`) are TOML formats per `04-transforms.md`.
> The TOML serializer MUST produce deterministic, stable-key output to satisfy
> REQ-EMIT-06; verify `smol-toml`'s key ordering or pre-sort before stringify.

## 4. Build / compiler configuration

`tsconfig.json` (adopted from rauf's per-tool settings):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

`vitest.config.ts`: `{ test: { include: ["src/**/*.test.ts"] } }`.
Prettier: `{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100, "tabWidth": 2 }`.
ESLint 9 flat config with `typescript-eslint`, ignoring `dist/`, `adapters/`, `*.mjs`.

Scripts run directly under Bun (`bun run src/cli.ts …`) using `import.meta.main`;
no compile step is needed to execute the emitter. `tsc` is used only for
`typecheck` and the publishable `dist/` (programmatic-reuse consumers, REQ-REUSE-01).

## 5. Module export structure (`src/index.ts`)

The barrel re-exports everything from `00-core-definitions.md` plus the three
top-level entry functions and the packaging export, enabling programmatic reuse
in other repos (REQ-REUSE-01):

```typescript
export * from "./errors.js"; // 00 §4 error hierarchy
export * from "./model.js"; // 00 §2–3 types + Zod schemas + constants
export { loadManifest } from "./manifest.js"; // (manifestPath) => Manifest
export { emit } from "./emit.js"; // (Manifest, roots) => EmitResult
export { driftCheck } from "./driftguard.js"; // (Manifest, roots) => DriftEntry[]
export { emitPlugin } from "./plugin.js"; // (07) emit .claude-plugin/ manifests
export type { PluginMeta } from "./plugin.js"; // (07) plugin manifest metadata
```

The CLI (`src/cli.ts`) is the only place that reads `process.argv`/exit codes;
the library functions are pure(ish) and throw the `00 §4` errors.

## Dependencies

- `00-core-definitions.md` — all types/schemas/constants re-exported by `src/index.ts`.

## Verification

- [ ] `bun install` then `bun run build` produces `adapters/` from the canonical
      source with zero manual steps (REQ-EMIT-01, SC-01).
- [ ] `bun run gate` passes on a clean tree (CON-05 CI bar).
- [ ] `adapters/` is tracked by git (CON-02); `node_modules/`, `dist/`, and
      `*.tmp-*` are not.
- [ ] `src/index.ts` re-exports every public type from `00`, the three entry
      functions, and the `emitPlugin` packaging export — importable from another
      repo via the package `main`/`types`.
- [ ] No emitter module hardcodes an adapter or canonical _root_ path or the
      target list — all roots come from `EmitterConfig` (REQ-REUSE-01). (The
      committed JSON-Schema output path `schemas/…` and the build-output `dist/`
      are intentional fixed build-tooling paths, not part of the reuse config
      surface.)
