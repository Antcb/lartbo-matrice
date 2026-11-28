-- Essai LOCAL de la migration v1.72 (base PostgreSQL jetable, jamais Supabase), à lancer dans la MÊME session psql juste après les
-- essais v1.70 et v1.71 : psql -v ON_ERROR_STOP=1 -v rc=<…> -v garde=<…> -f 2026-11-26_v1.70_encaissements_essai.sql
--   -f 2026-11-27_v1.71_rattachements_essai.sql -f ce_fichier
-- Données FICTIVES (« Lune Ardente », Nantes). Contrôle : garde d'empreinte de reminder_candidates ; migration appliquée deux fois ;
-- date engagée → « Annuler la date » obligatoire (statut direct refusé, « Sans Suite » refusé) ; date non engagée : inchangée ;
-- trois variantes (2 000 € dus : solde de 800 € à émettre ; 1 200 € : solde « ne doit plus être émis » ; 0 € sans frais : facturé
-- au-delà, rien créé) ; facture émise au-delà du montant retenu (relance suspendue) ; relances d'organisation arrêtées ; correction
-- (motif, avant / après) ; rétablir (refusé après une émission, accepté sinon) ; booking et coréalisation sans calcul ; droits.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
set request.jwt.claims = '{"email":"equipe@exemple.test"}';

-- colonnes et tables de production absentes de la base d'essai (structure seulement)
alter table public.shows add column if not exists contract_type text;
alter table public.shows add column if not exists corea_share numeric;
create table if not exists public.commission_transfers (id uuid primary key default gen_random_uuid(), payment_id uuid references public.show_payments(id),
  amount numeric, transferred_at date);
create table if not exists public.budget_lines (id uuid primary key default gen_random_uuid(), show_id uuid references public.shows(id), category text, label text,
  amount numeric, paid_at date, reimbursed_at date, doc_number text, file_path text, sort int);
-- montant du moment d'une ligne : texte de PRODUCTION de payment_amount_for (relevé en lecture seule le 28/11/2026) ; commission :
-- % de la ligne ou de la date (default_commission_pct, corea_share_of simplifiées ici)
create or replace function public.default_commission_pct(uuid, text) returns numeric language sql as $$ select 15::numeric $$;
create or replace function public.corea_share_of(uuid) returns numeric language sql as $$ select 0::numeric $$;
create or replace function public.payment_amount_for(p public.show_payments, p_fee numeric, p_artbo numeric, p_partner numeric, p_mode text) returns numeric
 language plpgsql stable set search_path = public as $$
declare done numeric; fixed numeric; fee numeric := coalesce(p_fee, 0); pct_com numeric; base numeric;
begin
  if p.amount is not null then return p.amount; end if;
  if p.kind in ('artbo', 'partner') then
    pct_com := coalesce(p_artbo, public.default_commission_pct(p.show_id, p_mode), 0);
    base := fee + public.corea_share_of(p.show_id);
    if p.kind = 'artbo' then return round(base * coalesce(p.pct, pct_com)) / 100; end if;
    return round(base * pct_com * coalesce(p.pct, p_partner, 0) / 100) / 100;
  end if;
  if p.kind = 'solde' and coalesce(p_mode, 'production') <> 'booking' then
    if exists (select 1 from public.show_payments q where q.show_id = p.show_id and q.kind = 'solde' and q.id <> p.id and q.amount is null and q.hors_calcul is null
               and not public.payment_is_emitted(q) and (coalesce(q.sort, 0) < coalesce(p.sort, 0) or (coalesce(q.sort, 0) = coalesce(p.sort, 0) and q.id::text < p.id::text))) then
      return 0;
    end if;
    select coalesce(sum(case when a.amount is not null then a.amount when a.pct is null then 0 else round(fee * a.pct) / 100 end), 0) into done
      from public.show_payments a where a.show_id = p.show_id and a.kind = 'acompte' and a.id <> p.id and a.hors_calcul is null;
    select coalesce(sum(case when q.amount is not null then q.amount when q.pct is null then 0 else round(fee * q.pct) / 100 end), 0) into fixed
      from public.show_payments q where q.show_id = p.show_id and q.kind = 'solde' and q.id <> p.id and q.hors_calcul is null and (q.amount is not null or public.payment_is_emitted(q));
    return greatest(0, round((fee - done - fixed) * 100) / 100);
  end if;
  if p.kind = 'cnm' or p.pct is null then return null; end if;
  return round(fee * p.pct) / 100;
