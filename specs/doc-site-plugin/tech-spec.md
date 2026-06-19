# Docs Site Generator (`doc-site-plugin`) — Technical Specification

> Slug: `doc-site-plugin` · Stage: forge-2-tech · Based on: forge-1-prd v2 ·
> Source design: `.reference/canon.md` · Sibling contract: `diagram-generator` v1.0.0

## 1. Overview

`doc-site-plugin` is a **canonical skill** authored in this repo (`agent-docs`)
that scaffolds an Astro 5 + Starlight docs site into any target repo from a
short, agent-driven interview (CON-01, CON-02, CON-03). It is **not** TypeScript
implementation code — it is a markdown orchestration procedure (`SKILL.md` +
per-component reference docs) plus a tree of **parameterized template assets**.
The existing `agent-agnostic-scaffold` emitter pipeline emits it byte-identically
to all five agent targets via `bun run build`; **no `src/` emitter changes are
required** — adding this tool is purely additive (a new `skills/doc-site-plugin/`
directory and one `tools.manifest.json` entry).

### Key architectural decisions

1. **Template assets + `{{TOKEN}}` substitution** (not inline file bodies, not
   logic-templates). Scaffolded files come from literal `.tmpl` assets with a
   fully-specified substitution table in `SKILL.md`. This is the keystone for
   REQ-PORT-02: the generator's *output* is byte-identical regardless of which
   agent drove the interview, because the agent does mechanical fill + write, not
   content authoring.
2. **Single JSON manifest + committed JSON Schema** (`docs.manifest.json` /
   `docs.manifest.schema.json`) drives sidebar + symlinker + drift check
   (REQ-CONTENT-03). Validatable, agent-writable, portable across Node/Bun repos.
3. **Portable emitted runtime scripts**: POSIX `sh` symlinker (`setup-docs.sh`) +
   a single node/bun-compatible `check-docs.mjs` drift guard.
4. **Diagram delegation by vendoring**: the generator copies the
   `diagram-render.mjs` bundle from its **sibling skill in the same adapter
   bundle** into the target repo, pinned to the renderer's `CONTRACT_VERSION`
   (REQ-DIAG-02/03, CON-05). The prebuild hook invokes the vendored copy, so the
   smoke test exercises **real** diagram generation.
5. **Provenance manifest with content hashes** (`.doc-site-scaffold.json`)
   distinguishes generator-owned plumbing from user-edited / authored content for
   safe re-run (REQ-RERUN-01/02).
6. **Component-gated emission**: each optional component (diagrams, each deploy
   target, drift guard, symlink mode) is a self-contained template group emitted
   only when selected; declining everything yields zero files for declined
   components (REQ-USE-01).

## 2. Module Structure

This feature ships as a skill directory plus small additions to the in-repo
verification surface. Location and layout:

```
skills/doc-site-plugin/
  SKILL.md                       # lean phased procedure + substitution table
  references/
    detect.md                    # detection rules + graceful-degradation table
    interview.md                 # interview script + per-parameter defaults
    core.md                      # core scaffold emit instructions
    symlink.md                   # symlink/mixed content layer + setup-docs
    diagrams.md                  # diagram component + vendoring + prebuild wiring
    deploy-github-pages.md
    deploy-vercel.md
    deploy-static-netlify.md
    drift-guard.md               # check-docs emit + rule set + custom-rule hook
    rerun.md                     # provenance manifest + never-clobber policy
    manifest-schema.md           # docs.manifest schema reference + escape hatch
  assets/
    docs.manifest.schema.json    # shipped into target repo (and authored here)
    templates/
      core/        astro.config.mjs.tmpl, package.json.tmpl, tsconfig.json.tmpl,
                   content.config.ts.tmpl, custom.css.tmpl, favicon.svg,
                   index.mdx.tmpl, starter-page.mdx.tmpl
      symlink/     setup-docs.sh.tmpl
      diagrams/    diagrams.prebuild.snippet.tmpl   # package.json script fragment
      deploy/github-pages/docs.yml.tmpl
      deploy/vercel/vercel.json.tmpl
      deploy/static/netlify.toml.tmpl  (+ static-host instructions)
      drift-guard/ check-docs.mjs.tmpl
      monorepo/    workspace + root passthrough script fragments
```

