-- Level 2 clearance-unlock rule, ratified via the real Brain Trust closing
-- round (Bink's final verdict, 2026-09-13; see the Knowledge Core repo's
-- docs/lords-of-cian/2026-09-13-archive-app-six-open-items-final-verdicts.md
-- section on Item 2):
--
--   clearance_level_2_unlock =
--       EXISTS(reads WHERE reader_id = X AND completed = true)   -- >=1 fully completed chronicle
--       AND (
--           EXISTS(shares WHERE reader_id = X)                    -- >=1 share, OR
--           OR
--           EXISTS(chronicle_requests WHERE reader_id = X)         -- >=1 request
--       )
--
-- One completed read is mandatory; the companion action is a free reader
-- choice between share or request. Read controls stalling risk (kept low,
-- one read not three); the OR on the companion action controls gaming risk
-- (closed, since reading can't be skipped).
--
-- Hard pre-ship dependency from that same ruling, confirmed true by direct
-- inspection of apps/web/components/ReadingProgressTracker.tsx:
-- reads.completed is entirely client-computed and client-written via a
-- plain upsert -- nothing server-side validates it, so as specified above
-- the gate would be satisfiable by a single unauthenticated-effort API
-- call. Per the ruling's own named interim substitute: "a server-logged
-- proxy -- minimum time-on-page (>=60s, debounced server ping) plus
-- scroll-depth >=90% on that chronicle_entry -- stands in for 'completed'
-- until real tracking lands." That proxy is what "verified read" means
-- below -- reads.completed itself is untouched and keeps its existing,
-- client-trusted meaning for the reading-progress-bar UI, which was never
-- a security-relevant use.
--
-- Also carries the ruling's two hard requirements: provenance tagging
-- (which companion action satisfied the gate, in level_2_unlocks below --
-- Oluwole's access_method condition) and a foundation for live progress
-- visibility (Amaya's condition) -- read_pings/level_2_unlocks are
-- reader-selectable so a future UI can query "how close am I," though the
-- visible progress indicator itself is a separate, not-yet-built frontend
-- pass.

-- ---------------------------------------------------------------------------
-- Server-verified dwell time. Every column that matters (first_ping_at,
-- last_ping_at) is stamped from the server's own now() inside the RPC
-- below, never from client-supplied data -- the only way to accumulate
-- real dwell time is to actually keep the RPC being called across real
-- wall-clock time.
-- ---------------------------------------------------------------------------

create table public.read_pings (
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  chronicle_entry_id uuid not null references public.chronicle_entries(id) on delete cascade,
  first_ping_at timestamptz not null default now(),
  last_ping_at timestamptz not null default now(),
  ping_count int not null default 1,
  primary key (reader_id, chronicle_entry_id)
);

comment on table public.read_pings is
  'Server-timestamped dwell-time evidence for a chronicle_entry, the Level 2 gate''s stand-in for a trustworthy "completed read" until reads.completed itself gets real server-side backing. Every row is written exclusively by record_reading_ping() below -- no client-supplied timestamp is ever trusted.';

alter table public.read_pings enable row level security;

create policy "read_pings_select_own" on public.read_pings
  for select using (reader_id = auth.uid() or public.is_admin());
-- No insert/update policy for anon/authenticated: every row is written by
-- record_reading_ping(), a SECURITY DEFINER function, matching this
-- project's established trigger-only-write posture (notifications,
-- follow_changes, connective_tissue_trails).

create function public.record_reading_ping(p_chronicle_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return; -- silent no-op for signed-out callers, matching ReadingProgressTracker's own posture
  end if;

  insert into public.read_pings (reader_id, chronicle_entry_id, first_ping_at, last_ping_at, ping_count)
  values (auth.uid(), p_chronicle_entry_id, now(), now(), 1)
  on conflict (reader_id, chronicle_entry_id) do update
  set last_ping_at = now(),
      ping_count = public.read_pings.ping_count + 1;

  perform public.evaluate_level_2_clearance(auth.uid());
end;
$$;

comment on function public.record_reading_ping(uuid) is
  'Reader-callable directly via RPC. Stamps first_ping_at/last_ping_at from the server''s own now() only -- never accepts a client-supplied timestamp. Intended to be called periodically (client-debounced, e.g. every ~20s) while a chronicle is genuinely on-screen and scrolled.';

-- Explicit PUBLIC revoke alongside the authenticated grant, learning
-- directly from 0017's finding in the same session: a bare "grant to
-- authenticated" does not by itself revoke the default PUBLIC grant every
-- new function gets, and anon is implicitly a member of PUBLIC.
grant execute on function public.record_reading_ping(uuid) to authenticated;
revoke execute on function public.record_reading_ping(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Provenance: which companion action (share or request) satisfied the
-- gate, for whichever reader has been promoted -- Oluwole's hard
-- requirement, "the only way to detect... abuse of either leg after the
-- fact without another review cycle."
-- ---------------------------------------------------------------------------

create table public.level_2_unlocks (
  reader_id uuid primary key references public.reader_profiles(id) on delete cascade,
  satisfied_by text not null check (satisfied_by in ('share', 'request')),
  granted_at timestamptz not null default now()
);

comment on table public.level_2_unlocks is
  'One row per reader promoted to clearance Level 2, recording which companion action (share or request) satisfied the gate alongside their verified read. Written exclusively by evaluate_level_2_clearance() below.';

alter table public.level_2_unlocks enable row level security;

create policy "level_2_unlocks_select_own" on public.level_2_unlocks
  for select using (reader_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- The gate itself. Trigger-only (matching notify_chronicle_request_fulfillment's
-- posture) -- no direct client call has a legitimate use case, since this
-- is derived entirely from state the client already controls through
-- reads/shares/chronicle_requests/read_pings themselves.
-- ---------------------------------------------------------------------------

create function public.evaluate_level_2_clearance(p_reader_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_level smallint;
  v_has_verified_read boolean;
  v_satisfied_by text;
begin
  if p_reader_id is null then
    return;
  end if;

  select clearance_level into v_current_level
  from public.reader_profiles
  where id = p_reader_id;

  if v_current_level is null or v_current_level >= 2 then
    return; -- no such reader, or already at/above Level 2 -- nothing to do
  end if;

  select exists (
    select 1
    from public.read_pings rp
    join public.reads r
      on r.reader_id = rp.reader_id
     and r.chronicle_entry_id = rp.chronicle_entry_id
    where rp.reader_id = p_reader_id
      and rp.ping_count >= 2
      and rp.last_ping_at - rp.first_ping_at >= interval '60 seconds'
      and r.completion_pct >= 90
  ) into v_has_verified_read;

  if not v_has_verified_read then
    return;
  end if;

  -- Request checked first only as a stable tie-break for which action gets
  -- recorded when a reader has done both -- provenance records one cause,
  -- not "which happened first."
  if exists (select 1 from public.chronicle_requests where reader_id = p_reader_id) then
    v_satisfied_by := 'request';
  elsif exists (select 1 from public.shares where reader_id = p_reader_id) then
    v_satisfied_by := 'share';
  else
    return; -- verified read, but no companion action yet
  end if;

  update public.reader_profiles
  set clearance_level = 2
  where id = p_reader_id and clearance_level < 2;

  insert into public.level_2_unlocks (reader_id, satisfied_by)
  values (p_reader_id, v_satisfied_by)
  on conflict (reader_id) do nothing;
end;
$$;

comment on function public.evaluate_level_2_clearance(uuid) is
  'Trigger-only. Re-checks whether a reader now satisfies the Level 2 gate (a verified read, per read_pings, AND at least one of share/request) and promotes clearance_level if so, recording provenance in level_2_unlocks. Idempotent past the first promotion (returns immediately once clearance_level >= 2).';

revoke execute on function public.evaluate_level_2_clearance(uuid) from public, anon, authenticated;

-- Fires this check the moment a reader gains a new share or request --
-- the read_pings side already triggers it from inside record_reading_ping()
-- itself, so no separate trigger is needed there.

create function public.trigger_evaluate_level_2_on_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_level_2_clearance(new.reader_id);
  return new;
end;
$$;

create trigger shares_evaluate_level_2
  after insert on public.shares
  for each row execute function public.trigger_evaluate_level_2_on_share();

create function public.trigger_evaluate_level_2_on_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_level_2_clearance(new.reader_id);
  return new;
end;
$$;

create trigger chronicle_requests_evaluate_level_2
  after insert on public.chronicle_requests
  for each row execute function public.trigger_evaluate_level_2_on_request();

revoke execute on function public.trigger_evaluate_level_2_on_share() from public, anon, authenticated;
revoke execute on function public.trigger_evaluate_level_2_on_request() from public, anon, authenticated;
