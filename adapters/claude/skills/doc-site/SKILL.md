---
# GENERATED — DO NOT EDIT. Source: skills/doc-site/SKILL.md. Regenerate: bun run build
name: doc-site
description: Scaffolds an Astro 5/6 + Starlight documentation site into a target repo from an agent-driven interview. Use when the user wants to add a docs site, set up Starlight/Astro documentation, wire a manifest-driven sidebar and content symlinks, or add docs deploy/diagram/drift-guard tooling to a project.
argument-hint: "[target repo path]"
metadata:
  argument-hint: "[target repo path]"
  allowed-tools: Read, Edit, Write, Bash
---

# doc-site

Scaffold a canon-faithful **Astro 5/6 + Starlight** documentation site into a target
repo. You drive a short interview, then mechanically emit a set of component-gated
template assets: you never author plumbing file content — you read each `.tmpl`
asset, substitute every token placeholder (table below), and write the result. Because
substitution is pure string replacement over byte-identical `.tmpl` assets, the
emitted file set is a pure function of the interview answers (REQ-PORT-02).

The skill is **additive and safe**: it writes only inside the target repo, refuses
symlink sources that escape the repo root, and never transmits repo data externally
(network use is limited to version resolution and dependency install).

## Reference docs (pull in as needed, per phase)

These ride verbatim under `references/`; read the one for the phase/component you are
working on rather than loading everything up front.

- **`references/detect.md`** — Phase 1 detection probes + graceful-degradation table.
- **`references/interview.md`** — Phase 2 interview parameters + detection-seeded defaults.
- **`references/core.md`**, **`references/manifest-schema.md`** — core scaffold emit +
  `docs.manifest.json` contract and the `unmanaged` escape hatch.
- **`references/symlink.md`** — `setup-docs.sh` symlink/mixed layer.
- **`references/diagrams.md`** — optional diagram component (vendored renderer + prebuild).
- **`references/deploy-github-pages.md`**, **`references/deploy-vercel.md`**,
  **`references/deploy-static-netlify.md`** — deploy wiring per target.
- **`references/monorepo.md`** — monorepo workspace + root-script merge semantics.
- **`references/drift-guard.md`** — optional `check-docs.mjs` drift guard.
- **`references/rerun.md`** — provenance manifest, re-run/never-clobber policy,
  version-pin policy, safety policy, and the build smoke-test gate.
- **`references/docs.manifest.schema.json`** — the static manifest schema shipped into the target.

## Phased procedure

### Phase 1 — detect (`references/detect.md`)

Run network-free, read-only probes against the target repo: monorepo-vs-single,
package manager, runtime, existing docs, existing CI, default branch, and repo slug.
Detection is **best-effort, never a hard prerequisite** — every missing signal yields
a fallback default plus an assumption record (`00 §6.2`). The only legitimate
hard-fail is `HARD_FAIL_IMPOSSIBLE` (no writable tree).

### Phase 2 — interview (`references/interview.md`)

Ask the minimum parameter set (site title/description, social links, content-sourcing
mode, markdown→sidebar-slug mapping, deploy targets, accent colors, docs-package
location), seeding each default from Phase 1. This fills the substitution table.
Optional components (diagrams, deploy targets, drift guard) default to **declined**.

### Phase 3 — component-select (`00 §5`)

Resolve the component-selection record:

```jsonc
{ "contentMode": "symlink"|"native"|"mixed", "diagrams": false,
  "deploy": [], "driftGuard": false, "monorepo": false, "titleShim": false }
```

This record alone decides which template groups emit. Declining a component emits
**zero** of its files (the decline-all invariant): `core/` always; exactly one of
`content-config-plain/` (`!titleShim`) or `content-config-shim/` (`titleShim`);
`symlink/` when `contentMode ∈ {symlink, mixed}`; `diagrams/` when `diagrams`;
`deploy/*` per `deploy[]`; `drift-guard/` when `driftGuard`; `monorepo/` when
`monorepo`. `titleShim` is set by interview §5a (the title-frontmatter menu) and
defaults to `false`.

### Phase 4 — emit (`references/core.md`, `symlink.md`, `diagrams.md`, `deploy-*.md`, `monorepo.md`, `drift-guard.md`)

