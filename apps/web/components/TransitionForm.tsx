"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionEntryAction } from "@/app/admin/(dashboard)/knowledge-core/actions";

// Which next statuses to offer is UI guidance only, not enforcement -- the
// real rule is app.ratification.VALID_TRANSITIONS, enforced server-side on
// every call. Worst case if this map ever drifts from that one is a button
// that surfaces a clear "invalid_transition" error, not a security gap.
const VALID_NEXT_STATUSES: Record<string, string[]> = {
  draft: ["under_review"],
  under_review: ["ratified", "rejected", "draft"],
  ratified: ["locked", "superseded"],
  locked: ["superseded"],
  rejected: ["draft"],
  superseded: [],
};

export function TransitionForm({ entryId, currentStatus }: { entryId: string; currentStatus: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const validNextStatuses = VALID_NEXT_STATUSES[currentStatus] ?? [];
  const [selected, setSelected] = useState(validNextStatuses[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  if (validNextStatuses.length === 0) {
    return (
      <p className="font-body text-body-small text-accent-steel">
        No further transitions from {currentStatus}.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-sm">
      <select
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
      >
        {validNextStatuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await transitionEntryAction(entryId, selected);
            if (!result.ok) {
              setError(result.error);
            } else {
              router.refresh();
            }
          });
        }}
        className="rounded-card bg-accent-gold px-md py-xs font-body text-body-small font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
      >
        {isPending ? "Working…" : "Transition"}
      </button>
      {error && <span className="font-body text-body-small text-accent-ember">{error}</span>}
    </div>
  );
}
