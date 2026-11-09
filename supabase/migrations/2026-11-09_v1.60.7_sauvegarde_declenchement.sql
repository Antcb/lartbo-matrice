-- =====================================================================================================
-- Sauvegardes : déclenchement au démarrage RÉEL du workflow (décision d'Anthony du 09/11/2026).
-- « Prépare hors production une correction durable des déclenchements tardifs, sans laisser la connexion ouverte jusqu'à 13 h.
--   Le démarrage effectif, la fermeture, l'absence de concurrence et l'alerte en cas d'échec doivent être coordonnés. Les sauvegardes
--   doivent couvrir l'état V1.60.5 et les nouveaux éléments privés sans exposer leurs secrets. »
--
-- Constat : GitHub a lancé les planifications du 08/11 avec environ 6 h de retard (07:54 et 09:01 UTC) ; la copie complète a échoué
-- car la fenêtre de connexion fixe (01:30–04:30 UTC, outils/fenetre_connexion.sql du dépôt lartbo-matrice-backup) était refermée.
-- Le 09/11, la relance manuelle a échoué sur « permission denied for table mailbox_owners » (table privée v1.60.4 non lisible par
-- le rôle de sauvegarde).
--
-- Ce que fait cette migration (aucune donnée métier lue ni modifiée ; la fenêtre fixe actuelle reste EN SERVICE tant que
-- l'activation n'est pas faite : supabase/operations/2026-11-09_sauvegarde_activation.sql) :
--  1. private.sauvegarde_executions : une ligne par exécution (copie complète ou export JSON) — démarrage réel, fin, statut.
--     Sert de VERROU (une seule exécution en cours par type, index unique) et de preuve de réussite (contrôle d'absence).
--  2. private.sauvegarde_demarrer / _fermer / _terminer : appelées par la fonction serveur « sauvegarde-fenetre » (secret dédié)
--     au début et à la fin du workflow. Pour la copie complète, le démarrage ouvre la connexion du rôle « sauvegarde » pour
--     45 min AU PLUS, la fin la referme (succès comme échec) — seulement si c'est bien l'exécution qui tient la fenêtre
--     (colonne private.sauvegarde_fenetre.tenue_par). Fermeture de secours : la tâche « sauvegarde-interruption » (toutes les
--     15 min) referme dès l'échéance passée ⇒ 45 min + 15 min = connexion ouverte 1 h au plus, même si le workflow ne rappelle
--     jamais. Au plus 6 démarrages par type et par jour (UTC) : au-delà, refus « limite ».
--  3. private.sauvegarde_interrompre : réécrite à l'identique (dépôt de sauvegarde, outils/fenetre_connexion.sql) + libération des
--     verrous périmés (exécution « en cours » depuis plus de 3 h ⇒ « abandon »).
--  4. private.sauvegarde_controler + tâche « sauvegarde-controle » (13:07 UTC) : si aucune sauvegarde (complète ou JSON) n'a
--     réussi depuis 00:00 UTC, notification dans l'application (table notifications, comme les rappels) — reprise dans le récap
--     mail du matin (script Google dailyJob). Rien tant qu'aucune exécution n'a été enregistrée (mise en service progressive).
--  5. Tables du schéma privé : chaque table est CLASSÉE (règle durable, contrôlée par tests/static/sauvegarde-declenchement.mjs) :
--       - copiée par la sauvegarde complète : lecture accordée au rôle « sauvegarde » (mailbox_owners, notion_raw, notion_cursor,
--         sauvegarde_executions) ;
--       - exclue (contient des secrets) : import_secrets — seule la PRÉSENCE est copiée (nom + empreinte SHA-256 tronquée, jamais la
--         valeur), par private.sauvegarde_secrets_presence(), dans l'archive CHIFFRÉE seulement.
--     Aucun droit par défaut sur le schéma privé : une nouvelle table privée n'est jamais copiée sans décision ; la copie l'exclut
--     et lève une ALERTE (dépôt de sauvegarde, outils/copie_complete.sh) au lieu d'échouer.
--  6. Secret dédié « sauvegarde_declenchement_secret » tiré au hasard dans private.import_secrets (jamais régénéré).
--
-- Prérequis : rôle « sauvegarde » et fenêtre (dépôt lartbo-matrice-backup : outils/role_sauvegarde.sql puis
-- outils/fenetre_connexion.sql), table notifications, coffre private.import_secrets. Rejouable (if not exists, create or replace,
-- on conflict do nothing, cron.schedule par nom). Retour arrière : supabase/retours-arriere/2026-11-09_v1.60.7_sauvegarde_declenchement.sql.
-- =====================================================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sauvegarde') or to_regclass('private.sauvegarde_fenetre') is null
     or to_regprocedure('private.sauvegarde_interrompre()') is null then
    raise exception 'Migration sauvegarde_declenchement : prérequis absents (rôle sauvegarde et fenêtre de connexion : dépôt lartbo-matrice-backup, outils/role_sauvegarde.sql puis outils/fenetre_connexion.sql)';
  end if;
  if to_regclass('public.notifications') is null or to_regclass('private.import_secrets') is null then
    raise exception 'Migration sauvegarde_declenchement : prérequis absents (table notifications, coffre private.import_secrets)';
  end if;
end $$;

-- ── 1. Exécutions (verrou + preuve de réussite) ─────────────────────────────────────────────────────────────────────────────
create table if not exists private.sauvegarde_executions (
  id bigint generated always as identity primary key,
  type text not null check (type in ('complete', 'json')),
  jour date not null,                                    -- jour (UTC) du démarrage réel
  run_id text not null check (run_id ~ '^[0-9]{1,20}$'), -- identifiant de l'exécution GitHub
  tentative integer not null default 1 check (tentative between 1 and 100),
  origine text not null check (origine in ('schedule', 'workflow_dispatch')),
  debut timestamptz not null default now(),
  fenetre_jusqu_a timestamptz,                           -- copie complète : échéance de la connexion ouverte pour elle
  fin timestamptz,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'succes', 'echec', 'abandon')),
  detail text check (char_length(detail) <= 300)
);
create unique index if not exists sauvegarde_executions_une_en_cours on private.sauvegarde_executions (type) where statut = 'en_cours';
create unique index if not exists sauvegarde_executions_run on private.sauvegarde_executions (type, run_id, tentative);
-- exécution qui tient la fenêtre exceptionnelle ouverte (null : aucune, ou ouverture manuelle par sauvegarde_ouvrir)
alter table private.sauvegarde_fenetre add column if not exists tenue_par bigint;
revoke all on private.sauvegarde_executions from public, anon, authenticated, service_role;
grant select on private.sauvegarde_executions to sauvegarde;   -- copiée par la sauvegarde complète (aucun secret)
grant select on sequence private.sauvegarde_executions_id_seq to sauvegarde;   -- pg_dump lit aussi la séquence d'identité

