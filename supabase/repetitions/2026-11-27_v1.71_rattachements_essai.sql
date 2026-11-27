-- Essai LOCAL de la migration v1.71 (base PostgreSQL jetable, jamais Supabase), à lancer dans la MÊME session psql juste après
-- l'essai v1.70 : psql -v ON_ERROR_STOP=1 -v rc=<…> -v garde=<…> -f 2026-11-26_v1.70_encaissements_essai.sql -f ce_fichier
-- Données FICTIVES. Contrôle : gardes d'empreinte ; migration appliquée deux fois ; réémission (option B, cas type Champs des Notes :
-- trois documents visibles, une seule ligne, l'encaissement d'octobre inchangé, aucun nouveau reste dû) ; avoirs rattachés, corrigés,
-- détachés, classés « Hors MATRICE », qualifiés ; virement groupé (reste non attribué, cumul jamais au-delà du virement) ; droits.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
set request.jwt.claims = '{"email":"equipe@exemple.test"}';

-- garde : avoir_couvert inattendu → arrêt sans rien appliquer
create or replace function public.avoir_couvert(p_payment uuid) returns numeric language sql as $$ select 0::numeric $$;
\set ON_ERROR_STOP 0
\echo (erreurs attendues ci-dessous : garde de la v1.71, puis transaction annulée)
\i supabase/migrations/2026-11-27_v1.71_rattachements.sql
\set ON_ERROR_STOP 1
select pg_temp.ok(to_regclass('public.factures_remplacees') is null and to_regclass('public.virements_groupes') is null, 'garde : avoir_couvert inattendu → migration arrêtée, rien appliqué');
create or replace function public.avoir_couvert(p_payment uuid) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(a.amount_ht), 0) from public.pennylane_avoirs a
   where a.payment_id = p_payment and a.etat = 'rattache' and a.gone_at is null
$$;
revoke all on function public.avoir_couvert(uuid) from public, anon, authenticated;
select pg_temp.ok(md5(pg_get_functiondef('public.avoir_couvert(uuid)'::regprocedure)) = '9e8a85420d1f0f2aedaa0620084501ad', 'avoir_couvert remis à la version de production (v1.69)');

\i supabase/migrations/2026-11-27_v1.71_rattachements.sql
\i supabase/migrations/2026-11-27_v1.71_rattachements.sql
select pg_temp.ok(position('v1.71 (L2b)' in pg_get_functiondef('public.avoir_couvert(uuid)'::regprocedure)) > 0, 'migration appliquée deux fois (rejouable)');

-- ═══ A. réémission, cas type Champs des Notes (données fictives) ═══
insert into public.shows (id, project_id, date, venue, city, status, prod_mode, fee_ht, vat_rate) values
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000aa01', current_date + 1, 'Salle réémission', 'Ville', 'Confirmée Salle', 'coréalisation', 3500, 5.5);
insert into public.show_payments (id, show_id, kind, label, amount, vat_rate, invoice_number, sent_at, pennylane_id, pennylane_url, sort, invoiced_on) values
 ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'acompte', 'Acompte', 1750, 5.5, 'F-TEST-77', '2026-06-10', 'pl-77', 'https://exemple.test/77', 1, '2026-06-10'),
 ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1', 'solde', 'Solde', 1750, 5.5, 'F-TEST-78', '2026-06-10', 'pl-78', null, 2, '2026-06-10');
update public.show_payments set paid_at = '2026-10-30', payee = 'compte' where id = '00000000-0000-0000-0000-0000000000d2';   -- paiement historique (E1)
insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, amount_ttc, credited_pennylane_id, etat, payment_id, show_id, rattache_origine) values
 ('pl-117', 'AV-TEST-117', 1750, 1846.25, 'pl-77', 'rattache', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'pl-77');
