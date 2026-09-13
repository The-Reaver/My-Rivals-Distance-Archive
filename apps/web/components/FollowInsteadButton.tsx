"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Follow Reconsideration (Idea 7): "presented plainly as 'Follow a
// different character instead.'" Calls change_followed_character(uuid), a
// SECURITY DEFINER RPC function (0010) that's the only legal path to
// changing followed_character_id -- direct UPDATE against reader_profiles
// is revoked outright, closing the cooldown-bypass a row-level-only RLS
// policy would otherwise leave open.
//
// Only ever rendered when the page has already determined this reader is
// eligible (cooldown passed) and this isn't their current follow -- see
// /characters' own eligibility computation. The error handling below is a
// safety net for the rare race (cooldown boundary crossed between render
// and click, or a second tab), not the primary gate.
export function FollowInsteadButton({ characterId }: { characterId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("change_followed_character", {
        p_new_character_id: characterId,
      });
      if (error) {
        setError(error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="mt-xs font-body text-caption text-accent-steel underline underline-offset-2 disabled:opacity-50"
      >
        Follow this character instead
      </button>
      {error && <p className="mt-xs font-body text-caption text-accent-ember">{error}</p>}
    </div>
  );
}
