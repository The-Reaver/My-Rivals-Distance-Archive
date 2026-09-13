import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Markdown } from "@/components/Markdown";

// Two Dossiers, Side by Side (Idea 9). A static /characters/compare route
// (not [slug]) -- Next.js resolves the literal segment ahead of the
// dynamic one at the same level, so this never collides with a character
// whose slug happens to be "compare."
//
// "The symmetric two-character layout is new, not inherited" (the game
// plan's own correction against reusing the asymmetric Lore Panel) --
// this is a plain 50/50 grid, "visually consistent with the card system"
// rather than a bespoke comparison widget.
//
// The comparison itself is logged as the "purchase-consideration signal"
// the game plan describes, for a signed-in reader only, the moment this
// page renders with two valid, distinct character ids -- viewing the page
// with both ids present *is* the comparison event. Done as a server-side
// insert (this route already has both ids and the request's own auth
// context) rather than a client round-trip. Re-visiting the same pair
// later doesn't add a second row -- character_comparisons' own unique
// constraint (0015) makes that a no-op, caught and ignored here rather
// than surfaced as an error.
export default async function CompareCharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;

  if (!a || !b || a === b) {
    redirect("/characters");
  }

  const supabase = await createClient();

  const { data: characters, error } = await supabase
    .from("characters")
    .select("id, slug, name, aliases, dossier_cover, hook_line, demand_scores(score)")
    .in("id", [a, b]);

  if (error || !characters || characters.length !== 2) {
    redirect("/characters");
  }

  const characterA = characters.find((character) => character.id === a)!;
  const characterB = characters.find((character) => character.id === b)!;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const [lowId, highId] = [a, b].sort();
    // Best-effort: a unique_violation here just means this reader already
    // compared this exact pair before (character_comparisons' own
    // constraint, 0015) -- expected, not surfaced, and never blocks the
    // reader from seeing the comparison itself.
    await supabase.from("character_comparisons").insert({
      reader_id: user.id,
      character_a_id: lowId,
      character_b_id: highId,
    });
  }

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-grid">
        <Link href="/characters" className="font-body text-caption text-accent-steel">
          ← Character Index
        </Link>
        <h1 className="mt-xs font-display text-section-heading text-text-primary">
          {characterA.name} vs. {characterB.name}
        </h1>

        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          {[characterA, characterB].map((character) => {
            const score = Array.isArray(character.demand_scores)
              ? (character.demand_scores[0]?.score ?? 0)
              : 0;
            return (
              <div
                key={character.id}
                className="rounded-card border border-border-subtle bg-bg-elevated p-md"
              >
                <Link
                  href={`/characters/${character.slug}`}
                  className="font-display text-card-title text-text-primary underline-offset-2 hover:underline"
                >
                  {character.name}
                </Link>
                {character.aliases && character.aliases.length > 0 && (
                  <p className="mt-xs font-body text-caption italic text-accent-steel">
                    {character.aliases.join(" · ")}
                  </p>
                )}
                {character.hook_line && (
                  <p className="mt-sm font-body text-body-small text-text-primary">
                    {character.hook_line}
                  </p>
                )}
                <p className="mt-sm font-mono text-metric text-accent-gold">{score} demand</p>
                {character.dossier_cover && (
                  <div className="mt-md">
                    <Markdown>{character.dossier_cover}</Markdown>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
