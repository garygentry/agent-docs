# 09 — Integration & Emission

How the `doc-site-plugin` skill plugs into the existing `agent-docs`
(`agent-agnostic-scaffold`) emitter and build pipeline. This is the **assembly
point** for the in-repo deliverable: the single `ToolEntry` registration in
`tools.manifest.json`, the verbatim emission of the skill's owned subtree to all
five targets (with the fixed sibling hop to `diagram-generator` that
`05-diagrams-component.md` depends on), why the `docs.manifest.schema.json` asset
is **hand-authored** rather than produced by `src/schema-gen.ts`, the golden
`SAMPLE_RELPATHS` registration that keeps the golden suite green, and the proof
that the `gate` chain is unchanged.

This document does **not** (re)define the manifest contracts, the template-token
vocabulary, or the component model — those live in `00-core-definitions.md`. It
does not (re)define the directory tree or the per-target skill roots — those live
in `01-architecture-layout.md`. It wires those already-specified pieces into the
repo's existing emitter discipline. It is purely additive: **no `src/` emitter
changes**, **no new `src/` module**, **no new `gate` stage** (tech-spec §1, §2,
§3.4; `01-architecture-layout.md §3`).

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                                | Section |
| ----------------- | --------------------------------------------------------------------- | ------- |
| CON-02            | Authored as a canonical skill, registered in `tools.manifest.json`     | §2      |
| REQ-PORT-02       | Verbatim, byte-identical emission to all 5 targets (build:check + goldens) | §3, §5, §6 |
| REQ-DIAG-02       | Renderer reachable at one fixed sibling rel-path on every target       | §4      |
| (tech §2/§3.4)    | `docs.manifest.schema.json` is hand-authored, not `schema-gen` output  | §5      |
| (tech §6, §8)     | Golden `SAMPLE_RELPATHS` registration; full-tree drift gate            | §6      |
| (tech §6, §8)     | `gate` chain unchanged                                                 | §7      |

## 1. What "integration" means here

`doc-site-plugin` ships as a skill directory plus a one-line manifest entry and a
few test additions (`01-architecture-layout.md §3`). The pure, deterministic
emitter already guarantees byte-identical emission of the *skill files* across the
five targets; the only repo wiring this document specifies is:

1. **Register** the tool (§2) so `src/discover.ts` finds it.
2. **Emit** it verbatim to each adapter bundle (§3) — no emitter code changes.
3. **Pin** the byte-identity with the full-tree drift gate plus a representative
   golden subset (§6), and confirm the `gate` chain is unchanged (§7).

The static schema asset (§5) and the fixed sibling hop to `diagram-generator`
(§4) are the two integration points that need explicit, source-cited reasoning.

## 2. Manifest registration (CON-02)

The skill becomes canonical by appending **exactly one** `ToolEntry` to the
`tools[]` array of `tools.manifest.json`. The `ToolEntry` Zod shape is the
existing schema at `src/model.ts:37-48` (do not redefine it):

```typescript
// src/model.ts:37-48 (verbatim — existing schema, do NOT edit)
export const ToolEntry = z.object({
  /** kebab-case identifier; MUST match the on-disk source basename. */
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Tool kind (REQ-TOOLS-01..04). */
  type: ToolType,
  /** Repo-relative path to the canonical file or directory. */
  source: z.string(),
  /** Optional human description; falls back to the source's frontmatter. */
  description: z.string().optional(),
  /** Per-target overrides/exclusions (REQ-DISC-01). */
  targets: z.record(Target, TargetToolFlags).optional(),
});
```

> **External-vocabulary note.** The `REQ-TOOLS-*` / `REQ-DISC-*` IDs in the
> verbatim excerpt are the host `agent-docs` emitter's own requirement namespace,
> **not** this feature's PRD requirements. They are reproduced verbatim from the
> source comment and must not be edited.

### 2.1 The one entry to append

Append this element to `tools[]` in `tools.manifest.json`, after the existing
`docs-helper` and `diagram-generator` entries (current file has those two —
`tools.manifest.json:13-26`):

```jsonc
{
  "name": "doc-site-plugin",
  "type": "skill",
  "source": "skills/doc-site-plugin",
  "description": "Scaffolds an Astro 5 + Starlight docs site into a target repo from an agent-driven interview: env-driven site/base, manifest-driven sidebar/symlinker/drift guard, optional diagrams (via diagram-generator) and deploy wiring."
}
```

