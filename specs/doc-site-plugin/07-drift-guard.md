# 07 — Drift Guard

The **drift guard** is the optional component that keeps a thin-view docs site
honest over time (canon §"The five reusable mechanics", item 5). It is a single
node/bun-compatible script — `check-docs.mjs` — emitted into the target repo and
wired into that repo's gate/CI. The script reads `docs.manifest.json`
(`00-core-definitions.md §2`), applies a fixed set of **generic** rules, and
exits nonzero on any finding so a drift introduced by an edit fails the gate.

Unlike the rauf reference `check-docs.ts` (which ships repo-specific grammar /
branding rules), the emitted guard ships only **portable** rules that apply to
any manifest-driven Starlight site (REQ-DRIFT-01). Project-specific rules are
added through a documented extension point, never by forking the tool
(REQ-DRIFT-02).

This component is **gated**: it is emitted only when `driftGuard: true` in the
component-selection model (`00-core-definitions.md §5`). When declined, no
`check-docs.mjs` and no gate wiring are emitted — zero files (REQ-USE-01).

> Faithful to canon (CON-04): manifest-driven, generic rules, documented
> extension point, wired into the gate, exit 0 clean / nonzero on drift.

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                              | Section        |
| ----------------- | ------------------------------------------------------------------- | -------------- |
| REQ-DRIFT-01      | Emit drift-guard + wire into gate/CI; generic rule set (4 rules)    | §1, §3, §4, §6 |
| REQ-DRIFT-01      | Rule 1 — broken internal links                                      | §4.1           |
| REQ-DRIFT-01      | Rule 2 — sidebar↔manifest parity                                    | §4.2           |
| REQ-DRIFT-01      | Rule 3 — orphaned symlinks                                          | §4.3           |
| REQ-DRIFT-01      | Rule 4 — pages missing required frontmatter                         | §4.4           |
| REQ-DRIFT-02      | Documented custom-rule extension point (`docs.drift.rules.mjs`)     | §5             |
| OQ-2 (resolved)   | `unmanaged` pages exempt from parity; still link + frontmatter      | §4.2, §4.5     |
| REQ-USE-01        | Component-gated; declined ⇒ zero files, no gate wiring              | §2, §7         |
| REQ-VERIFY-02     | Structured findings; nonzero exit ⇒ gate fails (surfaced)          | §3, §6         |
| REQ-PORT-01       | Gate/CI wiring matches detected package manager + runtime          | §6             |

## 1. Purpose & scope

`check-docs.mjs` is a **stdlib-only ESM script** (`.mjs`) that runs under both
Node (`node`) and Bun (`bun`) with no installed dependencies — it imports only
`node:fs`, `node:path`, and `node:url`, all available in both runtimes. It is
emitted from the template asset
`references/templates/drift-guard/check-docs.mjs.tmpl`
(`01-architecture-layout.md §2.2`) into the docs package of the target repo
(default `{{DOCS_PKG_DIR}}/check-docs.mjs`).

It guards the invariant that the site is a faithful, non-drifting view over the
manifest and the repo markdown: every internal link resolves, the generated
sidebar matches the manifest, no symlink dangles, and every page carries the
frontmatter Starlight needs. It does **not** lint prose, branding, or version
pins (those are project-specific — see §5).

**Inputs read** (no network; reads only the target tree, REQ-SEC-03):

| Path                                   | Source doc                          | Used by rule |
| -------------------------------------- | ----------------------------------- | ------------ |
| `docs.manifest.json`                   | `00-core-definitions.md §2`         | 1, 2, 3, 4   |
| `{{DOCS_PKG_DIR}}/astro.config.mjs`    | `03-core-site-and-manifest.md` (sidebar) | 2       |
| `{{DOCS_PKG_DIR}}/src/content/docs/**` | `03` / `04-content-symlink-layer.md` (pages, symlinks) | 1, 3, 4 |
| `docs.drift.rules.mjs` (optional)      | this doc §5                          | custom       |

The token `{{DOCS_PKG_DIR}}` is the canonical token from
`00-core-definitions.md §4.1`; the emitted script resolves all paths relative to
its own location so it works under any docs-package directory without an extra
token.

## 2. Component gating (REQ-USE-01)

The `drift-guard/` template group is emitted **iff** `driftGuard === true` in the
component-selection record (`00-core-definitions.md §5`). Concretely:

- `driftGuard: true` → emit `{{DOCS_PKG_DIR}}/check-docs.mjs`, add the gate
  script entry (§6.1), and (if CI is in use) the optional CI step (§6.2).
