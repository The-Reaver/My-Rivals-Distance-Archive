-- Follow Reconsideration (game plan Idea 7). "Signup forces one followed
-- character... but not an achievement, not a reset. Allow one follow
-- change after a fixed window, say 30 days, presented plainly as 'Follow a
-- different character instead.'... a switch from A to B is itself the
-- data point."
--
-- Read as an ongoing, rate-limited mechanic (repeatable every 30 days, not
-- a single lifetime use) -- "a switch... is itself the data point"
-- implies switches, plural, are a meaningful recurring signal, and the
-- 30-day cooldown's own job is to rate-limit that, not forbid it after one
-- use.
--
-- Deliberately NOT attempted: "switching resets Level 3 progress toward
-- the new character." No Level 3 progress mechanism exists anywhere in
-- this schema today -- clearance_level is a flat stored integer with no
-- accumulation logic yet, because the actual Level 2/3 unlock rule is one
-- of the four decisions still queued for the real Brain Trust (see
-- CLAUDE.md). There is nothing concrete to reset. change_followed_character()
-- below is the single legal path for this change going forward, so wiring
-- a reset in later, once that rule is ratified, is a small addition here
-- rather than a rewrite or a second bypassable code path.

create table public.follow_changes (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.reader_profiles(id) on delete cascade,
  previous_character_id uuid references public.characters(id) on delete set null,
  new_character_id uuid not null references public.characters(id) on delete cascade,
  changed_at timestamptz not null default now()
);

comment on table public.follow_changes is
  'Every followed_character_id change, oldest first -- literally "a switch from A to B is itself the data point" (Idea 7). previous_character_id is null for a reader''s first-ever pick (not a "change" in the cooldown sense; see change_followed_character()). Reader-own/admin-only, not public.';

alter table public.follow_changes enable row level security;

create policy "follow_changes_select_own" on public.follow_changes
  for select using (reader_id = auth.uid() or public.is_admin());
-- No insert/update/delete policy for anon/authenticated: every row is
-- written by change_followed_character() below, a SECURITY DEFINER
-- function, same posture notifications' fulfillment trigger (0008)
-- already established for this project.

-- ---------------------------------------------------------------------------
-- The only legal path to changing reader_profiles.followed_character_id
-- after signup. reader_profiles_update_own (0001) is a row-level policy,
-- not column-aware -- left in place, it would let a reader bypass the
-- cooldown entirely with a direct UPDATE. Closed below by revoking UPDATE
-- on reader_profiles from anon/authenticated outright: nothing in this
-- codebase performs a direct client-side update against reader_profiles
-- today (verified by grep before writing this), so there is no legitimate
-- use case to preserve, matching the same "no legitimate direct-call use
-- case" reasoning 0003/0004 already applied to the signup trigger
-- functions.
-- ---------------------------------------------------------------------------

create function public.change_followed_character(p_new_character_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reader_id uuid := auth.uid();
  v_previous_character_id uuid;
  v_created_at timestamptz;
  v_last_changed_at timestamptz;
begin
  if v_reader_id is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;

  if not exists (select 1 from public.characters where id = p_new_character_id) then
    raise exception using errcode = 'P0001', message = 'character_not_found';
  end if;

  select followed_character_id, created_at
  into v_previous_character_id, v_created_at
  from public.reader_profiles
  where id = v_reader_id;

  if v_previous_character_id = p_new_character_id then
    raise exception using errcode = 'P0001', message = 'already_following_this_character';
  end if;

  -- A first-ever pick (no prior follow) is always free -- there is nothing
  -- to "reconsider" yet, so the cooldown only governs switches away from
  -- an existing follow.
  if v_previous_character_id is not null then
    select max(changed_at) into v_last_changed_at
    from public.follow_changes
    where reader_id = v_reader_id;

    if coalesce(v_last_changed_at, v_created_at) > now() - interval '30 days' then
      raise exception using errcode = 'P0001', message = 'follow_change_cooldown_active';
    end if;
  end if;

  update public.reader_profiles
  set followed_character_id = p_new_character_id
  where id = v_reader_id;

  insert into public.follow_changes (reader_id, previous_character_id, new_character_id)
  values (v_reader_id, v_previous_character_id, p_new_character_id);
end;
$$;

comment on function public.change_followed_character(uuid) is
  'Reader-callable directly via RPC (unlike this project''s other SECURITY DEFINER functions, which are trigger-only and have EXECUTE revoked). Enforces the 30-day cooldown on switching an existing follow; a first-ever pick is always free. Logs every change to follow_changes.';

grant execute on function public.change_followed_character(uuid) to authenticated;
revoke execute on function public.change_followed_character(uuid) from anon;

revoke update on public.reader_profiles from anon, authenticated;
drop policy "reader_profiles_update_own" on public.reader_profiles;
