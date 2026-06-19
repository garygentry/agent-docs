# Docs Site Generator — Product Requirements Document

> Slug: `doc-site-plugin` · Stage: forge-1-prd v1 · Source design: `.reference/canon.md`

## 1. Problem Statement

Teams that want the "repo markdown is the single source of truth, the docs site
is a thin deployable view over it" setup currently have to hand-copy a working
implementation (the `rauf` monorepo's `packages/docs/` Astro Starlight site) into
each new repo and rewire it by hand. That copy-and-rewire is slow, error-prone,
and drifts: the sidebar, the symlinker, and the drift-check are kept in sync by
human discipline, and every repo's package manager, runtime, deploy target, and
content layout differ.

We want a reusable generator that scaffolds an equivalent docs site into any
target repo from a short interview, so a team gets a building, deployable,
drift-guarded docs site in one pass instead of a manual port. The reference
design ("canon") already exists; this PRD specifies the generator that produces
it.

This matters now because this repo (`agent-docs`) exists precisely to author
agent tooling once in Claude-native form and emit it to every coding-agent
target. A docs-site generator is a natural, high-value tool to author here.

## 2. User Stories

- **As an engineer setting up a new repo**, I want my coding agent to scaffold a
  working Astro Starlight docs site from a short interview, so that I get a
  building, deployable site without hand-porting a reference implementation.
- **As an engineer with existing `docs/*.md` specs**, I want those files
  symlinked into the site as the single source of truth, so that my docs and my
  site never diverge.
- **As an engineer who prefers authoring in the site**, I want a native mode (or
  a mixed mode) so I am not forced into symlinks.
- **As an engineer on GitHub Pages / Vercel / a generic static host**, I want the
  correct deploy wiring emitted for my chosen target(s) so the same build works
  on a subpath or at root without code changes.
- **As an engineer re-running the generator** on an already-scaffolded repo, I
  want it to update plumbing in place and never clobber pages I have edited.
- **As a maintainer**, I want a drift guard wired into the repo's gate so the
  thin-view site stays honest over time.
- **As a tool author in this repo**, I want the generator authored once in
  Claude-native form and emitted to all five agent targets, so it behaves
  consistently regardless of which coding agent a downstream engineer uses.

## 3. Functional Requirements

### 3.1 Detection & Interview

- **REQ-DETECT-01** (P0): The generator MUST detect target-repo shape before
  interviewing: monorepo vs single package, package manager, runtime (Bun vs
  Node), presence of existing `docs/` markdown, existing CI, default branch, and
  repo slug/remote.
- **REQ-DETECT-02** (P0): When detection is ambiguous or a signal is missing, the
  generator MUST degrade gracefully — proceed with sane defaults (e.g. assume
  single-package, default to npm/Node, ask for the repo slug) while clearly
  flagging every assumption it made. It MUST hard-fail only when scaffolding is
  genuinely impossible.
- **REQ-INT-01** (P0): The generator MUST interview the user (conversationally,
  driven by the invoking coding agent) to capture, at minimum: site title &
  description, social links, content-sourcing mode (symlink / native / mixed),
  the mapping of existing markdown files to sidebar slugs, deploy target(s),
  accent colors / brand, and docs-package location.
- **REQ-INT-02** (P0): Every undetected parameter MUST be obtainable through the
  interview with a suggested default; detection is best-effort and never a hard
  prerequisite for a parameter that the user can supply.

### 3.2 Core Site Scaffold

- **REQ-CORE-01** (P0): The generator MUST emit a complete, buildable Astro
  Starlight docs package: Starlight config, package manifest, TypeScript config,
  content-collection config, accent-color styling, a favicon asset, a splash
  landing page, and at least one authored starter page.
- **REQ-CORE-02** (P0): The emitted config MUST derive `site`/`base` from
  environment so the same build works on a hosted subpath (GitHub Pages) and at
  root (Vercel / static) without code changes.
- **REQ-CORE-03** (P0): The emitted site MUST avoid a heavyweight image
  dependency for SVG diagrams (i.e. use a passthrough image service) so installs
  stay lightweight.

### 3.3 Content-Sourcing Layer

- **REQ-CONTENT-01** (P0): The generator MUST support three selectable
  content-sourcing modes: **symlink** (repo markdown is the source of truth),
  **native** (pages authored in the site), and **mixed** (per-page choice).
- **REQ-CONTENT-02** (P0): In symlink/mixed mode, the generator MUST emit an
  idempotent symlinker that creates relative-path symlinks from the content
  directory to repo-root docs (with correct no-dereference handling for the
  images directory and a build-cache clear after relinking).
- **REQ-CONTENT-03** (P0): A single canonical manifest MUST drive the sidebar,
  the symlinker, and the drift check from one source so the three cannot drift
  apart. The manifest is the strong default source of truth; a documented escape
  hatch MAY allow advanced users to bypass it for edge cases.
- **REQ-CONTENT-04** (P0): Each manifest page entry MUST record its source
  (`symlink` | `native`) so mixed mode is fully expressible.

### 3.4 Diagrams (optional component)

- **REQ-DIAG-01** (P0): The generator MUST offer a generated-SVG-diagram
  component (generation step + image-service wiring + prebuild hook). When the
  user declines it, the generator MUST omit it cleanly, leaving no dangling hooks
  or references.
- **REQ-DIAG-02** (P0): When the diagram component is selected, diagram
  generation MUST delegate to the separate `diagram-generator` skill (the canonical
  text-to-diagram tool authored in this repo) rather than embedding a bespoke,
  repo-specific generation script. The emitted prebuild wiring invokes that skill.
- **REQ-DIAG-03** (P0): The emitted prebuild wiring MUST conform to the released
  `diagram-generator` scriptable invocation contract, and the build smoke test
  (REQ-VERIFY-01) MUST exercise real diagram generation end-to-end — confirming
  the wiring actually produces diagram artifacts, not merely that hooks are present.

### 3.5 Deploy Targets

- **REQ-DEPLOY-01** (P0): The generator MUST emit deploy wiring for any selected
  subset of: **GitHub Pages** (CI workflow with environment-driven `site`/`base`
  and path-filtered triggers, matched to the detected toolchain), **Vercel**
  (root-hosted static output with no base-path juggling), and **generic static /
  Netlify** (plain build to a `dist/`-equivalent plus host config or documented
  instructions).
- **REQ-DEPLOY-02** (P0): All deploy targets MUST share the single
  environment-driven `site`/`base` mechanism; selecting a target MUST NOT require
  hand-editing site code.

### 3.6 Drift Guard

- **REQ-DRIFT-01** (P0): The generator MUST emit a drift-guard script and wire it
  into the repo's gate/CI, shipping a set of generic rules: broken internal
  links, sidebar↔manifest parity, orphaned symlinks, and pages missing required
  frontmatter.
- **REQ-DRIFT-02** (P0): The drift guard MUST be documented so a repo can add its
  own project-specific rules without forking the tool.

### 3.7 Idempotent Re-run

- **REQ-RERUN-01** (P0): The generator MUST be safe to re-run against an
  already-scaffolded repo: it updates the manifest, sidebar, and symlinks in
  place rather than clobbering. On re-run the generator MUST preserve the
  Astro/Starlight version pins already written to the target rather than
  re-resolving to latest (which "always latest," REQ-REL-02, governs only at
  first scaffold), so idempotency (REQ-REL-01) holds; a version bump is an
  explicit, opt-in action, never a side effect of a re-run.
- **REQ-RERUN-02** (P0): The generator MUST NOT overwrite files a user has
  hand-edited since the last scaffold. On divergence it skips or prompts; authored
  content pages are always preserved.

### 3.8 Verification / Completion

- **REQ-VERIFY-01** (P0): Before declaring success, the generator MUST run the
  emitted build as a smoke test (content setup + site build) and require it to go
  green.
- **REQ-VERIFY-02** (P0): On build failure, the generator MUST report the failure
  and the remediation rather than reporting success.
- **REQ-VERIFY-03** (P0): On success, the generator MUST print clear next steps
  (how to run, preview, and deploy the site).
- **REQ-VERIFY-04** (P0): The generator's own multi-file emission is
  non-transactional: if it fails partway through emission (e.g. after writing
  some config/scripts/symlinks), it MUST NOT attempt a rollback but MUST clearly
  flag that the target tree is in a partial state and report which step failed. A
  partially-scaffolded repo is recoverable by re-running the generator, which
  reconciles the tree in place per REQ-RERUN-01 (never-clobber, manifest-driven
  merge). This is intentionally distinct from the `diagram-generator` sibling
  tool's no-partial-writes guarantee, which applies only to that tool's own
  single-artifact output.

## 4. Non-Functional Requirements

### 4.1 Reliability / Determinism

- **REQ-REL-01** (P0): Re-running the generator with the same inputs MUST be
  idempotent at the file-and-symlink level: a second identical run MUST yield a
  no-op git diff in the target tree, modulo regenerated build caches (e.g. the
  `.astro` cache).
- **REQ-REL-02** (P0): The generator MUST resolve to the latest Astro / Starlight
  versions at scaffold time. (Trade-off accepted: newer over strictly
  reproducible; see Open Questions OQ-1.)

### 4.2 Security / Safety

- **REQ-SEC-01** (P0): The generator MUST only write within the target repo's
  tree.
- **REQ-SEC-02** (P0): Emitted symlinks MUST be confined to the repo tree (no
  links escaping the repo root).
- **REQ-SEC-03** (P0): The generator MUST NOT transmit repo contents to any
  external service.

### 4.3 Portability / Compatibility

- **REQ-PORT-01** (P0): Emitted toolchain wiring (scripts, CI, package manifest)
  MUST match the target repo's detected package manager and runtime (Bun+pnpm or
  Node+npm, monorepo vs single package).