select pg_temp.ok(public.avoir_couvert('00000000-0000-0000-0000-0000000000d2') = 1750, 'avant : la ligne est « soldée par l''avoir » (deux documents sur trois)');
do $$ begin
  begin perform public.facture_reemise_enregistrer('00000000-0000-0000-0000-0000000000d2', 'pl-120', 'F-TEST-120', null, 1700, null, 'equipe@exemple.test'); raise exception 'montant différent accepté';
  exception when raise_exception then if sqlerrm not like 'Montant HT différent%' then raise; end if; raise notice 'ok : réémission d''un autre montant refusée (correction de facture)'; end;
  begin perform public.facture_reemise_enregistrer('00000000-0000-0000-0000-0000000000d2', 'pl-78', 'F-TEST-78', null, 1750, null, 'equipe@exemple.test'); raise exception 'facture d''une autre ligne acceptée';
  exception when raise_exception then if sqlerrm not like 'Cette facture Pennylane est déjà liée%' then raise; end if; raise notice 'ok : facture déjà liée à une autre ligne refusée'; end;
end $$;
select (public.facture_reemise_enregistrer('00000000-0000-0000-0000-0000000000d2', 'pl-120', 'F-TEST-120', 'https://exemple.test/120', 1750, 'Réémission après avoir d''erreur', 'equipe@exemple.test')).id as fr_id \gset
select pg_temp.ok((select pennylane_id = 'pl-120' and invoice_number = 'F-TEST-120' and paid_at = '2026-10-30' and amount = 1750 and payee = 'compte'
  from public.show_payments where id = '00000000-0000-0000-0000-0000000000d2'), 'option B : la ligne suit F-120 ; montant, paiement du 30/10 et compte inchangés');
select pg_temp.ok((select count(*) from public.show_payments where show_id = '00000000-0000-0000-0000-0000000000d1' and kind = 'acompte') = 1, 'une seule ligne d''acompte');
select pg_temp.ok(exists (select 1 from public.factures_remplacees where id = :'fr_id' and pennylane_id = 'pl-77' and invoice_number = 'F-TEST-77' and remplacee_par_numero = 'F-TEST-120' and detache_at is null),
  'F-77 gardée visible dans l''historique de la ligne');
select pg_temp.ok((select facture_remplacee and etat = 'rattache' and payment_id = '00000000-0000-0000-0000-0000000000d2' from public.pennylane_avoirs where pennylane_id = 'pl-117'),
  'F-117 reste rattachée et visible, marquée « sur la facture remplacée »');
select pg_temp.ok(public.avoir_couvert('00000000-0000-0000-0000-0000000000d2') = 0 and (select net = 1846.25 and enc = 0 and nb = 0 from public.reglement_couverture((select x from public.show_payments x where id = '00000000-0000-0000-0000-0000000000d2'))),
  'après : net facturé 1 846,25 TTC (F-120), aucun encaissement créé — l''encaissement d''octobre reste le paiement historique');
select pg_temp.ok(not exists (select 1 from public.reglements where payment_id = '00000000-0000-0000-0000-0000000000d2'), 'aucun encaissement créé ni dupliqué');
select pg_temp.ok(not exists (select 1 from public.reminder_candidates() where show_id = '00000000-0000-0000-0000-0000000000d1' and t like '%F-TEST-120%'), 'aucune relance de paiement sur F-120 (payée)');
select pg_temp.ok((select count(*) from public.rattachements_journal where objet = 'reemission' and objet_id = :'fr_id' and action = 'rattacher' and auteur = 'equipe@exemple.test'
  and avant ->> 'pennylane_id' = 'pl-77' and apres ->> 'pennylane_id' = 'pl-120') = 1, 'journal : avant / après, auteur, motif');
do $$ begin
  begin perform public.facture_reemise_enregistrer('00000000-0000-0000-0000-0000000000d2', 'pl-120', 'F-TEST-120', null, 1750, null, 'x'); raise exception 'doublon';
  exception when raise_exception then if sqlerrm not like 'La ligne suit déjà cette facture%' then raise; end if; raise notice 'ok : réémission rejouée — refus, rien de dupliqué'; end;
  begin perform public.facture_reemise_detacher((select id from public.factures_remplacees where pennylane_id = 'pl-77'), ' '); raise exception 'sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : détachement sans motif refusé'; end;
