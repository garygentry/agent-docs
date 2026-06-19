# 05 — CLI & Invocation

The two invocation modes of the `diagram-generator` skill and how they converge on
**one execution path**. Part A specifies `src/diagram/cli.ts` — the pre-bundled,
zero-install **scriptable contract** that `doc-site-plugin` (and any consuming repo)
depends on (tech-spec §5, the four contract dimensions resolving doc-site-plugin's
OQ-4). Part B specifies the **conversational** path: what `skills/diagram-generator/SKILL.md`
must contain so an agent translates prose into a `DiagramSpec` and invokes the *same*
CLI — never a separate natural-language code path.

Both modes are **P0** (REQ-INV-01/02) and both terminate in a single validated
`DiagramSpec` → render → write pipeline (tech-spec §1). This document owns only the
*invocation boundary*: argument parsing, input acquisition, output-path resolution,
artifact writing, path confinement, exit signaling, versioning, and the SKILL.md
authoring rules. Schema parsing lives in `02-schema-and-validation.md`; rendering in
`03-rendering-engine.md`; PNG in `04-theme-postprocess-png.md`. All shared types,
constants, and error classes come from `00-core-definitions.md` — they are referenced
here, never redefined.

All code is TypeScript targeting Bun/Node (the bundle is `--target=node`,
`01-architecture-layout.md` §6), ESM, with a `/** … */` doc comment on every exported
symbol (matching `src/model.ts`).

## Requirement Coverage

| REQ ID | Requirement | Section |
| --- | --- | --- |
| REQ-INV-01 | Conversational invocation | 4 |
| REQ-INV-02 | Non-interactive / scriptable invocation, deterministic output paths | 2, 3 |
| REQ-INV-03 | Build-consumable contract — four dimensions doc-site-plugin depends on | 1, 2, 3 |
| REQ-INV-04 | Documented, versioned, stable contract — `--version` / `CONTRACT_VERSION` | 1, 2.4, 5 |
| REQ-IN-01 | Accept natural-language description, infer structure | 4.1, 4.2 |
| REQ-IN-03 | MUST NOT invent semantic content the user did not describe | 4.3 |
| REQ-USE-01 | Conversational path keeps simple diagrams simple — no DSL to learn | 4.1, 4.2 |
| REQ-SEC-01 | Writes confined to caller-specified path(s) — no escape | 3.3 |
| REQ-SEC-02 | No network at any point | 1.4, 2.5 |

## 1. The four contract dimensions (REQ-INV-03/04)

The scriptable surface frozen here is exactly the four-dimension contract
doc-site-plugin's OQ-4 depends on (tech-spec §5). Enumerated explicitly so an
implementer and a consumer agree on the same surface:

| # | Dimension | What the contract guarantees | Owned by |
| --- | --- | --- | --- |
| 1 | **Input** | A JSON `DiagramSpec` (`00` §2.4) supplied as a **file path** argument *or* `-` to read from **stdin**. Nothing else is an input form. | §2.1, §3.1 |
| 2 | **Output** | **Caller-controlled, predictable paths** via `--out-file` (or `--out-dir` + `--out-name`), plus a `--out-dir`-only convenience deriving `<slug>.<theme>.<ext>`, plus bare stdin→stdout for a single artifact. Formats: **SVG always**; **PNG** only on `--format png\|both`. | §2.3, §3.2 |
| 3 | **Invocable types** | All six diagram types of REQ-COV-01/02 (`00` §2.1 `DiagramType`) are invocable non-interactively via `--type` or the spec's `diagramType`. | §2.2 |
| 4 | **Exit / signaling** | `EXIT_CODES` (`00` §6): `0` = success; distinct non-zero per failure class, each with a **specific stderr message**; **no partial writes** on any failure. | §3.4 |

### 1.4 No network (REQ-SEC-02)

`cli.ts` performs **no network I/O** at any point — no fetch, no DNS, no socket.
Input is read from the filesystem or stdin; rendering (`03`) and PNG (`04`) run
in-process via bundled WASM/native addons; output is written to the local
filesystem. This is a contract invariant, asserted in §6 verification and by the
absence of any networking import in the bundle.

### Stability & versioning (REQ-INV-04)

