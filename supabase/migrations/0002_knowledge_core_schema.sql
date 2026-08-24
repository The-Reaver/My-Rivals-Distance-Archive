-- Knowledge Core: the ratify-then-write canon store for writer-reference
-- source material. Genuinely invisible to anon/authenticated -- not just
-- RLS-denied, no grants at all -- and reachable only by canon-service
-- (service_role) and the trusted admin path.

create schema if not exists knowledge_core;

create table knowledge_core.kc_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in (
    'character_codex', 'chronicle_entry', 'twenty_two_victories', 'threat_blueprint',
    'world_codex_expansion', 'arsenal_dossier', 'tactical_architecture',
    'institution_codex', 'political_atlas', 'pitch_bible', 'psychological_profile'
  )),
  source_raw_text text not null,
  intake_status text not null default 'pending'
    check (intake_status in ('pending', 'parsing', 'parsed', 'failed')),
  batch_id text,
  submitted_by uuid,
  created_at timestamptz not null default now()
);

-- The atomic unit. One kc_documents row decomposes into many kc_entries --
-- e.g. a Character Codex yields a physical-description entry, several
-- canon-mandate entries, relationship entries, etc. -- each independently
-- ratifiable and independently citable.
create table knowledge_core.kc_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  parent_document_id uuid references knowledge_core.kc_documents(id) on delete set null,
  title text not null,
  body jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'under_review', 'ratified', 'locked', 'rejected', 'superseded')),
  version int not null default 1,
  superseded_by uuid references knowledge_core.kc_entries(id),
  character_ids uuid[] not null default '{}',
  book_placement text not null default 'pre_book',
  fan_contribution boolean not null default false,
  ratified_by uuid,
  ratified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column knowledge_core.kc_entries.status is
  'draft -> under_review -> ratified -> locked, with rejected and superseded branches. '
  'AI-Parse output always lands as draft -- it has zero authority to ratify. '
  'Ratification is exclusively a human action gated by the cross-reference validator in canon-service.';

-- The cross-reference graph. This is what makes canon-consistency checking
-- possible: an entry can't ratify while it depends_on an entry that isn't
-- itself ratified.
create table knowledge_core.kc_references (
  id uuid primary key default gen_random_uuid(),
  from_entry_id uuid not null references knowledge_core.kc_entries(id) on delete cascade,
  to_entry_id uuid not null references knowledge_core.kc_entries(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('mentions', 'depends_on', 'contradicts', 'supersedes')),
  created_at timestamptz not null default now(),
  unique (from_entry_id, to_entry_id, relationship_type),
  check (from_entry_id <> to_entry_id)
);

-- The bridge from a ratified kc_entries row to an operational reader-facing
-- row. Extraction can only ever point at an already-ratified source.
create table knowledge_core.kc_extractions (
  id uuid primary key default gen_random_uuid(),
  source_entry_id uuid not null references knowledge_core.kc_entries(id),
  target_type text not null
    check (target_type in ('chronicle_entry', 'world_briefing', 'archive_document')),
  extracted_content jsonb not null,
  clearance_level smallint not null default 1 check (clearance_level between 0 and 3),
  book_placement text not null default 'pre_book',
  status text not null default 'pending' check (status in ('pending', 'committed', 'stale')),
  operational_table text,
  operational_row_id uuid,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

comment on table knowledge_core.kc_extractions is
  'One committed row = one transaction in canon-service that writes the operational table AND stamps operational_row_id here, so every published row traces back to a ratified Knowledge Core source. If book_placement targets an unpublished book, the operational row is written storage_mode=vault; the unlock-cascade job flips it to live when that book is marked published.';

-- Post-series fan contributions. Reuses the identical ratification shape --
-- same validator, same commit path -- with the submitter's identity kept
-- instead of an AI-Parse document as the source of the draft.
create table knowledge_core.kc_fan_contributions (
  id uuid primary key default gen_random_uuid(),
  submitter_reader_id uuid, -- soft reference to public.reader_profiles(id); no cross-schema FK
  entry_type text not null,
  proposed_body jsonb not null,
  compliance_check_results jsonb,
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'ratified', 'rejected')),
  ratified_entry_id uuid references knowledge_core.kc_entries(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Isolation: RLS enabled with zero policies (defense in depth) PLUS an
-- explicit REVOKE of all table and schema privileges from anon/authenticated,
-- so this schema is invisible to those roles, not merely RLS-denied.
-- ---------------------------------------------------------------------------

alter table knowledge_core.kc_documents enable row level security;
alter table knowledge_core.kc_entries enable row level security;
alter table knowledge_core.kc_references enable row level security;
alter table knowledge_core.kc_extractions enable row level security;
alter table knowledge_core.kc_fan_contributions enable row level security;

revoke all on schema knowledge_core from anon, authenticated;
revoke all on all tables in schema knowledge_core from anon, authenticated;

-- Cover any table added to this schema later by a future migration.
alter default privileges in schema knowledge_core
  revoke all on tables from anon, authenticated;

grant usage on schema knowledge_core to service_role;
grant all on all tables in schema knowledge_core to service_role;
alter default privileges in schema knowledge_core
  grant all on tables to service_role;
