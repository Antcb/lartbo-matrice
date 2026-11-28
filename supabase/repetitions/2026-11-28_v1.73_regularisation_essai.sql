-- Essai LOCAL de la migration v1.73 (base PostgreSQL jetable, jamais Supabase), à lancer dans la MÊME session psql juste après les
-- essais v1.70, v1.71 et v1.72 (fonctions pg_temp.ok, date_fictive, lignes_fictives et base v1.72 déjà en place).
-- Données FICTIVES (« Lune Ardente », Nantes, cession 4 000 € HT, TVA 5,5 %). Contrôle : gardes d'empreinte ; migration rejouable ;
-- suivi prévu / fait / reste ; avoir rattaché ≠ remboursement ; remboursement « à faire » non compté, partiel, fait ; avoir partiel ;
-- avoir « à rattacher » ; TVA mixte (TTC à vérifier) ; avenant (case + lien, dispense) ; commission bloquante ; clôture refusée puis
-- acceptée ; réouverture automatique (avoir disparu, encaissement annulé, avenant décoché, correction) ; synchronisation sans effet ;
-- rappels « Avoir à émettre » / « Remboursement à faire » (un par type et par dossier, montant restant) ; booking ; droits.
\set ON_ERROR_STOP 1
set request.jwt.claims = '{"email":"equipe@exemple.test"}';
create or replace function pg_temp.fiche(sid text) returns public.annulations language sql as $$
  select * from public.annulations where show_id = ('00000000-0000-0000-0000-0000000' || sid)::uuid and retablie_at is null $$;
create or replace function pg_temp.avoir(pid text, ht numeric, ttc numeric, n text) returns void language sql as $$
  insert into public.pennylane_avoirs (pennylane_id, invoice_number, invoice_date, amount_ht, amount_ttc, etat, payment_id, show_id)
  select 'PL-' || n, 'F-AV-' || n, current_date, ht, ttc, 'rattache', x.id, x.show_id from public.show_payments x where x.id = md5(pid)::uuid $$;

-- ═══ gardes ═══
create table pg_temp.rc_v172 as select pg_get_functiondef('public.reminder_candidates(uuid, boolean)'::regprocedure) d;
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable as $$ select null::text, null::uuid, null, null::date, null::boolean, null, null, null, null::date, null, null::jsonb, null where false $$;
\set ON_ERROR_STOP 0
\echo (erreurs attendues ci-dessous : garde de la v1.73, puis transaction annulée)
\i supabase/migrations/2026-11-28_v1.73_regularisation.sql
\set ON_ERROR_STOP 1
select pg_temp.ok(to_regprocedure('public.annulation_suivi(uuid)') is null, 'garde : reminder_candidates inattendu → migration arrêtée, rien appliqué');
do $$ begin execute (select d from pg_temp.rc_v172); end $$;
select pg_temp.ok(md5(pg_temp.corps_rc()) = '4104f175d8bd03dc9fc7fbae4823d273', 'reminder_candidates v1.72 remise');
\i supabase/migrations/2026-11-28_v1.73_regularisation.sql
\i supabase/migrations/2026-11-28_v1.73_regularisation.sql
select pg_temp.ok(position('v1.73 (L4)' in pg_temp.corps_rc()) > 0
  and position('v1.73 (L4)' in (select prosrc from pg_proc where oid = 'public.annulation_corriger(uuid, numeric, text, date, text, text, text, text, text)'::regprocedure)) > 0,
  'migration appliquée deux fois (rejouable)');

create or replace function pg_temp.suivi(sid text) returns jsonb language sql as $$ select public.annulation_suivi(('00000000-0000-0000-0000-0000000' || sid)::uuid) $$;
create or replace function pg_temp.codes(sid text) returns text language sql as $$
  select coalesce(string_agg(b ->> 'code', ',' order by b ->> 'code'), '') from jsonb_array_elements(public.annulation_suivi(('00000000-0000-0000-0000-0000000' || sid)::uuid) -> 'blocages') b $$;
