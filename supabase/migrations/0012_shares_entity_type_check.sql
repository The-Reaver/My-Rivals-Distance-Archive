-- shares (0001) was created without a CHECK constraint on entity_type,
-- unlike every other controlled-vocabulary column in this schema
-- (classification_status, storage_mode, book_placement, category). It has
-- had no writer until this pass (Shares tracking, wiring the ShareButton
-- component), so this can be added directly -- the table is empty, no
-- backfill/validation concern. Values match what ShareButton.tsx actually
-- writes: a character's own dossier, a chronicle entry, or an archive
-- document, the three reader-facing content types with their own detail
-- pages today.

alter table public.shares
  add constraint shares_entity_type_check
  check (entity_type in ('character', 'chronicle_entry', 'archive_document'));