-- ── 2. Démarrage, fermeture, fin ────────────────────────────────────────────────────────────────────────────────────────────
-- Démarrage réel : verrou par type ; « deja_faite » si une exécution du même type a déjà réussi aujourd'hui (UTC) et que ce n'est
-- pas une relance manuelle ; « occupee » si une autre exécution du même type est en cours. Appel répété par la même exécution
-- (nouvel essai réseau) : même ligne renvoyée, sans en créer une autre, et sans rouvrir une fenêtre déjà refermée. Copie complète :
-- connexion ouverte pour la durée demandée, 45 min par défaut ET au plus (la fermeture de secours passe dans les 15 min suivantes).
-- Au plus 6 démarrages par type et par jour (UTC) : au-delà, « limite » (aucune ouverture).
create or replace function private.sauvegarde_demarrer(p_type text, p_run_id text, p_tentative integer, p_origine text,
                                                       p_forcer boolean default false, p_duree interval default interval '45 minutes')
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare e record; v_id bigint; v_jusqu timestamptz; v_jour date := (now() at time zone 'UTC')::date;
begin
  if p_type is null or p_type not in ('complete', 'json') then raise exception 'type de sauvegarde inconnu'; end if;
  if p_origine is null or p_origine not in ('schedule', 'workflow_dispatch') then raise exception 'origine inconnue'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sauvegarde_demarrer:' || p_type));
  v_jusqu := now() + least(greatest(coalesce(p_duree, interval '45 minutes'), interval '5 minutes'), interval '45 minutes');

  select * into e from private.sauvegarde_executions x where x.type = p_type and x.run_id = p_run_id and x.tentative = p_tentative;
  if found then
    if e.statut <> 'en_cours' then
      return jsonb_build_object('etat', 'terminee', 'id', e.id, 'statut', e.statut);
    end if;
    v_id := e.id;   -- même exécution qui rappelle : la fenêtre n'est PAS prolongée au-delà de son échéance d'origine
    v_jusqu := e.fenetre_jusqu_a;
  else
    update private.sauvegarde_executions set statut = 'abandon', fin = now(), detail = 'verrou périmé (plus de 3 h)'
     where type = p_type and statut = 'en_cours' and debut < now() - interval '3 hours';
    select * into e from private.sauvegarde_executions x where x.type = p_type and x.statut = 'en_cours';
    if found then
      return jsonb_build_object('etat', 'occupee', 'id_en_cours', e.id, 'depuis', e.debut);
    end if;
    if not coalesce(p_forcer, false) and exists (select 1 from private.sauvegarde_executions x
         where x.type = p_type and x.statut = 'succes' and x.jour = v_jour) then
      return jsonb_build_object('etat', 'deja_faite', 'jour', v_jour);
    end if;
    if (select count(*) from private.sauvegarde_executions x where x.type = p_type and x.jour = v_jour) >= 6 then
      return jsonb_build_object('etat', 'limite', 'jour', v_jour, 'demarrages', 6);
    end if;
    insert into private.sauvegarde_executions (type, jour, run_id, tentative, origine, fenetre_jusqu_a)
      values (p_type, v_jour, p_run_id, p_tentative, p_origine, case when p_type = 'complete' then v_jusqu end)
      returning id into v_id;
  end if;

  if p_type = 'complete' and v_jusqu > now() then
    update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = v_jusqu, tenue_par = v_id;
    alter role sauvegarde login;
  end if;
  return jsonb_build_object('etat', 'demarree', 'id', v_id, 'fenetre_jusqu_a', case when p_type = 'complete' then v_jusqu end);
