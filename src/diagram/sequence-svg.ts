import { DiagramRenderError } from "./errors.js";
import type { DiagramSpec, Message, Participant } from "./schema.js";

/**
 * `sequence-svg.ts` — direct-SVG layout for `sequence` diagrams
 * (03-rendering-engine.md §4, resolves OTQ-3). Sequence diagrams are Graphviz's
 * weak spot, so they bypass the DOT/`@viz-js/viz` path entirely and are laid out
 * directly as plain-`<text>` SVG. The output is the SAME SVG shape as the graph
 * path (one `<svg>` document, plain `<text>`, no markup labels — REQ-OUT-01) so it
 * flows through the identical post-processing (04 §3) and output assertions
 * (02 §3). It emits structure + geometry only: no color, no font embedding, no
 * a11y nodes (all added in 04). Participant `role` is carried as
 * `class="role-<role>"` on the header `<g>` for later coloring (mirrors §2.5).
 *
 * Deterministic: layout is a pure function of `participants`/`messages` order and
 * the fixed constants (§4.2) — no RNG, no measurement-driven reflow — so the raw
 * SVG is byte-stable before canonicalization (REQ-REPRO-01).
 */

// ---------------------------------------------------------------------------
// Layout constants (03 §4.2). All in user-space px.
// ---------------------------------------------------------------------------

/** Horizontal gap between adjacent lifeline center x-positions. */
const LIFELINE_GAP = 160;
/** Vertical height of one message row (one arrow + its label). */
const MESSAGE_ROW_HEIGHT = 48;
/** Participant header box width. */
const HEADER_WIDTH = 120;
/** Participant header box height. */
const HEADER_HEIGHT = 36;
/** Outer SVG padding on every side. */
const MARGIN = 24;
/** Vertical gap between the header row and the first message row. */
const HEADER_TO_FIRST_MSG = 28;
/** Width of an activation bar drawn over a lifeline. */
const ACTIVATION_WIDTH = 12;
/** Extra vertical span a self-message loop occupies (it spans 1.5 rows). */
const SELF_MESSAGE_EXTRA = Math.round(MESSAGE_ROW_HEIGHT / 2);
/** Right-offset of a self-message loop from its lifeline center. */
const SELF_MESSAGE_LOOP_WIDTH = 40;
/** Font size for participant headers and message labels (matches graph scale). */
const FONT_SIZE = 14;
/** Stable font family placeholder; `04` rewrites to the embedded data-URI face. */
const FONT_FAMILY = "DiagramSans";
/** Length of an arrowhead's barbs. */
const ARROWHEAD_LEN = 8;
/** Half-height of an arrowhead's barbs. */
const ARROWHEAD_HALF = 4;

// ---------------------------------------------------------------------------
// Small SVG/escaping helpers
// ---------------------------------------------------------------------------

/**
 * Escape user text for XML/SVG text content and attribute values: `&`, `<`, `>`,
 * `"`. Keeps output well-formed (02 §3 `assertWellFormed`) for labels containing
 * angle brackets or ampersands.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Center x of participant *i* (0-based) per §4.3. */
function lifelineX(i: number): number {
  return MARGIN + HEADER_WIDTH / 2 + i * LIFELINE_GAP;
}

// ---------------------------------------------------------------------------
// Layout + emit (03 §4.7)
// ---------------------------------------------------------------------------

/**
 * Lay out a `sequence` `DiagramSpec` directly as plain-`<text>` SVG (OTQ-3).
 * Produces the SAME SVG shape as the graph path (§2/§3) — one `<svg>` document,
 * plain `<text>`, no markup labels (REQ-OUT-01) — so it flows through the identical
 * post-processing (04 §3) and output assertions (02 §3). Returns the geometry so
 * `render.ts`/`04` can set `viewBox`/width/height (REQ-OUT-02). Participant `role`
 * is carried as `class="role-<role>"`; color is applied later (04 §3), not here.
 *
 * @param spec - A validated `DiagramSpec` with `diagramType === "sequence"`,
 *   non-empty `participants`, and `messages` in document order.
 * @returns `{ svg, width, height }` — raw (pre-post-process) SVG and its intrinsic
 *   pixel dimensions.
 * @throws {DiagramRenderError} (code `RENDER_FAILED`) if a `Message.from`/`to`
 *   references an unknown participant (defensive — validation already guarantees
 *   referential integrity, 02 §2) or if `participants` is empty.
 */
