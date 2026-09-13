"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Two Dossiers, Side by Side (Idea 9): "select exactly two characters on
// the Index." Selection state lives in the URL (?compare=id1,id2) rather
// than component state or a context provider -- the Character Index stays
// a server component with small client islands per card (matching
// AlsoDrawnToToggle/FollowInsteadButton), and this is the one place a
// selection needs to be visible/coordinated across every card at once,
// which a URL param does for free (shareable, survives a refresh, no
// lifted state needed).
export function CompareCheckbox({ characterId }: { characterId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compareIds = (searchParams.get("compare") ?? "").split(",").filter(Boolean);
  const isSelected = compareIds.includes(characterId);
  const atLimit = !isSelected && compareIds.length >= 2;

  function handleChange() {
    const next = isSelected
      ? compareIds.filter((id) => id !== characterId)
      : [...compareIds, characterId];

    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) {
      params.set("compare", next.join(","));
    } else {
      params.delete("compare");
    }
    router.push(`/characters?${params.toString()}`, { scroll: false });
  }

  return (
    <label className="mt-xs flex items-center gap-xs font-body text-caption text-accent-steel">
      <input type="checkbox" checked={isSelected} disabled={atLimit} onChange={handleChange} />
      Compare
    </label>
  );
}
