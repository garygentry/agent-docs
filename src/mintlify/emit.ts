/**
 * Assemble a canonical Mintlify `docs.json` (the Mintlify twin of the Starlight
 * `generateManifest`, skills/doc-site/references/mintlify/overview.md §Determinism).
 *
 * Generating the object programmatically — rather than substituting a multi-line
 * `{{MINT_NAVIGATION}}` block into the template by hand — is what makes the emitted
 * docs.json pretty AND byte-stable across runs (identical input ⇒ identical bytes), so an
 * idempotent re-run is a no-op diff (rerun.md §3). The key order below is the fixed
 * canonical order.
 */
import { type Navigation } from "./navigation.js";
import { type DocsJson } from "./validate.js";

export interface DocsJsonInput {
  readonly theme: string;
  readonly name: string;
  readonly description: string;
  /** Primary brand color (hex). */
  readonly primary: string;
  /** Light-tint of the primary (hex). */
  readonly light: string;
  /** Dark-tint of the primary (hex). */
  readonly dark: string;
  /** GitHub URL for the navbar link + footer social. Omitted from output when empty. */
  readonly githubUrl: string;
  readonly navigation: Navigation;
}

/** Build docs.json with the canonical key order (overview.md §Determinism). */
export function buildDocsJson(input: DocsJsonInput): DocsJson {
  const docs: Record<string, unknown> = {
    $schema: "https://mintlify.com/docs.json",
    theme: input.theme,
    name: input.name,
    description: input.description,
    colors: { primary: input.primary, light: input.light, dark: input.dark },
    favicon: "/favicon.svg",
    navigation: input.navigation,
  };
  if (input.githubUrl) {
    docs.navbar = { links: [{ label: "GitHub", href: input.githubUrl }] };
    docs.footer = { socials: { github: input.githubUrl } };
  }
  return docs as DocsJson;
}

/** Serialize docs.json deterministically: 2-space indent, trailing newline. */
export function serializeDocsJson(docs: DocsJson): string {
  return JSON.stringify(docs, null, 2) + "\n";
}
