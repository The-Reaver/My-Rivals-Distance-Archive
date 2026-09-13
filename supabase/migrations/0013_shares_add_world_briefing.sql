-- /world/[id] (this batch) gives world_briefings a reader-facing detail
-- page for the first time -- sharing one is exactly as natural as sharing
-- a character, chronicle entry, or archive document, so it belongs in
-- shares' entity_type CHECK (0012) alongside them. Migrations are
-- immutable once applied, hence a new ALTER rather than editing 0012 in
-- place.

alter table public.shares
  drop constraint shares_entity_type_check;

alter table public.shares
  add constraint shares_entity_type_check
  check (entity_type in ('character', 'chronicle_entry', 'archive_document', 'world_briefing'));
