import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { titleCase, bookPlacementLabel } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { ShareButton } from "@/components/ShareButton";

// Detail reader for a single archive_documents row. RLS already limits what
// this query can return to storage_mode = 'live' rows at or below the
// visitor's clearance (or any row, for an admin) -- a row outside that set
// simply doesn't come back, which is indistinguishable from "doesn't exist"
// from here, so a missing row and a gated row both render as notFound().
//
// structured_data is a JSON catch-all (System Explanation's per-document-type
// shape). This ships a generic key/value rendering of it rather than bespoke
// layouts per document_type -- ten genuinely different shapes (Arsenal
// Dossier vs. Tactical Architecture vs. Political Atlas, etc.) is real
// design work for a later pass; this makes every document readable now.
export default async function ArchiveDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc, error } = await supabase
    .from("archive_documents")
    .select(
      "id, document_type, title, subtitle, body_markdown, structured_data, tags, book_placement, character_id, characters(slug, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load this document: {error.message}
        </p>
      </main>
    );
  }

  if (!doc) {
    notFound();
  }

  const character = Array.isArray(doc.characters) ? doc.characters[0] : doc.characters;
  const structuredEntries = Object.entries(
    (doc.structured_data as Record<string, unknown>) ?? {},
  );

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <article className="mx-auto max-w-reader">
        <Link href="/archive" className="font-body text-caption text-accent-steel">
          ← Archive
        </Link>

        <p className="mt-md font-mono text-caption text-accent-gold">
          {titleCase(doc.document_type)} · {bookPlacementLabel(doc.book_placement)}
        </p>
        <h1 className="mt-xs font-display text-page-title text-text-primary">{doc.title}</h1>
        {doc.subtitle && (
          <p className="mt-xs font-body text-body italic text-accent-steel">{doc.subtitle}</p>
        )}
        {character && (
          <Link
            href={`/characters/${character.slug}`}
            className="mt-sm inline-block font-body text-body-small text-accent-steel underline underline-offset-2"
          >
            {character.name}
          </Link>
        )}
        {doc.tags && doc.tags.length > 0 && (
          <p className="mt-sm font-mono text-caption text-accent-steel">{doc.tags.join(" · ")}</p>
        )}
        <div className="mt-xs">
          <ShareButton entityType="archive_document" entityId={doc.id} />
        </div>

        {doc.body_markdown && <Markdown>{doc.body_markdown}</Markdown>}

        {structuredEntries.length > 0 && (
          <dl className="mt-xl border-t border-border-subtle pt-md">
            {structuredEntries.map(([key, value]) => (
              <div key={key} className="mt-sm">
                <dt className="font-mono text-caption text-accent-steel">{titleCase(key)}</dt>
                <dd className="mt-xs font-body text-body-small text-text-primary">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </article>
    </main>
  );
}
