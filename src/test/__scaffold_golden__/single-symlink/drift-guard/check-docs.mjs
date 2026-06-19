#!/usr/bin/env node
// check-docs.mjs — docs drift guard for docs
// Emitted by doc-site (REQ-DRIFT-01/02). stdlib-only; runs on Node and Bun.
// Exit 0 = clean; exit 1 = drift findings; exit 2 = guard error (bad manifest, etc).
import { readFileSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, relative, resolve, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── (a) Path bootstrap ───────────────────────────────────────────
// The script lives in the docs-package root; all paths derive from here so the
// guard is location-independent (works under docs/, packages/docs/, docs-site/, …).
const DOCS_PKG_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(DOCS_PKG_DIR, "docs.manifest.json");
const ASTRO_CONFIG_PATH = join(DOCS_PKG_DIR, "astro.config.mjs");
const CONTENT_DIR = join(DOCS_PKG_DIR, "src", "content", "docs");
const CUSTOM_RULES_PATH = join(DOCS_PKG_DIR, "docs.drift.rules.mjs");
const REQUIRED_FRONTMATTER = ["title"]; // Starlight's minimum (see §4.4)
const rel = (p) => relative(DOCS_PKG_DIR, p);

// ── (b) Finding model + collector ────────────────────────────────
/**
 * @typedef {Object} Finding
 * @property {string} rule  - rule id, e.g. "broken-link" | "sidebar-parity" | "orphaned-symlink" | "missing-frontmatter" | custom
 * @property {string} file  - repo-relative path the finding is about ("" if not file-scoped)
 * @property {number|null} line - 1-based line number, or null if not line-scoped
 * @property {string} message - human-readable explanation of the drift
 */
/** @type {Finding[]} */
const findings = [];
/** @param {string} rule @param {string} file @param {number|null} line @param {string} message */
const report = (rule, file, line, message) =>
  findings.push({ rule, file: file ? rel(file) : "", line, message });

// ── (c) Manifest + page collection ───────────────────────────────
/** @typedef {{slug:string, source?:"symlink"|"native", from?:string, unmanaged?:boolean}} PageEntry */
function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`check-docs: docs.manifest.json not found at ${rel(MANIFEST_PATH)}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.error(`check-docs: docs.manifest.json is not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

// Manual recursive walk: statSync (not Dirent) so symlinked spec pages are
// followed and included (canon: "walk docs following symlinks"). Skip images/.
/** @param {string} dir @returns {string[]} */
function walkPages(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "images") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full); // follows symlinks; throws on a dangling link
    } catch {
      continue; // dangling links are handled by the orphaned-symlink rule (§4.3)
    }
    if (st.isDirectory()) out.push(...walkPages(full));
    else if (st.isFile() && /\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Map manifest pages by slug; precompute the managed/unmanaged partition (§4.5).
const manifest = loadManifest();
/** @type {PageEntry[]} */
const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
const managedPages = pages.filter((p) => p.unmanaged !== true);
const pageFiles = walkPages(CONTENT_DIR);

// ── (d) Built-in rules (§4) ──────────────────────────────────────

// §4.1 — Rule 1: broken internal links. Applies to all pages, incl. unmanaged.
function ruleBrokenInternalLinks(files) {
  const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const EXTERNAL_RE = /^(https?:|mailto:|tel:|#|\/\/|data:)/i;
  const resolvesOn = (p) => {
    try { statSync(p); return true; } catch { return false; }
  };
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      let m;
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(line)) !== null) {
        const raw = m[1];
        if (EXTERNAL_RE.test(raw)) continue;
        const target = raw.split("#")[0].split("?")[0];
        if (target === "") continue; // pure anchor already excluded
        const base = target.startsWith("/") ? CONTENT_DIR : dirname(file);
        const cleaned = target.startsWith("/") ? target.slice(1) : target;
        const abs = resolve(base, cleaned);
        if (resolvesOn(abs)) continue;
        // Slug-style fallback: foo -> foo.md / foo.mdx / foo/index.mdx
        const candidates = [`${abs}.md`, `${abs}.mdx`, join(abs, "index.md"), join(abs, "index.mdx")];
        if (candidates.some(resolvesOn)) continue;
        report("broken-link", file, i + 1, `broken internal link: \`${raw}\` (does not resolve)`);
      }
    });
  }
}

