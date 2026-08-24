-- Operational schema: reader-facing data. Clearance and spoiler enforcement
-- live here as RLS policies, not in application code, so a missed check in
-- Next.js can't leak gated rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core content tables
-- ---------------------------------------------------------------------------

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  aliases text[] not null default '{}',
  dossier_cover text,
  hook_line text,
  classification_status text not null default 'pending'
    check (classification_status in ('pending', 'active')),
  cover_image_url text,
  created_at timestamptz not null default now()
);

comment on column public.characters.classification_status is
  'pending = dossier/hook visible, no chronicle entries exist yet; active = has published chronicles.';

-- Visibility of dossier_cover/hook_line at Level 0 vs Level 1 was a flagged
-- source-document contradiction (P0-2 item 6). Resolved in favor of Level 0
-- visibility: characters are always publicly selectable, matching the SEO
-- discovery layer requirement. Revisit if that resolution changes.
create table public.chronicle_entries (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete restrict,
  entry_number int not null,
  arc_label text,
  title text not null,
  body_markdown text not null default '',
  required_clearance smallint not null default 1 check (required_clearance between 0 and 3),
  storage_mode text not null default 'vault'
    check (storage_mode in ('vault', 'live', 'writer_reference')),
  book_placement text not null default 'pre_book',
  onyx_commentary text,
  word_count int,
  publish_date date,
  is_live boolean not null default false,
  kc_extraction_id uuid, -- traceability back to knowledge_core.kc_extractions, not FK'd (cross-schema)
  created_at timestamptz not null default now(),
  unique (character_id, entry_number)
);

create table public.world_briefings (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('physics', 'politics', 'factions', 'events', 'geography', 'arsenal', 'technology', 'locations', 'other')),
  title text not null,
  body_markdown text not null default '',
  required_clearance smallint not null default 1 check (required_clearance between 0 and 3),
  storage_mode text not null default 'vault'
    check (storage_mode in ('vault', 'live', 'writer_reference')),
  book_placement text not null default 'pre_book',
  related_character_ids uuid[] not null default '{}',
  kc_extraction_id uuid,
  created_at timestamptz not null default now()
);

-- Catch-all for the remaining extracted document types that aren't a
-- Chronicle Entry or World Briefing (per System Explanation's archive_documents table).
create table public.archive_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  title text not null,
  subtitle text,
  character_id uuid references public.characters(id),
  book_placement text not null default 'pre_book',
  storage_mode text not null default 'vault'
    check (storage_mode in ('vault', 'live', 'writer_reference')),
  required_clearance smallint not null default 1 check (required_clearance between 0 and 3),
  body_markdown text not null default '',
  structured_data jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  kc_extraction_id uuid,
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references public.characters(id),
  question text not null,
  options text[] not null,
  correct_index smallint not null,
  explanation text
);

create table public.admin_settings (
  key text primary key,
  value jsonb not null
);

insert into public.admin_settings (key, value) values ('published_books', '[]'::jsonb);

-- ---------------------------------------------------------------------------
-- Reader identity + engagement
-- ---------------------------------------------------------------------------

create table public.reader_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  email_confirmed_at timestamptz,
  clearance_level smallint not null default 1 check (clearance_level between 0 and 3),
  followed_character_id uuid references public.characters(id),
  referral_code text unique not null default encode(gen_random_bytes(6), 'hex'),
  referred_by uuid references public.reader_profiles(id),
  signup_ip_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.reader_profiles is
  'One row per confirmed signup. clearance_level starts at 1 (email signup already happened by the time this row exists). email_confirmed_at is synced from auth.users via trigger so RLS/views never need to touch the auth schema directly.';

create table public.chronicle_requests (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (character_id, reader_id)
);

create table public.reads (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  chronicle_entry_id uuid not null references public.chronicle_entries(id) on delete cascade,
  completion_pct smallint not null default 0 check (completion_pct between 0 and 100),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (reader_id, chronicle_entry_id)
);

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.reader_profiles(id) on delete cascade,
  referred_id uuid not null references public.reader_profiles(id) on delete cascade unique,
  credited boolean not null default false,
  signup_ip_hash_match boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  is_first_attempt boolean not null default true,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