create or replace function pg_temp.rappels(sid text) returns text language sql as $$
  select coalesce(string_agg(r || '|' || t, ' ; ' order by r), '') from public.reminder_candidates(('00000000-0000-0000-0000-0000000' || sid)::uuid) $$;
-- ═══ A. l'artiste annule : acompte de 1 200 € HT (1 266 € TTC) encaissé, à restituer ; 0 € dus ; commission non due, jamais versée ═══
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2001', 'A — l''artiste annule'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000c2001', 'w1');
select public.show_annuler('00000000-0000-0000-0000-0000000c2001', 0, 'L''artiste annule ; acompte restitué', current_date, 'Mail fictif', 'artiste', 'non_due');
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'avoir_reste_ht')::numeric = 1200 and (pg_temp.suivi('c2001') ->> 'rembourser_ttc')::numeric = 1266
  and (pg_temp.suivi('c2001') ->> 'reste_facturer_ht')::numeric = 0 and pg_temp.codes('c2001') = 'avenant,avoir,remboursement',
  'A avant : avoir 1 200 € HT à émettre, 1 266 € TTC à rembourser, avenant manquant ; commission non due jamais versée : ne bloque pas');
select pg_temp.ok(pg_temp.rappels('c2001') = 'annulation_avoir|Avoir à émettre (date annulée) : 1200,00 € HT ; annulation_remboursement|Remboursement à faire (date annulée) : 1266,00 € TTC',
  'A : rappels « Avoir à émettre » et « Remboursement à faire », dus dès l''annulation, montant restant');
select pg_temp.ok((select bool_and(raw = current_date) from public.reminder_candidates('00000000-0000-0000-0000-0000000c2001')), 'A : rappels dus le jour de l''annulation');
do $$ begin
  begin perform public.annulation_cloturer((pg_temp.fiche('c2001')).id); raise exception 'clôture acceptée';
  exception when raise_exception then if sqlerrm not like 'Clôture impossible : avoir à émettre ; reste à rembourser ; avenant signé à renseigner%' then raise; end if;
    raise notice 'ok : A : clôture refusée par la base (motifs : %)', sqlerrm; end;
end $$;
-- avoir total rattaché : solde seulement le rappel d'avoir ; le remboursement reste dû
select pg_temp.avoir('w1a', 1200, 1266, 'w1');
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'avoir_reste_ht')::numeric = 0 and (pg_temp.suivi('c2001') ->> 'avoirs_ht')::numeric = 1200
  and (pg_temp.suivi('c2001') ->> 'rembourser_ttc')::numeric = 1266 and pg_temp.codes('c2001') = 'avenant,remboursement',
  'A : avoir rattaché → avoir soldé, remboursement toujours 1 266 € TTC (un avoir ne vaut pas remboursement)');
select pg_temp.ok(pg_temp.rappels('c2001') = 'annulation_remboursement|Remboursement à faire (date annulée) : 1266,00 € TTC', 'A : le rappel d''avoir disparaît, celui de remboursement reste');
-- remboursement « à faire » : ne compte pas
select public.reglement_saisir(md5('w1a')::uuid, 'remboursement', 'a_faire', 1266, null, null, null, 'Restitution décidée');
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'rembourser_ttc')::numeric = 1266 and (pg_temp.suivi('c2001') ->> 'remboursement_a_faire_ttc')::numeric = 1266
  and (pg_temp.suivi('c2001') ->> 'rembourse_ttc')::numeric = 0, 'A : saisie « à faire » non comptée dans les montants remboursés');
select public.reglement_annuler((select id from public.reglements where payment_id = md5('w1a')::uuid and etat = 'a_faire'), 'Remplacée par les virements réels');
-- remboursement partiel fait (non rapproché), puis le reste
select public.reglement_saisir(md5('w1a')::uuid, 'remboursement', 'fait', 1000, current_date, 'artbo', 'VIR-FICTIF-1', null);
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'rembourser_ttc')::numeric = 266 and (pg_temp.suivi('c2001') ->> 'rembourse_ttc')::numeric = 1000
  and pg_temp.rappels('c2001') = 'annulation_remboursement|Remboursement à faire (date annulée) : 266,00 € TTC',
  'A : 1 000 € remboursés (non rapprochés) → reste 266 € TTC, rappel au montant restant (un seul rappel par dossier)');
