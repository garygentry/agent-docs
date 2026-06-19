# Traceability Matrix — doc-site-plugin

Maps every PRD requirement (`REQ-XXX-NN`) to the implementation spec document(s)
that cover it. Generated as part of forge-3-specs Step 5.

- **Total requirements:** 34
- **Uncovered requirements:** 0
- **Spec documents:** 11 (`00`–`10`)

Validated by `scripts/validate-traceability.py` (deterministic): zero uncovered
requirements.

| Requirement   | Covered by |
| ------------- | ---------- |
| REQ-DETECT-01 | `02-detection-and-interview` |
| REQ-DETECT-02 | `00-core-definitions`, `02-detection-and-interview` |
| REQ-INT-01    | `02-detection-and-interview` |
| REQ-INT-02    | `02-detection-and-interview` |
| REQ-CORE-01   | `00-core-definitions`, `01-architecture-layout`, `03-core-site-and-manifest`, `10-testing-strategy` |
| REQ-CORE-02   | `03-core-site-and-manifest`, `06-deploy-and-monorepo` |
| REQ-CORE-03   | `03-core-site-and-manifest`, `05-diagrams-component` |
| REQ-CONTENT-01| `00-core-definitions`, `03-core-site-and-manifest`, `04-content-symlink-layer`, `10-testing-strategy` |
| REQ-CONTENT-02| `04-content-symlink-layer`, `10-testing-strategy` |
| REQ-CONTENT-03| `00-core-definitions`, `03-core-site-and-manifest`, `07-drift-guard`, `10-testing-strategy` |
| REQ-CONTENT-04| `00-core-definitions`, `02-detection-and-interview`, `03-core-site-and-manifest`, `04-content-symlink-layer` |
| REQ-DIAG-01   | `00-core-definitions`, `05-diagrams-component` |
| REQ-DIAG-02   | `01-architecture-layout`, `05-diagrams-component`, `09-integration-and-emission` |
| REQ-DIAG-03   | `00-core-definitions`, `05-diagrams-component`, `08-rerun-and-verification`, `10-testing-strategy` |
| REQ-DEPLOY-01 | `06-deploy-and-monorepo` |
| REQ-DEPLOY-02 | `03-core-site-and-manifest`, `06-deploy-and-monorepo` |
| REQ-DRIFT-01  | `04-content-symlink-layer`, `07-drift-guard` |
| REQ-DRIFT-02  | `07-drift-guard` |
| REQ-RERUN-01  | `00-core-definitions`, `03-core-site-and-manifest`, `04-content-symlink-layer`, `08-rerun-and-verification` |
| REQ-RERUN-02  | `00-core-definitions`, `03-core-site-and-manifest`, `08-rerun-and-verification` |
| REQ-VERIFY-01 | `00-core-definitions`, `01-architecture-layout`, `03-core-site-and-manifest`, `05-diagrams-component`, `08-rerun-and-verification`, `10-testing-strategy` |
| REQ-VERIFY-02 | `00-core-definitions`, `04-content-symlink-layer`, `05-diagrams-component`, `07-drift-guard`, `08-rerun-and-verification`, `10-testing-strategy` |
| REQ-VERIFY-03 | `00-core-definitions`, `01-architecture-layout`, `02-detection-and-interview`, `06-deploy-and-monorepo`, `07-drift-guard`, `08-rerun-and-verification` |
| REQ-VERIFY-04 | `00-core-definitions`, `08-rerun-and-verification` |
| REQ-REL-01    | `03-core-site-and-manifest`, `04-content-symlink-layer`, `06-deploy-and-monorepo`, `08-rerun-and-verification` |
| REQ-REL-02    | `00-core-definitions`, `03-core-site-and-manifest`, `05-diagrams-component`, `08-rerun-and-verification`, `10-testing-strategy` |
| REQ-SEC-01    | `04-content-symlink-layer`, `08-rerun-and-verification` |
| REQ-SEC-02    | `04-content-symlink-layer`, `08-rerun-and-verification` |
| REQ-SEC-03    | `00-core-definitions`, `02-detection-and-interview`, `07-drift-guard`, `08-rerun-and-verification` |
| REQ-PORT-01   | `05-diagrams-component`, `06-deploy-and-monorepo`, `07-drift-guard` |
| REQ-PORT-02   | `00-core-definitions`, `01-architecture-layout`, `02-detection-and-interview`, `03-core-site-and-manifest`, `04-content-symlink-layer`, `07-drift-guard`, `09-integration-and-emission`, `10-testing-strategy` |
| REQ-PORT-03   | `06-deploy-and-monorepo`, `08-rerun-and-verification` |
| REQ-USE-01    | `00-core-definitions`, `01-architecture-layout`, `02-detection-and-interview`, `03-core-site-and-manifest`, `04-content-symlink-layer`, `05-diagrams-component`, `06-deploy-and-monorepo`, `07-drift-guard`, `10-testing-strategy` |
| REQ-USE-02    | `00-core-definitions`, `02-detection-and-interview`, `03-core-site-and-manifest`, `06-deploy-and-monorepo`, `08-rerun-and-verification` |

## Constraints (CON-*) coverage

| Constraint | Where reflected |
| ---------- | --------------- |
| CON-01 (Astro 5 + Starlight) | `03-core-site-and-manifest` |
| CON-02 (canonical skill, emitted to 5 targets) | `01-architecture-layout`, `09-integration-and-emission` |
| CON-03 (agent-driven, conversational) | `02-detection-and-interview` |
| CON-04 (faithful to canon.md) | `03`, `04`, `06`, `07` |
| CON-05 (diagram-generator hard prerequisite) | `05-diagrams-component`, `09-integration-and-emission` |

## Notes

- **Orphaned references (benign):** the validator flags `REQ-DISC-01` and
  `REQ-TOOLS-01` as orphaned. These are **not** this feature's requirements — they
  are the host `agent-docs` emitter's own requirement vocabulary, quoted verbatim
  inside a `src/model.ts` source excerpt in `09-integration-and-emission.md`. They
  belong to a different namespace and are intentionally reproduced, mirroring the
  sibling `diagram-generator` spec's treatment.
- **Open questions** OQ-1/OQ-2/OQ-3 (PRD) and their tech-spec resolutions are
  reflected in `08-rerun-and-verification` (OQ-1 version pinning, OQ-3 never-clobber)
  and `00`/`03`/`07` (OQ-2 `unmanaged` escape hatch). OQ-4 is resolved upstream
  (diagram-generator shipped).
