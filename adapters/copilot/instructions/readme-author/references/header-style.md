# README hero style (agent reference)

The hero is the first screenful: title, tagline, badge row.
This repo's own `README.md` (lines 1–7) is the worked example — match it.

## The hero convention

Three parts, in this order, with a blank line between each:

1. **Title** — a single `#` H1 with the project name.
2. **Tagline** — one `>` blockquote line: what the project is, in a sentence.
   Concrete, not a slogan. No trailing period is fine for a fragment.
3. **Badge row** — one line of **3–5** badges, no line breaks between them.

The worked example from this repo:

```markdown
# agent-docs

> Agent skills for project documentation — scaffold a Starlight docs site, generate portable diagrams, and write house-style docs.

[![Bun](https://img.shields.io/badge/built%20with-Bun-000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
```

A centered hero (`<div align="center">` with a logo `<img>`) is acceptable for apps and
frameworks with an existing logo asset.
Keep libraries left-aligned and plain unless the user asks otherwise.

## Badge rules

Every badge must carry **real signal**.
A reader scans badges to answer "is this maintained, what does it cost me, will it work."

- **3–5 badges**, one row. Never a badge wall.
- **Never a dead badge** — only add a CI badge if `.github/workflows/` exists; only a
  version badge if the package is actually published; only a coverage badge if coverage
  is actually reported.
- Prefer badges that **link** somewhere useful (the registry page, the CI run, `LICENSE`).
- Order from most to least load-bearing: version → build → coverage → license → downloads.

## High-signal badge recipes (shields.io)

Use the live dynamic badges when the project is published or has CI; use the static
`badge/` form for one-off labels.

```markdown
<!-- Published npm version (links to the package) -->

[![npm](https://img.shields.io/npm/v/PACKAGE?logo=npm)](https://www.npmjs.com/package/PACKAGE)

<!-- CI status — only if .github/workflows/WORKFLOW.yml exists -->

[![CI](https://img.shields.io/github/actions/workflow/status/OWNER/REPO/WORKFLOW.yml?branch=main)](https://github.com/OWNER/REPO/actions)

<!-- Monthly downloads -->

[![downloads](https://img.shields.io/npm/dm/PACKAGE)](https://www.npmjs.com/package/PACKAGE)

<!-- License (links to the file) -->

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<!-- Static label badge (logo optional) -->

[![built with Bun](https://img.shields.io/badge/built%20with-Bun-000?logo=bun&logoColor=white)](https://bun.sh)
```

Replace `PACKAGE`, `OWNER`, `REPO`, and `WORKFLOW.yml` with detected values.
Spaces in static-badge text are `%20`; a literal `-` is `--`.
