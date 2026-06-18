/**
 * Public barrel for the emitter (01 §5). Re-exports the core model and error
 * hierarchy plus the top-level entry functions and the packaging export, enabling
 * programmatic reuse from another repo (REQ-REUSE-01).
 */

export * from "./errors.js"; // 00 §4 error hierarchy
export * from "./model.js"; // 00 §2–3 types + Zod schemas + constants
export { loadManifest } from "./manifest.js"; // (manifestPath) => Manifest
export { emit } from "./emit.js"; // (Manifest, roots) => EmitResult
export { driftCheck } from "./driftguard.js"; // (Manifest, roots) => DriftEntry[]
export { emitPlugin } from "./plugin.js"; // (07) emit .claude-plugin/ manifests
export type { PluginMeta } from "./plugin.js"; // (07) plugin manifest metadata