end $$;
create or replace function public.payment_amount_now(p public.show_payments) returns numeric language sql stable set search_path = public as $$
  select public.payment_amount_for(p, s.fee_ht, s.artbo_pct, s.partner_pct, s.prod_mode) from public.shows s where s.id = p.show_id $$;

-- garde : reminder_candidates inattendu → arrêt sans rien appliquer
create or replace function pg_temp.corps_rc() returns text language sql as $$ select prosrc from pg_proc where oid = 'public.reminder_candidates(uuid, boolean)'::regprocedure $$;
select pg_temp.ok(md5(pg_temp.corps_rc()) = '692d4401e045af57cceb0130e2a52594', 'reminder_candidates de la base d''essai = production (v1.70)');
create table pg_temp.rc_v170 as select pg_get_functiondef('public.reminder_candidates(uuid, boolean)'::regprocedure) d;
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable as $$ select null::text, null::uuid, null, null::date, null::boolean, null, null, null, null::date, null, null::jsonb, null where false $$;
\set ON_ERROR_STOP 0
\echo (erreurs attendues ci-dessous : garde de la v1.72, puis transaction annulée)
\i supabase/migrations/2026-11-28_v1.72_annulation.sql
\set ON_ERROR_STOP 1
select pg_temp.ok(to_regclass('public.annulations') is null, 'garde : reminder_candidates inattendu → migration arrêtée, rien appliqué');
do $$ begin execute (select d from pg_temp.rc_v170); end $$;
select pg_temp.ok(md5(pg_temp.corps_rc()) = '692d4401e045af57cceb0130e2a52594', 'reminder_candidates v1.70 remise');

\i supabase/migrations/2026-11-28_v1.72_annulation.sql
\i supabase/migrations/2026-11-28_v1.72_annulation.sql
select pg_temp.ok(position('v1.72 (L3)' in pg_temp.corps_rc()) > 0, 'migration appliquée deux fois (rejouable)');

-- ═══ données fictives : Lune Ardente · Le Hangar Bleu, Nantes · cession 4 000 € HT (TVA 5,5 %) ═══
insert into public.projects (id, name) values ('00000000-0000-0000-0000-00000000a172', 'Lune Ardente') on conflict do nothing;
create or replace function pg_temp.date_fictive(id uuid, nom text, mode text default 'production', contrat text default 'Cession') returns void language sql as $$
  insert into public.shows (id, project_id, date, venue, city, status, prod_mode, contract_type, fee_ht, vat_rate, artbo_pct, contract_signed, contract_sent, conf_kit_sent)
  values (id, '00000000-0000-0000-0000-00000000a172', current_date + 90, nom, 'Nantes', 'Confirmée Salle', mode, contrat, 4000, 5.5, 15, current_date - 40, current_date - 45, current_date - 50) $$;
