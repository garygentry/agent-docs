---
# GENERATED — DO NOT EDIT. Source: skills/diagram-generator/SKILL.md. Regenerate: bun run build
description: Generate rich, professional diagrams as SVG (and PNG) images instead of ASCII art. Use whenever the user asks to create a diagram, visualize architecture, draw a system design, create a flowchart, illustrate data flow, map out infrastructure, show how something works, or produce any technical visual — including sequence diagrams, ER diagrams, network topologies, pipeline flows, state machines, and deployment architectures. Even if the user says "ASCII diagram", produce an image with this skill.
applyTo: "**"
---

# diagram-generator

Turn a natural-language request into a polished, tier-2-portable diagram image.
You author an engine-neutral `DiagramSpec` JSON from the user's prose, then invoke
the bundled renderer CLI. There is **no separate natural-language renderer** — both
the conversational path (you, from prose) and the scriptable path (a build step,
from a committed file) converge on the **same CLI execution path**. The only
difference is who produces the `DiagramSpec`.

## When to use

Use for ANY request to visualize, draw, diagram, illustrate, or show how a system,
flow, or relationship works. Six diagram types are supported:
`architecture`, `flowchart`, `sequence`, `er`, `state`, `dataflow`.

## Reference docs (read before authoring)

- **`references/schema-guide.md`** — the human-readable `DiagramSpec` reference:
  every field, the six `diagramType` values, the closed `NodeRole` vocabulary, the
  sequence-only `participants`/`messages` fields, the `diagramType`↔field-agreement
  rules, and a worked JSON example per type. This is your authoring reference for
  step 2 below.
- **`references/diagram-craft.md`** — the craft rules a good diagram honors: the
  role→color taxonomy, z-order (arrows behind boxes), legend placement, and
  spacing. Use it to choose roles and structure that render well.

## Conversational procedure

When a user asks for a diagram:

1. **Elicit / confirm** the diagram type and the concrete elements the user
   described — components, connections, groupings (or participants and ordered
   messages for a sequence diagram). Do not interrogate; infer the obvious and
   confirm only what is genuinely ambiguous.
2. **Translate prose → a `DiagramSpec` JSON** conforming to the schema
   (`references/schema-guide.md`): `nodes`/`edges`/`containers` for graph types, or
   `participants`/`messages` for `sequence`. Assign each node a semantic `role`
   from the closed `NodeRole` taxonomy **only where the user's description implies
   one** (a "Postgres database" → `database`; an unqualified "service" → omit role).
3. **Write the JSON to a temp file** (e.g. `/tmp/diagram-spec.json`), or pipe it
   to the CLI via `-`.
4. **Invoke the bundled CLI** at
   `skills/diagram-generator/scripts/diagram-render.mjs` (or the adapter-relative
   path under the running target) with the appropriate flags — the exact same
   contract a build step uses (see "Scriptable invocation" below).
5. **Report the written artifact path(s)** on success. On a non-zero exit, surface
   the CLI's **stderr verbatim** to the user, correct the spec, and re-invoke.

## REQ-IN-03 — depict only what the user described

**Depict only what the user described. Never invent semantic content, components,
or architecture the user did not state.** Do not add implied databases, assumed
gateways, caches, load balancers, queues, or "typical" components to make the
diagram look complete. The schema validates _structural_ well-formedness, not
_semantic_ faithfulness — this prompt discipline is the **only** thing that keeps
the diagram true to the request.

- ✅ User: _"a web app talking to an API"_ → two nodes (`webapp` → `api`) and one
  edge. Nothing else.
- ❌ Do **not** add a `database`, `cache`, or `gateway` node the user never
  mentioned, even if such a system "usually" has one.

If the user's description is genuinely incomplete and a component seems necessary,
**ask** — do not silently fill it in.

## Scriptable invocation (mode parity)

The conversational path and the non-interactive scriptable path are **both P0** and
**converge on this one CLI**. The CLI contract is frozen and versioned
(`--version` prints `CONTRACT_VERSION`); consumers such as `doc-site-plugin` pin
against it. See `specs/diagram-generator/05-cli-and-invocation.md` for the full
contract.

```
diagram-render <input.json | -> [options]

  --type   <architecture|flowchart|sequence|er|state|dataflow>  override spec.diagramType
  --theme  <light|dark>     default: spec.theme (else "light")
  --accent <#rrggbb>        override spec.accent (validated as #rrggbb)
  --format <svg|png|both>   default: "svg"
  --out-file <path>         explicit output path (highest precedence)
  --out-name <base>         base name written into --out-dir (overrides slug)
  --out-dir  <dir>          directory for derived/named artifacts; default <slug>.<theme>.<ext>
  --version                 print CONTRACT_VERSION, exit 0
  -                         read spec JSON from stdin; with no output target → SVG to stdout
```

Output-path precedence (highest → lowest):
`--out-file` > `--out-dir` + `--out-name` > `--out-dir` + `<slug>` > stdout.
A `png`/`both` format with no resolved file target is refused (binary must not
stream to stdout). Writes are confined to the caller-specified directory. Exit `0`
on success; distinct non-zero codes per failure class with a stderr message and
**no partial writes**.

Examples:

```bash
# Conversational: write a spec, render both variants side by side
node skills/diagram-generator/scripts/diagram-render.mjs /tmp/spec.json \
    --theme dark --out-dir /tmp/diagrams        # → <slug>.dark.svg

# Explicit, fully caller-controlled (the build-step shape)
node skills/diagram-generator/scripts/diagram-render.mjs spec.json \
    --type architecture --format both --out-file out/arch.svg   # → out/arch.svg + out/arch.png

# Stdin → stdout (single SVG)
cat spec.json | node skills/diagram-generator/scripts/diagram-render.mjs -

# Pin the contract version
node skills/diagram-generator/scripts/diagram-render.mjs --version   # → 1.0.0
```

Because both modes run the identical bundled CLI, behavior is the same regardless
of which of the five agent targets runs the skill.
