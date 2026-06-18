import type { EmittedFile } from "./model.js";
import { EmitterError } from "./errors.js";

/**
 * Resolved metadata for the Claude plugin manifests. Assembled by the engine from
 * package.json + manifest config so {@link emitPlugin} performs no I/O of its own
 * (keeps it pure + path-agnostic; REQ-REUSE-01). Identity (`name`/`version`) has a
 * single source of truth — package.json (07 §3.2) — so the same values feed the
 * gemini aggregate identity (04 §9) and these manifests.
 */
export interface PluginMeta {
  /** Plugin name. Defaults from package.json `name`; kebab-case. */
  name: string;
  /** SemVer string. Defaults from package.json `version`. */
  version: string;
  /** Short, ASCII-only description (no `→`; see 07 §3.4). */
  description: string;
  /** Author/owner display name (feature-forge uses `{ name }`). */
  author: string;
  /** Discovery keywords for plugin.json. May be empty. */
  keywords: string[];
  /** Optional longer marketplace blurb; falls back to `description`. */
  marketplaceDescription?: string;
}

/** kebab-case validation for the plugin name (07 §3.6). */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Minimal SemVer-shape gate — `major.minor.patch` with optional pre/build (07 §3.6). */
const SEMVER_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;

/**
 * Serialize a manifest object to strict, deterministic JSON (07 §3.4):
 * 2-space indent, trailing newline, key order driven by literal construction
 * order (never by iterating a Map or dynamic `Object.keys`). No provenance header —
 * JSON has no comment syntax and the feature-forge reference manifests carry none.
 */
function strictJson(obj: unknown): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Produce the two `.claude-plugin/` manifest files for the canonical Claude side
 * (REQ-PKG-01, OQ-05). Pure: no filesystem access — returns {@link EmittedFile}[] for
 * the engine (05) to write atomically alongside the adapter tree. Output is byte-stable
 * (REQ-EMIT-06): fixed key order, no timestamps, no environment-derived values, so the
 * same `meta` yields byte-identical manifests on every run and is drift-guarded (07 §3.5).
 *
 * @param meta Resolved plugin metadata (see {@link PluginMeta} / 07 §3.2).
 * @returns Exactly two EmittedFile entries, relpaths relative to the repo root:
 *          `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`,
 *          both mode 0o644.
 * @throws {EmitterError} code `PLUGIN_META_INVALID` if `name` is empty/not kebab-case,
 *          `version` is empty/not SemVer-shaped, or `author` is empty (07 §3.6).
 */
export function emitPlugin(meta: PluginMeta): EmittedFile[] {
  if (!meta.name || !KEBAB_CASE.test(meta.name)) {
    throw new EmitterError(
      `plugin name must be a non-empty kebab-case string: ${JSON.stringify(meta.name)}`,
      "PLUGIN_META_INVALID",
    );
  }
  if (!meta.version || !SEMVER_SHAPE.test(meta.version)) {
    throw new EmitterError(
      `plugin version must be a non-empty SemVer-shaped string: ${JSON.stringify(meta.version)}`,
      "PLUGIN_META_INVALID",
    );
  }
  if (!meta.author) {
    throw new EmitterError(
      "plugin author must be non-empty; an installable plugin needs an owner",
      "PLUGIN_META_INVALID",
    );
  }

  const marketplaceDescription = meta.marketplaceDescription ?? meta.description;

  // Literal construction order IS the serialized key order (07 §3.4) — mirrors the
  // feature-forge reference shapes (07 §2/§3.3).
  const pluginJson = {
    name: meta.name,
    version: meta.version,
    description: meta.description,
    author: { name: meta.author },
    keywords: [...meta.keywords],
  };

  const marketplaceJson = {
    name: meta.name,
    description: marketplaceDescription,
    owner: { name: meta.author },
    plugins: [
      {
        name: meta.name,
        source: ".",
        description: meta.description,
        version: meta.version,
      },
    ],
  };

  return [
    {
      relpath: ".claude-plugin/plugin.json",
      content: strictJson(pluginJson),
      mode: 0o644,
    },
    {
      relpath: ".claude-plugin/marketplace.json",
      content: strictJson(marketplaceJson),
      mode: 0o644,
    },
  ];
}
