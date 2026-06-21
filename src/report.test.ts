import { describe, expect, it } from "vitest";

import { buildReportModel, renderReport } from "./report.js";
import type { EmitResult, Manifest } from "./model.js";

function makeManifest(): Manifest {
  return {
    version: 1,
    config: {
      skillsDir: "skills",
      agentsDir: "agents",
      commandsDir: "commands",
      referencesDir: "references",
      scriptsDir: "scripts",
      overridesDir: "overrides",
      adaptersDir: "adapters",
      targets: ["claude", "codex", "copilot", "cursor", "gemini"],
    },
    tools: [
      { name: "pr-helper", type: "skill", source: "skills/pr-helper" },
      { name: "triage", type: "agent", source: "agents/triage.md" },
    ],
  };
}

function makeEmitResult(): EmitResult {
  return {
    files: [
      { relpath: "claude/skills/pr-helper/SKILL.md", content: "a", mode: 0o644 },
      { relpath: "claude/agents/triage.md", content: "b", mode: 0o644 },
      { relpath: "codex/skills/pr-helper/SKILL.md", content: "c", mode: 0o644 },
      { relpath: "codex/agents/triage.toml", content: "d", mode: 0o644 },
    ],
    drops: [
      {
        target: "codex",
        source: "agents/triage.md",
        construct: "agent.model",
        kind: "fallback",
        reason: "Structural agent key not representable on codex (TQ-2).",
      },
      {
        target: "copilot",
        source: "commands/summarize.md",
        construct: "command:copilot",
        kind: "skipped",
        reason: "No native slash-command construct; skipped.",
      },
    ],
    manifestEntries: [],
    overridden: ["codex/agents/triage.toml"],
    verbatim: [
      {
        relpath: "claude/skills/pr-helper/references/x.md",
        sourcePath: "skills/pr-helper/references/x.md",
      },
    ],
  };
}

describe("buildReportModel", () => {
  it("computes per-target tallies, drops, and staleOverrides", () => {
    const model = buildReportModel(makeEmitResult(), makeManifest(), ["cursor/rules/gone.mdc"]);

    expect(model.toolsProcessed).toEqual([
      { name: "pr-helper", type: "skill" },
      { name: "triage", type: "agent" },
    ]);

    expect(model.perTarget.claude).toEqual({
      emitted: 2,
      fallback: 0,
      skipped: 0,
      overridden: 0,
      verbatim: 1,
    });
    expect(model.perTarget.codex).toEqual({
      emitted: 2,
      fallback: 1,
      skipped: 0,
      overridden: 1,
      verbatim: 0,
    });
    expect(model.perTarget.copilot.skipped).toBe(1);
    expect(model.perTarget.gemini).toEqual({
      emitted: 0,
      fallback: 0,
      skipped: 0,
      overridden: 0,
      verbatim: 0,
    });

    expect(model.staleOverrides).toEqual(["cursor/rules/gone.mdc"]);
    expect(model.drops).toHaveLength(2);
    // codex drop sorts before copilot drop (TARGET_ORDER).
    expect(model.drops[0]?.target).toBe("codex");
    expect(model.drops[1]?.target).toBe("copilot");
  });
});

describe("renderReport", () => {
  it("renders the Summary/Coverage/Drops/Stale sections with no timestamps", () => {
    const model = buildReportModel(makeEmitResult(), makeManifest(), ["cursor/rules/gone.mdc"]);
    const out = renderReport(model);

    expect(out).toContain("<!-- GENERATED — DO NOT EDIT. Regenerate: bun run build -->");
    expect(out).toContain("## Summary");
    expect(out).toContain("2 tools processed: `pr-helper` (skill), `triage` (agent).");
    expect(out).toContain("## Coverage by target");
    expect(out).toContain("| codex | 2 | 1 | 0 | 1 | 0 |");
    expect(out).toContain("## Dropped & fallback constructs");
    expect(out).toContain("### codex");
    expect(out).toContain("| `agents/triage.md` | `agent.model` |");
    expect(out).toContain("## Stale overrides");
    expect(out).toContain("- `cursor/rules/gone.mdc`");
    // Deterministic: no timestamps / dates.
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("renders empty drops and stale sections", () => {
    const empty: EmitResult = {
      files: [],
      drops: [],
      manifestEntries: [],
      overridden: [],
      verbatim: [],
    };
    const out = renderReport(buildReportModel(empty, { ...makeManifest(), tools: [] }));
    expect(out).toContain("0 tools processed.");
    expect(out).toContain("_No dropped constructs._");
    expect(out).toContain("_None._");
  });

  it("is byte-identical across two renders", () => {
    const model = buildReportModel(makeEmitResult(), makeManifest(), ["cursor/rules/gone.mdc"]);
    expect(renderReport(model)).toBe(renderReport(model));
  });
});
