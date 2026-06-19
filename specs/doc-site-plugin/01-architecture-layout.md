# 01 — Architecture & Layout

How `doc-site-plugin` is structured in the `agent-docs` repo: the canonical skill
directory and its parameterized template-asset tree, the lean phased `SKILL.md`
procedure, the small additive in-repo verification surface, and the per-target
emission mapping. Every other document references this layout for file placement,
template-asset paths, and the SKILL.md phase a component plugs into.

This feature is **purely additive**: a new `skills/doc-site-plugin/` directory, one
`tools.manifest.json` entry, and new tests. **No `src/` emitter changes** are
required — the existing `agent-agnostic-scaffold` pipeline emits the skill
byte-identically to all five targets (tech-spec §1, §3.1).

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                  | Section |
| ----------------- | ------------------------------------------------------- | ------- |
| CON-02            | Authored as a canonical skill, emitted to all 5 targets | §1, §3, §5 |
| REQ-PORT-02       | Template assets ride verbatim → byte-identical output    | §2, §5  |
| REQ-CORE-01       | Core scaffold template group exists                     | §2.2    |
| REQ-USE-01        | Component-gated template groups (decline-all → zero)    | §2.2, §4 |
| REQ-DIAG-02       | Renderer vendored from sibling skill at fixed rel-path   | §2.2, §5.2 |
| (tech §1/§2)      | No `src/` emitter changes; additive in-repo surface     | §3      |

## 1. Directory tree (full)

```
agent-docs/
├── skills/
│   └── doc-site-plugin/                 # canonical skill (CON-02)
│       ├── SKILL.md                     # lean phased procedure + substitution table (§4)
│       └── references/                  # ALL own refs (instruction docs + templates + schema),
│           │                            # emitted verbatim — see §2.3 for why NOT `assets/`
│           ├── detect.md                # detection probes + graceful-degradation table   (02)
│           ├── interview.md             # interview script + per-parameter defaults        (02)
│           ├── core.md                  # core scaffold emit instructions                  (03)
│           ├── manifest-schema.md       # docs.manifest schema reference + escape hatch     (03)
│           ├── symlink.md               # symlink/mixed layer + setup-docs                  (04)
│           ├── diagrams.md              # diagram component + vendoring + prebuild wiring    (05)
│           ├── deploy-github-pages.md   #                                                   (06)
│           ├── deploy-vercel.md         #                                                   (06)
│           ├── deploy-static-netlify.md #                                                   (06)
│           ├── drift-guard.md           # check-docs emit + rule set + custom-rule hook     (07)
│           ├── rerun.md                 # provenance manifest + never-clobber policy        (08)
│           ├── docs.manifest.schema.json          # static schema, shipped into target (00 §2.4)
│           └── templates/
│               ├── core/
│               │   ├── astro.config.mjs.tmpl
│               │   ├── package.json.tmpl
│               │   ├── tsconfig.json.tmpl
│               │   ├── content.config.ts.tmpl
│               │   ├── custom.css.tmpl
│               │   ├── favicon.svg                # no tokens; verbatim asset
│               │   ├── index.mdx.tmpl
│               │   └── starter-page.mdx.tmpl
│               ├── symlink/
│               │   └── setup-docs.sh.tmpl
│               ├── diagrams/
│               │   └── diagrams.prebuild.snippet.tmpl   # package.json script fragment
│               ├── deploy/
│               │   ├── github-pages/docs.yml.tmpl
│               │   ├── vercel/vercel.json.tmpl
│               │   └── static/netlify.toml.tmpl
│               ├── drift-guard/
│               │   └── check-docs.mjs.tmpl
│               └── monorepo/
│                   ├── pnpm-workspace.fragment.yaml.tmpl
│                   └── root-scripts.fragment.json.tmpl
│
├── tools.manifest.json                  # + 1 ToolEntry (09 §2)
└── src/
    └── test/
        ├── golden.shared.ts             # + doc-site-plugin SAMPLE_RELPATHS rows (09 §3)
        ├── __golden__/<target>/…        # regenerated representative goldens
        ├── doc-site-templates.test.ts   # token-coverage + schema-fixture tests (10)
        ├── doc-site-scaffold.test.ts    # scaffold-output golden fixtures        (10)
        ├── __scaffold_golden__/…        # checked-in resolved scaffold outputs   (10)
        └── __fixtures__/doc-site/…      # interview-answer sets + manifest fixtures (10)
```

