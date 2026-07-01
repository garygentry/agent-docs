---
# GENERATED — DO NOT EDIT. Source: skills/readme-author/SKILL.md. Regenerate: bun run build
name: readme-author
description: Create a polished, professional README.md for a project, or restructure an existing one to a high bar. Use whenever the user wants to write, generate, improve, refresh, or restructure a README / repo landing page — including adding a hero (title, tagline, badges), install and quickstart sections, feature tables, and an architecture diagram. Trigger on "write a README", "improve my README", "make a landing page for this repo", even if they don't name the file.
argument-hint: "[target repo or README path]"
metadata:
  argument-hint: "[target repo or README path]"
  allowed-tools: Read, Edit, Write, Bash
---

# readme-author

Author a polished `README.md` for a project, or restructure an existing one to a
professional bar.
You detect what the project is, ask only the gaps you can't infer, then compose a
scannable README in a canonical order — with an optional light/dark architecture
diagram via the sibling `diagram-generator`.

This skill is a **structure author**.
For general prose-style review of arbitrary docs, use `docs-helper` instead — this
skill _reuses_ that skill's style guide for its prose, rather than restating it.

## Reference docs (pull in per phase)

These ride verbatim under `references/`; read the one for the phase you are in rather
than loading everything up front.

- **`references/content-architect.md`** — the upstream content/accuracy handshake: ground
  project kind, audience, and quickstart facts in a `content-architect` DocPlan before
  composing, and never assert a `gaps[]` item as fact.
- **`references/structure.md`** — canonical section order and the library / app-or-CLI /
  framework variants.
- **`references/header-style.md`** — this repo's hero convention (title, `>` tagline,
  tight badge row) and shields.io badge recipes.
- **`references/diagrams.md`** — how to call the sibling `diagram-generator` renderer for
  a README and embed a light/dark `<picture>` pair.
- **`references/update-policy.md`** — how to restructure an existing README without
  clobbering substantive content.

## When to use

- **Create** — the target repo has no README, or only a stub. Compose one from scratch.
- **Update** — a README exists but is disorganized, dated, or thin. Restructure it to the
  canonical skeleton while preserving substantive content (`references/update-policy.md`).

## Phased procedure

### Phase 1 — detect

Read the target repo (read-only) to infer what you can, so you ask as little as possible:

- Project type — **library**, **app/CLI**, or **framework** (drives sections and badges).
- Name, description, and license from `package.json` / `pyproject.toml` / `Cargo.toml`
  / `LICENSE`.
- Package manager and install command from the lockfile or manifest.
- Repo slug from `git remote`.
- An existing README, logo, or `assets/` images.
- CI presence (`.github/workflows/`) — gates whether a build badge carries real signal.

Detection is best-effort: every missing signal becomes a question in Phase 2, not a
hard failure.

**Ground content in a DocPlan (content/accuracy step).** Before interviewing, obtain the
`end-user` slice of a `content-architect` **DocPlan** — an existing `docs/docplan.json`, or a
live call to the sibling `content-architect` skill — to fix `project.{name,kind,summary}`,
the primary `audiences[]`, and the `sources[]` behind the quickstart (weight integration
tests) from ground truth rather than heuristics. Honor its `gaps[]`: never assert an
unverified item as fact in the README. This improves _selection and accuracy_ only —
`readme-author` still owns structure and section order. If no DocPlan is available and
`content-architect` is declined or absent, skip gracefully and rely on detection + interview.
See `references/content-architect.md`.

### Phase 2 — interview (only the gaps)

Ask the minimum you could not detect **or already resolve from the DocPlan** (Phase 1) —
a DocPlan that fixes project kind, audience, or the quickstart facts removes those questions:

- The one-line tagline (the `>` blockquote under the title).
- The primary audience and the single most important thing the project does.
- Which badges carry real signal (skip any that would be dead or vanity — see
  `references/header-style.md`).
- Whether to include an architecture diagram (only offer when the project is
  architecturally non-trivial — see `references/diagrams.md`).

### Phase 3 — compose

Assemble the README in the canonical order from `references/structure.md`, using the hero
style from `references/header-style.md`.
Write the prose to the house style in
[`skills/docs-helper/references/style-guide.md`](../docs-helper/references/style-guide.md)
— one sentence per line, sentence-case headings, every fenced block declares a language,
realistic runnable examples.
Make install and quickstart copy-pasteable.
Put the license section last.

In update mode, follow `references/update-policy.md`: propose edits rather than silently
rewriting.

### Phase 4 — diagram (offer, then generate)

When the project is architecturally non-trivial and the user approves, render a light/dark
SVG pair with the sibling renderer and embed it with `<picture>`, per
`references/diagrams.md`.
Depict only what the project actually contains — never invent components.
On any renderer version mismatch or absence, surface it and skip the diagram; never
substitute a fallback.
