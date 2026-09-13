"use client";

import { useState, useTransition, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

// Field Notes (Idea 3): "a plain text affordance on hover at the standard
// 150ms, no icon" -- a <button> is valid phrasing content inside a <p>
// (unlike the <a>-nesting issue AlsoDrawnToToggle had to avoid), so this
// renders inline, trailing the paragraph's own text, shown via
// group-hover opacity rather than a separate positioned element.
//
// Signed-out visitors get a plain, unmarked paragraph -- no affordance at
// all, matching every other reader-write feature's posture in this app.
export function FieldNoteParagraph({
  children,
  chronicleEntryId,
  paragraphIndex,
  paragraphHash,
  paragraphText,
  initiallyMarked,
  isSignedIn,
}: {
  children: ReactNode;
  chronicleEntryId: string;
  paragraphIndex: number;
  paragraphHash: string;
  paragraphText: string;
  initiallyMarked: boolean;
  isSignedIn: boolean;
}) {
  const [marked, setMarked] = useState(initiallyMarked);
  const [isPending, startTransition] = useTransition();

  if (!isSignedIn) {
    return <p className="mt-md leading-relaxed">{children}</p>;
  }

  function handleToggle() {
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      if (marked) {
        const { error } = await supabase
          .from("field_notes")
          .delete()
          .eq("reader_id", user.id)
          .eq("chronicle_entry_id", chronicleEntryId)
          .eq("paragraph_hash", paragraphHash);
        if (!error) setMarked(false);
      } else {
        const { error } = await supabase.from("field_notes").insert({
          reader_id: user.id,
          chronicle_entry_id: chronicleEntryId,
          paragraph_hash: paragraphHash,
          paragraph_index: paragraphIndex,
          paragraph_text: paragraphText,
        });
        if (!error) setMarked(true);
      }
    });
  }

  return (
    <p className="group relative mt-md leading-relaxed">
      {children}{" "}
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`font-body text-caption underline underline-offset-2 transition-opacity duration-hover disabled:opacity-50 ${
          marked ? "text-accent-gold opacity-100" : "text-accent-steel opacity-0 group-hover:opacity-100"
        }`}
      >
        {marked ? "Marked ✓" : "Mark as significant"}
      </button>
    </p>
  );
}