select pg_temp.ok((select count(distinct k) = 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000c2001') where r = 'annulation_remboursement'),
  'A : même clé de rappel quel que soit le montant restant (un rappel par type et par dossier)');
select public.reglement_saisir(md5('w1a')::uuid, 'remboursement', 'fait', 266, current_date, 'artbo', 'VIR-FICTIF-2', null);
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'rembourser_ttc')::numeric = 0 and pg_temp.codes('c2001') = 'avenant' and pg_temp.rappels('c2001') = '',
  'A : remboursé en entier → seul l''avenant manque ; plus aucun rappel');
do $$ begin
  begin perform public.annulation_avenant((pg_temp.fiche('c2001')).id, true, '  '); raise exception 'avenant sans lien';
  exception when raise_exception then if sqlerrm not like 'Lien vers l''avenant signé obligatoire%' then raise; end if; raise notice 'ok : avenant signé sans lien refusé'; end;
end $$;
select public.annulation_avenant((pg_temp.fiche('c2001')).id, true, 'https://drive.example.test/avenant-a');
select pg_temp.ok((pg_temp.suivi('c2001') ->> 'pret')::boolean, 'A : avenant renseigné, aucune commission bloquante → prêt à clôturer');
select public.annulation_cloturer((pg_temp.fiche('c2001')).id);
select pg_temp.ok((pg_temp.fiche('c2001')).cloture_at is not null and (pg_temp.fiche('c2001')).cloture_par = 'equipe@exemple.test'
  and (select count(*) = 1 from public.annulations_journal where show_id = '00000000-0000-0000-0000-0000000c2001' and action = 'cloturer' and auteur = 'equipe@exemple.test'),
  'A : clôturé « Régularisé », auteur et date dans l''historique');
do $$ begin
  begin perform public.annulation_cloturer((pg_temp.fiche('c2001')).id); raise exception 'seconde clôture';
  exception when raise_exception then if sqlerrm <> 'Dossier déjà régularisé' then raise; end if; raise notice 'ok : seconde clôture refusée'; end;
end $$;
-- synchronisation sans effet (avoir revu, mêmes montants) : pas de réouverture
update public.pennylane_avoirs set last_seen_at = now(), pl_status = 'paid' where pennylane_id = 'PL-w1';
select pg_temp.ok((pg_temp.fiche('c2001')).cloture_at is not null
  and not exists (select 1 from public.annulations_journal where show_id = '00000000-0000-0000-0000-0000000c2001' and action = 'rouvrir'),
  'A : synchronisation sans effet sur les conditions → dossier toujours régularisé');
-- remboursement annulé après clôture : le reste réapparaît → réouverture automatique, cause dans l'historique
select public.reglement_annuler((select id from public.reglements where reference = 'VIR-FICTIF-2'), 'Virement rejeté (essai)');
select pg_temp.ok((pg_temp.fiche('c2001')).cloture_at is null and (pg_temp.fiche('c2001')).reouvert_cause like 'Encaissement ou remboursement modifié : reste à rembourser%'
  and (select count(*) = 1 from public.annulations_journal where show_id = '00000000-0000-0000-0000-0000000c2001' and action = 'rouvrir' and auteur = 'equipe@exemple.test'),
  'A : remboursement annulé après clôture → rouvert « À régulariser », cause dans l''historique');