The set {flags in §2.1, output-path precedence §2.3, slug/derived-name rules §2.3,
the four dimensions above, `EXIT_CODES`} **constitutes the published contract**.
`CONTRACT_VERSION` (`00` §6) is `"1.0.0"`. A breaking change to **any** of these —
removing/renaming a flag, changing precedence, changing a derived name, changing an
exit code's meaning, or changing the artifact format set — REQUIRES a **MAJOR** bump
so consumers (notably `doc-site-plugin`) can pin against a known release. Additive,
backward-compatible changes (a new optional flag) are MINOR. `--version` (§2.4) is
the machine-readable handle consumers query to pin.

## 2. CLI surface — `src/diagram/cli.ts` (REQ-INV-02/03/04)

`cli.ts` is the **bundle entry** (`01-architecture-layout.md` §3:
`bun build --target=node src/diagram/cli.ts → diagram-render.mjs`). It must stay
self-contained for bundling: it imports only from sibling `src/diagram/*` modules
and named npm packages — never from the repo's emitter tree (`src/publish.ts`,
`src/paths.ts`), so the confinement helper is reimplemented locally (§3.3) rather
than imported.

### 2.1 Flags (tech-spec §5, verbatim)

```
diagram-render <input.json | -> [options]

  --type <architecture|flowchart|sequence|er|state|dataflow>
                          overrides DiagramSpec.diagramType; else read from input
  --theme <light|dark>    default: spec.theme (else DEFAULT_THEME "light"); overrides spec
  --accent <#rrggbb>      overrides spec.accent; validated as HexColor (00 §2.1)
  --format <svg|png|both> default: DEFAULT_FORMAT ("svg")
  --out-file <path>       explicit output path; highest precedence. With --format both,
                          the extension is swapped per artifact (.svg / .png).
  --out-name <base>       explicit base name written into --out-dir (overrides slug)
  --out-dir <dir>         directory for derived/named artifacts; <slug>.<theme>.<ext> default
  --version               print CONTRACT_VERSION, exit 0
  -                       read spec JSON from stdin; with no output target → stdout
```

Unknown flags, a missing positional input, or mutually exclusive combinations
(`--out-file` together with `--out-name`/`--out-dir`; `-` together with a file path)
raise `DiagramUsageError` (`00` §5, exit `64`).

The parsed shape:

```typescript
import {
  type DiagramType,
  type Theme,
  type HexColor,
} from "./schema.js";

/** Artifact format selector for `--format` (tech-spec §5). */
export type OutputFormat = "svg" | "png" | "both";

/**
 * The fully parsed, validated CLI invocation — the structured result of
 * {@link parseArgs}. Every field is normalized: enum flags are narrowed to their
 * union type, `--accent` is HexColor-validated, and the input source is resolved to
 * exactly one of `inputPath` / `fromStdin`. Output fields are left as-supplied and
 * resolved to concrete paths by {@link resolveOutputPaths} (§2.3) once a
 * `RenderResult` (00 §3.2) is available (the slug is render-derived).
 */
export interface ParsedArgs {
  /** Absolute-or-relative path to the spec JSON, or `undefined` when reading stdin. */
  readonly inputPath?: string;
  /** True when the positional argument was `-` (read spec JSON from stdin, §3.1). */
  readonly fromStdin: boolean;
  /** `--type` override; when set, replaces `DiagramSpec.diagramType` (00 §2.1). */
  readonly type?: DiagramType;
  /** `--theme` override; when set, replaces `DiagramSpec.theme` (REQ-THEME-01). */
  readonly theme?: Theme;
  /** `--accent` override; HexColor-validated at parse (00 §2.1). */
  readonly accent?: HexColor;
  /** Requested artifact format(s); defaults to DEFAULT_FORMAT ("svg"). */
  readonly format: OutputFormat;
  /** `--out-file` explicit path (highest precedence, §2.3). */
  readonly outFile?: string;
  /** `--out-name` explicit base name written into `outDir` (§2.3). */
  readonly outName?: string;
  /** `--out-dir` directory for named/derived artifacts (§2.3). */
  readonly outDir?: string;
  /** True when `--version` was requested; short-circuits to print + exit 0 (§2.4). */
  readonly version: boolean;
}

/**
 * Parse and validate `argv` (process arguments **without** `node`/script prefixes)
 * into a normalized {@link ParsedArgs}.
 *
 * Validation performed here (fail-fast, before any input read or render):
 *  - exactly one input source: a positional path XOR `-` (unless `--version`);
 *  - `--type` / `--theme` / `--format` values are members of their enums;
 *  - `--accent` matches HexColor (00 §2.1);
 *  - `--out-file` is not combined with `--out-name` or `--out-dir`;
 *  - `--out-name` without `--out-dir` is rejected (no base directory to write into).
 *
 * @param argv - Raw CLI arguments, e.g. `process.argv.slice(2)`.
 * @returns The normalized, validated invocation.
 * @throws {DiagramUsageError} On any unknown flag, missing/duplicate input,
 *   malformed enum/hex value, or conflicting output flags (exit code 64).
 */
export function parseArgs(argv: string[]): ParsedArgs;
```

