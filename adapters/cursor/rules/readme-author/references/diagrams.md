# README diagram integration (agent reference)

How to add a light/dark architecture diagram to a README using the sibling
`diagram-generator` skill.
This reuses the proven vendoring pattern from `doc-site`, simplified: a README needs only
committed image files — no build-time prebuild wiring.

The renderer contract (flags, exit codes, `CONTRACT_VERSION`) is owned by the
`diagram-generator` skill.
This file is the README-specific procedure.

## 1. When to offer a diagram

Offer one **only when the project is architecturally non-trivial** — multiple services, a
pipeline, a request flow worth seeing.
A single-package library usually does not need one.
Propose it in the interview; render only on approval.

Honor the core diagram-generator rule: **depict only what the project actually contains.**
Never invent components to fill the picture.

## 2. The fixed sibling rel-path

Both skills live under the same per-target parent in every adapter bundle, so the renderer
is always reached at one uniform relative path — no per-target branching:

```
../diagram-generator/scripts/diagram-render.mjs
```

## 3. Version pin-check — run BEFORE rendering

Before rendering anything, verify the sibling renderer matches the pinned
`CONTRACT_VERSION` **`1.3.0`**:

```sh
node ../diagram-generator/scripts/diagram-render.mjs --version
# stdout: 1.3.0   (CONTRACT_VERSION), exit 0
```

| Observed `--version`              | Action                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- |
| `1.3.0`, exit 0                   | **Match.** Proceed to render (§4).                                     |
| Any other version, exit 0         | **Mismatch.** Surface expected `1.3.0` vs. observed; skip the diagram. |
| Nonzero exit / no output / absent | **Unavailable.** Surface that the renderer could not be queried; skip. |

On any non-match, **skip the diagram and surface why** — there is no embedded fallback
renderer, and you never substitute one.
The rest of the README is unaffected.

## 4. Render a light/dark pair

Author a `DiagramSpec` JSON for the project's real architecture, then render it twice into
a committed assets dir (e.g. `assets/`):

```sh
node ../diagram-generator/scripts/diagram-render.mjs spec.json \
  --theme light --format svg --out-file assets/architecture.light.svg
node ../diagram-generator/scripts/diagram-render.mjs spec.json \
  --theme dark  --format svg --out-file assets/architecture.dark.svg
```

Use `--out-file` (the fully caller-controlled form) so the output paths are stable
regardless of the spec's `title`.
A nonzero exit is a failure — surface the renderer's stderr; do not embed a half-rendered
image.

## 5. Embed with `<picture>`

Embed the pair so it adapts to the reader's GitHub theme, exactly as this repo's
`README.md` does (lines 86–94).
Always include `alt` text:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture.dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/architecture.light.svg" />
  <img alt="Architecture of <PROJECT>" src="assets/architecture.light.svg" />
</picture>
```

Place it in the **demo / diagram** slot of the canonical order (`structure.md` §3),
typically just under the lede for an app or framework.
