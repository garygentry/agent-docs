# Agent-Agnostic Scaffold — Product Requirements Document

## 1. Problem Statement

The `agent-docs` repository will house coding-agent tooling (skills, agents, slash
commands, shared scripts, and references) aimed at documentation and support
workflows. These tools must work across multiple coding agents — Claude, Codex,
Cursor, Gemini, and Copilot — while being **optimized for Claude**.

Today there is no agreed structure or mechanism for authoring a tool once and
making it available to every agent. Hand-copying and hand-translating each tool
into each agent's native conventions is error-prone, drifts out of sync, and does
not scale as the tool set grows. Without a canonical source of truth and an
automated emit step, the repo cannot credibly claim multi-agent support, and
contributors won't know where or how to add a tool.

This feature establishes the foundation: a **canonical-core + adapters** authoring
system — a repo structure, a canonical (Claude-native) authoring format, an
emitter that generates per-agent adapter variants, and the conventions and guards
that keep them honest. It is the prerequisite scaffold on which all later
documentation tooling in this repo will be built. The actual documentation tools
themselves are out of scope here; this feature builds the workshop, not the
products.

## 2. User Stories

- **As a tool author**, I want to write a skill/agent/command once in Claude-native
  form and run a single build command, so that correct adapters for Codex, Cursor,
  Gemini, and Copilot are produced automatically without manual translation.
- **As a tool author**, I want a documented, predictable place and format to add a
  new tool, so that I don't have to reverse-engineer conventions from existing files.
- **As a tool author**, I want to add small per-target customizations where an
  automatic transform isn't good enough, without my edits being clobbered on the
  next build.
- **As a reviewer**, I want adapter changes to show up as reviewable diffs in the
  repo, so that I can see exactly what each agent will receive.
- **As a maintainer / CI**, I want a guard that fails when committed adapters drift
  from what the canonical source would emit, so that the repo never ships stale or
  hand-edited adapters that contradict the source of truth.
- **As a tool author**, I want a clear report of what mapped cleanly, what fell back,
  and what couldn't be represented for each target, so that I understand each agent's
  fidelity before relying on it.
- **As an adopter of another repo**, I want the canonical format and emitter to be
  reusable, so that I can establish the same agent-agnostic structure elsewhere.
- **As a Claude user**, I want the canonical side packaged as an installable Claude
  plugin, so that the Claude experience is first-class, not a derived afterthought.

## 3. Functional Requirements

### 3.1 Repository Structure & Conventions

- **REQ-STRUCT-01** (P0): The feature MUST define a canonical repository layout that
  separates the canonical (Claude-native) source from the generated per-agent
  adapter output, and from shared scripts/references.
- **REQ-STRUCT-02** (P0): Generated adapters MUST live in a committed, in-repo
  `adapters/` location with one subtree per target agent (`codex`, `cursor`,
  `gemini`, `copilot`), so that adapter changes are reviewable in version-control diffs.
- **REQ-STRUCT-03** (P0): The Claude-native artifacts MUST be the canonical source of
  truth; every other agent's output is a transform OF the canonical artifacts.
- **REQ-STRUCT-04** (P1): Authoring conventions MUST be documented (where a tool
  lives, how it is named, how to add one, how to run a build) such that a new
  contributor can add a tool without reading the emitter source.

### 3.2 Tool Types In Scope

- **REQ-TOOLS-01** (P0): The system MUST support authoring and emitting **skills**
  (e.g. SKILL.md plus references/scripts).
- **REQ-TOOLS-02** (P0): The system MUST support **agents/subagents** (definition,
  system prompt, tool grants, triggering conditions).
- **REQ-TOOLS-03** (P0): The system MUST support **slash commands**.
- **REQ-TOOLS-04** (P0): The system MUST support **shared scripts and reference
  documents** consumed by the above.

### 3.3 Tool Registration & Discovery

- **REQ-DISC-01** (P0): An **explicit tool manifest** MUST be the canonical input
  that enumerates each tool, its type, and any per-target mapping overrides or
  exclusions.
- **REQ-DISC-02** (P0): The manifest MUST be the single source feeding both the
  emitter and the drift guard, so the set of tools cannot drift between emit and check.
- **REQ-DISC-03** (P1): The manifest MUST have a defined, validatable schema.

### 3.4 Emitter / Transform

- **REQ-EMIT-01** (P0): A **local build command** MUST regenerate all adapters from
  the canonical source on demand.
- **REQ-EMIT-02** (P0): Adapter generation MUST use a **defined per-target transform
  rule set** — one mapping specification per target agent — applied programmatically
  to every tool.
