-- Post-unpause advisors run, 2026-09-13, surfaced a real gap between stated
-- intent and actual effect: 0010's "revoke execute ... from anon" never
-- worked, because Postgres grants EXECUTE on a new function to PUBLIC by
-- default, and anon (like every role) is implicitly a member of PUBLIC.
-- Revoking from anon by name left the PUBLIC grant untouched, so anon could
-- still call change_followed_character via PostgREST the whole time.
--
-- Not currently exploitable -- the function's own internal check
-- (`v_reader_id := auth.uid()`, raising 'not_authenticated' when null) means
-- an anon call always fails before any mutation happens, the same
-- fail-safe-for-anonymous pattern current_clearance()/is_admin() use
-- deliberately. This closes the gap between the migration's stated intent
-- and its actual grants, rather than fixing a live hole.

revoke execute on function public.change_followed_character(uuid) from public;
