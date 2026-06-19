/**
 * Shared diagram test fixtures (08 §7.2): one minimal valid DiagramSpec per type,
 * conforming to the 00 §2 schema and the 02 §2 cross-field invariants. Reused by
 * the golden, property, determinism, PNG, and CLI suites (items 016/017/018) so
 * all tests agree on the inputs.
 *
 * Each graph-shaped fixture carries `nodes`/`edges` with empty sequence fields,
 * and the sequence fixture is the inverse (02 §2.5). Every fixture sets a distinct
 * `title`/`description` for a11y (REQ-A11Y-01) and one type-distinctive feature so
 * its goldens genuinely exercise the type rather than re-rendering an architecture
 * graph (08 §7.2 per-type contract). Node shapes are restricted to the 00 §2.2
 * shape enum (`box`/`rounded`/`cylinder`/`diamond`/`ellipse`).
 */
import type { DiagramSpec } from "./schema.js";

/** A fixture pairs a spec with an optional accent for theme-override coverage. */
export interface DiagramFixture {
  readonly spec: DiagramSpec;
  readonly accent?: string;
}

/** Architecture: containers + multiple roles + accent (drives REQ-COV-01 §4.3). */
export const architectureFixture: DiagramFixture = {
  accent: "#2563eb",
  spec: {
    diagramType: "architecture",
    title: "Web Service",
    description: "A frontend talking to a backend and a database.",
    theme: "light",
    accent: "#2563eb",
    nodes: [
      { id: "web", label: "Web", role: "frontend" },
      { id: "api", label: "API", role: "backend" },
      { id: "db", label: "DB", role: "database", shape: "cylinder" },
    ],
    edges: [
      { from: "web", to: "api", label: "HTTP" },
      { from: "api", to: "db", label: "SQL" },
    ],
    containers: [{ id: "svc", label: "Service", children: ["api", "db"] }],
    participants: [],
    messages: [],
  },
};

/** Flowchart: a decision (diamond) node with two labelled outgoing branches. */
export const flowchartFixture: DiagramFixture = {
  spec: {
    diagramType: "flowchart",
    title: "Order Check",
    description: "An order is checked for stock then shipped or backordered.",
    theme: "light",
    nodes: [
      { id: "start", label: "Receive Order", role: "default" },
      { id: "check", label: "In Stock?", role: "default", shape: "diamond" },
      { id: "ship", label: "Ship", role: "default" },
      { id: "back", label: "Backorder", role: "default" },
    ],
    edges: [
      { from: "start", to: "check" },
      { from: "check", to: "ship", label: "yes" },
      { from: "check", to: "back", label: "no" },
    ],
    containers: [],
    participants: [],
    messages: [],
  },
};

/** Sequence fixture: participants + messages, empty graph fields (02 §2.5). */
export const sequenceFixture: DiagramFixture = {
  spec: {
    diagramType: "sequence",
    title: "Login",
    description: "A user authenticates against the API.",
    theme: "light",
    nodes: [],
    edges: [],
    containers: [],
    participants: [
      { id: "user", label: "User", role: "external" },
      { id: "api", label: "API", role: "backend" },
    ],
    messages: [
      { from: "user", to: "api", label: "POST /login", kind: "sync", activate: true },
      { from: "api", to: "user", label: "200 OK", kind: "reply" },
    ],
  },
};

/** ER: two entities joined by an undirected edge carrying a cardinality label. */
export const erFixture: DiagramFixture = {
  spec: {
    diagramType: "er",
    title: "Customer Orders",
    description: "A customer places many orders.",
    theme: "light",
    nodes: [
      { id: "customer", label: "Customer", role: "default" },
      { id: "order", label: "Order", role: "default" },
    ],
    edges: [{ from: "customer", to: "order", label: "1..*" }],
    containers: [],
    participants: [],
    messages: [],
  },
};

/** State: an initial state, a working state, and a final state with transitions. */
export const stateFixture: DiagramFixture = {
  spec: {
    diagramType: "state",
    title: "Job Lifecycle",
    description: "A job runs to completion from an initial state.",
    theme: "light",
    nodes: [
      { id: "init", label: "Start", role: "default", shape: "ellipse" },
      { id: "running", label: "Running", role: "compute" },
      { id: "done", label: "Done", role: "default", shape: "ellipse" },
    ],
    edges: [
      { from: "init", to: "running", label: "begin" },
      { from: "running", to: "done", label: "finish" },
    ],
    containers: [],
    participants: [],
    messages: [],
  },
};

/** Dataflow: a process node and a data store (cylinder) with a directed flow. */
export const dataflowFixture: DiagramFixture = {
  spec: {
    diagramType: "dataflow",
    title: "Ingest Pipeline",
    description: "A processor writes records into a data store.",
    theme: "light",
    nodes: [
      { id: "proc", label: "Processor", role: "compute" },
      { id: "store", label: "Records", role: "storage", shape: "cylinder" },
    ],
    edges: [{ from: "proc", to: "store", label: "write" }],
    containers: [],
    participants: [],
    messages: [],
  },
};

/** Every fixture, in stable order (drives the table-driven golden/property loops). */
export const FIXTURES: readonly DiagramFixture[] = [
  architectureFixture,
  flowchartFixture,
  sequenceFixture,
  erFixture,
  stateFixture,
  dataflowFixture,
];