- `name: "doc-site-plugin"` satisfies the `^[a-z0-9]+(-[a-z0-9]+)*$` regex
  (`src/model.ts:39`) and matches the on-disk source basename
  `skills/doc-site-plugin` — required by the comment at `src/model.ts:38` and
  cross-checked against the SKILL.md `name` frontmatter and the parent directory
  name at discovery time (`src/discover.ts:142-153`).
- `type: "skill"` is a member of `ToolType` (`src/model.ts:15`:
  `z.enum(["skill","agent","command","script","reference"])`).
- `source` is the canonical skill directory (`01-architecture-layout.md §1`).
- `description` is supplied so the manifest does not fall back to the SKILL.md
  frontmatter description.
- `targets` is **omitted** — the skill emits to all five targets with no
  per-target override or exclusion (REQ-PORT-02).

### 2.2 The `config` block is UNCHANGED

`config` is a top-level field of the `Manifest` object (`src/model.ts:79-86`,
`EmitterConfig` at `src/model.ts:57-74`), **not** part of a `ToolEntry`.
Registering this skill touches `tools[]` only — appending one element. The
`config` block (`tools.manifest.json:3-12`) is left **byte-for-byte unchanged**.
Any edit to `config` is out of scope.

> **Verification hook:** `bun run schema:check` (`package.json:15` →
> `src/schema-gen.ts --check`) validates `tools.manifest.json` against the
> committed `schemas/tools.manifest.schema.json`. The append does not change the
> *schema* (the `Manifest`/`ToolEntry` Zod is untouched), so `schema:check` stays
> green; `Manifest.parse` must still succeed against the augmented `tools[]`.

## 3. Emission to all five targets (REQ-PORT-02)

No emitter code changes. `src/discover.ts` discovers the skill from its manifest
entry and parses it (`parseSkill`, `src/discover.ts:119-179`):

- `SKILL.md` is read and **transformed per target** (front-matter / format /
  filename — the SKILL transform table in §6) by the existing pipeline; the
  transformed text lands in `emit().files`.
- The skill's **owned subtree** is collected by `collectOwnedTree`
  (`src/discover.ts:105-117`) into `ownRefs`, then mapped to per-target
  destination relpaths by `skillVerbatimRecords` (`src/targets/_shared.ts:226-237`)
  and copied **byte-identically, with no provenance header**, by the publish step.
  Verbatim copies travel in `emit().verbatim`, **not** `emit().files`.

`skillVerbatimRecords` rebases each owned ref relative to the skill root (the
directory containing `SKILL.md`, derived by stripping the filename —
`src/targets/_shared.ts:227-228`) and places it under the per-target skill
location returned by `skillRefDir` (`src/targets/_shared.ts:203-212`). Per-target
roots (`src/targets/_shared.ts:204-211`):

| Target  | Skill root (`skillRefDir`) | doc-site-plugin owned-subtree prefix |
| ------- | -------------------------- | ------------------------------------ |
| claude  | `skills/<name>`            | `skills/doc-site-plugin/…`           |
| codex   | `skills/<name>`            | `skills/doc-site-plugin/…`           |
| gemini  | `skills/<name>`            | `skills/doc-site-plugin/…`           |
| cursor  | `rules/<name>`             | `rules/doc-site-plugin/…`            |
| copilot | `instructions/<name>`      | `instructions/doc-site-plugin/…`     |

The owned-subtree bytes (every `references/*.md` and every template/script file)
are byte-identical across all five targets — the rebasing changes only the path
prefix, never the content. This is the mechanical guarantee behind REQ-PORT-02 for
the tool's own emission; the *scaffolded output's* byte-identity is guaranteed
separately by deterministic `{{TOKEN}}` substitution (`00-core-definitions.md §4`,
`01-architecture-layout.md §2`).

> **RESOLVED — bundle tree lives under `references/`, not `assets/`.**
> `collectOwnedTree` (`src/discover.ts:107`) walks **only** the `references/` and
> `scripts/` subdirectories of the skill dir:
>
> ```typescript
> // src/discover.ts:105 (verified)
> for (const sub of ["references", "scripts"]) { … }
> ```
>
> An `assets/` directory under `skills/doc-site-plugin/` would therefore **not** be
> collected into `ownRefs` and would **never** be emitted to any adapter bundle.
> Accordingly the layout was reconciled (`01-architecture-layout.md §1, §2.3`): the
> template tree and the static schema ride under `references/` — i.e.
> `references/templates/**` and `references/docs.manifest.schema.json` — emitted
> verbatim at mode 0o644, consistent with the `diagram-generator` sibling that ships
> its executable renderer under `scripts/`. This keeps the deliverable **purely
> additive with no `src/` emitter change** (the alternative — extending
> `src/discover.ts` to walk `assets/` — was rejected as it would contradict that
> property). This corrects the `assets/`-based sketch in tech-spec §2; all §3–§7
> relpaths below assume the `references/` resolution.