-- ═══ A'. commission non due déjà versée ; commission à revoir : bloquent ═══
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2002', 'A'' — commission versée'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000c2002', 'w2');
insert into public.commission_transfers (payment_id, amount, transferred_at) values (md5('w2c')::uuid, 180, current_date - 30);
select public.show_annuler('00000000-0000-0000-0000-0000000c2002', 1200, 'Acompte conservé', current_date, null, 'organisateur', 'non_due');
select public.annulation_avenant((pg_temp.fiche('c2002')).id, true, 'https://drive.example.test/avenant-b');
select pg_temp.ok(pg_temp.codes('c2002') = 'commission', 'A'' : commission non due mais déjà versée → seule la commission bloque');
select public.annulation_corriger((pg_temp.fiche('c2002')).id, 1200, 'Acompte conservé', current_date, null, 'Essai', 'organisateur', 'a_revoir');
select pg_temp.ok(pg_temp.codes('c2002') = 'commission', 'A'' : commission « à revoir » → bloque');
do $$ begin
  begin perform public.annulation_cloturer((pg_temp.fiche('c2002')).id); raise exception 'clôture acceptée';
  exception when raise_exception then if sqlerrm <> 'Clôture impossible : commission à revoir ou à régulariser (L5)' then raise; end if; raise notice 'ok : A'' : clôture refusée (commission)'; end;
end $$;

-- ═══ B. acompte facturé jamais encaissé, 0 € dus : avoir, aucun remboursement ; réouverture si l'avoir disparaît ═══
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2003', 'B — jamais encaissé');
insert into public.show_payments (id, show_id, kind, label, pct, amount, invoice_number, sent_at, sort) values
  (md5('w3a')::uuid, '00000000-0000-0000-0000-0000000c2003', 'acompte', 'Acompte', 30, 1200, 'F-X-w3-A', current_date - 60, 1),
  (md5('w3s')::uuid, '00000000-0000-0000-0000-0000000c2003', 'solde', 'Solde', 70, null, null, null, 2);
select public.show_annuler('00000000-0000-0000-0000-0000000c2003', 0, 'Sans frais', current_date, null, 'commun', 'a_revoir');
select pg_temp.ok(pg_temp.codes('c2003') = 'avenant,avoir' and (pg_temp.suivi('c2003') ->> 'rembourser_ttc')::numeric = 0
  and pg_temp.rappels('c2003') = 'annulation_avoir|Avoir à émettre (date annulée) : 1200,00 € HT',
  'B : avoir à émettre, aucun remboursement ni rappel de remboursement ; sans commission : rien ne bloque de ce côté');
select pg_temp.avoir('w3a', 1200, 1266, 'w3');
select public.annulation_avenant((pg_temp.fiche('c2003')).id, true, 'https://drive.example.test/avenant-c');
select pg_temp.ok((pg_temp.suivi('c2003') ->> 'pret')::boolean, 'B : avoir rattaché et avenant → prêt à clôturer');
select public.annulation_cloturer((pg_temp.fiche('c2003')).id);
update public.pennylane_avoirs set gone_at = now() where pennylane_id = 'PL-w3';
select pg_temp.ok((pg_temp.fiche('c2003')).cloture_at is null and (pg_temp.fiche('c2003')).reouvert_cause like 'Avoir modifié : avoir à émettre%',
  'B : avoir disparu de Pennylane après clôture → rouvert');
update public.pennylane_avoirs set gone_at = null where pennylane_id = 'PL-w3';
select public.annulation_cloturer((pg_temp.fiche('c2003')).id);
select public.annulation_avenant((pg_temp.fiche('c2003')).id, false, null);
select pg_temp.ok((pg_temp.fiche('c2003')).cloture_at is null and (pg_temp.fiche('c2003')).reouvert_cause like 'Avenant modifié : avenant%', 'B : avenant décoché après clôture → rouvert');

-- ═══ C. maintien partiel (2 000 € dus) : solde de 800 € à facturer, émis, encaissé en deux fois ; réouverture sur encaissement annulé ═══
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2004', 'C — maintien partiel'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000c2004', 'w4');
select public.show_annuler('00000000-0000-0000-0000-0000000c2004', 2000, 'Avenant : 50 %', current_date, null, 'organisateur', 'non_due');
select public.annulation_avenant((pg_temp.fiche('c2004')).id, true, 'https://drive.example.test/avenant-d');
select pg_temp.ok(pg_temp.codes('c2004') = 'encaissement,facturation' and (pg_temp.suivi('c2004') ->> 'reste_facturer_ht')::numeric = 800
  and (pg_temp.suivi('c2004') ->> 'attendu_ttc')::numeric = 844, 'C : 800 € HT à facturer, 844 € TTC à encaisser');
