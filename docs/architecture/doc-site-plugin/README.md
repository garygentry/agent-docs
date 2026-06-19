# doc-site-plugin

Scaffold a canon-faithful **Astro 5 + Starlight** documentation site into **any**
target repo, driven by a short agent-led interview. The agent never authors plumbing
content — it runs a set of detection probes, asks the user a handful of questions,
then **mechanically emits** component-gated template assets by substituting tokens
into byte-identical `.tmpl` files. Because emission is pure string replacement over
fixed assets, the file set is a deterministic function of the interview answers
(`REQ-PORT-02`).

This feature ships as a **skill** (`skills/doc-site-plugin/`), registered in
`tools.manifest.json` and emitted verbatim to all five agent targets (claude, codex,
gemini, cursor, copilot) by the existing `agent-agnostic-scaffold` build — exactly
like its siblings `docs-helper` and `diagram-generator`. It adds **no** `src/`
emitter code: the whole feature is the skill directory plus one manifest entry.

> This document is the **overview** for developers maintaining or extending the
> feature. For the design and data flow, see [`architecture.md`](./architecture.md);
> for the exact contracts (tokens, manifest schema, runtime-script exit codes), see
> [`api-reference.md`](./api-reference.md).

## What it does

- **Detect, then interview.** Seven read-only, network-free probes (monorepo, package
  manager, runtime, existing docs, CI, default branch, repo slug) seed sensible
  defaults; a conversational interview captures 8 parameters. Detection is
  **best-effort, never a gate** — a brand-new repo with no git, no lockfile, and no
  `docs/` still completes the interview from fallback defaults (`REQ-INT-02`).
- **Emit only what was selected.** A single **component-selection record** decides
  which template groups emit. Decline everything and choose `native` content mode, and
  only the core scaffold is written — **zero** files for any declined component (the
  decline-all invariant, `REQ-USE-01`).
- **One manifest, three consumers.** `docs.manifest.json` is the single source of
  truth. The same file drives sidebar generation, the content symlinker, and the
  drift guard — so they cannot drift apart.
- **Never-clobber re-runs.** Every managed plumbing file is sha256-tracked in
  `.doc-site-scaffold.json`. A re-run regenerates files it owns and the user hasn't
  touched, **skips and flags** user-edited files, and **preserves** authored content
  pages. An identical re-run is a no-op git diff (`REQ-RERUN-02`).
- **Real build smoke test.** Scaffolding isn't "done" until the emitted site installs
  and builds green in the target repo — any nonzero exit is `BUILD_RED` and is
  reported, never masked (`REQ-VERIFY-01`).
- **Diagrams by vendoring, not reimplementation.** The optional diagram component
  copies the sibling `diagram-generator`'s frozen `diagram-render.mjs` bundle (pinned
  `CONTRACT_VERSION 1.0.0`) and wires a prebuild that renders for real (`REQ-DIAG-02`).
- **Safe by construction.** Writes only inside the target repo, refuses symlink
  sources that escape the repo root, and transmits no repo contents externally — the
  only network use is version resolution + dependency install (`REQ-SEC-01..03`).

## Quick start

`doc-site-plugin` is an **agent skill**, not a CLI — an engineer invokes it through
their coding agent ("set up a docs site for this repo"). The agent then runs the
seven-phase procedure in `skills/doc-site-plugin/SKILL.md`:

```
Phase 1  detect          read-only probes seed defaults + assumption records
Phase 2  interview       capture 8 params (title, desc, social, content mode,
                         page→slug map, deploy targets, accents, docs dir)
Phase 3  component-select resolve { contentMode, diagrams, deploy[], driftGuard, monorepo }
Phase 4  emit            per selected group: read .tmpl, substitute tokens, write,
                         record sha256 provenance (honor never-clobber on re-run)
Phase 5  setup-docs      run the emitted symlinker (symlink/mixed mode only)
Phase 6  build smoke     install + build; REQUIRE green (BUILD_RED never reported as OK)
Phase 7  next steps      print run/preview/deploy guidance + every assumption made
```

