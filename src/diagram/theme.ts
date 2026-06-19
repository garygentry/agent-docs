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
  light: {
    theme: "light",
    background: "#ffffff",
    surface: "#f1f5f9",
    edge: "#475569",
    label: "#0f172a",
    boundary: "#94a3b8",
    accent: "#2563eb",
    roles: {
      default: { fill: "#e2e8f0", stroke: "#94a3b8", text: "#0f172a" },
      frontend: { fill: "#22d3ee", stroke: "#0891b2", text: "#0f172a" },
      backend: { fill: "#34d399", stroke: "#059669", text: "#0f172a" },
      database: { fill: "#a78bfa", stroke: "#7c3aed", text: "#0f172a" },
      queue: { fill: "#fb923c", stroke: "#ea580c", text: "#0f172a" },
      cache: { fill: "#f87171", stroke: "#dc2626", text: "#0f172a" },
      external: { fill: "#cbd5e1", stroke: "#64748b", text: "#0f172a" },
      security: { fill: "#fb7185", stroke: "#e11d48", text: "#0f172a" },
      gateway: { fill: "#fbbf24", stroke: "#d97706", text: "#0f172a" },
      storage: { fill: "#5eead4", stroke: "#0d9488", text: "#0f172a" },
      compute: { fill: "#93c5fd", stroke: "#2563eb", text: "#0f172a" },
    },
  },
  dark: {
    theme: "dark",
    background: "#020617",
    surface: "#0f172a",
    edge: "#94a3b8",
    label: "#e2e8f0",
    boundary: "#475569",
    accent: "#60a5fa",
    roles: {
      default: { fill: "#1e293b", stroke: "#475569", text: "#f8fafc" },
      frontend: { fill: "#0e7490", stroke: "#22d3ee", text: "#f8fafc" },
      backend: { fill: "#047857", stroke: "#34d399", text: "#f8fafc" },
      database: { fill: "#6d28d9", stroke: "#a78bfa", text: "#f8fafc" },
      queue: { fill: "#c2410c", stroke: "#fb923c", text: "#f8fafc" },
      cache: { fill: "#b91c1c", stroke: "#f87171", text: "#f8fafc" },
      external: { fill: "#334155", stroke: "#64748b", text: "#f8fafc" },
      security: { fill: "#be123c", stroke: "#fb7185", text: "#f8fafc" },
      gateway: { fill: "#b45309", stroke: "#fbbf24", text: "#f8fafc" },
      storage: { fill: "#0f766e", stroke: "#5eead4", text: "#f8fafc" },
      compute: { fill: "#1d4ed8", stroke: "#93c5fd", text: "#f8fafc" },
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
