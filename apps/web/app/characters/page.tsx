import { createClient } from "@/lib/supabase/server";

// Visual Direction 6. Character Index -- grid of character cards, sorted by
// reader demand score by default. This is the verification vertical slice:
// proves Next.js -> Supabase (anon key) -> RLS -> rendered page works.
export default async function CharacterIndexPage() {
  const supabase = await createClient();

  const { data: characters, error } = await supabase
    .from("characters")
    .select("id, slug, name, hook_line, classification_status, demand_scores(score)")
    .order("name");

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load characters: {error.message}
        </p>
      </main>
    );
  }

  const sorted = [...(characters ?? [])].sort((a, b) => {
    const scoreA = Array.isArray(a.demand_scores) ? (a.demand_scores[0]?.score ?? 0) : 0;
    const scoreB = Array.isArray(b.demand_scores) ? (b.demand_scores[0]?.score ?? 0) : 0;
    return scoreB - scoreA;
  });

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-grid">
        <h1 className="font-display text-section-heading text-text-primary">
          Character Index
        </h1>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((character) => {
            const score = Array.isArray(character.demand_scores)
              ? (character.demand_scores[0]?.score ?? 0)
              : 0;

            return (
              <a
                key={character.id}
                href={`/characters/${character.slug}`}
                className="rounded-card border border-border-subtle bg-bg-elevated p-md transition-colors duration-hover hover:border-accent-gold/30"
              >
                <h2 className="font-display text-card-title text-text-primary">
                  {character.name}
                </h2>
                {character.hook_line && (
                  <p className="mt-xs font-body text-caption italic text-accent-steel">
                    {character.hook_line}
                  </p>
                )}
                <p className="mt-sm font-mono text-metric text-accent-gold">
                  {score} demand
                </p>
                {character.classification_status === "pending" && (
                  <p className="mt-xs font-body text-caption text-accent-steel">Pending</p>
                )}
              </a>
            );
          })}
        </div>
        {sorted.length === 0 && (
          <p className="mt-lg font-body text-body text-accent-steel">
            No characters yet.
          </p>
        )}
      </div>
    </main>
  );
}
