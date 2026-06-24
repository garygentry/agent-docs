import type { HexColor, NodeRole, Theme } from "./schema.js";

/**
 * The semantic palette + light/dark token sets and accent override resolution
 * (04-theme-postprocess-png.md §1–2, resolves OTQ-2). Produces the internal
 * render-only `ResolvedPalette` consumed by `svg-postprocess.ts`. Seeded from the
 * research Cocoon taxonomy and extended to the full closed `NodeRole` set fixed in
 * 00-core-definitions.md §2.2. Colors are baked inline at generation time, so each
 * hex value is chosen to read correctly on its own theme background.
 */

// ---------------------------------------------------------------------------
// The ResolvedPalette render type (04 §1)
// ---------------------------------------------------------------------------

/** The three inlined colors applied to one node by its semantic role (REQ-COV-01). */
export interface RoleColors {
  /** Box fill color, inlined as the SVG `fill` of the node's shape (`<polygon>`/`<ellipse>`/`<path>`). */
  fill: HexColor;
  /** Box border color, inlined as the SVG `stroke` of the node's shape. */
  stroke: HexColor;
  /** Label color, inlined as the `fill` of the node's `<text>` elements. */
  text: HexColor;
}

/**
 * The fully resolved color set for one theme variant, after accent override. The
 * `roles` map is total over every `NodeRole` key (00 §2.2) — there is no missing
 * role, so color baking (§3.2) never falls through. Base tokens color the canvas,
 * edges, container boundaries, and the legend.
 */
export interface ResolvedPalette {
  /** Which variant this palette was resolved for (mirrors the baked SVG). */
  theme: Theme;
  /** Per-role box/border/label colors; total over all `NodeRole` values. */
  roles: Record<NodeRole, RoleColors>;
  /** Page/canvas background fill (the root `<svg>` backdrop rect). */
  background: HexColor;
  /** Surface fill for chrome panels (legend box, header band). */
  surface: HexColor;
  /** Default edge/connector stroke color (REQ-COV-01 arrows). */
  edge: HexColor;
  /** Default label/text color for non-node text (edge labels, legend text, titles). */
  label: HexColor;
  /** Container/boundary cluster stroke color (dashed boundary boxes). */
  boundary: HexColor;
  /** The resolved accent color — the supplied `accent` or the variant default. */
  accent: HexColor;
}

// ---------------------------------------------------------------------------
// Frozen light/dark token tables (04 §2.1, §2.2)
// ---------------------------------------------------------------------------

/** Frozen light/dark token tables — the §2.1/§2.2 values. Internal constant. */
const PALETTES: Record<Theme, ResolvedPalette> = {
  // Light "card" aesthetic: a soft tinted fill, a vivid mid-tone border, and a
  // dark same-hue label — the light-mode mirror of the dark-card look (below), so a
  // role reads as the SAME family on either theme. Base tokens follow GitHub-light.
  light: {
    theme: "light",
    background: "#ffffff",
    surface: "#f6f8fa",
    edge: "#6e7781",
    label: "#57606a",
    boundary: "#d0d7de",
    accent: "#0969da",
    roles: {
      default: { fill: "#f1f5f9", stroke: "#cbd5e1", text: "#334155" },
      frontend: { fill: "#cffafe", stroke: "#0891b2", text: "#155e75" },
      backend: { fill: "#dcfce7", stroke: "#16a34a", text: "#166534" },
      database: { fill: "#ede9fe", stroke: "#7c3aed", text: "#5b21b6" },
      queue: { fill: "#ffedd5", stroke: "#ea580c", text: "#9a3412" },
      cache: { fill: "#fee2e2", stroke: "#dc2626", text: "#991b1b" },
      external: { fill: "#eef1f5", stroke: "#94a3b8", text: "#475569" },
      security: { fill: "#ffe4e6", stroke: "#e11d48", text: "#9f1239" },
      gateway: { fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
      storage: { fill: "#ccfbf1", stroke: "#0d9488", text: "#115e59" },
      compute: { fill: "#dbeafe", stroke: "#2563eb", text: "#1e40af" },
    },
  },
  // Dark "card" aesthetic (the reference look): each role is a coordinated triple —
  // a DARK desaturated fill, a VIVID border, and a LIGHT same-hue label — so cards
  // read as tinted panels with a glowing edge rather than saturated blocks with
  // white text. Base tokens follow GitHub-dark (#161b22 panel, #30363d frame).
  dark: {
    theme: "dark",
    background: "#161b22",
    surface: "#1c2128",
    edge: "#8b949e",
    label: "#8b949e",
    boundary: "#373e47",
    accent: "#58a6ff",
    roles: {
      default: { fill: "#1c2128", stroke: "#484f58", text: "#adbac7" },
      frontend: { fill: "#0b2b33", stroke: "#22d3ee", text: "#67e8f9" },
      backend: { fill: "#0f2e1c", stroke: "#22c55e", text: "#4ade80" },
      database: { fill: "#241a3d", stroke: "#a855f7", text: "#d8b4fe" },
      queue: { fill: "#3a2410", stroke: "#f97316", text: "#fdba74" },
      cache: { fill: "#3a1518", stroke: "#ef4444", text: "#fca5a5" },
      external: { fill: "#21262d", stroke: "#6e7681", text: "#c9d1d9" },
      security: { fill: "#3a1620", stroke: "#f43f5e", text: "#fda4af" },
      gateway: { fill: "#3a2c0a", stroke: "#f59e0b", text: "#fbbf24" },
      storage: { fill: "#0c2e2a", stroke: "#14b8a6", text: "#5eead4" },
      compute: { fill: "#16243d", stroke: "#3b82f6", text: "#93c5fd" },
    },
  },
};

// ---------------------------------------------------------------------------
// Accent override resolution (04 §2.3, §2.4)
// ---------------------------------------------------------------------------

/**
 * Resolve the full color palette for one theme variant, applying an optional
 * accent override (REQ-THEME-01, OTQ-2). The returned palette is **total** over
 * every `NodeRole` so color baking (§3.2) never misses a role. Pure and
 * side-effect-free; the same inputs always yield the same palette (REQ-REPRO-01).
 *
 * @param theme - The variant to resolve (`"light"` | `"dark"`). The CLI has
 *   already collapsed spec-vs-flag precedence to a single value (05 §2).
 * @param accent - Optional `#rrggbb` accent (already validated as `HexColor`,
 *   00 §2.1). When present it replaces the accent-derived tokens per §2.3.
 * @returns A deep-cloned, total `ResolvedPalette`; the caller may not mutate the
 *   frozen `PALETTES` source.
 */
export function resolveTheme(theme: Theme, accent?: HexColor): ResolvedPalette {
  const base = structuredClone(PALETTES[theme]);
  if (accent !== undefined) {
    base.accent = accent;
    base.edge = accent;
    base.roles.default.stroke = accent;
  }
  return base;
}
