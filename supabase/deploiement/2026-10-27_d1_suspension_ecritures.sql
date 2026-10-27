-- =====================================================================================================
-- ÉTAPE 3 — SUSPENSION EFFECTIVE DES ÉCRITURES (production) — UNIQUEMENT SUR AUTORISATION D'ANTHONY
-- À lancer DEUX fois : avant le déploiement, puis juste après (pour couvrir la table des versements créée par le déploiement).
-- Relançable sans risque : chaque droit retiré est d'abord noté (schéma privé maintenance_d1) ; 9_reprise rend EXACTEMENT ces droits.
-- Ce qui est bloqué pendant l'intervention :
--   • application (utilisateurs connectés) et visiteurs : plus AUCUNE création / modification / suppression, sur toutes les tables ;
--     la LECTURE reste possible (contrôle visuel des comptes dans l'application avant réouverture) ;
--   • fonctions serveur (rôle serveur : Pennylane, imports) : plus aucune écriture sur les tables financières
--     (dates, lignes de facturation, versements, budgets, artistes, réglages) et plus d'accès aux clés des services externes
--     (Pennylane, import, lecture IA, export des fichiers) — donc aucune synchronisation ni brouillon Pennylane possible ;
--   • pages publiques et fonctions d'écriture appelables par l'API (fiche, artiste, RH, dossier Drive, clés, Movinmotion) ;
--   • rappels automatiques (tâche planifiée « rappels-quotidiens ») mis en pause.
-- Les scripts lancés dans l'éditeur SQL (rôle postgres) et la sauvegarde nocturne (lecture) ne sont pas concernés.
-- =====================================================================================================
begin;
set local lock_timeout = '5s';
do $g$ begin
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ce n''est pas la PRODUCTION — rien n''a été fait'; end if;
end $g$;
create schema if not exists maintenance_d1;
revoke all on schema maintenance_d1 from public, anon, authenticated, service_role;
create table if not exists maintenance_d1.droits_tables (tbl text, rol text, priv text, primary key (tbl, rol, priv));
create table if not exists maintenance_d1.droits_fonctions (fn text, grantee text, primary key (fn, grantee));
create table if not exists maintenance_d1.taches (jobid bigint primary key, jobname text, active boolean);
create table if not exists maintenance_d1.journal (at timestamptz not null default now(), quoi text);

do $s$
declare r record; fns text[] := array['public.request_drive_folder(uuid)', 'public.fiche_submit(text, jsonb, jsonb)', 'public.rh_submit(text, jsonb, jsonb, jsonb)',
  'public.set_ai_key(text)', 'public.set_pennylane_key(text)', 'public.artist_submit(text, jsonb, jsonb)', 'public.artist_info_save(uuid, jsonb)',
  'public.ensure_movinmotion(uuid)'];
  f text; n int;
begin
  -- 1. tables : droits d'écriture des rôles de l'API (toutes les tables pour l'application et les visiteurs ; tables financières pour le serveur)
  insert into maintenance_d1.droits_tables
    select c.oid::regclass::text, ro.rol, pr.p
      from pg_class c join pg_namespace s on s.oid = c.relnamespace,
           (values ('anon'), ('authenticated'), ('service_role')) ro(rol), unnest(array['INSERT', 'UPDATE', 'DELETE']) pr(p)
     where s.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(ro.rol, c.oid, pr.p)
       and (ro.rol <> 'service_role' or c.relname in ('shows', 'show_payments', 'commission_transfers', 'budget_lines', 'projects', 'settings'))
  on conflict do nothing;
  for r in select * from maintenance_d1.droits_tables where to_regclass(tbl) is not null loop
    execute format('revoke %s on %s from %I', r.priv, r.tbl, r.rol);
  end loop;
  -- 2. fonctions d'écriture appelables par l'API (droit d'exécution noté tel qu'il est, PUBLIC compris)
  foreach f in array fns loop
    if to_regprocedure(f) is null then continue; end if;
    insert into maintenance_d1.droits_fonctions
      select f, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = to_regprocedure(f) and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))
    on conflict do nothing;
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- 2b. clés des services externes (Pennylane, imports, lecture IA) : plus lisibles par les fonctions serveur pendant l'intervention
  --     → aucune synchronisation Pennylane ni création de brouillon (devis / facture) dans Pennylane possible
  if to_regprocedure('public.import_secret(text)') is not null then
    insert into maintenance_d1.droits_fonctions
      select 'public.import_secret(text)', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = to_regprocedure('public.import_secret(text)') and a.privilege_type = 'EXECUTE'
         and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
    on conflict do nothing;
    revoke execute on function public.import_secret(text) from public, anon, authenticated, service_role;
  end if;
  -- 3. rappels automatiques en pause
  if to_regclass('cron.job') is not null then
    insert into maintenance_d1.taches select jobid, jobname, active from cron.job where jobname = 'rappels-quotidiens' on conflict do nothing;
    for r in select jobid from cron.job where jobname = 'rappels-quotidiens' loop perform cron.alter_job(r.jobid, active := false); end loop;
  end if;
  insert into maintenance_d1.journal (quoi) values ('suspension (' || (select count(*) from maintenance_d1.droits_tables) || ' droits de table, '
    || (select count(*) from maintenance_d1.droits_fonctions) || ' droits de fonction notés)');

  -- 4. vérification effective (dans la même transaction) : sinon TOUT est annulé
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace,
         (values ('anon'), ('authenticated')) ro(rol), unnest(array['INSERT', 'UPDATE', 'DELETE']) pr(p)
   where s.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(ro.rol, c.oid, pr.p);
  if n > 0 then raise exception 'ECHEC : % droit(s) d''écriture encore ouverts à l''application — TOUT EST ANNULÉ', n; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace, unnest(array['INSERT', 'UPDATE', 'DELETE']) pr(p)
   where s.nspname = 'public' and c.relname in ('shows', 'show_payments', 'commission_transfers', 'budget_lines', 'projects', 'settings')
     and has_table_privilege('service_role', c.oid, pr.p);
  if n > 0 then raise exception 'ECHEC : % droit(s) d''écriture encore ouverts aux fonctions serveur — TOUT EST ANNULÉ', n; end if;
  foreach f in array fns loop
    if to_regprocedure(f) is not null and (has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') or has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE')) then
      raise exception 'ECHEC : % encore exécutable — TOUT EST ANNULÉ', f; end if;
  end loop;
  if to_regprocedure('public.import_secret(text)') is not null and has_function_privilege('service_role', 'public.import_secret(text)', 'EXECUTE') then
    raise exception 'ECHEC : clés Pennylane encore lisibles par les fonctions serveur — TOUT EST ANNULÉ'; end if;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'rappels-quotidiens' and active) then
      raise exception 'ECHEC : rappels automatiques encore actifs — TOUT EST ANNULÉ'; end if;
  end if;
  if not has_table_privilege('authenticated', 'public.show_payments', 'SELECT') or not has_function_privilege('anon', 'public.fiche_get(text)', 'EXECUTE') then
    raise exception 'ECHEC : la lecture a été coupée par erreur — TOUT EST ANNULÉ'; end if;
end $s$;
commit;
select 'ÉCRITURES SUSPENDUES — ' || (select count(*) from maintenance_d1.droits_tables) || ' droits de table et ' || (select count(*) from maintenance_d1.droits_fonctions)
       || ' droits de fonction notés pour la reprise ; lecture possible' as resultat;