end $$;
-- qualification facultative
select pg_temp.ok((public.avoir_qualifier((select id from public.pennylane_avoirs where pennylane_id = 'pl-117'), 'erreur_facturation')).qualification = 'erreur_facturation', 'F-117 qualifié « Erreur de facturation »');
do $$ begin
  begin perform public.avoir_qualifier((select id from public.pennylane_avoirs where pennylane_id = 'pl-117'), 'remise'); raise exception 'qualification inventée acceptée';
  exception when raise_exception then if sqlerrm <> 'Qualification inconnue' then raise; end if; raise notice 'ok : qualification hors liste refusée'; end;
end $$;
-- détacher puis rattacher de nouveau : retour exact à F-77, puis à F-120 ; paiement jamais touché
select public.facture_reemise_detacher(:'fr_id', 'Essai de détachement') is not null as x \gset
select pg_temp.ok((select pennylane_id = 'pl-77' and invoice_number = 'F-TEST-77' and pennylane_url = 'https://exemple.test/77' and paid_at = '2026-10-30' from public.show_payments where id = '00000000-0000-0000-0000-0000000000d2')
  and not (select facture_remplacee from public.pennylane_avoirs where pennylane_id = 'pl-117'), 'détachement : la ligne revient à F-77, F-117 compte de nouveau ; paiement inchangé');
select public.facture_reemise_enregistrer('00000000-0000-0000-0000-0000000000d2', 'pl-120', 'F-TEST-120', 'https://exemple.test/120', 1750, null, 'equipe@exemple.test') is not null as x \gset
select pg_temp.ok((select count(*) from public.factures_remplacees where payment_id = '00000000-0000-0000-0000-0000000000d2') = 2
  and (select count(*) from public.factures_remplacees where payment_id = '00000000-0000-0000-0000-0000000000d2' and detache_at is null) = 1, 'historique gardé : une réémission détachée, une active');

-- ═══ B. avoirs et documents négatifs : rattacher, corriger, détacher, classer hors MATRICE ═══
insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, amount_ttc, etat, reason) values ('pl-neg', 'NEG-15', 15, 15, 'a_rattacher', 'Pennylane n’indique pas la facture d’origine');
select id as neg from public.pennylane_avoirs where pennylane_id = 'pl-neg' \gset
do $$ declare n uuid := (select id from public.pennylane_avoirs where pennylane_id = 'pl-neg'); begin
  begin perform public.avoir_rattacher(n, '00000000-0000-0000-0000-000000000003', null); raise exception 'commission';
  exception when raise_exception then if sqlerrm not like 'Cette ligne ne reçoit pas%' then raise; end if; raise notice 'ok : commission de production — refus'; end;
  begin perform public.avoir_rattacher(n, '00000000-0000-0000-0000-000000000004', null); raise exception 'hors calcul';
  exception when raise_exception then if sqlerrm not like 'Cette ligne ne reçoit pas%' then raise; end if; raise notice 'ok : ligne hors calcul — refus'; end;
end $$;
select pg_temp.ok((public.avoir_rattacher(:'neg', '00000000-0000-0000-0000-000000000001', null)).etat = 'rattache', 'premier rattachement : sans motif');
select pg_temp.ok((select rattache_mode = 'manuel' and payment_id = '00000000-0000-0000-0000-000000000001' from public.pennylane_avoirs where id = :'neg'), 'rattachement manuel gardé (mode manuel)');
do $$ declare n uuid := (select id from public.pennylane_avoirs where pennylane_id = 'pl-neg'); begin
  begin perform public.avoir_rattacher(n, '00000000-0000-0000-0000-000000000007', '  '); raise exception 'correction sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : correction sans motif refusée'; end;
  begin perform public.avoir_rattacher(n, '00000000-0000-0000-0000-000000000001', 'x'); raise exception 'même ligne';
  exception when raise_exception then if sqlerrm not like 'Document déjà rattaché%' then raise; end if; raise notice 'ok : même ligne — refus'; end;
end $$;
select pg_temp.ok((public.avoir_rattacher(:'neg', '00000000-0000-0000-0000-000000000007', 'Mauvaise ligne')).payment_id = '00000000-0000-0000-0000-000000000007', 'correction avec motif');
select pg_temp.ok((select count(*) from public.rattachements_journal where objet = 'avoir' and objet_id = :'neg' and action = 'corriger' and motif = 'Mauvaise ligne'
  and avant ->> 'payment_id' = '00000000-0000-0000-0000-000000000001' and apres ->> 'payment_id' = '00000000-0000-0000-0000-000000000007' and auteur = 'equipe@exemple.test') = 1, 'journal de la correction : liens avant / après, auteur, date');
