-- Also Drawn To (game plan Idea 4). "Signup forces one followed character
-- ... but one that discards everyone's second interest across an
-- 18-character roster. Add an optional, non-required list a reader can
-- build from the Character Index at any time."
--
-- Unlike chronicle_requests' Standing Requests Ledger (0008), this is NOT
-- a public signal -- the game plan frames it purely as internal affinity
-- data ("reveals cross-character affinity clusters... which pending
-- character's audience overlaps an already-engaged base"), so it stays
-- reader-own/admin-only, same posture as reads and quiz_attempts.

create table public.also_drawn_to (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (reader_id, character_id)
);

comment on table public.also_drawn_to is
  'Optional secondary follows beyond reader_profiles.followed_character_id (Idea 4). A reader can add/remove any character here at any time -- not gated to their required primary pick, and deliberately not restricted from including it either (harmless if they do; nothing currently reads followed_character_id back out of this table).';

alter table public.also_drawn_to enable row level security;

create policy "also_drawn_to_select_own" on public.also_drawn_to
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "also_drawn_to_insert_own" on public.also_drawn_to
  for insert with check (reader_id = auth.uid());
create policy "also_drawn_to_delete_own" on public.also_drawn_to
  for delete using (reader_id = auth.uid());
-- No update policy: this is a pure add/remove set, nothing on a row ever
-- needs to change in place.
