-- Local/CI-only stand-in for the pieces of Supabase's platform (the `auth`
-- schema, and the anon/authenticated/service_role roles) that a real
-- Supabase project provides for free but a plain Postgres instance does
-- not. NEVER run this against an actual Supabase project -- it already has
-- the real versions of all of this, and this stub would conflict with them.
--
-- This exists so the migrations in ../migrations/ can be applied and
-- exercised against an ordinary Postgres server (see the CI workflow,
-- .github/workflows/ci.yml) without needing a live, unpaused Supabase
-- project just to confirm they still apply cleanly and their triggers
-- still behave correctly.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid $$;

create or replace function auth.role() returns text
language sql stable as $$ select coalesce(current_setting('request.jwt.role', true), 'anon') $$;

-- pgcrypto is created by 0001 itself, but gen_random_uuid() above (used in
-- auth.users' own default) needs it to already exist first.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- A real Supabase project auto-grants anon/authenticated broad table-level
-- privileges on the public schema at provisioning time (RLS is meant to be
-- the sole enforcement layer, per this schema's own comments -- table
-- grants are deliberately coarse yes/no, RLS policies do the actual row
-- filtering). Nothing in supabase/migrations/ replicates that grant
-- because it isn't a migration's job; a plain local Postgres server has no
-- equivalent of it at all. Without this, every prior local verification
-- pass in this project ran as the postgres superuser, which bypasses RLS
-- entirely (superusers aren't subject to row security by default) -- so
-- RLS policies were confirmed to exist and compile, but never actually
-- exercised as a genuinely restricted role. This closes that gap: apply
-- this before the public-schema migrations run (0001+) so their
-- create table statements pick up the default privileges below.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public
  grant all on tables to anon, authenticated;
