/** A "cross-link" (Idea 8's own term) is a markdown link pointing to
 * another in-world entity's own detail page, as opposed to an external
 * URL or a link back to an index/list page. Kept as one small helper so
 * Markdown.tsx and CrossLinkAnchor.tsx agree on the definition. */
const CROSS_LINK_PATTERN = /^\/(characters|world|archive)\/[^/]+/;

export function isCrossLinkTarget(href: string | undefined): href is string {
  return typeof href === "string" && CROSS_LINK_PATTERN.test(href);
}
