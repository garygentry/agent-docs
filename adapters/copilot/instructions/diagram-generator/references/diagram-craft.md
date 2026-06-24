# Diagram craft rules

The craft conventions an emitted diagram honors. The renderer enforces most of these
mechanically (color baking, z-order, legend, spacing); your job when authoring a
`DiagramSpec` is to choose roles and structure that let these rules do good work.

## Role color taxonomy

`role` is a semantic key, not a literal color. Each role maps to a fill/stroke/text
triple resolved per theme, so the _same_ role reads correctly on light and dark
backgrounds. Assign a role by what a component **is**, not by a color you want.

| Role       | Color intent | Use for                                                      |
| ---------- | ------------ | ------------------------------------------------------------ |
| `default`  | neutral grey | components with no meaningful type (omit `role` to get this) |
| `frontend` | cyan         | UIs, web/mobile apps, clients                                |
| `backend`  | green        | services, APIs, application servers                          |
| `database` | violet       | relational/document databases, ER entities                   |
| `queue`    | orange       | message queues, event buses, brokers                         |
| `cache`    | red          | caches, in-memory stores                                     |
| `external` | grey         | third-party / outside-the-boundary systems                   |
| `security` | rose/pink    | auth, secrets, identity, firewalls                           |
| `gateway`  | amber        | API gateways, load balancers, ingress                        |
| `storage`  | teal         | object stores, file/blob storage, data lakes                 |
| `compute`  | blue         | workers, functions, batch/compute nodes                      |

Guidance:

- Pick the **single closest** role; do not stack meaning. A "Postgres cache layer"
  is one thing — choose `database` or `cache` by its primary purpose.
- Leave `role` **off** when the user gave no type signal. An unroled node is neutral,
  which is honest; a wrong role is misleading.
- `accent` (`#rrggbb`) recolors edges and the default stroke only — it does not
  change semantic role fills, so brand color never overrides meaning.

### Fill style

Role shapes (and the matching legend swatches) are **translucent by default**
(`fill-opacity` 0.8), which reads softly over any host surface. Override per render
with `--fill-style` (or the `fill` spec field):

- `translucent` — role color at 0.8 opacity (default).
- `solid` — opaque role color.
- `transparent` — outline-only (`fill="none"`, role stroke kept) for a wireframe look.

The choice applies uniformly to every role node and is mirrored on the legend so the
swatches always match the nodes.

### Card style & panel

Nodes render as **elevated cards by default** — rounded corners plus a soft drop
shadow — sitting on an **opaque, rounded, bordered theme panel** (`--background
opaque`, the default). This is what makes a generated diagram read like a polished,
self-contained figure rather than loose shapes. Override per render:

- `--card-style flat` — square corners, no shadow, for a lighter/plainer look.
- `--background transparent` — drop the panel so the diagram blends into the host
  surface (use only when embedding onto an already-styled background).

### Two-line node labels

Give important nodes a **title plus a short descriptor** on a second line with `\n`
(e.g. `"bun run build\n(emitter)"`). The descriptor adds context without widening the
layout much and makes each card self-explanatory — prefer it over cramming detail into
one long line.

## Z-order (paint order)

The renderer enforces a fixed back→front paint order so the diagram is always
legible:

```
backdrop  →  containers  →  edges  →  nodes  →  node labels  →  legend
```

Consequences you can rely on: **arrows route behind boxes**, **labels sit on top of
their boxes**, container boundaries sit behind their contents, and the legend is
never occluded. You do not order elements yourself — declare nodes/edges naturally
and the renderer bands them.

## Legend

- A legend is emitted **only** when the diagram uses more than one distinct semantic
  role (a single-role or all-`default` diagram needs no key).
- One row per role present (excluding `default`): a swatch plus the title-cased role
  name.
- The legend is placed **outside all boundary boxes** and never overlaps a container.
  Placement is **automatic** (`--legend auto`): a **bottom row** for wide/horizontal
  diagrams (so they don't grow even wider) and a **right column** for tall ones. Force
  a side with `--legend right|bottom`, or omit the key with `--legend none`.

Authoring implication: roles are doing double duty as both color and legend entries.
Consistent, accurate roles produce a clean, self-documenting key; ad-hoc roles
produce a noisy one.

## Spacing & layout

- Layout (node placement, ranks, routing) is computed by the engine — do not try to
  position anything manually; there are no coordinate fields.
- Use `containers` to express real grouping (a VPC, a trust boundary, a subsystem).
  Boundaries render as dashed boxes behind their children and keep related nodes
  together. Nest with `parent` only when the user described nesting.
- Keep labels short — they render as plain text inside boxes; long labels widen the
  layout. For ER entities, put each field on its own line with `\n`.
- Direction is engine-chosen per type (e.g. graphs flow left-to-right or top-down);
  shape the _graph_, not the pixels. For a long linear flow that renders as an
  unreadable ultra-wide strip (the CLI warns past ~6:1), pass `--direction TB` to wrap
  it vertically, or group stages into `containers`.

## Faithfulness (the overriding rule)

None of these craft rules license adding content. Color, legend, and grouping make
the _user's_ elements clearer — they never justify inventing a database, gateway, or
cache the user did not describe. See the REQ-IN-03 rule in `SKILL.md`: depict only
what was described.