end $f$;

-- Fermeture de la connexion (copie complète) : dès la fin de la copie, en succès comme en échec, SEULEMENT par l'exécution qui
-- tient la fenêtre (une fin rejouée d'une ancienne exécution ne coupe pas la copie suivante). Sans effet sur la fenêtre FIXE
-- tant qu'elle est en service (avant l'activation) : sauvegarde_interrompre ne ferme rien pendant la fenêtre fixe.
create or replace function private.sauvegarde_fermer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare e record; r text;
begin
  select * into e from private.sauvegarde_executions where id = p_id;
  if not found then raise exception 'exécution inconnue'; end if;
  if e.type <> 'complete' then return jsonb_build_object('etat', 'sans_fenetre'); end if;
  update private.sauvegarde_executions set fenetre_jusqu_a = least(fenetre_jusqu_a, now()) where id = p_id;
  if not exists (select 1 from private.sauvegarde_fenetre where tenue_par = p_id) then
    return jsonb_build_object('etat', 'non_titulaire');   -- fenêtre déjà refermée, ou tenue par une autre exécution
  end if;
  update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = null, tenue_par = null;
  r := private.sauvegarde_interrompre();
  return jsonb_build_object('etat', 'fermee', 'detail', r);
end $f$;

-- Fin d'une exécution : statut définitif (une seule fois), puis fermeture de la connexion.
create or replace function private.sauvegarde_terminer(p_id bigint, p_statut text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare e record; f jsonb;
begin
  if p_statut is null or p_statut not in ('succes', 'echec') then raise exception 'statut inconnu'; end if;
  select * into e from private.sauvegarde_executions where id = p_id for update;
  if not found then raise exception 'exécution inconnue'; end if;
  if e.statut = 'en_cours' then
    update private.sauvegarde_executions set statut = p_statut, fin = now(), detail = left(p_detail, 300) where id = p_id;
  end if;
  f := private.sauvegarde_fermer(p_id);
  return jsonb_build_object('etat', 'terminee', 'id', p_id,
    'statut', (select statut from private.sauvegarde_executions where id = p_id), 'fermeture', f);
end $f$;

-- ── 3. Interruption (toutes les 15 min) : corps d'origine (outils/fenetre_connexion.sql) + verrous périmés ───────────────────
create or replace function private.sauvegarde_interrompre() returns text
language plpgsql set search_path = '' as $f$
declare f record; n integer := 0; s record; t time := (now() at time zone 'UTC')::time;
begin
  -- verrou d'une exécution disparue (exécuteur GitHub perdu, fin jamais signalée) : libéré après 3 h
  if to_regclass('private.sauvegarde_executions') is not null then
    update private.sauvegarde_executions set statut = 'abandon', fin = now(), detail = 'fin jamais signalée (plus de 3 h)'
     where statut = 'en_cours' and debut < now() - interval '3 hours';
  end if;
  select * into f from private.sauvegarde_fenetre;
  if (f.debut <= f.fin and t >= f.debut and t < f.fin) or (f.debut > f.fin and (t >= f.debut or t < f.fin))
     or coalesce(f.exceptionnelle_jusqu_a > now(), false) then
    return 'fenêtre ouverte : rien à faire';
  end if;
  update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = null, tenue_par = null
   where exceptionnelle_jusqu_a is not null or tenue_par is not null;
  alter role sauvegarde nologin;
  for s in select a.pid from pg_catalog.pg_stat_activity a
            where a.usename = 'sauvegarde' and a.pid <> pg_catalog.pg_backend_pid() loop
    if pg_catalog.pg_terminate_backend(s.pid) then n := n + 1; end if;
  end loop;
  return format('connexion fermée, %s session(s) interrompue(s)', n);
end $f$;

-- ── 4. Contrôle d'absence de réussite (13:07 UTC) ──────────────────────────────────────────────────────────────────────────
create or replace function private.sauvegarde_controler() returns text
language plpgsql security definer set search_path = '' as $f$
declare ty text; lib text; d date := (now() at time zone 'UTC')::date; derniere timestamptz; dernier record; n integer := 0;
begin
  foreach ty in array array['complete', 'json'] loop
    -- mise en service progressive : aucun contrôle tant que ce type n'a jamais été enregistré
    continue when not exists (select 1 from private.sauvegarde_executions where type = ty);
    continue when exists (select 1 from private.sauvegarde_executions where type = ty and statut = 'succes' and jour = d);
    lib := case ty when 'complete' then 'Sauvegarde complète' else 'Sauvegarde quotidienne (JSON)' end;
    select max(fin) into derniere from private.sauvegarde_executions where type = ty and statut = 'succes';
    select * into dernier from private.sauvegarde_executions where type = ty order by debut desc limit 1;
    insert into public.notifications (kind, title, body, dedupe_key)
    values ('sauvegarde', lib || ' : aucune réussite aujourd''hui',
            concat_ws(' · ',
              'dernière réussite : ' || coalesce(to_char(derniere at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI'), 'aucune'),
              'dernière tentative : ' || to_char(dernier.debut at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI') || ' (' || dernier.statut || ')',
              'GitHub › lartbo-matrice-backup › Actions › Run workflow'),
            'sauvegarde:' || ty || ':' || d)
    on conflict (dedupe_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return format('%s alerte(s)', n);
end $f$;

-- ── 5. Schéma privé : classement des tables et présence des secrets ────────────────────────────────────────────────────────
-- Copiées par la sauvegarde complète (aucun secret ; le rôle a BYPASSRLS : seule la lecture manque) :
do $$ declare t text; begin
  foreach t in array array['mailbox_owners', 'notion_raw', 'notion_cursor'] loop
    if to_regclass('private.' || t) is not null then execute format('grant select on private.%I to sauvegarde', t); end if;
  end loop;
end $$;
-- Exclue : private.import_secrets (valeurs jamais copiées). Présence seulement : nom + empreinte SHA-256 tronquée (16 caractères),
-- pour vérifier après une restauration que la valeur ressaisie est la bonne. Écrite dans l'archive CHIFFRÉE uniquement.
create or replace function private.sauvegarde_secrets_presence() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('cle', s.key,
           'empreinte', left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(s.value, 'UTF8')), 'hex'), 16)) order by s.key),
         '[]'::jsonb)
    from private.import_secrets s
