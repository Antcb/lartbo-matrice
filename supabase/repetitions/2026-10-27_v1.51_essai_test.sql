-- =====================================================================================================
-- ESSAI v1.51 (coréalisation, coproduction, CNM) — PROJET DE TEST UNIQUEMENT, transaction ANNULÉE (exception finale).
-- La migration 2026-10-27_v1.51_corea_coprod_cnm.sql est insérée à la place de la ligne repère ci-dessous, précédée de la v1.46
-- si le projet de test ne l'a pas encore (ordre réel de mise en ligne).
-- Vérifie : plus de ligne « Taxe CNM » à la confirmation (coréalisation, production, coproduction) ; clôture du résultat
-- réservée à l'équipe et aux coproductions ; montants verrouillés (date et dépenses), dates de paiement libres ; clôture
-- impossible hors fonction ; réouverture avec motif obligatoire, tracée ; commission en coréalisation sur MG + part validée
-- (jamais pour un autre contrat ; part figée si une commission émise sans montant en dépend) ; aucune ligne existante modifiée.
-- =====================================================================================================
begin;
do $g$ begin
  if exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ceci est la PRODUCTION — essai réservé au projet de test'; end if;
end $g$;

--@@MIGRATION@@

do $e$
declare pa uuid; c1 uuid; c2 uuid; c3 uuid; l1 uuid; l2 uuid; e text; n int; avant text; apres text; ok boolean;
begin
  select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) into avant from show_payments x;
  insert into projects (name, mode) values ('ESSAI v1.51', 'production') returning id into pa;
  -- 1. confirmation : aucune ligne CNM (coréalisation, production, coproduction)
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id)
    values (pa, 'ESSAI CR', current_date + 60, 'Option Salle', 'Co-Réalisation', 3000, 'production', 'essai') returning id into c1;
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id, production)
    values (pa, 'ESSAI CP', current_date + 61, 'Option Salle', 'Co-Production', 0, 'production', 'essai', '{"artbo_share":50}') returning id into c2;
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id)
    values (pa, 'ESSAI CE', current_date + 62, 'Option Salle', 'Cession', 5000, 'production', 'essai') returning id into c3;
  update shows set status = 'Confirmée Salle' where id in (c1, c2, c3);
  select count(*) into n from show_payments where show_id in (c1, c2, c3) and kind = 'cnm';
  if n <> 0 then raise exception 'ECHEC 1 : % ligne(s) CNM créée(s) à la confirmation', n; end if;
  if not exists (select 1 from show_payments where show_id = c1 and kind = 'solde') then raise exception 'ECHEC 1b : solde de la coréalisation non créé'; end if;
  if exists (select 1 from show_payments where show_id = c2) then raise exception 'ECHEC 1c : ligne créée pour une coproduction'; end if;

  -- 2. clôture : refusée hors équipe, refusée hors coproduction, refusée en écriture directe
  begin perform public.close_result(c2, '{"result":1}'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Accès refusé' then raise exception 'ECHEC 2 : clôture acceptée hors équipe (%)', e; end if;
  perform set_config('request.jwt.claims', json_build_object('email', (select email from app_users limit 1), 'role', 'authenticated')::text, true);
  begin perform public.close_result(c3, '{"result":1}'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok then raise exception 'ECHEC 2b : clôture acceptée sur une cession'; end if;
  begin update shows set result_closed_at = now() where id = c2; ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok then raise exception 'ECHEC 2c : clôture écrite directement'; end if;

  -- 3. clôture d'une coproduction : enregistrée, tracée ; montants verrouillés ; dates de paiement libres
  insert into budget_lines (project_id, show_id, category, label, amount, payer) values (pa, c2, 'Salle', 'Location', 1000, 'artbo') returning id into l1;
  perform public.close_result(c2, '{"result":5650,"artbo_part":2825,"transfer":5825,"from":"artbo","to":"partenaire"}');
  if not exists (select 1 from shows where id = c2 and result_closed_at is not null and (result_closed->>'result')::numeric = 5650) then raise exception 'ECHEC 3 : clôture non enregistrée'; end if;
  if (select count(*) from result_closures where show_id = c2 and action = 'close') <> 1 then raise exception 'ECHEC 3b : clôture non tracée'; end if;
  begin update shows set production = '{"artbo_share":40}' where id = c2; ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok then raise exception 'ECHEC 3c : budget modifiable après clôture'; end if;
  begin update budget_lines set amount = 2000 where id = l1; ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok then raise exception 'ECHEC 3d : dépense modifiable après clôture'; end if;
  begin insert into budget_lines (project_id, show_id, category, label, amount) values (pa, c2, 'Salle', 'Ajout', 10); ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 3e : dépense ajoutée après clôture'; end if;
  -- B2 : une dépense ne quitte ni ne rejoint une date clôturée
  begin update budget_lines set show_id = c3 where id = l1; ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 3f : dépense déplacée hors de la date clôturée'; end if;
  insert into budget_lines (project_id, show_id, category, label, amount) values (pa, c3, 'Salle', 'Autre date', 5) returning id into l2;
  begin update budget_lines set show_id = c2 where id = l2; ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 3g : dépense ajoutée à la date clôturée par déplacement'; end if;
  -- B3 : changement de mode de l'artiste : l'enregistrement du projet passe, la date clôturée garde son mode
  update projects set mode = 'booking' where id = pa;
  if (select prod_mode from shows where id = c2) is distinct from 'production' then raise exception 'ECHEC 3h : mode de la date clôturée changé'; end if;
  update budget_lines set paid_at = current_date where id = l1;   -- date de paiement : libre
  update shows set reversement_paid_at = current_date where id = c2;   -- paiement réel du reversement : libre

  -- 4. réouverture : motif obligatoire, tracée, montants de nouveau modifiables
  begin perform public.reopen_result(c2, '  '); ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 4 : réouverture sans motif'; end if;
  perform public.reopen_result(c2, 'Facture reçue après la clôture');
  if exists (select 1 from shows where id = c2 and result_closed_at is not null) then raise exception 'ECHEC 4b : non rouvert'; end if;
  if not exists (select 1 from result_closures where show_id = c2 and action = 'reopen' and reason = 'Facture reçue après la clôture' and snapshot ? 'result') then raise exception 'ECHEC 4c : réouverture non tracée'; end if;
  update budget_lines set amount = 2000 where id = l1;

  -- 6. commission en coréalisation : MG + part validée ; jamais pour un autre contrat ; part figée si une commission émise sans montant en dépend
  declare cl uuid; pc numeric; v numeric;
  begin
    select coalesce(x.artbo_pct, public.default_commission_pct(x.id, x.prod_mode)) into pc from shows x where x.id = c1;   -- % réel de la date (mode suivi du projet)
    select id into cl from show_payments where show_id = c1 and kind = 'artbo' limit 1;
    if cl is null then insert into show_payments (show_id, kind, sort) values (c1, 'artbo', 90) returning id into cl; end if;
    select public.payment_amount_now(p) into v from show_payments p where id = cl;
    if v is distinct from round(3000 * pc) / 100 then raise exception 'ECHEC 6 : commission avant validation % (attendu % sur le MG)', v, round(3000 * pc) / 100; end if;
    update shows set corea_share = 1000 where id = c1;
    select public.payment_amount_now(p) into v from show_payments p where id = cl;
    if v is distinct from round(4000 * pc) / 100 then raise exception 'ECHEC 6b : commission % (attendu % sur MG + part)', v, round(4000 * pc) / 100; end if;
    update shows set corea_share = 1000 where id = c3;   -- cession : la colonne n'entre jamais dans la base
    if public.corea_share_of(c3) <> 0 then raise exception 'ECHEC 6c : part comptée hors coréalisation'; end if;
    begin update shows set corea_share = -1 where id = c1; ok := true; exception when others then ok := false; end;
    if ok then raise exception 'ECHEC 6d : part négative acceptée'; end if;
    -- commission versée SANS montant figé (cas historique, créé hors déclencheurs) : la part ne change plus
    set local session_replication_role = replica;
    update show_payments set paid_at = current_date, amount = null where id = cl;
    set local session_replication_role = origin;
    begin update shows set corea_share = 1500 where id = c1; ok := true; exception when others then ok := false; e := sqlerrm; end;
    if ok then raise exception 'ECHEC 6e : part changée alors qu''une commission émise sans montant en dépend'; end if;
    begin update shows set contract_type = 'Cession' where id = c1; ok := true; exception when others then ok := false; end;
    if ok then raise exception 'ECHEC 6f : contrat changé alors que la base de la commission émise en dépend'; end if;
  end;

  -- 5. aucune ligne de facturation existante modifiée
  select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) into apres from show_payments x where x.show_id not in (c1, c2, c3);
  if avant <> apres then raise exception 'ECHEC 5 : lignes de facturation existantes modifiées'; end if;

  raise exception 'ESSAI v1.51 RÉUSSI : pas de ligne CNM à la confirmation, clôture réservée et tracée, montants verrouillés, paiements libres, réouverture motivée, commission coréalisation sur MG + part validée — transaction annulée';
end $e$;
rollback;
