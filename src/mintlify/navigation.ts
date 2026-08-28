/**
 * DocPlan / interview → Mintlify `docs.json` `navigation` builder.
 *
 * The Mintlify analogue of the Starlight `buildSidebar` (skills/doc-site/references/
 * core.md §2.3) and the content-plan adapter. Two entry points, mirroring the two ways
 * doc-site sources its IA:
 *
 *  - {@link buildNavigationFromSections} — the DocPlan-driven path: an explicit ordered
 *    list of sections (grouping) maps 1:1 onto Mintlify `navigation.groups`. No slug
 *    normalization is needed because Mintlify groups are explicit (contrast Starlight,
 *    whose groups are implicit in the slug's first segment).
 *  - {@link buildNavigationFromPages} — the interview fallback: a flat, ordered page list
 *    is grouped by the slug's first POSIX segment exactly like `buildSidebar`, but the
 *    leaves are bare page-path strings (Mintlify form) rather than `{label, slug}`.
 *
 * All page paths are Mintlify form: root-relative, POSIX, NO file extension and NO
 * leading slash (e.g. `guides/setup`). Order is preserved end-to-end.
 */

/** A Mintlify nav item: either a page path (string) or a nested group. */
export type NavItem = string | NavGroup;

/** A Mintlify navigation group (docs.json navigation.groups[] / nested). */
export interface NavGroup {
  readonly group: string;
  readonly pages: ReadonlyArray<NavItem>;
}

/** A Mintlify navigation tab (docs.json navigation.tabs[]). */
export interface NavTab {
  readonly tab: string;
  readonly groups: ReadonlyArray<NavGroup>;
}

/**
 * A Mintlify `navigation` object. Exactly one of `pages` / `groups` / `tabs` is present
 * at this level, matching Mintlify's navigation schema (navigation.md).
 */
export interface Navigation {
  readonly pages?: ReadonlyArray<NavItem>;
  readonly groups?: ReadonlyArray<NavGroup>;
  readonly tabs?: ReadonlyArray<NavTab>;
}

/** A manifest-style page for the interview fallback (only `slug`/`unmanaged` matter here). */
export interface NavSourcePage {
  readonly slug: string;
  readonly unmanaged?: boolean;
}

/** An explicit DocPlan section: a group title + its ordered page paths. */
export interface NavSection {
  readonly title: string;
  readonly pages: ReadonlyArray<string>;
}

/** "getting-started" → "Getting Started" (mirror of core.md §2.3 titleize). */
export function titleize(segment: string): string {
  return segment
    .split("-")
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Interview fallback: build a `navigation.pages` array from an ordered page list,
 * grouping by the slug's first POSIX segment (buildSidebar semantics). A single-segment
 * slug becomes a top-level page string; a multi-segment slug is grouped under a
 * titleized first segment. `unmanaged` pages are skipped. Manifest order = nav order.
 */
export function buildNavigationFromPages(pages: ReadonlyArray<NavSourcePage>): Navigation {
  const items: NavItem[] = [];
  const groupIndex = new Map<string, string[]>(); // first segment → the mutable pages array of its group

  for (const page of pages) {
    if (page.unmanaged) continue;
    const segments = page.slug.split("/");
    if (segments.length === 1) {
      items.push(page.slug); // top-level page
      continue;
    }
    const key = segments[0]!;
    let groupPages = groupIndex.get(key);
    if (!groupPages) {
      groupPages = [];
      groupIndex.set(key, groupPages);
      items.push({ group: titleize(key), pages: groupPages }); // first occurrence fixes order
    }
    groupPages.push(page.slug);
  }

  // Choose the idiomatic top-level decorator: when every item is a group (no loose
  // top-level page), use `groups` — the documented grouped form. When any bare page
  // sits at the top level, use `pages` (whose items may be strings or nested groups).
  const hasTopLevelPage = items.some((i) => typeof i === "string");
  return hasTopLevelPage ? { pages: items } : { groups: items as NavGroup[] };
}

/**
 * DocPlan-driven: map an explicit ordered section list directly onto
 * `navigation.groups`. 1:1 — section order → group order, page order preserved. The
 * group label is the section title verbatim (sentence-case preserved from the DocPlan).
 */
export function buildNavigationFromSections(sections: ReadonlyArray<NavSection>): Navigation {
  return {
    groups: sections.map((s) => ({ group: s.title, pages: [...s.pages] })),
  };
}

/**
 * DocPlan `scope: both` (or multi-audience): render tabs — a structure Starlight's
 * sidebar cannot express. Each tab carries its own ordered section list.
 */
export function buildTabbedNavigation(
  tabs: ReadonlyArray<{ readonly tab: string; readonly sections: ReadonlyArray<NavSection> }>,
): Navigation {
  return {
    tabs: tabs.map((t) => ({
      tab: t.tab,
      groups: t.sections.map((s) => ({ group: s.title, pages: [...s.pages] })),
    })),
  };
}

/** Every page path referenced anywhere in a navigation object, in document order. */
export function collectNavPagePaths(nav: Navigation): string[] {
  const out: string[] = [];
  const visitItems = (items: ReadonlyArray<NavItem>): void => {
    for (const item of items) {
      if (typeof item === "string") out.push(item);
      else visitItems(item.pages);
    }
  };
  const visitGroups = (groups: ReadonlyArray<NavGroup>): void => {
    for (const g of groups) visitItems(g.pages);
  };
  if (nav.pages) visitItems(nav.pages);
  if (nav.groups) visitGroups(nav.groups);
  if (nav.tabs) for (const t of nav.tabs) visitGroups(t.groups);
  return out;
}
