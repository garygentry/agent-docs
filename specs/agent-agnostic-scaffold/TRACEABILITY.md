# Traceability Matrix — agent-agnostic-scaffold

Maps every PRD requirement to the implementation spec document(s) that cover it.
Generated and verified with `validate-traceability.py` (31 requirements, 0 orphaned
references). The only uncovered requirement is **REQ-PERF-01**, an explicit P2
non-target ("no hard build-speed target this version") with nothing to implement.

| REQ ID            | Requirement (summary)                                          | Spec documents                     |
| ----------------- | -------------------------------------------------------------- | ---------------------------------- |
| REQ-STRUCT-01     | Canonical layout separating source / adapters / scripts        | 01                                 |
| REQ-STRUCT-02     | Adapters in committed in-repo `adapters/<target>/`             | 01                                 |
| REQ-STRUCT-03     | Claude artifacts are canonical source of truth                 | 01                                 |
| REQ-STRUCT-04     | Authoring conventions documented                               | 01                                 |
| REQ-TOOLS-01      | Skills                                                         | 00, 03, 04, 07                     |
| REQ-TOOLS-02      | Agents / subagents                                             | 03, 04                             |
| REQ-TOOLS-03      | Slash commands                                                 | 01, 03, 04                         |
| REQ-TOOLS-04      | Shared scripts & references                                    | 01, 03                             |
| REQ-DISC-01       | Explicit tool manifest                                         | 00, 02, 03                         |
| REQ-DISC-02       | Manifest is single source for emitter + drift guard            | 02, 06                             |
| REQ-DISC-03       | Manifest has validatable schema                                | 00, 01, 02, 08                     |
| REQ-EMIT-01       | Local build command                                            | 01                                 |
| REQ-EMIT-02       | Per-target transform rule set                                  | 04, 08                             |
| REQ-EMIT-03 / 03a | Best-effort fallback + coverage entry/warning, no silent drops | 00, 03, 04, 06, 07, 08             |
| REQ-EMIT-04       | Per-target override slots (distinguishable)                    | 00, 01, 05, 08                     |
| REQ-EMIT-05       | Idempotent, safe re-run                                        | 05, 08                             |
| REQ-EMIT-06       | Byte-stable output (canonical + overrides)                     | 00, 01, 02, 03, 04, 05, 06, 07, 08 |
| REQ-EMIT-07       | Emit all four targets                                          | 00, 04, 07                         |
| REQ-EMIT-08       | Stale-output cleanup on tool removal/rename                    | 05, 06, 08                         |
| REQ-VALID-01      | Drift guard (re-emit + diff, local & CI)                       | 02, 06, 07, 08                     |
| REQ-VALID-02      | Drift guard fails the build on drift                           | 06, 08                             |
| REQ-VALID-03      | Per-target schema validation                                   | 04, 06, 08                         |
| REQ-VALID-04      | Golden-file snapshot tests                                     | 06, 08                             |
| REQ-VALID-05      | Per-target coverage / capability report                        | 00, 01, 05, 06, 07, 08             |
| REQ-PKG-01        | Installable Claude plugin                                      | 01, 07, 08                         |
| REQ-REUSE-01      | Reusable in other repos (config-driven)                        | 00, 01, 02, 03, 06, 07             |
| REQ-PERF-01       | No hard build-speed target (P2)                                | — (explicit non-target)            |
| REQ-OBS-01        | Per-run human-readable summary                                 | 00, 05, 06, 08                     |
| REQ-OBS-02        | Drift output identifies which files differ & how               | 00, 06                             |
| REQ-REL-01        | Deterministic + idempotent emitter                             | 00, 03, 04, 05, 07, 08             |
| REQ-SEC-01        | Write confinement                                              | 00, 01, 02, 03, 05                 |

## Success-criteria coverage

| SC             | Proven by                                                   |
| -------------- | ----------------------------------------------------------- |
| SC-01          | 02 (manifest), 01 §2.3 (authoring flow), 08 §9              |
| SC-02          | 07 (sample skill → all targets), 06 §5 + 08 §6 (golden)     |
| SC-03          | 05 §6 (determinism), 08 §5.1                                |
| SC-04          | 06 §2 (content drift), 08 §5.2                              |
| SC-05 / SC-05a | 05 (override survival / stale), 06 §2 (orphan), 08 §5.2–5.3 |
| SC-06          | 06 §3 (coverage report), 08 §4.5                            |
| SC-07          | 07 (plugin), 08 §6.4                                        |
| SC-08          | 06 §4–5 (schema + golden), 08 §6–7                          |

## Resolved open questions

| OQ / TQ                             | Resolution                                                                                                                   | Where             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| OQ-03 (override merge semantics)    | File-level whole-file replace, separate `overrides/` tree                                                                    | 05                |
| OQ-04 (MVP sample tool)             | One simple docs-helper **skill**                                                                                             | 07                |
| OQ-05 (plugin manifest specifics)   | `.claude-plugin/{plugin,marketplace}.json`, feature-forge shapes                                                             | 07                |
| TQ-1 (per-target command formats)   | Grounded in 2026 target docs: Codex/Gemini commands = TOML, Cursor `.md`, Copilot `.prompt.md`; low-confidence items flagged | 04 §TQ Resolution |
| TQ-2 (codex structural agent keys)  | Codex agents = TOML, no `tools:` array → claude `tools`/`model` keys dropped with record                                     | 04                |
| TQ-3 (skill metadata/allowed-tools) | Captured in `SkillRecord.metadata`, order-preserved; per-target keep/drop in 04                                              | 03 §4             |
| TQ-4 (manifest↔source cross-check)  | Cross-check name/type vs on-disk frontmatter; error on mismatch                                                              | 02                |

## Implementer WARNINGs carried forward (verify before relying)

- **Codex** per-agent tool-restriction key (config-layer, not `tools:` array); user skills path `~/.agents/skills` vs `~/.codex/skills`; `~/.codex/prompts` commands are OpenAI-**deprecated** in favor of Skills.
- **Cursor** custom slash-command argument syntax is unconfirmed — `argument-hint` is dropped/flattened, not mapped.
- **Gemini** `GEMINI.md` has no documented frontmatter schema.
- **Copilot** prompt/agent frontmatter `mode` vs `agent` key; legacy `.chatmode.md` superseded by `.agent.md`.
- **TOML byte-stability**: `smol-toml` key ordering must be deterministic (pre-sort if needed) to satisfy REQ-EMIT-06.
