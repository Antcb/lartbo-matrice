-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- S0 — MISE À NIVEAU DU SCHÉMA DU PROJET SUPABASE DE TEST (dthfocplfzzmkgaxhmwk) SUR CELUI DE LA PRODUCTION
-- Préparé le 23/10/2026 à partir d'une lecture du catalogue des deux projets (aucune donnée métier lue en production).
-- NON EXÉCUTÉ. À soumettre à la relecture indépendante, puis à l'autorisation d'Anthony.
--
-- MODE D'EMPLOI
--   * EN UN SEUL ENVOI (outil Supabase execute_sql) ou psql -v ON_ERROR_STOP=1 -1 : la moindre erreur annule TOUT.
--   * Une seule transaction (begin … commit). Aucune instruction hors transaction.
--   * Ne crée, ne modifie et ne supprime AUCUNE ligne métier : aucun INSERT/UPDATE/DELETE sur public.* .
--     Seule écriture hors structure : le réglage de taille de l'espace de fichiers « suivi » (storage.buckets, 1 ligne de configuration).
--     Créer des déclencheurs ou des index ne déclenche rien sur les lignes existantes → aucun appel sortant (pg_net, Drive, Brevo).
--   * Ne touche NI public.is_team() NI private.comptes_suspendus (verrou S1, propre au test).
--   * Ne recopie aucun secret ni aucun réglage d'intégration (table settings non modifiée). Les 16 fonctions reprises de la
--     production ont été contrôlées : aucune clé, aucun jeton, aucune adresse, aucune référence au projet de production.
--     Leur texte est identique au caractère près à la production (empreinte md5 vérifiée, voir contrôles de fin).
--   * Exclus volontairement (voir ECARTS.md) : import Notion (private.n_*, notion_*, geo_fill), tâches techniques
--     (_koza*, _lartbotrice*, _folder_*, _push_table, _export_ddl*), pg_cron et la tâche « rappels-quotidiens »,
--     différences de structure de private.notion_cursor / private.notion_raw, droits d'exécution de is_team(), _exec.
--   * Rejouable : if not exists / create or replace ; un second passage ne change rien.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';
-- même chemin de recherche que la session de l'outil Supabase, pour que les empreintes de fin soient comparables à la production
set local search_path = "$user", public, extensions;