**Error handling (parseArgs):** every failure is a `DiagramUsageError` (`00` §5,
code `USAGE_ERROR`, exit `64`). The `message` names the offending flag; `detail`
carries the bad value. `--version` is recognized even when no input is supplied, so
`parseArgs(["--version"])` returns `{ version: true, … }` without an input-source
error. No filesystem or render work happens inside `parseArgs`.

### 2.2 Type/spec selection (dimension 3)

After the spec is parsed (`02`), the effective diagram type is
`args.type ?? spec.diagramType`. All six `DiagramType` members (`00` §2.1) are thus
invocable non-interactively. An invalid `--type` is already rejected by `parseArgs`;
a `--type` that disagrees with the spec's populated fields (e.g. `--type sequence`
against a spec carrying `nodes`) surfaces as a `DiagramInputError` from the §2.5
cross-field validation in `02-schema-and-validation.md` — not silently coerced.

### 2.3 Output-path resolution & precedence (dimension 2, tech-spec §5 / tech v2 V-007)

**Precedence (highest → lowest), finalized in tech v2 V-007:**

```
--out-file
  >  (--out-dir + --out-name)
  >  (--out-dir + <slug>)
  >  stdout
```

Resolution happens *after* render, because the slug is derived from the rendered
`RenderResult.slug` (`00` §3.2) and the per-artifact theme is known. The resolver:

```typescript
import { type RenderResult, type Theme } from "./schema.js";

/**
 * The concrete on-disk destinations for one rendered theme variant, or the sentinel
 * `"stdout"` when no output target was supplied (single-artifact stream, §3.2).
 * Keys are present only for requested formats: `svg` always (when not stdout),
 * `png` only when `format` is `"png"` or `"both"`.
 */
export type ResolvedOutput =
  | { readonly svg?: string; readonly png?: string }
  | "stdout";

/**
 * Resolve absolute output paths for one rendered variant per the tech-spec §5
 * precedence (V-007). Pure: performs no I/O, no confinement (that is applied at
 * write time by {@link writeArtifact}, §3.3) — it only computes the intended paths.
 *
 * Rules:
 *  - `--out-file` set → that exact path is the SVG path. For `--format both`, the
 *    PNG path is `--out-file` with its extension swapped to `.png` (and the SVG
 *    extension normalized to `.svg`); the caller fully controls the location.
 *  - else `--out-dir` + `--out-name` → `<out-dir>/<out-name>.<ext>` per requested
 *    format (`.svg` and/or `.png`).
 *  - else `--out-dir` alone → `<out-dir>/<slug>.<theme>.<ext>` (the convenience
 *    derived name; `slug` from `result.slug`, `theme` from `result.theme`).
 *  - else → `"stdout"`.
 *
 * @param args   - The parsed invocation (§2.1).
 * @param result - The rendered variant supplying `slug` and `theme` (00 §3.2).
 * @param format - The single format being resolved (`"svg"` or `"png"`); for
 *   `--format both` the caller invokes this once per format.
 * @returns Concrete paths for the requested format, or `"stdout"`.
 * @throws {DiagramUsageError} If `format === "png"` resolves to `"stdout"`
 *   (a binary PNG must not be streamed to a text stdout; require an output target).
 */
export function resolveOutputPaths(
  args: ParsedArgs,
  result: RenderResult,
  format: "svg" | "png",
): ResolvedOutput;
```

**Slug derivation.** The slug is computed once during render and carried on
`RenderResult.slug` (`00` §3.2). It is the kebab-cased `DiagramSpec.title`:
lowercase, runs of non-alphanumeric characters collapsed to a single `-`, leading/
trailing `-` trimmed, and an empty result replaced by `"diagram"`. The derived
convenience name is `<slug>.<theme>.<ext>` (e.g. `payment-flow.dark.svg`) — chosen
so the light and dark variants of one spec sit side by side in a directory without
collision (tech-spec §3.4).

