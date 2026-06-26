# README structure (agent reference)

The canonical section order for a polished README, and how it varies by project type.
Compose in this order; mark each section essential or optional for the detected type.

## Canonical section order

1. **Hero** — title (`#` H1), `>` tagline, one tight badge row. **Essential.**
   See `header-style.md`.
2. **Lede** — one short paragraph under the hero: what this is and who it's for.
   **Essential.**
3. **Demo / diagram** — a screenshot, GIF, or architecture `<picture>` pair.
   **Optional** (see `diagrams.md`); include when it earns its space.
4. **Features** — a short bullet list or table of what the project does. **Optional.**
5. **Install** — copy-pasteable install command(s) for the detected package manager.
   **Essential.**
6. **Quickstart / usage** — the smallest runnable example that produces a real result.
   **Essential.**
7. **Configuration** — options, environment variables, flags. **Optional.**
8. **API / reference** — exported functions, CLI commands, or endpoints. **Optional.**
9. **Contributing** — link to `CONTRIBUTING.md`; how to run tests locally. **Optional.**
10. **License** — name the license and link `LICENSE`. **Essential, always last.**

Keep it scannable: a reader should find install and a working example within the first
screenful.
Do not pad with sections that carry no signal.

## Project-type variants

Detection (SKILL Phase 1) picks one of three shapes.

### Library

A package other code imports.
Emphasize the path from install to first call.

- Install (package manager add command).
- Import + minimal usage snippet — the smallest real call.
- API reference (the main exports), or a link to fuller docs.
- Skip "demo" unless a visual genuinely helps.

### App or CLI

Something a user runs.
Emphasize seeing it work.

- Demo first — screenshot, GIF, or terminal capture.
- Usage — the common commands or flags, copy-pasteable.
- Configuration — env vars and config files.

### Framework / larger system

Something users build on top of.
Emphasize concepts and the on-ramp.

- A concepts / "how it works" section (often paired with an architecture diagram).
- Getting started — a guided first project.
- Links to a docs site (consider the sibling `doc-site` skill) rather than inlining
  everything.
