/**
 * Shared test fixtures & factories (08 §3). Materialise tiny canonical repos +
 * matching manifests for the cross-cutting determinism / drift / override suites.
 * Deliberately minimal (one of each tool type) so unit assertions stay exact —
 * the full sample tool is the golden's job (08 §6).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { z } from "zod";

import { resolveConfig, type ResolvedRoots } from "../../config.js"; // 05 §7.1: EmitterConfig -> ResolvedRoots
import { emit } from "../../emit.js"; // (manifest, roots) => EmitResult (04/05)
import { Manifest } from "../../model.js";
import { applyOverrides, loadOverrides, type OverlayResult } from "../../overrides.js"; // 05 §3
import { publish } from "../../publish.js"; // 05 §4 — atomic swap into adaptersDir

/** Resolved absolute roots for a temp fixture repo. */
export interface FixtureRepo {
  /** Filesystem path to the temp repo root (for disk-reading helpers only). */
  root: string;
  /** Resolved absolute roots (05 §7.1) — the `roots` arg to emit/driftCheck. */
  roots: ResolvedRoots;
  manifestPath: string;
  manifest: z.infer<typeof Manifest>;
}

/** A minimal canonical skill: SKILL.md with name/description + body. */
export function skillDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} skill for tests.`,
    "argument-hint: <topic>",
    "---",
    `# ${name}`,
    "",
    "Body text.",
    "",
  ].join("\n");
}

/** A minimal canonical agent with claude-only structural keys. */
export function agentDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} agent.`,
    "tools: [Read, Write]",
    "model: opus",
    "---",
    `# ${name}`,
    "",
    "System prompt.",
    "",
  ].join("\n");
}

/** A minimal canonical slash command with argument-hint. */
export function commandDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} command.`,
    "argument-hint: <arg>",
    "---",
    `Run ${name}.`,
    "",
  ].join("\n");
}

/**
 * Materialise a temp canonical repo with the given tool docs + a valid manifest.
 * Returns resolved absolute roots; caller must `cleanupFixtureRepo`.
 */
export function makeFixtureRepo(opts: {
  skills?: string[];
  agents?: string[];
  commands?: string[];
  /** Override files keyed by adapters-relative target path (e.g. cursor/rules/sample.mdc). */
  overrides?: Record<string, string>;
}): FixtureRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-fix-"));
  const tools: z.infer<typeof Manifest>["tools"] = [];

  for (const name of opts.skills ?? []) {
    const dir = path.join(root, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillDoc(name));
    tools.push({ name, type: "skill", source: `skills/${name}` });
  }
  for (const name of opts.agents ?? []) {
    fs.mkdirSync(path.join(root, "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, "agents", `${name}.md`), agentDoc(name));
    tools.push({ name, type: "agent", source: `agents/${name}.md` });
  }
  for (const name of opts.commands ?? []) {
    fs.mkdirSync(path.join(root, "commands"), { recursive: true });
    fs.writeFileSync(path.join(root, "commands", `${name}.md`), commandDoc(name));
    tools.push({ name, type: "command", source: `commands/${name}.md` });
  }
  for (const [rel, content] of Object.entries(opts.overrides ?? {})) {
    const abs = path.join(root, "overrides", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const manifest = Manifest.parse({ version: 1, config: {}, tools });
  const manifestPath = path.join(root, "tools.manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // ResolvedRoots is what emit/driftCheck consume (05 §7.1); config.ts resolves
  // each EmitterConfig path against repoRoot. repo.root stays the raw string path
  // for the disk-reading helpers (anyAdapterFile etc.).
  const roots = resolveConfig(manifest.config, root);
  return { root, roots, manifestPath, manifest };
}

/** Remove a fixture repo created by makeFixtureRepo. */
export function cleanupFixtureRepo(repo: FixtureRepo): void {
  fs.rmSync(repo.root, { recursive: true, force: true });
}

/**
 * Run the real build pipeline and publish the overlaid set to `roots.adaptersDir`.
 * Mirrors `emit.ts`'s orchestration (05 §1): emit -> loadOverrides ->
 * applyOverrides -> publish. Returns the {@link OverlayResult} (05 §3.2) so callers
 * can read `overridden` / `staleOverrides` directly instead of inspecting `emit`.
 */
export function buildAndPublish(
  manifest: z.infer<typeof Manifest>,
  roots: ResolvedRoots,
): OverlayResult {
  const result = emit(manifest, roots);
  const overrides = loadOverrides(roots, manifest.config.targets);
  const overlay = applyOverrides(result.files, overrides);
  publish(overlay.files, result.verbatim, roots);
  return overlay;
}
