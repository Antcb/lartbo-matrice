-- v1.60.4 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la migration « titulaire ».
-- Usage : createdb essai ; psql -d essai -f ce_fichier ; psql -d essai -f supabase/migrations/2026-10-27_v1.47_secrets.sql ;
--         psql -d essai -f supabase/migrations/2026-11-08_v1.60.4_cle_boite.sql ;
--         psql -d essai -f supabase/migrations/2026-11-08_v1.60.4_titulaire.sql   (DEUX fois : rejouable)
--         psql -d essai -f supabase/repetitions/2026-11-08_v1.60.4_titulaire_essai.sql
-- Repris de la base locale du lot messagerie (2026-11-08_v1.63_messagerie_base_locale.sql), réduit à ce qu'utilisent ces migrations.
-- Données FICTIVES uniquement (domaines example.*).
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
insert into public.app_users values ('titulaire@example.com'), ('collegue@example.com');
create or replace function public.is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where email = lower(auth.jwt() ->> 'email')) $$;
create table public.settings (key text primary key, value jsonb);
alter table public.settings enable row level security;
grant select, insert, update, delete on public.settings to authenticated;
create or replace function public.setting_text(k text) returns text language sql stable as $$ select value #>> '{}' from settings where key = k $$;
insert into public.settings values ('prospect_script_url', '"https://script.google.com/macros/s/AKfy_titulaire/exec"'), ('drive_webhook_url', '""');
