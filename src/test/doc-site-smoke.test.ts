/**
 * Executable scaffold smoke tests (REQ-VERIFY-01, 10 §5). Unlike the byte-stable
 * golden suite, these RUN the emitted plumbing in throwaway temp repos with no
 * network dependency:
 *
 *  (a) `setup-docs.sh` — materializes the manifest-driven content symlinks. Asserts
 *      exit 0, RELATIVE links that resolve INSIDE the repo, and idempotency. The
 *      negative case (`from` escaping the repo) asserts exit 1 (REQ-SEC-02). This
 *      is what catches the symlink-path defect (out-of-repo `../docs/…` `from`).
 *  (b) `check-docs.mjs` — the drift guard. Asserts the `duplicate-slug` rule exits 2
 *      (manifest-validity error, distinct from exit 1 drift) with a matching finding.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ANSWERS_DIR,
  TEMPLATES_DIR,
  deriveTokens,
  loadAnswers,
  substitute,
} from "./doc-site-scaffold.shared.js";
import { finalScaffold } from "./doc-site-final-scaffold.shared.js";

const tmpRoots: string[] = [];
function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-site-smoke-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

/** Run `sh <script>` and return {status, stderr}; never throws on nonzero exit. */
function run(cmd: string, args: string[], cwd: string): { status: number; stderr: string } {
  try {
    execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer };
    return { status: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  }
}

describe("setup-docs.sh executable smoke (REQ-VERIFY-01 / REQ-SEC-02)", () => {
  it("creates relative in-repo symlinks and is idempotent (single-symlink fixture)", () => {
    const repo = mkRepo();
    const tree = finalScaffold(loadAnswers("single-symlink.json"));
    // Write the emitted docs package files we need: setup-docs.sh.
    const script = tree.get("docs/setup-docs.sh")!;
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs/setup-docs.sh"), script);

    // Materialize the repo-relative `from` source files + the images dir.
    fs.mkdirSync(path.join(repo, "docs/guides"), { recursive: true });
    fs.mkdirSync(path.join(repo, "docs/images"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs/getting-started.md"), "# Getting Started\n");
    fs.writeFileSync(path.join(repo, "docs/guides/usage.md"), "# Usage\n");

    const first = run("sh", ["docs/setup-docs.sh"], repo);
    expect(first.status, first.stderr).toBe(0);

    const contentDir = path.join(repo, "docs/src/content/docs");
    for (const slug of ["getting-started", "guides/usage"]) {
      const link = path.join(contentDir, `${slug}.md`);
      const st = fs.lstatSync(link);
      expect(st.isSymbolicLink(), `${slug}.md is not a symlink`).toBe(true);
      const target = fs.readlinkSync(link);
      expect(target.startsWith("/"), `${slug}.md link is absolute (${target})`).toBe(false);
      // Resolves to a real file INSIDE the repo.
      const resolved = fs.realpathSync(link);
      expect(resolved.startsWith(fs.realpathSync(repo)), `${slug} escapes repo`).toBe(true);
    }
    // images/ is a no-dereference dir symlink.
    expect(fs.lstatSync(path.join(contentDir, "images")).isSymbolicLink()).toBe(true);

    // Idempotent second run: exit 0, links still single-level (no images/images).
    const second = run("sh", ["docs/setup-docs.sh"], repo);
    expect(second.status, second.stderr).toBe(0);
    expect(fs.lstatSync(path.join(contentDir, "images")).isSymbolicLink()).toBe(true);
  });

  it("refuses a `from` that escapes the repo root (exit 1, REQ-SEC-02)", () => {
    const repo = mkRepo();
    const tokens = {
      ...deriveTokens(loadAnswers("single-symlink.json")),
      DOCS_PKG_DIR: "docs",
      DOCS_PKG_DIR_TO_ROOT: "..",
      IMAGES_SRC_DIR: "docs/images",
      SYMLINK_PAGE_LINES: 'link_file "../escape.md" "escape"',
    };
    const script = substitute(
      fs.readFileSync(path.join(TEMPLATES_DIR, "symlink/setup-docs.sh.tmpl"), "utf8"),
      tokens,
    );
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs/setup-docs.sh"), script);
    // The escaping target exists (above the repo) so only the confinement check rejects it.
    fs.writeFileSync(path.join(repo, "..", "escape.md"), "secret\n");

    const res = run("sh", ["docs/setup-docs.sh"], repo);
    expect(res.status, "expected exit 1 for out-of-repo from").toBe(1);
    expect(res.stderr).toMatch(/outside repo root/);
  });
});

describe("check-docs.mjs executable smoke — duplicate-slug rule (exit 2)", () => {
  it("exits 2 with a duplicate-slug finding for a duplicate-slug manifest", () => {
    const repo = mkRepo();
    const tree = finalScaffold(loadAnswers("single-symlink.json"));
    fs.writeFileSync(path.join(repo, "check-docs.mjs"), tree.get("docs/check-docs.mjs")!);
    // The duplicate-slug manifest fixture (schema-valid, but two pages share a slug).
    const dupe = fs.readFileSync(
      path.join(ANSWERS_DIR, "..", "manifests", "invalid-duplicate-slug.json"),
      "utf8",
    );
    fs.writeFileSync(path.join(repo, "docs.manifest.json"), dupe);

    const res = run(process.execPath, ["check-docs.mjs"], repo);
    expect(res.status, res.stderr).toBe(2);
    expect(res.stderr).toMatch(/\[duplicate-slug\]/);
  });
});

describe("check-docs.mjs executable smoke — frontmatter-link rule (#32)", () => {
  /** Minimal docs package whose only page is an index.mdx with the given hero link. */
  function scaffoldWithHeroLink(heroLink: string): string {
    const repo = mkRepo();
    const tree = finalScaffold(loadAnswers("single-symlink.json"));
    fs.writeFileSync(path.join(repo, "check-docs.mjs"), tree.get("docs/check-docs.mjs")!);
    // Empty manifest → no broken-link noise; the index.mdx body is link-free so
    // only the frontmatter hero link is under test. (The sidebar-parity rule was
    // retired — the sidebar is build-time derived — so no astro.config.mjs is needed.)
    fs.writeFileSync(path.join(repo, "docs.manifest.json"), JSON.stringify({ pages: [] }));
    const docs = path.join(repo, "src", "content", "docs");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(
      path.join(docs, "index.mdx"),
      `---\ntitle: Home\ntemplate: splash\nhero:\n  actions:\n    - text: Get Started\n      link: ${heroLink}\n---\n\nWelcome.\n`,
    );
    return repo;
  }

  it("flags a root-absolute hero link as base-unsafe (exit 1)", () => {
    const res = run(process.execPath, ["check-docs.mjs"], scaffoldWithHeroLink("/guides/setup/"));
    expect(res.status, res.stderr).toBe(1);
    expect(res.stderr).toMatch(/\[frontmatter-link\]/);
    expect(res.stderr).toMatch(/\/guides\/setup\//);
  });

  it("passes the shipped relative hero link (exit 0)", () => {
    const res = run(process.execPath, ["check-docs.mjs"], scaffoldWithHeroLink("guides/setup/"));
    expect(res.status, res.stderr).toBe(0);
  });
});
