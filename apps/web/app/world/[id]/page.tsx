import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { titleCase, bookPlacementLabel } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { ShareButton } from "@/components/ShareButton";

// Detail reader for a single world_briefings row -- the missing half of
// P1-2 (see /world/page.tsx). RLS already limits what this query can
// return to storage_mode = 'live' rows at or below the visitor's clearance
// (or any row, for an admin) -- a row outside that set simply doesn't come
// back, same notFound()-for-gated-or-missing pattern as /archive/[id].
export default async function WorldBriefingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: briefing, error } = await supabase
    .from("world_briefings")
    .select("id, category, title, body_markdown, book_placement, related_character_ids")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load this briefing: {error.message}
        </p>
      </main>
    );
  }

  if (!briefing) {
    notFound();
  }

  const { data: relatedCharacters } =
    briefing.related_character_ids && briefing.related_character_ids.length > 0
      ? await supabase
          .from("characters")
          .select("id, slug, name")
          .in("id", briefing.related_character_ids)
      : { data: [] };

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <article className="mx-auto max-w-reader">
        <Link href="/world" className="font-body text-caption text-accent-steel">
          ← World
        </Link>

        <p className="mt-md font-mono text-caption text-accent-gold">
          {titleCase(briefing.category)} · {bookPlacementLabel(briefing.book_placement)}
        </p>
        <h1 className="mt-xs font-display text-page-title text-text-primary">{briefing.title}</h1>
        <div className="mt-xs">
          <ShareButton entityType="world_briefing" entityId={briefing.id} />
        </div>

        {relatedCharacters && relatedCharacters.length > 0 && (
          <p className="mt-sm font-body text-body-small text-accent-steel">
            Related:{" "}
            {relatedCharacters.map((character, index) => (
              <span key={character.id}>
                {index > 0 && ", "}
                <Link
                  href={`/characters/${character.slug}`}
                  className="text-accent-gold underline underline-offset-2"
                >
                  {character.name}
                </Link>
              </span>
            ))}
          </p>
        )}

        {briefing.body_markdown && (
          <Markdown connectiveTissue={{ sourceId: briefing.id }}>{briefing.body_markdown}</Markdown>
        )}
      </article>
    </main>
  );
}
