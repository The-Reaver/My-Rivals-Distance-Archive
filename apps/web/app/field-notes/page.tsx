import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// "Marked passages collect in the reader's private profile" (Idea 3). No
// broader reader-profile page exists yet, so this gets its own route, same
// pattern /notifications already established rather than /welcome (this
// list can grow large over many chronicles/visits; /welcome stays a
// one-glance landing page).
//
// RLS's field_notes_select_own already scopes this to the reader's own
// rows; a marked entry whose chronicle_entries row has since become
// invisible to them (clearance/live-status changed) simply comes back
// with a null nested relation -- rendered as plain quoted text with no
// link, rather than erroring or dropping the note.
export default async function FieldNotesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signup");
  }

  const { data: notes, error } = await supabase
    .from("field_notes")
    .select(
      "id, paragraph_text, created_at, chronicle_entries(entry_number, title, characters(slug, name))",
    )
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-reader">
        <h1 className="font-display text-section-heading text-text-primary">Field Notes</h1>
        <p className="mt-xs font-body text-body-small text-accent-steel">
          Passages you&rsquo;ve marked as significant, across every Chronicle.
        </p>

        {error && (
          <p className="mt-lg font-body text-body text-accent-ember">
            Could not load your field notes: {error.message}
          </p>
        )}

        {!error && (!notes || notes.length === 0) && (
          <p className="mt-lg font-body text-body-small text-accent-steel">
            Nothing marked yet. Hover a paragraph in a Chronicle and mark it as significant.
          </p>
        )}

        {notes && notes.length > 0 && (
          <ul className="mt-lg space-y-md">
            {notes.map((note) => {
              const entry = Array.isArray(note.chronicle_entries)
                ? note.chronicle_entries[0]
                : note.chronicle_entries;
              const character = entry
                ? Array.isArray(entry.characters)
                  ? entry.characters[0]
                  : entry.characters
                : null;

              return (
                <li
                  key={note.id}
                  className="rounded-card border border-border-subtle bg-bg-elevated p-md"
                >
                  <p className="font-body text-body italic text-text-primary">
                    &ldquo;{note.paragraph_text}&rdquo;
                  </p>
                  {entry && character ? (
                    <Link
                      href={`/characters/${character.slug}/chronicles/${entry.entry_number}`}
                      className="mt-xs inline-block font-body text-caption text-accent-gold underline underline-offset-2"
                    >
                      {character.name} — {entry.title}
                    </Link>
                  ) : (
                    <p className="mt-xs font-body text-caption text-accent-steel">
                      This Chronicle is no longer visible at your clearance level.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
