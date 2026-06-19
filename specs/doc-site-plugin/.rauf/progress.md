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
