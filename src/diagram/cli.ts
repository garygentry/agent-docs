/**
 * `cli.ts` — the diagram-generator scriptable contract and bundle entry point
 * (05-cli-and-invocation.md §2–3). This is the ONLY consumer-facing surface and
 * the file `bun build --target=node` bundles into `diagram-render.mjs`.
 *
 * It drives the single execution path shared by both invocation modes
 * (conversational and scriptable): parse argv → read input → parse + validate
 * spec → render one theme variant → write artifacts at resolved, confined paths
 * → return an exit code. Every {@link DiagramError} maps to its `exitCode`
 * (00 §6); the message is printed to stderr; success returns `0`.
 *
 * Imports are intentionally limited to sibling `src/diagram/*` modules and named
 * npm packages — never the repo emitter tree (so the bundle stays
 * self-contained); the path-confinement helper is reimplemented locally (§3.3).
 * No networking module is imported and no request is issued (REQ-SEC-02).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import {
  Background,
  type Background as BackgroundT,
  CONTRACT_VERSION,
  DEFAULT_FORMAT,
  DiagramType,
  Direction,
  type Direction as DirectionT,
  HexColor,
  type DiagramType as DiagramTypeT,
  type HexColor as HexColorT,
  type RenderResult,
  Theme,
  type Theme as ThemeT,
} from "./schema.js";
import { DiagramInputError, DiagramIoError, DiagramUsageError, DiagramError } from "./errors.js";
import { parseSpec } from "./validate.js"; // 02 §2
import { render } from "./render.js"; // 03 §5
import { renderPng } from "./png.js"; // 04 §4

// ===========================================================================
// 2.1 Argument model & parsing
// ===========================================================================

/** Artifact format selector for `--format` (tech-spec §5). */
export type OutputFormat = "svg" | "png" | "both";

/**
 * The fully parsed, validated CLI invocation — the structured result of
 * {@link parseArgs}. Enum flags are narrowed to their union type, `--accent` is
 * HexColor-validated, and the input source is resolved to exactly one of
 * `inputPath` / `fromStdin`. Output fields are left as-supplied and resolved to
 * concrete paths by {@link resolveOutputPaths} (§2.3) once a `RenderResult`
 * (00 §3.2) is available (the slug is render-derived).
 */
