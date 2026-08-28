# Mintlify API docs — OpenAPI-driven tab (agent reference)

A **Mintlify-unique** capability with no Starlight analogue: point `docs.json` navigation at an
OpenAPI (or AsyncAPI) spec and Mintlify auto-generates interactive endpoint pages — including a
live playground — with **zero hand-authored page stubs**. This is the single biggest reason to
prefer Mintlify for an API/SDK project, and it costs no duplicated content.

## When it applies

Emit an API tab/group when **both**:

- Phase 1 Probe 8 (`detect.md`) found an OpenAPI/AsyncAPI spec (e.g. `openapi.yaml`), **or** the
  DocPlan has a `sources[]` entry of `type: api`; **and**
- the user opted in (interview M3 `apiDocs`, auto-offered when a spec is detected).

## Wiring

Add `"openapi": "<path-to-spec>"` to a navigation group (or tab). With **no** `pages` listed,
Mintlify generates one page per endpoint automatically:

```jsonc
"navigation": {
  "tabs": [
    { "tab": "Documentation", "groups": [ /* the DocPlan-derived guides */ ] },
    { "tab": "API reference", "openapi": "openapi.yaml" }
  ]
}
```

To curate order or add prose, list endpoints explicitly by `METHOD /path`:

```jsonc
{ "group": "Users", "openapi": "openapi.yaml", "pages": ["GET /users", "POST /users"] }
```

The spec file lives in the repo (symlink it into `{{DOCS_PKG_DIR}}/` in symlink mode, or
reference its repo-relative path). Do **not** hand-author endpoint stubs — that would duplicate
what Mintlify generates from the spec. Verify with `mint validate` (`verify.md`), which resolves
the spec and the generated routes.

## Interaction with the DocPlan

The api-docs tab is **additive** to the DocPlan-derived guides — the guides come from `grouping`
(`docplan-adapter.md`), the API reference comes from the spec. When `scopeTabs` is already
producing tabs, add the API reference as one more tab; otherwise promote the flat groups into a
"Documentation" tab and add an "API reference" tab beside it.
