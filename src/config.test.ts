import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";
import { EmitterConfig } from "./model.js";
import { PathEscapeError } from "./errors.js";

const REPO = "/repo/root";

describe("resolveConfig", () => {
  it("maps default EmitterConfig dirs to absolute repo-root-relative roots (05 §7.1)", () => {
    const config = EmitterConfig.parse({}); // all Zod defaults
    const roots = resolveConfig(config, REPO);

    expect(roots).toEqual({
      repoRoot: REPO,
      skillsDir: `${REPO}/skills`,
      agentsDir: `${REPO}/agents`,
      commandsDir: `${REPO}/commands`,
      referencesDir: `${REPO}/references`,
      scriptsDir: `${REPO}/scripts`,
      overridesDir: `${REPO}/overrides`,
      adaptersDir: `${REPO}/adapters`,
    });
    // ResolvedRoots carries no `targets` field (05 §7.1 shape).
    expect("targets" in roots).toBe(false);
  });

  it("resolves a non-default config to the configured locations (REQ-REUSE-01, no hardcoding)", () => {
    const config = EmitterConfig.parse({
      skillsDir: "src/canonical/skills",
      agentsDir: "src/canonical/agents",
      commandsDir: "cmds",
      referencesDir: "refs",
      scriptsDir: "bin",
      overridesDir: "custom-overrides",
      adaptersDir: "dist/adapters",
    });
    const roots = resolveConfig(config, REPO);

    expect(roots.skillsDir).toBe(`${REPO}/src/canonical/skills`);
    expect(roots.agentsDir).toBe(`${REPO}/src/canonical/agents`);
    expect(roots.commandsDir).toBe(`${REPO}/cmds`);
    expect(roots.referencesDir).toBe(`${REPO}/refs`);
    expect(roots.scriptsDir).toBe(`${REPO}/bin`);
    expect(roots.overridesDir).toBe(`${REPO}/custom-overrides`);
    expect(roots.adaptersDir).toBe(`${REPO}/dist/adapters`);
  });

  it("normalizes a non-absolute repoRoot to an absolute path", () => {
    const config = EmitterConfig.parse({});
    const roots = resolveConfig(config, "/repo/../repo/root");
    expect(roots.repoRoot).toBe(REPO);
    expect(roots.skillsDir).toBe(`${REPO}/skills`);
  });

  it("throws PathEscapeError when a configured root escapes the repo (REQ-SEC-01)", () => {
    const config = EmitterConfig.parse({ overridesDir: "../escape" });
    expect(() => resolveConfig(config, REPO)).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for an absolute root pointing outside the repo", () => {
    const config = EmitterConfig.parse({ adaptersDir: "/etc/passwd" });
    expect(() => resolveConfig(config, REPO)).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for an embedded `..` that climbs out", () => {
    const config = EmitterConfig.parse({ skillsDir: "a/../../b" });
    expect(() => resolveConfig(config, REPO)).toThrow(PathEscapeError);
  });
});