## 4. The fixed sibling rel-path to `diagram-generator` (REQ-DIAG-02)

`05-diagrams-component.md` vendors the renderer by reading it at the single fixed
relative path `../diagram-generator/scripts/diagram-render.mjs` from the doc-site
skill's own bundle directory, with **no per-agent branching**. This holds on every
target because both skills are rebased under the **same per-target parent** by
`skillRefDir` (`src/targets/_shared.ts:203-212`):

| Target  | doc-site skill dir                | diagram-generator skill dir          | Sibling hop |
| ------- | --------------------------------- | ------------------------------------ | ----------- |
| claude  | `skills/doc-site-plugin/`         | `skills/diagram-generator/`          | `../diagram-generator/…` |
| codex   | `skills/doc-site-plugin/`         | `skills/diagram-generator/`          | `../diagram-generator/…` |
| gemini  | `skills/doc-site-plugin/`         | `skills/diagram-generator/`          | `../diagram-generator/…` |
| cursor  | `rules/doc-site-plugin/`          | `rules/diagram-generator/`           | `../diagram-generator/…` |
| copilot | `instructions/doc-site-plugin/`   | `instructions/diagram-generator/`    | `../diagram-generator/…` |

`skillVerbatimRecords` (`src/targets/_shared.ts:229-235`) prefixes every owned ref
with `skillRefDir(target, name)`; the only per-target difference is the shared
parent segment (`skills` / `rules` / `instructions`), which both skills share.
Therefore the hop **between** the two skills —
`../diagram-generator/scripts/diagram-render.mjs` relative to
`<root>/doc-site-plugin/` — is identical for all five targets. The renderer itself
arrives in each bundle as `diagram-generator`'s own owned `scripts/` subtree
(`diagram-generator/06-integration-and-packaging.md §5.1-5.2`), so the file it
points at is present and runnable. `diagram-generator` is a **hard prerequisite**
shipped first (PRD CON-05, tech-spec §6), so the sibling is always present in every
bundle this skill is emitted into.

> Both skills must be registered in `tools.manifest.json` for both to be emitted
> into a bundle. `diagram-generator` is already registered
> (`tools.manifest.json:21-25`); §2.1 adds `doc-site-plugin`.

## 5. The static `docs.manifest.schema.json` is hand-authored (tech-spec §3.4)

`docs.manifest.schema.json` is the JSON Schema for the **target-repo**
`docs.manifest.json` (`00-core-definitions.md §2.4`). It is **hand-authored** and
shipped as a verbatim skill asset; it is **NOT** produced by `src/schema-gen.ts`.

`src/schema-gen.ts` is hardwired to the emitter's own `Manifest` Zod type and emits
a single committed file:

- It imports `Manifest` from `./model.js` (`src/schema-gen.ts:18`) and builds the
  schema from it (`buildManifestSchema`, `src/schema-gen.ts:35-43`).
- Its only output path is `schemas/tools.manifest.schema.json`
  (`SCHEMA_OUTPUT_PATH`, `src/schema-gen.ts:21`).
- It has no parameterization for any other Zod source or output path — the entry
  (`src/schema-gen.ts:58-81`) writes/diffs exactly that one file.

So `src/schema-gen.ts` cannot, and does not, generate `docs.manifest.schema.json`.
Generating a second schema would require a **new `src/` module** (as
`diagram-generator` did with `src/diagram/schema-gen.ts`, wired via the
`schema:gen:diagram` / `schema:check:diagram` scripts at `package.json:18-19`).
This feature deliberately avoids that: keeping the docs-manifest schema a static,
hand-authored asset preserves the "no `src/` changes, purely a skill + assets
deliverable" property (tech-spec §2, §3.4).

Consequences:

- The schema rides to every target as a **verbatim owned ref** under the skill's
  discovered subtree (§3; per the §3 WARNING resolution, under `references/`), with
  no provenance header, and is copied into target repos at scaffold time.
