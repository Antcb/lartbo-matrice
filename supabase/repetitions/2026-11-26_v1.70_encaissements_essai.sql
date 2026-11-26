-- Essai LOCAL de la migration v1.70 (base PostgreSQL jetable, jamais Supabase) : psql -v ON_ERROR_STOP=1 -v rc=<fichier> -f ce_fichier
-- <fichier> = reminder_candidates de la v1.61.1 (voir 2026-11-26_v1.69_avoirs_essai.sql) ; la v1.69 est appliquée d'abord : son corps
-- doit être celui de la production (empreinte 37b36adf92cc516bfe3dc751216d170a, relevée le 26/11/2026). Données FICTIVES.
-- Contrôle : migration v1.70 appliquée DEUX fois ; garde (corps inattendu → arrêt sans rien appliquer) ; table (contraintes, droits,
-- RLS) ; fonctions de saisie (refus : hors équipe, hors calcul, non émise, ligne non suivie, montant, date, compte) ; remboursement
-- à faire → fait ; annulation motivée sans effacement, jamais d'une ligne rapprochée ; commission à virer dès un encaissement PARTIEL
-- enregistré ; encaissement annulé → ne compte plus ; aucune ligne show_payments modifiée (E1).
\set ON_ERROR_STOP 1
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
alter default privileges in schema public grant all on tables to anon, authenticated;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
-- équipe : un courriel dans le jeton (simulé) ; sans courriel → hors équipe
create or replace function public.is_team() returns boolean language sql stable as $$ select coalesce(auth.jwt() ->> 'email', '') <> '' $$;
create table public.projects (id uuid primary key, name text);
create table public.shows (id uuid primary key, project_id uuid, date date, venue text, city text, status text, prod_mode text, archived_at timestamptz,
  reminders_suspended_at timestamptz, reminders_next jsonb, reminders_reactivated_at timestamptz, created_at timestamptz default now(),
  conf_kit_sent date, precontract_done date, contract_sent date, contract_signed date, contract_cosigned_sent date, boucle_tech date, boucle_com date);
create table public.show_payments (id uuid primary key default gen_random_uuid(), show_id uuid references public.shows(id) on delete cascade, kind text, label text,
  pct numeric, amount numeric, invoice_number text, sent_at date, paid_at date, pennylane_id text, hors_calcul text, sort int, reminded_at date,
  reminders_paused boolean not null default false, invoiced_on date, created_at timestamptz default now());
create or replace function public.delais_dossier(timestamptz) returns jsonb language sql as $$
  select jsonb_object_agg(k, jsonb_build_object('on', true, 'n', n)) from (values ('precontrat',10),('contrat_envoi',10),('contrat_signe',10),('contrat_cosigne',10),
    ('facture_acompte',10),('solde_envoi',7),('booking_commission',10),('facture_envoi',3),('paiement',10),('commission',10),('commission_partenaire',10),
    ('boucle_accueil',4),('boucle_com',10),('weekend_apres',0),('weekend_avant',0)) v(k, n) $$;
create or replace function public.commission_total(public.show_payments) returns numeric language sql as $$ select 300::numeric $$;
create or replace function public.commission_transferred(uuid) returns numeric language sql as $$ select 0::numeric $$;
-- payment_is_emitted : texte de la v1.44 (production)
create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  select p.hors_calcul is null and case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;
\i :rc
\i supabase/migrations/2026-11-26_v1.69_avoirs.sql
select md5(prosrc) = '37b36adf92cc516bfe3dc751216d170a' as corps_production from pg_proc where proname = 'reminder_candidates' \gset
\if :corps_production
\echo corps v1.69 de reminder_candidates identique à la production
\else
\echo ÉCHEC : corps local v1.69 différent de la production
select 1/0;
\endif

create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;

-- garde : un corps inattendu arrête la migration sans rien appliquer
alter function public.reminder_candidates(uuid, boolean) rename to rc_v169;
create function public.reminder_candidates(p_show uuid default null, p_all boolean default false) returns table (r text) language sql as $$ select 'autre'::text $$;
\set ON_ERROR_STOP 0
\echo (erreurs attendues ci-dessous : garde de la v1.70, puis transaction annulée)
\i supabase/migrations/2026-11-26_v1.70_encaissements.sql
\set ON_ERROR_STOP 1
select pg_temp.ok(to_regclass('public.reglements') is null and to_regprocedure('public.reglement_saisir(uuid, text, text, numeric, date, text, text, text)') is null
  and (select prosrc from pg_proc where proname = 'reminder_candidates') like '%''autre''%', 'garde : corps inattendu → migration arrêtée, rien appliqué');
