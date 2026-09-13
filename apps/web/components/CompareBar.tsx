"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Appears once exactly two characters are selected via CompareCheckbox;
// renders nothing otherwise. Reads the same ?compare= param those
// checkboxes write.
export function CompareBar() {
  const searchParams = useSearchParams();
  const compareIds = (searchParams.get("compare") ?? "").split(",").filter(Boolean);

  if (compareIds.length !== 2) return null;

  return (
    <div className="sticky top-0 z-10 mt-md rounded-card border border-accent-gold/30 bg-bg-elevated p-md">
      <Link
        href={`/characters/compare?a=${compareIds[0]}&b=${compareIds[1]}`}
        className="font-body text-body-small text-accent-gold underline underline-offset-2"
      >
        Compare these two characters →
      </Link>
    </div>
  );
}