do $$ declare n uuid := (select id from public.pennylane_avoirs where pennylane_id = 'pl-neg'); begin
  begin perform public.avoir_detacher(n, ''); raise exception 'détacher sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : détachement sans motif refusé'; end;
  begin perform public.avoir_classer_hors(n, null); raise exception 'classer sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : classement sans motif refusé'; end;
end $$;
select pg_temp.ok((public.avoir_detacher(:'neg', 'Pas pour cette date')).etat = 'a_rattacher', 'détaché (motif)');
select pg_temp.ok((select rattache_mode = 'manuel' and payment_id is null and reason like 'Détaché à la main%' from public.pennylane_avoirs where id = :'neg'), 'détaché à la main : la synchronisation ne le rattachera plus d''elle-même');
select pg_temp.ok((public.avoir_classer_hors(:'neg', 'Frais bancaires, sans lien avec une date')).etat = 'hors_matrice', 'classé « Hors MATRICE / sans objet » (motif)');
select pg_temp.ok((select classement_motif = 'Frais bancaires, sans lien avec une date' and payment_id is null from public.pennylane_avoirs where id = :'neg'), 'classement consultable (motif gardé)');
select pg_temp.ok((public.avoir_rattacher(:'neg', '00000000-0000-0000-0000-000000000001', 'Finalement lié à l''acompte')).etat = 'rattache', 'classement corrigé (rattaché, motif)');
select pg_temp.ok((public.avoir_classer_hors(:'neg', 'Sans objet')).etat = 'hors_matrice', 'reclassé hors MATRICE');
do $$ begin
  begin update public.pennylane_avoirs set classement_motif = null where pennylane_id = 'pl-neg'; raise exception 'hors sans motif';
  exception when check_violation then raise notice 'ok : « Hors MATRICE » sans motif impossible (contrainte)'; end;
end $$;
-- un remboursement enregistré sur un avoir : jamais déplacé avec lui
insert into public.reglements (payment_id, show_id, sens, montant_ttc, date, source, transaction_id, avoir_id)
 values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'remboursement', 10, current_date, 'pennylane', 'tx-remb', (select id from public.pennylane_avoirs where pennylane_id = 'pl-117'));
do $$ begin
  begin perform public.avoir_detacher((select id from public.pennylane_avoirs where pennylane_id = 'pl-117'), 'essai'); raise exception 'avoir remboursé détaché';
  exception when raise_exception then if sqlerrm not like 'Un remboursement est enregistré%' then raise; end if; raise notice 'ok : avoir avec remboursement — rattachement inchangé'; end;
end $$;
delete from public.reglements where transaction_id = 'tx-remb';   -- essai local

-- ═══ C. virement groupé ═══
insert into public.show_payments (id, show_id, kind, label, amount, vat_rate, invoice_number, sent_at, sort) values
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Groupé A', 500, 5.5, 'F-G-A', current_date - 20, 20),
 ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'autre', 'Groupé B', 500, 5.5, 'F-G-B', current_date - 20, 20);
insert into public.pennylane_virements (transaction_id, payment_id) values ('tx-deja', '00000000-0000-0000-0000-000000000001');
do $$ begin
  begin perform public.virement_groupe_creer(1000, current_date - 3, 'x', 'tx-deja'); raise exception 'virement déjà compté';
  exception when raise_exception then if sqlerrm not like 'Ce virement Pennylane est déjà compté%' then raise; end if; raise notice 'ok : virement déjà compté pour une ligne — refus'; end;
