-- P0-4 (lords-of-cian-archive-game-plan.md): "close the identity hole in
-- the demand signal." The schema already had the anti-ballot-stuffing
-- pieces (chronicle_requests' unique(character_id, reader_id),
-- reader_profiles.email_confirmed_at synced from auth.users,
-- referrals.signup_ip_hash_match as a column to review against) but nothing
-- actually enforced the game plan's stated minimum-viable fix:
--
--   2. Verified identity for signal-bearing actions only... require a
--      confirmed email before a referral credits toward Level 3 or the
--      referral graph... Confirmation gates earning, not entering.
--   3. Rate limiting on signup and request endpoints...
--
-- This migration closes the mechanical part of both. Two things are
-- deliberately NOT attempted here, and are not silently skipped -- they
-- need either a live Supabase project or a product decision this
-- migration has no business making on its own:
--   - Signup-endpoint rate limiting and disposable-domain blocking are
--     GoTrue dashboard/config settings on the (currently paused) Supabase
--     project, not something a SQL migration can express.
--   - referrals.signup_ip_hash_match / reader_profiles.signup_ip_hash stay
--     unpopulated: Supabase Auth's own signup call happens directly from
--     the browser to GoTrue, bypassing this app's own server entirely, so
--     nothing here ever observes the client's IP. Populating it needs a
--     custom signup Route Handler proxying to the Auth Admin API -- a real
--     architecture change to "frictionless signup," not a mechanical fix,
--     and flagged in CLAUDE.md rather than built blind.

-- ---------------------------------------------------------------------------
-- Referral crediting, gated on confirmed email.
-- ---------------------------------------------------------------------------
-- reader_profiles.email_confirmed_at is already kept in sync with
-- auth.users by sync_email_confirmation() (0001). This adds the other half:
-- the moment it transitions from null to non-null is exactly the "earning"
-- event the game plan describes, so that's the only moment a referral
-- becomes credited. A referral for a reader who never confirms their email
-- simply never credits -- it is not retried, deleted, or flagged, it just
-- sits at credited = false, which is already how every reader-facing query
-- in this schema treats an unproven referral.

create function public.credit_referral_on_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.referrals
    set credited = true
    where referred_id = new.id
      and credited = false;
  end if;
  return new;
end;
$$;

create trigger reader_profiles_credit_referral_on_confirmation
  after update of email_confirmed_at on public.reader_profiles
  for each row execute function public.credit_referral_on_email_confirmation();

-- ---------------------------------------------------------------------------
-- Request rate limiting.
-- ---------------------------------------------------------------------------
-- The existing unique(character_id, reader_id) constraint on
-- chronicle_requests stops one account from inflating the count on a single
-- character, but does nothing against a scripted account firing requests
-- across many different characters in a burst. This is the distinct fraud
-- shape it doesn't cover. 20/hour is a starting default generous enough for
-- any real reader (this is a slow-moving, pre-book-content signal, not a
-- high-frequency action) and cheap to retune later -- it lives in one place.

create function public.enforce_chronicle_request_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count integer;
begin
  select count(*) into v_recent_count
  from public.chronicle_requests
  where reader_id = new.reader_id
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 20 then
    raise exception using
      errcode = 'P0001',
      message = 'rate_limit_exceeded: too many chronicle requests in the last hour';
  end if;

  return new;
end;
$$;

create trigger chronicle_requests_rate_limit
  before insert on public.chronicle_requests
  for each row execute function public.enforce_chronicle_request_rate_limit();

-- ---------------------------------------------------------------------------
-- Close the same RPC-surface hole 0003/0004 closed for the signup triggers.
-- Both functions above are trigger-only; direct PostgREST calls have no
-- legitimate use case and firing as a trigger never requires the invoking
-- role to hold EXECUTE.
-- ---------------------------------------------------------------------------

revoke execute on function public.credit_referral_on_email_confirmation()
  from public, anon, authenticated;
revoke execute on function public.enforce_chronicle_request_rate_limit()
  from public, anon, authenticated;