- `driftGuard: false` → emit **nothing**: no `check-docs.mjs`, no `docs:check`
  script, no CI step, no reference anywhere else. This satisfies the decline-all
  invariant (`00-core-definitions.md §5`, REQ-USE-01). The custom-rule file
  `docs.drift.rules.mjs` is **never** emitted by the generator either way — it is
  a user-authored convention (§5).

`check-docs.mjs` is a managed plumbing file: its sha256 is recorded in
`.doc-site-scaffold.json` (`00-core-definitions.md §3`) so re-run never clobbers a
user-edited copy (`08-rerun-and-verification.md`).

## 3. `check-docs.mjs` structure (ESM)

The script is structured as: (a) path bootstrap, (b) `Finding` model + collector,
(c) manifest + page collection, (d) the four built-in rules, (e) custom-rule
discovery and invocation, (f) structured report + exit. The full emitted body
(post-substitution of `{{DOCS_PKG_DIR}}` — note the template itself contains the
token only inside a comment; all runtime paths are derived from `import.meta.url`,
so the resolved script is identical regardless of docs-package location, aiding
REQ-PORT-02):

```js
#!/usr/bin/env node
// check-docs.mjs — docs drift guard for {{DOCS_PKG_DIR}}
// Emitted by doc-site-plugin (REQ-DRIFT-01/02). stdlib-only; runs on Node and Bun.
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
ruleBrokenInternalLinks(pageFiles);      // §4.1 — all pages, incl. unmanaged
ruleSidebarManifestParity();             // §4.2 — managed pages only
ruleOrphanedSymlinks();                  // §4.3
ruleMissingFrontmatter(pageFiles);       // §4.4 — all pages, incl. unmanaged

// ── (e) Custom-rule discovery (§5) ───────────────────────────────
await runCustomRules();

// ── (f) Structured report + exit (§6) ────────────────────────────
emitReportAndExit();
```

Each rule function and the helpers are defined below in their own sections; the
emitted template contains all of them in one file. `emitReportAndExit` and
`runCustomRules` are specified in §6 and §5 respectively.

## 4. The generic rule set (REQ-DRIFT-01)

Four rules ship in every emitted guard. Each pushes zero or more `Finding`s; none
throws on a drift (only on a malformed manifest, handled in §3 with exit 2).

### 4.1 Rule 1 — broken internal links (`rule: "broken-link"`)

Flags Markdown/MDX links and image references whose **local** target does not
resolve on disk. Applies to **every** page collected by `walkPages`, including
symlinked and `unmanaged` pages (§4.5).

Check logic:
1. For each page file, read its text and split into lines (1-based line numbers).
2. Match inline links `[text](target)` and images `![alt](target)` with
   `/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g`, capturing `target`.
3. **Skip non-local targets**: any target matching `/^(https?:|mailto:|tel:|#|\/\/|data:)/`
   (external URL, mail/tel, pure in-page anchor, protocol-relative, data URI).
4. Strip a trailing `#anchor` and any `?query` from the target (link resolution
   is file-existence only; anchor validity is out of scope).
5. Resolve the target. Absolute (`/…`) targets resolve against `CONTENT_DIR`
   (Starlight content root); relative targets resolve against the page file's
   `dirname`. Use `statSync` (follows symlinks) wrapped in try/catch.
6. If the path does not resolve, and a Starlight slug-style fallback also fails
   (a bare `foo` link may target the page `foo.md`/`foo.mdx`/`foo/index.mdx`),
   `report("broken-link", file, lineNo, …)`.

```js
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
```

### 4.2 Rule 2 — sidebar↔manifest parity (`rule: "sidebar-parity"`)

Guards that the generated Starlight sidebar (in `astro.config.mjs`) lists exactly
the **managed** manifest slugs, in manifest order — the single-source guarantee
of `00-core-definitions.md §2` and REQ-CONTENT-03. **`unmanaged` pages are
exempt** (§4.5, OQ-2): they are excluded from the expected set and ignored if
present in the sidebar.

The sidebar is generated, never hand-kept (`03-core-site-and-manifest.md §"sidebar
generation"`), so this rule is the regression net that catches a hand-edit to
either side.

Check logic:
1. Build the expected slug list = `managedPages.map(p => p.slug)`, normalized to
   POSIX, leading/trailing `/` stripped.