$$;

-- ── 6. Secret dédié au déclenchement (comme mailbox_sign_key : tiré ici, jamais régénéré) ─────────────────────────────────────
insert into private.import_secrets (key, value)
  values ('sauvegarde_declenchement_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

-- ── 7. Accès : la fonction serveur (rôle serveur) passe par UNE fonction publique ; rien pour le navigateur ────────────────────
create or replace function public.sauvegarde_declenchement(p_action text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $f$
begin
  return case p_action
    when 'demarrer' then private.sauvegarde_demarrer(p ->> 'type', p ->> 'run_id', (p ->> 'tentative')::integer, p ->> 'origine',
                                                    coalesce((p ->> 'forcer')::boolean, false),
                                                    least(coalesce((p ->> 'duree_minutes')::integer, 45), 45) * interval '1 minute')
    when 'fermer' then private.sauvegarde_fermer((p ->> 'id')::bigint)
    when 'terminer' then private.sauvegarde_terminer((p ->> 'id')::bigint, p ->> 'statut', p ->> 'detail')
    else null end;
end $f$;
revoke all on function private.sauvegarde_demarrer(text, text, integer, text, boolean, interval) from public, anon, authenticated, service_role;
revoke all on function private.sauvegarde_fermer(bigint) from public, anon, authenticated, service_role;
revoke all on function private.sauvegarde_terminer(bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function private.sauvegarde_interrompre() from public, anon, authenticated, service_role;
revoke all on function private.sauvegarde_controler() from public, anon, authenticated, service_role;
revoke all on function private.sauvegarde_secrets_presence() from public, anon, authenticated, service_role;
grant execute on function private.sauvegarde_secrets_presence() to sauvegarde;
revoke all on function public.sauvegarde_declenchement(text, jsonb) from public, anon, authenticated;
grant execute on function public.sauvegarde_declenchement(text, jsonb) to service_role;

-- ── 8. Tâche planifiée du contrôle (la fenêtre fixe et ses tâches restent inchangées jusqu'à l'activation) ───────────────────
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('sauvegarde-controle', '7 13 * * *', 'select private.sauvegarde_controler()');
  end if;
end $$;

-- contrôle
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'private' and c.relkind in ('r', 'p', 'S') and c.relname <> 'import_secrets'
           and not has_table_privilege('sauvegarde', c.oid, 'SELECT')) as tables_privees_non_classees,          -- attendu : 0 (tables et séquences)
       has_any_column_privilege('sauvegarde', 'private.import_secrets', 'SELECT') as sauvegarde_lit_le_coffre,     -- attendu : false
       has_function_privilege('sauvegarde', 'private.sauvegarde_demarrer(text,text,integer,text,boolean,interval)', 'EXECUTE')
         as sauvegarde_peut_s_ouvrir,                                                                                 -- attendu : false
       has_function_privilege('authenticated', 'public.sauvegarde_declenchement(text,jsonb)', 'EXECUTE') as navigateur; -- attendu : false
