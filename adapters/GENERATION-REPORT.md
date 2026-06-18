<!-- GENERATED — DO NOT EDIT. Regenerate: bun run build -->

# Adapter Generation Report

## Summary

1 tool processed: `docs-helper` (skill).

## Coverage by target

| Target | Emitted | Fallback | Skipped | Overridden | Verbatim |
|--------|---------|----------|---------|------------|----------|
| claude | 1 | 0 | 0 | 0 | 3 |
| codex | 1 | 1 | 0 | 0 | 3 |
| copilot | 1 | 2 | 0 | 0 | 3 |
| cursor | 1 | 2 | 0 | 0 | 3 |
| gemini | 2 | 1 | 0 | 0 | 3 |

## Dropped & fallback constructs

### codex

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped |

### copilot

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/docs-helper/SKILL.md` | `skill.argument-hint` | Copilot instructions carry no invocation hint |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Copilot instructions carry only {description, applyTo} |

### cursor

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/docs-helper/SKILL.md` | `skill.argument-hint` | no Cursor .mdc invocation-hint field |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Cursor rules carry only {description, globs, alwaysApply} |

### gemini

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Gemini skill carries only {name, description}; metadata dropped |

## Stale overrides

_None._
