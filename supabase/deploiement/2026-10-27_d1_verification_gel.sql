-- =====================================================================================================
-- ÉTAPE 4 — VÉRIFICATION EFFECTIVE DU GEL (production) — tentatives d'écriture RÉELLES par les rôles de l'API, dans une
-- transaction ENTIÈREMENT ANNULÉE à la fin (erreur voulue « BILAN GEL … »). Rien ne peut être écrit : chaque tentative doit
-- être refusée par manque de DROIT (« permission denied ») ; tout autre refus ou succès rend le bilan NON CONFORME.
-- Résultat attendu : « BILAN GEL : CONFORME (…) ».
-- =====================================================================================================
do $t$
declare k int; sid uuid; lid uuid; res text := ''; email text;
begin
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ce n''est pas la PRODUCTION'; end if;
  if to_regclass('maintenance_d1.droits_tables') is null then raise exception 'ARRET : la suspension n''est pas en place'; end if;
  select id into sid from public.shows order by id limit 1;
  select id into lid from public.show_payments order by id limit 1;
  select app_users.email into email from public.app_users order by app_users.email limit 1;
  -- membre de l'équipe (application)
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', email)::text, true); set local role authenticated;
  if not public.is_team() then raise exception 'ARRET : le compte d''essai (%) n''est pas reconnu comme membre de l''équipe — bilan impossible', email; end if;
  select count(*) into k from public.show_payments; res := res || 'équipe lit ' || k || ' lignes ; ';
  if k = 0 then res := res || 'LECTURE IMPOSSIBLE ; '; end if;
  begin update public.shows set notes = notes where id = sid; res := res || 'ÉQUIPE MODIFIE UNE DATE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'date : refusé ; ' else 'AUTRE REFUS (date) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (date) ' || sqlerrm || ' ; '; end;
  begin update public.show_payments set label = label where id = lid; res := res || 'ÉQUIPE MODIFIE UNE FACTURE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'facture : refusé ; ' else 'AUTRE REFUS (facture) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (facture) ' || sqlerrm || ' ; '; end;
  begin insert into public.budget_lines (label) values ('gel'); res := res || 'ÉQUIPE AJOUTE UNE DÉPENSE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'dépense : refusé ; ' else 'AUTRE REFUS (dépense) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (dépense) ' || sqlerrm || ' ; '; end;
  if to_regclass('public.commission_transfers') is not null then
    begin execute 'insert into public.commission_transfers (payment_id, amount, transferred_at) values ($1, 1, current_date)' using lid; res := res || 'ÉQUIPE NOTE UN VERSEMENT ; ';
    exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'versement : refusé ; ' else 'AUTRE REFUS (versement) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (versement) ' || sqlerrm || ' ; '; end;
  end if;
  begin perform public.request_drive_folder(sid); res := res || 'ÉQUIPE DEMANDE UN DOSSIER DRIVE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'dossier Drive : refusé ; ' else 'AUTRE REFUS (dossier Drive) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (dossier Drive) ' || sqlerrm || ' ; '; end;
  reset role;
  -- visiteur (pages publiques)
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  begin perform public.fiche_submit('x', '{}'::jsonb, '{}'::jsonb); res := res || 'VISITEUR ENVOIE UNE FICHE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'fiche publique : refusé ; ' else 'AUTRE REFUS (fiche publique) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (fiche publique) ' || sqlerrm || ' ; '; end;
  reset role;
  -- fonctions serveur (Pennylane…)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;
  begin update public.show_payments set pennylane_id = pennylane_id where id = lid; res := res || 'SERVEUR MODIFIE UNE FACTURE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'serveur, facture : refusé ; ' else 'AUTRE REFUS (serveur, facture) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (serveur, facture) ' || sqlerrm || ' ; '; end;
  begin update public.settings set value = value where key = 'functions_base_url'; res := res || 'SERVEUR MODIFIE UN RÉGLAGE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'serveur, réglage : refusé ; ' else 'AUTRE REFUS (serveur, réglage) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (serveur, réglage) ' || sqlerrm || ' ; '; end;
  begin perform public.ensure_production_payments(sid); res := res || 'SERVEUR CRÉE DES LIGNES DE PRODUCTION ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'serveur, lignes de production : refusé ; ' else 'AUTRE REFUS (lignes de production) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (lignes de production) ' || sqlerrm || ' ; '; end;
  begin perform public.import_secret('pennylane_token'); res := res || 'SERVEUR LIT LA CLÉ PENNYLANE ; ';
  exception when insufficient_privilege then res := res || case when sqlerrm like 'permission denied%' then 'serveur, clé Pennylane : refusé ; ' else 'AUTRE REFUS (serveur, clé Pennylane) ' || sqlerrm || ' ; ' end; when others then res := res || 'AUTRE ERREUR (clé Pennylane) ' || sqlerrm || ' ; '; end;
  reset role;
  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where jobname = 'rappels-quotidiens' and active) then res := res || 'RAPPELS ACTIFS ; '; end if;
  end if;
  if res ~ '[A-ZÉ]{4,} [A-ZÉ]' then raise exception 'BILAN GEL : NON CONFORME — %', res; end if;
  raise exception using errcode = 'P0001', message = 'BILAN GEL : CONFORME (tout est refusé, lecture possible ; tout est annulé). ' || res;
end $t$;
