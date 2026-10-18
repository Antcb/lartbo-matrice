-- v1.22 : tout ce qu'une installation neuve doit avoir et qui avait été ajouté directement sur la base
-- (relecture Greptile). Sans effet sur la base de production, où tout existe déjà.

-- Colonnes écrites par le site
alter table public.tasks add column if not exists project_ids uuid[] not null default '{}';
alter table public.prospects add column if not exists project_ids uuid[] not null default '{}';
alter table public.structures add column if not exists department_code text;
alter table public.structures add column if not exists department_name text;

-- Secrets des fonctions serveur (clés IA, Pennylane…) : schéma privé, lisible seulement par le serveur
create schema if not exists private;
create table if not exists private.import_secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
create or replace function public.import_secret(k text) returns text
language sql stable security definer set search_path = public, private as $$
  select value from private.import_secrets where key = k
$$;
revoke execute on function public.import_secret(text) from public, anon, authenticated;
grant execute on function public.import_secret(text) to service_role;

-- Accès de l'équipe au journal et aux pièces jointes des suivis
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospect_logs') then
    create policy team_all on public.prospect_logs for all using (is_team()) with check (is_team());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospect_files') then
    create policy team_all on public.prospect_files for all using (is_team()) with check (is_team());
  end if;
end $$;

-- Stockage privé « suivi » (pièces des suivis, tâches, projets, budgets)
insert into storage.buckets (id, name, public) values ('suivi', 'suivi', false) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'suivi_team') then
    create policy suivi_team on storage.objects for all using (bucket_id = 'suivi' and is_team()) with check (bucket_id = 'suivi' and is_team());
  end if;
end $$;

-- Brevo : adresse des fonctions serveur propre à chaque projet (production / espace de test)
insert into public.settings(key, value) values ('functions_base_url', to_jsonb(coalesce(current_setting('app.functions_base_url', true), ''))) on conflict (key) do nothing;
create or replace function public.brevo_queue(p_contact uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text; sec text; base text;
begin
  select value #>> '{}' into k from settings where key = 'brevo_api_key';
  if coalesce(trim(k), '') = '' then return; end if;
  select value #>> '{}' into base from settings where key = 'functions_base_url';
  if coalesce(trim(base), '') = '' then return; end if;
  select value #>> '{}' into sec from settings where key = 'brevo_hook_secret';
  perform net.http_post(
    url := rtrim(base, '/') || '/brevo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := jsonb_build_object('contact_id', p_contact));
end $$;
-- Après installation : update settings set value = to_jsonb('https://<projet>.supabase.co/functions/v1'::text) where key = 'functions_base_url';

-- Les fonctions de réglage vérifient déjà l'équipe : on retire en plus l'accès anonyme
revoke execute on function public.set_pennylane_key(text) from public, anon;
revoke execute on function public.pennylane_status() from public, anon;
revoke execute on function public.set_ai_key(text) from public, anon;
revoke execute on function public.ai_key_status() from public, anon;

-- Pièce rangée dans le Drive de la date (02_Finance)
alter table public.budget_lines add column if not exists drive_file_id text;
alter table public.show_payments add column if not exists drive_file_id text;
