import { dropAllClaudeKeys, hintValue, orderFrontmatter, renderFrontmatter } from "./_shared.js";
import type { TargetTransform } from "./_shared.js";

/**
 * Claude target (04 §6) — the canonical, privileged form (CON-03). It reconstructs
 * the Claude-native shape and NEVER drops any construct (REQ-EMIT-07). Note that
 * `dropAllClaudeKeys` is imported only so the module's symmetry with the other
 * targets is explicit; claude calls it with a keep-set covering every key (so it
 * is effectively a no-op) — see `transformAgent`.
 *
 * `adapters/claude/` doubles as the installable plugin bundle
 * (07-packaging-and-sample-tool.md). Provenance is Form A on all three forms.
 */
export const claudeTransform: TargetTransform = {
  target: "claude",

  transformSkill(skill) {
    const fields = new Map<string, unknown>();
    fields.set("name", skill.name);
    fields.set("description", skill.description);
    const hint = hintValue(skill);
    if (hint !== undefined) fields.set("argument-hint", hint); // top-level reconstruction
    // Retain the full nested metadata mapping (allowed-tools etc.) under "metadata".
    const meta = skill.metadata.get("metadata");
    if (meta !== undefined) fields.set("metadata", meta);
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, skill.body, skill.sourcePath);
    return {
      files: [{ relpath: `skills/${skill.name}/SKILL.md`, content, mode: 0o644 }],
      drops: [],
      manifestEntries: [],
    };
  },

  transformAgent(agent) {
    const fields = new Map<string, unknown>();
    fields.set("name", agent.name);
    fields.set("description", agent.description);
    for (const [k, v] of agent.claudeKeys) fields.set(k, v); // ALL keys, no drops
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, agent.body, agent.sourcePath);
    // Canonical: keep EVERY claudeKey, so dropAllClaudeKeys yields zero records.
    const keep = new Set(agent.claudeKeys.keys());
    const drops = dropAllClaudeKeys(agent, "claude", "canonical target drops nothing", keep);
    return {
      files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformCommand(command) {
    const fields = new Map<string, unknown>();
    fields.set("name", command.name);
    fields.set("description", command.description);
    if (command.argumentHint !== undefined) fields.set("argument-hint", command.argumentHint);
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, command.body, command.sourcePath);
    return {
      files: [{ relpath: `commands/${command.name}.md`, content, mode: 0o644 }],
      drops: [],
      manifestEntries: [],
    };
  },

  aggregateManifest: () => null,
};
