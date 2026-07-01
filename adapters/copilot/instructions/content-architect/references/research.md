# Research — the source-of-truth mining playbook

This is the Phase 1 detail: how to derive ground truth from a repo, network-free, and
record it into `sources[]`. The governing principle: **verify what the code _does_; do not
trust what comments, names, or existing docs _claim_ it does.**

## Order of reliability

Read roughly in this order — earlier sources anchor _what_ the project is; later sources
reveal _why_ it is that way. Weight tests heavily.

### 1. Entry points (`type: entrypoint`)

`main`, CLI command definitions, server bootstrap, package `exports`. These tell you what
the thing is and where execution starts. Follow the wiring from the entry point outward to
learn the real component graph — this is also the ground truth for C4 container views.

### 2. Build/package manifests (`type: manifest`)

`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc. Dependencies reveal the
stack; `scripts` reveal the real build/test/run commands; the package name and `exports`
reveal the public surface. The declared entry points and bin names are authoritative.

### 3. Public API surface (`type: api`)

Exported symbols, route tables, OpenAPI/GraphQL schemas, published types. This is what
end-user reference documents are built from. Prefer generated schemas and exported type
signatures over prose descriptions of the API.

### 4. Tests — especially integration tests (`type: test`)

**The most reliable source of intended behavior.** Tests encode how the authors expect the
code to be used, and — unlike comments and READMEs — they fail when they drift, so they
stay honest. Integration and end-to-end tests are the canonical usage examples: a passing
integration test is a verified, copy-pasteable quickstart. Mine them for tutorials and
how-tos, and cite them in `sourceRefs`/`verification`.

### 5. Config and environment (`type: config`)

Config schemas, `.env.example`, settings modules, flag definitions. These define the real
knobs. Document only keys you can see defined and read in code — not aspirational ones.

### 6. Data models and migrations (`type: schema`)

ORM models, schema definitions, migration history. They reveal the domain and its
evolution. Migrations show what actually shipped over time.

### 7. CI/CD pipelines (`type: ci`)

`.github/workflows/`, other pipeline configs. How the project is _actually_ built,
tested, and deployed — the authoritative deployment story when no infrastructure-as-code
exists. Note in `gaps` when deployment topology is inferred from CI alone.

### 8. History, ADRs, issues (`type: history` / `type: adr`)

Commit history, existing ADRs, and the issue tracker carry the _why_ behind decisions —
the raw material for explanation documents and ADRs. Existing ADRs are settled decisions:
record them as `existing` and plan around them.

## Does it, vs is supposed to do it

The recurring trap is documenting intent instead of behavior. To stay accurate:

- **Trust tests over comments.** A comment can lie for years; a test cannot (it fails).
- **Trust code over existing docs.** Existing docs are exactly the thing that drifts;
  never treat them as ground truth — treat them as claims to verify (this is the audit
  path).
- **Trust generated schemas over hand-written descriptions.**
- When code and a comment disagree, the code wins, and the discrepancy itself is worth a
  `gap` note.

## Recording findings

Every source you rely on becomes a `sources[]` entry with a stable `id`, its `path` (or
glob), a `type` from the list above, and a short `note` on what it establishes. Every
document and every outline heading then cites the `sources[].id` it derives from, so the
whole plan is traceable. Anything you could not pin to a source goes in `gaps[]` — never
into a document as an unqualified fact.