- **REQ-EMIT-03** (P0): For **every** Claude construct that has no faithful equivalent
  on a target agent (e.g. hooks, interactive question prompts), the emitter MUST emit a
  **coverage-report entry** classifying the construct as `fallback` or `skipped`, and
  MUST emit a **warning** — there are no silent drops. (Acceptance-checkable; ties to
  REQ-VALID-05 and REQ-OBS-01.)
- **REQ-EMIT-03a** (design goal, non-acceptance-gating): Where a construct can be
  represented, the fallback SHOULD be the **nearest representable equivalent** (e.g.
  inline instructions). This is a quality goal guiding transform-rule design, not a
  pass/fail acceptance criterion.
- **REQ-EMIT-04** (P0): Adapter directories MUST be generated output, but the system
  MUST provide **per-target override slots** — explicit author-supplied files that
  the emitter merges into the generated output for that target — and these overrides
  MUST NOT be overwritten or lost by a rebuild. Override slots MUST be declared/located
  such that the drift guard can **deterministically distinguish** author-supplied
  override content from emitted content, so that edits inside an override slot are
  honored while edits to emitted output are flagged as drift (see SC-04/SC-05).
  Concrete merge semantics are deferred to OQ-03.
- **REQ-EMIT-05** (P0): Re-running the emitter MUST be **idempotent and safe**: a
  build against unchanged canonical input and unchanged overrides MUST produce no
  changes, MUST NOT clobber override slots, and MUST NOT require manual cleanup
  between runs.
- **REQ-EMIT-06** (P0): The emitter MUST produce **byte-stable output** — the same
  canonical input **and the same override-slot contents** MUST yield byte-for-byte
  identical adapter files on every run (stable ordering, formatting, and serialization)
  so that the drift guard is reliable. The override slots (REQ-EMIT-04) are a second
  input to the emit alongside the canonical source; the determinism guarantee covers
  the combination of both.
- **REQ-EMIT-07** (P0): The emitter MUST emit adapters for all four targets:
  **Codex, Cursor, Gemini, Copilot**.
- **REQ-EMIT-08** (P0): When a tool is **removed or renamed** in the canonical
  source/manifest, a rebuild MUST remove the corresponding stale adapter files for
  every target, so that `adapters/` contains exactly the set of files the current
  canonical source would emit (no orphans). Removal MUST NOT require manual cleanup.

### 3.5 Validation & Guards

- **REQ-VALID-01** (P0): A **drift guard** MUST exist that re-emits from canonical and
  fails if committed adapters do not match the fresh emit. It MUST be runnable both
  locally and in CI. The drift guard MUST re-emit **with override slots merged in the
  same way a normal build does** (REQ-EMIT-04/06) before diffing against committed
  adapters, so legitimate override content is never flagged as drift. The drift guard
  MUST also fail when committed adapters contain **orphan files** — files with no
  corresponding canonical source (REQ-EMIT-08) — not only when file contents differ.
- **REQ-VALID-02** (P0): The drift guard MUST fail the build when drift is detected.
  (The mandate that this guard runs in CI is captured as a delivery constraint in §5,
  CON-05.)
- **REQ-VALID-03** (P1): Each emitted target MUST be validatable against that agent's
  expected file format / manifest **schema**.
- **REQ-VALID-04** (P1): The emitter MUST support **golden-file snapshot tests** —
  emit and diff against checked-in expected output per target — to catch unintended
  transform changes.
- **REQ-VALID-05** (P1): Each build MUST produce a **per-target coverage / capability
  report** listing what mapped cleanly, what fell back, and what was skipped per tool.

### 3.6 Packaging

- **REQ-PKG-01** (P1): The canonical Claude side MUST be packaged as an **installable
  Claude plugin** (e.g. plugin manifest plus marketplace entry) so the Claude
  artifacts are directly installable; the adapters serve the other four agents.

### 3.7 Reusability

- **REQ-REUSE-01** (P1): The canonical format and emitter MUST be designed to be
  reusable in **other repositories**, not hard-wired to `agent-docs` specifics.

## 4. Non-Functional Requirements

### 4.1 Performance

- **REQ-PERF-01** (P2): No hard build-speed target for this version (the tool set is
  small). The build SHOULD be fast enough to run comfortably during local authoring
  and in CI; a quantitative target may be set in a later version as the tool set grows.

### 4.2 Observability

- **REQ-OBS-01** (P1): The build MUST surface, per run, a human-readable summary of
  targets emitted, tools processed, fallbacks applied, and items skipped (the coverage
  report of REQ-VALID-05 satisfies this).
- **REQ-OBS-02** (P2): On drift-guard failure, output MUST clearly identify which
  adapter files differ and how, so an author can fix the source quickly.