- It is validated **in this repo by a vitest test** (under the existing `test`
  stage), not by the `schema:check` gate stage (which is hardwired to `Manifest`).
  The test asserts the file is a valid JSON Schema and that it accepts the valid
  manifest fixtures and rejects the invalid ones (missing `from` on a
  `source: "symlink"` page, `from` present on a `source: "native"` page, unknown
  keys, duplicate slugs). The full fixture + test specification is in
  `10-testing-strategy.md`; this section only records the integration decision: it
  is a static asset, **no `src/` module and no new `gate` stage are added**.

## 6. Golden registration (`src/test/golden.shared.ts`)

The golden suite (`golden.test.ts`) enforces **three-way set equality** between
the emitted sample-scoped keys, the committed golden keys, and the
`SAMPLE_RELPATHS` set, so a missing **or** extra relpath fails CI. The golden suite
asserts over `emit().files` — i.e. the **transformed** outputs only. A skill's
verbatim owned subtree travels in `emit().verbatim`, **not** `files`
(`src/test/golden.shared.ts:34-40`), so only the **transformed SKILL relpath** is
registered per target (the `references/` docs, the template tree, and the static
schema are pinned by `build:check` instead — §6.2).

### 6.1 The exact rows to add

`SAMPLE_RELPATHS` is the `Record<Target, string[]>` at
`src/test/golden.shared.ts:42`. Add the `doc-site-plugin` transformed-SKILL relpath
to each target's array, mirroring the existing `diagram-generator` rows
(`src/test/golden.shared.ts:43-63`). The per-target SKILL filename shapes are the
same transforms the `diagram-generator` rows use:

| Target  | doc-site-plugin SKILL relpath to register             |
| ------- | ----------------------------------------------------- |
| claude  | `skills/doc-site-plugin/SKILL.md`                     |
| codex   | `skills/doc-site-plugin/SKILL.md`                     |
| gemini  | `skills/doc-site-plugin/doc-site-plugin.md`           |
| copilot | `instructions/doc-site-plugin.instructions.md`        |
| cursor  | `rules/doc-site-plugin.mdc`                            |

Resulting `SAMPLE_RELPATHS` (extending the committed file):

```typescript
// src/test/golden.shared.ts:42 — extend each target with the transformed doc-site SKILL relpath only
export const SAMPLE_RELPATHS: Record<Target, string[]> = {
  claude: [
    "skills/docs-helper/SKILL.md",
    "skills/diagram-generator/SKILL.md",
    "skills/doc-site-plugin/SKILL.md", // SKILL transform; refs/templates/schema are verbatim (emit().verbatim)
  ],
  codex: [
    "skills/docs-helper/SKILL.md",
    "skills/diagram-generator/SKILL.md",
    "skills/doc-site-plugin/SKILL.md",
  ],
  copilot: [
    "instructions/docs-helper.instructions.md",
    "instructions/diagram-generator.instructions.md",
    "instructions/doc-site-plugin.instructions.md",
  ],
  cursor: [
    "rules/docs-helper.mdc",
    "rules/diagram-generator.mdc",
    "rules/doc-site-plugin.mdc",
  ],
  gemini: [
    "skills/docs-helper/docs-helper.md",
    "gemini-extension.json",
    "skills/diagram-generator/diagram-generator.md",
    "skills/doc-site-plugin/doc-site-plugin.md",
  ],
};
```

The committed `gemini-extension.json` golden is regenerated by the sample build
when `doc-site-plugin` joins the sample manifest (its aggregate gains one entry; it
carries no asset bytes). Regenerate the representative `__golden__/` files with the
goldens-regeneration script after the rows are added.

> **If a transform differs:** the three-way set equality is the source of truth. If
> the actual emitter output diverges from the SKILL filenames above (an unexpected
> `skillRefDir` case or SKILL-rename rule), correct the `SAMPLE_RELPATHS` rows to
> match the **actual** `emit().files` output rather than the table here, and
> re-verify against the set-equality assertion. A guessed relpath the emitter never
> produces will fail; an emitted relpath missing from the set will fail.

### 6.2 Where the verbatim bytes are actually pinned

