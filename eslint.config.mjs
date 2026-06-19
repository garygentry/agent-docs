import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: ["dist/", "adapters/", "**/*.mjs", "src/diagram/__bundle_golden__/"],
});
