// rehype-base-links.mjs — make internal content links work on the deployed site.
//
// Astro/Starlight does NOT rewrite links written in Markdown/MDX content, so two
// classes of internal link break on deploy and this plugin fixes both:
//
//  1. Root-absolute links (`[x](/start-here/install/)`) — Astro does not apply
//     the configured `base`, so on a subpath deploy (GitHub Pages,
//     base="/repo/") they 404. We prepend the base. No-op at root.
//
//  2. Relative `.md` links in dual-context docs (`[x](./cli-reference.md)`,
//     `[x](../cli-reference.md)`) — these live in repo docs that ALSO render on
//     GitHub, where the relative `.md` form is correct, so we can't change the
//     source. On the Starlight site they 404 (the `.md` extension plus dir-style
//     trailing-slash URLs break browser-relative resolution). We rewrite them to
//     absolute, base-aware page slugs. This applies at root deploys too.
//
// stdlib-only / zero-dependency hast walker, matching the docs-package
// convention (see check-docs.mjs).

const CONTENT_MARKER = "/src/content/docs/";

// Attributes that carry navigable URLs we want to fix.
const URL_ATTRS = { a: "href", area: "href", img: "src", source: "src" };

/** Normalize a base so it is "" (no-op) or "/prefix" with no trailing slash. */
function normalizeBase(base) {
  if (!base || base === "/") return "";
  return ("/" + base.replace(/^\/+/, "").replace(/\/+$/, "")).replace(/\/+/g, "/");
}

/** Join a normalized base with a root-absolute URL, collapsing the seam slash. */
function joinBase(base, url) {
  return (base + url).replace(/\/{2,}/g, "/");
}

/** Split an href into [pathPart, suffix] where suffix is `#anchor`/`?query`. */
function splitSuffix(href) {
  const i = href.search(/[#?]/);
  return i === -1 ? [href, ""] : [href.slice(0, i), href.slice(i)];
}

/**
 * Slug of the page currently being processed, derived from its source path
 * within src/content/docs (e.g. ".../forge-bootstrap/overview.md" -> "forge-bootstrap/overview").
 * Returns null when the path can't be located (then relative rewriting is skipped).
 */
function currentSlug(file) {
  const path = (file && (file.path || (file.history && file.history[0]))) || "";
  const i = path.indexOf(CONTENT_MARKER);
  if (i === -1) return null;
  return path.slice(i + CONTENT_MARKER.length).replace(/\.mdx?$/, "");
}

/** POSIX-resolve `rel` (e.g. "./x", "../y/z") against directory `dir`. */
function resolveSlug(dir, rel) {
  const parts = dir === "" ? [] : dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  // README maps to the "overview" slug in setup-docs.sh; mirror that defensively.
  if (parts.length && parts[parts.length - 1] === "README") parts[parts.length - 1] = "overview";
  return parts.join("/");
}

/**
 * @param {{ base?: string }} [options]
 */
export default function rehypeBaseLinks(options = {}) {
  const base = normalizeBase(options.base);
  const prefix = base + "/"; // e.g. "/feature-forge/" or "/"

  return (tree, file) => {
    const slug = currentSlug(file);
    const dir = slug ? slug.replace(/\/?[^/]*$/, "") : null;

    const visit = (node) => {
      if (node.type === "element") {
        const attr = URL_ATTRS[node.tagName];
        const val = attr && node.properties ? node.properties[attr] : undefined;
        if (typeof val === "string") {
          // (1) root-absolute → prepend base
          if (base && val.startsWith("/") && !val.startsWith("//") && !(val === base || val === prefix || val.startsWith(prefix))) {
            node.properties[attr] = joinBase(base, val);
          } else if (dir !== null && node.tagName === "a" && /^\.\.?\//.test(val)) {
            // (2) relative internal link → absolute base-aware slug
            const [pathPart, suffix] = splitSuffix(val);
            if (/\.mdx?$/.test(pathPart)) {
              const target = resolveSlug(dir, pathPart.replace(/\.mdx?$/, ""));
              if (target) node.properties[attr] = joinBase(base, "/" + target + "/") + suffix;
            }
          }
        }
      }
      if (node.children) for (const child of node.children) visit(child);
    };

    visit(tree);
  };
}