**Public API surface** (how it is consumed): the skill is emitted to
`adapters/<agent>/...` per-target shapes by the existing pipeline; an engineer
invokes it conversationally through their coding agent (CON-03). There is no
standalone generator binary — the SKILL.md body *is* the procedure.

**In-repo additions** (verification only):

- `tools.manifest.json` — one new `{ "name": "doc-site-plugin", "type": "skill",
  "source": "skills/doc-site-plugin" }` entry.
- `src/test/golden.shared.ts` — add `doc-site-plugin` to `SAMPLE_RELPATHS`;
  regenerate goldens (`src/test/__golden__/<target>/...`).
- New tests under `src/test/` for template-asset validation and scaffold-output
  golden fixtures (see §8).
- `schemas/` — the docs.manifest schema is authored here (Zod → generated JSON
  Schema via the existing `schema-gen` pattern) and copied into the asset tree;
  drift-guarded by `schema:check`.

## 3. Technical Decisions

### 3.1 Authored as a skill via the existing emitter (CON-02, REQ-PORT-02)

The deliverable is a skill (matches the `docs-helper` reference pattern; the
`commands/` tree is empty/unused). The pure, deterministic emitter already
guarantees byte-identical emission of the *skill files* across targets; this
spec's job is to also make the *scaffolded output* byte-identical — achieved via
§3.2.

**Alternatives considered:** authoring as a `command` (no precedent in repo,
same emission machinery, no benefit). Rejected.

### 3.2 Template assets + `{{TOKEN}}` substitution (REQ-PORT-02, REQ-CORE-01)

Reference files live as literal `.tmpl` assets under `assets/templates/<component>/`
and ride verbatim to every adapter bundle. `SKILL.md` carries a **substitution
table** mapping each `{{TOKEN}}` to an interview-derived value with an explicit
default. The agent performs mechanical token replacement and writes the result —
it never improvises file content. This makes the emitted file set a pure function
of the interview answers, satisfying REQ-PORT-02's build-time equivalence bar.

Substitution is plain string replacement of `{{TOKEN}}` occurrences; tokens use
`UPPER_SNAKE`. No conditionals/loops inside templates — component selection and
monorepo-vs-single are handled by **which template groups are emitted** and by
small named fragments (e.g. `monorepo/` workspace snippets), not by in-template
logic. This keeps determinism trivially verifiable.

**Alternatives considered:** inline file bodies in SKILL.md (harder to
golden-test, per-agent rendering drift); Handlebars-style logic templates (weaker
determinism, extra mental model). Both rejected; noted per the user's choice.

### 3.3 Core site scaffold (REQ-CORE-01/02/03, CON-01, CON-04)

Emits the canon's gold-master file set, parameterized: `astro.config.mjs`
(title/description/social/sidebar/`customCss`, `site`/`base` from `SITE`/`BASE_PATH`
env per REQ-CORE-02, `passthroughImageService()` per REQ-CORE-03), `package.json`,
`tsconfig.json`, `src/content.config.ts` (`docsLoader()` + `docsSchema()`),
`src/styles/custom.css` (accent-only theming), `public/favicon.svg`, an
`index.mdx` splash, and ≥1 authored starter page. Sidebar is generated from the
manifest (§3.4), never hand-kept in parallel.

### 3.4 Single manifest as source of truth (REQ-CONTENT-01..04, OQ-2)

`docs.manifest.json` validated by a committed `docs.manifest.schema.json`. Each
page entry records `slug`, `source` (`symlink` | `native`), and (for symlink) the
repo-root `from` path. The manifest feeds three consumers from one place: sidebar
generation, the symlinker, and the drift guard — eliminating the
three-places-to-sync hazard.

**Escape hatch (OQ-2 resolved):** a page entry may set `"unmanaged": true`. The
generator does not wire its sidebar/symlink; the user manages it manually. The
drift guard **exempts unmanaged pages from sidebar↔manifest parity** but still
applies broken-internal-link and required-frontmatter checks. This preserves the
single-source guarantee for managed pages while allowing edge cases.

### 3.5 Content-sourcing layer (REQ-CONTENT-02)