export interface ParsedArgs {
  /** Path to the spec JSON, or `undefined` when reading stdin. */
  readonly inputPath?: string;
  /** True when the positional argument was `-` (read spec JSON from stdin, §3.1). */
  readonly fromStdin: boolean;
  /** `--type` override; when set, replaces `DiagramSpec.diagramType` (00 §2.1). */
  readonly type?: DiagramTypeT;
  /** `--theme` override; when set, replaces `DiagramSpec.theme` (REQ-THEME-01). */
  readonly theme?: ThemeT;
  /** `--accent` override; HexColor-validated at parse (00 §2.1). */
  readonly accent?: HexColorT;
  /** `--background` override; `transparent`/`opaque`/`#rrggbb`, validated at parse (#10). */
  readonly background?: BackgroundT;
  /** `--direction` override; `LR`/`TB`/`RL`/`BT`, validated at parse (#14). */
  readonly direction?: DirectionT;
  /** `--padding` override in px; non-negative integer, validated at parse (#15). */
  readonly padding?: number;
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

/** The recognized value-taking flags (each consumes the following argv token). */
const VALUE_FLAGS = new Set([
  "--type",
  "--theme",
  "--accent",
  "--background",
  "--direction",
  "--padding",
  "--format",
  "--out-file",
  "--out-name",
  "--out-dir",
]);

const FORMATS: ReadonlySet<string> = new Set(["svg", "png", "both"]);

/**
 * Width:height (or height:width) ratio above which the CLI warns that a graph
 * diagram may render illegibly when embedded (#14/#16). A non-fatal hint only.
 */
const ASPECT_RATIO_WARN_THRESHOLD = 6 as const;

/**
 * Parse and validate `argv` (process arguments **without** `node`/script
 * prefixes) into a normalized {@link ParsedArgs}.
 *
 * Validation (fail-fast, before any input read or render): exactly one input
 * source (a positional path XOR `-`) unless `--version`; `--type`/`--theme`/
 * `--format` are members of their enums; `--accent` matches HexColor;
 * `--out-file` is not combined with `--out-name`/`--out-dir`; `--out-name`
 * without `--out-dir` is rejected.
 *
 * @param argv - Raw CLI arguments, e.g. `process.argv.slice(2)`.
 * @returns The normalized, validated invocation.
 * @throws {DiagramUsageError} On any unknown flag, missing/duplicate input,
 *   malformed enum/hex value, or conflicting output flags (exit 64).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let inputPath: string | undefined;
  let fromStdin = false;
  let inputSeen = false;
  let type: DiagramTypeT | undefined;
  let theme: ThemeT | undefined;
  let accent: HexColorT | undefined;
  let background: BackgroundT | undefined;
  let direction: DirectionT | undefined;
  let padding: number | undefined;
  let format: OutputFormat = DEFAULT_FORMAT;
  let outFile: string | undefined;
  let outName: string | undefined;
  let outDir: string | undefined;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    if (arg === "--version") {
      version = true;
      continue;
    }

    if (arg === "-") {
      if (inputSeen) {
        throw new DiagramUsageError("more than one input source supplied", arg);
      }
      fromStdin = true;
      inputSeen = true;
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new DiagramUsageError(`${arg} requires a value`, arg);
      }
      i++;
      switch (arg) {
        case "--type": {
          const r = DiagramType.safeParse(value);
          if (!r.success) {
            throw new DiagramUsageError("--type is not a valid diagram type", value);
          }
          type = r.data;
          break;
        }
        case "--theme": {
          const r = Theme.safeParse(value);
          if (!r.success) {
            throw new DiagramUsageError("--theme must be light or dark", value);
          }
          theme = r.data;
          break;
        }
        case "--accent": {
          const r = HexColor.safeParse(value);
          if (!r.success) {
            throw new DiagramUsageError("--accent must be a #rrggbb hex color", value);
          }
          accent = r.data;
          break;
        }
        case "--background": {
          const r = Background.safeParse(value);
          if (!r.success) {
            throw new DiagramUsageError(
              "--background must be transparent, opaque, or a #rrggbb hex color",
              value,
            );
          }
          background = r.data;
          break;
        }
        case "--direction": {
          const r = Direction.safeParse(value);
          if (!r.success) {
            throw new DiagramUsageError("--direction must be LR, TB, RL, or BT", value);
          }
          direction = r.data;
          break;
        }
        case "--padding": {
          if (!/^\d+$/.test(value)) {
            throw new DiagramUsageError("--padding must be a non-negative integer", value);
          }
          padding = Number(value);
          break;
        }
        case "--format": {
          if (!FORMATS.has(value)) {
            throw new DiagramUsageError("--format must be svg, png, or both", value);
          }
          format = value as OutputFormat;
          break;
        }
        case "--out-file":
          outFile = value;
          break;
        case "--out-name":
          outName = value;
          break;
        case "--out-dir":
          outDir = value;
          break;
      }
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      throw new DiagramUsageError(`unknown flag ${arg}`, arg);
    }

    // Positional input path.
    if (inputSeen) {
      throw new DiagramUsageError("more than one input source supplied", arg);
    }
    inputPath = arg;
    inputSeen = true;
  }

  // --version short-circuits all other requirements (§2.3 / §2.4).
  if (!version) {
    if (!inputSeen) {
      throw new DiagramUsageError("no input supplied (give a spec file path or '-' for stdin)");
    }
    if (outFile !== undefined && (outName !== undefined || outDir !== undefined)) {
      throw new DiagramUsageError("--out-file cannot be combined with --out-dir or --out-name");
    }
    if (outName !== undefined && outDir === undefined) {
      throw new DiagramUsageError("--out-name requires --out-dir");
    }
  }

  return {
    inputPath,
    fromStdin,
    type,
    theme,
    accent,
    background,
    direction,
    padding,
    format,
    outFile,
    outName,
    outDir,
    version,
  };
}

// ===========================================================================
// 2.3 Output-path resolution & precedence
// ===========================================================================

/**
 * The concrete on-disk destinations for one rendered theme variant, or the
 * sentinel `"stdout"` when no output target was supplied (single-artifact
 * stream, §3.2). Keys are present only for the requested format.
 */
export type ResolvedOutput = { readonly svg?: string; readonly png?: string } | "stdout";

/** Swap (or append) a path's extension to `ext` (e.g. `.svg`). */
function withExtension(path: string, ext: string): string {
  const current = extname(path);
  return current ? path.slice(0, -current.length) + ext : path + ext;
}

/**
 * Resolve absolute output paths for one rendered variant per the §2.3
 * precedence (`--out-file > --out-dir+--out-name > --out-dir+slug > stdout`).
 * Pure: performs no I/O and no confinement (applied at write time, §3.3).
 *
 * @param args   - The parsed invocation (§2.1).
 * @param result - The rendered variant supplying `slug` and `theme` (00 §3.2).
 * @param format - The single format being resolved (`"svg"` or `"png"`).
 * @returns Concrete paths for the requested format, or `"stdout"`.
 * @throws {DiagramUsageError} If `format === "png"` resolves to `"stdout"`
 *   (a binary PNG must not be streamed to a text stdout).
 */
export function resolveOutputPaths(
  args: ParsedArgs,
  result: RenderResult,
  format: "svg" | "png",
): ResolvedOutput {
  const ext = format === "svg" ? ".svg" : ".png";

  if (args.outFile !== undefined) {
    const path = withExtension(args.outFile, ext);
    return format === "svg" ? { svg: path } : { png: path };
  }

  if (args.outDir !== undefined) {
    const base = args.outName !== undefined ? args.outName : `${result.slug}.${result.theme}`;
    const path = `${args.outDir}${sep}${base}${ext}`;
    return format === "svg" ? { svg: path } : { png: path };
  }

  // No output target → stdout (single artifact). A binary PNG must never be
  // streamed to a text stdout (§2.3 / §3.4).
  if (format === "png") {
    throw new DiagramUsageError(
      "--format png requires an output target (--out-file or --out-dir); refusing to stream binary PNG to stdout",
    );
  }
  return "stdout";
}

// ===========================================================================
// 3.1 Read input
// ===========================================================================

/**
 * Acquire the raw spec JSON text from the resolved input source.
 *  - `args.fromStdin` → read all of `process.stdin` to a UTF-8 string.
 *  - else → read `args.inputPath` from the filesystem (UTF-8).
 *
 * @throws {DiagramIoError} If the file is missing/unreadable, or stdin cannot be
 *   read (code IO_ERROR, exit 6). The message names the source.
 */
async function readInput(args: ParsedArgs): Promise<string> {
  if (args.fromStdin) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (cause) {
      throw new DiagramIoError("failed to read spec from stdin", messageOf(cause));
    }
  }
  try {
    return await readFile(args.inputPath as string, "utf8");
  } catch (cause) {
    throw new DiagramIoError(`failed to read spec file: ${args.inputPath}`, messageOf(cause));
  }
}

