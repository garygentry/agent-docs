# Initialize the `agent-docs` repo (bare)

## Context

We're establishing a new repo, `agent-docs`, to eventually house coding-agent tools (skills,
plugins, agents, scripts, references) for documentation/support, with multi-agent support while
optimizing for Claude. The structural decisions (canonical-core + adapters, etc.) are noted for
later but are **deferred** — the actual implementation will be driven via the **feature-forge**
plugin.

Per the user's direction: **do not scaffold any directory structure or opinionated artifacts now.**
Simply initialize the repo with git, and prompt to commit/push when ready.

## Approach

1. `git init` in `/home/gary/workspace/agent-docs` (default branch `main`).
2. Stop. The only file present is `plans/we-are-establishing-from-dreamy-fiddle.md`.
3. Do **not** create README, LICENSE, .gitignore, directory skeleton, marketplace.json, or any
   other artifact. Those are deferred to feature-forge.
4. When the user says they're ready, commit and push to a new public GitHub repo
   `garygentry/agent-docs` (gh is authed as `garygentry` over SSH; repo does not yet exist).

## Verification

- `git status` reports a repository on branch `main`.
