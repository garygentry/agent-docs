---
name: docs-helper
description: Helps write and review project documentation following the repo's house style. Use when authoring or editing docs, READMEs, or reference pages.
metadata:
  argument-hint: "[doc-path]"
  allowed-tools: Read, Edit, Write
---

# docs-helper

Assist with writing and reviewing documentation for this repository.

## When to use

Use when the user is authoring or editing documentation — READMEs, reference
pages, or guides — and wants it to match the project's house style.

This skill is the **style** layer. Deciding _what_ to document and how the corpus
is organized is the `content-architect` skill's job; rendering a site or README is
the endpoint skills' job. The pipeline runs content-architect → docs-helper →
endpoint (`doc-site` / `readme-author`).

## How to help

1. Read the target document (and `references/style-guide.md` in this skill).
2. Check it against the house-style checklist below.
3. Propose concrete edits; do not rewrite wholesale without asking.

## House-style checklist

- One sentence per line for prose; wrap at ~90 columns.
- Headings are sentence-case.
- Every code block declares a language.
- Link to the canonical source, not a copy.

See `references/style-guide.md` for the full rules.
