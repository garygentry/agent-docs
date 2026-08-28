/**
 * DocPlan → Mintlify `docs.json navigation` adapter (skills/doc-site/references/mintlify/
 * docplan-adapter.md + api-docs.md).
 *
 * The Mintlify twin of the Starlight content-plan adapter. When a `content-architect`
 * DocPlan is present, its `grouping` + `documents` translate to `navigation` directly:
 * a DocPlan section is a Mintlify group (both are explicit ordered lists, so no
 * slug-first-segment rewrite is needed — contrast Starlight, docplan-adapter.md §1).
 *
 * The mapping is deterministic and order-preserving end-to-end (grouping order → group
 * order; `section.documents` order → page order). It handles the two Mintlify-unique
 * shapes Starlight's sidebar cannot express: `scope: both` / multi-family plans render as
 * tabs (§3), and an OpenAPI source renders as a spec-driven tab with NO page stubs
 * (api-docs.md). This is the executable form of the agent reference — the pure adapter
 * logic, unit-tested in isolation like the interview/section builders.
 */
import {
  type NavSection,
  type NavTab,
  type Navigation,
  buildNavigationFromSections,
  buildTabbedNavigation,
} from "./navigation.js";

/** A DocPlan document entry (the subset the nav adapter reads; docplan-adapter.md §2). */
export interface DocPlanEntry {
  readonly id: string;
  /** Explicit page path (wins). */
  readonly slug?: string;
  /** Source path — slugified (sans extension) when no explicit slug. */
  readonly path?: string;
  readonly title?: string;
  readonly type?: string;
}

/** A DocPlan grouping section: an ordered title + document-id list, tagged by family (§3). */
export interface DocPlanSection {
  readonly title: string;
  readonly documents: ReadonlyArray<string>;
  /** `diataxis` → Documentation tab; `architecture` → Architecture tab (§3). */
  readonly family?: string;
}

/** A DocPlan source; only `type: "api"` (an OpenAPI/AsyncAPI spec) affects the nav. */
export interface DocPlanSource {
  readonly type: string;
  readonly path: string;
}

/** The DocPlan subset the Mintlify nav adapter consumes. */
export interface DocPlan {
  readonly scope?: string;
  readonly grouping: ReadonlyArray<DocPlanSection>;
  readonly documents: ReadonlyArray<DocPlanEntry>;
  readonly sources?: ReadonlyArray<DocPlanSource>;
  /** Interview M3 opt-in; an API tab is emitted only when a `type: api` source is ALSO present. */
  readonly apiDocs?: boolean;
  /** Force tabbed output even for a single family. */
  readonly scopeTabs?: boolean;
}

/** Mintlify-form page path: POSIX, lowercase, no extension, no leading slash (§2). */
export function slugifyPath(raw: string): string {
  return raw
    .replace(/\.[^./]+$/, "") // drop a file extension
    .replace(/^\/+/, "") // drop a leading slash
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, ""))
    .filter((seg) => seg.length > 0) // drop segments that reduced to empty (no `//` or empty path)
    .join("/");
}

/** entry.slug ?? slugify(path sans ext) ?? slugify(id) — docplan-adapter.md §2 step 2. */
function pagePath(entry: DocPlanEntry): string {
  if (entry.slug) return entry.slug.replace(/^\/+/, "");
  if (entry.path) return slugifyPath(entry.path);
  return slugifyPath(entry.id);
}

/** "architecture" family → the Architecture tab; everything else → Documentation (§3). */
function tabLabelFor(family: string | undefined): string {
  return family === "architecture" ? "Architecture" : "Documentation";
}

/**
 * Resolve one grouping section to a NavSection, mapping its document ids to page paths.
 * `seen` is the NAV-WIDE set of already-claimed page paths (§2 step 2: collisions are
 * de-duped "within the nav", not per-section) — a colliding path gets a `-2`/`-3` suffix
 * so it never reaches the validator as a hard `duplicate-nav-page`.
 */
function toNavSection(
  section: DocPlanSection,
  byId: Map<string, DocPlanEntry>,
  seen: Set<string>,
): NavSection {
  const pages: string[] = [];
  for (const id of section.documents) {
    const entry = byId.get(id);
    if (!entry) continue; // an id with no backing document is dropped (validation owns the error)
    const base = pagePath(entry);
    let path = base;
    let n = 2;
    while (seen.has(path)) path = `${base}-${n++}`;
    seen.add(path);
    pages.push(path);
  }
  return { title: section.title, pages };
}

/**
 * Build the `navigation` object for a DocPlan. Emits the flat `groups` form for a single
 * family, `tabs` when the plan is multi-family (`scope: both`, `scopeTabs`, or ≥2 distinct
 * families), and appends a spec-driven "API reference" tab when `apiDocs` is on AND a
 * `type: api` source is present (promoting a flat plan into a "Documentation" tab beside
 * it, api-docs.md).
 */
export function buildNavigationFromDocPlan(plan: DocPlan): Navigation {
  const byId = new Map(plan.documents.map((d) => [d.id, d]));
  // One nav-wide `seen` threaded across every section so collisions de-dup across
  // sections/tabs, not just within one section (finding: cross-section duplicate → hard fail).
  const seen = new Set<string>();
  const sections = plan.grouping.map((s) => toNavSection(s, byId, seen));

  const apiSource = plan.apiDocs ? plan.sources?.find((s) => s.type === "api") : undefined;
  const families = new Set(plan.grouping.map((s) => tabLabelFor(s.family)));
  const multiFamily = plan.scope === "both" || plan.scopeTabs === true || families.size >= 2;

  // The API tab is additive — its presence forces tabbed output (api-docs.md "Interaction").
  if (!multiFamily && !apiSource) {
    return buildNavigationFromSections(sections);
  }

  // Group sections into tabs by family, preserving first-seen tab order.
  const tabOrder: string[] = [];
  const byTab = new Map<string, NavSection[]>();
  plan.grouping.forEach((section, i) => {
    const label = multiFamily ? tabLabelFor(section.family) : "Documentation";
    if (!byTab.has(label)) {
      byTab.set(label, []);
      tabOrder.push(label);
    }
    byTab.get(label)!.push(sections[i]!);
  });

  const docTabs = tabOrder.map((label) => ({ tab: label, sections: byTab.get(label)! }));
  const nav = buildTabbedNavigation(docTabs);

  if (!apiSource) return nav;
  const apiTab: NavTab = { tab: "API reference", openapi: apiSource.path };
  return { tabs: [...(nav.tabs ?? []), apiTab] };
}
