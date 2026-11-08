-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v1.60.4 — NETTOYAGE EXACT du cas d'essai « ESSAI promo » (créé par 2026-11-08_v1.60.4_essai_promo_coproduction.sql).
-- NON APPLIQUÉ par l'agent : à lancer par Anthony (éditeur SQL Supabase), sur la même base que le script de création.
-- Ne touche QUE les identifiants fixes e55a1000-0000-4000-a000-0000000000xx, après avoir vérifié qu'ils portent bien les données
-- d'essai (noms « ESSAI promo… ») : sinon arrêt, rien n'est supprimé. Une seule transaction : tout ou rien.
--
-- Retiré : dépenses, lignes de Factures, notifications, clôture et son historique (result_closures) des 3 dates fictives, les 3 dates,
-- la structure fictive, le coproducteur fictif, l'artiste « ESSAI promo ».
-- Arrêt avec message (rien n'est supprimé) si, pendant l'essai, quelque chose de RÉEL s'est accroché aux données fictives :
--   tâche, suivi, contact, pièce jointe, spectacle, journal d'artiste, modèle de mail, autre date ou dépense d'un autre artiste
--   (à retirer d'abord dans l'application, ou à signaler) ; ligne de Factures émise (numéro, envoi, paiement, Pennylane) ou
--   versement de commission (protégés par la base : à examiner avant tout).
-- Gardé (journaux, aucun mécanisme d'exclusion) : finance_log (création / modifications / suppression de ces dates, identifiables
-- par leurs show_id fixes) et, si une date d'essai a été supprimée depuis l'application, son entrée dans show_deletions.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  proj constant uuid := 'e55a1000-0000-4000-a000-000000000001';
  part constant uuid := 'e55a1000-0000-4000-a000-000000000002';
  stru constant uuid := 'e55a1000-0000-4000-a000-000000000003';
  ids constant uuid[] := array['e55a1000-0000-4000-a000-000000000011', 'e55a1000-0000-4000-a000-000000000012', 'e55a1000-0000-4000-a000-000000000013']::uuid[];
  n int; msg text := '';
begin
  -- 1. identité : chaque objet à identifiant fixe encore présent est bien un objet d'essai
  if exists (select 1 from projects where id = proj and name <> 'ESSAI promo')
     or exists (select 1 from partners where id = part and name <> 'ESSAI promo — coproducteur fictif')
     or exists (select 1 from structures where id = stru and name <> 'ESSAI promo — salle fictive')
     or exists (select 1 from shows where id = any(ids) and (project_id is distinct from proj or venue not like 'ESSAI promo — %')) then
    raise exception 'Nettoyage refusé : un identifiant d''essai porte d''autres données que l''essai. Rien n''est supprimé.';
  end if;

  -- 2. rien de réel accroché aux données fictives (sinon arrêt, liste en clair)
  select count(*) into n from shows where (project_id = proj or structure_id = stru or partner_id = part) and not (id = any(ids));
  if n > 0 then msg := msg || format(' %s autre(s) date(s) liée(s) à l''artiste, la structure ou le coproducteur d''essai ;', n); end if;
  select count(*) into n from budget_lines where (show_id = any(ids) or project_id = proj) and id::text not like 'e55a1000-0000-4000-a000-00000000002_';
  if n > 0 then msg := msg || format(' %s dépense(s) ajoutée(s) pendant l''essai (supprime-les dans l''application ou confirme-les) ;', n); end if;
  select count(*) into n from tasks where show_id = any(ids) or project_id = proj or proj = any(coalesce(project_ids, '{}'));
  if n > 0 then msg := msg || format(' %s tâche(s) ;', n); end if;
  select count(*) into n from prospects where structure_id = stru or project_id = proj or proj = any(coalesce(project_ids, '{}'));
  if n > 0 then msg := msg || format(' %s suivi(s) ;', n); end if;
  select count(*) into n from contact_structures where structure_id = stru;
  if n > 0 then msg := msg || format(' %s contact(s) rattaché(s) à la structure d''essai ;', n); end if;
  select count(*) into n from attachments where project_id = proj;
  if n > 0 then msg := msg || format(' %s pièce(s) jointe(s) ;', n); end if;
  if to_regclass('public.spectacles') is not null then
    execute 'select count(*) from spectacles where project_id = $1' into n using proj;
    if n > 0 then msg := msg || format(' %s spectacle(s) ;', n); end if;
  end if;
  select count(*) into n from projects where default_partner_id = part and id <> proj;
  if n > 0 then msg := msg || format(' %s artiste(s) réel(s) avec le coproducteur d''essai par défaut ;', n); end if;
  select count(*) into n from show_payments where show_id = any(ids)
    and (sent_at is not null or paid_at is not null or nullif(btrim(invoice_number), '') is not null or nullif(btrim(pennylane_id), '') is not null);
  if n > 0 then msg := msg || format(' %s ligne(s) de Factures émise(s) ou payée(s) (protégées par la base : à examiner) ;', n); end if;
  if msg <> '' then
    raise exception 'Nettoyage arrêté, rien n''est supprimé :%', msg;
  end if;

  -- 3. résultat clôturé pendant l'essai : retiré (seul chemin autorisé : drapeau des fonctions close_result / reopen_result),
  --    puis son historique — uniquement pour ces 3 dates fictives
  perform set_config('matrice.result_rpc', 'on', true);
  update shows set result_closed_at = null, result_closed_by = null, result_closed = null where id = any(ids) and result_closed_at is not null;
  delete from result_closures where show_id = any(ids);

  -- 4. lignes liées aux dates, puis dates, puis structure, coproducteur, artiste
  delete from budget_lines where show_id = any(ids) or project_id = proj;
  delete from show_payments where show_id = any(ids);
  delete from notifications where show_id = any(ids);
  delete from shows where id = any(ids);
  delete from structures where id = stru;
  delete from partners where id = part;
  delete from projects where id = proj;

  -- 5. bilan : plus aucune trace hors journaux
  select (select count(*) from projects where id = proj) + (select count(*) from partners where id = part)
       + (select count(*) from structures where id = stru) + (select count(*) from shows where id = any(ids))
       + (select count(*) from budget_lines where show_id = any(ids) or project_id = proj)
       + (select count(*) from show_payments where show_id = any(ids)) + (select count(*) from result_closures where show_id = any(ids))
    into n;
  if n <> 0 then raise exception 'Nettoyage incomplet (% ligne(s) restante(s)) : tout est annulé', n; end if;
  raise notice 'ESSAI promo retiré (journal finance_log conservé).';
end $$;

commit;
