"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CharacterOption = { id: string; slug: string; name: string };

// Passwordless (magic-link) reader signup, same auth.signInWithOtp
// mechanism as admin/login/page.tsx, but with `shouldCreateUser: true`
// (the admin flow deliberately leaves that unset -- only pre-existing
// admins should ever land there) and reader-specific metadata:
// `followed_character_id` and `referred_by_code` both ride in
// raw_user_meta_data and are consumed by handle_new_user()
// (0007_signup_follow_character.sql) when the trigger creates the
// reader_profiles row -- this form never writes reader_profiles directly.
//
// `follow` and `ref` query params let RequestChronicleButton and a future
// referral-link share flow pre-fill this form; both remain editable/optional
// since a reader can always change their mind before submitting.
export function SignupForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [followedCharacterId, setFollowedCharacterId] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const referredByCode = searchParams.get("ref");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("characters")
      .select("id, slug, name")
      .order("name")
      .then(({ data }) => {
        setCharacters(data ?? []);
        const followParam = searchParams.get("follow");
        if (followParam && (data ?? []).some((c) => c.id === followParam)) {
          setFollowedCharacterId(followParam);
        }
      });
    // Only ever needs to run once per mount -- searchParams doesn't change
    // for this page after the initial navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/welcome`,
        data: {
          ...(followedCharacterId ? { followed_character_id: followedCharacterId } : {}),
          ...(referredByCode ? { referred_by_code: referredByCode } : {}),
        },
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p className="mt-lg font-body text-body text-accent-gold">
        Check {email} for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-lg flex w-full max-w-sm flex-col gap-sm">
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="rounded-card border border-border-subtle bg-bg-elevated px-md py-sm font-body text-body text-text-primary outline-none focus-visible:border-accent-gold"
      />

      <label className="font-body text-caption text-accent-steel">
        Follow a character (optional)
        <select
          value={followedCharacterId}
          onChange={(event) => setFollowedCharacterId(event.target.value)}
          className="mt-xs w-full rounded-card border border-border-subtle bg-bg-elevated px-md py-sm font-body text-body text-text-primary outline-none focus-visible:border-accent-gold"
        >
          <option value="">No preference</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-card bg-accent-gold px-lg py-sm font-body text-body font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      {status === "error" && errorMessage && (
        <p className="font-body text-body-small text-accent-ember">{errorMessage}</p>
      )}
    </form>
  );
}
