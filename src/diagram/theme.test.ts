import { describe, expect, it } from "vitest";
import { NodeRole } from "./schema.js";
import { resolveTheme } from "./theme.js";

const ALL_ROLES = NodeRole.options;

describe("resolveTheme", () => {
  it("resolves light and dark to distinct palettes", () => {
    const light = resolveTheme("light");
    const dark = resolveTheme("dark");
    expect(light.theme).toBe("light");
    expect(dark.theme).toBe("dark");
    expect(light).not.toEqual(dark);
    expect(light.background).not.toBe(dark.background);
  });

  it("defines a color for every NodeRole in both palettes", () => {
    for (const theme of ["light", "dark"] as const) {
      const palette = resolveTheme(theme);
      for (const role of ALL_ROLES) {
        const colors = palette.roles[role];
        expect(colors, `${theme}/${role}`).toBeDefined();
        expect(colors.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(colors.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(colors.text).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("applies an accent override to accent/edge/default-stroke tokens", () => {
    const accent = "#ff0000";
    const resolved = resolveTheme("light", accent);
    expect(resolved.accent).toBe(accent);
    expect(resolved.edge).toBe(accent);
    expect(resolved.roles.default.stroke).toBe(accent);
  });

  it("leaves theme defaults when no accent is supplied", () => {
    const defaults = resolveTheme("light");
    expect(defaults.accent).toBe("#0969da");
    expect(defaults.edge).toBe("#6e7781");
    expect(defaults.roles.default.stroke).toBe("#cbd5e1");
    expect(resolveTheme("dark").accent).toBe("#58a6ff");
  });

  it("does not override semantic role fills with the accent", () => {
    const accent = "#ff0000";
    const resolved = resolveTheme("light", accent);
    expect(resolved.roles.frontend.fill).toBe("#cffafe");
    expect(resolved.roles.default.fill).toBe("#f1f5f9");
  });

  it("returns a deep clone that does not mutate the frozen source", () => {
    const a = resolveTheme("light", "#abcdef");
    const b = resolveTheme("light");
    expect(b.edge).toBe("#6e7781");
    expect(b.roles.default.stroke).toBe("#cbd5e1");
    a.roles.default.fill = "#000000";
    expect(resolveTheme("light").roles.default.fill).toBe("#f1f5f9");
  });
});