Symlink/mixed mode emits `setup-docs.sh` (POSIX `sh`): manifest-driven
relative-path symlinks from the content dir to repo-root docs, with
`--no-dereference` (`-n`) care for the `images/` **directory** symlink and an
`.astro` cache clear after relinking. Native mode emits no symlinker. `predev`/
`prebuild` wiring is added only when symlink/mixed is selected.

### 3.6 Diagram component — delegation by vendoring (REQ-DIAG-01/02/03, CON-05)

When selected, the generator **copies `diagram-render.mjs` from the sibling
`diagram-generator` skill in the same adapter bundle** (relative path
`../diagram-generator/scripts/diagram-render.mjs`) into the target repo (e.g.
`scripts/diagram-render.mjs`), after verifying `--version` matches the pinned
`CONTRACT_VERSION` (`1.0.0`). This keeps diagram-generator the single source of
the bundle (no duplicate to drift). The emitted `prebuild` hook invokes the
vendored copy per the **frozen v1.0.0 contract**, using `--out-file` or
`--out-dir` + `--out-name` for **predictable, slug-independent** output paths
(the `<slug>.<theme>` derived name is explicitly not relied upon). Light+dark
variants are produced by invoking twice (`--theme light` / `--theme dark`); there
is no `--theme both`.

When the component is declined, **zero** diagram files/hooks are emitted
(REQ-DIAG-01, REQ-USE-01). The build smoke test (REQ-VERIFY-01) runs the real
prebuild, exercising end-to-end diagram generation (REQ-DIAG-03), and must
produce artifacts.

**Failure handling:** the prebuild treats any nonzero exit from the renderer as a
build failure (exit codes 2/3/4/5/6/64 per the contract). For `--format both`,
the SVG-then-PNG ordering means a PNG failure (exit 5) may leave a written SVG;
the wiring surfaces the failure (REQ-VERIFY-02) rather than masking it.

### 3.7 Deploy targets (REQ-DEPLOY-01/02)

All targets share the single env-driven `site`/`base` mechanism; selecting a
target never requires hand-editing site code. Emitted per selection:

- **GitHub Pages**: `.github/workflows/docs.yml` with `SITE`/`BASE_PATH` from the
  Pages action, path-filtered triggers, toolchain matched to detection
  (Bun+pnpm or Node+npm).
- **Vercel**: root-hosted static output (`base` empty, `site` = production URL),
  `vercel.json` / settings note; no base-path juggling.
- **Generic static / Netlify**: plain build to `dist/` + `netlify.toml` or
  documented static-host instructions; `base` configurable.

### 3.8 Drift guard (REQ-DRIFT-01/02)

Emits `check-docs.mjs` (node/bun compatible) wired into the repo's gate/CI.
Generic rule set: broken internal links, sidebar↔manifest parity (skipping
`unmanaged` pages), orphaned symlinks, pages missing required frontmatter.
Documented extension point (`drift-guard.md`) lets a repo add project-specific
rules without forking — e.g. a conventional `docs.drift.rules.mjs` the script
imports if present.

### 3.9 Idempotent re-run & never-clobber (REQ-RERUN-01/02, REQ-REL-01, OQ-3)

The generator writes a **provenance manifest** `.doc-site-scaffold.json`
recording, for each generator-owned plumbing file: path, content hash (sha256),
and scaffold version. On re-run:

- Managed file present, hash matches record → safe to regenerate (overwrite).
- Managed file hash differs from record → user-edited → **skip + report** (OQ-3
  policy: skip-and-flag, never silent clobber).
- Authored content pages (`source: native`) are **never** tracked for overwrite —
  always preserved (REQ-RERUN-02).
- Manifest/sidebar/symlinks are updated in place.

Combined with deterministic substitution, a second identical run yields a no-op
git diff modulo regenerated build caches (REQ-REL-01).

### 3.10 Version resolution (REQ-REL-02, REQ-RERUN-01, OQ-1)

First scaffold resolves **latest** Astro/Starlight and writes the resolved pins
into the emitted `package.json`. Re-run **preserves** existing pins (a bump is an
explicit, opt-in action, never a re-run side effect). An opt-in interview choice
(/ pin flag) lets the user pin to a documented known-good fallback set when they
want reproducibility or when latest is broken — resolving OQ-1 minimally.

### 3.11 Portability / monorepo (REQ-PORT-01/03)

