#!/usr/bin/env bun
/**
 * gen-resvg-wasm.ts — regenerate `resvg-wasm.ts` from the installed package.
 *
 * Reads `node_modules/@resvg/resvg-wasm/index_bg.wasm`, base64-encodes it, and
 * writes `src/diagram/assets/resvg-wasm.ts` (the inlined WASM asset consumed by
 * `png.ts`, 04 §4.1). Run after bumping the pinned `@resvg/resvg-wasm` version,
 * then re-run `bun run build:diagram` and commit both.
 *
 * Usage:  bun run src/diagram/assets/gen-resvg-wasm.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const wasmPath = resolve(repoRoot, "node_modules/@resvg/resvg-wasm/index_bg.wasm");
const outPath = resolve(repoRoot, "src/diagram/assets/resvg-wasm.ts");

const b64 = readFileSync(wasmPath).toString("base64");

const contents = `/**
 * Generated asset (do NOT hand-edit).
 *
 * The @resvg/resvg-wasm@2.6.2 WebAssembly module (\`index_bg.wasm\`) embedded as a
 * base64 string and decoded to a \`Uint8Array\` at load. Imported by \`png.ts\` (04 §4.1)
 * so the committed CLI bundle inlines the resvg engine and stays fully self-contained
 * — no native \`.node\` addon, no runtime fetch (REQ-OUT-04).
 *
 * Regenerate after bumping @resvg/resvg-wasm:
 *   bun run src/diagram/assets/gen-resvg-wasm.ts
 */
const RESVG_WASM_BASE64 =
  "${b64}";

/** The resvg WASM module bytes, ready to pass to \`initWasm\`. */
export const RESVG_WASM_BYTES: Uint8Array = Uint8Array.from(
  globalThis.Buffer
    ? globalThis.Buffer.from(RESVG_WASM_BASE64, "base64")
    : atob(RESVG_WASM_BASE64)
        .split("")
        .map((c) => c.charCodeAt(0)),
);
`;

writeFileSync(outPath, contents);
console.log(`wrote ${outPath} (${(b64.length / 1024 / 1024).toFixed(2)} MB base64)`);
