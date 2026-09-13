-- Standing Requests Ledger + Request Fulfillment Loop (game plan Ideas 1-2).
-- Both build on chronicle_requests (0001) and its P0-4 fraud controls
-- (0006), already in place -- no schema readiness gap to close first.

-- ---------------------------------------------------------------------------
-- Standing Requests Ledger: a public, reader-identity-free aggregate over
-- chronicle_requests, same pattern P1-1 describes for the demand score --
-- "a view or SECURITY DEFINER function returning counts... never row-level
-- reader identity." chronicle_requests itself stays locked to
-- reader_id = auth.uid() (chronicle_requests_select_own); these views work
-- because a plain Postgres view checks the underlying table's privileges
-- and RLS policies as the view's OWNER by default (security_invoker
-- defaults to false), not as the querying role -- so a view owned by this
-- migration's role bypasses chronicle_requests' own-row RLS the same way a
-- SECURITY DEFINER function would, without needing one. Verified for real
-- against local Postgres, not just assumed (see this session's notes).
-- ---------------------------------------------------------------------------

create view public.chronicle_request_ledger as
select
  character_id,
  count(*)::int as request_count,
  count(*) filter (where reason is not null and length(trim(reason)) > 0)::int as reason_count
from public.chronicle_requests
group by character_id;

comment on view public.chronicle_request_ledger is
  'Public aggregate only -- no reader_id, no email. Powers "N readers have requested this Chronicle" on a pending character''s page (Idea 1).';

create view public.chronicle_request_reasons as
select character_id, reason, created_at
from public.chronicle_requests
where reason is not null and length(trim(reason)) > 0
order by created_at desc;

comment on view public.chronicle_request_reasons is
  'Public feed of voluntarily-typed request reasons -- reader identity never included. No moderation queue exists yet; a reason is shown exactly as typed. Revisit if that ever becomes a problem.';

grant select on public.chronicle_request_ledger to anon, authenticated;
grant select on public.chronicle_request_reasons to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Request Fulfillment Loop: the in-app half (Idea 2 also specifies email;
-- see CLAUDE.md -- sending real email needs a provider account/API key
-- decision this migration has no business making, so it's deliberately
-- not attempted here, same posture 0006 took on signup rate limiting).
--
-- notifications is a minimal, generically-shaped personal activity feed
-- (kind + optional entity refs) -- this is its first and only writer today,
-- but the shape doesn't need to change to grow other notification kinds
-- later. Rows are reader-owned and never publicly readable.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  kind text not null,
  character_id uuid references public.characters(id) on delete cascade,
  chronicle_entry_id uuid references public.chronicle_entries(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.notifications is
  'Minimal personal activity feed. First (and currently only) writer: the fulfillment trigger below, when a requested character''s first chronicle_entries row goes live (Idea 2). No reader-facing insert path -- rows only ever come from trigger-driven, security definer functions.';

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (reader_id = auth.uid() or public.is_admin());
create policy "notifications_update_own" on public.notifications
  for update using (reader_id = auth.uid()) with check (reader_id = auth.uid());
-- Deliberately no insert policy for anon/authenticated: every row is
-- written by notify_chronicle_request_fulfillment() below, a SECURITY
-- DEFINER function, so RLS never needs to authorize a reader-driven insert.

-- The trigger: fires once per character, the moment its first
-- chronicle_entries row goes live -- not on every subsequent entry.
-- "Went live" per the game plan's own correction is chronicle_entries.is_live
-- flipping true, not the book-publication toggle. Also flips the
-- character's classification_status from pending to active in the same
-- pass; nothing else in this schema currently makes that transition, and
-- leaving it stuck on 'pending' after real content ships is a bug the
-- character page (which branches on classification_status) would hit.

create function public.notify_chronicle_request_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_name text;
  v_had_prior_live boolean;
begin
  if new.is_live is distinct from true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_live is true then
    return new; -- already live before this write, not a fresh "went live" transition
  end if;

  select exists (
    select 1 from public.chronicle_entries
    where character_id = new.character_id
      and is_live = true
      and id <> new.id
  ) into v_had_prior_live;

  if v_had_prior_live then
    return new; -- not this character's first live entry
  end if;

  select name into v_character_name from public.characters where id = new.character_id;

  update public.characters
  set classification_status = 'active'
  where id = new.character_id and classification_status = 'pending';

  insert into public.notifications (reader_id, kind, character_id, chronicle_entry_id, message)
  select
    cr.reader_id,
    'chronicle_request_fulfilled',
    new.character_id,
    new.id,
    format('%s''s first Chronicle is live: %s', coalesce(v_character_name, 'A character you requested'), new.title)
  from public.chronicle_requests cr
  where cr.character_id = new.character_id;

  return new;
end;
$$;

create trigger chronicle_entries_notify_request_fulfillment
  after insert or update of is_live on public.chronicle_entries
  for each row execute function public.notify_chronicle_request_fulfillment();

revoke execute on function public.notify_chronicle_request_fulfillment()
  from public, anon, authenticated;
