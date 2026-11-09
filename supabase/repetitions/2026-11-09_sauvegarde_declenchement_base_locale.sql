-- BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration
-- 2026-11-09_v1.60.7_sauvegarde_declenchement.sql. Lancée par 2026-11-09_sauvegarde_declenchement_essai.sh (voir ce fichier).
-- Reproduit seulement ce qu'utilisent la migration et la copie : rôles Supabase, coffre, notifications, schéma « cron » simulé
-- (pg_cron absent en local), table privée v1.60.4 (mailbox_owners) et une table du schéma public. Données FICTIVES uniquement.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  -- rôle de sauvegarde : comme outils/role_sauvegarde.sql (dépôt lartbo-matrice-backup), réduit au schéma public et private
  if not exists (select 1 from pg_roles where rolname = 'sauvegarde') then create role sauvegarde nologin bypassrls connection limit 2; end if;
end $$;
create schema if not exists private;
revoke all on schema private from public;
create table private.import_secrets (key text primary key, value text not null);
insert into private.import_secrets values ('backup_secret', 'valeur-fictive-backup-0123456789abcdef'),
                                          ('mailbox_sign_key', 'valeur-fictive-cle-boite-0123456789abcdef');
create table private.notion_raw (id text primary key, payload jsonb);
create table private.notion_cursor (id text primary key, at timestamptz);
-- v1.60.4 : registre des titulaires (comme la migration 2026-11-08_v1.60.4_titulaire.sql : aucun droit, RLS activée en production)
create table private.mailbox_owners (mailbox text primary key, email text not null);
alter table private.mailbox_owners enable row level security;
insert into private.mailbox_owners values ('anthony', 'titulaire@example.com');
create table public.notifications (
  id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), kind text, title text not null, body text,
  show_id uuid, task_id uuid, project_id uuid, dedupe_key text unique, read_by text[] not null default '{}', emailed_at timestamptz,
  withdrawn_at timestamptz);
create table public.shows (id uuid primary key default gen_random_uuid(), venue text);
insert into public.shows (venue) values ('Salle fictive');
grant usage on schema public, private to sauvegarde;
grant select on all tables in schema public to sauvegarde;
grant select on private.notion_raw, private.notion_cursor to sauvegarde;
alter role sauvegarde set default_transaction_read_only = on;
-- pg_cron simulé : cron.job, cron.schedule (remplace une tâche de même nom, comme pg_cron), cron.unschedule
create schema if not exists cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (jobid bigint, status text, start_time timestamptz);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$;
grant usage on schema cron to sauvegarde;
grant select on cron.job, cron.job_run_details to sauvegarde;
