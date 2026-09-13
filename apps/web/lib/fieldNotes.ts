import type { ReactNode } from "react";

/** Deterministic paragraph anchoring for Field Notes (Idea 3). Markdown
 * bodies have no stable paragraph identity -- the game plan's own flagged
 * build note -- so a marked paragraph is identified by a hash of its own
 * normalized text, not by document position (paragraph_index is stored
 * too, but only as display/fallback metadata, never as part of the
 * identity key: reordering paragraphs without changing their text should
 * not orphan an existing note).
 *
 * Not a cryptographic hash -- there's no adversary here, just a need for a
 * short, deterministic, collision-unlikely-at-this-scale key computed
 * identically every render (server-side inside Markdown.tsx when checking
 * "is this paragraph already marked," client-side inside
 * FieldNoteParagraph when writing a new mark). A 32-bit rolling hash is
 * more than sufficient for one chronicle entry's worth of paragraphs.
 */

export function extractParagraphText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractParagraphText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractParagraphText(props?.children);
  }
  return "";
}

export function hashParagraph(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  // Include length as a cheap extra collision guard -- two different short
  // strings landing on the same 32-bit hash is far likelier than two
  // different strings also sharing a length.
  return `${hash.toString(36)}-${normalized.length}`;
}
