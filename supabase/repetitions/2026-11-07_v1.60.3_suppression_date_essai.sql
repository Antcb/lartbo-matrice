-- Essais v1.60.3 (base jetable, données fictives) : chaque échec lève « ECHEC n ».
insert into app_users values ('equipe@test.local') on conflict do nothing;
grant execute on function public.show_deletion_state(uuid), public.delete_show(uuid) to authenticated;
set role authenticated;
do $e$
declare pa uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid; d7 uuid; d8 uuid; d9 uuid; d10 uuid; t1 uuid; p1 uuid; ok boolean; e text; n int; r jsonb; j jsonb;
begin
  -- hors équipe
  perform set_config('request.jwt.claims', '{"email":"inconnu@test.local","role":"authenticated"}', false);
  begin perform public.delete_show(gen_random_uuid()); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Accès refusé' then raise exception 'ECHEC 1 : hors équipe (%)', e; end if;
  begin perform public.show_deletion_state(gen_random_uuid()); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Accès refusé' then raise exception 'ECHEC 1b : état hors équipe (%)', e; end if;

  perform set_config('request.jwt.claims', '{"email":"equipe@test.local","role":"authenticated"}', false);
  insert into projects (name) values ('ESSAI v1.60.3') returning id into pa;

  -- 2. date rouverte (clôture + réouverture), une ligne non émise, une dépense, une tâche
  insert into shows (project_id, venue, date, contract_type, fee_ht) values (pa, 'ESSAI Rouverte', current_date + 30, 'Co-Production', 0) returning id into d1;
  insert into show_payments (show_id, kind, label, amount) values (d1, 'autre', 'Recette', 500);
  insert into budget_lines (project_id, show_id, category, label, amount) values (pa, d1, 'Salle', 'Location', 1000);
  insert into tasks (title, show_id) values ('Tâche de la date', d1) returning id into t1;
  perform public.close_result(d1, '{"result":1500}');
  perform public.reopen_result(d1, 'Erreur de saisie');
  -- avant correction : la suppression directe échoue sur la clé étrangère (constat du défaut)
  begin delete from shows where id = d1; ok := true; exception when foreign_key_violation then ok := false; end;
  if ok then raise exception 'ECHEC 2a : la suppression directe aurait dû buter sur result_closures'; end if;
  j := public.show_deletion_state(d1);
  if jsonb_array_length(j -> 'blocked') <> 0 or (j ->> 'closures')::int <> 2 or (j ->> 'tasks')::int <> 1 or (j ->> 'payments')::int <> 1 or (j ->> 'budget_lines')::int <> 1 then
    raise exception 'ECHEC 2b : état inattendu %', j; end if;
  r := public.delete_show(d1);
  if exists (select 1 from shows where id = d1) then raise exception 'ECHEC 2c : date non supprimée'; end if;
  if exists (select 1 from show_payments where show_id = d1) or exists (select 1 from budget_lines where show_id = d1) then raise exception 'ECHEC 2d : lignes restées'; end if;
  if (select show_id from tasks where id = t1) is not null then raise exception 'ECHEC 2e : tâche non détachée'; end if;
  if exists (select 1 from result_closures where show_id = d1) then raise exception 'ECHEC 2f : historique resté lié'; end if;
  select snapshot into j from show_deletions where show_id = d1;
  if j is null or jsonb_array_length(j -> 'result_closures') <> 2 or (j -> 'result_closures' -> 1 ->> 'reason') <> 'Erreur de saisie'
     or jsonb_array_length(j -> 'payments') <> 1 or jsonb_array_length(j -> 'budget_lines') <> 1 or jsonb_array_length(j -> 'tasks_detached') <> 1
     or (j -> 'show' ->> 'venue') <> 'ESSAI Rouverte' then raise exception 'ECHEC 2g : copie incomplète %', j; end if;
  if (select actor from show_deletions where show_id = d1) <> 'equipe@test.local' then raise exception 'ECHEC 2h : auteur non noté'; end if;
  if not exists (select 1 from finance_log where show_id = d1 and op = 'DELETE' and table_name = 'shows') then raise exception 'ECHEC 2i : finance_log sans la suppression'; end if;
  if (r ->> 'closures')::int <> 2 or (r ->> 'tasks')::int <> 1 then raise exception 'ECHEC 2j : bilan %', r; end if;
  -- tâche détachée : mention visible en tête de sa note (réponse d'Anthony du 07/11)
  if (select notes from tasks where id = t1) not like 'Date supprimée le __/__/____ : ' || to_char(current_date + 30, 'DD/MM/YYYY') || ' · ESSAI Rouverte · ESSAI v1.60.3' then
    raise exception 'ECHEC 2k : mention absente (%)', (select notes from tasks where id = t1); end if;

  -- 3. résultat clôturé : refus
  insert into shows (project_id, venue, contract_type, fee_ht) values (pa, 'ESSAI Clôturée', 'Co-Production', 0) returning id into d2;
  perform public.close_result(d2, '{"result":1}');
  begin perform public.delete_show(d2); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Le résultat de cette date est clôturé%' then raise exception 'ECHEC 3 : %', e; end if;
  if not exists (select 1 from shows where id = d2) or (select count(*) from result_closures where show_id = d2) <> 1 then raise exception 'ECHEC 3b : modifiée malgré le refus'; end if;

  -- 4. facture émise : refus, rien de touché (ni date, ni ligne, ni journal des suppressions)
  select count(*) into n from show_deletions;
  insert into shows (project_id, venue, fee_ht) values (pa, 'ESSAI Facturée', 1000) returning id into d3;
  insert into show_payments (show_id, kind, label, amount, invoice_number, sent_at) values (d3, 'acompte', 'Acompte', 300, 'F-1', current_date) returning id into p1;
  insert into tasks (title, show_id) values ('Tâche facturée', d3);
  begin perform public.delete_show(d3); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date a des factures émises%' then raise exception 'ECHEC 4 : %', e; end if;
  if not exists (select 1 from show_payments where id = p1) or not exists (select 1 from tasks where show_id = d3)
     or (select count(*) from show_deletions) <> n then raise exception 'ECHEC 4b : modifiée malgré le refus'; end if;
  -- la protection de la base reste active hors fonction (suppression directe refusée par show_payments_emitted_guard)
  begin delete from shows where id = d3; ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok then raise exception 'ECHEC 4c : facture émise supprimée en direct'; end if;

  -- 5. lien Pennylane (devis), facture Pennylane connue, historique de rattachement, pièce à rattacher, versement : refus
  insert into shows (project_id, venue, pennylane_quote_id) values (pa, 'ESSAI Devis', '123') returning id into d4;
  begin perform public.delete_show(d4); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date est liée à un document Pennylane%' then raise exception 'ECHEC 5a : %', e; end if;
  insert into shows (project_id, venue) values (pa, 'ESSAI À rattacher') returning id into d5;
  reset role; insert into pennylane_a_rattacher (pennylane_id, show_id) values ('PL-1', d5); set role authenticated;
  begin perform public.delete_show(d5); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date a 1 facture Pennylane%' then raise exception 'ECHEC 5b : %', e; end if;
  if not exists (select 1 from pennylane_a_rattacher where show_id = d5) then raise exception 'ECHEC 5b2 : facture à rattacher effacée'; end if;
  insert into shows (project_id, venue) values (pa, 'ESSAI Rattachement') returning id into d6;
  reset role; insert into pennylane_rattachements (show_id, pennylane_id) values (d6, 'PL-2'); set role authenticated;
  begin perform public.delete_show(d6); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like '%historique de rattachement%' then raise exception 'ECHEC 5c : %', e; end if;
  insert into shows (project_id, venue) values (pa, 'ESSAI Pièce') returning id into d7;
  insert into attachments (name, path) values ('f.pdf', 'budget/' || d7 || '/f.pdf');
  begin perform public.delete_show(d7); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date a 1 pièce à rattacher%' then raise exception 'ECHEC 5d : %', e; end if;
  insert into shows (project_id, venue, prod_mode) values (pa, 'ESSAI Versement', 'production') returning id into d8;
  insert into show_payments (show_id, kind, label, amount) values (d8, 'artbo', 'Commission', 100) returning id into p1;
  reset role; insert into commission_transfers (payment_id, amount, transferred_at) values (p1, 40, current_date); set role authenticated;
  begin perform public.delete_show(d8); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date a des factures émises%' then raise exception 'ECHEC 5e : %', e; end if;

  -- 6. ligne hors calcul : refus
  insert into shows (project_id, venue, contract_type) values (pa, 'ESSAI Hors calcul', 'Co-Production') returning id into d9;
  perform set_config('matrice.regularisation', 'hors_calcul', true);
  reset role; insert into show_payments (show_id, kind, label, hors_calcul) values (d9, 'acompte', 'Import', 'import'); set role authenticated;
  perform set_config('matrice.regularisation', '', true);
  begin perform public.delete_show(d9); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date garde des lignes hors calcul%' then raise exception 'ECHEC 6 : %', e; end if;

  -- 7. date simple avec tâches (clé NO ACTION) : supprimée, tâches gardées
  insert into shows (project_id, venue) values (pa, 'ESSAI Simple') returning id into d10;
  insert into tasks (title, show_id) values ('T1', d10), ('T2', d10);
  r := public.delete_show(d10);
  if (select count(*) from tasks where title in ('T1', 'T2') and show_id is null) <> 2 then raise exception 'ECHEC 7'; end if;

  -- 8. date introuvable ; journal en lecture seule
  begin perform public.delete_show(d10); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Date introuvable%' then raise exception 'ECHEC 8 : %', e; end if;
  begin insert into show_deletions (show_id, snapshot) values (gen_random_uuid(), '{}'); ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 8b : écriture directe dans le journal'; end if;
  begin delete from show_deletions; ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 8c : effacement du journal'; end if;
  begin update show_deletions set label = 'x'; ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 8d : modification du journal'; end if;

  -- 9. archivage : la date au devis Pennylane (non supprimable) s'archive avec un motif, se restaure ; refus clairs
  j := public.show_deletion_state(d4);
  if jsonb_array_length(j -> 'blocked') = 0 or jsonb_array_length(j -> 'archive_blocked') <> 0 then raise exception 'ECHEC 9 : état %', j; end if;
  begin perform public.archive_show(d4, '  '); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Indique le motif%' then raise exception 'ECHEC 9a : %', e; end if;
  perform public.archive_show(d4, 'Date abandonnée, devis gardé dans Pennylane');
  if (select archived_at is null or archived_by <> 'equipe@test.local' or archived_reason <> 'Date abandonnée, devis gardé dans Pennylane'
             or jsonb_array_length(archive_history) <> 1 or status <> 'Intérêt Salle' or pennylane_quote_id <> '123' from shows where id = d4) then
    raise exception 'ECHEC 9b : archivage mal noté'; end if;
  begin perform public.archive_show(d4, 'encore'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like '%déjà archivée%' then raise exception 'ECHEC 9c : %', e; end if;
  begin update shows set archived_at = null where id = d4; ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Archivage et restauration%' then raise exception 'ECHEC 9d : écriture directe acceptée (%)', e; end if;
  begin insert into shows (project_id, venue, archived_at) values (pa, 'ESSAI née archivée', now()); ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 9e : date créée archivée'; end if;
  perform public.restore_show(d4);
  if (select archived_at is not null or jsonb_array_length(archive_history) <> 2 from shows where id = d4) then raise exception 'ECHEC 9f : restauration'; end if;
  begin perform public.restore_show(d4); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like '%n’est pas archivée%' then raise exception 'ECHEC 9g : %', e; end if;
  begin perform public.archive_show(d3, 'x'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Cette date a des factures émises ou des versements%' then raise exception 'ECHEC 9h : %', e; end if;
  begin perform public.archive_show(d2, 'x'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Le résultat de cette date est clôturé%' then raise exception 'ECHEC 9i : %', e; end if;
  begin perform public.archive_show(d5, 'x'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like '%facture Pennylane à rattacher%' then raise exception 'ECHEC 9j : %', e; end if;
  perform set_config('request.jwt.claims', '{"email":"inconnu@test.local","role":"authenticated"}', false);
  begin perform public.archive_show(d6, 'x'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Accès refusé' then raise exception 'ECHEC 9k : hors équipe (%)', e; end if;
  perform set_config('request.jwt.claims', '{"email":"equipe@test.local","role":"authenticated"}', false);
  raise notice 'ESSAIS v1.60.3 : 9 groupes, tous réussis';
end $e$;

-- 10. rappels : une date confirmée archivée ne produit aucun rappel (fonction lancée comme la tâche planifiée)
reset role;
do $r$
declare pa uuid; a uuid; b uuid; n int;
begin
  perform set_config('request.jwt.claims', '{"email":"equipe@test.local","role":"authenticated"}', false);
  insert into projects (name) values ('ESSAI rappels') returning id into pa;
  insert into shows (project_id, venue, date, status, prod_mode, conf_kit_sent) values (pa, 'ESSAI Rappel visible', current_date + 90, 'Confirmée Salle', 'production', current_date - 30) returning id into a;
  insert into shows (project_id, venue, date, status, prod_mode, conf_kit_sent) values (pa, 'ESSAI Rappel archivé', current_date + 90, 'Confirmée Salle', 'production', current_date - 30) returning id into b;
  perform public.archive_show(b, 'essai');
  perform public.generate_reminders();
  select count(*) into n from notifications where show_id = a and kind = 'precontrat';
  if n <> 1 then raise exception 'ECHEC 10 : rappel absent pour la date visible (%)', n; end if;
  if exists (select 1 from notifications where show_id = b) then raise exception 'ECHEC 10b : rappel pour une date archivée'; end if;
  raise notice 'ESSAI 10 (rappels) réussi';
end $r$;

-- 11 à 14. Réponses d'Anthony du 07/11 au soir : fiche publique fermée, notifications retirées, aucune relance accumulée à la
-- restauration, alerte quand une facture arrive sur une date archivée (rattachement conservé). Rôle serveur (comme la tâche
-- planifiée et la synchronisation), avec l'adresse d'un membre de l'équipe pour archiver / restaurer.
do $s$
declare pa uuid; d uuid; p uuid; ok boolean; e text; f jsonb; n int;
begin
  perform set_config('request.jwt.claims', '{"email":"equipe@test.local","role":"authenticated"}', false);
  insert into projects (name) values ('ESSAI soir') returning id into pa;
  insert into shows (project_id, venue, date, status, prod_mode, conf_kit_sent, fiche_token, fiche)
    values (pa, 'ESSAI Soir', current_date + 60, 'Confirmée Salle', 'production', current_date - 30, 'jeton-essai-soir-000001', '{"x":"gardé"}') returning id into d;
  insert into show_payments (show_id, kind, label, pct) values (d, 'acompte', 'Acompte', 30) returning id into p;
  perform public.generate_reminders();
  if not exists (select 1 from notifications where show_id = d and kind = 'precontrat' and withdrawn_at is null) then raise exception 'ECHEC 11 : rappel de départ absent'; end if;
  if public.fiche_get('jeton-essai-soir-000001') is null then raise exception 'ECHEC 11a : fiche illisible avant archivage'; end if;

  perform public.archive_show(d, 'essai du soir');
  -- 11. fiche publique : accès fermé, message neutre, données conservées
  begin f := public.fiche_get('jeton-essai-soir-000001'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Dossier indisponible' then raise exception 'ECHEC 11b : fiche_get (%)', e; end if;
  begin perform public.fiche_submit('jeton-essai-soir-000001', '{}', '{"y":1}'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e <> 'Dossier indisponible' then raise exception 'ECHEC 11c : fiche_submit (%)', e; end if;
  if (select fiche ->> 'x' from shows where id = d) <> 'gardé' then raise exception 'ECHEC 11d : données de la fiche modifiées'; end if;
  -- 12. notifications de la date : retirées (marquées), jamais supprimées
  if exists (select 1 from notifications where show_id = d and withdrawn_at is null) then raise exception 'ECHEC 12 : notification encore active'; end if;
  if not exists (select 1 from notifications where show_id = d and withdrawn_reason = 'Date archivée') then raise exception 'ECHEC 12b : historique perdu'; end if;
  perform public.generate_reminders();
  if exists (select 1 from notifications where show_id = d and withdrawn_at is null) then raise exception 'ECHEC 12c : rappel créé pour une date archivée'; end if;
  -- 14. facture arrivée sur la date archivée : rattachement conservé + une seule alerte ; idem facture Pennylane à rattacher
  update show_payments set invoice_number = 'F-77', pennylane_id = '77' where id = p;
  update show_payments set sent_at = current_date where id = p;
  select count(*) into n from notifications where show_id = d and kind = 'date_archivee_facture' and withdrawn_at is null;
  if n <> 1 or (select invoice_number from show_payments where id = p) <> 'F-77' then raise exception 'ECHEC 14 : % alerte(s)', n; end if;
  insert into pennylane_a_rattacher (pennylane_id, show_id) values ('PL-SOIR', d);
  if (select count(*) from notifications where show_id = d and kind = 'date_archivee_facture') <> 2 then raise exception 'ECHEC 14b : alerte « à rattacher » absente'; end if;

  -- 13. restauration (décision d'Anthony du 07/11) : fiche rouverte, alertes traitées, échéances d'origine intactes, AUCUNE relance
  -- reprise automatiquement, même longtemps après ; réactivation explicite avec la prochaine échéance de chaque relance, tracée
  perform public.restore_show(d);
  if public.fiche_get('jeton-essai-soir-000001') ->> 'venue' <> 'ESSAI Soir' then raise exception 'ECHEC 13 : fiche non rouverte'; end if;
  if exists (select 1 from notifications where show_id = d and withdrawn_at is null) then raise exception 'ECHEC 13b : alerte ou rappel encore actifs'; end if;
  if (select conf_kit_sent from shows where id = d) <> current_date - 30 then raise exception 'ECHEC 13c : échéance d''origine modifiée'; end if;
  perform set_config('matrice.archive_rpc', 'on', true); update shows set restored_at = now() - interval '30 days' where id = d; perform set_config('matrice.archive_rpc', '', true);
  perform public.generate_reminders();
  if exists (select 1 from notifications where show_id = d and withdrawn_at is null) then raise exception 'ECHEC 13d : relance reprise sans réactivation'; end if;
  begin update shows set reminders_suspended_at = null where id = d; ok := true; exception when others then ok := false; end;
  if ok then raise exception 'ECHEC 13e : réactivation écrite directement'; end if;
  begin perform public.reactivate_reminders(d, jsonb_build_object('precontrat', (current_date - 1)::text)); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like 'Choisis une prochaine échéance%' then raise exception 'ECHEC 13f : échéance passée acceptée (%)', e; end if;
  -- l'application propose toutes les relances concernées (ici pré-contrat et boucle accueil) ; une relance sans date choisie reprendrait
  -- à son échéance d'origine
  perform public.reactivate_reminders(d, jsonb_build_object('precontrat', (current_date + 3)::text, 'boucle_accueil', (current_date + 3)::text));
  if (select archive_history -> -1 ->> 'action' from shows where id = d) <> 'reactivate_reminders' then raise exception 'ECHEC 13g : réactivation non tracée'; end if;
  begin perform public.reactivate_reminders(d, '{}'); ok := true; exception when others then ok := false; e := sqlerrm; end;
  if ok or e not like '%ne sont pas suspendues%' then raise exception 'ECHEC 13h : %', e; end if;
  perform public.generate_reminders();
  if exists (select 1 from notifications where show_id = d and withdrawn_at is null) then raise exception 'ECHEC 13i : relance partie avant l''échéance choisie'; end if;
  -- l'échéance choisie arrive : la relance part, une seule fois, avec sa clé propre
  perform set_config('matrice.archive_rpc', 'on', true); update shows set reminders_next = reminders_next || jsonb_build_object('precontrat', current_date::text) where id = d; perform set_config('matrice.archive_rpc', '', true);
  perform public.generate_reminders(); perform public.generate_reminders();
  select count(*) into n from notifications where show_id = d and kind = 'precontrat' and withdrawn_at is null and dedupe_key like '%:a%';
  if n <> 1 then raise exception 'ECHEC 13j : relance après réactivation (% trouvée(s))', n; end if;
  raise notice 'ESSAIS 11 à 14 (fiche publique, notifications, restauration et réactivation des relances, alerte facture) réussis';
end $s$;