Emitted toolchain wiring matches detected package manager + runtime. For
monorepo targets the generator registers the docs package in the workspace
manifest (`pnpm-workspace.yaml` or root `package.json` `workspaces`) and emits
root passthrough scripts (`dev:docs` / `build:docs`), so the site is a
first-class workspace member.

## 4. Data Model

### 4.1 `docs.manifest.json` (target repo)

```jsonc
{
  "site": { "title": "...", "description": "...", "social": { "github": "..." } },
  "pages": [
    { "slug": "intro", "source": "symlink", "from": "docs/intro.md" },
    { "slug": "guides/setup", "source": "native" },
    { "slug": "legacy", "unmanaged": true }
  ]
}
```

Validated by `docs.manifest.schema.json`. `source` ∈ {`symlink`,`native`};
`from` required iff `source: symlink`; `unmanaged` (bool, default false) exempts
the page from generator wiring + parity checks. Strict (`additionalProperties:
false`).

### 4.2 `.doc-site-scaffold.json` (target repo, provenance)

```jsonc
{
  "version": "1.0.0",
  "diagramContract": "1.0.0",
  "files": { "astro.config.mjs": "sha256:...", "setup-docs.sh": "sha256:..." }
}
```

### 4.3 In-repo template substitution table (authored in SKILL.md)

`{{TOKEN}}` → interview value + default, e.g. `{{SITE_TITLE}}`, `{{SITE_URL}}`,
`{{BASE_PATH}}`, `{{REPO_SLUG}}`, `{{PKG_MANAGER}}`, `{{DOCS_PKG_DIR}}`,
`{{ACCENT_LIGHT}}`, `{{ACCENT_DARK}}`, `{{DEFAULT_BRANCH}}`.

## 5. API Design (invocation contracts)

### 5.1 Skill invocation (consumer)

Agent-driven, conversational. Phased procedure: **detect → interview →
component-select → emit → run setup-docs → build smoke test → print next steps**.

### 5.2 Vendored diagram renderer (consumed contract, frozen v1.0.0)

```
node scripts/diagram-render.mjs <spec.json> \
  --type <architecture|flowchart|sequence|er|state|dataflow> \
  --theme <light|dark> --accent '#rrggbb' \
  --format <svg|png|both> --out-file <path>            # or --out-dir + --out-name
# --version -> prints CONTRACT_VERSION, exit 0
# exit codes: 0 ok · 2 input · 3 render · 4 output · 5 png · 6 io · 64 usage
```

Predictable paths via `--out-file` / `--out-dir`+`--out-name` only. No network;
path-confined writes. Source of truth: `specs/diagram-generator/05-cli-and-invocation.md`,
`skills/diagram-generator/scripts/diagram-render.mjs`.

## 6. Integration Points

| Existing module | Relationship | Contract / notes |
| --- | --- | --- |
| `agent-agnostic-scaffold` emitter (`src/emit.ts`, `src/targets/*`, `src/discover.ts`, `src/publish.ts`) | doc-site-plugin is emitted by it; **no code changes** | Skill dir + `references/` + `assets/` (incl. `scripts/`-style verbatim copies) ride to each adapter. Owned refs land at per-target paths (`skills/<name>/references/...` etc.). |
| `tools.manifest.json` (Zod `Manifest`/`ToolEntry` in `src/model.ts`) | Register the tool | Add `{ name:"doc-site-plugin", type:"skill", source:"skills/doc-site-plugin" }`. |
| `diagram-generator` skill (`skills/diagram-generator/scripts/diagram-render.mjs`, contract `src/diagram/schema.ts:CONTRACT_VERSION="1.0.0"`) | **Hard prerequisite**; sibling in every adapter bundle | doc-site copies the bundle from the sibling's relative path at scaffold time and invokes per the frozen contract. |
| Golden tests (`src/test/golden.shared.ts` `SAMPLE_RELPATHS`, `src/test/__golden__/`, `src/test/golden.test.ts`) | Must include the new tool | Regenerate goldens; `build:check` drift gate covers cross-agent byte-identity. |
| `schemas/` + `schema-gen` (`src/schema-gen.ts`, `schema:check`) | Authors `docs.manifest.schema.json` | Generate from Zod, commit, copy into asset tree; drift-guarded. |
| `gate` script | Runs the new tests | `compile → schema:check → typecheck → lint → format:check → test → build:check → build:diagram:check`. |

