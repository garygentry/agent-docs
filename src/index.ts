/**
 * Public barrel for the emitter. Re-exports the core model and error hierarchy;
 * entry functions (loadManifest, emit, driftCheck, emitPlugin, …) are added by
 * later items (01 §5).
 */

export * from "./model.js";
export * from "./errors.js";
