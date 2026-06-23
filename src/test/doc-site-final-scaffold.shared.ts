/**
 * Final emitted target-tree resolver for the doc-site scaffold (10 §5).
 *
 * `resolveTree` (doc-site-scaffold.shared.ts) proves byte-stable {{TOKEN}}
 * substitution over the RAW template groups. It does NOT model the **final emitted
 * target repo tree** — the post-substitution mechanics an agent performs by hand:
 * package-script composition, sidebar injection, deploy-fragment selection +
 * drift-step injection + path-filter dedup, manifest generation, schema copy,
 * provenance hashing, and the monorepo root-file merge. Several genuinely broken
 * template/doc outputs pass `resolveTree` green precisely because it never emits
 * the real tree.
 *
 * `finalScaffold(answers)` IS that real tree: a map of repo-relative target path →
 * resolved bytes, plus a `.doc-site-scaffold.json` provenance entry over the
 * managed-plumbing subset. The scaffold-output goldens assert against this map,
 * organized under real target paths (10 §7). There is no production module — this
 * faithfully reproduces the documented scaffold-time mechanics so a template/doc
 * defect surfaces as red (10 §5.2).
 *
 * NO Astro build, diagram render, or network call happens here.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PREEXISTING_DIR,
  TEMPLATES_DIR,
  effectivePages,
  deriveTokens,
  substitute,
  walk,
  type PageEntry,
  type ScaffoldAnswers,
} from "./doc-site-scaffold.shared.js";

/** scaffold-format version recorded in provenance (rerun.md §1.3). */
const SCAFFOLD_VERSION = "1";
/** pinned renderer CONTRACT_VERSION recorded when diagrams emit (diagrams.md §3). */
const DIAGRAM_CONTRACT = "1.0.0";

/** One emitted target file. `recorded` ⇒ a managed-plumbing file hashed into provenance. */
interface EmittedFile {
  /** repo-relative target path. */
  path: string;
  bytes: string;
  /** managed plumbing → recorded in `.doc-site-scaffold.json` `files` (rerun.md §1.2). */
  recorded: boolean;
}

const tmpl = (rel: string): string => fs.readFileSync(path.join(TEMPLATES_DIR, rel), "utf8");

/** Strip `//`/`#` comment-only lines from a JSONC/YAML fragment header. */
function stripCommentLines(text: string, marker: "//" | "#"): string {
  return text
    .split("\n")
    .filter((l) => !new RegExp(`^\\s*${marker === "//" ? "//" : "#"}`).test(l))
    .join("\n");
}

function sha256(bytes: string): string {
  return "sha256:" + createHash("sha256").update(bytes, "utf8").digest("hex");
}

// ── sidebar (core.md §2) ─────────────────────────────────────────────────────
type SidebarLeaf = { label: string; slug: string };
type SidebarGroup = { label: string; items: SidebarLeaf[] };
type SidebarEntry = SidebarLeaf | SidebarGroup;