// ===========================================================================
// 3.3 Write artifacts, confined (REQ-SEC-01)
// ===========================================================================

/**
 * Write one artifact's bytes to `destPath`, confined to `root`.
 *
 * REQ-SEC-01: the resolved destination MUST equal `root` or start with
 * `root + sep`; any path that escapes (via `..`, an absolute reroute, or a
 * crafted name) is refused with {@link DiagramIoError} BEFORE the write. Mirrors
 * the repo's `confinePath`/`writeConfined` semantics (`src/paths.ts`) but is
 * reimplemented locally so the bundle stays self-contained (§3.3). The bytes are
 * written in a single `writeFile` call, so a single variant is never
 * half-written; missing parent dirs (within the root) are created first.
 *
 * @param root     - The confinement root (the caller-named dir, or `--out-file`'s parent).
 * @param destPath - The intended destination computed by {@link resolveOutputPaths}.
 * @param bytes    - SVG UTF-8 string or PNG `Uint8Array`.
 * @throws {DiagramIoError} On path escape or any filesystem write/mkdir failure.
 */
async function writeArtifact(
  root: string,
  destPath: string,
  bytes: string | Uint8Array,
): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedDest = resolve(destPath);
  if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(resolvedRoot + sep)) {
    throw new DiagramIoError("refusing to write outside the resolved output location", destPath);
  }

  try {
    await mkdir(dirname(resolvedDest), { recursive: true });
    await writeFile(resolvedDest, bytes);
  } catch (cause) {
    throw new DiagramIoError(`failed to write artifact: ${destPath}`, messageOf(cause));
  }
}

// ===========================================================================
// 3. Orchestration — main
// ===========================================================================

