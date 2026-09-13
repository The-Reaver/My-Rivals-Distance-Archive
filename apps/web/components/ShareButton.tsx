"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type EntityType = "character" | "chronicle_entry" | "archive_document" | "world_briefing";

// Shares tracking: the shares table (0001) has had RLS and an entity-type
// CHECK constraint (0012, extended in 0013 for world_briefing) since
// before this pass but no writer. Uses the Web Share API where available
// (mobile browsers, mostly), falling back to
// a clipboard copy everywhere else -- both record one shares row, best
// effort, for a signed-in reader only.
//
// navigator.share() must be the first `await` reached from the click
// handler: it requires a live user-activation gesture, which an earlier
// await (e.g. a Supabase auth call) can let expire, silently turning a
// real share into a NotAllowedError. So the actual share/copy action runs
// before the shares insert, not after.
export function ShareButton({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const [status, setStatus] = useState<"idle" | "shared" | "copied" | "error">("idle");

  async function handleClick() {
    const url = window.location.href;
    let succeeded = false;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url });
        setStatus("shared");
        succeeded = true;
      } catch {
        // Cancelled by the reader, or unsupported at runtime despite the
        // feature check -- fall through to the clipboard.
      }
    }

    if (!succeeded) {
      try {
        await navigator.clipboard.writeText(url);
        setStatus("copied");
        succeeded = true;
      } catch {
        setStatus("error");
      }
    }

    if (!succeeded) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("shares").insert({
        reader_id: user.id,
        entity_type: entityType,
        entity_id: entityId,
      });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="font-body text-caption text-accent-steel underline underline-offset-2"
    >
      {status === "shared" ? "Shared" : status === "copied" ? "Link copied" : "Share"}
    </button>
  );
}
