-- v1.66 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration du texte intégral
-- des mails et ses droits : un compte de l'équipe autre que le titulaire, anon et le rôle de sauvegarde ne lisent JAMAIS le texte
-- d'un mail privé, même en accès direct. Données FICTIVES (domaines example.*).
-- Usage : createdb essai166 ; psql -d essai166 -f ce_fichier ;
--         psql -d essai166 -f supabase/migrations/2026-11-20_v1.66_texte_mails.sql   (DEUX fois : rejouable)
--         psql -d essai166 -v ON_ERROR_STOP=1 -f supabase/repetitions/2026-11-20_v1.66_texte_mails_essai.sql
-- Reproduit, à l'identique des migrations v1.60.4 et v1.61, ce dont la migration v1.66 dépend ; droits PAR DÉFAUT de Supabase
-- (tables et fonctions du schéma public accordées à anon et authenticated) ; en plus, cas défavorable : usage du schéma private
-- accordé à authenticated (la table doit rester illisible quand même).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'sauvegarde') then create role sauvegarde nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists private;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon, service_role, sauvegarde;
grant usage on schema private to authenticated, sauvegarde;   -- cas défavorable (voir en-tête)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant select on tables to sauvegarde;   -- rôle de sauvegarde : lecture des tables public
create table public.app_users (email text primary key);
insert into public.app_users values ('titulaire@example.com'), ('collegue@example.com');
create or replace function public.is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where email = lower(auth.jwt() ->> 'email')) $$;
create table private.mailbox_owners (mailbox text primary key, email text not null);
revoke all on private.mailbox_owners from public, anon, authenticated;
insert into private.mailbox_owners values ('anthony', 'titulaire@example.com');
create or replace function public.is_mailbox_owner(p_mailbox text default 'anthony') returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.is_team() and exists (select 1 from private.mailbox_owners o
    where o.mailbox = coalesce(p_mailbox, 'anthony') and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_mailbox_owner(text) from public, anon;
grant execute on function public.is_mailbox_owner(text) to authenticated, service_role;
create table public.prospect_logs (id uuid primary key default gen_random_uuid(), body text);
alter table public.prospect_logs enable row level security;
create policy team_all on public.prospect_logs for all to authenticated using (public.is_team()) with check (public.is_team());
create table public.mail_threads (id uuid primary key default gen_random_uuid(), mailbox text not null default 'anthony');
create table public.mail_messages (id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.mail_threads(id) on delete cascade, mailbox text not null default 'anthony',
  gmail_message_id text not null, snippet text);
do $$ declare t text; begin
  foreach t in array array['mail_threads', 'mail_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy mailbox_owner on public.%I for all to authenticated using (public.is_mailbox_owner(mailbox)) with check (public.is_mailbox_owner(mailbox))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
insert into public.mail_threads (id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.mail_messages (id, thread_id, gmail_message_id, snippet) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'g01', 'Bonjour'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'g02', 'Merci');
