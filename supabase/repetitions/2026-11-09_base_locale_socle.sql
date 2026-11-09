-- Socle minimal imitant Supabase pour une base PostgreSQL 16 JETABLE (jamais Supabase, jamais la production) : rôles, schémas auth /
-- cron / net / vault / storage / private simulés (aucun appel réel), pgcrypto dans « extensions ». Utilisé par 2026-11-09_base_locale_complete.sh.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create or replace function public.gen_random_bytes(int) returns bytea language sql as $f$ select extensions.gen_random_bytes($1) $f$; create or replace function public.digest(text, text) returns bytea language sql as $f$ select extensions.digest($1, $2) $f$; create or replace function public.digest(bytea, text) returns bytea language sql as $f$ select extensions.digest($1, $2) $f$; create or replace function public.crypt(text, text) returns text language sql as $f$ select extensions.crypt($1, $2) $f$; create or replace function public.gen_salt(text) returns text language sql as $f$ select extensions.gen_salt($1) $f$; create or replace function public.hmac(text, text, text) returns bytea language sql as $f$ select extensions.hmac($1, $2, $3) $f$;
create schema if not exists extensions;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
create or replace function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
-- pg_cron / pg_net / vault : simulés (aucun appel réel)
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 0::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 0::bigint $$;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret decrypted_secret from vault.secrets;
create or replace function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$ insert into vault.secrets(name, secret) values (n, s) returning id $$;
create or replace function vault.update_secret(i uuid, s text default null, n text default null, d text default null) returns void language sql as $$ update vault.secrets set secret = coalesce(s, secret) where id = i $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create or replace function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n, '/') $$;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
create schema if not exists private; create table if not exists private.import_secrets (key text primary key, value text not null);