// §4.2 — Rule 2: sidebar↔manifest parity (managed pages only; unmanaged exempt).
function ruleSidebarManifestParity() {
  if (!existsSync(ASTRO_CONFIG_PATH)) {
    report("sidebar-parity", ASTRO_CONFIG_PATH, null, "astro.config.mjs not found; cannot verify sidebar");
    return;
  }
  const norm = (s) => s.replace(/^\/+|\/+$/g, "");
  const expected = managedPages.map((p) => norm(p.slug));
  const unmanagedSlugs = new Set(pages.filter((p) => p.unmanaged === true).map((p) => norm(p.slug)));
  const cfg = readFileSync(ASTRO_CONFIG_PATH, "utf8");
  const SLUG_RE = /\b(?:slug|link):\s*["'`]([^"'`]+)["'`]/g;
  const sidebar = [];
  let m;
  while ((m = SLUG_RE.exec(cfg)) !== null) sidebar.push(norm(m[1]));
  const sidebarSet = new Set(sidebar);
  for (const slug of expected) {
    if (!sidebarSet.has(slug)) report("sidebar-parity", ASTRO_CONFIG_PATH, null, `manifest slug '${slug}' missing from sidebar`);
  }
  const expectedSet = new Set(expected);
  for (const slug of sidebar) {
    if (!expectedSet.has(slug) && !unmanagedSlugs.has(slug))
      report("sidebar-parity", ASTRO_CONFIG_PATH, null, `sidebar slug '${slug}' not in manifest`);
  }
  // Order check (managed slugs only), once the sets agree.
  const sidebarManaged = sidebar.filter((s) => expectedSet.has(s));
  if (sidebarManaged.length === expected.length && sidebarManaged.some((s, i) => s !== expected[i]))
    report("sidebar-parity", ASTRO_CONFIG_PATH, null, "sidebar order differs from manifest order");
}

// §4.3 — Rule 3: orphaned symlinks (dangling content-dir links + stale manifest pages).
function ruleOrphanedSymlinks() {
  const walkLinks = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let lst;
      try { lst = lstatSync(full); } catch { continue; }
      if (lst.isSymbolicLink()) {
        try { realpathSync(full); }
        catch { report("orphaned-symlink", full, null, `dangling symlink (target missing)`); }
      } else if (lst.isDirectory()) {
        walkLinks(full);
      }
    }
  };
  walkLinks(CONTENT_DIR);
  for (const p of managedPages) {
    if (p.source !== "symlink") continue;
    const expected = join(CONTENT_DIR, `${p.slug.replace(/^\/+|\/+$/g, "")}.md`);
    let lst;
    try { lst = lstatSync(expected); } catch { lst = null; }
    if (!lst || !lst.isSymbolicLink())
      report("orphaned-symlink", expected, null, `manifest symlink page '${p.slug}' has no link in content dir`);
  }
}

// §4.4 — Rule 4: pages missing required frontmatter. Applies to all pages.
function ruleMissingFrontmatter(files) {
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) { report("missing-frontmatter", file, 1, "no frontmatter block"); continue; }
    const block = fm[1];
    for (const key of REQUIRED_FRONTMATTER) {
      const re = new RegExp(`^${key}\\s*:\\s*\\S`, "m");
      if (!re.test(block)) report("missing-frontmatter", file, 1, `missing required frontmatter: ${key}`);
    }
  }
}

ruleBrokenInternalLinks(pageFiles);      // §4.1 — all pages, incl. unmanaged
ruleSidebarManifestParity();             // §4.2 — managed pages only
ruleOrphanedSymlinks();                  // §4.3
ruleMissingFrontmatter(pageFiles);       // §4.4 — all pages, incl. unmanaged

// ── (e) Custom-rule discovery (§5) ───────────────────────────────
// A repo adds project-specific rules WITHOUT forking by authoring an optional
// ESM module at docs.drift.rules.mjs (default-exports an array of {id, run(ctx)}).
// The generator never emits this file — it is a pure user convention.
async function runCustomRules() {
  if (!existsSync(CUSTOM_RULES_PATH)) return;
  let rules;
  try {
    const mod = await import(pathToFileURL(CUSTOM_RULES_PATH).href);
    rules = mod.default;
  } catch (err) {
    report("custom-rules", CUSTOM_RULES_PATH, null, `failed to import docs.drift.rules.mjs: ${err.message}`);
    return;
  }
  if (!Array.isArray(rules)) {
    report("custom-rules", CUSTOM_RULES_PATH, null, "docs.drift.rules.mjs must default-export an array of rules");
    return;
  }
  const ctx = {
    manifest, pages, managedPages, pageFiles, docsPkgDir: DOCS_PKG_DIR,
    contentDir: CONTENT_DIR, rel,
    fs: { readFileSync, readdirSync, existsSync, statSync, lstatSync, realpathSync },
  };
  for (const r of rules) {
    if (!r || typeof r.run !== "function") {
      report("custom-rules", CUSTOM_RULES_PATH, null, `invalid rule (missing run()): ${JSON.stringify(r?.id ?? r)}`);
      continue;
    }
    try {
      const out = (await r.run(ctx)) ?? [];
      for (const f of out) findings.push({ rule: f.rule ?? r.id, file: f.file ?? "", line: f.line ?? null, message: f.message });
    } catch (err) {
      report(r.id ?? "custom-rule", CUSTOM_RULES_PATH, null, `custom rule '${r.id ?? "?"}' threw: ${err.message}`);
    }
  }
}

await runCustomRules();

// ── (f) Structured report + exit (§6) ────────────────────────────
// Exit 0 iff zero findings; exit 1 on any drift finding (fails the gate); exit 2
// is reserved for guard errors (missing/invalid manifest, handled in loadManifest).
function emitReportAndExit() {
  if (findings.length === 0) {
    console.log("check-docs: OK — no drift detected.");
    process.exit(0);
  }
  findings.sort((a, b) =>
    a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  console.error(`check-docs: ${findings.length} drift finding(s):`);
  for (const f of findings) {
    const loc = f.file ? `${f.file}${f.line != null ? `:${f.line}` : ""}` : "(manifest)";
    console.error(`  [${f.rule}] ${loc} — ${f.message}`);
  }
  // Machine-readable trailer (single line) for CI annotators.
  console.error("check-docs-json: " + JSON.stringify({ findings }));
  process.exit(1);
}

emitReportAndExit();
