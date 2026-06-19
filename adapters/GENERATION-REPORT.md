<!-- GENERATED — DO NOT EDIT. Regenerate: bun run build -->

# Adapter Generation Report

## Summary

3 tools processed: `docs-helper` (skill), `diagram-generator` (skill), `doc-site-plugin` (skill).

## Coverage by target

| Target | Emitted | Fallback | Skipped | Overridden | Verbatim |
|--------|---------|----------|---------|------------|----------|
| claude | 3 | 0 | 0 | 0 | 36 |
| codex | 3 | 3 | 0 | 0 | 36 |
| copilot | 3 | 6 | 0 | 0 | 36 |
| cursor | 3 | 6 | 0 | 0 | 36 |
| gemini | 4 | 3 | 0 | 0 | 36 |

## Dropped & fallback constructs

### codex

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/diagram-generator/SKILL.md` | `skill.metadata` | Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped |
| `skills/doc-site-plugin/SKILL.md` | `skill.metadata` | Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped |

### copilot

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/diagram-generator/SKILL.md` | `skill.argument-hint` | Copilot instructions carry no invocation hint |
| `skills/diagram-generator/SKILL.md` | `skill.metadata` | Copilot instructions carry only {description, applyTo} |
| `skills/doc-site-plugin/SKILL.md` | `skill.argument-hint` | Copilot instructions carry no invocation hint |
| `skills/doc-site-plugin/SKILL.md` | `skill.metadata` | Copilot instructions carry only {description, applyTo} |
| `skills/docs-helper/SKILL.md` | `skill.argument-hint` | Copilot instructions carry no invocation hint |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Copilot instructions carry only {description, applyTo} |

### cursor

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/diagram-generator/SKILL.md` | `skill.argument-hint` | no Cursor .mdc invocation-hint field |
| `skills/diagram-generator/SKILL.md` | `skill.metadata` | Cursor rules carry only {description, globs, alwaysApply} |
| `skills/doc-site-plugin/SKILL.md` | `skill.argument-hint` | no Cursor .mdc invocation-hint field |
| `skills/doc-site-plugin/SKILL.md` | `skill.metadata` | Cursor rules carry only {description, globs, alwaysApply} |
| `skills/docs-helper/SKILL.md` | `skill.argument-hint` | no Cursor .mdc invocation-hint field |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Cursor rules carry only {description, globs, alwaysApply} |

### gemini

| Source | Construct | Reason |
|--------|-----------|--------|
| `skills/diagram-generator/SKILL.md` | `skill.metadata` | Gemini skill carries only {name, description}; metadata dropped |
| `skills/doc-site-plugin/SKILL.md` | `skill.metadata` | Gemini skill carries only {name, description}; metadata dropped |
| `skills/docs-helper/SKILL.md` | `skill.metadata` | Gemini skill carries only {name, description}; metadata dropped |

## Stale overrides

_None._