/**
 * The single CLI entry point and orchestrator (05 §3). Drives parse → read →
 * parse spec → render → write, returning the process exit code. Catches every
 * {@link DiagramError}, prints `"<name>: <message>"` (and a `detail` line when
 * present) to stderr, and returns `error.exitCode`. Unknown errors are wrapped
 * as a generic failure with exit `1`. No network I/O (REQ-SEC-02); no work
 * before `parseArgs` succeeds; no partial single-variant write on failure.
 *
 * @param argv - Process arguments without runtime/script prefixes.
 * @returns `0` on success, else the offending error's `exitCode` (00 §6).
 */
export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);

    // §2.4 — --version short-circuits before any input read, render, or write.
    if (args.version) {
      process.stdout.write(`${CONTRACT_VERSION}\n`);
      return 0;
    }

    // §3.1 — read raw spec text, JSON-parse, validate.
    const rawText = await readInput(args);
    let rawObj: unknown;
    try {
      rawObj = JSON.parse(rawText);
    } catch (cause) {
      throw new DiagramInputError("spec is not valid JSON", messageOf(cause));
    }

    // §2.2 — --type overrides spec.diagramType BEFORE cross-field validation so a
    // --type that disagrees with the populated fields fails as DiagramInputError.
    if (args.type !== undefined && isObject(rawObj)) {
      rawObj = { ...rawObj, diagramType: args.type };
    }

    // --direction overrides spec.direction BEFORE validation so emitDot (#14)
    // picks it up; an invalid combination still fails as DiagramInputError.
    if (args.direction !== undefined && isObject(rawObj)) {
      rawObj = { ...rawObj, direction: args.direction };
    }

    const spec = parseSpec(rawObj);

    // §3.1 — apply theme/accent overrides (REQ-THEME-01).
    const theme: ThemeT = args.theme ?? spec.theme;
    const accent = args.accent ?? spec.accent;

    // §3.2 — render exactly one theme variant. Background (#10) and padding (#15)
    // overrides fall back to the spec / postprocess defaults inside render.
    const result = await render(spec, {
      theme,
      accent,
      background: args.background,
      padding: args.padding,
    });

    // #14/#16 — warn (non-fatal) on extreme aspect ratios that read poorly when
    // embedded; suggest a layout-direction override. Sequence diagrams are exempt
    // (their tall shape is intrinsic).
    if (spec.diagramType !== "sequence" && result.width > 0 && result.height > 0) {
      const ratio = Math.max(result.width / result.height, result.height / result.width);
      if (ratio > ASPECT_RATIO_WARN_THRESHOLD) {
        const hint = args.direction === undefined ? " (try --direction TB or LR)" : "";
        process.stderr.write(
          `warning: diagram aspect ratio is ${ratio.toFixed(1)}:1 (${result.width}×${result.height}); ` +
            `it may read poorly when embedded${hint}\n`,
        );
      }
    }

    // §3.3/§3.4 — resolve ALL requested format targets first (so a png→stdout
    // usage error is raised before any byte is written), then write in order.
    const formats: Array<"svg" | "png"> =
      args.format === "both" ? ["svg", "png"] : [args.format as "svg" | "png"];
    const targets = formats.map((f) => ({
      format: f,
      out: resolveOutputPaths(args, result, f),
    }));

    for (const { format, out } of targets) {
      if (out === "stdout") {
        // Only the SVG ever reaches stdout (png→stdout already threw above).
        process.stdout.write(result.svg);
        continue;
      }
      const bytes: string | Uint8Array =
        format === "svg" ? result.svg : await renderPng(result.svg);
      const destPath = (format === "svg" ? out.svg : out.png) as string;
      const root =
        args.outFile !== undefined
          ? dirname(resolve(args.outFile))
          : resolve(args.outDir as string);
      await writeArtifact(root, destPath, bytes);
    }

    return 0;
  } catch (err) {
    if (err instanceof DiagramError) {
      process.stderr.write(`${err.name}: ${err.message}\n`);
      if (err.detail !== undefined) {
        process.stderr.write(`  detail: ${err.detail}\n`);
      }
      return err.exitCode;
    }
    process.stderr.write(`error: ${messageOf(err)}\n`);
    return 1;
  }
}

/** True for a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract a string detail from an unknown thrown value. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// The only top-level execution — runs when invoked as the bundle entry, but not
// when imported by the test suite.
if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