-- acompte 30 % (1 200 € HT) facturé et encaissé ; solde 70 % calculé, non émis ; commission 15 %
create or replace function pg_temp.lignes_fictives(sid uuid, n text) returns void language sql as $$
  insert into public.show_payments (id, show_id, kind, label, pct, amount, invoice_number, sent_at, paid_at, payee, sort) values
    (md5(n || 'a')::uuid, sid, 'acompte', 'Acompte', 30, 1200, 'F-X-' || n || '-A', current_date - 60, current_date - 50, 'compte', 1),
    (md5(n || 's')::uuid, sid, 'solde', 'Solde', 70, null, null, null, null, null, 2),
    (md5(n || 'c')::uuid, sid, 'artbo', 'Commission L''ArtBo', null, null, null, null, null, null, 3) $$;
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1001', 'Le Hangar Bleu (2 000 € dus)');  select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1001', 'v1');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1002', 'Le Hangar Bleu (1 200 € dus)');  select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1002', 'v2');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1003', 'Le Hangar Bleu (sans frais)');   select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1003', 'v3');
-- facture émise au-delà du montant retenu : solde 2 800 € émis et impayé, 2 000 € dus au total ; et la même avec 4 000 € dus
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1004', 'Le Hangar Bleu (solde émis au-delà)'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1004', 'v4');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1005', 'Le Hangar Bleu (solde émis, maintien)'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1005', 'v5');
update public.show_payments set amount = 2800, invoice_number = 'F-X-' || substr(label, 1, 1) || show_id::text, sent_at = current_date - 20
 where kind = 'solde' and show_id in ('00000000-0000-0000-0000-0000000a1004', '00000000-0000-0000-0000-0000000a1005');
-- (ajustement 13 h 25) solde émis (numéro) mais pas envoyé : 2 000 € dus (au-delà → à régulariser) ; 4 000 € dus (correspond)
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1009', 'Le Hangar Bleu (solde fait, au-delà)'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1009', 'v9');
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1010', 'Le Hangar Bleu (solde fait, maintien)'); select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1010', 'v10');
update public.show_payments set amount = 2800, invoice_number = 'F-X-S-' || show_id::text, invoiced_on = current_date - 5
 where kind = 'solde' and show_id in ('00000000-0000-0000-0000-0000000a1009', '00000000-0000-0000-0000-0000000a1010');
-- non engagée (ni contrat signé, ni facture…) ; booking ; coréalisation
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1006', 'Salle non engagée');
update public.shows set contract_signed = null where id = '00000000-0000-0000-0000-0000000a1006';
insert into public.show_payments (show_id, kind, label, pct, sort) values ('00000000-0000-0000-0000-0000000a1006', 'acompte', 'Acompte', 30, 1), ('00000000-0000-0000-0000-0000000a1006', 'solde', 'Solde', 70, 2);
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1007', 'Festival booking', 'booking', 'Cession');
insert into public.show_payments (id, show_id, kind, label, amount, invoice_number, sent_at, sort) values
  ('00000000-0000-0000-0000-0000000b1007', '00000000-0000-0000-0000-0000000a1007', 'artbo', 'Facture commission (artiste)', 600, 'F-X-B7', current_date - 20, 30);
select pg_temp.date_fictive('00000000-0000-0000-0000-0000000a1008', 'Salle coréalisation', 'production', 'Co-Réalisation');
select pg_temp.lignes_fictives('00000000-0000-0000-0000-0000000a1008', 'v8');

-- engagement : contrat signé, facture émise, encaissement, commission versée, dépense engagée même non payée
select pg_temp.ok(public.show_engagee('00000000-0000-0000-0000-0000000a1001') and not public.show_engagee('00000000-0000-0000-0000-0000000a1006'), 'date engagée / non engagée');
insert into public.budget_lines (show_id, label, amount) values ('00000000-0000-0000-0000-0000000a1006', 'Transport (pièce reçue, pas encore payé)', 300);
select pg_temp.ok(public.show_engagee('00000000-0000-0000-0000-0000000a1006'), 'dépense engagée non payée : date engagée');
delete from public.budget_lines where show_id = '00000000-0000-0000-0000-0000000a1006';
insert into public.budget_lines (show_id, label) values ('00000000-0000-0000-0000-0000000a1006', 'Transport prévu');
select pg_temp.ok(not public.show_engagee('00000000-0000-0000-0000-0000000a1006'), 'dépense seulement prévue : pas d''engagement');