> **The slug is a non-load-bearing nicety.** It exists only for the `--out-dir`-only
> convenience case. Build consumers that need predictable, slug-independent paths
> MUST pin via `--out-file` or `--out-dir` + `--out-name` (dimension 2). Changing the
> slug algorithm is therefore *not* a contract break for consumers who pinned, but is
> still documented and version-tracked because the convenience default is part of the
> published surface.

**`--format both` with `--out-file`** writes two files: the SVG at `--out-file`
(extension normalized to `.svg`) and the PNG at the same stem with `.png`. Example:
`--out-file build/arch.svg --format both` → `build/arch.svg` + `build/arch.png`.

### 2.4 `--version` (REQ-INV-04)

```typescript
import { CONTRACT_VERSION } from "./schema.js";
```

When `args.version` is true, `main` (§3) prints `CONTRACT_VERSION` (e.g. `1.0.0`)
followed by a newline to **stdout** and returns `0` immediately — before any input
read, render, or write. This is the handle consumers query to pin against a known
release.

### 2.5 No network (REQ-SEC-02)

`cli.ts` imports no networking module and issues no requests. Reaffirmed from §1.4
because the CLI is the only consumer-facing entry: the contract guarantee "fetch
nothing, transmit nothing" holds at the invocation boundary too.

## 3. Orchestration — `async function main(argv): Promise<number>`

```typescript
/**
 * The single CLI entry point and orchestrator for **both** invocation modes
 * (conversational mode reaches this via the same bundled CLI — §4). Drives the one
 * execution path: parse → read input → parse spec → render per requested theme →
 * write artifacts at resolved paths → return 0.
 *
 * Catches every {@link DiagramError} (00 §5), prints `"<name>: <message>"` plus, if
 * present, a second `"  detail: <detail>"` line to **stderr**, and returns
 * `error.exitCode` (EXIT_CODES, 00 §6). Unknown/unexpected errors are wrapped as a
 * generic failure with exit `1`. **No partial artifact is written** on any failure
 * (artifacts are only written once their variant fully renders and validates; a
 * later-variant failure does not roll back an already-written earlier variant — but
 * a single variant is never half-written, §3.3).
 *
 * Performs no network I/O (REQ-SEC-02) and no work before `parseArgs` succeeds.
 *
 * @param argv - Process arguments without runtime/script prefixes
 *   (`process.argv.slice(2)`).
 * @returns The process exit code: `0` on success, else the offending error's
 *   `exitCode` (EXIT_CODES, 00 §6).
 */
export async function main(argv: string[]): Promise<number>;
```

The bundle's tail invokes it:

```typescript
// At the bottom of cli.ts — the only top-level execution.
const code = await main(process.argv.slice(2));
process.exit(code);
```

Step-by-step orchestration:

### 3.1 Read input (dimension 1)

```typescript
/**
 * Acquire the raw spec JSON text from the resolved input source.
 *  - `args.fromStdin` → read all of `process.stdin` to a UTF-8 string.
 *  - else → read `args.inputPath` from the filesystem (UTF-8).
 *
 * @throws {DiagramIoError} If the file is missing/unreadable, or stdin cannot be
 *   read (code IO_ERROR, exit 6). The message names the source.
 */
async function readInput(args: ParsedArgs): Promise<string>;
```

The raw text is handed to the schema parser in `02-schema-and-validation.md`
(`parseSpec(raw): DiagramSpec`), which performs JSON parse + Zod +
cross-field validation and throws `DiagramInputError` (`00` §5, exit `2`) on any
failure. `cli.ts` does not re-implement validation.

After parsing, CLI overrides are applied to the spec before render:
`type ← args.type ?? spec.diagramType`, `theme ← args.theme ?? spec.theme`,
`accent ← args.accent ?? spec.accent` (REQ-THEME-01; `00` §2.4 notes these flags
override the spec defaults).

### 3.2 Render per theme

For v1 a single invocation renders exactly **one** theme variant — the effective
`theme` from §3.1 (both light and dark are obtained by invoking twice, tech-spec
§3.4). `cli.ts` calls the orchestrator from `03-rendering-engine.md`:

```typescript
// from ./render.js (03-rendering-engine.md §5)
// render(spec, { theme, accent }): Promise<RenderResult>
```

