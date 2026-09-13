-- Connective Tissue Trails (game plan Idea 8). "Passively log which
-- cross-links (character-to-faction, faction-to-institution,
-- character-to-character) readers actually click through in the Level 2
-- world briefings. Invisible to the reader." The game plan's own text
-- assumes a pre-existing engagement_events table with a metadata column
-- to add -- no such table exists in this implementation (confirmed
-- earlier: this build resolved the source documents' engagement-tracking
-- concept into reads/shares/quiz_attempts/demand_scores instead), so this
-- is a dedicated new table rather than a metadata-column addition to
-- something that doesn't exist.
--
-- target_path stores the raw href (e.g. "/characters/kwame-ade") rather
-- than resolving it to a target entity id: the click happens inside
-- arbitrary admin-authored markdown, so the only thing knowable
-- synchronously at click time, without an extra lookup that would delay
-- or complicate the "invisible" click, is the link's own path. A path
-- joined back to content later by category prefix (/characters/,
-- /world/, /archive/) serves the same "which relationships are readers
-- curious about" signal.
--
-- "Invisible to the reader" is read literally: unlike field_notes/
-- also_drawn_to (a reader's own visible collection), this is pure backend
-- signal -- admin-only select, no reader-facing view of their own trail.
-- Scoped to world_briefings only, per the game plan's own "in the Level 2
-- world briefings" -- source_id has a real FK for that reason, not a loose
-- uuid.

create table public.connective_tissue_trails (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  source_type text not null check (source_type in ('world_briefing')),
  source_id uuid not null references public.world_briefings(id) on delete cascade,
  target_path text not null,
  clicked_at timestamptz not null default now()
);

comment on table public.connective_tissue_trails is
  'Passive log of cross-link clicks from world briefings (Idea 8) -- admin-only, never reader-visible, matching the game plan''s "invisible to the reader."';

alter table public.connective_tissue_trails enable row level security;

create policy "connective_tissue_trails_select_admin" on public.connective_tissue_trails
  for select using (public.is_admin());
create policy "connective_tissue_trails_insert_own" on public.connective_tissue_trails
  for insert with check (reader_id = auth.uid());
