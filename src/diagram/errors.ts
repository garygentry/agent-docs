import { EXIT_CODES, type DiagramErrorCode } from "./schema.js";

/**
 * The typed error hierarchy for the diagram-generator skill (00 §5). Every
 * failure carries a stable `code`, maps to a process `exitCode` via `EXIT_CODES`
 * (imported from `schema.ts`), and may carry a `detail` (a JSON path or failed
 * assertion name). The CLI catches `DiagramError`, prints `message` to stderr,
 * and exits with `exitCode`. No partial artifact is ever written (REQ-REL-01/02).
 */

export type { DiagramErrorCode } from "./schema.js";

/**
 * Base class for every diagram-generator failure. `code` is machine-stable;
 * `exitCode` is what the CLI returns; `detail` carries context (a JSON path, a
 * failed assertion name) included in the stderr message.
 */
export class DiagramError extends Error {
  /** Stable, machine-readable code. */
  readonly code: DiagramErrorCode;
  /** Process exit code the CLI returns for this error (see EXIT_CODES). */
  readonly exitCode: number;
  /** Optional context (offending path, assertion name) for the operator. */
  readonly detail?: string;

  constructor(code: DiagramErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "DiagramError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
    this.detail = detail;
  }
}

/** Input failed Zod parse or cross-field validation (REQ-REL-02). */
export class DiagramInputError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("INPUT_INVALID", message, detail);
    this.name = "DiagramInputError";
  }
}

/** The engine (Graphviz-WASM or sequence layout) failed to produce SVG. */
export class DiagramRenderError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("RENDER_FAILED", message, detail);
    this.name = "DiagramRenderError";
  }
}

/** Post-render output assertions failed (tier-2 / viewBox / font / a11y). */
export class DiagramOutputError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("OUTPUT_INVALID", message, detail);
    this.name = "DiagramOutputError";
  }
}

/** PNG rasterization via resvg failed (REQ-OUT-03). */
export class DiagramPngError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("PNG_FAILED", message, detail);
    this.name = "DiagramPngError";
  }
}

/** A filesystem write failed or attempted to escape the caller's path (REQ-SEC-01). */
export class DiagramIoError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("IO_ERROR", message, detail);
    this.name = "DiagramIoError";
  }
}

/** Invalid CLI usage (unknown flag, missing input, conflicting paths). */
export class DiagramUsageError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("USAGE_ERROR", message, detail);
    this.name = "DiagramUsageError";
  }
}
