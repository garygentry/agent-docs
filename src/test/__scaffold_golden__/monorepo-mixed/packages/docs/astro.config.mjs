// astro.config.mjs — emitted into packages/docs/
// MANAGED by doc-site (tracked in .doc-site-scaffold.json). The `sidebar`
// array is generated from docs.manifest.json — edit the manifest, not this file.
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // REQ-CORE-02: derive site/base from env so the SAME build works on a hosted
  // subpath (GitHub Pages, BASE_PATH="/repo/") and at root (Vercel/static,
  // BASE_PATH unset) with no code changes. Both are undefined-safe: Astro treats
  // an undefined `base` as "/" and an undefined `site` as a relative build.
  site: process.env.SITE,
  base: process.env.BASE_PATH,
  // REQ-CORE-03: SVG diagrams need no rasterization; the passthrough image
  // service serves them as-is and keeps the install free of the Sharp dependency.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "Widget Monorepo Docs",
      description: "Documentation for the Widget monorepo.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/widget-co/widget" },
      ],
      // <<SIDEBAR>> — replaced by the array generated in §7 from docs.manifest.json.
      // REQ-CONTENT-03: single source of truth; never hand-kept in parallel.
      sidebar: [
        { label: "Intro", slug: "intro" },
        {
          label: "Api",
          items: [
            { label: "Reference", slug: "api/reference" },
          ],
        },
        { label: "About", slug: "about" },
        {
          label: "Guides",
          items: [
            { label: "Setup", slug: "guides/setup" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
