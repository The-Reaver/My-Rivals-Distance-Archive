-- Extends handle_new_user() (0001) so a reader can choose which character's
-- Chronicle to follow at signup time, not only afterward via a profile edit.
-- reader_profiles.followed_character_id already existed as a column with no
-- writer -- this is the missing half of the reader signup flow (Phase 2's
-- reader loop). raw_user_meta_data is client-supplied (whatever a browser
-- passes via supabase.auth.signInWithOtp's `data` option), so a malformed or
-- nonexistent character id must fail safe to null rather than error the
-- whole signup trigger and block account creation.
--
-- CREATE OR REPLACE preserves the function's existing ACL (0003/0004 already
-- revoked EXECUTE from public/anon/authenticated for this trigger-only
-- function), but the revokes are restated explicitly below anyway so this
-- migration's own security posture doesn't depend on that Postgres behavior
-- being remembered correctly by a future reader.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_referral_code text;
  v_followed_character_id uuid;
begin
  begin
    v_followed_character_id := (new.raw_user_meta_data ->> 'followed_character_id')::uuid;
  exception when others then
    v_followed_character_id := null;
  end;

  if v_followed_character_id is not null
     and not exists (
       select 1 from public.characters where id = v_followed_character_id
     ) then
    v_followed_character_id := null;
  end if;

  insert into public.reader_profiles (id, email, email_confirmed_at, followed_character_id)
  values (new.id, new.email, new.email_confirmed_at, v_followed_character_id);

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

revoke execute on function public.handle_new_user() from public, anon, authenticated;
