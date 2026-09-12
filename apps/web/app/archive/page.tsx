import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { titleCase } from "@/lib/format";

// P1-2 (lords-of-cian-archive-game-plan.md, Phase 2): the reader-facing
// surface for archive_documents. Ten of the eleven Knowledge Core document
// types land in this table; until this route existed, none of that content
// had anywhere to render. RLS on archive_documents already restricts what
// comes back to storage_mode = 'live' rows at or below the visitor's
// clearance (0 for anonymous), so no clearance filtering happens here in
// application code -- the same pattern the Character Index route already
// established.
export default async function ArchivePage() {
  const supabase = await createClient();

  const { data: documents, error } = await supabase
    .from("archive_documents")
    .select("id, document_type, title, subtitle, tags, character_id")
    .order("document_type")
    .order("title");

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load the archive: {error.message}
        </p>
      </main>
    );
  }

  const grouped = new Map<string, typeof documents>();
  for (const doc of documents ?? []) {
    const bucket = grouped.get(doc.document_type) ?? [];
    bucket.push(doc);
    grouped.set(doc.document_type, bucket);
  }

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-grid">
        <h1 className="font-display text-section-heading text-text-primary">Archive</h1>
        <p className="mt-xs font-body text-body-small text-accent-steel">
          Source material extracted from the world of The Lords of Cian.
        </p>

        {grouped.size === 0 && (
          <p className="mt-lg font-body text-body text-accent-steel">
            Nothing in the archive is visible yet at your clearance level.
          </p>
        )}

        {[...grouped.entries()].map(([documentType, docs]) => (
          <section key={documentType} className="mt-xl">
            <h2 className="font-display text-card-title text-text-primary">
              {titleCase(documentType)}
            </h2>
            <div className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
              {docs!.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/archive/${doc.id}`}
                  className="rounded-card border border-border-subtle bg-bg-elevated p-md transition-colors duration-hover hover:border-accent-gold/30"
                >
                  <h3 className="font-display text-card-title text-text-primary">{doc.title}</h3>
                  {doc.subtitle && (
                    <p className="mt-xs font-body text-caption italic text-accent-steel">
                      {doc.subtitle}
                    </p>
                  )}
                  {doc.tags && doc.tags.length > 0 && (
                    <p className="mt-sm font-mono text-caption text-accent-gold">
                      {doc.tags.join(" · ")}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