`render` returns a `RenderResult` (`00` §3.2) carrying `svg`, `width`,
`height`, `theme`, and `slug`. It throws `DiagramRenderError` (exit `3`) on
engine/layout failure and `DiagramOutputError` (exit `4`) on a post-render assertion
failure (tier-2 / viewBox / font / a11y; `02` §3). Either way **no file is written**.

### 3.3 Write artifacts, confined (REQ-SEC-01)

With a validated `RenderResult`, `main` resolves paths (§2.3) and writes each
requested artifact. PNG bytes come from `04-theme-postprocess-png.md`
(`renderPng(svg): Promise<Uint8Array>`), which throws
`DiagramPngError` (exit `5`) on failure.

```typescript
/**
 * Write one artifact's bytes to `destPath`, confined to its caller-specified root.
 *
 * REQ-SEC-01: the destination MUST stay inside the directory the caller named —
 * `--out-dir` (its own resolved absolute path) for derived/named outputs, or the
 * parent directory of `--out-file` for explicit outputs. Any path that, after
 * normalization, escapes that root (via `..`, an absolute reroute, or a symlink
 * traversal) is refused with {@link DiagramIoError} BEFORE the write.
 *
 * The confinement check mirrors the repo's `confinePath`/`writeConfined` pattern
 * (`src/paths.ts:27` `confinePath(root, candidate)`, used by
 * `src/publish.ts:61` `writeConfined`), but is reimplemented locally so the CLI
 * bundle stays self-contained (it must not import the emitter tree, §2). Semantics:
 * `resolve(root)` then assert the resolved dest equals `root` or starts with
 * `root + path.sep`.
 *
 * Writes are atomic-per-file: the bytes for a single artifact are written in one
 * `fs.writeFile` call, so a single variant is never half-written. Parent dirs are
 * created if absent (within the confinement root only).
 *
 * @param root     - The confinement root (the caller-named dir, or `--out-file`'s parent).
 * @param destPath - The intended absolute destination computed by resolveOutputPaths.
 * @param bytes    - SVG UTF-8 string or PNG `Uint8Array`.
 * @throws {DiagramIoError} On path escape (code IO_ERROR, exit 6, detail = the
 *   escaping path) or on any filesystem write/mkdir failure.
 */
async function writeArtifact(
  root: string,
  destPath: string,
  bytes: string | Uint8Array,
): Promise<void>;
```

For `--out-file`, the confinement root is the parent directory of the resolved
`--out-file` (the caller explicitly chose that location, so its directory is the
allowed root). For `--out-dir` cases the root is the resolved `--out-dir`. This is
how "writes only to the location the caller specifies" (REQ-SEC-01) is enforced even
if a malicious `title`-derived slug or crafted `--out-name` contained `..`.

### 3.4 Stdout & exit signaling (dimension 4)

If `resolveOutputPaths` returns `"stdout"` (no output target supplied), the **SVG**
is written to `process.stdout`. PNG to stdout is refused (§2.3 throws
`DiagramUsageError`) because binary on a text stream corrupts pipelines.

On success `main` returns `0`. On any `DiagramError` it prints to stderr and returns
the mapped `exitCode`:

| Failure | Error class (`00` §5) | Code | Exit |
| --- | --- | --- | --- |
| Bad flags / missing input | `DiagramUsageError` | USAGE_ERROR | 64 |
| Bad spec (JSON/Zod/cross-field) | `DiagramInputError` | INPUT_INVALID | 2 |
| Engine/layout failure | `DiagramRenderError` | RENDER_FAILED | 3 |
| Post-render assertion failure | `DiagramOutputError` | OUTPUT_INVALID | 4 |
| PNG rasterization failure | `DiagramPngError` | PNG_FAILED | 5 |
| FS write / path escape | `DiagramIoError` | IO_ERROR | 6 |

Validation (input *and* output) completes before *any* artifact is written, so a
rejected spec or a malformed SVG produces a non-zero exit and **zero files** — the
"no partial writes" guarantee of dimension 4.

### 3.5 Example invocations

```bash
# Explicit, fully caller-controlled (the doc-site-plugin prebuild shape):
bun diagram-render arch.json --type architecture --theme dark \
    --accent '#2563eb' --format both --out-file site/static/diagrams/arch.svg
# → site/static/diagrams/arch.svg  +  site/static/diagrams/arch.png

# Convenience derived names, both variants side by side:
bun diagram-render arch.json --theme light --out-dir build/diagrams   # arch.light.svg
bun diagram-render arch.json --theme dark  --out-dir build/diagrams   # arch.dark.svg

# Stdin → stdout (single SVG), e.g. piping from a generator:
cat spec.json | bun diagram-render -

# Pin the contract version:
bun diagram-render --version    # → 1.0.0
```

