"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const COMPLETE_THRESHOLD_PCT = 95;
const SAVE_DEBOUNCE_MS = 1500;

// Invisible reading-progress instrumentation for the chronicle reader.
// Renders nothing -- this is the data-collection half of "start on reading
// progress tracking"; a visible progress UI (a bar, a "continue reading"
// nudge) is a separate, later feature built on top of this data, not part
// of this pass.
//
// Tracks scroll depth against the whole document rather than measuring the
// <article> element specifically: this route renders nothing else of any
// height (back-link, meta line, title, body, commentary -- all inside the
// one article), so document scroll is a fair proxy without plumbing a DOM
// ref across the server/client boundary.
//
// Writes are monotonic and debounced: a scroll only schedules a write when
// it exceeds both the last value saved this session AND whatever was
// already saved from a prior visit (fetched once on mount), so a quick
// re-open that scrolls less than a previous full read never regresses
// completion_pct or flips completed back to false. reads' own unique
// constraint is (reader_id, chronicle_entry_id), hence the explicit
// onConflict target on the upsert.
//
// Signed-out visitors are never tracked -- there's no reader_id to write
// against, and RLS's reads_upsert_own/reads_update_own policies both
// require reader_id = auth.uid() regardless.
export function ReadingProgressTracker({ chronicleEntryId }: { chronicleEntryId: string }) {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let readerId: string | null = null;
    let savedMax = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let ticking = false;

    function currentPct(): number {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return 100;
      return Math.max(0, Math.min(100, Math.round((window.scrollY / scrollable) * 100)));
    }

    async function commit(pct: number) {
      if (!readerId || pct <= savedMax) return;
      savedMax = pct;
      await supabase.from("reads").upsert(
        {
          reader_id: readerId,
          chronicle_entry_id: chronicleEntryId,
          completion_pct: pct,
          completed: pct >= COMPLETE_THRESHOLD_PCT,
        },
        { onConflict: "reader_id,chronicle_entry_id" },
      );
    }

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const pct = currentPct();
        if (pct > savedMax) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => commit(pct), SAVE_DEBOUNCE_MS);
        }
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (debounceTimer) clearTimeout(debounceTimer);
        commit(currentPct());
      }
    }

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      readerId = user.id;

      const { data: existing } = await supabase
        .from("reads")
        .select("completion_pct")
        .eq("reader_id", user.id)
        .eq("chronicle_entry_id", chronicleEntryId)
        .maybeSingle();
      if (existing) {
        savedMax = existing.completion_pct;
      }

      window.addEventListener("scroll", handleScroll, { passive: true });
      document.addEventListener("visibilitychange", handleVisibilityChange);
      // Catches an entry short enough to be fully visible without scrolling.
      handleScroll();
    }

    init();

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (debounceTimer) clearTimeout(debounceTimer);
      commit(currentPct());
    };
  }, [chronicleEntryId]);

  return null;
}
