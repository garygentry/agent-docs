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
- The legend is placed **outside all boundary boxes** — the canvas is expanded to the
  right and the legend lives in the new margin, so it can never overlap a container.

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
  shape the _graph_, not the pixels.

## Faithfulness (the overriding rule)

None of these craft rules license adding content. Color, legend, and grouping make
the _user's_ elements clearer — they never justify inventing a database, gateway, or
cache the user did not describe. See the REQ-IN-03 rule in `SKILL.md`: depict only
what was described.
