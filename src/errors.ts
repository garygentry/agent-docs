import type { DriftEntry } from "./model.js";

/**
 * Error hierarchy for the emitter (00 §4). Every error extends a single base
 * carrying a stable, machine-checkable `code`; `name` always equals the concrete
 * class name. Mirrors feature-forge's `CanonError` hierarchy and rauf's
 * `errors.ts` convention.
 *
 * Note — stale overrides are deliberately NOT an error: there is no
 * `OverrideConflictError`. A stale override is a non-fatal warning surfaced via
 * `ReportModel.staleOverrides`.
 */

/** Base for every emitter error. `code` is stable and machine-checkable. */
export class EmitterError extends Error {
  /**
   * @param message Human-readable message.
   * @param code Stable, machine-checkable error code.
   */
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** tools.manifest.json failed Zod validation. Carries the formatted issue list. */
export class ManifestValidationError extends EmitterError {
  /**
   * @param message Human-readable message.
   * @param issues One formatted string per Zod issue (path + message).
   */
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message, "MANIFEST_INVALID");
  }
}

/** A canonical file has unparseable or schema-invalid frontmatter. */
export class MalformedFrontmatterError extends EmitterError {
  /**
   * @param message Human-readable message.
   * @param sourcePath Repo-relative POSIX path of the offending source.
   */
  constructor(
    message: string,
    readonly sourcePath: string,
  ) {
    super(message, "FRONTMATTER_MALFORMED");
  }
}

/** A manifest entry's `source` path does not exist on disk. */
export class SourceNotFoundError extends EmitterError {
  /**
   * @param message Human-readable message.
   * @param sourcePath Repo-relative POSIX path that was not found.
   */
  constructor(
    message: string,
    readonly sourcePath: string,
  ) {
    super(message, "SOURCE_NOT_FOUND");
  }
}

/** A source/override path resolves outside the allowed roots (REQ-SEC-01). Fatal. */
export class PathEscapeError extends EmitterError {
  /**
   * @param message Human-readable message.
   * @param attemptedPath The path that escaped its confinement root.
   */
  constructor(
    message: string,
    readonly attemptedPath: string,
  ) {
    super(message, "PATH_ESCAPE");
  }
}

/** `build --check` found drift. Carries typed per-file entries (REQ-OBS-02). */
export class DriftError extends EmitterError {
  /**
   * @param message Human-readable message.
   * @param entries Typed per-file drift entries.
   */
  constructor(
    message: string,
    readonly entries: DriftEntry[],
  ) {
    super(message, "DRIFT_DETECTED");
  }
}