**Cross-agent path note:** within each adapter bundle the renderer sits at
`<bundle>/skills/diagram-generator/scripts/diagram-render.mjs` (Claude/Codex/
Gemini layout) — the diagrams reference doc must account for per-target skill
path differences (Copilot uses `instructions/<name>/...`, Cursor `rules/<name>/...`)
when telling the agent where to read the sibling bundle from. **WARNING: verify
the exact per-target owned-script path for each of the five adapters before
finalizing `diagrams.md`, since copilot/cursor place skill-owned files under
different roots than claude/codex/gemini.**

**No in-progress conflicts:** `agent-agnostic-scaffold` and `diagram-generator`
are both complete; doc-site-plugin's changes are additive.

## 7. Error Handling

- **Detection ambiguity** (REQ-DETECT-02): proceed with sane defaults, flag every
  assumption (REQ-USE-02); hard-fail only when scaffolding is genuinely impossible.
- **Build smoke-test failure** (REQ-VERIFY-02): report the failure + remediation;
  never report success on a red build.
- **Partial emission** (REQ-VERIFY-04): emission is non-transactional and does
  **not** roll back; on mid-emission failure the generator flags the partial
  state and names the failed step. Recovery is a re-run (never-clobber,
  manifest-driven merge). This is intentionally distinct from the renderer's own
  per-artifact no-partial-writes guarantee.
- **Diagram renderer nonzero exit**: surfaced as a build failure with the exit
  code/message; not masked.
- **Manifest schema violation**: rejected with the schema error before any wiring.

## 8. Testing Approach

In-repo verification (the target-repo smoke test runs at scaffold time and cannot
run in agent-docs CI):

1. **Golden emission snapshots (5 targets)** — add `doc-site-plugin` to
   `SAMPLE_RELPATHS`; `golden.test.ts` + `build --check` assert byte-identical
   emission to all adapters (REQ-PORT-02 for the tool itself).
2. **Template-asset validation** — a test asserting every `{{TOKEN}}` in
   `assets/templates/**` is documented in SKILL.md's substitution table (and
   vice-versa: no undefined/orphan tokens), and that `docs.manifest.schema.json`
   is valid and matches the schema-gen output.
3. **Scaffold-output golden fixtures** — fixed interview-answer sets (e.g.
   single-package symlink mode; monorepo mixed mode) applied to the templates,
   asserted byte-for-byte against checked-in resolved outputs under
   `src/test/__scaffold_golden__/`. Proves the substitution procedure is
   deterministic / agent-agnostic without a live agent.

Tooling: `vitest` (`vitest run`), co-located `*.test.ts`, fixtures under
`src/test/__fixtures__/`. Coverage target: every emitted template covered by ≥1
scaffold-output fixture; every documented token exercised.

## 9. Dependencies

- **Internal (hard prerequisite):** `diagram-generator` skill + its frozen
  `diagram-render.mjs` contract (v1.0.0), `agent-agnostic-scaffold` emitter,
  `schema-gen`. All complete/released.
- **External (in emitted target site, resolved at scaffold time):** `astro@^5`,
  `@astrojs/starlight` (latest at scaffold; pinned into target `package.json`).
  No new external dependency is added to `agent-docs` itself.
- **No new runtime dependency** in this repo — the feature is markdown + template
  assets + test code.

## 10. Open Technical Questions

- **OQ-1 (resolved):** latest at first scaffold, preserve on re-run, opt-in pin
  to a documented known-good fallback set.
- **OQ-2 (resolved):** escape hatch = per-page `unmanaged: true`, exempt from
  parity only; links + frontmatter still checked.
- **OQ-3 (resolved):** never-clobber via `.doc-site-scaffold.json` content-hash
  provenance; skip-and-flag on user edits; native pages always preserved.
- **OQ-4 (resolved upstream):** diagram contract is the shipped v1.0.0 artifact.
- **Remaining to confirm during forge-3-specs:** exact per-target owned-script
  path for each of the five adapters (where `diagram-render.mjs` lands in the
  copilot/cursor bundles vs claude/codex/gemini) so `diagrams.md` tells the agent
  the correct sibling path per agent. (See §6 WARNING.)
```