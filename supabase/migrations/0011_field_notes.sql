-- Field Notes (game plan Idea 3). "Inside the Chronicle Reader, a reader
-- marks a paragraph as significant, framed as adding it to their own
-- dossier, not as a like... Marked passages collect in the reader's
-- private profile."
--
-- Build note the game plan itself flags: "markdown bodies have no stable
-- paragraph identity; anchoring needs a deterministic scheme (content hash
-- or index plus fallback) or every body edit orphans every note against
-- it." paragraph_hash is that deterministic anchor (a hash of the
-- paragraph's own normalized text, computed client-side in
-- lib/fieldNotes.ts and re-derived identically every render -- see that
-- file for why this doesn't need to be a cryptographic hash).
-- paragraph_index is positional metadata only, not part of the identity
-- key -- a body edit that reorders paragraphs without changing their text
-- would otherwise orphan every note if index were the anchor.
-- paragraph_text is a snapshot of what the reader actually marked, so a
-- later body edit that changes or removes that paragraph doesn't erase
-- what they saved.

create table public.field_notes (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  chronicle_entry_id uuid not null references public.chronicle_entries(id) on delete cascade,
  paragraph_hash text not null,
  paragraph_index int not null,
  paragraph_text text not null,
  created_at timestamptz not null default now(),
  unique (reader_id, chronicle_entry_id, paragraph_hash)
);

comment on table public.field_notes is
  'A reader''s own marked-as-significant paragraphs (Idea 3) -- "the reader''s private profile," never public, same posture as also_drawn_to. paragraph_hash is the deterministic anchor (see lib/fieldNotes.ts); paragraph_text is a point-in-time snapshot so a later body_markdown edit can''t erase what a reader saved.';

alter table public.field_notes enable row level security;

create policy "field_notes_select_own" on public.field_notes
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "field_notes_insert_own" on public.field_notes
  for insert with check (reader_id = auth.uid());
create policy "field_notes_delete_own" on public.field_notes
  for delete using (reader_id = auth.uid());
-- No update policy: marking is a pure add/remove action, matching
-- also_drawn_to's own posture -- nothing on a row ever changes in place.
