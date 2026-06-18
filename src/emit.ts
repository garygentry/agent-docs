import type { ResolvedRoots } from "./config.js";
import { discover } from "./discover.js";
import type { SharedFile } from "./discover.js";
import { TARGET_ORDER } from "./model.js";
import type {
  DropRecord,
  EmitResult,
  EmittedFile,
  Manifest,
  ManifestEntry,
  Target,
  VerbatimRecord,
} from "./model.js";
import { skillVerbatimRecords } from "./targets/_shared.js";
import type { TransformOutput } from "./targets/_shared.js";
import { TRANSFORMS } from "./targets/index.js";

/**
 * Project identity threaded into aggregate manifests (07 §3.2). Only gemini's
 * `aggregateManifest` consumes it; other targets ignore it. Sourced from
 * `PluginMeta` (package.json) by the CLI (item 020); `emit` accepts it as a
 * parameter so it never reads disk for identity.
 */
export interface EmitIdentity {
  /** Project / plugin name. */
  name: string;
  /** Project / plugin version. */
  version: string;
}

/**
 * Fallback identity used when a caller does not thread one through (e.g. unit
 * tests). The CLI always passes the resolved {@link PluginMeta} identity.
 */
const DEFAULT_IDENTITY: EmitIdentity = { name: "agent-docs-scaffold", version: "0.0.0" };

/** Stable ascending sort on a `name` field (UTF-16 code-unit order). */
function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Transform every discovered record for every target and aggregate the results
 * into a single {@link EmitResult} (04/05 §1). This is the in-memory heart of the
 * build:
 *
 * 1. `discover()` (007) parses the canonical sources into typed records.
 * 2. For each {@link Target} in {@link TARGET_ORDER} (deterministic), look up its
 *    {@link TargetTransform} in the registry (008) and run
 *    `transformSkill`/`transformAgent`/`transformCommand` over the records.
 * 3. Collect every {@link EmittedFile}, {@link DropRecord} and
 *    {@link ManifestEntry}; per target, feed the (name-sorted) entries to
 *    `aggregateManifest` (passing the gemini `identity`), and assemble
 *    {@link VerbatimRecord}s for skill-owned refs plus the shared
 *    references/scripts trees.
 *
 * Every relpath returned by a transform is **target-bundle-relative**; `emit`
 * re-bases it to **adapter-root-relative** (`<target>/<relpath>`, 05 §2) so the
 * downstream override overlay and publish address files uniformly.
 *
 * `emit` is **pure and in-memory** (REQ-EMIT-06): it writes nothing to disk and
 * applies no overrides — `overridden` is always empty here. Override overlay (014)
 * and atomic disk publish (015) are separate downstream steps that consume this
 * result.
 *
 * @param manifest  The validated manifest (003).
 * @param roots     Resolved absolute roots (004).
 * @param identity  Aggregate-manifest identity (07 §3.2); defaults to a stub when
 *                  omitted (the CLI always supplies the real PluginMeta identity).
 * @returns The aggregated in-memory emit result.
 */
export function emit(
  manifest: Manifest,
  roots: ResolvedRoots,
  identity: EmitIdentity = DEFAULT_IDENTITY,
): EmitResult {
  const discovery = discover(manifest, roots);
  const sharedFiles: SharedFile[] = [...discovery.sharedRefs, ...discovery.sharedScripts];

  const files: EmittedFile[] = [];
  const drops: DropRecord[] = [];
  const manifestEntries: ManifestEntry[] = [];
  const verbatim: VerbatimRecord[] = [];

  for (const target of TARGET_ORDER) {
    const transform = TRANSFORMS[target];
    const prefix = (relpath: string): string => `${target}/${relpath}`;
    const entries: ManifestEntry[] = [];

    const collect = (out: TransformOutput): void => {
      for (const f of out.files) files.push({ ...f, relpath: prefix(f.relpath) });
      drops.push(...out.drops);
      entries.push(...out.manifestEntries);
    };

    // Skills (sorted by sourcePath upstream) — transform + skill-owned verbatim refs.
    for (const skill of discovery.skills) {
      collect(transform.transformSkill(skill));
      for (const v of skillVerbatimRecords(skill, target)) {
        verbatim.push({ relpath: prefix(v.relpath), sourcePath: v.sourcePath });
      }
    }
    for (const agent of discovery.agents) collect(transform.transformAgent(agent));
    for (const command of discovery.commands) collect(transform.transformCommand(command));

    // Shared references/scripts copied verbatim into every adapter (03 §3.6),
    // preserving their repo-relative subpath under the target bundle.
    for (const sf of sharedFiles) {
      verbatim.push({ relpath: prefix(sf.sourcePath), sourcePath: sf.sourcePath });
    }

    // Aggregate manifest (codex openai.yaml / gemini-extension.json) from this
    // target's entries, pre-sorted by name (REQ-EMIT-06). identity is threaded
    // through for gemini; other targets ignore it / return null.
    const sortedEntries = entries.slice().sort(byName);
    const aggregate = transform.aggregateManifest(sortedEntries, identity);
    if (aggregate) files.push({ ...aggregate, relpath: prefix(aggregate.relpath) });
    manifestEntries.push(...sortedEntries);
  }

  return { files, drops, manifestEntries, overridden: [], verbatim };
}
