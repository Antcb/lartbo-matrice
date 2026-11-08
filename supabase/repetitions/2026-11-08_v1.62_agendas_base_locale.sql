-- v1.62 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration des agendas des artistes.
-- Usage : createdb essai ; psql -d essai -f ce_fichier ; psql -d essai -f supabase/migrations/2026-11-06_v1.62_agendas_artistes.sql (deux fois : rejouable) ;
--         psql -d essai -f supabase/repetitions/2026-11-08_v1.62_agendas_essai.sql
-- Reproduit seulement ce dont la migration dépend, à l'identique des migrations qui l'ont créé : rôles Supabase, auth.jwt(), is_team()
-- (app_users), projects, shows (archived_at v1.60.3), touch_updated_at() (schema.sql), schéma privé et import_secrets / import_secret
-- (v1.22), publication temps réel, extension d'appels HTTP simulée (net.http_post note l'appel dans net._appels, n'envoie rien).
-- Pas de pg_cron ici : la migration n'inscrit la tâche planifiée que si l'extension existe (branche essayée sur le projet de test).
set check_function_bodies = false;
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon, service_role;
create table public.app_users (email text primary key);
create or replace function public.is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where email = lower(auth.jwt() ->> 'email')) $$;
create table public.projects (id uuid primary key default gen_random_uuid(), name text);
create table public.shows (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id), venue text not null default '?',
  date date, status text not null default 'Intérêt Salle', archived_at timestamptz);
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon, service_role;   -- comme Supabase
create schema if not exists private;
create table if not exists private.import_secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
create or replace function public.import_secret(k text) returns text
language sql stable security definer set search_path = public, private as $$
  select value from private.import_secrets where key = k
$$;
revoke execute on function public.import_secret(text) from public, anon, authenticated;
grant execute on function public.import_secret(text) to service_role;
create publication supabase_realtime;
create schema net;
create table net._appels (id serial, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net._appels (url, headers, body) values (url, headers, body) returning id::bigint $$;