Every file under `references/` — the per-component instruction docs, the verbatim
`favicon.svg`, the `.tmpl` templates, and `docs.manifest.schema.json` — is one of
the skill's **own refs**: discovered by `src/discover.ts` and emitted verbatim (no
provenance header) under each target's skill dir by `skillVerbatimRecords()`
(`09-integration-and-emission.md §4`).

## 2. Template-asset model

### 2.1 How a template becomes a scaffolded file

1. The agent reads a `.tmpl` asset (it rode verbatim into the agent's bundle).
2. The agent substitutes every `{{TOKEN}}` with its interview/detection value per
   the canonical token table (`00-core-definitions.md §4`).
3. The agent writes the result to the target-repo path the component's reference doc
   specifies, then records the file's sha256 in `.doc-site-scaffold.json` if it is a
   managed plumbing file (`00 §3`).

Because substitution is pure string replacement and the `.tmpl` bytes are identical
across agents, the resolved output is byte-identical across all five agents given
identical answers (REQ-PORT-02).

### 2.2 Template groups ↔ components (REQ-USE-01)

| Group              | Emitted when                            | Produces (target paths in component doc) | Doc |
| ------------------ | --------------------------------------- | ---------------------------------------- | --- |
| `core/`            | always                                   | Astro config, package.json, tsconfig, content config, css, favicon, index, starter page | 03 |
| `symlink/`         | `contentMode ∈ {symlink, mixed}`         | `setup-docs.sh`                          | 04 |
| `diagrams/`        | `diagrams = true`                        | prebuild snippet + vendored renderer copy | 05 |
| `deploy/github-pages/` | `"github-pages" ∈ deploy`            | `.github/workflows/docs.yml`             | 06 |
| `deploy/vercel/`   | `"vercel" ∈ deploy`                       | `vercel.json`                            | 06 |
| `deploy/static/`   | `"static-netlify" ∈ deploy`               | `netlify.toml` / static instructions     | 06 |
| `drift-guard/`     | `driftGuard = true`                       | `check-docs.mjs`                         | 07 |
| `monorepo/`        | `monorepo = true`                         | workspace + root-script fragments         | 06 |

Nothing outside a group references the group, so declining a component emits zero
of its files (the decline-all invariant, `00 §5`).

### 2.3 Why templates live under `references/`, not `assets/` (emitter constraint)

The bundle tree (templates + `docs.manifest.schema.json`) lives under
`references/`, **not** a separate `assets/` directory, because the emitter's
owned-subtree walker `collectOwnedTree()` (`src/discover.ts:107`) discovers **only**
`references/` and `scripts/` subdirectories — an `assets/` directory would be
silently dropped and never emitted to any adapter. Placing the templates under
`references/templates/` (and the schema directly under `references/`) keeps them
inside a discovered subtree, so they ride verbatim with no `src/` emitter change —
preserving the "purely additive" property (tech-spec §1, §2). The sibling
`diagram-generator` skill uses the same constraint, putting its executable renderer
under `scripts/`. (`09-integration-and-emission.md §3` documents this against the
real source. This corrects the `assets/`-based layout sketched in tech-spec §2.)

## 3. In-repo additions (verification surface only)

Per tech-spec §2, the *only* in-repo (`agent-docs`) changes besides the skill dir:

1. **`tools.manifest.json`** — append one `ToolEntry`:
   `{ "name": "doc-site-plugin", "type": "skill", "source": "skills/doc-site-plugin", "description": "…" }`
   (`ToolEntry` Zod shape at `src/model.ts:37`; `ToolType` enum at `src/model.ts:15`).
2. **`src/test/golden.shared.ts`** — add `doc-site-plugin` SKILL rows to
   `SAMPLE_RELPATHS` (the `Record<Target,string[]>` at `src/test/golden.shared.ts:42`)
   and regenerate `__golden__/`.
3. **New tests** under `src/test/` — token-coverage + schema-fixture
   (`doc-site-templates.test.ts`) and scaffold-output goldens
   (`doc-site-scaffold.test.ts`); fixtures under `src/test/__fixtures__/doc-site/`
   and `src/test/__scaffold_golden__/`.

**No new `src/` module and no new `gate` stage.** The static
`docs.manifest.schema.json` is validated by a vitest test under the existing `test`
stage, not by `schema:check` (which is hardwired to `Manifest` —
`09-integration-and-emission.md §5`). The `gate` chain is unchanged:
`compile → schema:check → schema:check:diagram → typecheck → lint → format:check → test → build:check → build:diagram:check`
(`package.json:25`).

## 4. SKILL.md phased procedure (the entry point)

`SKILL.md` is the load-bearing procedure; component reference docs are pulled in as
needed to keep it lean. The phases (tech-spec §5.1):

```
Phase 1  detect          → reads target repo; emits assumption records  (02; ref detect.md)
Phase 2  interview       → fills the substitution table + selection rec  (02; ref interview.md)
Phase 3  component-select→ resolves the component-selection model (00 §5)
Phase 4  emit            → per selected group: substitute tokens, write,
                           record provenance hashes (03–07; refs per group)
Phase 5  run setup-docs  → symlink/mixed only (04)
Phase 6  build smoke test→ run emitted build; require green (08; REQ-VERIFY-01)
Phase 7  next steps      → print run/preview/deploy guidance + assumptions (08; REQ-VERIFY-03)
```

`SKILL.md` also carries the **substitution table** (the SKILL-side mirror of
`00 §4.1`) — the single place tokens are documented for the agent; the
token-coverage test (`10`) keeps it in sync with `references/templates/**`.

## 5. Emission & cross-target layout

### 5.1 What the emitter does

The skill is discovered by `src/discover.ts` and emitted by the existing pipeline.
`SKILL.md` is transformed per target (front-matter/format); the entire
`references/**` subtree (instruction docs + templates + schema) rides **verbatim**
(byte-identical) under the per-target skill dir via `skillVerbatimRecords()`
(`src/targets/_shared.ts:226`). No emitter code changes
(`09-integration-and-emission.md`).

### 5.2 Per-target skill root and the fixed sibling hop (REQ-DIAG-02)

`skillRefDir()` (`src/targets/_shared.ts:203`) roots skills per target:

| Target  | Skill root        | doc-site skill dir                | diagram-generator skill dir          |
| ------- | ----------------- | --------------------------------- | ------------------------------------ |
| claude  | `skills/<name>`   | `skills/doc-site-plugin/`         | `skills/diagram-generator/`          |
| codex   | `skills/<name>`   | same                              | same                                 |
| gemini  | `skills/<name>`   | same                              | same                                 |
| cursor  | `rules/<name>`    | `rules/doc-site-plugin/`          | `rules/diagram-generator/`           |
| copilot | `instructions/<name>` | `instructions/doc-site-plugin/` | `instructions/diagram-generator/`  |

Both skills share the same per-target parent in **every** bundle, so the renderer is
always at the **uniform** relative path
`../diagram-generator/scripts/diagram-render.mjs` from the doc-site skill's own dir —
no per-agent branching (tech-spec §3.6, §6). `05-diagrams-component.md` relies on
this fixed path.

## Dependencies

- `00-core-definitions.md` — token vocabulary, component-selection model, the data
  contracts the template groups produce.

## Verification

- `tools.manifest.json` validates against the `Manifest` Zod schema (`src/model.ts`);
  `bun run compile` / `schema:check` pass.
- `build --check` (`src/driftguard.ts`) re-emits in memory and finds the
  `doc-site-plugin` tree byte-identical across all five `adapters/` (REQ-PORT-02).
- `golden.test.ts` asserts the added `SAMPLE_RELPATHS` rows byte-exact.
- The renderer rel-path (`../diagram-generator/scripts/diagram-render.mjs`) resolves
  to a real file under every target's bundle (`05`, `09`).