end $$;
select (public.virement_groupe_creer(1000, current_date - 3, 'VIR GROUPE FICTIF', 'tx-groupe')).id as vg \gset
select pg_temp.ok((public.virement_groupe_affecter(:'vg', '00000000-0000-0000-0000-0000000000e1', 527.50, 'compte')).date = current_date - 3, 'affectation A : 527,50 € (encaissement daté du virement)');
select count(*) as n0 from public.reglements \gset
do $$ declare v uuid := (select id from public.virements_groupes where transaction_id = 'tx-groupe'); begin
  begin perform public.virement_groupe_affecter(v, '00000000-0000-0000-0000-0000000000e2', 527.50, 'compte'); raise exception 'dépassement accepté';
  exception when raise_exception then if sqlerrm not like 'Virement groupé de 1000,00 € TTC : 527,50 € TTC déjà attribués, reste 472,50 € TTC%' then raise; end if; raise notice 'ok : cumul au-delà du virement refusé (%)', sqlerrm; end;
end $$;
select pg_temp.ok((select count(*) from public.reglements) = :n0, 'refus : rien d''enregistré (tout ou rien)');
select pg_temp.ok((public.virement_groupe_affecter(:'vg', '00000000-0000-0000-0000-0000000000e2', 400, null)).montant_ttc = 400, 'affectation B : 400 € — reste non attribué 72,50 € permis');
select pg_temp.ok((select v.montant_ttc - sum(r.montant_ttc) from public.virements_groupes v join public.reglements r on r.virement_groupe_id = v.id and r.annule_at is null where v.id = :'vg' group by v.montant_ttc) = 72.50, 'reste non attribué : 72,50 €');
do $$ begin
  begin update public.reglements set montant_ttc = 700 where virement_groupe_id = (select id from public.virements_groupes where transaction_id = 'tx-groupe') and payment_id = '00000000-0000-0000-0000-0000000000e2'; raise exception 'modification au-delà acceptée';
  exception when raise_exception then if sqlerrm not like 'Virement groupé de%' then raise; end if; raise notice 'ok : modification directe au-delà du virement refusée (base)'; end;
  begin update public.reglements set transaction_id = 'tx-x' where virement_groupe_id is not null; raise exception 'affectation rapprochée';
  exception when check_violation then raise notice 'ok : une affectation ne reçoit pas d''identifiant de virement (contrainte)'; end;
end $$;
-- annulation d'une affectation : libère sa part, gardée barrée
select public.reglement_annuler((select id from public.reglements where virement_groupe_id = :'vg' and payment_id = '00000000-0000-0000-0000-0000000000e2'), 'Mauvaise date') is not null as x \gset
select pg_temp.ok((public.virement_groupe_affecter(:'vg', '00000000-0000-0000-0000-0000000000e2', 472.50, null)).montant_ttc = 472.50, 'affectation annulée → sa part est de nouveau disponible');
select pg_temp.ok((select (public.reglement_couverture(x)).enc from public.show_payments x where id = '00000000-0000-0000-0000-0000000000e1') = 527.50, 'affectation comptée comme encaissement de la ligne');

-- ═══ D. droits ═══
select pg_temp.ok(not has_function_privilege('authenticated', 'public.facture_reemise_enregistrer(uuid, text, text, text, numeric, text, text)', 'execute'), 'réémission : jamais appelée depuis l''application (lecture Pennylane par la fonction serveur)');
select pg_temp.ok(has_function_privilege('authenticated', 'public.avoir_rattacher(uuid, uuid, text)', 'execute') and has_function_privilege('authenticated', 'public.facture_reemise_detacher(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.virement_groupe_affecter(uuid, uuid, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.avoir_rattacher(uuid, uuid, text)', 'execute') and not has_function_privilege('anon', 'public.virement_groupe_creer(numeric, date, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.ligne_suivie(public.show_payments)', 'execute'), 'fonctions : équipe oui, anonyme non');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.factures_remplacees', 'insert') and not has_table_privilege('authenticated', 'public.virements_groupes', 'update')
  and not has_table_privilege('authenticated', 'public.rattachements_journal', 'delete') and not has_table_privilege('anon', 'public.rattachements_journal', 'select'), 'tables : équipe lecture seule, anonyme aucun');
set request.jwt.claims = '{}';
do $$ begin
  begin perform public.avoir_qualifier((select id from public.pennylane_avoirs where pennylane_id = 'pl-117'), null); raise exception 'hors équipe';
  exception when raise_exception then if sqlerrm <> 'Accès refusé' then raise; end if; raise notice 'ok : hors équipe refusé'; end;
end $$;
\echo ESSAI v1.71 : tout est conforme