function titleize(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Build the Starlight sidebar from manifest pages, preserving manifest order (core.md §2.3). */
export function buildSidebar(pages: ReadonlyArray<PageEntry>): SidebarEntry[] {
  const result: SidebarEntry[] = [];
  const groupIndex = new Map<string, SidebarGroup>();
  for (const page of pages) {
    if (page.unmanaged) continue; // source does not affect sidebar; only unmanaged excludes
    const segments = page.slug.split("/");
    const leaf: SidebarLeaf = { label: titleize(segments[segments.length - 1]!), slug: page.slug };
    if (segments.length === 1) {
      result.push(leaf);
      continue;
    }
    const groupLabel = titleize(segments[0]!);
    let group = groupIndex.get(groupLabel);
    if (!group) {
      group = { label: groupLabel, items: [] };
      groupIndex.set(groupLabel, group);
      result.push(group);
    }
    group.items.push(leaf);
  }
  return result;
}

/**
 * Serialize the sidebar to the documented pretty-print (core.md §2): array items
 * at `base + 2` spaces, group bodies nested two further, leaves double-quoted.
 * `base` is the indentation of the `sidebar:` key (6 in astro.config.mjs).
 */
function serializeSidebar(entries: SidebarEntry[], base: number): string {
  const ind = base + 2;
  const pad = " ".repeat(ind);
  const leaf = (e: SidebarLeaf, n: number) =>
    `${" ".repeat(n)}{ label: ${JSON.stringify(e.label)}, slug: ${JSON.stringify(e.slug)} },`;
  const lines = ["["];
  for (const e of entries) {
    if ("slug" in e) {
      lines.push(leaf(e, ind));
    } else {
      lines.push(`${pad}{`);
      lines.push(`${" ".repeat(ind + 2)}label: ${JSON.stringify(e.label)},`);
      lines.push(`${" ".repeat(ind + 2)}items: [`);
      for (const it of e.items) lines.push(leaf(it, ind + 4));
      lines.push(`${" ".repeat(ind + 2)}],`);
      lines.push(`${pad}},`);
    }
  }
  lines.push(`${" ".repeat(base)}]`);
  return lines.join("\n");
}

// ── package.json script composition (symlink.md §4, diagrams.md §4, drift-guard.md §3) ──
function composeScripts(
  answers: ScaffoldAnswers,
  tokens: Record<string, string>,
): Record<string, string> {
  const { selection } = answers;
  const symlink = selection.contentMode === "symlink" || selection.contentMode === "mixed";

  // byte source for predev/prebuild/docs:check (the merge fragment).
  const frag = JSON.parse(
    substitute(stripCommentLines(tmpl("core/package.scripts.fragment.json.tmpl"), "//"), tokens),
  ) as Record<string, string>;

  // base scripts come from package.json.tmpl itself (dev/build/preview).
  const base = (
    JSON.parse(substitute(tmpl("core/package.json.tmpl"), tokens)) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  let diagramsScript: string | undefined;
  let diagramPrebuild: string | undefined;
  if (selection.diagrams) {
    const snip = JSON.parse(
      substitute(tmpl("diagrams/diagrams.prebuild.snippet.tmpl"), tokens),
    ) as {
      scripts: Record<string, string>;
    };
    diagramsScript = snip.scripts.diagrams;
    diagramPrebuild = snip.scripts.prebuild; // e.g. "pnpm run diagrams"
  }

  // prebuild composition (symlink first, then diagrams — symlink.md §4 / diagrams.md §4.3).
  let prebuild: string | undefined;
  if (symlink && selection.diagrams) prebuild = `${frag.prebuild} && ${diagramPrebuild}`;
  else if (symlink) prebuild = frag.prebuild;
  else if (selection.diagrams) prebuild = diagramPrebuild;

  // deterministic key order: pre-hooks adjacent to their hook, then extras.
  const out: Record<string, string> = {};
  if (symlink) out.predev = frag.predev!;
  out.dev = base.dev!;
  if (prebuild) out.prebuild = prebuild;
  out.build = base.build!;
  out.preview = base.preview!;
  if (diagramsScript) out.diagrams = diagramsScript;
  if (selection.driftGuard) out["docs:check"] = frag["docs:check"]!;
  return out;
}

// ── github-pages workflow assembly (deploy-github-pages.md, drift-guard.md §4) ──
function replaceSentinelLine(text: string, marker: string, replacement: string | null): string {
  const lines = text.split("\n");
  // Match ONLY the real sentinel line (`<indent># <<MARKER>> …`), never a header
  // comment that merely mentions the marker token in prose.
  const i = lines.findIndex((l) => l.trimStart().startsWith(`# ${marker}`));
  if (i === -1) return text;
  if (replacement !== null) {
    lines[i] = replacement;
  } else {
    lines.splice(i, 1);
    // collapse a double blank line left behind when the sentinel had blank neighbors.
    if (i > 0 && lines[i - 1] === "" && lines[i] === "") lines.splice(i, 1);
  }
  return lines.join("\n");
}

function assembleGithubWorkflow(answers: ScaffoldAnswers, tokens: Record<string, string>): string {
  const d = tokens.DOCS_PKG_DIR!;
  const symlink =
    answers.selection.contentMode === "symlink" || answers.selection.contentMode === "mixed";
  let text = substitute(tmpl("deploy/github-pages/docs.yml.tmpl"), tokens);

  // path-filter dedup (Phase 4): {{DOCS_PKG_DIR}}/** and docs/** collapse when
  // DOCS_PKG_DIR=docs; the docs/** symlink bridge is meaningful only in symlink/mixed.
  const filters = [`${d}/**`];
  if (symlink) filters.push("docs/**");
  filters.push(`${d}/docs.manifest.json`, ".github/workflows/docs.yml");
  const deduped = [...new Set(filters)];
  const block =
    "    paths:\n" +
    deduped.map((f) => `      - ${JSON.stringify(f)}`).join("\n") +
    "\n  workflow_dispatch:";
  text = text.replace(/ {4}paths:\n[\s\S]*?\n {2}workflow_dispatch:/, block);

  // pnpm needs its own setup action regardless of runtime; npm/yarn/bun need none.
  const pkgSetup =
    tokens.PKG_MANAGER === "pnpm"
      ? "      - name: Setup pnpm\n        uses: pnpm/action-setup@v4"
      : null;
  text = replaceSentinelLine(text, "<<PKG_SETUP>>", pkgSetup);

  // drift step injected only when driftGuard + github-pages (drift-guard.md §4).
  const driftStep = answers.selection.driftGuard
    ? substitute(stripCommentLines(tmpl("drift-guard/ci-step.github-pages.yaml.tmpl"), "#"), tokens)
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
    : null;
  text = replaceSentinelLine(text, "<<DRIFT_STEP>>", driftStep);

  return text;
}

// ── manifest generation (core.md §1) ─────────────────────────────────────────
function generateManifest(answers: ScaffoldAnswers): string {
  const pages = effectivePages(answers.pages).map((p) => {
    const o: Record<string, unknown> = { slug: p.slug };
    if (p.source !== undefined) o.source = p.source;
    if (p.from !== undefined) o.from = p.from;
    if (p.unmanaged !== undefined) o.unmanaged = p.unmanaged;
    return o;
  });
  const site: Record<string, unknown> = {
    title: answers.site.title,
    description: answers.site.description,
  };
  if (answers.site.social) site.social = answers.site.social;
  const manifest = { $schema: "./docs.manifest.schema.json", site, pages };
  return JSON.stringify(manifest, null, 2) + "\n";
}

// ── monorepo root-file merge (monorepo.md) ───────────────────────────────────
/**
 * Select the root-package.json merge fragment by {{PKG_MANAGER}}, mirroring how
 * the agent picks ONE of the two variants the single template ships (monorepo.md
 * §7.3): the npm variant is the ACTIVE (uncommented) JSON block; the pnpm variant
 * lives in the `//`-comment block after its `--- pnpm fragment` marker. Returns
 * the raw (pre-substitution) JSON text of the selected variant.
 */
function selectRootScriptsFragment(pkgManager: string): string {
  const raw = tmpl("monorepo/root-scripts.fragment.json.tmpl");
  let region: string;
  if (pkgManager === "npm") {
    // npm fragment is the only uncommented block; stripping `//` lines leaves it
    // (and drops the commented-out pnpm variant) — exactly what the agent reads.
    region = stripCommentLines(raw, "//");
  } else {
    // pnpm fragment is the commented JSON after its marker line; un-comment it.
    const lines = raw.split("\n");
    const start = lines.findIndex((l) => l.includes("pnpm fragment"));
    region = lines
      .slice(start + 1)
      .filter((l) => /^\s*\/\//.test(l))
      .map((l) => l.replace(/^\s*\/\/ ?/, ""))
      .join("\n");
  }
  const open = region.indexOf("{");
  const close = region.lastIndexOf("}");
  return region.slice(open, close + 1);
}

/**
 * Additive key-merge of the selected root-scripts fragment into the pre-existing
 * root package.json (monorepo.md §7.3): register `workspaces` membership (npm
 * variant only) idempotently and add the passthrough scripts. Never-clobber a
 * user-edited value — an existing script key keeps its value (00 §3.3/§7).
 */
function mergeRootPackageJson(existing: string, tokens: Record<string, string>): string {
  const obj = JSON.parse(existing) as Record<string, unknown>;
  const frag = JSON.parse(substitute(selectRootScriptsFragment(tokens.PKG_MANAGER!), tokens)) as {
    workspaces?: string[];
    scripts?: Record<string, string>;
  };

  if (Array.isArray(frag.workspaces)) {
    const ws = new Set([...((obj.workspaces as string[]) ?? [])]);
    for (const w of frag.workspaces) ws.add(w);
    obj.workspaces = [...ws];
  }

  const scripts = { ...((obj.scripts as Record<string, string>) ?? {}) };
  for (const [k, v] of Object.entries(frag.scripts ?? {})) {
    if (!(k in scripts)) scripts[k] = v; // never-clobber a user-edited value
  }
  obj.scripts = scripts;
  return JSON.stringify(obj, null, 2) + "\n";
}

/**
 * Additive merge of the docs package entry into pnpm-workspace.yaml (monorepo.md
 * §7.4). The entry line is sourced from the fragment template (token-substituted),
 * appended only when not already present (string-equality on the relative path).
 */
function mergePnpmWorkspace(existing: string, tokens: Record<string, string>): string {
  const d = tokens.DOCS_PKG_DIR!;
  if (existing.includes(`"${d}"`)) return existing;
  const fragText = substitute(
    stripCommentLines(tmpl("monorepo/pnpm-workspace.fragment.yaml.tmpl"), "#"),
    tokens,
  );
  const entry = fragText.split("\n").find((l) => /^\s*-\s/.test(l))!;
  return existing.replace(/\s*$/, "") + "\n" + entry + "\n";
}

// ── the renderer vendoring stub (diagrams.md §2 — presence/path/provenance only) ──
const RENDERER_STUB = `// diagram-render.mjs — VENDORED at scaffold time from the sibling diagram-generator
// skill (diagrams.md §2). The real bundle is a build artifact; this scaffold-test
// stub stands in for it: presence + target path + provenance entry are pinned, the
// renderer's actual bytes are NOT. CONTRACT_VERSION ${DIAGRAM_CONTRACT} (00 §8).
`;

const STARTER_DIAGRAM_SPEC =
  JSON.stringify(
    {
      title: "Architecture",
      nodes: [
        { id: "client", label: "Client" },
        { id: "server", label: "Server" },
      ],
      edges: [{ from: "client", to: "server" }],
    },
    null,
    2,
  ) + "\n";

/** Load the realistic pre-existing root files for an answer set (monorepo merge input). */
export function loadPreexisting(name: string): Record<string, string> {
  const base = path.join(PREEXISTING_DIR, name);
  if (!fs.existsSync(base)) return {};
  const out: Record<string, string> = {};
  for (const abs of walk(base)) {
    out[path.relative(base, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf8");
  }
  return out;
}

/**
 * Resolve an answer set to its FINAL emitted target tree (repo-relative path →
 * bytes), including the `.doc-site-scaffold.json` provenance over the managed
 * plumbing subset. `preexisting` supplies realistic root files for the monorepo
 * merge (loadPreexisting).
 */
export function finalScaffold(
  answers: ScaffoldAnswers,
  preexisting: Record<string, string> = {},
): Map<string, string> {
  const tokens = deriveTokens(answers);
  const d = tokens.DOCS_PKG_DIR!;
  const { selection } = answers;
  const symlink = selection.contentMode === "symlink" || selection.contentMode === "mixed";
  const files: EmittedFile[] = [];
  const emit = (p: string, bytes: string, recorded: boolean) =>
    files.push({ path: p, bytes, recorded });

  // —— core group (always) ————————————————————————————————————————————————
  // package.json with composed scripts (script merge mechanic).
  const pkg = JSON.parse(substitute(tmpl("core/package.json.tmpl"), tokens)) as Record<
    string,
    unknown
  >;
  pkg.scripts = composeScripts(answers, tokens);
  emit(`${d}/package.json`, JSON.stringify(pkg, null, 2) + "\n", true);

  emit(`${d}/tsconfig.json`, substitute(tmpl("core/tsconfig.json.tmpl"), tokens), true);
  emit(`${d}/.gitignore`, substitute(tmpl("core/.gitignore.tmpl"), tokens), true);

  // astro.config.mjs with sidebar injected at the `sidebar: []` sentinel.
  const sidebar = serializeSidebar(buildSidebar(effectivePages(answers.pages)), 6);
  const astro = substitute(tmpl("core/astro.config.mjs.tmpl"), tokens).replace(
    "sidebar: []",
    `sidebar: ${sidebar}`,
  );
  emit(`${d}/astro.config.mjs`, astro, true);

  emit(`${d}/src/content.config.ts`, substitute(tmpl("core/content.config.ts.tmpl"), tokens), true);
  emit(`${d}/src/styles/custom.css`, substitute(tmpl("core/custom.css.tmpl"), tokens), true);
  emit(`${d}/public/favicon.svg`, tmpl("core/favicon.svg"), true);
  emit(`${d}/src/content/docs/index.mdx`, substitute(tmpl("core/index.mdx.tmpl"), tokens), true);
  // guides/setup.mdx is a source:native authored page — NEVER recorded (rerun.md §1.2).
  emit(
    `${d}/src/content/docs/guides/setup.mdx`,
    substitute(tmpl("core/starter-page.mdx.tmpl"), tokens),
    false,
  );

  // manifest + verbatim schema copy.
  emit(`${d}/docs.manifest.json`, generateManifest(answers), true);
  emit(
    `${d}/docs.manifest.schema.json`,
    fs.readFileSync(path.join(TEMPLATES_DIR, "..", "docs.manifest.schema.json"), "utf8"),
    true,
  );

  // —— symlink group ————————————————————————————————————————————————————————
  if (symlink) {
    emit(`${d}/setup-docs.sh`, substitute(tmpl("symlink/setup-docs.sh.tmpl"), tokens), true);
  }

  // —— diagrams group ———————————————————————————————————————————————————————
  if (selection.diagrams) {
    emit(`${d}/scripts/diagram-render.mjs`, RENDERER_STUB, true);
    emit(`${d}/src/diagrams/arch.json`, STARTER_DIAGRAM_SPEC, true);
  }

  // —— drift-guard group ————————————————————————————————————————————————————
  if (selection.driftGuard) {
    emit(`${d}/check-docs.mjs`, substitute(tmpl("drift-guard/check-docs.mjs.tmpl"), tokens), true);
  }

  // —— deploy groups ————————————————————————————————————————————————————————
  if (selection.deploy.includes("github-pages")) {
    emit(".github/workflows/docs.yml", assembleGithubWorkflow(answers, tokens), true);
  }
  if (selection.deploy.includes("vercel")) {
    const vercel = JSON.parse(substitute(tmpl("deploy/vercel/vercel.json.tmpl"), tokens)) as Record<
      string,
      unknown
    >;
    vercel.buildCommand = tokens.WORKSPACE_BUILD;
    vercel.installCommand = tokens.INSTALL_CMD;
    emit("vercel.json", JSON.stringify(vercel, null, 2) + "\n", true);
  }
  if (selection.deploy.includes("static-netlify")) {
    const buildCmd =
      tokens.PKG_MANAGER === "npm"
        ? "npm run build"
        : tokens.PKG_MANAGER === "bun"
          ? "bun run build"
          : tokens.PKG_MANAGER === "yarn"
            ? "yarn build"
            : "pnpm build";
    const netlify = substitute(tmpl("deploy/static/netlify.toml.tmpl"), tokens).replace(
      'command = "pnpm build"',
      `command = "${buildCmd}"`,
    );
    emit("netlify.toml", netlify, true);
  }

  // —— monorepo group (additive merges into pre-existing user root files) ————
  if (selection.monorepo) {
    const rootPkg = preexisting["package.json"];
    if (rootPkg !== undefined) emit("package.json", mergeRootPackageJson(rootPkg, tokens), false);
    if (tokens.PKG_MANAGER === "pnpm") {
      const ws = preexisting["pnpm-workspace.yaml"];
      if (ws !== undefined) emit("pnpm-workspace.yaml", mergePnpmWorkspace(ws, tokens), false);
    }
  }

  // —— provenance (.doc-site-scaffold.json) ————————————————————————————————
  const provFiles: Record<string, string> = {};
  for (const f of files.filter((f) => f.recorded).sort((a, b) => a.path.localeCompare(b.path))) {
    provFiles[f.path] = sha256(f.bytes);
  }
  const provenance: Record<string, unknown> = {
    version: SCAFFOLD_VERSION,
    astroPin: tokens.ASTRO_VERSION,
    starlightPin: tokens.STARLIGHT_VERSION,
  };
  if (selection.diagrams) provenance.diagramContract = DIAGRAM_CONTRACT;
  provenance.files = provFiles;
  emit(".doc-site-scaffold.json", JSON.stringify(provenance, null, 2) + "\n", false);

  const out = new Map<string, string>();
  for (const f of files) out.set(f.path, f.bytes);
  return out;
}