update public.show_payments set invoice_number = 'F-X-w4-S', invoiced_on = current_date, sent_at = current_date where id = md5('w4s')::uuid;
select pg_temp.ok(pg_temp.codes('c2004') = 'encaissement', 'C : solde émis → reste seulement à encaisser');
select public.reglement_saisir(md5('w4s')::uuid, 'encaissement', 'fait', 400, current_date, 'compte', 'VIR-ORG-1', null);
select pg_temp.ok((pg_temp.suivi('c2004') ->> 'attendu_ttc')::numeric = 444, 'C : encaissement partiel → reste 444 € TTC à encaisser');
select public.reglement_saisir(md5('w4s')::uuid, 'encaissement', 'fait', 444, current_date, 'compte', 'VIR-ORG-2', null);
select pg_temp.ok((pg_temp.suivi('c2004') ->> 'pret')::boolean, 'C : tout encaissé, avenant, commission non due jamais versée → prêt');
select public.annulation_cloturer((pg_temp.fiche('c2004')).id);
select public.reglement_annuler((select id from public.reglements where reference = 'VIR-ORG-2'), 'Saisi deux fois (essai)');
select pg_temp.ok((pg_temp.fiche('c2004')).cloture_at is null and (pg_temp.fiche('c2004')).reouvert_cause like 'Encaissement ou remboursement modifié : reste à encaisser%',
  'C : encaissement annulé après clôture → rouvert');
-- correction du montant dû sur un dossier régularisé : rouvert si un reste apparaît
select public.reglement_saisir(md5('w4s')::uuid, 'encaissement', 'fait', 444, current_date, 'compte', 'VIR-ORG-3', null);
select public.annulation_cloturer((pg_temp.fiche('c2004')).id);
select public.annulation_corriger((pg_temp.fiche('c2004')).id, 2500, 'Avenant : 62,5 %', current_date, null, 'Avenant revu', 'organisateur', 'non_due');
select pg_temp.ok((pg_temp.fiche('c2004')).cloture_at is null and (pg_temp.fiche('c2004')).reouvert_cause like 'Annulation corrigée : reste à facturer ; reste à encaisser%',
  'C : correction du montant dû après clôture → rouvert (reste à facturer et à encaisser)');

-- ═══ D. avoir partiel ; E. avoir « à rattacher » sur la date ; F. TVA mixte ; G. dispense d'avenant ; H. booking ═══
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2005', 'D — avoir partiel'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000c2005', 'w5');
select public.show_annuler('00000000-0000-0000-0000-0000000c2005', 0, 'Sans frais', current_date, null, 'organisateur', 'non_due');
select pg_temp.avoir('w5a', 600, 633, 'w5');
select pg_temp.ok((pg_temp.suivi('c2005') ->> 'avoir_reste_ht')::numeric = 600 and (pg_temp.suivi('c2005') ->> 'avoirs_ht')::numeric = 600
  and pg_temp.rappels('c2005') like '%Avoir à émettre (date annulée) : 600,00 € HT%', 'D : avoir partiel de 600 € → 600 € HT restent à émettre, rappel au montant restant');
insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, amount_ttc, etat, show_id, reason)
  values ('PL-w5b', 'F-AV-w5b', 600, 633, 'a_rattacher', '00000000-0000-0000-0000-0000000c2005', 'Origine non indiquée');
select pg_temp.ok((pg_temp.suivi('c2005') ->> 'avoir_reste_ht')::numeric = 600 and (pg_temp.suivi('c2005') ->> 'avoirs_a_rattacher')::int = 1
  and position('a_rattacher' in pg_temp.codes('c2005')) > 0, 'E : avoir « à rattacher » sur la date : non compté, bloque la clôture (condition incertaine)');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2006', 'F — TVA mixte'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000c2006', 'w6');
