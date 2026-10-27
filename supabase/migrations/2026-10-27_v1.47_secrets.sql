-- =====================================================================================================
-- v1.47 — Lot Sécurité (décision d'Anthony du 27/10/2026 : secrets exclusivement côté serveur, contrôle des droits)
-- Les trois secrets rangés dans la table settings (brevo_api_key, brevo_hook_secret, drive_webhook_secret) ne sont plus
-- lisibles ni modifiables par le navigateur (comptes de l'équipe compris) : la règle d'accès de la table settings les exclut.
-- Ils restent à leur place et gardent leur valeur : les fonctions de la base (SECURITY DEFINER), les fonctions serveur (rôle
-- serveur) et les scripts Google (clé serveur) les lisent comme avant — aucune intégration n'est rebranchée, aucun script Google
-- n'est à redéployer, aucune donnée n'est déplacée ni modifiée.
-- À la place, côté navigateur :
--   - appels aux scripts Google : fonction serveur « script-google » (relais, vérifie le compte de l'équipe) ;
--   - « tout envoyer à Brevo » : fonction brevo-sync avec la session de l'utilisateur ;
--   - clé Brevo : saisie par set_brevo_key, état par brevo_key_status (jamais renvoyée au navigateur), comme les clés IA / Pennylane.
-- Retour arrière : voir la fin du fichier.
-- =====================================================================================================

-- ─────────────── 1. Table settings : les secrets hors de portée du navigateur ───────────────
-- même liste dans js (aucune lecture côté navigateur) et dans le test tests/static/check.mjs
create or replace function public.is_secret_setting(k text) returns boolean
language sql immutable set search_path = public as $$
  select k in ('brevo_api_key', 'brevo_hook_secret', 'drive_webhook_secret')
$$;

-- Adresses vers lesquelles le SERVEUR envoie le code secret (relecture v1.47, B1) : le navigateur ne peut y écrire qu'une adresse de
-- script Google publiée (…/exec, même contrôle que la fonction script-google, scriptUrlOk) ou les vider ; l'adresse des fonctions
-- serveur (functions_base_url, où part brevo_hook_secret) n'est pas modifiable depuis le navigateur. Le reste : comme avant.
create or replace function public.setting_write_ok(k text, v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case
    when public.is_secret_setting(k) or k = 'functions_base_url' then false
    when k in ('drive_webhook_url', 'prospect_script_url') then
      coalesce(btrim(v #>> '{}'), '') = '' or (v #>> '{}') ~ '^https://script\.google\.com/(a/macros/[A-Za-z0-9_.-]+|macros)/s/[A-Za-z0-9_-]+/exec$'
    else true end
$$;

drop policy if exists team_all on public.settings;   -- remplacée par les quatre règles ci-dessous (même accès, secrets exclus)
drop policy if exists settings_team_read on public.settings;
drop policy if exists settings_team_insert on public.settings;
drop policy if exists settings_team_update on public.settings;
drop policy if exists settings_team_delete on public.settings;
create policy settings_team_read on public.settings for select to authenticated using (public.is_team() and not public.is_secret_setting(key));
create policy settings_team_insert on public.settings for insert to authenticated with check (public.is_team() and public.setting_write_ok(key, value));
create policy settings_team_update on public.settings for update to authenticated
  using (public.is_team() and not public.is_secret_setting(key) and key <> 'functions_base_url') with check (public.is_team() and public.setting_write_ok(key, value));
create policy settings_team_delete on public.settings for delete to authenticated using (public.is_team() and not public.is_secret_setting(key) and key <> 'functions_base_url');

-- ─────────────── 2. Clé Brevo : saisie et état, comme les clés IA et Pennylane ───────────────
create or replace function public.set_brevo_key(k text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(k, ''));
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if v <> '' and v !~ '^xkeysib-[A-Za-z0-9_-]{20,}$' then raise exception 'Ce n’est pas une clé API Brevo (elle commence par « xkeysib- »)'; end if;
  insert into public.settings (key, value) values ('brevo_api_key', to_jsonb(v)) on conflict (key) do update set value = excluded.value;
  return case when v = '' then 'removed' else 'ok' end;
end $$;

create or replace function public.brevo_key_status() returns boolean
language sql stable security definer set search_path = public as $$
  select case when not public.is_team() then null else coalesce(btrim(public.setting_text('brevo_api_key')), '') <> '' end
$$;

-- ─────────────── 3. Droits ───────────────
revoke all on function public.setting_write_ok(text, jsonb) from public, anon;
grant execute on function public.setting_write_ok(text, jsonb) to authenticated, service_role;
revoke all on function public.is_secret_setting(text) from public, anon;
grant execute on function public.is_secret_setting(text) to authenticated, service_role;
revoke all on function public.set_brevo_key(text) from public, anon, authenticated, service_role;
grant execute on function public.set_brevo_key(text) to authenticated;
revoke all on function public.brevo_key_status() from public, anon, authenticated, service_role;
grant execute on function public.brevo_key_status() to authenticated;

-- Retour arrière (rend aux comptes de l'équipe la lecture des secrets — à ne faire que si le relais est retiré) :
--   drop policy settings_team_read, settings_team_insert, settings_team_update, settings_team_delete on public.settings ;
--   create policy team_all on public.settings for all to authenticated using (is_team()) with check (is_team()) ;
--   drop function set_brevo_key(text), brevo_key_status(), setting_write_ok(text, jsonb), is_secret_setting(text).
