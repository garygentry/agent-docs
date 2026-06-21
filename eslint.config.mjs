import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: [
    "dist/",
    "adapters/",
    "**/*.mjs",
    "src/diagram/__bundle_golden__/",
    // Resolved scaffold goldens (10 §5) are deterministic emitter output pinned by
    // doc-site-scaffold.test.ts, not hand-authored source — they include resolved
    // .ts/.json files that must not be linted.
    "src/test/__scaffold_golden__/",
  ],
});
