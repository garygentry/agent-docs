# DiagramSpec — authoring reference

The `DiagramSpec` is the engine-neutral JSON you author from the user's prose. It is
the single input to the render pipeline. This guide documents every field, the six
diagram types, the `NodeRole` vocabulary, and a worked JSON example per type.

The schema is **strict**: unknown top-level keys are rejected. A malformed spec fails
loudly at the CLI boundary (exit code `2`, `DiagramInputError`) with the offending
JSON path — correct it and re-invoke.

## Top-level fields

| Field          | Type                                      | Required                   | Notes                                          |
| -------------- | ----------------------------------------- | -------------------------- | ---------------------------------------------- |
| `diagramType`  | one of the six types                      | yes                        | selects the render path                        |
| `title`        | string                                    | yes                        | → SVG `<title>`; also the filename slug source |
| `description`  | string                                    | yes                        | → SVG `<desc>` (accessibility)                 |
| `theme`        | `"light"` \| `"dark"`                     | no (default `"light"`)     | CLI `--theme` overrides                        |
| `accent`       | `#rrggbb` hex                             | no                         | CLI `--accent` overrides                       |
| `background`   | `transparent` \| `opaque` \| `#rrggbb`    | no (default `transparent`) | CLI `--background` overrides                   |
| `direction`    | `LR` \| `TB` \| `RL` \| `BT`              | no (per-type default)      | graph layout; CLI `--direction` overrides      |
| `fill`         | `translucent` \| `solid` \| `transparent` | no (default `translucent`) | role-shape fill; CLI `--fill-style` overrides  |
| `nodes`        | `Node[]`                                  | graph types                | empty for `sequence`                           |
| `edges`        | `Edge[]`                                  | graph types                | empty for `sequence`                           |
| `containers`   | `Container[]`                             | optional (graph)           | boundary/group clusters                        |
| `participants` | `Participant[]`                           | `sequence` only            | lifelines                                      |
| `messages`     | `Message[]`                               | `sequence` only            | ordered arrows                                 |

### `diagramType` ↔ field agreement

Two field families are mutually exclusive by type:

| `diagramType`                                          | Populated                      | Must be empty                  |
| ------------------------------------------------------ | ------------------------------ | ------------------------------ |
| `architecture`, `flowchart`, `er`, `state`, `dataflow` | `nodes`, `edges`, `containers` | `participants`, `messages`     |
| `sequence`                                             | `participants`, `messages`     | `nodes`, `edges`, `containers` |

A `sequence` spec carrying `nodes`, or a graph spec with empty `nodes`, is rejected.

## Object shapes

> **Multi-line labels.** For the graph diagram types (`architecture`, `flowchart`,
> `er`, `state`, `dataflow`), a `\n` inside a `label` (node, edge, or container)
> becomes a line break — the text renders as stacked, centered lines and the box is
> sized to fit. Use it for a title plus a secondary line (e.g. a name + a
> command/qualifier). In JSON this is a real escape: `"label": "Stage 1 · PRD\nforge-1-prd"`
> (two lines), **not** a literal backslash-n. Sequence `participant`/`message` labels
> are **single-line only** — a `\n` there is not honored.

### Node

- `id` — unique id (alphanumeric, `-`, `_`); referenced by edges and container children.
- `label` — visible plain-text label (no markup). `\n` → line break on graph types
  (see the multi-line note above); single-line on sequence diagrams.
- `role` — optional `NodeRole` (see below); omitted → `"default"` (uncolored).
- `shape` — optional `box` \| `rounded` \| `cylinder` \| `diamond` \| `ellipse`;
  sensible per-type defaults apply when omitted.

### Edge

- `from`, `to` — node ids that **must exist** in `nodes`.
- `label` — optional connector label. `\n` → line break (graph types).
- `direction` — `forward` (default) \| `back` \| `both` \| `none`.
- `style` — `solid` (default) \| `dashed` \| `dotted` \| `bold`.

### Container

- `id` — unique id (shares the node id namespace for reference checks).
- `label` — boundary label. `\n` → line break (graph types).
- `children` — node ids enclosed; each **must exist** in `nodes`.
- `parent` — optional container id for nesting; **must exist** in `containers`.

### Participant (sequence only)

- `id` — unique id; referenced by messages.
- `label` — lifeline header label.
- `role` — optional `NodeRole` for the header color.

### Message (sequence only)

- `from`, `to` — participant ids that **must exist** (`from === to` is a self-message).
- `label` — message label.
- `kind` — `sync` (default, solid closed arrow) \| `async` (open arrow) \| `reply` (dashed).
- `activate` — boolean; draws an activation bar on the target.

