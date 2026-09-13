import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bookPlacementLabel } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { ReadingProgressTracker } from "@/components/ReadingProgressTracker";

// Chronicle reader -- the page every /characters/[slug] link and every
// admin ChronicleEditor.tsx save has been pointing at without it existing.
// entryNumber is scoped per-character (chronicle_entries has a
// unique(character_id, entry_number) constraint, not a global sequence), so
// this route needs the character row first to resolve character_id before
// the entry lookup can run.
//
// RLS on chronicle_entries already restricts what comes back to
// storage_mode = 'live' rows at or below the visitor's clearance (or any
// row, for an admin) -- same notFound()-for-gated-or-missing pattern as
// /archive/[id].
export default async function ChronicleEntryPage({
  params,
}: {
  params: Promise<{ slug: string; entryNumber: string }>;
}) {
  const { slug, entryNumber } = await params;
  const entryNumberValue = Number(entryNumber);

  if (!Number.isInteger(entryNumberValue)) {
    notFound();
  }

  const supabase = await createClient();

  const { data: character, error: characterError } = await supabase
    .from("characters")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();

  if (characterError) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load this Chronicle: {characterError.message}
        </p>
      </main>
    );
  }

  if (!character) {
    notFound();
  }

  const { data: entry, error: entryError } = await supabase
    .from("chronicle_entries")
    .select(
      "id, entry_number, arc_label, title, body_markdown, onyx_commentary, book_placement, publish_date",
    )
    .eq("character_id", character.id)
    .eq("entry_number", entryNumberValue)
    .maybeSingle();

  if (entryError) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load this Chronicle: {entryError.message}
        </p>
      </main>
    );
  }

  if (!entry) {
    notFound();
  }

  // Field Notes (Idea 3): fetch which paragraphs this reader has already
  // marked in this entry, so Markdown can render their "Marked" state
  // correctly on first paint rather than flashing unmarked-then-marked.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let markedHashes = new Set<string>();
  if (user) {
    const { data: notes } = await supabase
      .from("field_notes")
      .select("paragraph_hash")
      .eq("reader_id", user.id)
      .eq("chronicle_entry_id", entry.id);
    markedHashes = new Set((notes ?? []).map((note) => note.paragraph_hash));
  }

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <ReadingProgressTracker chronicleEntryId={entry.id} />
      <article className="mx-auto max-w-reader">
        <Link
          href={`/characters/${character.slug}`}
          className="font-body text-caption text-accent-steel"
        >
          ← {character.name}
        </Link>

        <p className="mt-md font-mono text-caption text-accent-gold">
          {entry.arc_label ? `${entry.arc_label} · ` : ""}
          {bookPlacementLabel(entry.book_placement)}
        </p>
        <h1 className="mt-xs font-display text-page-title text-text-primary">{entry.title}</h1>
        {entry.publish_date && (
          <p className="mt-xs font-body text-caption text-accent-steel">
            {new Date(entry.publish_date).toLocaleDateString()}
          </p>
        )}

        {entry.body_markdown && (
          <Markdown
            fieldNotes={{
              chronicleEntryId: entry.id,
              markedHashes,
              isSignedIn: !!user,
            }}
          >
            {entry.body_markdown}
          </Markdown>
        )}

        {entry.onyx_commentary && (
          <div className="mt-xl border-t border-border-subtle pt-md">
            <p className="font-mono text-caption text-accent-steel">Onyx of Oblivion</p>
            <div className="mt-xs">
              <Markdown>{entry.onyx_commentary}</Markdown>
            </div>
          </div>
        )}
      </article>
    </main>
  );
}