-- relances AVANT : organisation (boucle accueil & technique, contrat co-signé…) présentes sur une date confirmée
select pg_temp.ok(exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1001') where r = 'contrat_cosigne'), 'avant : relance d''organisation présente');
select pg_temp.ok(exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1004') where r = 'solde_paye'), 'avant : relance d''impayé du solde émis');

-- tous les chemins : statut direct refusé sur une date engagée (« Annulée » comme « Sans Suite ») ; date non engagée : inchangé
do $$ begin
  begin update public.shows set status = 'Annulée' where id = '00000000-0000-0000-0000-0000000a1001'; raise exception 'statut direct accepté';
  exception when raise_exception then if sqlerrm not like 'Date engagée%' then raise; end if; raise notice 'ok : « Annulée » direct refusé (date engagée)'; end;
  begin update public.shows set status = 'Sans Suite' where id = '00000000-0000-0000-0000-0000000a1001'; raise exception 'Sans Suite accepté';
  exception when raise_exception then if sqlerrm not like '%Sans Suite » n''est pas possible%' then raise; end if; raise notice 'ok : « Sans Suite » refusé (date engagée)'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1006', 0, 'essai', current_date, null); raise exception 'fiche sur date non engagée';
  exception when raise_exception then if sqlerrm not like 'Date non engagée%' then raise; end if; raise notice 'ok : pas de fiche pour une date non engagée'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1001', null, 'essai', current_date, null); raise exception 'montant manquant accepté';
  exception when raise_exception then if sqlerrm not like 'Montant total dû%' then raise; end if; raise notice 'ok : montant obligatoire (cession)'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1001', 2000, '  ', current_date, null); raise exception 'motif vide accepté';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : motif obligatoire'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1001', 2000, 'essai', null, null); raise exception 'date manquante acceptée';
  exception when raise_exception then if sqlerrm not like 'Date de la décision%' then raise; end if; raise notice 'ok : date de la décision obligatoire'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1001', -1, 'essai', current_date, null); raise exception 'montant négatif accepté';
  exception when raise_exception then if sqlerrm not like 'Montant total dû%' then raise; end if; raise notice 'ok : montant négatif refusé'; end;
end $$;
update public.shows set status = 'Annulée' where id = '00000000-0000-0000-0000-0000000a1006';
select pg_temp.ok((select status from public.shows where id = '00000000-0000-0000-0000-0000000a1006') = 'Annulée', 'date non engagée : passe en « Annulée » directement (inchangé)');

-- ═══ variante 1 : 2 000 € HT dus → 800 € HT à facturer sur le solde ═══
select pg_temp.ok((public.show_annuler('00000000-0000-0000-0000-0000000a1001', 2000, 'L''organisateur annule ; avenant : 50 % du prix', current_date - 1, 'Mail du 20/02')).regime = 'cession', 'variante 1 : fiche créée');
select pg_temp.ok((select status from public.shows where id = '00000000-0000-0000-0000-0000000a1001') = 'Annulée', 'variante 1 : date « Annulée »');
select pg_temp.ok((select amount = 1200 and invoice_number = 'F-X-v1-A' and paid_at = current_date - 50 and annulation is null from public.show_payments where id = md5('v1a')::uuid),
  'variante 1 : acompte émis et encaissé intact');
select pg_temp.ok((select amount = 800 and annulation = 'recalculee' and pct = 70 from public.show_payments where id = md5('v1s')::uuid), 'variante 1 : solde = 800 € HT à émettre');
select pg_temp.ok((select (e ->> 'montant_initial')::numeric = 2800 and (e ->> 'nouveau')::numeric = 800 from public.annulations a, jsonb_array_elements(a.lignes) e
  where a.show_id = '00000000-0000-0000-0000-0000000a1001' and e ->> 'payment_id' = md5('v1s')::uuid::text), 'variante 1 : montant initial du solde (2 800 €) gardé dans la fiche');
select pg_temp.ok((select (initial #>> '{show,fee_ht}')::numeric = 4000 and initial #>> '{show,status}' = 'Confirmée Salle' and jsonb_array_length(initial -> 'lignes') = 3
  from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1001'), 'variante 1 : conditions initiales figées (cachet 4 000 €, statut, lignes)');
select pg_temp.ok((select fee_ht = 4000 from public.shows where id = '00000000-0000-0000-0000-0000000a1001'), 'variante 1 : cachet initial conservé');
select pg_temp.ok((select amount is null from public.show_payments where id = md5('v1c')::uuid), 'variante 1 : commission inchangée (montant existant, à revoir)');
select pg_temp.ok((select array_agg(r) = array['solde_envoi'] from public.reminder_candidates('00000000-0000-0000-0000-0000000a1001')),
  'variante 1 : organisation arrêtée ; seule « Facture de solde à faire » reste (solde recalculé de 800 €)');
select pg_temp.ok((select count(*) = 1 from public.annulations_journal where show_id = '00000000-0000-0000-0000-0000000a1001' and action = 'annuler' and auteur = 'equipe@exemple.test'), 'variante 1 : journal');

-- ═══ variante 2 : 1 200 € HT dus → le solde ne doit plus être émis ═══
select public.show_annuler('00000000-0000-0000-0000-0000000a1002', 1200, 'Acompte conservé', current_date - 1, null);
select pg_temp.ok((select amount = 0 and annulation = 'abandonnee' from public.show_payments where id = md5('v2s')::uuid), 'variante 2 : solde « ne doit plus être émis » (gardé, 0)');
select pg_temp.ok((select amount = 1200 and paid_at is not null and annulation is null from public.show_payments where id = md5('v2a')::uuid), 'variante 2 : acompte intact');
select pg_temp.ok(not exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1002')), 'variante 2 : solde abandonné : aucune relance (ni à faire, ni à envoyer)');

-- ═══ variante 3 : 0 € (sans frais) → solde abandonné ; acompte facturé et encaissé au-delà : rien n'est créé ═══
select public.show_annuler('00000000-0000-0000-0000-0000000a1003', 0, 'Annulation sans frais', current_date - 1, 'Clause 7');
select pg_temp.ok((select amount = 0 and annulation = 'abandonnee' from public.show_payments where id = md5('v3s')::uuid), 'variante 3 : solde abandonné');
select pg_temp.ok((select amount = 1200 and invoice_number = 'F-X-v3-A' from public.show_payments where id = md5('v3a')::uuid)
  and not exists (select 1 from public.pennylane_avoirs where show_id = '00000000-0000-0000-0000-0000000a1003')
  and not exists (select 1 from public.reglements where show_id = '00000000-0000-0000-0000-0000000a1003'), 'variante 3 : aucun avoir ni remboursement créé ; facture d''acompte intacte');

-- ═══ facture émise au-delà du montant retenu ═══
select public.show_annuler('00000000-0000-0000-0000-0000000a1004', 2000, 'Maintien partiel', current_date - 1, null);
select pg_temp.ok((select amount = 2800 and invoice_number is not null and annulation is null from public.show_payments where id = md5('v4s')::uuid), 'au-delà : solde émis 2 800 € intact');
select pg_temp.ok(not public.annulation_relance_impaye('00000000-0000-0000-0000-0000000a1004')
  and not exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1004')), 'au-delà : 2 800 € réclamés > 800 € encore dus → relance d''impayé suspendue (À régulariser)');
select public.show_annuler('00000000-0000-0000-0000-0000000a1005', 4000, 'Maintien intégral', current_date - 1, null);
select pg_temp.ok(public.annulation_relance_impaye('00000000-0000-0000-0000-0000000a1005')
  and (select array_agg(r) = array['solde_paye'] from public.reminder_candidates('00000000-0000-0000-0000-0000000a1005')), 'maintien : 2 800 € réclamés = encore dus → seule la relance d''impayé reste');

-- ═══ booking et coréalisation : sans calcul ═══
do $$ begin
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1007', 600, 'essai', current_date, null); raise exception 'montant accepté en booking';
  exception when raise_exception then if sqlerrm not like 'Pas de montant%' then raise; end if; raise notice 'ok : booking : pas de montant'; end;
end $$;
-- facture faite non envoyée : « Facture à envoyer » seulement si elle correspond au montant retenu (pas de facturé au-delà)
select public.show_annuler('00000000-0000-0000-0000-0000000a1009', 2000, 'Maintien partiel', current_date - 1, null);
select public.show_annuler('00000000-0000-0000-0000-0000000a1010', 4000, 'Maintien total', current_date - 1, null);
select pg_temp.ok(public.annulation_depasse('00000000-0000-0000-0000-0000000a1009')
  and not exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1009')), 'au-delà, non envoyée : facture à régulariser, sans relance « à envoyer »');
select pg_temp.ok(not public.annulation_depasse('00000000-0000-0000-0000-0000000a1010')
  and (select array_agg(r) = array['facture_envoi'] from public.reminder_candidates('00000000-0000-0000-0000-0000000a1010')), 'maintien, non envoyée : « Facture à envoyer » gardée');
select public.show_annuler('00000000-0000-0000-0000-0000000a1007', null, 'Festival annulé', current_date, null);
select pg_temp.ok((select regime = 'booking' from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1007')
  and (select amount = 600 and annulation is null from public.show_payments where id = '00000000-0000-0000-0000-0000000b1007')
  and not exists (select 1 from public.reminder_candidates('00000000-0000-0000-0000-0000000a1007')), 'booking : commission gardée (à revoir), relance suspendue');
select public.show_annuler('00000000-0000-0000-0000-0000000a1008', null, 'Salle fermée', current_date, null);
select pg_temp.ok((select regime = 'corea' from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1008')
  and (select count(*) = 0 from public.show_payments where show_id = '00000000-0000-0000-0000-0000000a1008' and annulation is not null)
  and (select amount is null from public.show_payments where id = md5('v8s')::uuid), 'coréalisation : motif enregistré, lignes inchangées (sans calcul)');

-- ═══ gardes après annulation ═══
do $$ begin
  begin update public.shows set status = 'Confirmée Salle' where id = '00000000-0000-0000-0000-0000000a1001'; raise exception 'statut changé';
  exception when raise_exception then if sqlerrm not like 'Date annulée avec une fiche%' then raise; end if; raise notice 'ok : statut d''une date annulée : seulement « Rétablir »'; end;
  begin update public.show_payments set amount = 1000 where id = md5('v1s')::uuid; raise exception 'montant changé';
  exception when raise_exception then if sqlerrm not like 'Montant fixé par l''annulation%' then raise; end if; raise notice 'ok : montant recalculé : seulement « Corriger l''annulation »'; end;
  begin update public.show_payments set invoice_number = 'F-X-v2-S' where id = md5('v2s')::uuid; raise exception 'ligne abandonnée émise';
  exception when raise_exception then if sqlerrm not like 'Cette ligne ne doit plus être émise%' then raise; end if; raise notice 'ok : ligne abandonnée : ne s''émet pas'; end;
  begin update public.show_payments set annulation = null where id = md5('v2s')::uuid; raise exception 'marque retirée';
  exception when raise_exception then if sqlerrm not like 'Le marquage d''annulation%' then raise; end if; raise notice 'ok : marque d''annulation protégée'; end;
  begin delete from public.show_payments where id = md5('v2s')::uuid; raise exception 'ligne supprimée';
  exception when raise_exception then if sqlerrm not like 'Ligne fixée par l''annulation%' then raise; end if; raise notice 'ok : ligne abandonnée non supprimable'; end;
  begin insert into public.show_payments (show_id, kind, label, pct, sort) values ('00000000-0000-0000-0000-0000000a1001', 'acompte', 'Acompte 2', 10, 5); raise exception 'acompte ajouté';
  exception when raise_exception then if sqlerrm not like 'Date annulée : aucune ligne de facturation%' then raise; end if; raise notice 'ok : ajout d''un acompte refusé'; end;
  begin insert into public.show_payments (show_id, kind, label, amount, sort) values ('00000000-0000-0000-0000-0000000a1001', 'autre', 'Frais', 100, 6); raise exception 'autre ligne ajoutée';
  exception when raise_exception then if sqlerrm not like 'Date annulée : aucune ligne de facturation%' then raise; end if; raise notice 'ok : ajout d''une « Autre ligne » refusé'; end;
  begin insert into public.show_payments (show_id, kind, label, pct, sort) values ('00000000-0000-0000-0000-0000000a1001', 'solde', 'Solde 2', 10, 7); raise exception 'solde ajouté';
  exception when raise_exception then if sqlerrm not like 'Date annulée : aucune ligne de facturation%' then raise; end if; raise notice 'ok : ajout d''un solde refusé'; end;
  begin update public.show_payments set kind = 'autre' where id = md5('v1c')::uuid; raise exception 'commission changée en autre ligne';
  exception when raise_exception then if sqlerrm not like 'Date annulée : aucune ligne de facturation%' then raise; end if; raise notice 'ok : changement de nature vers une ligne de facturation refusé'; end;
  begin update public.show_payments set show_id = '00000000-0000-0000-0000-0000000a1001' where show_id = '00000000-0000-0000-0000-0000000a1006' and kind = 'acompte'; raise exception 'ligne rattachée';
  exception when raise_exception then if sqlerrm not like 'Date annulée : aucune ligne de facturation%' then raise; end if; raise notice 'ok : rattachement d''une ligne à une date annulée refusé'; end;
  begin insert into public.show_payments (show_id, kind, label, pct, sort, annulation) values ('00000000-0000-0000-0000-0000000a1006', 'acompte', 'Acompte', 10, 9, 'recalculee'); raise exception 'marque posée';
  exception when raise_exception then if sqlerrm not like 'Le marquage d''annulation%' then raise; end if; raise notice 'ok : marque d''annulation non posable à la création'; end;
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1001', 0, 'x', current_date, null); raise exception 'seconde fiche';
  exception when raise_exception then if sqlerrm not like 'Date déjà en « Annulée »%' then raise; end if; raise notice 'ok : une seule fiche'; end;
end $$;

-- ═══ correction : motif obligatoire, avant / après ═══
do $$ begin
  begin perform public.annulation_corriger((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1003'), 1200, 'Annulation', current_date, null, ' '); raise exception 'correction sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif de la correction obligatoire%' then raise; end if; raise notice 'ok : correction sans motif refusée'; end;
end $$;
select public.annulation_corriger((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1003'), 2000, 'Avenant : 50 %', current_date, 'Avenant signé', 'Avenant reçu');
select pg_temp.ok((select amount = 800 and annulation = 'recalculee' from public.show_payments where id = md5('v3s')::uuid), 'correction : 0 € → 2 000 € : solde de 800 € à émettre');
select pg_temp.ok((select montant_du_ht = 2000 and corrige_par = 'equipe@exemple.test' from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1003')
  and (select avant ->> 'montant_du_ht' = '0.00' and apres ->> 'montant_du_ht' = '2000.00' and motif = 'Avenant reçu' from public.annulations_journal
       where show_id = '00000000-0000-0000-0000-0000000a1003' and action = 'corriger'), 'correction : trace avant / après, motif');
select pg_temp.ok((select (e ->> 'montant_initial')::numeric = 2800 from public.annulations a, jsonb_array_elements(a.lignes) e
  where a.show_id = '00000000-0000-0000-0000-0000000a1003' and e ->> 'payment_id' = md5('v3s')::uuid::text), 'correction : montant initial du solde toujours 2 800 €');

-- ═══ rétablir ═══
-- solde de 800 € émis depuis l'annulation → rétablir refusé, dossier gardé à régulariser
update public.show_payments set invoice_number = 'F-X-v1-S', invoiced_on = current_date where id = md5('v1s')::uuid;
select pg_temp.ok((select array_agg(r) = array['facture_envoi'] from public.reminder_candidates('00000000-0000-0000-0000-0000000a1001')),
  'solde recalculé émis (800 € = montant retenu) : « Facture à envoyer » prend le relais de « Facture de solde à faire »');
update public.show_payments set sent_at = current_date where id = md5('v1s')::uuid;
select pg_temp.ok((select array_agg(r) = array['solde_paye'] from public.reminder_candidates('00000000-0000-0000-0000-0000000a1001')),
  'solde recalculé envoyé : relance d''impayé (800 € réclamés = encore dus)');
select pg_temp.ok((select amount = 800 from public.show_payments where id = md5('v1s')::uuid), 'solde de 800 € émis : montant inchangé');
do $$ begin
  begin perform public.annulation_retablir((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1001'), 'essai'); raise exception 'rétabli';
  exception when raise_exception then if sqlerrm not like 'Une facture, un avoir, un paiement%' then raise; end if; raise notice 'ok : rétablir refusé après une émission'; end;
  begin perform public.annulation_retablir((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1002'), ''); raise exception 'sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : rétablir sans motif refusé'; end;
end $$;
select pg_temp.ok((select status from public.shows where id = '00000000-0000-0000-0000-0000000a1001') = 'Annulée', 'rétablir refusé : date toujours à régulariser');
-- variante 2, rien ajouté ni modifié : rétablie
select public.annulation_retablir((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1002'), 'Annulation saisie par erreur');
select pg_temp.ok((select status from public.shows where id = '00000000-0000-0000-0000-0000000a1002') = 'Confirmée Salle'
  and (select amount is null and annulation is null and pct = 70 from public.show_payments where id = md5('v2s')::uuid)
  and (select retablie_par = 'equipe@exemple.test' from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1002'), 'rétablie : statut d''avant, solde calculé de nouveau, fiche gardée');
select pg_temp.ok(public.payment_amount_now((select x from public.show_payments x where id = md5('v2s')::uuid)) = 2800, 'rétablie : solde de 2 800 € (cession − acompte)');
-- date rétablie : l'ajout d'une ligne redevient possible (garde limitée aux fiches actives)
insert into public.show_payments (id, show_id, kind, label, amount, sort) values (md5('v2x')::uuid, '00000000-0000-0000-0000-0000000a1002', 'autre', 'Frais', 100, 6);
select pg_temp.ok(exists (select 1 from public.show_payments where id = md5('v2x')::uuid), 'rétablie : ajout d''une « Autre ligne » de nouveau possible');
delete from public.show_payments where id = md5('v2x')::uuid;
-- un encaissement ajouté depuis → refus
select public.show_annuler('00000000-0000-0000-0000-0000000a1002', 1200, 'Acompte conservé (de nouveau)', current_date, null);
select public.reglement_saisir(md5('v2a')::uuid, 'remboursement', 'a_faire', 100, null, null, 'Geste commercial', null);
do $$ begin
  begin perform public.annulation_retablir((select id from public.annulations where show_id = '00000000-0000-0000-0000-0000000a1002' and retablie_at is null), 'essai'); raise exception 'rétabli';
  exception when raise_exception then if sqlerrm not like 'Une facture, un avoir, un paiement%' then raise; end if; raise notice 'ok : rétablir refusé après un remboursement saisi'; end;
end $$;

-- ═══ droits ═══
select pg_temp.ok(not has_function_privilege('anon', 'public.show_annuler(uuid, numeric, text, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.show_annuler(uuid, numeric, text, date, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.annulation_appliquer(uuid, numeric)', 'execute')
  and not has_function_privilege('authenticated', 'public.show_engagee(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.annulation_relance_impaye(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.annulation_depasse(uuid)', 'execute')
  and not has_table_privilege('authenticated', 'public.annulations', 'insert') and not has_table_privilege('anon', 'public.annulations', 'select'), 'droits : équipe seulement, écriture par les fonctions');
set request.jwt.claims = '{}';
do $$ begin
  begin perform public.show_annuler('00000000-0000-0000-0000-0000000a1005', 0, 'x', current_date, null); raise exception 'hors équipe accepté';
  exception when raise_exception then if sqlerrm <> 'Accès refusé' then raise; end if; raise notice 'ok : hors équipe refusé'; end;
end $$;
set request.jwt.claims = '{"email":"equipe@exemple.test"}';
\echo ESSAI v1.72 : tout est conforme
