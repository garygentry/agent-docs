/**
 * In-repo template-asset validation for the doc-site skill (10 §4).
 *
 * Two independent guards over the authored skill assets — they read ONLY from
 * skills/doc-site/ (the template tree, SKILL.md, docs.manifest.schema.json),
 * never from adapters/ or the emitter:
 *
 *  (a) Token-coverage — enforces 00 §4.1's closed token vocabulary. Every
 *      {{TOKEN}} used in a template must be one of the 18 canonical tokens AND
 *      appear in SKILL.md (no undefined tokens); every canonical token must be
 *      exercised by at least one template (no orphan tokens); and SKILL.md's
 *      substitution table must mirror the canonical set exactly.
 *
 *  (b) Schema-fixture — compiles docs.manifest.schema.json with Ajv2020 and runs
 *      accept/reject fixtures. The slug-uniqueness reject case is skipped per the
 *      10 §4.3 caveat (JSON Schema can't express it; the symlinker/drift-guard own it).
 */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./golden.shared.js";

const SKILL_DIR = path.join(REPO_ROOT, "skills", "doc-site");
const TEMPLATES_DIR = path.join(SKILL_DIR, "references", "templates");
const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
const SCHEMA_PATH = path.join(SKILL_DIR, "references", "docs.manifest.schema.json");
const MANIFEST_FIXTURES = path.join(
  REPO_ROOT,
  "src",
  "test",
  "__fixtures__",
  "doc-site",
  "manifests",
);

/** Canonical token set — the in-test mirror of 00 §4.1 (exactly 18 tokens). */
const CANONICAL_TOKENS = [
  "SITE_TITLE",
  "SITE_TITLE_SLUG",
  "SITE_DESC",
  "SITE_URL",
  "BASE_PATH",
  "REPO_SLUG",
  "GITHUB_URL",
  "PKG_MANAGER",
  "RUNTIME",
  "DOCS_PKG_DIR",
  "IMAGES_SRC_DIR",
  "ACCENT_LIGHT",
  "ACCENT_DARK",
  "DEFAULT_BRANCH",
  "ASTRO_VERSION",
  "STARLIGHT_VERSION",
  "DOCS_PKG_DIR_TO_ROOT",
  "SYMLINK_PAGE_LINES",
] as const;

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function tokensIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) found.add(m[1]!);
  return found;
}

describe("doc-site token coverage (00 §4.1 closed vocabulary)", () => {
  const canonical = new Set<string>(CANONICAL_TOKENS);

  const templateFiles = walkFiles(TEMPLATES_DIR);
  // Map each used token → the template basenames that use it (for failure messages).
  const usedTokens = new Map<string, string[]>();
  for (const file of templateFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const tok of tokensIn(text)) {
      const list = usedTokens.get(tok) ?? [];
      list.push(path.relative(TEMPLATES_DIR, file));
      usedTokens.set(tok, list);
    }
  }

  const skillText = fs.readFileSync(SKILL_MD, "utf8");
  const skillTokens = tokensIn(skillText);

  it("finds template assets to scan", () => {
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  it("uses no undefined tokens (every template token is canonical AND in SKILL.md)", () => {
    for (const [tok, files] of usedTokens) {
      expect(
        canonical.has(tok),
        `token {{${tok}}} (used in ${files.join(", ")}) is not canonical`,
      ).toBe(true);
      expect(
        skillTokens.has(tok),
        `token {{${tok}}} (used in ${files.join(", ")}) is absent from SKILL.md`,
      ).toBe(true);
    }
  });

  it("has no orphan tokens (every canonical token is exercised by ≥1 template)", () => {
    for (const tok of CANONICAL_TOKENS) {
      expect(usedTokens.has(tok), `canonical token {{${tok}}} is never used by any template`).toBe(
        true,
      );
    }
  });

  it("SKILL.md's substitution table mirrors the canonical set exactly", () => {
    // Substitution-table rows are the only lines shaped `| `{{TOKEN}}` |`.
    const tableTokens = new Set<string>();
    for (const line of skillText.split("\n")) {
      const m = /^\|\s*`\{\{([A-Z0-9_]+)\}\}`/.exec(line);
      if (m) tableTokens.add(m[1]!);
    }
    expect([...tableTokens].sort()).toEqual([...CANONICAL_TOKENS].sort());
  });
});

describe("doc-site manifest schema (Draft 2020-12 fixtures)", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

  const validate = ajv.compile(schema);

  const load = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURES, `${name}.json`), "utf8"));

  it("compiles docs.manifest.schema.json with Ajv2020", () => {
    expect(typeof validate).toBe("function");
  });

  it.each(["valid-minimal", "valid-mixed", "valid-unmanaged"])("accepts %s", (name) => {
    const ok = validate(load(name));
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  // Each reject fixture isolates exactly one 00 §2.2 rule. Assert not just that
  // validation fails, but that it fails for the INTENDED reason (keyword), so a future
  // schema edit can't make a fixture start rejecting for an unrelated reason while the
  // test stays green (which would silently erode rule-discrimination coverage).
  it.each([
    // [fixture, ajv error keyword that proves the intended rule fired]
    ["invalid-symlink-missing-from", "required"], // symlink page must have `from`
    ["invalid-native-with-from", "not"], // native page must NOT have `from`
    ["invalid-missing-source", "required"], // page must have `source`
    ["invalid-unknown-key", "additionalProperties"], // no unknown keys
  ] as const)("rejects %s for the intended rule", (name, expectedKeyword) => {
    const ok = validate(load(name));
    expect(ok).toBe(false);
    const keywords = (validate.errors ?? []).map((e) => e.keyword);
    expect(
      keywords.includes(expectedKeyword),
      `expected keyword "${expectedKeyword}" but got ${JSON.stringify(
        keywords,
      )} — ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  // 10 §4.3 caveat: JSON Schema cannot express slug-uniqueness across array items
  // (uniqueItems compares whole items). The schema delegates this to the symlinker
  // and the drift guard (check-docs.mjs sidebar-parity/orphaned-symlink rules), so
  // the static schema legitimately ACCEPTS a duplicate-slug manifest.
  it.skip("rejects invalid-duplicate-slug (delegated to symlinker/drift-guard)", () => {
    expect(validate(load("invalid-duplicate-slug"))).toBe(false);
  });
});
