import { dropAllClaudeKeys, hintValue, orderFrontmatter, renderFrontmatter } from "./_shared.js";
import type { TargetTransform } from "./_shared.js";
import type { DropRecord } from "../model.js";

/**
 * Copilot target (04 §10). Skills map to GitHub Copilot **Instructions** at
 * `instructions/<n>.instructions.md` (`{description, applyTo: "**"}`); agents emit
 * `agents/<n>.agent.md` (current form; the legacy `.chatmode.md` is a §12
 * carry-forward we deliberately do NOT emit) with `{name, description}` plus a
 * representable `tools`/`model`; commands map cleanly to `prompts/<n>.prompt.md`
 * (`{name, description, argument-hint?}`, HIGH confidence). No aggregate manifest.
 *
 * Provenance is Form A (the PROVENANCE.yamlComment as the first in-block line) on
 * all three forms. Unsupported constructs are recorded as DropRecords (REQ-EMIT-03).
 */
export const copilotTransform: TargetTransform = {
  target: "copilot",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["description", skill.description],
        ["applyTo", "**"], // repo-wide default (deterministic, REQ-EMIT-06)
      ]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (hintValue(skill) !== undefined) {
      drops.push({
        target: "copilot",
        source: skill.sourcePath,
        construct: "skill.argument-hint",
        kind: "fallback",
        reason: "Copilot instructions carry no invocation hint",
      });
    }
    if (skill.metadata.size > 0) {
      drops.push({
        target: "copilot",
        source: skill.sourcePath,
        construct: "skill.metadata",
        kind: "fallback",
        reason: "Copilot instructions carry only {description, applyTo}",
      });
    }
    return {
      files: [
        { relpath: `instructions/${skill.name}.instructions.md`, content, mode: 0o644 },
      ],
      drops,
      manifestEntries: [],
    };
  },

  transformAgent(agent) {
    // Copilot .agent.md DOES support a tools array → keep `tools`/`model` if present, drop the rest.
    const KEEP: ReadonlySet<string> = new Set(["tools", "model"]); // §12: confirm tools/model shape
    const fields = new Map<string, unknown>([
      ["name", agent.name],
      ["description", agent.description],
    ]);
    for (const k of KEEP) if (agent.claudeKeys.has(k)) fields.set(k, agent.claudeKeys.get(k));
    const content = renderFrontmatter(orderFrontmatter(fields), agent.body, agent.sourcePath);
    const drops = dropAllClaudeKeys(
      agent,
      "copilot",
      "not representable in Copilot .agent.md frontmatter",
      KEEP,
    );
    return {
      files: [{ relpath: `agents/${agent.name}.agent.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformCommand(command) {
    const fields = new Map<string, unknown>([
      ["name", command.name],
      ["description", command.description],
    ]);
    if (command.argumentHint !== undefined) fields.set("argument-hint", command.argumentHint);
    const content = renderFrontmatter(orderFrontmatter(fields), command.body, command.sourcePath);
    return {
      files: [{ relpath: `prompts/${command.name}.prompt.md`, content, mode: 0o644 }],
      drops: [], // argument-hint maps cleanly (HIGH)
      manifestEntries: [],
    };
  },

  aggregateManifest: () => null,
};