-- Computed server-side by canon-service; the only demand data exposed to
-- anon. No row-level reader identity ever appears here (P1-1).
create table public.demand_scores (
  character_id uuid primary key references public.characters(id) on delete cascade,
  score numeric not null default 0,
  trend_7d numeric,
  trend_30d numeric,
  computed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Signup trigger: creates the profile row, resolves a referral code from
-- signup metadata into a (uncredited) referral row. Referral crediting
-- itself happens later, out-of-band, once fraud heuristics clear it (P0-4) --
-- this trigger never sets credited = true.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_referral_code text;
begin
  insert into public.reader_profiles (id, email, email_confirmed_at)
  values (new.id, new.email, new.email_confirmed_at);

  v_referral_code := new.raw_user_meta_data ->> 'referred_by_code';
  if v_referral_code is not null then
    select id into v_referrer_id
    from public.reader_profiles
    where referral_code = v_referral_code;

    if v_referrer_id is not null and v_referrer_id <> new.id then
      update public.reader_profiles set referred_by = v_referrer_id where id = new.id;
      insert into public.referrals (referrer_id, referred_id)
      values (v_referrer_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reader_profiles
  set email_confirmed_at = new.email_confirmed_at
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.sync_email_confirmation();

-- ---------------------------------------------------------------------------
-- Clearance helper: 0 for anonymous visitors, else the reader's stored level.
-- Every gated-content policy below reads through this so there is exactly
-- one place clearance logic lives.
-- ---------------------------------------------------------------------------

create function public.current_clearance()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select clearance_level from public.reader_profiles where id = auth.uid()),
    0
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.reader_profiles where id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.characters enable row level security;
alter table public.chronicle_entries enable row level security;
alter table public.world_briefings enable row level security;
alter table public.archive_documents enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.admin_settings enable row level security;
alter table public.reader_profiles enable row level security;
alter table public.chronicle_requests enable row level security;
alter table public.reads enable row level security;
alter table public.shares enable row level security;
alter table public.referrals enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.demand_scores enable row level security;

-- characters: public, always readable (Level 0 discovery layer). Writes admin-only.
create policy "characters_select_all" on public.characters
  for select using (true);
create policy "characters_admin_write" on public.characters
  for all using (public.is_admin()) with check (public.is_admin());

-- chronicle_entries / world_briefings / archive_documents: live + clearance-gated,
-- or writer-reference/vault visible to admins only. Book-placement spoiler
-- enforcement is a separate, stricter concern owned by canon-service's
-- extraction commit (it decides storage_mode at write time); this policy is
-- the read-time backstop.
create policy "chronicle_entries_select" on public.chronicle_entries
  for select using (
    (storage_mode = 'live' and required_clearance <= public.current_clearance())
    or public.is_admin()
  );
create policy "chronicle_entries_admin_write" on public.chronicle_entries
  for all using (public.is_admin()) with check (public.is_admin());

create policy "world_briefings_select" on public.world_briefings
  for select using (
    (storage_mode = 'live' and required_clearance <= public.current_clearance())
    or public.is_admin()
  );
create policy "world_briefings_admin_write" on public.world_briefings
  for all using (public.is_admin()) with check (public.is_admin());

create policy "archive_documents_select" on public.archive_documents
  for select using (
    (storage_mode = 'live' and required_clearance <= public.current_clearance())
    or public.is_admin()
  );
create policy "archive_documents_admin_write" on public.archive_documents
  for all using (public.is_admin()) with check (public.is_admin());

-- quiz_questions: authenticated readers only (Idea 6: diagnostic, not a gate).
create policy "quiz_questions_select" on public.quiz_questions
  for select using (auth.role() = 'authenticated');
create policy "quiz_questions_admin_write" on public.quiz_questions
  for all using (public.is_admin()) with check (public.is_admin());

-- admin_settings: no policies for anon/authenticated at all -> default deny.
create policy "admin_settings_admin_all" on public.admin_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- reader_profiles: a reader sees/edits only their own row. No client-side
-- insert policy -- rows are created exclusively by the handle_new_user trigger.
create policy "reader_profiles_select_own" on public.reader_profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "reader_profiles_update_own" on public.reader_profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- chronicle_requests: insert/select own rows only. The UNIQUE(character_id, reader_id)
-- constraint above is the real anti-ballot-stuffing control (P0-4); this
-- policy just scopes visibility, it doesn't do the fraud work.
create policy "chronicle_requests_select_own" on public.chronicle_requests
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "chronicle_requests_insert_own" on public.chronicle_requests
  for insert with check (reader_id = auth.uid());
create policy "chronicle_requests_delete_own" on public.chronicle_requests
  for delete using (reader_id = auth.uid());

create policy "reads_select_own" on public.reads
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "reads_upsert_own" on public.reads
  for insert with check (reader_id = auth.uid());
create policy "reads_update_own" on public.reads
  for update using (reader_id = auth.uid()) with check (reader_id = auth.uid());

create policy "shares_select_own" on public.shares
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "shares_insert_own" on public.shares
  for insert with check (reader_id = auth.uid());

-- referrals: visible only to the two parties in the pair, or an admin --
-- never the full graph to a regular reader (P0-3 requirement).
create policy "referrals_select_party" on public.referrals
  for select using (referrer_id = auth.uid() or referred_id = auth.uid() or public.is_admin());

create policy "quiz_attempts_select_own" on public.quiz_attempts
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "quiz_attempts_insert_own" on public.quiz_attempts
  for insert with check (reader_id = auth.uid());

-- demand_scores: public aggregate only -- no reader identity ever lives here,
-- so unrestricted select is safe and is the point (P1-1).
create policy "demand_scores_select_all" on public.demand_scores
  for select using (true);
