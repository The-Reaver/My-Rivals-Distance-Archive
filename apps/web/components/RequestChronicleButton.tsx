"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// chronicle_requests writes happen directly against Supabase from the
// browser (not proxied through canon-service) -- it's a `public` schema
// table with its own RLS insert policy (reader_id = auth.uid()) and a
// UNIQUE(character_id, reader_id) constraint doing the real anti-ballot-
// stuffing work (P0-4), matching the same direct-write pattern
// ChronicleEditor.tsx already uses for admin writes.
//
// Deliberately scoped to just the write: the public "N readers requested
// this" ledger and the release-notification loop (game plan Ideas 1-2) are
// separate, larger features gated on their own product decisions (a
// pending-character stat-bar variant, an Activity Feed) and aren't part of
// this increment.
export function RequestChronicleButton({
  characterId,
  isSignedIn,
  alreadyRequested,
}: {
  characterId: string;
  isSignedIn: boolean;
  alreadyRequested: boolean;
}) {
  const [requested, setRequested] = useState(alreadyRequested);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <p className="mt-sm font-body text-body-small text-accent-steel">
        <Link
          href={`/signup?follow=${characterId}`}
          className="text-accent-gold underline underline-offset-2"
        >
          Sign up
        </Link>{" "}
        to request this Chronicle.
      </p>
    );
  }

  if (requested) {
    return (
      <p className="mt-sm font-body text-body-small text-accent-gold">
        Requested. You&rsquo;ll hear about it here when it&rsquo;s written.
      </p>
    );
  }

  async function handleSubmit() {
    setStatus("submitting");
    setErrorMessage(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatus("error");
      setErrorMessage("Your session expired. Refresh and sign in again.");
      return;
    }

    const { error } = await supabase.from("chronicle_requests").insert({
      character_id: characterId,
      reader_id: user.id,
      reason: reason.trim() || null,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("idle");
    setRequested(true);
  }

  return (
    <div className="mt-sm flex flex-col gap-xs">
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why this character? (optional)"
        rows={2}
        className="w-full rounded-card border border-border-subtle bg-bg-elevated p-sm font-body text-body-small text-text-primary"
      />
      <button
        type="button"
        disabled={status === "submitting"}
        onClick={handleSubmit}
        className="self-start rounded-card bg-accent-gold px-md py-xs font-body text-body-small font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
      >
        {status === "submitting" ? "Requesting…" : "Request this Chronicle"}
      </button>
      {status === "error" && errorMessage && (
        <p className="font-body text-caption text-accent-ember">{errorMessage}</p>
      )}
    </div>
  );
}
