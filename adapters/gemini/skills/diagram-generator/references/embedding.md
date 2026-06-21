# Embedding diagrams on light/dark surfaces

A diagram-generator SVG bakes **one** theme's colors as inline presentation
attributes and embeds its font as an `@font-face` data-URI. This is deliberate —
it keeps the SVG portable across tier-2 viewers (Inkscape, Office, PDF, GitHub)
that ignore CSS, media queries, and external fonts. The trade-off: a single SVG
**cannot** adapt to the host's light/dark mode on its own, and GitHub additionally
strips `<style>` blocks and `prefers-color-scheme` rules from rendered SVGs, so a
"clever" self-switching single asset will not work there.

The portable way to get theme-adaptive diagrams is to ship **two** assets — one
per theme — and let the host pick.

## Transparent background (the default)

Since v-this-change the canvas background is **transparent by default** (`#10`), so
a single themed SVG already blends into most surfaces: pick the `--theme` whose
foreground reads on the host background and the diagram has no opaque panel to
clash. Use `--background opaque` only when you explicitly want the theme's solid
backdrop. Transparent + a matching theme is enough for many embeds; reach for the
dual-theme `<picture>` pattern below only when the **same** page is viewed in both
light and dark.

## GitHub `<picture>` dual-theme pattern

Render a light and a dark SVG, then embed both. GitHub honors `<picture>` +
`prefers-color-scheme`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagram.dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="diagram.light.svg" />
  <img alt="Build pipeline" src="diagram.light.svg" />
</picture>
```

The `<img>` `src` is the fallback for renderers that ignore `<picture>` (plain
Markdown viewers, RSS, etc.) — point it at the light variant. Keep a meaningful
`alt`; the SVGs also carry their own `<title>`/`<desc>` for assistive tech.

## Rendering the pair

There is no single `both-themes` flag; render each theme explicitly. With
transparent backgrounds the two files differ only in foreground colors:

```bash
spec="$(mktemp -d)/spec.json"   # or a committed src/diagrams/*.json for build steps
build_spec > "$spec"

node skills/diagram-generator/scripts/diagram-render.mjs "$spec" \
    --theme light --out-file diagram.light.svg
node skills/diagram-generator/scripts/diagram-render.mjs "$spec" \
    --theme dark  --out-file diagram.dark.svg
```

Both variants are byte-deterministic, so they are safe to commit and diff.

## Markdown / docs sites

Most docs frameworks (Astro Starlight, Docusaurus, MkDocs Material) support the
same `<picture>` markup inside MDX/HTML. When the framework exposes the active
theme via a CSS class instead of the OS preference, embed both SVGs and toggle
their visibility with the framework's theme class rather than `prefers-color-scheme`.
