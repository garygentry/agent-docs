/**
 * Structural validation of an emitted Mintlify `docs.json` (the pre-wiring check from
 * skills/doc-site/references/mintlify/docs-json.md §validate).
 *
 * This is intentionally a LIGHT structural check — not a re-implementation of Mintlify's
 * evolving JSON schema (that is owned by the hosted `$schema` + `mint validate` at the
 * Phase 6 smoke test). It catches the defects doc-site can introduce itself: a nav page
 * path with no backing file, a duplicate page path, or a missing required key. A
 * violation is a `SCHEMA_VIOLATION` — the emitter must reject before writing further.
 */
import { type Navigation, collectNavPagePaths, collectOpenapiSpecs } from "./navigation.js";

/** The subset of docs.json this validator inspects. */
export interface DocsJson {
  readonly theme?: unknown;
  readonly name?: unknown;
  readonly colors?: { readonly primary?: unknown } & Record<string, unknown>;
  readonly navigation?: Navigation;
  readonly [k: string]: unknown;
}

export interface ValidationError {
  readonly code:
    | "missing-required-key"
    | "duplicate-nav-page"
    | "unresolved-nav-page"
    | "empty-navigation";
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
}

/**
 * Validate a docs.json object.
 *
 * @param docs - the assembled docs.json.
 * @param pageFilePaths - the set of page paths (Mintlify form: root-relative, no
 *   extension, no leading slash) that WILL exist on disk after emit. Every nav page path
 *   must be a member. Pass an empty set to skip resolution checks (structure-only).
 */
export function validateDocsJson(
  docs: DocsJson,
  pageFilePaths: ReadonlySet<string> = new Set(),
): ValidationResult {
  const errors: ValidationError[] = [];

  // Required keys (docs-json.md): theme, name, colors.primary, navigation.
  for (const key of ["theme", "name"] as const) {
    if (docs[key] === undefined || docs[key] === "") {
      errors.push({ code: "missing-required-key", message: `docs.json is missing "${key}"` });
    }
  }
  if (docs.colors?.primary === undefined || docs.colors.primary === "") {
    errors.push({ code: "missing-required-key", message: `docs.json is missing "colors.primary"` });
  }
  if (docs.navigation === undefined) {
    errors.push({ code: "missing-required-key", message: `docs.json is missing "navigation"` });
    return { ok: false, errors };
  }

  const paths = collectNavPagePaths(docs.navigation);
  // A nav is non-empty if it references pages OR points at an OpenAPI spec (whose
  // endpoint pages Mintlify generates — a spec-only tab has zero page paths, api-docs.md).
  if (paths.length === 0 && collectOpenapiSpecs(docs.navigation).length === 0) {
    errors.push({
      code: "empty-navigation",
      message: "docs.json navigation references no pages",
    });
  }

  // Duplicate page path across the whole nav (Mintlify renders one page per path).
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) {
      errors.push({ code: "duplicate-nav-page", message: `navigation page "${p}" appears twice` });
    }
    seen.add(p);
  }

  // Every nav page must resolve to a page file that will exist (when a set is supplied).
  if (pageFilePaths.size > 0) {
    for (const p of paths) {
      if (!pageFilePaths.has(p)) {
        errors.push({
          code: "unresolved-nav-page",
          message: `navigation page "${p}" has no backing file`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