drop function public.reminder_candidates(uuid, boolean);
alter function public.rc_v169(uuid, boolean) rename to reminder_candidates;

\i supabase/migrations/2026-11-26_v1.70_encaissements.sql
\i supabase/migrations/2026-11-26_v1.70_encaissements.sql
select pg_temp.ok(position('v1.70 (L2a)' in (select prosrc from pg_proc where proname = 'reminder_candidates')) > 0, 'migration appliquée deux fois (rejouable)');

-- données fictives : une coréalisation (acompte + solde, commission), une ligne hors calcul, une ligne non émise, un booking
insert into public.projects values ('00000000-0000-0000-0000-00000000aa01', 'Artiste fictif');
insert into public.shows (id, project_id, date, venue, city, status, prod_mode) values
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', current_date + 60, 'Salle fictive', 'Ville', 'Confirmée Salle', 'coréalisation'),
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000aa01', current_date + 60, 'Salle booking', 'Ville', 'Confirmée Salle', 'booking');
insert into public.show_payments (id, show_id, kind, label, amount, invoice_number, sent_at, pennylane_id, hors_calcul, sort, invoiced_on) values
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'acompte', 'Acompte', 4200, 'F-T-1', current_date - 30, 'pl-1', null, 1, current_date - 31),
 ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'solde', 'Solde', 1000, null, null, null, null, 2, null),
 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'artbo', 'Commission', 300, null, null, null, null, 3, null),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Hors calcul', 100, 'F-T-4', current_date - 30, 'pl-4', 'coproduction', 4, null),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', 'artbo', 'Commission booking', 500, 'F-T-5', current_date - 30, 'pl-5', null, 1, current_date - 31),
 ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b1', 'acompte', 'Acompte booking', 500, 'F-T-6', current_date - 30, 'pl-6', null, 2, current_date - 31);
create temp table avant as select * from public.show_payments;
create temp view com as select t from public.reminder_candidates() where r = 'commission';
select pg_temp.ok(not exists (select 1 from com), 'aucun encaissement : pas de commission à virer');

-- hors équipe : refusé
set request.jwt.claims = '{}';
do $$ begin
  begin perform public.reglement_saisir('00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', 100, current_date, 'compte', null, null); raise exception 'hors équipe accepté';
  exception when raise_exception then if sqlerrm <> 'Accès refusé' then raise; end if; raise notice 'ok : hors équipe refusé'; end;
end $$;
set request.jwt.claims = '{"email":"equipe@exemple.test"}';
-- refus de saisie
do $$
declare cas text[][] := array[
  ['00000000-0000-0000-0000-000000000004', 'encaissement', 'fait', '100', 'Ligne hors calcul%'],
  ['00000000-0000-0000-0000-000000000002', 'encaissement', 'fait', '100', 'Facture pas encore émise%'],
  ['00000000-0000-0000-0000-000000000003', 'encaissement', 'fait', '100', 'Cette ligne n''est pas une facture suivie%'],
  ['00000000-0000-0000-0000-000000000006', 'encaissement', 'fait', '100', 'Cette ligne n''est pas une facture suivie%'],
  ['00000000-0000-0000-0000-000000000001', 'encaissement', 'a_faire', '100', 'Type de mouvement invalide%'],
  ['00000000-0000-0000-0000-000000000001', 'avoir', 'fait', '100', 'Type de mouvement invalide%'],
  ['00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', '0', 'Montant TTC%'],
  ['00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', '-5', 'Montant TTC%'],
  ['00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', 'NaN', 'Montant TTC%'],
  ['00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', '100000000', 'Montant TTC%'],
  ['00000000-0000-0000-0000-000000000009', 'encaissement', 'fait', '100', 'Ligne de facturation introuvable%']];
  i int;
