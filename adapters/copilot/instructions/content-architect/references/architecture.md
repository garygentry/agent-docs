# Architecture documentation — C4 + arc42 + ADRs

Use this when `scope` is `architecture`. Three complementary frameworks cover the
maintainer-facing spine: **C4** gives leveled structural views, **arc42** gives a document
checklist, and **ADRs** capture decisions. Use them as tools, not obligations.

## Guiding caution: keep it at a surviving altitude

Architecture docs rot fastest when they describe things that change often. Document at the
altitude that survives change:

- Prefer the _why_ and the _shape_ over line-level detail.
- Skip C4's "Code" level — the code is its own source of truth and the diagram drifts
  immediately.
- Do not fill every arc42 chapter on a small repo. An empty chapter is worse than an
  absent one.
- Every structural claim must trace to a `sources[]` entry; unverifiable topology → `gaps`.

## C4 — leveled structural views

C4 (by Simon Brown, <https://c4model.com>) zooms from the outside in. Each level is a
`c4-view` DocPlanEntry with a `subtype`:

1. **Context** (`subtype: "context"`) — the system as one box among its users and external
   systems. Answers "what is this and who/what does it talk to."
2. **Container** (`subtype: "container"`) — the deployable/running units inside the system
   (services, datastores, queues, front ends) and how they communicate. This is the
   highest-value level for most services — derive it from entrypoint wiring.
3. **Component** (`subtype: "component"`) — the major building blocks inside one container.
   Use sparingly, only where a container is genuinely complex.
4. **Code** — usually **skip.** Class/function detail belongs in the code.

Each C4 view typically carries a `diagrams[]` request; describe only nodes you verified in
source (entrypoints, wiring, CI).

## arc42 — the maintainer document set (a checklist)

arc42 (<https://arc42.org>) is a 12-section template. Treat it as a menu — plan the
chapters that carry signal for _this_ repo as `arc42-chapter` entries (with the chapter
name as `subtype`):

1. Introduction and goals
2. Constraints
3. Context and scope
4. Solution strategy
5. Building-block view
6. Runtime view
7. Deployment view
8. Crosscutting concepts
9. Architecture decisions (often just links to ADRs)
10. Quality requirements
11. Risks and technical debt
12. Glossary

For a small service, "context and scope", "building-block view", "deployment view", and
"risks and technical debt" usually earn their place; the rest often do not.

## ADRs — architecture decision records

One decision per record (Michael Nygard's format). Each is an `adr` DocPlanEntry. The
body has three parts:

- **Context** — the forces at play, what made the decision necessary.
- **Decision** — what was chosen, stated in the active voice.
- **Consequences** — what becomes easier and harder as a result.

Number ADRs sequentially and treat them as immutable — supersede rather than edit. When you
find existing ADRs in source (e.g. `docs/adr/`), record them as `status: "existing"` and
plan around them; do not rewrite settled decisions.

## Mapping to a sidebar

A conventional `grouping` for the architecture spine:

1. **Architecture** — the C4 views and the arc42 chapters.
2. **Decisions** — the ADRs, in numeric order.
