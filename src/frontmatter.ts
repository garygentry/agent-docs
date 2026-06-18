import { Document, parseDocument, YAMLMap } from "yaml";
import type { ParsedDoc } from "./model.js";
import { YAML_OPTS } from "./model.js";
import { MalformedFrontmatterError } from "./errors.js";

/**
 * Order-preserving YAML frontmatter parse/serialize (03 §2).
 *
 * Both functions are pure (no I/O). `parseFrontmatter` splits the leading
 * `---`-fenced YAML block from the markdown body and parses it into an
 * insertion-order-preserving `Map`; `serializeFrontmatter` renders such a Map
 * back to a byte-stable block. Order preservation is load-bearing for
 * determinism (REQ-EMIT-06): Map insertion order is the canonical order and
 * keys are never sorted here.
 */

/** The delimiter line for a frontmatter block (column-0, exact). */
const FM_DELIM = "---";

/**
 * Parse a canonical markdown file into ordered frontmatter + body.
 *
 * The frontmatter block is delimited by the first column-0 `---` and the next
 * column-0 `---`. The block is parsed with the `yaml` package and MUST be a
 * mapping. Map insertion order mirrors YAML document order (REQ-EMIT-06), so a
 * round-trip through {@link serializeFrontmatter} preserves author key order.
 * The body after the closing delimiter is preserved byte-for-byte.
 *
 * @param content - Full file contents, `\n`-normalized.
 * @param sourcePath - Repo-relative POSIX path, used only for error messages.
 * @returns The parsed frontmatter Map (insertion-ordered) and the body string.
 * @throws {MalformedFrontmatterError} when there is no balanced `---/---` pair,
 *   the block fails to parse as YAML, or the block is not a mapping.
 */
export function parseFrontmatter(content: string, sourcePath: string): ParsedDoc {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0]?.trim() !== FM_DELIM) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: missing opening frontmatter '---'`,
      sourcePath,
    );
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FM_DELIM) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: missing closing frontmatter '---'`,
      sourcePath,
    );
  }

  const block = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n");

  let doc;
  try {
    doc = parseDocument(block, { keepSourceTokens: false });
  } catch (err) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: invalid YAML frontmatter: ${(err as Error).message}`,
      sourcePath,
    );
  }
  if (doc.errors.length > 0) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: invalid YAML frontmatter: ${doc.errors[0]!.message}`,
      sourcePath,
    );
  }
  const value = doc.toJS({ mapAsMap: true });
  if (!(value instanceof Map)) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: frontmatter is not a YAML mapping`,
      sourcePath,
    );
  }
  return { frontmatter: value as Map<string, unknown>, body };
}

/**
 * Serialize an ordered frontmatter Map + body back into a complete markdown
 * document with a `---`-delimited block.
 *
 * Keys are emitted in the Map's iteration order — callers (`04-transforms.md`)
 * pre-order the Map per `KEY_ORDER` (00 §5) before calling this, so output is
 * byte-stable (REQ-EMIT-06). Serialization uses `YAML_OPTS` (`sortKeys: false`,
 * wide line width) so the `yaml` writer never reorders or reflows. This function
 * does NOT inject a provenance header — that is `04-transforms.md`'s job (Form A).
 *
 * @param map - Ordered frontmatter keys → values.
 * @param body - The markdown body to append after the closing `---`.
 * @returns `---\n<yaml>---\n<body>` with a single `\n` after the closing delimiter.
 */
export function serializeFrontmatter(map: Map<string, unknown>, body: string): string {
  const doc = new Document();
  doc.contents = new YAMLMap();
  for (const [key, value] of map) {
    (doc.contents as YAMLMap).set(key, value);
  }
  const yaml = doc.toString(YAML_OPTS);
  // doc.toString() already ends with "\n"; the block is bracketed by delimiters.
  return `---\n${yaml}---\n${body}`;
}