The authoritative full-tree byte-identity guarantee for everything that rides
verbatim — every `references/*.md`, every template file, and
`docs.manifest.schema.json` — is **`build --check`** (`src/cli.ts build --check`,
`package.json:13`), implemented by the drift check in `src/driftguard.ts`. It
re-emits in memory and compares against the committed `adapters/<target>/` trees,
flagging `content` (bytes differ), `orphan` (committed but not emitted), and
`missing` (emitted but not committed) drift (`src/driftguard.ts:64-123`). It never
mutates `adapters/` (`src/driftguard.ts:20-23`). This covers the owned subtree of
all five targets exhaustively. The goldens (§6.1) are a **fast representative
subset** (the transformed SKILL per target); together: `build:check` = exhaustive,
goldens = fast spot-check (REQ-PORT-02; tech-spec §8).

## 7. The `gate` chain is UNCHANGED

The `gate` script is unchanged by this feature (`package.json:25`):

```
compile → schema:check → schema:check:diagram → typecheck → lint → format:check → test → build:check → build:diagram:check
```

- The new template-asset / token-coverage / schema-fixture tests and the
  scaffold-output golden tests run under the existing **`test`** stage
  (`package.json:24` → `vitest run`).
- `docs.manifest.schema.json` is a static asset validated by a vitest test under
  `test` — **not** by `schema:check` (hardwired to `Manifest`, §5) and **not** by
  `schema:check:diagram` (hardwired to `src/diagram/schema-gen.ts`).
- The verbatim owned-subtree byte-identity is enforced by the existing
  **`build:check`** stage (§6.2).

No new gate stage is added, no `package.json` script is added, and no `src/` module
is added. The append to `tools.manifest.json` (§2) and the `SAMPLE_RELPATHS` rows
(§6.1) are the only non-skill, non-test repo edits, plus regenerated `__golden__/`
and `adapters/` trees (build artifacts).

## Dependencies

Implement these first:

- `00-core-definitions.md` — the `docs.manifest.json` contract and §2.4 the schema
  asset whose integration §5 specifies; the `{{TOKEN}}` vocabulary whose byte-stable
  substitution underpins REQ-PORT-02.
- `01-architecture-layout.md` — the skill directory layout (§3's WARNING reconciles
  the `assets/` vs `references/` discovery gap against it), the in-repo additions
  list (§3), and the per-target skill-root table (§3, §4).
- Existing emitter modules (unchanged, relied upon): `src/model.ts`
  (`ToolEntry`/`ToolType`/`Manifest`), `src/discover.ts` (`collectOwnedTree`,
  `parseSkill`), `src/targets/_shared.ts` (`skillRefDir`/`skillVerbatimRecords`),
  `src/schema-gen.ts` (hardwired to `Manifest` — §5), `src/driftguard.ts`
  (`build --check`), `src/test/golden.shared.ts` (`SAMPLE_RELPATHS`).
- `diagram-generator` (hard prerequisite, already registered) — §4 relies on its
  bundle being present as the sibling.

## Verification

- [ ] `tools.manifest.json` has exactly one new `tools[]` element matching §2.1;
      the `config` block is byte-for-byte unchanged (§2.2).
- [ ] `bun run compile` and `bun run schema:check` pass (`Manifest.parse` succeeds
      against the augmented `tools[]`; schema unchanged).
- [ ] The `assets/` vs `references/` discovery gap (§3 WARNING) is resolved: every
      template and the static schema live under a subtree `collectOwnedTree`
      actually walks (`references/` or `scripts/`, `src/discover.ts:107`), confirmed
      by their appearance in `emit().verbatim` and in the committed
      `adapters/<target>/` trees.
- [ ] `bun run build` emits the skill (transformed SKILL + verbatim owned subtree,
      incl. `docs.manifest.schema.json`) into all five `adapters/<target>/` trees.
- [ ] The renderer rel-path
      `../diagram-generator/scripts/diagram-render.mjs` resolves to a real file
      relative to `<root>/doc-site-plugin/` in every target bundle (§4).
- [ ] `SAMPLE_RELPATHS` (`src/test/golden.shared.ts:42`) is extended per §6.1;
      `golden.test.ts` three-way set equality passes (no missing, no extra relpath).
- [ ] A vitest test validates `docs.manifest.schema.json` (accepts valid fixtures,
      rejects invalid) under the `test` stage — not `schema:check` (§5,
      `10-testing-strategy.md`).
- [ ] `bun run build:check` is green: the verbatim owned subtree is byte-identical
      across all five committed adapter trees (§6.2).
- [ ] `bun run gate` runs unchanged (`package.json:25`) and stays green; no new gate
      stage, script, or `src/` module was added (§7).