-- ── 0. GARDE-FOU : refuse de tourner ailleurs que sur le projet de test, dans l'état attendu ──────────────────
-- Conditions indépendantes, lues dans des sources différentes ; toutes fausses en production (vérifié en lecture le 23/10).
do $$ begin
  if coalesce((select value #>> '{}' from public.settings where key = 'functions_base_url'), '') not like '%dthfocplfzzmkgaxhmwk%' then
    raise exception 'Refus (1/6 réglage) : cette base n''est pas le projet de test'; end if;
  if not exists (select 1 from auth.users where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2') then
    raise exception 'Refus (2/6 comptes) : compte de la testeuse absent, ce n''est pas le projet de test'; end if;
  if to_regclass('private.comptes_suspendus') is null then
    raise exception 'Refus (3/6 suspension) : table de suspension absente, ce n''est pas le projet de test'; end if;
  -- volumes du jeu fictif (la production compte des milliers de structures et de contacts)
  if (select count(*) from public.projects) <> 4 or (select count(*) from public.structures) <> 15
     or (select count(*) from public.contacts) <> 25 or (select count(*) from public.shows) <> 30
     or (select count(*) from public.show_payments) <> 28 or (select count(*) from public.tasks) <> 20 then
    raise exception 'Refus (4/6 volumes) : la base ne contient pas le jeu fictif attendu (4/15/25/30/28/20)'; end if;
  -- intégrations neutralisées : brevo_queue (version production) ne fait rien tant que ces réglages sont vides
  if exists (select 1 from public.settings where key in ('brevo_api_key','brevo_hook_secret','brevo_list_id','drive_webhook_url',
             'drive_webhook_secret','prospect_script_url','rename_sheet_url') and coalesce(value #>> '{}', '') <> '') then
    raise exception 'Refus (5/6 intégrations) : une intégration est réglée dans le test, des appels réels seraient possibles'; end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Refus (6/6 tâches planifiées) : pg_cron est présent, à réanalyser'; end if;
end $$;

-- Garde-fou S1 (repris de r1/garde_synchro_suspension.sql, ADAPTÉ — voir ECARTS.md §4) :
--  * ce script ne remplace pas is_team() et ne touche pas la table de suspension ; il photographie le verrou ici et vérifie
--    à la fin qu'il est strictement inchangé ;
--  * il refuse de tourner si le verrou a disparu de is_team() ou si la suspension a été levée (décision d'Anthony, 24/10).
-- Décision d'Anthony (24/10/2026) : le script REFUSE de tourner si la suspension de sécurité a été levée, sous l'une
-- quelconque de ses trois formes (ligne de suspension, verrou dans is_team(), blocage de connexion du compte).
do $$ begin
  if to_regclass('private.comptes_suspendus') is not null and position('comptes_suspendus' in pg_get_functiondef('public.is_team()'::regprocedure)) = 0 then
    raise exception 'Refus (S1 verrou) : is_team() a perdu le verrou de suspension : vérifier avant toute synchronisation.';
  end if;
  if not exists (select 1 from private.comptes_suspendus where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2') then
    raise exception 'Refus (S1 suspension) : la suspension de la testeuse a été levée : la synchronisation est interdite dans cet état.';
  end if;
  if not exists (select 1 from auth.users where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2' and banned_until > now()) then
    raise exception 'Refus (S1 blocage) : le blocage de connexion de la testeuse est levé ou expiré : la synchronisation est interdite dans cet état.';
  end if;
end $$;

-- photographie « avant » (table temporaire, détruite au commit)
create temp table _sync_avant on commit drop as
select md5(pg_get_functiondef('public.is_team()'::regprocedure)) is_team_def,
       (select proacl::text from pg_proc where oid = 'public.is_team()'::regprocedure) is_team_acl,
       (select count(*) from private.comptes_suspendus) susp_n,
       (select md5(coalesce(string_agg(email || '|' || motif || '|' || suspendu_le::text, ',' order by email), '')) from private.comptes_suspendus) susp_h,
       (select count(*) from public.app_users) app_users_n,
       (select count(*) from public.budget_lines) budget_n,
       (select count(*) from public.notifications) notif_n,
       (select count(*) from net.http_request_queue) netq_n,
       (select md5(string_agg(key || '=' || value::text, ',' order by key)) from public.settings) settings_h;

-- ── 1. Colonne manquante (migration v1.36) ──────────────────────────────────────────────────────────────────
-- ajoutée en dernière position, comme en production (colonne n° 71). Valeur false pour les 30 dates fictives ;
-- les mises à jour de données de v1.36 ne sont pas reprises : 0 date du jeu fictif n'a un mode différent de son artiste (vérifié).
alter table public.shows add column if not exists prod_mode_manual boolean not null default false;

-- ── 2. Fonctions : texte identique à la production (16) ──────────────────────────────────────────────────────
-- 2a. absentes du test (10) : nettoyage contacts / structures, modes Booking-Production, paiements de production, jours ouvrés
CREATE OR REPLACE FUNCTION public.clean_email(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(t,''), '[\s​-‏‪-‮⁠﻿]', '', 'g')), '\(.*\)$', ''), '\.$', ''), '')
$function$;
CREATE OR REPLACE FUNCTION public.clean_phone(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(btrim(regexp_replace(coalesce(t,''), '[​-‏‪-‮⁠﻿]', '', 'g')), '')
$function$;
CREATE OR REPLACE FUNCTION public.contacts_clean()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare raw text; c text; i int;
begin
  new.phone := clean_phone(new.phone); new.phone_2 := clean_phone(new.phone_2);
  for i in 1..2 loop
    raw := case i when 1 then new.email else new.email_2 end;
    c := clean_email(raw);
    if c is not null and c !~ '^[^@]+@[^@]+\.[a-z]{2,}$' then
      if c ~ '^\+?[0-9]{8,15}$' then
        if new.phone is null then new.phone := clean_phone(raw);
        elsif new.phone_2 is null then new.phone_2 := clean_phone(raw);
        else new.notes := concat_ws(E'\n', new.notes, 'Autre numéro : ' || clean_phone(raw)); end if;
      else
        new.notes := concat_ws(E'\n', new.notes, 'Contact : ' || btrim(raw));
      end if;
      c := null;
    end if;
    if i = 1 then new.email := c; else new.email_2 := c; end if;
  end loop;
  if new.email is null and new.email_2 is not null then new.email := new.email_2; new.email_2 := null; end if;
  if new.email_2 = new.email then new.email_2 := null; end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.structures_place_clean()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- hors de France : pas de département français
  if new.country is not null and new.country !~* '^\s*france\s*$' then new.department_code := null; new.department_name := null; end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.workday(d date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case extract(isodow from d) when 6 then d + 2 when 7 then d + 1 else d end
$function$;
CREATE OR REPLACE FUNCTION public.ensure_movinmotion(p_show uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.budget_lines (project_id, show_id, category, label, supplier, auto, payer, sort)
  select s.project_id, s.id, 'Movinmotion', 'Commission bulletins de paie', 'Movinmotion', 'movinmotion', 'compte',
         coalesce((select max(sort) from public.budget_lines b where b.show_id = s.id), 0) + 1
    from public.shows s
   where s.id = p_show and coalesce(s.prod_mode, 'production') <> 'booking'
     and exists (select 1 from public.budget_lines b where b.show_id = s.id and b.category = 'Staff')
  on conflict (show_id, auto) where auto in ('movinmotion', 'cnm') and show_id is not null do nothing;
end $function$;
CREATE OR REPLACE FUNCTION public.ensure_production_payments(p_show uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ac numeric := coalesce(setting_num('default_acompte_pct'), 50); s record; has_ac boolean; has_so boolean; sum_ac numeric; mx int;
begin
  select * into s from shows where id = p_show;
  if s is null or coalesce(s.prod_mode, 'production') = 'booking' or s.status not in ('Confirmée Salle','Confirmée Festival') then return; end if;
  perform pg_advisory_xact_lock(hashtext('pay:' || p_show));
  select coalesce(max(sort), 0) into mx from show_payments where show_id = p_show;
  has_ac := exists (select 1 from show_payments where show_id = p_show and kind = 'acompte');
  has_so := exists (select 1 from show_payments where show_id = p_show and kind = 'solde');
  -- rien de prévu : acompte par défaut + solde ; un solde déjà là sans acompte = choix « sans acompte », gardé tel quel
  if not has_ac and not has_so then
    insert into show_payments (show_id, kind, label, pct, sort, payee) values
      (p_show, 'acompte', 'Acompte', ac, mx + 1, 'compte'), (p_show, 'solde', 'Solde', greatest(0, 100 - ac), mx + 2, 'compte');
  elsif not has_so then
    select coalesce(sum(pct), 0) into sum_ac from show_payments where show_id = p_show and kind = 'acompte';
    insert into show_payments (show_id, kind, label, pct, sort, payee) values (p_show, 'solde', 'Solde', greatest(0, 100 - sum_ac), mx + 1, 'compte');
  end if;
end $function$;
CREATE OR REPLACE FUNCTION public.project_mode_to_shows()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows set prod_mode = new.mode where project_id = new.id and not prod_mode_manual;
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.show_follow_project_mode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.show_mode_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.prod_mode, 'production') <> 'booking' and coalesce(old.prod_mode, 'production') = 'booking' then
    perform ensure_production_payments(new.id);
  end if;
  return new;
end $function$;
-- 2b. différentes dans le test (6)
-- generate_reminders : version production (rappels décalés au jour ouvré, colonnes raw / w)
CREATE OR REPLACE FUNCTION public.generate_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
      sh.conf_kit_sent, sh.precontract_done, sh.contract_sent, sh.contract_signed, sh.contract_cosigned_sent, sh.boucle_tech, sh.boucle_com,
      a.id a_id, a.sent_at a_sent, a.paid_at a_paid, greatest(a.sent_at, a.reminded_at) a_last,
      so.id so_id, so.sent_at so_sent, so.paid_at so_paid, greatest(so.sent_at, so.reminded_at) so_last,
      c.id c_id, c.sent_at c_sent, c.paid_at c_paid, c.label c_label,
      pt.id pt_id, pt.sent_at pt_sent, pt.paid_at pt_paid, pt.label pt_label
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival') and (sh.date is null or sh.date >= current_date - 120)
  ), cand as (
    select 'precontrat' r, id, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_envoi', id, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_signe', id, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= current_date)
    union all select 'contrat_cosigne', id, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= current_date)
    union all select 'facture_acompte', id, contract_sent, false, 'Facture d''acompte à envoyer (contrat envoyé)' from s where mode <> 'booking' and contract_sent is not null and a_id is not null and a_sent is null
    union all select 'acompte_paye', id, a_last + 10, true, 'Paiement de l''acompte à vérifier' from s where mode <> 'booking' and a_sent is not null and a_paid is null
    union all select 'solde_paye', id, so_last + 10, true, 'Paiement du solde à vérifier' from s where mode <> 'booking' and so_sent is not null and so_paid is null
    union all select 'solde_envoi', id, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Envoyer la facture de solde' from s where mode <> 'booking' and date is not null and so_id is not null and so_sent is null and date >= current_date - 30
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_paid is null
    union all select 'commission_partenaire', id, least(a_paid, so_paid) + 10, true, coalesce(pt_label,'Commission partenaire') || ' : facture à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= current_date)
    union all select 'boucle_com', id, contract_cosigned_sent, false, 'Boucle communication à envoyer (contrat co-signé)' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= current_date)
    union all select 'booking_commission', id, contract_cosigned_sent, false, 'Envoyer la facture de commission à l''artiste' from s where mode = 'booking' and contract_cosigned_sent is not null and c_id is not null and c_sent is null
    union all select 'booking_commission_payee', id, c_sent + 10, true, 'Paiement de la commission à vérifier' from s where mode = 'booking' and c_sent is not null and c_paid is null
  ), ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || s.venue,
           concat_ws(' · ', nullif(s.proj,''), to_char(s.date, 'DD/MM/YYYY'), s.city),
           s.id, c.r || ':' || s.id || ':' || c.raw
    from cand c join s on s.id = c.id
    where c.raw is not null and (case when c.w then public.workday(c.raw) else c.raw end) <= current_date
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;
-- artist_info_save : seule différence, une ligne de commentaire
CREATE OR REPLACE FUNCTION public.artist_info_save(p_project uuid, p_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old jsonb; v_diff jsonb;
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe'; end if;
  if length(coalesce(p_info::text, '')) > 60000 then raise exception 'Fiche trop longue'; end if;
  select coalesce(artist_info, '{}') into v_old from projects where id = p_project for update;
  update projects set artist_info = coalesce(p_info, '{}') where id = p_project;
  -- seulement ce qui vient d'être modifié (une correction faite entre-temps dans Administratif / Membres n'est pas écrasée)
  v_diff := coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_info, '{}')) e
      where e.key like 'adm\_%' and e.value is distinct from v_old->e.key), '{}')
    || jsonb_build_object('members', (select coalesce(jsonb_agg(m), '[]') from jsonb_array_elements(case when jsonb_typeof(p_info->'members') = 'array' then p_info->'members' else '[]' end) m
      where not (case when jsonb_typeof(v_old->'members') = 'array' then v_old->'members' else '[]' end) @> jsonb_build_array(m)));
  perform public.artist_sync(p_project, v_diff, true);
  return jsonb_build_object('ok', true);
