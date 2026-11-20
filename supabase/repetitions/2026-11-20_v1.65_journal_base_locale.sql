-- v1.65 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration du journal
-- (occurred_at, mail_journal) et les deux opérations de reprise, sur des données FICTIVES de la forme du suivi Ressins Folies du 17/11.
-- (le projet Supabase de test n'a pas la messagerie v1.61 : la migration ne s'y applique pas.)
-- Usage : createdb essai165 ; psql -d essai165 -f ce_fichier ; psql -d essai165 -f supabase/migrations/2026-11-20_v1.65_journal_horodatage.sql
--         (deux fois : rejouable) ; psql -d essai165 -f supabase/repetitions/2026-11-20_v1.65_journal_essai.sql
-- Reproduit seulement ce dont la migration dépend (colonnes lues ou écrites par mail_journal, à l'identique de la migration v1.61).
create extension if not exists pgcrypto;
create table public.prospects (id uuid primary key default gen_random_uuid(), name text);
create table public.settings (key text primary key, value jsonb not null);   -- marque « une seule fois » de la reprise des extraits
create table public.prospect_logs (
  id uuid primary key default gen_random_uuid(), prospect_id uuid references public.prospects(id) on delete cascade, date date, kind text,
  contact_name text, contact_id uuid, body text, author text, sort int, import_key text unique, created_at timestamptz not null default now(),
  hidden boolean not null default false, body_html text, gmail_message_id text);
create table public.mail_threads (id uuid primary key default gen_random_uuid(), mailbox text, gmail_thread_id text, prospect_id uuid, snippet text);
create table public.mail_messages (
  id uuid primary key default gen_random_uuid(), thread_id uuid references public.mail_threads(id), mailbox text, gmail_message_id text,
  rfc_message_id text, ref_ids text[] default '{}', direction text, from_addr text, from_name text, to_addrs text[] default '{}', cc_addrs text[] default '{}',
  subject text, snippet text, sent_at timestamptz, attachments jsonb default '[]', prospect_log_id uuid references public.prospect_logs(id) on delete set null,
  created_at timestamptz default now(), auto_kind text, suspended_tasks uuid[]);
-- relances suspendues à une réponse : sans objet ici (appel seulement noté)
create table public._suspensions (message uuid, prospect uuid);
create function public.mail_suspend(p_message uuid, p_prospect uuid) returns void language sql as $$ insert into public._suspensions values (p_message, p_prospect) $$;
