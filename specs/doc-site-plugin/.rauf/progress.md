## Item 001 — scaffold SKILL.md (learnings)

- SKILL.md frontmatter style mirrors skills/docs-helper & diagram-generator:
  `name:`, `description:`, `metadata.{argument-hint,allowed-tools}`. src/discover.ts
  accepts this; the skill stays UNREGISTERED in tools.manifest.json until item 010,
  which keeps build:check/golden green.
- Token-coverage discipline: only emit `{{UPPER_SNAKE}}` for the 17 canonical
  tokens. Avoid writing a literal `{{TOKEN}}` placeholder in prose — it pollutes the
  `/\{\{([A-Z0-9_]+)\}\}/g` scan item 011 uses. Use "token placeholder" in prose.
- GATE GOTCHA: `bun run gate`'s `format:check` stage was RED at HEAD because the
  forge-authored `specs/doc-site-plugin/*.md` docs are not prettier-clean (huge
  cosmetic diffs; reformatting corrupts their table alignment + jsonc examples).
  Fixed once in item 001 by adding `specs/**/*.md` to .prettierignore (same
  rationale as the existing `.rauf/`, backlog.json, `.verification/` exclusions).
  Later items don't need to revisit this.

## Item 011 — token-coverage + schema-fixture tests (learnings)

- ajv added as TEST-ONLY devDependency (^8.20.0); import `Ajv2020 from "ajv/dist/2020.js"`.
  With `strict:false` it logs a harmless `unknown format "uri" ignored` warning (no
  ajv-formats installed) — does not fail the run.
- ORPHAN TOKEN CAUGHT: `{{REPO_SLUG}}` was in the canonical 17 + SKILL.md table but
  appeared in NO template body (only derivation docs / the GH-Pages literal-base
  prose). The §4.2 orphan assertion failed on it — exactly its purpose. Fixed by
  surfacing the already-documented literal-base fallback in
  `deploy/github-pages/docs.yml.tmpl` as a commented block referencing
  `{{REPO_SLUG}}` (token-in-comment counts, same precedent as DOCS_PKG_DIR in
  check-docs.mjs.tmpl). A template edit means `bun run build` + `bun run
  src/test/regenerate-goldens.ts` must be re-run (item 010's adapters/goldens).
- Schema-fixture: duplicate-slug reject case is `it.skip` per 10 §4.3 (JSON Schema
  can't express cross-item slug-uniqueness; symlinker/drift-guard own it).