## 4. Conversational invocation & SKILL.md authoring (REQ-INV-01, REQ-IN-01/03)

`skills/diagram-generator/SKILL.md` (`01-architecture-layout.md` §1) is the
agent-facing procedure for the conversational mode. It defines **no new code path** —
its job is to get the agent to produce a `DiagramSpec` JSON and invoke the *same*
bundled CLI from §2. Both modes converge on one execution path (tech-spec §1). This
section specifies what SKILL.md MUST contain; it does not author SKILL.md (that is a
separate file owned by the implementer).

### 4.1 The conversational procedure SKILL.md must specify (REQ-INV-01)

SKILL.md MUST instruct the agent to, when a user asks conversationally for a diagram:

1. **Elicit/confirm** the diagram type and the concrete elements the user described
   (components, connections, groupings, participants/messages for sequence).
2. **Translate prose → a `DiagramSpec` JSON** (REQ-IN-01) conforming to the schema —
   nodes/edges/containers (or participants/messages), assigning each node a semantic
   `role` from the closed `NodeRole` taxonomy (`00` §2.2) where the user's
   description implies one.
3. **Write the JSON to a temp file** (or pipe via `-`).
4. **Invoke the bundled CLI** at
   `skills/diagram-generator/scripts/diagram-render.mjs` (or the adapter-relative
   path) with the appropriate `--type` / `--theme` / `--accent` / `--out-*` flags
   from §2.1 — the exact same contract a build step uses.
5. **Surface CLI stderr verbatim** to the user on a non-zero exit (tech-spec §7), and
   report the written artifact path(s) on success.

There is no NL-specific renderer: "natural language" is purely the agent's prose →
`DiagramSpec` translation step in front of the shared CLI (tech-spec §3.2).

### 4.2 What SKILL.md points the agent at for the translation (REQ-IN-01)

SKILL.md MUST reference the two skill reference docs and state what each holds:

- **`references/schema-guide.md`** — the human-readable description of the
  engine-neutral `DiagramSpec`: every field, the six `diagramType` values, the
  closed `NodeRole` vocabulary, the sequence-specific `participants`/`messages`
  fields, the `diagramType`↔field-agreement rules (`00` §2.5), and worked example
  specs per type. This is the agent's authoring reference for step 2.
- **`references/diagram-craft.md`** — the craft rules an emitted diagram must honor:
  the semantic color taxonomy (role→color intent), z-order (arrows behind boxes),
  label containment, legend placement outside boundaries, and spacing
  (REQ-COV-01). This guides the agent toward specs that render to high-quality
  diagrams.

SKILL.md cross-references `02-schema-and-validation.md` only indirectly — the agent
need not know validation internals; a malformed spec simply fails loudly at the CLI
boundary (§3.4, exit `2`) and the agent corrects and re-invokes.

### 4.3 REQ-IN-03 enforcement — depict only what was described

SKILL.md MUST contain an explicit, prominent instruction that the agent **depict only
what the user described and never invent semantic content or architecture** the user
did not state — no implied databases, no assumed gateways, no "typical" components
filled in to make the diagram look complete (REQ-IN-03, OOS-04).

This is **prompt-discipline, not machine-validated**: there is no automated check in
v1 that a `DiagramSpec` faithfully reflects the user's prose (tech-spec §3.2). The
schema (`02-schema-and-validation.md`) validates *structural* well-formedness, not
*semantic* faithfulness. SKILL.md is therefore the sole enforcement point for
REQ-IN-03, and must state the constraint unambiguously, with at least one
do/don't example (e.g. "user said 'a web app talking to an API' → two nodes and one
edge; do NOT add a database, cache, or load balancer the user never mentioned").

### 4.4 Mode parity

SKILL.md MUST note that conversational (REQ-INV-01) and scriptable (REQ-INV-02)
invocation are **both P0** and **converge on the one CLI execution path** — the only
difference is who produces the `DiagramSpec` (an agent from prose vs. a build step
from a committed file). This keeps behavior identical regardless of which of the five
agent targets runs the skill (REQ-PORT-02).

## Dependencies

