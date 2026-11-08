-- v1.63 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration de la messagerie.
-- Usage : createdb essai ; psql -d essai -f ce_fichier ; psql -d essai -f supabase/migrations/2026-10-27_v1.47_secrets.sql ;
--         psql -d essai -f supabase/migrations/2026-11-08_v1.60.4_cle_boite.sql ;
--         psql -d essai -f supabase/migrations/2026-11-06_v1.61_messagerie.sql   (DEUX fois : rejouable)
--         psql -d essai -f supabase/repetitions/2026-11-08_v1.63_messagerie_essai.sql
-- Tables réduites aux colonnes utilisées par la migration (relevées dans supabase/schema.sql et les migrations v1.7, v1.18, v1.20, v1.22).
-- Données FICTIVES uniquement (domaines example.*). Extensions de Supabase simulées : net.http_post (appels notés), pas de pg_cron.
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
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.structures (id uuid primary key default gen_random_uuid(), name text not null, inactive_at date);
create table public.contacts (id uuid primary key default gen_random_uuid(), display_name text not null, email text, email_2 text);
create table public.contact_structures (contact_id uuid references public.contacts(id) on delete cascade, structure_id uuid references public.structures(id) on delete cascade, primary key (contact_id, structure_id));
create table public.projects (id uuid primary key default gen_random_uuid(), name text not null);
create table public.shows (id uuid primary key default gen_random_uuid(), project_id uuid, structure_id uuid, date date);
create table public.prospects (id uuid primary key default gen_random_uuid(), name text not null, project_id uuid references public.projects(id) on delete set null,
  structure_id uuid references public.structures(id) on delete set null, status text default 'Mailed' check (status in ('Mailed','Interest','Option','Confirmed','Closed')),
  mail_thread_id text, project_ids uuid[] not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
create table public.prospect_logs (id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.prospects(id) on delete cascade,
  date date, kind text default 'Appel', contact_name text, body text, author text, import_key text unique, created_at timestamptz default now());
create table public.tasks (id uuid primary key default gen_random_uuid(), title text not null, status text not null default 'To Do' check (status in ('To Do','In Progress','Done','Cancelled')),
  prospect_id uuid, auto_kind text, notes text, done_at timestamptz, deadline date, created_at timestamptz default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), kind text, title text not null, body text,
  dedupe_key text unique, read_by text[] not null default '{}');
create schema if not exists private;
create table if not exists private.import_secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
create or replace function public.import_secret(k text) returns text language sql stable security definer set search_path = public, private as $$
  select value from private.import_secrets where key = k $$;
revoke execute on function public.import_secret(text) from public, anon, authenticated;
grant execute on function public.import_secret(text) to service_role;
-- réglages (schema.sql) : la migration v1.47 y pose ses règles d'accès, puis la messagerie celle de prospect_script_url
create table public.settings (key text primary key, value jsonb);
alter table public.settings enable row level security;
create or replace function public.setting_text(k text) returns text language sql stable as $$ select value #>> '{}' from settings where key = k $$;
insert into public.settings values ('prospect_script_url', '"https://script.google.com/macros/s/AKfy_titulaire/exec"'), ('drive_webhook_url', '""');
-- pg_net simulé : les appels sont notés (adresse et en-têtes), rien ne part
create schema if not exists net;
create table net.appels (url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$
  insert into net.appels values (url, headers, body) returning 1::bigint $$;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
