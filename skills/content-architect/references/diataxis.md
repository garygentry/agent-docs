# Diátaxis — the end-user documentation spine

Use this when `scope` is `end-user`. Diátaxis (by Daniele Procida,
<https://diataxis.fr>) organizes documentation into four modes, each serving a distinct
reader need. The cardinal rule: **one mode per document.**

## The two axes

Diátaxis places each mode on two axes — whether the reader is _studying_ or _working_, and
whether they need _practical steps_ or _theoretical knowledge_:

|           | Practical (action) | Theoretical (cognition) |
| --------- | ------------------ | ----------------------- |
| **Study** | Tutorial           | Explanation             |
| **Work**  | How-to guide       | Reference               |

## The four modes

### Tutorial — learning-oriented, on-rails

A lesson. The reader is a beginner who wants to _learn by doing_. You hold their hand
through a guaranteed-to-succeed sequence.

- Present tense, imperative: "Run this. You will see…".
- Every step must work; no branching, no options, no "you could also…".
- Concrete and specific: one path, one outcome. Defer explanation.
- Success is a working result and a reader who feels capable.

### How-to guide — goal-oriented, for a competent reader

A recipe. The reader already knows the basics and has a specific goal: "How do I configure
X?" You give the steps to reach that goal.

- Named by the goal: "How to deploy behind a proxy".
- Assumes competence; omits teaching.
- May branch on real-world conditions ("if you use Docker…").
- Success is the reader's goal accomplished.

### Reference — information-oriented, for lookup

A map. Neutral, factual description of the machinery — API signatures, config keys, CLI
flags. The reader consults it while working.

- Neutral, factual, present tense. Describe, do not instruct or persuade.
- Structured for scanning and lookup, mirroring the code's own structure.
- Complete and accurate over readable-as-prose.
- Success is the reader finding the fact fast.

### Explanation — understanding-oriented, the "why"

A discussion. Background, context, trade-offs, alternatives considered. The reader wants to
_understand_, not to do something right now.

- Discursive; makes connections; admits trade-offs and history.
- Named around a topic or question: "Why the SDK retries idempotently".
- No steps to follow; nothing to look up.
- Success is a reader who understands the design.

## The single-mode rule (the one hard structural rule)

A document serves **exactly one** mode. Mixing modes serves none of them well: a tutorial
that stops to explain loses the beginner; a reference that turns into a how-to becomes
un-scannable.

### Before → after (mode-mixing, and the fix)

**Before (mixed — a tutorial that becomes reference then explanation):**

> ## Getting started
>
> 1. Install with `npm i acme`.
> 2. Call `client.send()`. `send(payload, opts)` accepts `retries` (default 3),
>    `timeout` (default 30s), `signal`… _(reference creeps in)_
> 3. We use exponential backoff because the Acme API rate-limits aggressively, which we
>    learned after… _(explanation creeps in)_

**After (three documents, one mode each):**

- **Tutorial — "Get started":** install, then one `client.send()` call that succeeds.
  Nothing else.
- **Reference — "Client API":** the full `send(payload, opts)` signature and every option.
- **Explanation — "How retries work":** why backoff is idempotent and the rate-limit
  history.

When you catch an outline drifting across modes in Phase 3, split it into separate
`DocPlanEntry` items rather than letting one document carry two `type`s.

## Mapping modes to a sidebar

The four modes translate directly into `grouping` sections that `doc-site` renders as
sidebar groups. A conventional order that lets readers flow from learning to mastery:

1. **Getting started** — tutorials.
2. **How-to guides** — task recipes.
3. **Reference** — the lookup material.
4. **Explanation** — the background.

Sequence documents within and across groups so a newcomer can move tutorial → how-to →
reference → explanation without backtracking.
