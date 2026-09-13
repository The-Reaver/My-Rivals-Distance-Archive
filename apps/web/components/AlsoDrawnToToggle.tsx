"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

// Also Drawn To (Idea 4): an optional secondary follow, distinct from the
// one required signup pick (reader_profiles.followed_character_id). Direct
// browser writes against also_drawn_to, same pattern as
// RequestChronicleButton -- RLS (own-row insert/delete) plus the table's
// unique(reader_id, character_id) constraint do the real enforcement work,
// this component has no privilege of its own.
//
// Rendered per-card on the Character Index, as a sibling to the card's own
// <a> link (not nested inside it -- a <button> inside an <a> is invalid
// HTML). The page skips rendering it entirely for signed-out visitors and
// for the reader's own primary followed character (toggling "also drawn
// to" the character you already follow is meaningless).
export function AlsoDrawnToToggle({
  characterId,
  initiallyDrawn,
}: {
  characterId: string;
  initiallyDrawn: boolean;
}) {
  const [drawn, setDrawn] = useState(initiallyDrawn);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      if (drawn) {
        const { error } = await supabase
          .from("also_drawn_to")
          .delete()
          .eq("reader_id", user.id)
          .eq("character_id", characterId);
        if (!error) setDrawn(false);
      } else {
        const { error } = await supabase
          .from("also_drawn_to")
          .insert({ reader_id: user.id, character_id: characterId });
        if (!error) setDrawn(true);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`mt-xs font-body text-caption underline underline-offset-2 disabled:opacity-50 ${
        drawn ? "text-accent-gold" : "text-accent-steel"
      }`}
    >
      {drawn ? "Also drawn to ✓" : "Also drawn to this character"}
    </button>
  );
}