begin
  for i in 1 .. array_length(cas, 1) loop
    begin perform public.reglement_saisir(cas[i][1]::uuid, cas[i][2], cas[i][3], cas[i][4]::numeric, current_date, 'compte', null, null);
      raise exception 'saisie acceptée à tort : %', cas[i][5];
    exception when raise_exception then if sqlerrm not like cas[i][5] then raise; end if; raise notice 'ok : refus « % »', sqlerrm; end;
  end loop;
  begin perform public.reglement_saisir('00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', 100, null, 'compte', null, null); raise exception 'sans date accepté';
  exception when raise_exception then if sqlerrm not like 'Date du mouvement%' then raise; end if; raise notice 'ok : encaissement sans date refusé'; end;
  begin perform public.reglement_saisir('00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', 100, current_date, 'banque', null, null); raise exception 'compte inconnu accepté';
  exception when raise_exception then if sqlerrm <> 'Compte inconnu' then raise; end if; raise notice 'ok : compte inconnu refusé'; end;
end $$;
select pg_temp.ok(not exists (select 1 from public.reglements), 'refus : rien enregistré');

-- encaissement PARTIEL (2 000 € TTC le J-20) : commission à virer dès ce premier encaissement (Q14) ; la ligne reste impayée
select * from public.reglement_saisir('00000000-0000-0000-0000-000000000001', 'encaissement', 'fait', 2000.004, current_date - 20, 'compte', ' VIR-1 ', null) \gset e1_
select pg_temp.ok(:'e1_montant_ttc' = '2000.00' and :'e1_source' = 'manuel' and :'e1_created_by' = 'equipe@exemple.test' and :'e1_reference' = 'VIR-1', 'encaissement saisi : arrondi au centime, manuel, auteur, référence nettoyée');
select pg_temp.ok((select count(*) from com) = 1 and (select raw from public.reminder_candidates() where r = 'commission') = current_date - 10,
  'encaissement partiel enregistré → commission à virer, échéance J+10 du premier encaissement');
select pg_temp.ok(exists (select 1 from public.reminder_candidates() where r = 'acompte_paye'), 'facture partiellement encaissée : « Paiement à vérifier » maintenu (paid_at non écrit)');
-- booking : la commission est la facture suivie
select pg_temp.ok((select (public.reglement_saisir('00000000-0000-0000-0000-000000000005', 'encaissement', 'fait', 600, current_date - 2, 'artbo', null, null)).sens) = 'encaissement', 'booking : encaissement de la facture de commission accepté');

-- remboursement à faire puis fait (D10)
select * from public.reglement_saisir('00000000-0000-0000-0000-000000000001', 'remboursement', 'a_faire', 300, current_date, null, null, 'Trop-perçu') \gset rb_
select pg_temp.ok(exists (select 1 from public.reglements where id = :'rb_id' and etat = 'a_faire' and date is null and motif = 'Trop-perçu'), 'remboursement à faire : sans date, avec motif');
select * from public.reglement_effectuer(:'rb_id', current_date, 'compte', 'VIR-R') \gset rf_
select pg_temp.ok(:'rf_etat' = 'fait' and :'rf_date' = current_date::text and :'rf_reference' = 'VIR-R', 'remboursement effectué : date, compte, référence');
do $$ begin
  begin perform public.reglement_effectuer((select id from public.reglements where reference = 'VIR-R'), current_date, null, null); raise exception 'effectué deux fois';
  exception when raise_exception then if sqlerrm not like 'Remboursement introuvable%' then raise; end if; raise notice 'ok : remboursement déjà fait — refus'; end;
  begin perform public.reglement_effectuer((select id from public.reglements where reference = 'VIR-1'), current_date, null, null); raise exception 'encaissement « effectué »';
  exception when raise_exception then if sqlerrm not like 'Remboursement introuvable%' then raise; end if; raise notice 'ok : un encaissement ne passe pas par « effectuer »'; end;
end $$;

-- annulation : motif obligatoire, ligne gardée ; jamais une ligne rapprochée de Pennylane
do $$ begin
  begin perform public.reglement_annuler((select id from public.reglements where reference = 'VIR-1'), '  '); raise exception 'annulation sans motif';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : annulation sans motif refusée'; end;
  begin perform public.reglement_annuler((select id from public.reglements where reference = 'VIR-1'), repeat('x', 501)); raise exception 'motif trop long';
  exception when raise_exception then if sqlerrm not like 'Motif obligatoire%' then raise; end if; raise notice 'ok : motif de plus de 500 caractères refusé'; end;
end $$;
insert into public.reglements (payment_id, show_id, sens, montant_ttc, date, source, transaction_id, compte)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'encaissement', 500, current_date - 25, 'pennylane', 'tx-1', 'compte');
do $$ begin
  begin perform public.reglement_annuler((select id from public.reglements where transaction_id = 'tx-1'), 'erreur'); raise exception 'rapproché annulé';
  exception when raise_exception then if sqlerrm not like 'Seule une saisie manuelle%' then raise; end if; raise notice 'ok : un mouvement rapproché de Pennylane ne s''annule pas'; end;
