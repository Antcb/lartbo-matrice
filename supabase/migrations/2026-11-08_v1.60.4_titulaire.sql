-- v1.60.4 — adresse du script de la boîte anthony@ (prospect_script_url) modifiable par son TITULAIRE seulement
-- (décision d'Anthony du 08/11/2026 : reprise de la protection du lot messagerie, commit 9c6d61c, code copié à l'identique).
-- Le serveur (relais script-google) envoie à cette adresse les demandes signées au nom du titulaire : un autre compte de l'équipe
-- qui la remplacerait par son propre script les capterait. Lecture inchangée (toute l'équipe : la prospection continue).
-- Registre des titulaires dans le schéma privé, VIDE après cette migration (aucune adresse ici) : l'inscription est une étape séparée
-- (supabase/operations/2026-11-08_v1.60.4_inscription_titulaire.sql). Tant qu'il est vide, personne ne modifie l'adresse depuis
-- l'application. drive_webhook_url et les autres réglages : règles v1.47 inchangées.
-- Rejouable (create if not exists, create or replace, drop policy if exists) ; aucune donnée lue ni modifiée.

-- prérequis : règles d'écriture v1.47 (setting_write_ok, is_secret_setting), is_team, table settings
do $$ begin
  if to_regclass('public.settings') is null or to_regprocedure('public.setting_write_ok(text,jsonb)') is null
     or to_regprocedure('public.is_secret_setting(text)') is null or to_regprocedure('public.is_team()') is null
  then raise exception 'Migration v1.60.4 titulaire : prérequis absents (table settings, règles v1.47 setting_write_ok / is_secret_setting, is_team)'; end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ── Boîte anthony@ réservée au compte d'Anthony (décision du 08/11/2026) ─────────────────────────────────────────────────
-- Titulaire = le compte Google qui EXÉCUTE le script de la boîte (même règle que la v1.60.4 : Prospection.gs le vérifie lui-même,
-- identité signée par le relais avec la clé dédiée mailbox_sign_key). Ce registre en garde la copie côté base, pour ce que le script
-- ne peut pas contrôler. Schéma privé : ni l'application ni un compte ne peuvent le modifier ; AUCUNE adresse écrite ici — la ligne est
-- inscrite une fois, sur autorisation ; tant qu'elle manque, l'adresse du script de la boîte n'est modifiable par personne depuis
-- l'application.
create table if not exists private.mailbox_owners (mailbox text primary key, email text not null);
revoke all on private.mailbox_owners from public, anon, authenticated;
create or replace function public.is_mailbox_owner(p_mailbox text default 'anthony') returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.is_team() and exists (select 1 from private.mailbox_owners o
    where o.mailbox = coalesce(p_mailbox, 'anthony') and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_mailbox_owner(text) from public, anon;
grant execute on function public.is_mailbox_owner(text) to authenticated, service_role;

-- ── Adresse du script de la boîte (prospect_script_url) : modifiable par son TITULAIRE seulement (relecture de f95da56) ─────────
-- Le serveur envoie à cette adresse les demandes signées au nom du titulaire (relais, synchronisation) : un autre compte qui la
-- remplacerait par son propre script les capterait. Lecture inchangée (toute l'équipe : la prospection continue de l'utiliser) ;
-- écriture, remplacement et effacement réservés à is_mailbox_owner('anthony'). Registre des titulaires vide → personne depuis
-- l'application (changement par SQL seulement). drive_webhook_url et les autres réglages : règles v1.47 inchangées.
-- Fonction réécrite en entier (v1.47 + cette ligne) ; « stable » au lieu d'« immutable » car elle lit maintenant le registre.
create or replace function public.setting_write_ok(k text, v jsonb) returns boolean
language sql stable set search_path = public as $$
  select case
    when public.is_secret_setting(k) or k = 'functions_base_url' then false
    when k = 'prospect_script_url' and not public.is_mailbox_owner('anthony') then false
    when k in ('drive_webhook_url', 'prospect_script_url') then
      coalesce(btrim(v #>> '{}'), '') = '' or (v #>> '{}') ~ '^https://script\.google\.com/(a/macros/[A-Za-z0-9_.-]+|macros)/s/[A-Za-z0-9_-]+/exec$'
    else true end
$$;
revoke all on function public.setting_write_ok(text, jsonb) from public, anon;
grant execute on function public.setting_write_ok(text, jsonb) to authenticated, service_role;
-- modification et effacement : la ligne existante elle-même (USING), pas seulement la nouvelle valeur (WITH CHECK)
drop policy if exists settings_team_update on public.settings;
drop policy if exists settings_team_delete on public.settings;
create policy settings_team_update on public.settings for update to authenticated
  using (public.is_team() and not public.is_secret_setting(key) and key <> 'functions_base_url' and (key <> 'prospect_script_url' or public.is_mailbox_owner('anthony')))
  with check (public.is_team() and public.setting_write_ok(key, value));
create policy settings_team_delete on public.settings for delete to authenticated
  using (public.is_team() and not public.is_secret_setting(key) and key <> 'functions_base_url' and (key <> 'prospect_script_url' or public.is_mailbox_owner('anthony')));
-- (insertion : règle v1.47 settings_team_insert inchangée, elle passe déjà par setting_write_ok)

-- Retour arrière (sur décision) : rejouer la section 1 de 2026-10-27_v1.47_secrets.sql (setting_write_ok et les quatre règles v1.47) ;
-- le registre et is_mailbox_owner peuvent rester (sans effet).
