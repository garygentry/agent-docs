import { stringify as stringifyToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import { dropAllClaudeKeys, orderFrontmatter, renderFrontmatter } from "./_shared.js";
import type { TargetTransform } from "./_shared.js";
import { PROVENANCE, REGEN_CMD, YAML_OPTS } from "../model.js";
import type { AgentRecord, DropRecord } from "../model.js";

/**
 * Codex target (04 §7). Per 2026 research (supersedes feature-forge): Codex skills
 * are a directory with `SKILL.md` ({name, description} frontmatter); Codex AGENTS
 * are TOML (`agents/<n>.toml`), not markdown; Codex slash commands are
 * `prompts/<n>.md` (YAML frontmatter) but OpenAI has DEPRECATED prompts in favor of
 * Skills — we still emit and warn. The aggregate is `agents/openai.yaml` (Form C).
 *
 * Carry-forward warnings (04 §12): the per-agent `developer_instructions` key name,
 * the user-skills path, and the prompts deprecation are MEDIUM/LOW confidence.
 */

/**
 * TQ-2 (04 §7.3): representable per-agent keys. Empty is the safe default — Codex
 * agents have no per-agent `tools` array (tool restriction is a config-layer
 * concern), so EVERY Claude structural key is dropped with a record. Expanding this
 * set (e.g. model / model_reasoning_effort) is a deliberate future change (04 §12).
 */
const CODEX_AGENT_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Render a Codex agent TOML file (04 §7.5). Required keys (`name`, `description`,
 * `developer_instructions`) are emitted in a FIXED order for byte-stability
 * (REQ-EMIT-06): the scalar `name`/`description` pair is serialized via
 * `smol-toml` (deterministic key ordering), then `developer_instructions` carries
 * the canonical agent body as a TOML triple-quoted literal string (`'''…'''`) so
 * multiline content is preserved without escaping. A leading `# GENERATED …` TOML
 * comment provides provenance (Form A, TOML flavor). Optional model /
 * model_reasoning_effort are NOT emitted in the safe default (04 §12, TQ-2).
 *
 * @param agent - The canonical agent record.
 * @returns The complete TOML document string.
 */
export function renderCodexAgentToml(agent: AgentRecord): string {
  // Scalar header keys via smol-toml in a fixed, pre-sorted order (REQ-EMIT-06).
  const header = stringifyToml({ name: agent.name, description: agent.description });
  const instructions = renderDeveloperInstructions(agent.body);
  return PROVENANCE.yamlComment(agent.sourcePath) + "\n" + header + "\n" + instructions;
}

/**
 * Serialize the agent body as a `developer_instructions` TOML value. Prefers a
 * triple-quoted literal string (`'''…'''`, no escaping, byte-stable). TOML literal
 * strings cannot contain the `'''` delimiter, so a body that does falls back to a
 * `smol-toml`-serialized basic string (escaped) to stay correct and deterministic.
 */
function renderDeveloperInstructions(body: string): string {
  if (!body.includes("'''")) {
    // Leading newline after the opening delimiter is trimmed by TOML, matching the
    // 04 §7.6 example: `developer_instructions = '''\n<body>'''`.
    return `developer_instructions = '''\n${body}'''\n`;
  }
  return stringifyToml({ developer_instructions: body }) + "\n";
}

export const codexTransform: TargetTransform = {
  target: "codex",

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
        target: "codex",
        source: skill.sourcePath,
        construct: "skill.metadata",
        kind: "fallback",
        reason:
          "Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped",
      });
    }
    return {
      files: [{ relpath: `skills/${skill.name}/SKILL.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformAgent(agent) {
    const content = renderCodexAgentToml(agent);
    const drops = dropAllClaudeKeys(
      agent,
      "codex",
      "no per-agent representation in codex agents/<n>.toml (TQ-2); tool restriction is config-layer",
      CODEX_AGENT_KEYS,
    );
    return {
      files: [{ relpath: `agents/${agent.name}.toml`, content, mode: 0o644 }],
      drops,
      manifestEntries: [{ name: agent.name, description: agent.description }],
    };
  },

  transformCommand(command) {
    const fm = new Map<string, unknown>();
    fm.set("description", command.description);
    if (command.argumentHint !== undefined) fm.set("argument-hint", command.argumentHint);
    const content = renderFrontmatter(orderFrontmatter(fm), command.body, command.sourcePath);
    // DEPRECATION: emitted but OpenAI steers users to Skills. Record as fallback.
    const drops: DropRecord[] = [
      {
        target: "codex",
        source: command.sourcePath,
        construct: "command:codex",
        kind: "fallback",
        reason:
          "Codex prompts are DEPRECATED by OpenAI in favor of Skills; emitted to the prompts form but verify before relying on it",
      },
    ];
    return {
      files: [{ relpath: `prompts/${command.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  aggregateManifest(entries) {
    if (entries.length === 0) return null;
    // entries arrive pre-sorted by name (engine, 05). Form C: _generated first.
    const doc = {
      _generated: { source: "agents/*", regenerate: REGEN_CMD },
      agents: entries.map((e) => ({ name: e.name, description: e.description })),
    };
    const content = stringifyYaml(doc, YAML_OPTS); // leading _generated key (Form C)
    return { relpath: "agents/openai.yaml", content, mode: 0o644 };
  },
};
