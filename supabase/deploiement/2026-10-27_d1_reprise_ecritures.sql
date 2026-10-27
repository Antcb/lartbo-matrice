-- =====================================================================================================
-- ÉTAPE 12 — REPRISE DES ÉCRITURES (production) — rend EXACTEMENT les droits notés par 1_suspension_ecritures_PROJET.sql
-- (y compris en cas d'arrêt de l'intervention, quel que soit le point atteint), réactive les rappels, puis efface la note.
-- Une table qui n'existe plus (retour arrière du lot) est ignorée.
-- =====================================================================================================
begin;
set local lock_timeout = '5s';
do $g$ begin
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ce n''est pas la PRODUCTION — rien n''a été fait'; end if;
  if to_regclass('maintenance_d1.droits_tables') is null then
    raise exception 'ARRET : aucune suspension en cours (note maintenance_d1 absente) — rien n''a été fait'; end if;
end $g$;
do $r$
declare r record; n int;
begin
  for r in select * from maintenance_d1.droits_tables where to_regclass(tbl) is not null loop
    execute format('grant %s on %s to %I', r.priv, r.tbl, r.rol);
  end loop;
  for r in select * from maintenance_d1.droits_fonctions where to_regprocedure(fn) is not null loop
    execute format('grant execute on function %s to %s', r.fn, case when r.grantee = 'PUBLIC' then 'public' else quote_ident(r.grantee) end);
  end loop;
  if to_regclass('cron.job') is not null then
    for r in select * from maintenance_d1.taches loop perform cron.alter_job(r.jobid, active := r.active); end loop;
  end if;
  -- contrôle : chaque droit noté est rétabli
  select count(*) into n from maintenance_d1.droits_tables where to_regclass(tbl) is not null and not has_table_privilege(rol, to_regclass(tbl), priv);
  if n > 0 then raise exception 'ECHEC : % droit(s) de table non rétabli(s) — TOUT EST ANNULÉ', n; end if;
  select count(*) into n from maintenance_d1.droits_fonctions where to_regprocedure(fn) is not null
     and not has_function_privilege(case when grantee = 'PUBLIC' then 'anon' else grantee end, to_regprocedure(fn), 'EXECUTE');
  if n > 0 then raise exception 'ECHEC : % droit(s) de fonction non rétabli(s) — TOUT EST ANNULÉ', n; end if;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from maintenance_d1.taches t join cron.job j using (jobid) where j.active is distinct from t.active) then
      raise exception 'ECHEC : rappels automatiques non rétablis — TOUT EST ANNULÉ'; end if;
  end if;
end $r$;
drop schema maintenance_d1 cascade;
commit;
select 'ÉCRITURES RÉTABLIES (droits et rappels automatiques remis exactement comme avant la suspension)' as resultat;