2. Read `astro.config.mjs` text and extract the sidebar slugs. The emitted config
   lists each page as a Starlight sidebar link whose `slug` (or `link`) is the
   manifest slug; extract every `slug: "…"` / `link: "…"` string via
   `/\b(?:slug|link):\s*["'`]([^"'`]+)["'`]/g`, normalized the same way.
3. **Missing**: expected slug not present in the sidebar →
   `report("sidebar-parity", astroConfig, null, "manifest slug '<s>' missing from sidebar")`.
4. **Extra**: a sidebar slug that is neither a managed slug nor an unmanaged slug
   → `report("sidebar-parity", astroConfig, null, "sidebar slug '<s>' not in manifest")`.
   (A sidebar slug matching an `unmanaged` page is allowed — the user wired it
   manually.)
5. **Order**: if the set matches but the relative order of managed slugs in the
   sidebar differs from manifest order →
   `report("sidebar-parity", astroConfig, null, "sidebar order differs from manifest order")`.

```js
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
```

### 4.3 Rule 3 — orphaned symlinks (`rule: "orphaned-symlink"`)

Flags two failure modes of the symlink content bridge
(`04-content-symlink-layer.md`):

- **Dangling**: a symlink under the content dir whose target does not exist
  (`lstatSync` says symlink, but `statSync`/`realpathSync` throws).
- **Stale**: a `source: "symlink"` manifest page whose expected content-dir link
  is missing entirely (the symlinker did not create it, or it was deleted) — the
  inverse drift.

Check logic:
1. Recursively walk the content dir with `lstatSync` (does **not** follow links).
   For every entry that is a symlink, attempt `statSync`; on failure
   `report("orphaned-symlink", entry, null, "dangling symlink → <readlink target>")`.
2. For each `source: "symlink"` managed page, compute its expected content path
   (`CONTENT_DIR/<slug>.md`, matching the symlinker's slug→file mapping in
   `04-content-symlink-layer.md`); if it does not exist as a symlink,
   `report("orphaned-symlink", expectedPath, null, "manifest symlink page '<slug>' has no link in content dir")`.

```js
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
```

### 4.4 Rule 4 — pages missing required frontmatter (`rule: "missing-frontmatter"`)

Flags any page (`.md`/`.mdx`) that lacks the YAML frontmatter keys Starlight
requires. The minimum is `title` (Starlight derives nav labels / `<title>` from
it; a page without it fails the build or renders untitled). Applies to **every**
collected page, including symlinked and `unmanaged` pages (§4.5) — an unmanaged
page must still be a valid Starlight page.

Check logic:
1. Read the page; capture the leading frontmatter block delimited by `---` …
   `---` at the very top via `/^---\n([\s\S]*?)\n---/`.
2. If no frontmatter block exists →
   `report("missing-frontmatter", file, 1, "no frontmatter block")`.
3. For each key in `REQUIRED_FRONTMATTER` (default `["title"]`), test the block
   for `^<key>\s*:\s*\S` (key present with a non-empty value). Missing →
   `report("missing-frontmatter", file, 1, "missing required frontmatter: <key>")`.

`REQUIRED_FRONTMATTER` is a top-of-file `const` (§3) so a repo can extend it by a
one-line edit, but the documented, fork-free way to add bespoke frontmatter rules
is a custom rule (§5).

```js
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
```

### 4.5 `unmanaged` exemption — explicit implementation (OQ-2, `00 §2.3`)

The escape hatch in `00-core-definitions.md §2.3` is implemented as a **single,
explicit partition** computed once in §3:

```js
const managedPages = pages.filter((p) => p.unmanaged !== true);
```

- **Parity (§4.2)** iterates `managedPages` and adds unmanaged slugs to an
  allow-list (`unmanagedSlugs`), so an unmanaged page is **never** reported as
  "missing from sidebar" nor as "not in manifest". This is the only rule the
  exemption affects.
- **Broken links (§4.1)** and **missing frontmatter (§4.4)** iterate `pageFiles`
  (the on-disk walk), which includes unmanaged pages — they remain fully checked,
  exactly as `00 §2.3` requires.
- **Orphaned symlinks (§4.3)** dangling-link scan is on-disk and unconditional;
  the manifest-side stale-link check iterates `managedPages` (an unmanaged page
  has no generator-created link to be "stale").

No other code path consults `unmanaged`; this keeps the exemption auditable.

## 5. Custom-rule extension point (REQ-DRIFT-02)

A repo adds project-specific rules **without forking** by authoring an optional
ESM module at `{{DOCS_PKG_DIR}}/docs.drift.rules.mjs`. The guard imports it **iff
present** (the generator never emits it — it is a pure convention). This is the
generalized replacement for rauf's hard-coded grammar/branding rules: those would
live in a downstream repo's `docs.drift.rules.mjs`, not in the shipped tool.

### 5.1 Module interface

`docs.drift.rules.mjs` must `export default` an array of **rule objects**:

```js
/**
 * @typedef {Object} DriftRuleContext
 * @property {object}   manifest    - parsed docs.manifest.json (00 §2)
 * @property {PageEntry[]} pages    - manifest.pages (incl. unmanaged)
 * @property {PageEntry[]} managedPages - pages with unmanaged !== true (§4.5)
 * @property {string[]}  pageFiles  - absolute paths of every .md/.mdx page on disk
 * @property {string}    docsPkgDir - absolute path of the docs package root
 * @property {string}    contentDir - absolute path of src/content/docs
 * @property {(file:string)=>string} rel - absolute → repo-relative path helper
 * @property {typeof import("node:fs")} fs - the fs module (read-only use expected)
 */
/**
 * @typedef {Object} DriftRule
 * @property {string} id - stable rule id, prefixed to its findings (e.g. "no-todo")
 * @property {(ctx: DriftRuleContext) => Finding[] | Promise<Finding[]>} run
 *   - returns the findings this rule produces (empty array = clean).
 */
```

Contract:
- A rule **returns** an array of `Finding` (`{ rule, file, line, message }`,
  §3b). It MUST NOT call `process.exit` and SHOULD NOT mutate inputs.
- The guard prefixes each returned finding's `rule` with the module's `id` if the
  rule omitted it, so findings are attributable.
- A rule may be `async` (e.g. it reads several files); the guard `await`s it.
- A thrown error from a custom rule is caught and converted to a guard-level
  finding (`rule: "<id>", message: "custom rule threw: <err>"`) so a buggy rule
  fails the gate loudly rather than silently passing.

### 5.2 Discovery & invocation

```js
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
```

### 5.3 Example custom rule (documented in `references/drift-guard.md`)

```js
// docs.drift.rules.mjs (in the target repo — authored by the repo's maintainer)
export default [
  {
    id: "no-todo",
    run({ pageFiles, fs, rel }) {
      const findings = [];
      for (const file of pageFiles) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (/\bTODO\b/.test(line)) findings.push({ file: rel(file), line: i + 1, message: "TODO left in published doc" });
        });
      }
      return findings; // `rule` defaults to this module's id ("no-todo")
    },
  },
];
```

## 6. Exit behavior, reporting & gate wiring

### 6.1 Structured findings + exit codes

`emitReportAndExit` prints a deterministic, grep-friendly report and sets the exit
code. **Exit 0** iff there are zero findings; **exit 1** on any drift finding
(fails the gate, REQ-VERIFY-02); **exit 2** is reserved for guard errors
(missing/invalid manifest, §3) so CI can distinguish "drift" from "guard
broken". Findings are sorted by `(rule, file, line)` for stable output, and a
machine-readable JSON line is emitted last so a CI annotator can parse it.

```js
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
```

### 6.2 Gate / `package.json` wiring (REQ-PORT-01)

The generator adds a `docs:check` script to the docs package's `package.json`
(and, for monorepos, a root passthrough per `06-deploy-and-monorepo.md`'s monorepo
fragment pattern), matched to the detected runtime via `{{RUNTIME}}`
(`00-core-definitions.md §4.1`):

```jsonc
// {{DOCS_PKG_DIR}}/package.json — "scripts" (added only when driftGuard: true)
{
  "docs:check": "{{RUNTIME}} check-docs.mjs"   // {{RUNTIME}} ∈ {node, bun}
}
```

If the repo runs a meta `gate`/`check` script (detected in
`02-detection-and-interview.md`), `docs:check` is appended to it so drift fails
the existing gate. If no such script exists, the generator leaves `docs:check` as
a standalone entry and documents it in the next-steps output
(`08-rerun-and-verification.md`, REQ-VERIFY-03). The script is invoked with the
detected package manager (`{{PKG_MANAGER}} run docs:check`).

### 6.3 Optional CI step (REQ-DRIFT-01)

When the repo has CI and the GitHub Pages deploy target is selected, the guard is
added as a job step **before** the build in the emitted workflow
(`06-deploy-and-monorepo.md`, GitHub Pages), so a broken page never deploys:

```yaml
# .github/workflows/docs.yml — added step (toolchain matched per {{PKG_MANAGER}}/{{RUNTIME}})
- name: Docs drift guard
  run: {{PKG_MANAGER}} run docs:check
  working-directory: {{DOCS_PKG_DIR}}
```

When no CI / no GH Pages target is selected, only the `docs:check` script entry is
emitted (§6.2) — no workflow is created solely for the guard (REQ-USE-01).

## Dependencies

- **`00-core-definitions.md`** — `docs.manifest.json` shape and field contract
  (§2), the `unmanaged: true` escape hatch (§2.3) implemented here in §4.5, the
  `{{DOCS_PKG_DIR}}` / `{{RUNTIME}}` / `{{PKG_MANAGER}}` tokens (§4.1), the
  component-selection model `driftGuard` flag (§5), and the provenance manifest
  (§3) that tracks `check-docs.mjs` for never-clobber.
- **`01-architecture-layout.md`** — the `drift-guard/` template group and the
  template-asset path `references/templates/drift-guard/check-docs.mjs.tmpl` (§2.2),
  and the gating that emits zero files when declined (§2.2, §4).
- **`03-core-site-and-manifest.md`** — emits the `astro.config.mjs` sidebar and
  the page set this guard checks parity against (Rule 2) and walks for links /
  frontmatter (Rules 1, 4). The guard is a regression net over `03`'s generated
  sidebar.
- **`04-content-symlink-layer.md`** — emits the symlinks whose dangling/stale
  state Rule 3 detects, and defines the slug→content-path mapping Rule 3 reuses.
- **`06-deploy-and-monorepo.md`** — provides the GitHub Pages workflow the optional CI
  step (§6.3) and the monorepo root-passthrough pattern (§6.2) plug into.
- **`08-rerun-and-verification.md`** — consumes the provenance entry for
  `check-docs.mjs` (never-clobber) and surfaces `docs:check` in next-steps output.

Implementation order: `00`, `01`, then `03` and `04` (the guard checks their
output); this doc's gate wiring (§6.2/§6.3) lands alongside `06`.

## Verification

Mirrors the PRD success criterion: "the emitted drift guard fails against an
intentionally-broken page and passes against a clean tree."

- [ ] **Clean tree passes**: scaffold a site (any content mode) with a valid
      `docs.manifest.json`, run `{{RUNTIME}} check-docs.mjs` → prints
      `check-docs: OK` and exits `0`.
- [ ] **Broken internal link fails (Rule 1)**: add `[x](./does-not-exist.md)` to a
      page → exit `1`, a `[broken-link]` finding naming the file and line. An
      `unmanaged` page with the same broken link is **also** flagged (§4.5).
- [ ] **Sidebar parity fails (Rule 2)**: remove a managed slug from
      `astro.config.mjs`'s sidebar (or add a slug absent from the manifest) → exit
      `1`, a `[sidebar-parity]` finding. Adding an `unmanaged` page's slug to the
      sidebar does **not** trigger a finding.
- [ ] **Orphaned symlink fails (Rule 3)**: delete the repo-root markdown a
      `source: symlink` page points at (leaving a dangling link), or delete the
      content-dir link itself → exit `1`, an `[orphaned-symlink]` finding.
- [ ] **Missing frontmatter fails (Rule 4)**: remove `title:` from a page (managed
      or `unmanaged`) → exit `1`, a `[missing-frontmatter]` finding.
- [ ] **`unmanaged` exemption holds**: a manifest page with `"unmanaged": true`
      absent from the sidebar produces **no** `sidebar-parity` finding, but its
      broken links / missing frontmatter are still reported (§4.5).
- [ ] **Custom rule runs (REQ-DRIFT-02)**: place a `docs.drift.rules.mjs`
      exporting the §5.3 `no-todo` rule, add a `TODO` to a page → exit `1` with a
      `[no-todo]` finding; remove the module → that finding disappears with no
      other change (fork-free extension).
- [ ] **Guard error vs drift**: a malformed `docs.manifest.json` exits `2` (not
      `1`), distinguishing "guard broken" from "drift found".
- [ ] **Gating (REQ-USE-01)**: scaffolding with `driftGuard: false` emits no
      `check-docs.mjs`, no `docs:check` script, and no CI step (verified by the
      decline-all scaffold-output fixture, `10-testing-strategy.md`).
- [ ] **Runtime portability**: the same `check-docs.mjs` runs identically under
      `node check-docs.mjs` and `bun check-docs.mjs` (stdlib-only imports).
