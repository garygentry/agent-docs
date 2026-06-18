import { stringify as stringifyToml } from "smol-toml";
import { dropAllClaudeKeys, orderFrontmatter, renderFrontmatter } from "./_shared.js";
import type { TargetTransform } from "./_shared.js";
import { PROVENANCE, REGEN_CMD } from "../model.js";
import type { DropRecord } from "../model.js";

/**
 * Gemini target (04 §9). Per 2026 research: skills emit `skills/<n>/<n>.md`
 * ({name, description}) AND register in `gemini-extension.json`; agents emit
 * `agents/<n>.md` ({name, description}); commands emit `commands/<n>.toml` (TOML,
 * required `prompt`, optional `description`). The aggregate is
 * `gemini-extension.json` (Form C), whose `name`/`version` are threaded from the
 * resolved `PluginMeta` identity (07 §3.2) — NEVER hardcoded.
 *
 * Carry-forward notes (04 §12): Gemini `:` subdir command namespacing is OUT of
 * scope for v1 (commands are emitted flat); `GEMINI.md` has no frontmatter and is
 * not emitted here.
 */

/**
 * Render a Gemini command TOML file (04 §9.2). A leading `# GENERATED …` TOML
 * comment provides provenance (Form A, TOML flavor), then `description` and a
 * triple-quoted `prompt` literal in a FIXED order for byte-stability (REQ-EMIT-06).
 * The triple-quoted literal preserves multiline prompt content without escaping;
 * a prompt containing the `'''` delimiter falls back to a `smol-toml`-serialized
 * basic string (escaped) to stay correct and deterministic.
 *
 * @param description - The command description.
 * @param prompt - The command prompt (canonical body, possibly with appended args).
 * @param sourcePath - Canonical source path, embedded in the provenance comment.
 * @returns The complete TOML document string.
 */
export function renderGeminiCommandToml(
  description: string,
  prompt: string,
  sourcePath: string,
): string {
  const header = stringifyToml({ description });
  const promptToml = !prompt.includes("'''")
    ? `prompt = '''\n${prompt}'''\n`
    : stringifyToml({ prompt }) + "\n";
  return PROVENANCE.yamlComment(sourcePath) + "\n" + header + "\n" + promptToml;
}

export const geminiTransform: TargetTransform = {
  target: "gemini",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["name", skill.name],
        ["description", skill.description],
      ]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (skill.metadata.size > 0) {
      drops.push({
        target: "gemini",
        source: skill.sourcePath,
        construct: "skill.metadata",
        kind: "fallback",
        reason: "Gemini skill carries only {name, description}; metadata dropped",
      });
    }
    return {
      files: [{ relpath: `skills/${skill.name}/${skill.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [{ name: skill.name, description: skill.description }],
    };
  },

  transformAgent(agent) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["name", agent.name],
        ["description", agent.description],
      ]),
    );
    const content = renderFrontmatter(fields, agent.body, agent.sourcePath);
    const drops = dropAllClaudeKeys(
      agent,
      "gemini",
      "Gemini agent frontmatter carries only {name, description}; structural keys dropped",
    );
    return {
      files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformCommand(command) {
    // Map body → prompt, description → description. argument-hint has no native
    // field: appended into the prompt as a prose note, AND drop-recorded
    // (REQ-EMIT-03/03a). ':' subdir namespacing is OUT of scope (v1, 04 §9.2) —
    // commands are emitted flat at `commands/<name>.toml`.
    const prompt =
      command.argumentHint !== undefined
        ? `${command.body}\n\nArguments: ${command.argumentHint}`
        : command.body;
    const content = renderGeminiCommandToml(command.description, prompt, command.sourcePath);
    const drops: DropRecord[] = [];
    if (command.argumentHint !== undefined) {
      drops.push({
        target: "gemini",
        source: command.sourcePath,
        construct: "command.argument-hint",
        kind: "fallback",
        reason: "Gemini commands have no argument-hint field; flattened into prompt prose",
      });
    }
    return {
      files: [{ relpath: `commands/${command.name}.toml`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  // identity = { name, version } threaded from the resolved PluginMeta (07 §3.2,
  // the single source of project identity). The engine in 05 passes it through;
  // gemini consumes it for the extension name/version — NEVER hardcoded.
  aggregateManifest(entries, identity) {
    if (entries.length === 0) return null;
    // Form C: _generated FIRST key in strict JSON. entries pre-sorted by name (05).
    const doc = {
      _generated: { source: "skills/*", regenerate: REGEN_CMD },
      name: identity.name,
      version: identity.version,
      skills: entries.map((e) => ({ name: e.name, description: e.description })),
    };
    const content = JSON.stringify(doc, null, 2) + "\n"; // strict JSON, 2-space, trailing \n
    return { relpath: "gemini-extension.json", content, mode: 0o644 };
  },
};
