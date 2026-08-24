-- Security advisor flagged handle_new_user() and sync_email_confirmation()
-- as directly callable via PostgREST RPC by anon/authenticated. They are
-- trigger-only functions with no legitimate direct-call use case -- trigger
-- firing does not require the invoking role to hold EXECUTE, so revoking
-- public execute here closes the RPC surface without affecting the triggers.
--
-- current_clearance() and is_admin() are left untouched: RLS policies that
-- reference them are evaluated as the querying role, which needs EXECUTE on
-- the function for those policies to work, and calling them directly only
-- ever reveals the caller's own clearance/admin status -- not a leak.

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.sync_email_confirmation() from public;