end $$;
select pg_temp.ok((select raw from public.reminder_candidates() where r = 'commission') = current_date - 15, 'premier encaissement = le plus ancien (Pennylane J-25)');
delete from public.reglements where transaction_id = 'tx-1';   -- essai local uniquement
select * from public.reglement_annuler(:'e1_id', '  Saisie en double  ') \gset an_
select pg_temp.ok(:'an_annule_motif' = 'Saisie en double' and :'an_annule_par' = 'equipe@exemple.test' and (select count(*) from public.reglements where id = :'e1_id') = 1,
  'annulation : motif, auteur, ligne GARDÉE');
select pg_temp.ok(not exists (select 1 from com), 'encaissement annulé : ne compte plus (plus de commission à virer)');
do $$ begin
  begin perform public.reglement_annuler((select id from public.reglements where reference = 'VIR-1'), 'encore'); raise exception 'annulé deux fois';
  exception when raise_exception then if sqlerrm not like 'Seule une saisie manuelle%' then raise; end if; raise notice 'ok : déjà annulé — refus'; end;
end $$;

-- contraintes de la table
do $$
declare a uuid := '00000000-0000-0000-0000-000000000001'; sh uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  begin insert into public.reglements (payment_id, show_id, sens, montant_ttc, date, source, transaction_id) values (a, sh, 'encaissement', 1, current_date, 'pennylane', 'tx-2'),
    (a, sh, 'encaissement', 1, current_date, 'pennylane', 'tx-2'); raise exception 'virement en double accepté';
  exception when unique_violation then raise notice 'ok : un virement n''est enregistré qu''une fois (R1)'; end;
  begin insert into public.reglements (payment_id, show_id, sens, montant_ttc, source) values (a, sh, 'encaissement', 1, 'manuel'); raise exception 'fait sans date';
  exception when check_violation then raise notice 'ok : mouvement fait sans date refusé'; end;
  begin insert into public.reglements (payment_id, show_id, sens, etat, montant_ttc, source) values (a, sh, 'encaissement', 'a_faire', 1, 'manuel'); raise exception 'encaissement à faire';
  exception when check_violation then raise notice 'ok : « à faire » réservé aux remboursements'; end;
  begin insert into public.reglements (payment_id, show_id, sens, montant_ttc, date, source) values (a, sh, 'encaissement', 1, current_date, 'pennylane'); raise exception 'pennylane sans virement';
  exception when check_violation then raise notice 'ok : source Pennylane sans virement refusée'; end;
  begin insert into public.reglements (payment_id, show_id, sens, montant_ttc, date, source, annule_at) values (a, sh, 'encaissement', 1, current_date, 'manuel', now()); raise exception 'annulé sans motif';
  exception when check_violation then raise notice 'ok : annulation sans motif refusée (contrainte)'; end;
  begin delete from public.show_payments where id = a; raise exception 'ligne avec mouvements supprimée';
  exception when foreign_key_violation then raise notice 'ok : ligne avec mouvements non supprimable'; end;
end $$;

-- droits : équipe en lecture seule (écriture par les fonctions), anonyme rien
select pg_temp.ok(has_table_privilege('authenticated', 'public.reglements', 'select') and not has_table_privilege('authenticated', 'public.reglements', 'insert')
  and not has_table_privilege('authenticated', 'public.reglements', 'update') and not has_table_privilege('authenticated', 'public.reglements', 'delete')
  and not has_table_privilege('anon', 'public.reglements', 'select'), 'droits : équipe lecture seule, anonyme aucun');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.reglements'::regclass), 'RLS active');
select pg_temp.ok(has_function_privilege('authenticated', 'public.reglement_saisir(uuid, text, text, numeric, date, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.reglement_saisir(uuid, text, text, numeric, date, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.reglement_effectuer(uuid, date, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.reglement_annuler(uuid, text)', 'execute'), 'fonctions : équipe oui, anonyme non');
-- E1 : aucune ligne de facturation modifiée
select pg_temp.ok(not exists (select * from public.show_payments except select * from avant) and not exists (select * from avant except select * from public.show_payments), 'show_payments inchangée');
\echo ESSAI v1.70 : tout est conforme
