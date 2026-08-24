-- 0003 revoked EXECUTE from PUBLIC, but Supabase's default privileges on the
-- public schema also grant EXECUTE directly to anon/authenticated at
-- function-creation time (independent of the PUBLIC pseudo-role) -- so the
-- RPC surface was still open. Revoke from the actual roles PostgREST uses.

revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.sync_email_confirmation() from anon, authenticated;