update public.show_payments set vat_rate = 20 where id = md5('w6s')::uuid;
select public.show_annuler('00000000-0000-0000-0000-0000000c2006', 0, 'Sans frais', current_date, null, 'organisateur', 'non_due');
select pg_temp.ok((pg_temp.suivi('c2006') -> 'rembourser_ttc') = 'null'::jsonb and (pg_temp.suivi('c2006') ->> 'rembourser_ht')::numeric = 1200
  and pg_temp.rappels('c2006') like '%Remboursement à faire (date annulée) : TTC à vérifier%', 'F : TVA mixte → « TTC à vérifier », aucun montant de remboursement proposé');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2007', 'G — sans facture émise');
insert into public.show_payments (id, show_id, kind, label, pct, sort) values (md5('w7a')::uuid, '00000000-0000-0000-0000-0000000c2007', 'acompte', 'Acompte', 30, 1),
  (md5('w7s')::uuid, '00000000-0000-0000-0000-0000000c2007', 'solde', 'Solde', 70, 2);
select public.show_annuler('00000000-0000-0000-0000-0000000c2007', 0, 'Sans frais', current_date, null, 'organisateur', 'non_due');
select pg_temp.ok((pg_temp.suivi('c2007') ->> 'pret')::boolean and (pg_temp.suivi('c2007') ->> 'avenant_dispense')::boolean,
  'G : sans frais, aucune facture émise → avenant dispensé, prêt à clôturer');
select public.annulation_cloturer((pg_temp.fiche('c2007')).id);
select pg_temp.ok((pg_temp.fiche('c2007')).cloture_at is not null, 'G : clôturé sans avenant (dispense)');
update public.show_payments set pennylane_url = 'https://pennylane.example.test/f', label = label where show_id = '00000000-0000-0000-0000-0000000c2007';
select pg_temp.ok((pg_temp.fiche('c2007')).cloture_at is not null and not exists (select 1 from public.annulations_journal
  where show_id = '00000000-0000-0000-0000-0000000c2007' and action = 'rouvrir'), 'G : mise à jour des lignes sans effet (synchronisation) → toujours régularisé');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000c2008', 'H — booking', 'booking', 'Cession');
insert into public.show_payments (show_id, kind, label, amount, invoice_number, sent_at, sort) values ('00000000-0000-0000-0000-0000000c2008', 'artbo', 'Commission', 600, 'F-X-B8', current_date - 20, 30);
select public.show_annuler('00000000-0000-0000-0000-0000000c2008', null, 'Festival annulé', current_date, null, 'organisateur', 'a_revoir');
do $$ begin
  begin perform public.annulation_cloturer((pg_temp.fiche('c2008')).id); raise exception 'clôture booking acceptée';
  exception when raise_exception then if sqlerrm not like 'Clôture impossible : cession seulement%' then raise; end if; raise notice 'ok : H : booking non clôturable en L4'; end;
end $$;

-- ═══ dates non annulées : relances inchangées ; droits ═══
select pg_temp.ok(not exists (select 1 from public.reminder_candidates(null, false) c join public.annulations a on a.show_id = c.show_id and a.retablie_at is null
  where c.r in ('annulation_avoir', 'annulation_remboursement') and a.regime <> 'cession'), 'rappels de régularisation : cessions annulées seulement');
select pg_temp.ok(not has_function_privilege('anon', 'public.annulation_cloturer(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.annulation_cloturer(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.annulation_avenant(uuid, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.annulation_avenant(uuid, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.annulation_suivi(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.annulation_verifier_cloture(uuid, text)', 'execute'), 'droits : clôture et avenant pour l''équipe ; calcul et réouverture internes');
set request.jwt.claims = '{}';
do $$ begin
  begin perform public.annulation_cloturer((pg_temp.fiche('c2007')).id); raise exception 'hors équipe accepté';
  exception when raise_exception then if sqlerrm <> 'Accès refusé' then raise; end if; raise notice 'ok : hors équipe refusé'; end;
end $$;
set request.jwt.claims = '{"email":"equipe@exemple.test"}';
\echo ESSAI v1.73 : tout est conforme
