// sidebar.mjs — emitted into site/
// MANAGED by doc-site (tracked in .doc-site-scaffold.json). Pure, dependency-free
// derivation of the Starlight sidebar from docs.manifest.json `pages[]`. It is
// imported by astro.config.mjs and evaluated at BUILD TIME, so the sidebar can
// never drift from the manifest — there is no parallel array to keep in sync.
// Adding a page is a one-line manifest edit; the sidebar follows automatically.
// Edit the manifest, not this file.

/** "getting-started" → "Getting Started". */
function titleize(segment) {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build the Starlight `sidebar` array from manifest pages, preserving manifest
 * order (= sidebar order). Pages are grouped by their slug's first POSIX path
 * segment; single-segment slugs become top-level leaves. `unmanaged` pages are
 * skipped (the generator owns no sidebar entry for them); the home splash
 * (index.mdx) is never a manifest page and so is never included.
 *
 * Optional per-page overrides (default to the titleized slug segments, so a
 * manifest that omits them yields the historical titleized labels unchanged):
 *   - `label` — overrides the leaf's displayed label
 *   - `group` — overrides the group's displayed label (multi-segment slugs only;
 *     the first page in a group that sets it wins)
 *
 * @param {Array<{slug: string, label?: string, group?: string, unmanaged?: boolean}>} pages
 * @returns {Array<{label: string, slug: string} | {label: string, items: Array<{label: string, slug: string}>}>}
 */
export function buildSidebar(pages) {
  const result = [];
  const groupIndex = new Map(); // first slug segment → group node
  for (const page of pages ?? []) {
    if (page.unmanaged) continue; // source does not affect the sidebar; only unmanaged excludes
    const segments = page.slug.split("/");
    const leaf = {
      label: page.label ?? titleize(segments[segments.length - 1]),
      slug: page.slug,
    };
    if (segments.length === 1) {
      result.push(leaf); // top-level page
      continue;
    }
    const key = segments[0];
    let group = groupIndex.get(key);
    if (!group) {
      group = { label: page.group ?? titleize(key), items: [] };
      groupIndex.set(key, group); // first occurrence fixes group order + label
      result.push(group);
    }
    group.items.push(leaf);
  }
  return result;
}
