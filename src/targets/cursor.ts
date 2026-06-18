import { dropAllClaudeKeys, hintValue, orderFrontmatter, renderFrontmatter } from "./_shared.js";
import type { TargetTransform } from "./_shared.js";
import { PROVENANCE } from "../model.js";
import type { DropRecord } from "../model.js";

/**
 * Cursor target (04 §8).
 *
 * - Skills map to **Rules** at `rules/<n>.mdc` (MUST be `.mdc`) with
 *   `{description, globs: [], alwaysApply: false}`. The skill name lives in the
 *   filename (flattened — there is NO `rules/<n>/` skill directory); skill-owned
 *   references land under a sibling `rules/<n>/<ref-subpath>` directory as verbatim
 *   copies (04 §4.6 / `_shared` `skillVerbatimRecords`, assembled by the engine).
 * - Agents map to `agents/<n>.md` (markdown, NOT `.mdc`) with `{name, description}`;
 *   every structural `claudeKey` drops (Cursor agents have no tools allowlist).
 * - Commands map to `commands/<n>.md` (body-only prompt, Form B provenance); the
 *   `argument-hint` is dropped with a record — Cursor has no confirmed structured
 *   argument syntax (carry-forward, 04 §12).
 *
 * Pure functions — NO file I/O, NO Date.now, NO RNG (determinism, REQ-EMIT-06).
 */
export const cursorTransform: TargetTransform = {
  target: "cursor",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["description", skill.description],
        ["globs", []], // deterministic default (REQ-EMIT-06)
        ["alwaysApply", false],
      ]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    // argument-hint resolved from the nested 'metadata' Map (03 §4) via hintValue.
    if (hintValue(skill) !== undefined) {
      drops.push({
        target: "cursor",
        source: skill.sourcePath,
        construct: "skill.argument-hint",
        kind: "fallback",
        reason: "no Cursor .mdc invocation-hint field",
      });
    }
    if (skill.metadata.size > 0) {
      drops.push({
        target: "cursor",
        source: skill.sourcePath,
        construct: "skill.metadata",
        kind: "fallback",
        reason: "Cursor rules carry only {description, globs, alwaysApply}",
      });
    }
    return {
      files: [{ relpath: `rules/${skill.name}.mdc`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
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
      "cursor",
      "Cursor agents have no tools allowlist (readonly bool only); structural keys dropped",
    );
    return {
      files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformCommand(command) {
    // Body-only prompt file; argument-hint flattened to prose is OUT OF SCOPE —
    // dropped with a record (no confirmed Cursor structured argument syntax, MEDIUM-LOW).
    const drops: DropRecord[] = [];
    if (command.argumentHint !== undefined) {
      drops.push({
        target: "cursor",
        source: command.sourcePath,
        construct: "command.argument-hint",
        kind: "fallback",
        reason: "no confirmed Cursor structured argument syntax (MEDIUM-LOW); argument-hint dropped",
      });
    }
    // Provenance Form B (no frontmatter): HTML comment atop the body.
    const content = PROVENANCE.htmlComment() + "\n\n" + command.body;
    return {
      files: [{ relpath: `commands/${command.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  aggregateManifest: () => null,
};
