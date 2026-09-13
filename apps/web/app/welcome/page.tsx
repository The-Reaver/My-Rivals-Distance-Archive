import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const { data: profile } = await supabase
    .from("reader_profiles")
    .select("referral_code, followed_character_id, characters(slug, name)")
    .eq("id", user.id)
    .maybeSingle();

  const followedCharacter = profile
    ? Array.isArray(profile.characters)
      ? profile.characters[0]
      : profile.characters
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-md text-center">
      <h1 className="font-display text-section-heading text-text-primary">You&rsquo;re in.</h1>

      {followedCharacter ? (
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
      ) : (
        <p className="mt-md font-body text-body text-text-primary">
          <Link href="/characters" className="text-accent-gold underline underline-offset-2">
            Browse the Character Index
          </Link>{" "}
          to find someone to follow.
        </p>
      )}

      {profile?.referral_code && (
        <div className="mt-xl">
          <p className="font-body text-caption text-accent-steel">
            Your referral code
          </p>
          <p className="mt-xs font-mono text-metric text-accent-gold">{profile.referral_code}</p>
        </div>
      )}

      <Link
        href="/archive"
        className="mt-xl font-body text-body-small text-accent-steel underline underline-offset-2"
      >
        Explore the Archive
      </Link>
    </main>
  );
}
