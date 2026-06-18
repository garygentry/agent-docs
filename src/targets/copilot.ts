import type { TargetTransform } from "./_shared.js";

/**
 * PLACEHOLDER for the copilot target (04 §10).
 *
 * Item 008 defines the {@link TargetTransform} contract and the registry; the real
 * copilot mapping rules are implemented by a later backlog item (009-012), which
 * replaces this file. Until then every method throws so a premature call is loud,
 * never a silent wrong emit. The engine (013) depends on those items, so this stub
 * is never exercised in a real build.
 */
const NOT_IMPLEMENTED = "copilot transform not implemented yet (backlog item 009-012)";

export const copilotTransform: TargetTransform = {
  target: "copilot",
  transformSkill() {
    throw new Error(NOT_IMPLEMENTED);
  },
  transformAgent() {
    throw new Error(NOT_IMPLEMENTED);
  },
  transformCommand() {
    throw new Error(NOT_IMPLEMENTED);
  },
  aggregateManifest: () => null,
};
