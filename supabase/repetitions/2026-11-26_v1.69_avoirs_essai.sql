-- Essai LOCAL de la migration v1.69 (base PostgreSQL jetable, jamais Supabase) : psql -v ON_ERROR_STOP=1 -v rc=<fichier> -f ce_fichier
-- <fichier> = reminder_candidates de la v1.61.1, extraite telle quelle de supabase/migrations/2026-11-10_v1.61.1_solde_prevu.sql (du
-- « create or replace function public.reminder_candidates » jusqu'au « $function$ » de fin, suivi de « ; ») : c'est le corps de
-- production (empreinte b713325bb648651b08d35b402795a39f, relevée le 26/11/2026). Données FICTIVES.
-- Contrôle : migration appliquée DEUX fois ; table (unicité, état ↔ ligne, montant positif, droits) ; avoir_couvert ; relances :
-- facture soldée par avoir → plus de « Paiement à vérifier » ni de « Facture à envoyer » ; avoir partiel → toujours suivie ;
-- avoir disparu de Pennylane ou « À rattacher » → ne compte pas ; aucune ligne show_payments modifiée.
\set ON_ERROR_STOP 1
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
-- comme Supabase : droits par défaut sur les nouvelles tables (la migration doit les retirer elle-même)
alter default privileges in schema public grant all on tables to anon, authenticated;
create or replace function public.is_team() returns boolean language sql as $$ select true $$;
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
create or replace function public.commission_total(public.show_payments) returns numeric language sql as $$ select 0::numeric $$;
create or replace function public.commission_transferred(uuid) returns numeric language sql as $$ select 0::numeric $$;
\i :rc
select md5(prosrc) = 'b713325bb648651b08d35b402795a39f' as corps_production from pg_proc where proname = 'reminder_candidates' \gset
\if :corps_production
\echo corps de reminder_candidates identique à la production
\else
\echo ÉCHEC : corps local différent de la production
select 1/0;
\endif

\i supabase/migrations/2026-11-26_v1.69_avoirs.sql
\i supabase/migrations/2026-11-26_v1.69_avoirs.sql

create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;

-- une date de production fictive, trois factures envoyées impayées il y a 30 jours, une facture faite non envoyée
insert into public.projects values ('00000000-0000-0000-0000-00000000aa01', 'Artiste fictif');
insert into public.shows (id, project_id, date, venue, city, status, prod_mode) values
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', current_date + 60, 'Salle fictive', 'Ville', 'Confirmée Salle', 'production');
insert into public.show_payments (id, show_id, kind, label, amount, invoice_number, sent_at, pennylane_id, sort, invoiced_on) values
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'acompte', 'Acompte total', 900, 'F-T-1', current_date - 30, 'pl-1', 1, current_date - 31),
 ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Partiel', 4200, 'F-T-2', current_date - 30, 'pl-2', 2, current_date - 31),
 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Disparu', 500, 'F-T-3', current_date - 30, 'pl-3', 3, current_date - 31),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Faite non envoyée', 300, 'F-T-4', null, 'pl-4', 4, current_date - 20);
create temp table avant as select * from public.show_payments;
create temp view paie as select t from public.reminder_candidates() where r in ('acompte_paye', 'autre_payee', 'facture_envoi');

select pg_temp.ok((select count(*) from paie) = 4, 'avant les avoirs : 3 « Paiement à vérifier » + 1 « Facture à envoyer »');

insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, credited_pennylane_id, etat, payment_id, show_id) values
 ('av-1', 'AV-1', 900, 'pl-1', 'rattache', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1'),
 ('av-2', 'AV-2', 1500, 'pl-2', 'rattache', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1'),
 ('av-4', 'AV-4', 300, 'pl-4', 'rattache', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1');
insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, credited_pennylane_id, etat, payment_id, show_id, gone_at) values
 ('av-3', 'AV-3', 500, 'pl-3', 'rattache', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', now());
insert into public.pennylane_avoirs (pennylane_id, invoice_number, amount_ht, credited_pennylane_id, etat, reason) values
 ('av-x', 'AV-X', 4200, 'pl-inconnue', 'a_rattacher', 'Facture d’origine reliée à aucune ligne de MATRICE');

select pg_temp.ok(public.avoir_couvert('00000000-0000-0000-0000-000000000001') = 900, 'avoir total : 900 couverts');
select pg_temp.ok(public.avoir_couvert('00000000-0000-0000-0000-000000000002') = 1500, 'avoir partiel : 1 500 couverts');
select pg_temp.ok(public.avoir_couvert('00000000-0000-0000-0000-000000000003') = 0, 'avoir disparu de Pennylane : ne compte pas');
select pg_temp.ok(not exists (select 1 from paie where t like '%Acompte total%'), 'facture soldée par avoir : plus de « Paiement à vérifier »');
select pg_temp.ok(exists (select 1 from paie where t like '%Partiel%'), 'avoir partiel : « Paiement à vérifier » maintenu');
select pg_temp.ok(exists (select 1 from paie where t like '%Disparu%'), 'avoir disparu : « Paiement à vérifier » maintenu');
select pg_temp.ok(not exists (select 1 from paie where t like '%Faite non envoyée%'), 'facture soldée par avoir : plus de « Facture à envoyer »');
select pg_temp.ok((select count(*) from paie) = 2, 'après les avoirs : 2 rappels restants');

-- contraintes : pas de doublon, état ↔ ligne, montant positif
do $$ begin
  begin insert into public.pennylane_avoirs (pennylane_id, amount_ht, etat) values ('av-1', 1, 'a_rattacher'); raise exception 'doublon accepté';
  exception when unique_violation then raise notice 'ok : doublon refusé'; end;
  begin insert into public.pennylane_avoirs (pennylane_id, amount_ht, etat) values ('av-9', 1, 'rattache'); raise exception 'rattaché sans ligne accepté';
  exception when check_violation then raise notice 'ok : « rattaché » sans ligne refusé'; end;
  begin insert into public.pennylane_avoirs (pennylane_id, amount_ht, etat) values ('av-8', -1, 'a_rattacher'); raise exception 'montant négatif accepté';
  exception when check_violation then raise notice 'ok : montant négatif refusé'; end;
  begin delete from public.show_payments where id = '00000000-0000-0000-0000-000000000001'; raise exception 'ligne avec avoir supprimée';
  exception when foreign_key_violation then raise notice 'ok : ligne avec avoir non supprimable'; end;
end $$;
-- droits : équipe en lecture seule, anonyme rien
select pg_temp.ok(has_table_privilege('authenticated', 'public.pennylane_avoirs', 'select') and not has_table_privilege('authenticated', 'public.pennylane_avoirs', 'insert')
  and not has_table_privilege('authenticated', 'public.pennylane_avoirs', 'update') and not has_table_privilege('anon', 'public.pennylane_avoirs', 'select'), 'droits : équipe lecture seule, anonyme aucun');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.pennylane_avoirs'::regclass), 'RLS active');
-- aucune ligne de facturation modifiée (aucun encaissement, aucun remboursement)
select pg_temp.ok(not exists (select * from public.show_payments except select * from avant) and not exists (select * from avant except select * from public.show_payments), 'show_payments inchangée');
\echo ESSAI v1.69 : tout est conforme
