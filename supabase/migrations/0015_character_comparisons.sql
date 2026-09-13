-- Two Dossiers, Side by Side (game plan Idea 9). "Comparison is a
-- purchase-consideration signal, 'I'm choosing between these two,'
-- distinct from a request." Shares Idea 8's "a pair of character IDs
-- doesn't fit a single entity-ID field" problem the game plan itself
-- flags -- solved the same way, a dedicated table rather than forcing the
-- pair through shares' single entity_id column.
--
-- character_a_id/character_b_id are stored in canonical order
-- (a_id < b_id, enforced by CHECK, the reader's own selection order
-- doesn't matter) so "compared A and B" and "compared B and A" are the
-- same signal, not two -- lets an admin/analyst count each unordered pair
-- once with a plain group by. unique(reader_id, pair) means revisiting the
-- same comparison later doesn't inflate the count -- the signal is "did
-- this reader ever compare these two," not "how many times did they load
-- the page."
--
-- Same "invisible to the reader" posture as connective_tissue_trails:
-- admin-only select. A comparison isn't framed as something a reader
-- would want to see again later, unlike field_notes/also_drawn_to.

create table public.character_comparisons (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  character_a_id uuid not null references public.characters(id) on delete cascade,
  character_b_id uuid not null references public.characters(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (character_a_id < character_b_id),
  unique (reader_id, character_a_id, character_b_id)
);

comment on table public.character_comparisons is
  'A reader viewing two characters'' dossiers side by side (Idea 9) -- "a purchase-consideration signal." Admin-only, never reader-visible. character_a_id/character_b_id always canonically ordered (a < b) so an unordered pair is counted once.';

alter table public.character_comparisons enable row level security;

create policy "character_comparisons_select_admin" on public.character_comparisons
  for select using (public.is_admin());
create policy "character_comparisons_insert_own" on public.character_comparisons
  for insert with check (reader_id = auth.uid());
