import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// Title-injection shim (doc-site, contentMode symlink/mixed + titleShim).
//
// Symlinked source docs are written for GitHub: they start with a `# H1` and have
// NO YAML frontmatter. Starlight's docsSchema() requires `title:`, read at LOAD
// time (before remark), so a frontmatter-less page hard-fails the build with
// `InvalidContentEntryDataError: title: Required`. This loader wraps the stock
// docsLoader() and, for any entry that has no title, fills it from the first `# H1`
// (falling back to a slug-derived title) BEFORE schema validation — so the source
// docs stay pristine for GitHub. The schema is left untouched for maximum
// version-stability across the Astro 5 / Starlight 0.36 and Astro 6 / 0.40 lines;
// the only version-sensitive surface is store.entries()/store.set()/entry.body,
// which are stable content-layer APIs. (Verified by the Phase-6 build smoke test
// against the target repo's actual Astro line.)
function titleInjectingLoader() {
  const base = docsLoader();
  return {
    ...base,
    name: "doc-site-title-loader",
    async load(context) {
      await base.load(context);
      for (const [id, entry] of context.store.entries()) {
        if (entry.data?.title) continue;
        const body = typeof entry.body === "string" ? entry.body : "";
        const h1 = body.match(/^\s{0,3}#\s+(.+?)\s*$/m)?.[1];
        const fallback = (id.split("/").pop() || id)
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        context.store.set({ ...entry, data: { ...entry.data, title: h1 ?? fallback } });
      }
    },
  };
}

export const collections = {
  docs: defineCollection({ loader: titleInjectingLoader(), schema: docsSchema() }),
};