- **REQ-PORT-02** (P0): The generator's procedure MUST be agent-agnostic. The
  pass/fail equivalence bar is build-time, not runtime: given identical interview
  answers, the emitted file set (Starlight config, scripts, CI, package manifest,
  manifest) MUST be byte-identical regardless of which of the five supported
  coding agents drove the procedure, verified by a golden-output comparison
  across the five emitted tool forms. Runtime-conversational variation (how each
  agent phrases the interview) is inherently agent-dependent and is explicitly
  out of scope for this equivalence bar.
- **REQ-PORT-03** (P0): For monorepo targets, the generator MUST register the
  docs package in the workspace manifest (e.g. `pnpm-workspace.yaml` or the root
  `package.json` `workspaces` field) and emit root-level passthrough scripts
  (`dev:docs` / `build:docs` equivalents), matching the detected package manager,
  so the scaffolded site is a first-class workspace member rather than an
  unregistered package. (Reference: canon.md reference-implementation root
  `package.json` / `pnpm-workspace.yaml` row.)

### 4.4 Usability

- **REQ-USE-01** (P0): The interview MUST keep simple sites simple — optional
  components (diagrams, extra deploy targets, drift rules) MUST NOT be forced on a
  user who wants a minimal site. Concretely: when a user declines every optional
  component, the generator MUST emit zero files for those declined components (no
  dangling hooks, configs, or references), so a minimal site contains only the
  core scaffold.