The minimal outcome — decline every optional component and pick `native` content mode
— emits just the core Astro+Starlight site (config, content collection, manifest,
schema, starter page, custom CSS, favicon) and nothing else.

## Key concepts

| Concept | What it is |
| --- | --- |
| **Token substitution** | Emission is global literal `{{TOKEN}}` replacement over fixed `.tmpl` assets. The 17-token vocabulary is frozen and mirrored in `SKILL.md`; after substitution **no** `{{…}}` may survive. Deterministic ⇒ byte-identical output across agents. |
| **`docs.manifest.json`** | The single source of truth in the target repo. An ordered `pages[]` array (array order **is** sidebar order) plus `site` metadata. Feeds sidebar generation, the symlinker, and the drift guard. |
| **Component-selection record** | `{ contentMode, diagrams, deploy[], driftGuard, monorepo }` — the one structure that gates which template groups emit. Optional components default to declined. |
| **Decline-all invariant** | A declined component emits **zero** files and leaves **no** dangling hook, config, or reference. Nothing outside a group references it. |
| **Never-clobber provenance** | `.doc-site-scaffold.json` records a sha256 per managed plumbing file. Re-run decisions: `EMIT` / `REGENERATE` / `SKIP_FLAG` / `PRESERVE`. User edits are never overwritten. |
| **`unmanaged: true`** | Per-page escape hatch: the generator owns no sidebar entry or symlink for the page, but the drift guard still checks its links and frontmatter. |
| **Diagram vendoring** | The diagram component copies (never reimplements) the sibling `diagram-generator` renderer at a fixed uniform rel-path, after verifying its pinned `CONTRACT_VERSION 1.0.0`. |

## Package layout

| Location | Description |
| --- | --- |
| `skills/doc-site-plugin/SKILL.md` | The lean 7-phase procedure + the canonical 17-token substitution table. |
| `skills/doc-site-plugin/references/*.md` | Per-phase / per-component agent references (detect, interview, core, manifest-schema, symlink, diagrams, deploy-\*, monorepo, drift-guard, rerun). |
| `skills/doc-site-plugin/references/docs.manifest.schema.json` | The static JSON Schema (Draft 2020-12) copied verbatim into the target repo to validate its manifest. |
| `skills/doc-site-plugin/references/templates/<group>/*.tmpl` | The byte-identical template assets, grouped by component (`core/`, `symlink/`, `diagrams/`, `deploy/*`, `monorepo/`, `drift-guard/`). |
| `tools.manifest.json` | Registers the skill (`{ name, type:"skill", source:"skills/doc-site-plugin", description }`) so the build emits it to all 5 targets. |
| `src/test/doc-site-*.test.ts` | In-repo verification: token-coverage, schema-fixture, and scaffold-output golden tests (the build smoke test runs in the **target** repo, not here). |

## When to use it

- You want a **documentation site added to an existing repo** with conventions wired
  up (manifest-driven sidebar, content symlinks, deploy, drift guard) rather than
  hand-assembling Astro + Starlight.
- You need the scaffold to be **safe and re-runnable** — idempotent, never clobbering
  hand edits, and recoverable from a partial run.
- You want the **same scaffold from any coding agent** (Claude, Codex, Gemini, Cursor,
  Copilot) producing byte-identical output.

## When NOT to use it

- **You want a non-Astro/Starlight generator** (Docusaurus, MkDocs, VitePress). Out of
  scope by design — this tool is Astro 5 + Starlight only.
- **You want it to author your docs content.** It scaffolds plumbing and wires pages;
  it never writes your documentation prose.
- **You want it to deploy or host the site.** It emits deploy *config* (GitHub Pages
  workflow, `vercel.json`, `netlify.toml`) but never pushes, provisions, or hosts.
- **You need ongoing maintenance / auto-upgrades.** Version pins resolve at first
  scaffold and are preserved on re-run; bumping is an explicit, opt-in action.

## Further reading

- [Architecture](./architecture.md) — the 7-phase pipeline, the emission model, the manifest triad, never-clobber, vendoring, and safety
- [API Reference](./api-reference.md) — the 17 tokens, the manifest/PageEntry contract, runtime-script exit codes, the provenance shape, and the deploy env contract