For each selected template group: read each `.tmpl`, globally replace every
token placeholder with its resolved value, strip the `.tmpl` extension, and write to the
target path the component doc specifies (copy non-`.tmpl` assets verbatim). After
writing each **managed plumbing** file, record its sha256 in `.doc-site-scaffold.json`
(`references/rerun.md`); `source: native` authored pages are never recorded. On a
re-run, honor the never-clobber decision table (EMIT / REGENERATE / SKIP_FLAG /
PRESERVE).

### Phase 5 — run setup-docs (`references/symlink.md`) — symlink/mixed only

When `contentMode ∈ {symlink, mixed}`, run the emitted `setup-docs.sh` to materialize
the content symlinks (and the `images/` link). Skip entirely in native mode.

### Phase 6 — build smoke test (`references/rerun.md`; REQ-VERIFY-01)

Install deps, then run the emitted build (after setup-docs and any diagram prebuild).
**Require green:** any nonzero exit is `BUILD_RED` — report the failed step and
remediation and **never report success on red**. A failure mid-emission is
`PARTIAL_EMISSION`: no rollback, flag the partial state and the failed step.

### Phase 7 — next steps (`references/rerun.md`; REQ-VERIFY-03)

Print run/preview/deploy guidance and the collected assumption records so the user
can see every degraded default that was applied.

## Substitution table (the SKILL-side mirror of `00 §4.1`)

This is the single place tokens are documented for the agent. It lists **exactly**
the 18 canonical tokens — no more, no fewer. Every token used anywhere under
`references/templates/**` must appear here, and vice-versa (token-coverage test, `10`).

| Token                      | Source                                                           | Default                                        |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `{{SITE_TITLE}}`           | interview                                                        | repo name (titlecased)                         |
| `{{SITE_TITLE_SLUG}}`      | **derived** (slugified `{{SITE_TITLE}}`: lowercase, spaces→`-`)  | derived                                        |
| `{{SITE_DESC}}`            | interview                                                        | `Documentation for <title>`                    |
| `{{SITE_URL}}`             | interview / deploy target                                        | `""` (env-driven at build)                     |
| `{{BASE_PATH}}`            | deploy target (GH Pages subpath vs root)                         | `""`                                           |
| `{{REPO_SLUG}}`            | detection (`git remote`) / interview                             | ask                                            |
| `{{GITHUB_URL}}`           | derived from `{{REPO_SLUG}}`                                     | `""`                                           |
| `{{PKG_MANAGER}}`          | detection (lockfile / `packageManager`)                          | `npm`                                          |
| `{{RUNTIME}}`              | detection (`bun.lock` / `engines.node`)                          | `node`                                         |
| `{{DOCS_PKG_DIR}}`         | interview                                                        | `docs/` (single) / `packages/docs/` (monorepo) |
| `{{IMAGES_SRC_DIR}}`       | interview / detection                                            | `docs/images`                                  |
| `{{ACCENT_LIGHT}}`         | interview                                                        | canon default light accent                     |
| `{{ACCENT_DARK}}`          | interview                                                        | canon default dark accent                      |
| `{{DEFAULT_BRANCH}}`       | detection (`git symbolic-ref`)                                   | `main`                                         |
| `{{ASTRO_VERSION}}`        | resolution (latest @ first scaffold; pin on re-run)              | latest                                         |
| `{{STARLIGHT_VERSION}}`    | resolution                                                       | latest                                         |
| `{{DOCS_PKG_DIR_TO_ROOT}}` | **derived** (one `..` per `{{DOCS_PKG_DIR}}` segment)            | derived                                        |
| `{{SYMLINK_PAGE_LINES}}`   | **derived/generated** (one link line per `source: symlink` page) | generated                                      |

**Direct vs. derived.** Most tokens are direct interview/detection values.
`{{DOCS_PKG_DIR_TO_ROOT}}` is a pure function of `{{DOCS_PKG_DIR}}` (count path
segments → that many `..`), and `{{SYMLINK_PAGE_LINES}}` expands to a generated block
from the manifest's `source: symlink` pages (`references/symlink.md`). After
substitution, **no literal `{{…}}` may survive** in any emitted file.