### 4.3 Correctness / Reliability

- **REQ-REL-01** (P0): The emitter MUST be deterministic (see REQ-EMIT-06) and
  idempotent (see REQ-EMIT-05); these properties are the backbone of a trustworthy
  drift guard and are treated as reliability requirements, not conveniences.

### 4.4 Security

- **REQ-SEC-01** (P2): The emitter MUST only read from the canonical source and
  declared override slots, and only write within the designated adapter output
  locations — it MUST NOT write outside the repo's adapter/build areas.

### 4.5 Accessibility

- N/A — this feature produces developer-facing source artifacts and build tooling,
  not an end-user UI.

## 5. Constraints

- **CON-01**: The emitter and supporting scripts MUST be built on **Bun + TypeScript**
  (organizational/toolchain mandate, consistent with the related `rauf` monorepo).
  Note: the repo currently has no `package.json`; establishing the Bun/TS project is
  part of this feature.
- **CON-02**: Adapters MUST be **committed in-repo** (not emitted only to an ignored
  `dist/`), to keep them reviewable and CI-guardable.
- **CON-03**: Claude is the **canonical / privileged** source form; the system is
  multi-agent but Claude-optimized.
- **CON-04**: Target agents fixed for this version: **Codex, Cursor, Gemini, Copilot**
  (plus canonical Claude).
- **CON-05**: The drift guard (REQ-VALID-01/02) MUST run in **CI** and gate the build,
  in addition to being runnable locally. (Delivery mandate; the functional behavior —
  failing the build on drift — lives in REQ-VALID-02.)

## 6. Out of Scope

- **OOS-01**: Authoring the actual documentation tools (the real skills/agents/commands
  that will live in the repo). This feature establishes the scaffold + emitter only.
- **OOS-02**: The Astro Starlight **doc-site generator** (the separate `doc-site`
  feature / canon) is not part of this feature.
- **OOS-03**: **Publishing / release automation** — actually publishing to marketplaces
  or per-agent registries, and release pipelines.
- **OOS-04**: Generalizing the scaffold into a standalone, distributable **CLI** tool
  to run anywhere (beyond the in-repo build command). Reusability is a design
  requirement (REQ-REUSE-01), but a packaged CLI is not.

## 7. Open Questions

- **OQ-01**: What are the precise per-target transform rules for each construct type
  (skills, agents, commands) into Codex/Cursor/Gemini/Copilot conventions? (To be
  specified in the tech spec, using feature-forge's own `adapters/` as a reference.)
- **OQ-02**: Exact format and schema of the tool manifest (file type, fields,
  override-declaration syntax). (Tech spec.)
- **OQ-03**: Mechanism and merge semantics for per-target override slots (file-level
  replace vs. section merge). (Tech spec.)
- **OQ-04**: Which single sample tool will serve as the end-to-end proof for the MVP,
  and what does its "correct" output look like for each target (golden snapshots)?
- **OQ-05**: Plugin/marketplace manifest specifics for the installable Claude package.

## 8. Success Criteria

- **SC-01**: A contributor can add a tool by authoring it in canonical Claude form,
  registering it in the manifest, and running the local build — with no manual editing
  of adapter files required for the common case.
- **SC-02**: The MVP ships the repo structure, canonical format, working emitter, and
  **one real sample tool** that emits correctly to **all four targets** (Codex, Cursor,
  Gemini, Copilot), plus the canonical Claude form. Evaluation depends on the sample
  tool and per-target golden snapshots selected in OQ-04 (fixed in the tech spec); this
  criterion becomes testable once those golden files are checked in.
- **SC-03**: Running the build twice with no source changes produces **zero diffs**
  (idempotent, byte-stable), and the drift guard passes.
- **SC-04**: Intentionally hand-editing a committed adapter (outside an override slot)
  causes the **CI drift guard to fail**; reverting to the emitted output makes it pass.
- **SC-05**: A declared per-target override survives a rebuild (is not clobbered) and
  is present in that target's output.
- **SC-05a**: Removing a tool from the canonical source/manifest and rebuilding
  **removes** that tool's adapter files for every target; an orphaned committed adapter
  (no corresponding canonical source) causes the drift guard to fail (REQ-EMIT-08).
- **SC-06**: Each build produces a coverage report identifying mapped / fallback /
  skipped items per target.
- **SC-07**: The canonical Claude side is installable as a Claude plugin.
- **SC-08**: Golden-snapshot (REQ-VALID-04) and schema-validation (REQ-VALID-03) checks
  pass for all emitted targets. Like SC-02, this becomes testable once the OQ-04 sample
  tool and per-target golden snapshots are checked in.