end $function$;
-- brevo_queue, pennylane_status, set_pennylane_key : remplacement EXPLICITE des coquilles vides du test (décision d'audit S0 §4.1).
-- Neutralité : brevo_queue sort immédiatement si brevo_api_key est vide (contrôlé au garde-fou et en fin) ; aucune fonction
-- serveur n'existe dans le test ; le coffre private.import_secrets du test est vide.
CREATE OR REPLACE FUNCTION public.brevo_queue(p_contact uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.pennylane_status()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select case when not is_team() then null else exists(select 1 from private.import_secrets where key='pennylane_token') end
$function$;
CREATE OR REPLACE FUNCTION public.set_pennylane_key(k text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v text := trim(coalesce(k, ''));
begin
  if not is_team() then raise exception 'Accès refusé'; end if;
  if v = '' then delete from private.import_secrets where key = 'pennylane_token'; return 'removed'; end if;
  if length(v) < 20 or v ~ '\s' then raise exception 'Ce n’est pas un jeton API Pennylane (copie seulement le jeton, sans espace)'; end if;
  insert into private.import_secrets(key, value) values ('pennylane_token', v) on conflict (key) do update set value = excluded.value;
  return 'ok';
end $function$;
-- _push : version NEUTRALISÉE de la production (« désactivé »). Remplace la version du test qui contenait une phrase
-- secrète en clair et était appelable par un visiteur anonyme (risque R4). L'ancienne version n'est pas conservée.
CREATE OR REPLACE FUNCTION public._push(q text)
 RETURNS text
 LANGUAGE sql
AS $function$ select 'désactivé'::text $function$;

-- ── 3. Déclencheurs absents du test (5) ───────────────────────────────────────────────────────────────────
-- Créés seulement : n'agissent que sur les écritures FUTURES (aucune ligne existante n'est relue ni modifiée).
create or replace trigger contacts_clean before insert or update of email, email_2, phone, phone_2 on public.contacts
  for each row execute function public.contacts_clean();
create or replace trigger structures_place_clean before insert or update on public.structures
  for each row execute function public.structures_place_clean();
create or replace trigger project_mode_to_shows after update of mode on public.projects
  for each row execute function public.project_mode_to_shows();
create or replace trigger show_follow_project_mode before update of project_id on public.shows
  for each row execute function public.show_follow_project_mode();
create or replace trigger show_mode_payments after update of prod_mode on public.shows
  for each row execute function public.show_mode_payments();

-- ── 4. Index absents du test (3) ──────────────────────────────────────────────────────────────────────────
-- budget_lines_one_auto empêche les doublons de lignes automatiques (utilisé par ensure_movinmotion) ; 0 doublon dans le test (vérifié).
create index if not exists budget_lines_project on public.budget_lines using btree (project_id);
create index if not exists budget_lines_show on public.budget_lines using btree (show_id);
create unique index if not exists budget_lines_one_auto on public.budget_lines using btree (show_id, auto)
  where ((auto = any (array['movinmotion'::text, 'cnm'::text])) and (show_id is not null));

-- ── 5. Table client_errors (journal de diagnostic du site, migration v1.26) ─────────────────────────────────
-- table VIDE ; aucune donnée de la production n'est copiée. Hors publication temps réel (comme en production).
create table if not exists public.client_errors (
  id bigint generated always as identity primary key, created_at timestamptz default now(),
  user_email text, version text, view text, message text, stack text, ua text);
alter table public.client_errors enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_errors' and policyname = 'insert own errors') then
    create policy "insert own errors" on public.client_errors as permissive for insert to authenticated with check (true);
  end if;
end $$;
-- droits identiques à la production (toutes les tables publiques ont ces droits ; l'accès réel est filtré par RLS)
grant all on table public.client_errors to anon, authenticated, service_role;
grant all on sequence public.client_errors_id_seq to anon, authenticated, service_role;

-- ── 6. Coffre : même contrainte qu'en production (table vide dans le test) ──────────────────────────────────
alter table private.import_secrets alter column value set not null;

-- ── 7. Droits d'exécution des fonctions : alignés sur la production ──────────────────────────────────────────
-- (risque R3 : fonctions sensibles appelables par un visiteur anonyme dans le test). is_team() N'EST PAS modifiée (voir ECARTS.md).
-- 7a. ouvertes à tous, comme en production (fonctions de calcul et de déclencheur)
revoke all on function public.clean_email(text), public.clean_phone(text), public.contacts_clean(), public.ensure_movinmotion(uuid),
  public.project_mode_to_shows(), public.show_follow_project_mode(), public.structures_place_clean(), public.workday(date)
  from public, anon, authenticated, service_role;
grant execute on function public.clean_email(text), public.clean_phone(text), public.contacts_clean(), public.ensure_movinmotion(uuid),
  public.project_mode_to_shows(), public.show_follow_project_mode(), public.structures_place_clean(), public.workday(date)
  to public, anon, authenticated, service_role;
-- 7b. serveur uniquement (service_role)
revoke all on function public.ensure_production_payments(uuid), public.show_mode_payments(), public.generate_reminders(),
  public.brevo_queue(uuid), public._push(text), public.import_secret(text), public.on_show_confirmed()
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_production_payments(uuid), public.show_mode_payments(), public.generate_reminders(),
  public.brevo_queue(uuid), public._push(text), public.import_secret(text), public.on_show_confirmed()
  to service_role;
-- 7c. équipe connectée (authenticated) + serveur
revoke all on function public.artist_info_save(uuid, jsonb), public.pennylane_status(), public.set_pennylane_key(text),
  public.ai_key_status(), public.mail_vars(uuid, uuid), public.request_drive_folder(uuid), public.set_ai_key(text)
  from public, anon, authenticated, service_role;
grant execute on function public.artist_info_save(uuid, jsonb), public.pennylane_status(), public.set_pennylane_key(text),
  public.ai_key_status(), public.mail_vars(uuid, uuid), public.request_drive_folder(uuid), public.set_ai_key(text)
  to authenticated, service_role;
-- 7d. pages publiques à jeton : visiteur anonyme + connectés + serveur (mais plus « public »)
revoke all on function public.fiche_get(text), public.fiche_submit(text, jsonb, jsonb), public.rh_get(text),
  public.rh_submit(text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fiche_get(text), public.fiche_submit(text, jsonb, jsonb), public.rh_get(text),
  public.rh_submit(text, jsonb, jsonb, jsonb)
  to anon, authenticated, service_role;

-- ── 8. Espace de fichiers « suivi » : même limite de taille qu'en production (50 Mo) ─────────────────────────
-- (les protections de storage.buckets ne portent que sur les colonnes de cycle de vie, non touchées ici)
update storage.buckets set file_size_limit = 52428800 where id = 'suivi' and file_size_limit is distinct from 52428800;

-- ── 9. CONTRÔLES DE FIN : un seul écart → exception → tout est annulé ────────────────────────────────────────
do $$
declare a record; v text; e text; f record; n int;
begin
  select * into a from _sync_avant;

  -- 9.1 verrou S1 strictement inchangé
  if md5(pg_get_functiondef('public.is_team()'::regprocedure)) <> a.is_team_def
     or position('comptes_suspendus' in pg_get_functiondef('public.is_team()'::regprocedure)) = 0 then
    raise exception 'Contrôle S1 : is_team() a été modifiée'; end if;
  if (select proacl::text from pg_proc where oid = 'public.is_team()'::regprocedure) is distinct from a.is_team_acl then
    raise exception 'Contrôle S1 : droits de is_team() modifiés'; end if;
  if (select count(*) from private.comptes_suspendus) <> a.susp_n or a.susp_n < 1
     or (select md5(coalesce(string_agg(email || '|' || motif || '|' || suspendu_le::text, ',' order by email), '')) from private.comptes_suspendus) <> a.susp_h then
    raise exception 'Contrôle S1 : table de suspension modifiée ou vide'; end if;
  -- simulation de session (dans la transaction ; aucune adresse n'est affichée) : testeuse refusée, équipe acceptée
  select email into e from private.comptes_suspendus where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2';
  if e is null then raise exception 'Contrôle S1 : la testeuse n''est plus suspendue'; end if;
  perform set_config('request.jwt.claims', json_build_object('email', e, 'role', 'authenticated')::text, true);
  if public.is_team() then raise exception 'Contrôle S1 : is_team() renvoie vrai pour la testeuse suspendue'; end if;
  select email into e from public.app_users where email not in (select email from private.comptes_suspendus) order by email limit 1;
  if e is not null then
    perform set_config('request.jwt.claims', json_build_object('email', e, 'role', 'authenticated')::text, true);
    if not public.is_team() then raise exception 'Contrôle S1 : un membre de l''équipe non suspendu est refusé'; end if;
  end if;
  perform set_config('request.jwt.claims', '', true);
  -- verrou « connexion » (auth.users.banned_until) : hors périmètre du script, simple avertissement
  if not exists (select 1 from auth.users where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2' and banned_until > now()) then
    raise warning 'Avertissement S1 : le blocage de connexion de la testeuse n''est plus actif (non modifié par ce script)'; end if;

  -- 9.2 aucune donnée métier ni réglage modifié, aucun appel sortant mis en file
  if (select count(*) from public.projects) <> 4 or (select count(*) from public.structures) <> 15
     or (select count(*) from public.contacts) <> 25 or (select count(*) from public.shows) <> 30
     or (select count(*) from public.show_payments) <> 28 or (select count(*) from public.tasks) <> 20 then
    raise exception 'Contrôle volumes : le jeu fictif a changé (attendu 4/15/25/30/28/20)'; end if;
  if (select count(*) from public.app_users) <> a.app_users_n or (select count(*) from public.budget_lines) <> a.budget_n
     or (select count(*) from public.notifications) <> a.notif_n then
    raise exception 'Contrôle volumes : équipe, budgets ou notifications modifiés'; end if;
  if (select count(*) from net.http_request_queue) <> a.netq_n then
    raise exception 'Contrôle appels sortants : la file pg_net a changé'; end if;
  if (select md5(string_agg(key || '=' || value::text, ',' order by key)) from public.settings) <> a.settings_h then
    raise exception 'Contrôle réglages : la table settings a changé'; end if;
  if exists (select 1 from public.shows where prod_mode_manual) then
    raise exception 'Contrôle prod_mode_manual : valeur inattendue'; end if;
  if exists (select 1 from public.client_errors) then raise exception 'Contrôle client_errors : la table doit être vide'; end if;

  -- 9.3 fonctions reprises : texte identique à la production (md5 de pg_get_functiondef relevé en production le 23/10)
  for f in select * from (values
      ('public._push(text)', 'b42db77eb416dcc0a25c7aba3aba13ff'),
      ('public.artist_info_save(uuid,jsonb)', '2ab5272f6a1b730f429d3e7a2305a069'),
      ('public.brevo_queue(uuid)', 'c2175943d69915ec0e6f55abd5b552cd'),
      ('public.clean_email(text)', 'bda38a3c4bf2cd73c349235382f7419e'),
      ('public.clean_phone(text)', '3e151d85eb4f3d68695a3e32324e5d95'),
      ('public.contacts_clean()', 'ed47a3e7226c6bb9b4195b46116aa86f'),
      ('public.ensure_movinmotion(uuid)', '45c92e91dc6c39308f311a15911efeeb'),
      ('public.ensure_production_payments(uuid)', 'd55c81ebb5ef14b26aacf6de07681fb7'),
      ('public.generate_reminders()', 'a0eb76e247d25a6f282dcbfcba35510e'),
      ('public.pennylane_status()', 'b0cf7b3c2724f59257c97507bb87d496'),
      ('public.project_mode_to_shows()', 'ee8fe413cc80f7d5583da97d5847f615'),
      ('public.set_pennylane_key(text)', 'b6cf1e04a479cdb34e91164b8981ed15'),
      ('public.show_follow_project_mode()', 'c3a835cb29b80e36c7db36a21cc8c2a2'),
      ('public.show_mode_payments()', 'a16ec61093c761e46c37791edb355caf'),
      ('public.structures_place_clean()', '442ac0d261adf7a7a5bf89ea36dab250'),
      ('public.workday(date)', '61d070002fe2615f9bf2cd403d6a5ca1')) t(sig, h)
  loop
    if md5(pg_get_functiondef(f.sig::regprocedure)) <> f.h then raise exception 'Contrôle fonction : % diffère de la production', f.sig; end if;
    if (select pg_get_userbyid(proowner) from pg_proc where oid = f.sig::regprocedure) <> 'postgres' then
      raise exception 'Contrôle fonction : % n''appartient pas à postgres', f.sig; end if;
  end loop;

  -- 9.4 droits d'exécution identiques à la production (anon / authenticated / service_role / public)
  for f in select * from (values
      ('public.clean_email(text)', 'anon,authenticated,public,service_role'), ('public.clean_phone(text)', 'anon,authenticated,public,service_role'),
      ('public.contacts_clean()', 'anon,authenticated,public,service_role'), ('public.ensure_movinmotion(uuid)', 'anon,authenticated,public,service_role'),
      ('public.project_mode_to_shows()', 'anon,authenticated,public,service_role'), ('public.show_follow_project_mode()', 'anon,authenticated,public,service_role'),
      ('public.structures_place_clean()', 'anon,authenticated,public,service_role'), ('public.workday(date)', 'anon,authenticated,public,service_role'),
      ('public.ensure_production_payments(uuid)', 'service_role'), ('public.show_mode_payments()', 'service_role'),
      ('public.generate_reminders()', 'service_role'), ('public.brevo_queue(uuid)', 'service_role'), ('public._push(text)', 'service_role'),
      ('public.import_secret(text)', 'service_role'), ('public.on_show_confirmed()', 'service_role'),
      ('public.artist_info_save(uuid,jsonb)', 'authenticated,service_role'), ('public.pennylane_status()', 'authenticated,service_role'),
      ('public.set_pennylane_key(text)', 'authenticated,service_role'), ('public.ai_key_status()', 'authenticated,service_role'),
      ('public.mail_vars(uuid,uuid)', 'authenticated,service_role'), ('public.request_drive_folder(uuid)', 'authenticated,service_role'),
      ('public.set_ai_key(text)', 'authenticated,service_role'),
      ('public.fiche_get(text)', 'anon,authenticated,service_role'), ('public.fiche_submit(text,jsonb,jsonb)', 'anon,authenticated,service_role'),
      ('public.rh_get(text)', 'anon,authenticated,service_role'), ('public.rh_submit(text,jsonb,jsonb,jsonb)', 'anon,authenticated,service_role')) t(sig, ex)
  loop
    select string_agg(g, ',' order by g) into v from (
      select case when x.grantee = 0 then 'public' else x.grantee::regrole::text end g
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
       where p.oid = f.sig::regprocedure and x.privilege_type = 'EXECUTE'
         and (x.grantee = 0 or x.grantee::regrole::text in ('anon','authenticated','service_role'))) z;
    if v is distinct from f.ex then raise exception 'Contrôle droits : % a « % » au lieu de « % »', f.sig, v, f.ex; end if;
  end loop;

  -- 9.5 empreintes de structure (même calcul que b1/per_ord.sql) : identiques à la production relevée le 23/10
  --     section 2 séquences, 6 index, 10 DÉCLENCHEURS, 12 règles d'accès, 18 espaces de fichiers
  for f in
    with ns as (select oid from pg_namespace where nspname in ('public','private')),
    tbl as (select c.oid from pg_class c where c.relnamespace in (select oid from ns) and c.relkind in ('r','p')),
    s as (
      select 2 ord, format('create sequence if not exists %I.%I;', c.relnamespace::regnamespace::text, c.relname) stmt
        from pg_class c where c.relnamespace in (select oid from ns) and c.relkind = 'S'
      union all select 6, pg_get_indexdef(i.indexrelid) || ';'
        from pg_index i join tbl t on t.oid = i.indrelid where not exists (select 1 from pg_constraint o where o.conindid = i.indexrelid)
      union all select 10, pg_get_triggerdef(g.oid) || ';'
        from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
       where not g.tgisinternal and p.pronamespace in (select oid from ns)
      union all select 12, format('create policy %I on %I.%I as %s for %s to %s%s%s;', p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
             array_to_string(p.roles, ', '), coalesce(' using (' || p.qual || ')', ''), coalesce(' with check (' || p.with_check || ')', ''))
        from pg_policies p where p.schemaname in ('public','private','storage')
      union all select 18, format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %s, %s, %s) on conflict (id) do nothing;',
             id, name, public, coalesce(file_size_limit::text, 'null'), coalesce(quote_literal(allowed_mime_types::text) || '::text[]', 'null'))
        from storage.buckets)
    select e.ord, e.n_att, e.h_att, coalesce(g.n, 0) n, g.h from (values
        (2, 1, '12a55cab86c17bb919d867d8652fd9dc'), (6, 20, '6b2dee814357536f738e52495d05a994'),
        (10, 15, '12e6097f2799001f41d61504bd05c8a2'), (12, 27, 'e5e195091d66cb7701b196d399aed645'),
        (18, 3, '0da93d34720d71beb87a22097f924fca')) e(ord, n_att, h_att)
    left join (select ord, count(*) n, md5(string_agg(md5(stmt), ',' order by md5(stmt))) h from s group by ord) g on g.ord = e.ord
  loop
    if f.n <> f.n_att or f.h is distinct from f.h_att then
      raise exception 'Contrôle empreinte section % : % objets / % (attendu % / %)', f.ord, f.n, f.h, f.n_att, f.h_att; end if;
  end loop;

  raise notice 'Synchronisation du test OK : verrou S1 intact, jeu fictif inchangé, 16 fonctions, 5 déclencheurs, 3 index, client_errors, droits alignés';
end $$;

commit;
