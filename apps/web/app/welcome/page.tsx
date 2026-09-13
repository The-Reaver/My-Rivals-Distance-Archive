import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeFollowEligibility } from "@/lib/followEligibility";

// Lands here straight off the signup magic-link (auth/callback's `next`
// param). Not a gate -- redirect-if-signed-out is a UX convenience so a
// stale/expired link fails helpfully, the same posture
// admin/(dashboard)/layout.tsx takes for its own gate.
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signup");
  }

  const [{ data: profile }, { data: alsoDrawnTo }, { data: lastChange }] = await Promise.all([
    supabase
      .from("reader_profiles")
      .select("referral_code, followed_character_id, created_at, characters(slug, name)")
      .eq("id", user.id)
      .maybeSingle(),
    // Also Drawn To (Idea 4): optional secondary follows, added from the
    // Character Index. "Plain text-link additions, vertical feed" per the
    // game plan -- this is the one place that feed is shown, since no
    // broader reader-profile page exists yet.
    supabase
      .from("also_drawn_to")
      .select("character_id, created_at, characters(slug, name)")
      .eq("reader_id", user.id)
      .order("created_at", { ascending: false }),
    // Follow Reconsideration (Idea 7): see /characters for the same
    // eligibility computation, used there to gate FollowInsteadButton.
    supabase
      .from("follow_changes")
      .select("changed_at")
      .eq("reader_id", user.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const followedCharacter = profile
    ? Array.isArray(profile.characters)
      ? profile.characters[0]
      : profile.characters
    : null;

  const followEligibility = profile
    ? computeFollowEligibility({
        followedCharacterId: profile.followed_character_id,
        createdAt: profile.created_at,
        lastChangedAt: lastChange?.changed_at ?? null,
      })
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-md text-center">
      <h1 className="font-display text-section-heading text-text-primary">You&rsquo;re in.</h1>

      {followedCharacter ? (
        <>
          <p className="mt-md font-body text-body text-text-primary">
            You&rsquo;re following{" "}
            <Link
              href={`/characters/${followedCharacter.slug}`}
              className="text-accent-gold underline underline-offset-2"
            >
              {followedCharacter.name}
            </Link>
            . New Chronicles show up there first.
          </p>
          {followEligibility?.eligible ? (
            <p className="mt-xs font-body text-caption text-accent-steel">
              <Link href="/characters" className="text-accent-gold underline underline-offset-2">
                Follow a different character instead
              </Link>
            </p>
          ) : (
            followEligibility?.nextEligibleAt && (
              <p className="mt-xs font-body text-caption text-accent-steel">
                You can follow someone else starting{" "}
                {followEligibility.nextEligibleAt.toLocaleDateString()}.
              </p>
            )
          )}
        </>
      ) : (
        <p className="mt-md font-body text-body text-text-primary">
          <Link href="/characters" className="text-accent-gold underline underline-offset-2">
            Browse the Character Index
          </Link>{" "}
          to find someone to follow.
        </p>
      )}

      {alsoDrawnTo && alsoDrawnTo.length > 0 && (
        <div className="mt-xl">
          <p className="font-body text-caption text-accent-steel">Also drawn to</p>
          <ul className="mt-xs space-y-xs">
            {alsoDrawnTo.map((entry) => {
              const character = Array.isArray(entry.characters)
                ? entry.characters[0]
                : entry.characters;
              if (!character) return null;
              return (
                <li key={entry.character_id}>
                  <Link
                    href={`/characters/${character.slug}`}
                    className="font-body text-body-small text-accent-gold underline underline-offset-2"
                  >
                    {character.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {profile?.referral_code && (
        <div className="mt-xl">
          <p className="font-body text-caption text-accent-steel">
            Your referral code
          </p>
          <p className="mt-xs font-mono text-metric text-accent-gold">{profile.referral_code}</p>
        </div>
      )}

      <div className="mt-xl flex gap-md">
        <Link
          href="/archive"
          className="font-body text-body-small text-accent-steel underline underline-offset-2"
        >
          Explore the Archive
        </Link>
        <Link
          href="/world"
          className="font-body text-body-small text-accent-steel underline underline-offset-2"
        >
          Explore the World
        </Link>
        <Link
          href="/notifications"
          className="font-body text-body-small text-accent-steel underline underline-offset-2"
        >
          Your notifications
        </Link>
        <Link
          href="/field-notes"
          className="font-body text-body-small text-accent-steel underline underline-offset-2"
        >
          Your field notes
        </Link>
      </div>
    </main>
  );
}