## NodeRole vocabulary (closed)

`role` is the key into the color palette. Assign one **only** where the user's
description implies it; otherwise omit it. The closed set:

`default`, `frontend`, `backend`, `database`, `queue`, `cache`, `external`,
`security`, `gateway`, `storage`, `compute`.

See `diagram-craft.md` for the color intent behind each role.

## Worked examples (one per type)

### architecture

```json
{
  "diagramType": "architecture",
  "title": "Web App Architecture",
  "description": "A browser frontend calling an API backend backed by a database.",
  "nodes": [
    { "id": "web", "label": "Web App", "role": "frontend" },
    { "id": "api", "label": "API Service", "role": "backend" },
    { "id": "db", "label": "PostgreSQL", "role": "database", "shape": "cylinder" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "HTTPS" },
    { "from": "api", "to": "db", "label": "SQL" }
  ],
  "containers": [{ "id": "cloud", "label": "Cloud VPC", "children": ["api", "db"] }]
}
```

### flowchart

```json
{
  "diagramType": "flowchart",
  "title": "Login Flow",
  "description": "Decision flow for authenticating a user.",
  "nodes": [
    { "id": "start", "label": "Start", "shape": "rounded" },
    { "id": "check", "label": "Valid credentials?", "shape": "diamond" },
    { "id": "ok", "label": "Grant access" },
    { "id": "deny", "label": "Show error" }
  ],
  "edges": [
    { "from": "start", "to": "check" },
    { "from": "check", "to": "ok", "label": "yes" },
    { "from": "check", "to": "deny", "label": "no" }
  ]
}
```

### sequence

```json
{
  "diagramType": "sequence",
  "title": "Checkout Sequence",
  "description": "Client requests checkout; server confirms via the payment gateway.",
  "participants": [
    { "id": "client", "label": "Client", "role": "frontend" },
    { "id": "server", "label": "Server", "role": "backend" },
    { "id": "pay", "label": "Payment Gateway", "role": "external" }
  ],
  "messages": [
    {
      "from": "client",
      "to": "server",
      "label": "POST /checkout",
      "kind": "sync",
      "activate": true
    },
    { "from": "server", "to": "pay", "label": "charge()", "kind": "sync" },
    { "from": "pay", "to": "server", "label": "ok", "kind": "reply" },
    { "from": "server", "to": "client", "label": "200 OK", "kind": "reply" }
  ]
}
```

### er

```json
{
  "diagramType": "er",
  "title": "Blog Schema",
  "description": "Users author posts; posts have comments.",
  "nodes": [
    { "id": "user", "label": "User\nid\nname\nemail", "role": "database" },
    { "id": "post", "label": "Post\nid\ntitle\nauthor_id", "role": "database" },
    { "id": "comment", "label": "Comment\nid\npost_id\nbody", "role": "database" }
  ],
  "edges": [
    { "from": "user", "to": "post", "label": "writes", "direction": "none" },
    { "from": "post", "to": "comment", "label": "has", "direction": "none" }
  ]
}
```

### state

```json
{
  "diagramType": "state",
  "title": "Order State Machine",
  "description": "Lifecycle of an order from creation to delivery.",
  "nodes": [
    { "id": "new", "label": "New", "shape": "rounded" },
    { "id": "paid", "label": "Paid", "shape": "rounded" },
    { "id": "shipped", "label": "Shipped", "shape": "rounded" },
    { "id": "done", "label": "Delivered", "shape": "rounded" }
  ],
  "edges": [
    { "from": "new", "to": "paid", "label": "pay" },
    { "from": "paid", "to": "shipped", "label": "ship" },
    { "from": "shipped", "to": "done", "label": "deliver" }
  ]
}
```

### dataflow

```json
{
  "diagramType": "dataflow",
  "title": "Ingest Pipeline",
  "description": "Events flow from the collector through a queue into storage.",
  "nodes": [
    { "id": "collector", "label": "Collector", "role": "compute" },
    { "id": "bus", "label": "Event Queue", "role": "queue" },
    { "id": "worker", "label": "Worker", "role": "compute" },
    { "id": "store", "label": "Data Lake", "role": "storage", "shape": "cylinder" }
  ],
  "edges": [
    { "from": "collector", "to": "bus", "label": "events" },
    { "from": "bus", "to": "worker", "label": "consume" },
    { "from": "worker", "to": "store", "label": "write" }
  ]
}
```