- **REQ-USE-02** (P0): Every assumption made via graceful degradation MUST be
  surfaced to the user.

## 5. Constraints

- **CON-01**: The emitted stack is **Astro 5 + Starlight** specifically — this is
  the requirement, not a preference. The generator reproduces the canonical
  reference site, not a framework-agnostic docs tool.
- **CON-02**: The generator is authored as a **canonical tool in this repo**
  (`agent-docs`) under `skills/`/`commands/`, registered in
  `tools.manifest.json`, and emitted to all five agent targets (Claude, Codex,
  Copilot, Cursor, Gemini) via the existing `bun run build` pipeline — like the
  `docs-helper` sample tool.
- **CON-03**: The generator is **invoked by an engineer through their coding
  agent**; the interview is conversational, driven by the agent, not a standalone
  GUI.
- **CON-04**: The canonical design of record is `.reference/canon.md`; the
  generator's output must remain faithful to the reference mechanics it describes.
- **CON-05**: The diagram capability depends on a separate sibling tool,
  the **`diagram-generator`** skill (a canonical text-to-diagram tool authored in
  this repo, used by any feature that needs custom diagrams from text). The
  doc-site generator consumes it rather than reimplementing diagram generation.
  This dependency is a **hard prerequisite**: `diagram-generator` is implemented
  before doc-site-plugin, and doc-site-plugin's diagram component builds against
  the **released** `diagram-generator` skill and its scriptable contract. The
  doc-site build smoke test (REQ-VERIFY-01) therefore exercises real
  diagram generation end-to-end (REQ-DIAG-03).

## 6. Out of Scope

- **OOS-01**: Generators for non-Astro/Starlight doc frameworks (Docusaurus,
  MkDocs, etc.).
- **OOS-02**: Authoring the documentation content itself (prose, diagrams) — the
  tool scaffolds structure and wiring, not the user's actual docs.
- **OOS-03**: Performing the deploy or managing hosting accounts — the tool emits
  deploy config but does not deploy.
- **OOS-04**: Ongoing site maintenance / auto-upgrade / migration tooling beyond
  the idempotent re-run.

## 7. Open Questions

- **OQ-1**: "Always latest" Astro/Starlight (REQ-REL-02) trades reproducibility
  for currency. If a future scaffold breaks because of an upstream release, do we
  add a pinned-fallback mode? Revisit in the tech spec.
- **OQ-2**: Manifest escape hatch (REQ-CONTENT-03) — define exactly what bypass is
  permitted and how the drift guard treats manually-managed pages.
- **OQ-3**: Re-run divergence (REQ-RERUN-02) — finalize the skip-vs-prompt policy
  and how the generator distinguishes "plumbing" from "authored content" at
  re-run time.
- **OQ-4** (RESOLVED): `diagram-generator` interface (REQ-DIAG-02/03 / CON-05) —
  no longer open. `diagram-generator` is implemented before this feature, so its
  scriptable invocation contract (inputs, caller-specified output paths, exit
  behavior, supported diagram types) is a concrete, released artifact. This
  generator's prebuild wiring conforms to that shipped contract; see the
  `diagram-generator` spec for the authoritative interface.

## 8. Success Criteria

- Scaffolding into both a fresh single-package repo and a monorepo, in each
  content-sourcing mode, produces a site whose emitted build goes green.
- For each selected deploy target, the build output is correct for that host
  (GitHub Pages subpath assets resolve; Vercel/static root assets resolve).
- The emitted drift guard fails against an intentionally-broken page and passes
  against a clean tree.
- Re-running the generator on an already-scaffolded repo updates
  manifest/sidebar/symlinks in place with no destructive overwrite of edited
  pages.
- The tool is authored once in this repo and emits cleanly to all five agent
  targets via `bun run build`; given identical interview answers, the emitted
  file set is byte-identical across all five agent forms (REQ-PORT-02).
- A user's most likely complaint if we got it wrong — "it overwrote my edits" or
  "it claimed success but the site doesn't build" — is precluded by REQ-RERUN-02
  and REQ-VERIFY-01.
