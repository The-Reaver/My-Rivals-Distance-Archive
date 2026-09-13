import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AlsoDrawnToToggle } from "@/components/AlsoDrawnToToggle";
import { FollowInsteadButton } from "@/components/FollowInsteadButton";
import { CompareCheckbox } from "@/components/CompareCheckbox";
import { CompareBar } from "@/components/CompareBar";
import { computeFollowEligibility } from "@/lib/followEligibility";

// Visual Direction 6. Character Index -- grid of character cards, sorted by
// reader demand score by default. This is the verification vertical slice:
// proves Next.js -> Supabase (anon key) -> RLS -> rendered page works.
export default async function CharacterIndexPage() {
  const supabase = await createClient();

  const [{ data: characters, error }, { data: userData }] = await Promise.all([
    supabase
      .from("characters")
      .select("id, slug, name, hook_line, classification_status, demand_scores(score)")
      .order("name"),
    supabase.auth.getUser(),
  ]);

  const user = userData.user;
  let followedCharacterId: string | null = null;
  let drawnToIds = new Set<string>();
  let canFollowInstead = false;
  if (user) {
    const [{ data: profile }, { data: drawnRows }, { data: lastChange }] = await Promise.all([
      supabase
        .from("reader_profiles")
        .select("followed_character_id, created_at")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("also_drawn_to").select("character_id").eq("reader_id", user.id),
      // Follow Reconsideration (Idea 7): eligibility mirrors
      // change_followed_character()'s own 30-day cooldown (0010) so the
      // "Follow this character instead" control only appears when the RPC
      // would actually succeed -- computeFollowEligibility is a UI
      // convenience, not the real enforcement (the database is).
      supabase
        .from("follow_changes")
        .select("changed_at")
        .eq("reader_id", user.id)
        .order("changed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    followedCharacterId = profile?.followed_character_id ?? null;
    drawnToIds = new Set((drawnRows ?? []).map((row) => row.character_id));
    if (profile) {
      canFollowInstead = computeFollowEligibility({
        followedCharacterId,
        createdAt: profile.created_at,
        lastChangedAt: lastChange?.changed_at ?? null,
      }).eligible;
    }
  }

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
        <Suspense>
          <CompareBar />
        </Suspense>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((character) => {
            const score = Array.isArray(character.demand_scores)
              ? (character.demand_scores[0]?.score ?? 0)
              : 0;

            return (
              <div
                key={character.id}
                className="rounded-card border border-border-subtle bg-bg-elevated p-md transition-colors duration-hover hover:border-accent-gold/30"
              >
                {/* A <button> can't nest inside this <a> (invalid HTML: no
                    interactive content inside interactive content), so the
                    AlsoDrawnToToggle below sits as a sibling instead. */}
                <a href={`/characters/${character.slug}`} className="block">
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
                {user && character.id !== followedCharacterId && (
                  <AlsoDrawnToToggle
                    characterId={character.id}
                    initiallyDrawn={drawnToIds.has(character.id)}
                  />
                )}
                {user && canFollowInstead && character.id !== followedCharacterId && (
                  <FollowInsteadButton characterId={character.id} />
                )}
                <Suspense>
                  <CompareCheckbox characterId={character.id} />
                </Suspense>
              </div>
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