Implement these first; this document builds directly on them:

- **`00-core-definitions.md`** — `DiagramType`, `Theme`, `HexColor`, `RenderResult`,
  `CONTRACT_VERSION`, `EXIT_CODES`, `DEFAULT_FORMAT`, `DEFAULT_THEME`, and the error
  classes `DiagramError`, `DiagramInputError`, `DiagramRenderError`,
  `DiagramOutputError`, `DiagramPngError`, `DiagramIoError`, `DiagramUsageError`.
  Referenced, never redefined.
- **`01-architecture-layout.md`** — `cli.ts` placement as the bundle entry, the
  zero-install consumer path (§2.2), the SKILL.md / `references/` / `scripts/`
  locations, and the self-containment (no emitter-tree imports) constraint.
- **`02-schema-and-validation.md`** — `parseSpec(raw): DiagramSpec` (JSON +
  Zod + cross-field validation, the `DiagramInputError` source) and the §2.5
  type/field agreement enforced when `--type` disagrees with the spec.
- **`03-rendering-engine.md`** — `render(spec, opts): Promise<RenderResult>`,
  the slug-on-RenderResult, and `DiagramRenderError` / `DiagramOutputError`.
- **`04-theme-postprocess-png.md`** — `renderPng(svg): Promise<Uint8Array>` for
  `--format png|both`, the `DiagramPngError` source.

## Verification

An implementation matches this spec when:

**Flags & parsing (§2.1)**
- [ ] Each flag parses: `--type` (all six), `--theme` (light/dark), `--accent`
      (#rrggbb), `--format` (svg/png/both), `--out-file`, `--out-name`, `--out-dir`,
      `--version`, and the `-` stdin sentinel.
- [ ] An unknown flag, a missing positional input, `--accent red`, `--type bogus`,
      `--out-file` combined with `--out-dir`/`--out-name`, and `--out-name` without
      `--out-dir` each raise `DiagramUsageError` (exit 64) with a specific message.

**Output-path precedence (§2.3)**
- [ ] `--out-file foo.svg` → SVG at exactly `foo.svg`.
- [ ] `--out-file foo.svg --format both` → `foo.svg` + `foo.png`.
- [ ] `--out-dir d --out-name n --format both` → `d/n.svg` + `d/n.png`.
- [ ] `--out-dir d` alone → `d/<slug>.<theme>.<ext>` (slug = kebab(title)).
- [ ] No output target → SVG to stdout; `--format png` with no target → `DiagramUsageError`.
- [ ] Precedence holds when several output flags are mutually exclusive-checked
      first, then ordered `--out-file > --out-dir+--out-name > --out-dir+slug > stdout`.

**Input (§3.1)**
- [ ] Spec read from a file path renders identically to the same spec piped via `-`.
- [ ] A missing input file → `DiagramIoError` (exit 6).
- [ ] A structurally invalid spec → `DiagramInputError` (exit 2), zero files written.

**Versioning (§2.4)**
- [ ] `--version` prints `CONTRACT_VERSION` to stdout and exits 0, with no input required.

**Exit codes & no-partial-write (§3.4)**
- [ ] Bad input → exit 2 and no file on disk.
- [ ] A forced output-validation failure (e.g. an injected `<foreignObject>`) → exit
      4 and **no artifact written**.
- [ ] A PNG rasterization failure → exit 5; the SVG that already wrote for a `both`
      run is the only file present (single variant never half-written).
- [ ] Each `EXIT_CODES` value (`00` §6) is reachable and distinct.

**Path confinement (§3.3, REQ-SEC-01)**
- [ ] A `--out-name '../escape'` (or a slug derived from a `..`-laden title) is
      refused with `DiagramIoError` (exit 6) before any write.
- [ ] Confinement matches the `confinePath` semantics (`src/paths.ts:27`) — resolved
      dest must equal the root or start with `root + sep`.

**No network (§1.4, REQ-SEC-02)**
- [ ] The bundle issues no network request across all of the above (no fetch/socket
      import present; verifiable by static scan of the committed `.mjs`).

**Conversational flow (§4)**
- [ ] SKILL.md describes prose → `DiagramSpec` JSON → invoke the same bundled CLI,
      with no separate NL renderer.
- [ ] SKILL.md contains the explicit "depict only what the user described" rule
      (REQ-IN-03) with a do/don't example, and references `schema-guide.md` and
      `diagram-craft.md` with their stated contents.
