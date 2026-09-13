"use client";

import type { AnchorHTMLAttributes } from "react";
import { createClient } from "@/lib/supabase/client";
import { isCrossLinkTarget } from "@/lib/crossLinks";

// Connective Tissue Trails (Idea 8): "passively log which cross-links...
// readers actually click through... invisible to the reader." The insert
// is fire-and-forget and never awaited -- it must not delay or interfere
// with the actual navigation the reader is trying to do, and there is
// deliberately no visible confirmation of any kind (no toast, no state
// change on the link itself), unlike every other reader-write feature in
// this app, which all have some visible affordance.
//
// Signed-out visitors are never tracked, same posture as everywhere else
// in this app -- checked inside the fire-and-forget call itself so it
// never blocks the click.
export function CrossLinkAnchor({
  sourceId,
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { sourceId: string }) {
  function handleClick() {
    if (!isCrossLinkTarget(href)) return;
    void logClick(sourceId, href);
  }

  return (
    <a href={href} onClick={handleClick} className="text-accent-gold underline underline-offset-2" {...rest} />
  );
}

async function logClick(sourceId: string, targetPath: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("connective_tissue_trails").insert({
    reader_id: user.id,
    source_type: "world_briefing",
    source_id: sourceId,
    target_path: targetPath,
  });
}