export function renderSequence(spec: DiagramSpec): { svg: string; width: number; height: number } {
  if (spec.diagramType !== "sequence") {
    throw new DiagramRenderError(
      "renderSequence only handles sequence diagrams",
      `diagramType=${spec.diagramType}`,
    );
  }

  const participants: Participant[] = spec.participants;
  const messages: Message[] = spec.messages;

  if (participants.length === 0) {
    throw new DiagramRenderError("sequence diagram has no participants", "participants.length=0");
  }

  // Defensive referential-integrity guard (§4.7). Validation (02 §2) already
  // guarantees these, but renderSequence fails loudly rather than producing a
  // dangling arrow.
  const indexById = new Map<string, number>();
  participants.forEach((p, i) => {
    indexById.set(p.id, i);
  });
  for (const msg of messages) {
    if (!indexById.has(msg.from)) {
      throw new DiagramRenderError(
        "message references an unknown participant id",
        `message.from=${msg.from}`,
      );
    }
    if (!indexById.has(msg.to)) {
      throw new DiagramRenderError(
        "message references an unknown participant id",
        `message.to=${msg.to}`,
      );
    }
  }

  // ---- Dimensions (§4.3) ----
  const messagesExtra = messages.reduce(
    (acc, msg) => acc + (msg.from === msg.to ? SELF_MESSAGE_EXTRA : 0),
    0,
  );
  const width = MARGIN * 2 + HEADER_WIDTH + (participants.length - 1) * LIFELINE_GAP;
  const height =
    MARGIN * 2 +
    HEADER_HEIGHT +
    HEADER_TO_FIRST_MSG +
    messages.length * MESSAGE_ROW_HEIGHT +
    messagesExtra;

  const headerTop = MARGIN;
  const headerBottom = MARGIN + HEADER_HEIGHT;
  const lifelineBottom = height - MARGIN;

  // Compute each message's row baseline y, accounting for the extra height that
  // preceding self-messages consume (§4.3, §4.5 running y-cursor).
  const firstRowY = MARGIN + HEADER_HEIGHT + HEADER_TO_FIRST_MSG;
  const rowY: number[] = [];
  let cursor = firstRowY;
  for (const msg of messages) {
    rowY.push(cursor);
    cursor += MESSAGE_ROW_HEIGHT + (msg.from === msg.to ? SELF_MESSAGE_EXTRA : 0);
  }

  const body: string[] = [];

  // ---- Lifelines + headers (drawn first, behind everything) ----
  participants.forEach((p, i) => {
    const cx = lifelineX(i);
    const boxX = cx - HEADER_WIDTH / 2;
    const role = p.role ?? "default";
    // Lifeline: dashed vertical line from header bottom to diagram bottom.
    body.push(
      `<line class="lifeline" x1="${cx}" y1="${headerBottom}" x2="${cx}" y2="${lifelineBottom}" stroke="black" stroke-dasharray="4 4" />`,
    );
    // Header group carries the role class for later coloring (§4.1).
    body.push(`<g class="role-${role}">`);
    body.push(
      `<rect class="participant-header" x="${boxX}" y="${headerTop}" width="${HEADER_WIDTH}" height="${HEADER_HEIGHT}" fill="none" stroke="black" />`,
    );
    body.push(
      `<text x="${cx}" y="${headerTop + HEADER_HEIGHT / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">${escapeXml(
        p.label,
      )}</text>`,
    );
    body.push(`</g>`);
  });

  // ---- Activation bars (after lifelines, before arrows so arrows draw on top) ----
  // v1 rule (§4.5): a bar spans from the activating message's row to the next
  // `reply` whose `from` is the activated target; absent a matching reply it spans
  // a single MESSAGE_ROW_HEIGHT.
  messages.forEach((msg, m) => {
    if (msg.activate !== true) return;
    const targetIdx = indexById.get(msg.to);
    if (targetIdx === undefined) return;
    const cx = lifelineX(targetIdx);
    const startY = rowY[m] as number;
    let endY = startY + MESSAGE_ROW_HEIGHT;
    for (let k = m + 1; k < messages.length; k++) {
      const candidate = messages[k] as Message;
      if (candidate.kind === "reply" && candidate.from === msg.to) {
        endY = rowY[k] as number;
        break;
      }
    }
    body.push(
      `<rect class="activation" x="${cx - ACTIVATION_WIDTH / 2}" y="${startY}" width="${ACTIVATION_WIDTH}" height="${endY - startY}" fill="none" stroke="black" />`,
    );
  });

  // ---- Message arrows (on top) ----
  messages.forEach((msg, m) => {
    const fromIdx = indexById.get(msg.from) as number;
    const toIdx = indexById.get(msg.to) as number;
    const y = rowY[m] as number;
    const dashed = msg.kind === "reply";
    const filled = msg.kind === "sync";
    const lineAttrs = dashed ? ` stroke-dasharray="6 4"` : "";

    if (fromIdx === toIdx) {
      // Self-message loop (§4.5): out, down, back with the arrowhead.
      const cx = lifelineX(fromIdx);
      const right = cx + SELF_MESSAGE_LOOP_WIDTH;
      const yTop = y;
      const yBot = y + SELF_MESSAGE_EXTRA;
      body.push(
        `<polyline class="message message-${msg.kind}" points="${cx},${yTop} ${right},${yTop} ${right},${yBot} ${cx},${yBot}" fill="none" stroke="black"${lineAttrs} />`,
      );
      // Arrowhead points left, back into the lifeline, at (cx, yBot).
      body.push(arrowhead(cx, yBot, -1, filled));
      // Label above the loop.
      body.push(
        `<text class="message-label" x="${right + 4}" y="${yTop - 4}" text-anchor="start" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">${escapeXml(
          msg.label,
        )}</text>`,
      );
      return;
    }

    const x1 = lifelineX(fromIdx);
    const x2 = lifelineX(toIdx);
    const dir = x2 > x1 ? 1 : -1;
    // Stop the line short of the lifeline center so the arrowhead tip lands on it.
    const xEnd = x2 - dir * ARROWHEAD_LEN;
    body.push(
      `<line class="message message-${msg.kind}" x1="${x1}" y1="${y}" x2="${xEnd}" y2="${y}" stroke="black"${lineAttrs} />`,
    );
    body.push(arrowhead(x2, y, dir, filled));
    // Label centered above the arrow.
    const midX = (x1 + x2) / 2;
    body.push(
      `<text class="message-label" x="${midX}" y="${y - 6}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">${escapeXml(
        msg.label,
      )}</text>`,
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    body.map((l) => `  ${l}`).join("\n") +
    `\n</svg>\n`;

  return { svg, width, height };
}

/**
 * Emit an arrowhead at tip `(tipX, tipY)` pointing horizontally in `dir`
 * (+1 = right, -1 = left). `filled` → a closed/filled triangle (sync); otherwise
 * an open V-shaped arrowhead (async/reply). Drawn as explicit primitives, never a
 * `<marker>`/`<defs>` reference (§4.4).
 */
function arrowhead(tipX: number, tipY: number, dir: number, filled: boolean): string {
  const backX = tipX - dir * ARROWHEAD_LEN;
  const topY = tipY - ARROWHEAD_HALF;
  const botY = tipY + ARROWHEAD_HALF;
  if (filled) {
    return `<polygon class="arrowhead arrowhead-closed" points="${tipX},${tipY} ${backX},${topY} ${backX},${botY}" fill="black" stroke="black" />`;
  }
  return `<polyline class="arrowhead arrowhead-open" points="${backX},${topY} ${tipX},${tipY} ${backX},${botY}" fill="none" stroke="black" />`;
}
