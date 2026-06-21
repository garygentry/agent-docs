import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveConfig } from "./config.js";
import type { ResolvedRoots } from "./config.js";
import { assertNoDrift } from "./driftguard.js";
import { emit } from "./emit.js";
import type { EmitIdentity } from "./emit.js";
import { loadManifest } from "./manifest.js";
import type { EmittedFile, Manifest, VerbatimRecord } from "./model.js";
import { applyOverrides, loadOverrides } from "./overrides.js";
import { emitPlugin } from "./plugin.js";
import type { PluginMeta } from "./plugin.js";
import { publish, writeConfined } from "./publish.js";
import { buildReportModel, renderReport } from "./report.js";

/**
 * CLI entry point (01 §5 / REQ-EMIT-01). This is the ONLY module that reads
 * `process.argv` and sets process exit codes — every library function it calls is
 * pure(ish) and throws the `00 §4` errors instead of exiting. Two commands:
 *
 *   - `build`        — run the full pipeline and write `adapters/` + the coverage
 *                      report + `.claude-plugin/` manifests to disk.
 *   - `build --check`— re-emit in memory and diff against the committed tree,
 *                      exiting nonzero (with a remediation message) on drift.
 *
 * `bun run build` is the canonical local build (REQ-EMIT-01, SC-01): from a
 * manifest + canonical sources it produces `adapters/` with zero manual steps.
 */

/** Adapters-relative path of the coverage report (06 §3 / 01 §2). */
const REPORT_RELPATH = "GENERATION-REPORT.md";

/** Fixed default plugin description (ASCII-only; 07 §3.4) when none is configured. */
const DEFAULT_PLUGIN_DESCRIPTION =
  "Agent-agnostic tool adapters generated from canonical Claude-native sources.";

/**
 * Assemble {@link PluginMeta} from `package.json` plus the 07 §3.2 fallbacks. The
 * `Manifest.config.plugin` block is a forward extension that does not yet exist in
 * the schema, so every metadata field falls back to package.json + fixed defaults
 * (07 §3.2 NOTE). Identity (`name`/`version`) has a single source of truth —
 * package.json — feeding both the gemini aggregate and the plugin manifests.
 */
export function assemblePluginMeta(repoRoot: string): PluginMeta {
  const pkgPath = resolve(repoRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    name?: string;
    version?: string;
    description?: string;
    author?: string | { name?: string };
    keywords?: string[];
  };

  const name = pkg.name ?? "";
  const version = pkg.version ?? "";
  const authorName = typeof pkg.author === "string" ? pkg.author : (pkg.author?.name ?? "");

  return {
    name,
    version,
    description: pkg.description ?? DEFAULT_PLUGIN_DESCRIPTION,
    // author is required by emitPlugin (07 §3.6); fall back to the package name
    // so a package.json without an author still yields a valid plugin owner.
    author: authorName || name,
    keywords: pkg.keywords ?? [],
  };
}

/** Everything the two commands derive from a repo root, computed once. */
interface BuildContext {
  manifest: Manifest;
  roots: ResolvedRoots;
  identity: EmitIdentity;
  /** Overlaid adapter file set (emit output post-override), with report appended. */
  publishFiles: EmittedFile[];
  /** Skill-owned + shared verbatim copies to publish byte-for-byte. */
  verbatim: VerbatimRecord[];
  /** `.claude-plugin/{plugin,marketplace}.json` (repo-relative). */
  pluginFiles: EmittedFile[];
  /** The coverage report as an adapters-relative EmittedFile. */
  reportFile: EmittedFile;
}

/**
 * Run the in-memory pipeline (no disk writes): load + validate the manifest,
 * resolve roots, emit, overlay overrides, render the coverage report, and build
 * the plugin manifests. Both `build` and `build --check` share this so the bytes
 * they write and the bytes they diff against come from one code path.
 */
function prepare(repoRoot: string): BuildContext {
  const manifest = loadManifest(resolve(repoRoot, "tools.manifest.json"), repoRoot);
  const roots = resolveConfig(manifest.config, repoRoot);
  const meta = assemblePluginMeta(repoRoot);
  const identity: EmitIdentity = { name: meta.name, version: meta.version };

  const result = emit(manifest, roots, identity);
  const overrides = loadOverrides(roots, manifest.config.targets);
  const overlay = applyOverrides(result.files, overrides);

  const model = buildReportModel(
    { ...result, files: overlay.files, overridden: overlay.overridden },
    manifest,
    overlay.staleOverrides,
  );
  const reportFile: EmittedFile = {
    relpath: REPORT_RELPATH,
    content: renderReport(model),
    mode: 0o644,
  };

  const pluginFiles = emitPlugin(meta);

  return {
    manifest,
    roots,
    identity,
    publishFiles: [...overlay.files, reportFile],
    verbatim: result.verbatim,
    pluginFiles,
    reportFile,
  };
}

/**
 * `build`: run the full pipeline and write to disk. Publishes the overlaid adapter
 * tree + the coverage report atomically into `adapters/`, then writes the plugin
 * manifests into `.claude-plugin/`. Idempotent and byte-stable (REQ-EMIT-05/06).
 */
export function build(repoRoot: string): void {
  const ctx = prepare(repoRoot);

  // Atomic publish of the whole adapters/ subtree (report is part of publishFiles).
  publish(ctx.publishFiles, ctx.verbatim, ctx.roots);

  // Plugin manifests live under repoRoot/.claude-plugin/, not adapters/, so they
  // are written through the confined writer rooted at repoRoot (REQ-SEC-01).
  for (const pf of ctx.pluginFiles) {
    writeConfined(ctx.roots.repoRoot, pf.relpath, pf.content, pf.mode);
  }
}

/**
 * `build --check`: re-emit in memory and diff against the committed tree. Throws
 * {@link DriftError} (with the remediation message) when the committed adapters/,
 * report, or `.claude-plugin/` manifests do not match a fresh build (REQ-VALID-02).
 * The report + plugin manifests are threaded in as expected committed files since
 * the drift guard re-emits the adapter set but does not itself render them.
 */
export function check(repoRoot: string): void {
  const ctx = prepare(repoRoot);
  assertNoDrift(ctx.manifest, ctx.roots, [ctx.reportFile, ...ctx.pluginFiles], ctx.identity);
}

/**
 * Parse argv and dispatch. The ONLY place exit codes are set: success exits 0,
 * any thrown error (validation, drift, …) prints to stderr and exits 1.
 */
function main(argv: string[]): void {
  const repoRoot = resolve(import.meta.dirname, "..");
  const [command, ...rest] = argv;

  try {
    if (command === "build") {
      if (rest.includes("--check")) {
        check(repoRoot);
      } else {
        build(repoRoot);
      }
    } else {
      process.stderr.write(`Unknown command: ${command ?? "<none>"}\nUsage: build [--check]\n`);
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
