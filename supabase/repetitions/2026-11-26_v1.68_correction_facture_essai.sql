-- Essai LOCAL de la migration v1.68 (base PostgreSQL jetable, jamais Supabase) : psql -v ON_ERROR_STOP=1 -f ce_fichier
-- Crée le strict nécessaire (tables, is_team, auth.jwt, payment_is_emitted, protection v1.56.9 lue dans son fichier), applique la
-- migration DEUX fois, puis contrôle le parcours « Déverrouiller pour corriger ».
-- Préparer d'abord /tmp/guard168.sql : la définition de show_payments_emitted_guard de la v1.56.9, extraite telle quelle de
-- supabase/migrations/2026-11-07_v1.56.9_rattachement_pennylane.sql (du « CREATE OR REPLACE FUNCTION public.show_payments_emitted_guard() »
-- jusqu'au « $function$ » de fin, suivi de « ; »). Son empreinte locale doit être celle de la production (affichée ci-dessous).
\set ON_ERROR_STOP 1
create schema if not exists auth;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
create or replace function auth.jwt() returns jsonb language sql as $$ select '{"email":"anthony@essai.test"}'::jsonb $$;
create or replace function public.is_team() returns boolean language sql as $$ select coalesce(current_setting('essai.team', true), 'on') = 'on' $$;
create table public.shows (id uuid primary key, project_id uuid, prod_mode text, fee_ht numeric);
create table public.show_payments (id uuid primary key default gen_random_uuid(), show_id uuid references public.shows(id) on delete cascade, kind text, label text,
  pct numeric, amount numeric, invoice_number text, sent_at date, paid_at date, vat_rate numeric, payee text, pennylane_id text, pennylane_url text, hors_calcul text, sort int);
create or replace function public.payment_is_emitted(p public.show_payments) returns boolean language sql stable as $$
  select p.hors_calcul is null and case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end $$;
create or replace function public.commission_transferred(uuid) returns numeric language sql as $$ select 0::numeric $$;
create table public.finance_log (id bigint generated always as identity primary key, row_id uuid, field text, source text, old_value text, new_value text);
\i /tmp/guard168.sql
create trigger show_payments_emitted_guard before delete or update on public.show_payments for each row execute function public.show_payments_emitted_guard();
select md5(pg_get_functiondef('public.show_payments_emitted_guard'::regproc)) as empreinte_locale \gset
\echo empreinte locale de la protection : :empreinte_locale (production : 08302c0ce88a5f10bc6d386c689ee5c8)

insert into public.shows values ('00000000-0000-0000-0000-0000000000a1', null, 'production', 10000), ('00000000-0000-0000-0000-0000000000b1', null, 'booking', 5000);
insert into public.show_payments (id, show_id, kind, label, pct, amount, invoice_number, sent_at, paid_at, vat_rate, payee, pennylane_id, pennylane_url) values
 ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'acompte', 'Acompte', 30, 3000, 'F-2026-101', '2026-10-01', null, null, 'compte', 'pl-101', 'https://pl/101'),
 ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'solde', 'Solde', null, 7000, 'F-2026-102', '2026-10-05', '2026-10-20', 5.5, 'compte', 'pl-102', null),
 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'artbo', 'Commission', 15, 1500, null, null, '2026-10-21', null, null, null, null),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'artbo', 'Commission booking', 15, 750, 'F-2026-103', '2026-10-02', null, null, null, null, null),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'autre', 'Non émise', null, 100, null, null, null, null, null, null, null),
 ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b1', 'acompte', 'Acompte de l''artiste (booking)', 20, 1000, 'A-1', '2026-10-01', null, null, null, null, null);

\i supabase/migrations/2026-11-26_v1.68_correction_facture.sql
\i supabase/migrations/2026-11-26_v1.68_correction_facture.sql

create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.refus(q text, attendu text) returns void language plpgsql as $$
begin execute q; raise exception 'ÉCHEC : accepté alors que refus attendu (%)', attendu;
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  if position(attendu in sqlerrm) = 0 then raise exception 'ÉCHEC : message inattendu « % » (attendu : %)', sqlerrm, attendu; end if;
  raise notice 'ok : refusé — %', sqlerrm; end $$;

select pg_temp.ok((select count(*) from regexp_matches(pg_get_functiondef('public.show_payments_emitted_guard'::regproc), 'v1.68 : CORRECTION', 'g')) = 1, 'bloc v1.68 inséré une seule fois (migration rejouée)');
-- verrou par défaut : modification directe toujours refusée
select pg_temp.refus($$update public.show_payments set amount = 3500 where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se modifient plus');
-- motif obligatoire
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3500, 35, null, null, '   ')$$, 'Motif obligatoire');
-- correction d'une facture émise non payée : montant, %, TVA, type
select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3500, 35, 5.5, 'acompte', 'Facture Pennylane émise à 35 %');
select pg_temp.ok((select amount = 3500 and pct = 35 and vat_rate = 5.5 and invoice_number = 'F-2026-101' and sent_at = '2026-10-01' and pennylane_id = 'pl-101'
  and pennylane_url = 'https://pl/101' and payee = 'compte' from public.show_payments where id = '00000000-0000-0000-0000-000000000001'), 'corrigée ; n°, envoi, Pennylane et destinataire inchangés');
select pg_temp.ok((select count(*) = 1 and bool_and(motif = 'Facture Pennylane émise à 35 %' and actor = 'anthony@essai.test' and (before ->> 'amount')::numeric = 3000
  and (after ->> 'amount')::numeric = 3500) from public.facture_corrections where payment_id = '00000000-0000-0000-0000-000000000001'), 'historique : auteur, motif, avant / après');
-- reverrouillée : nouvelle modification directe refusée
select pg_temp.refus($$update public.show_payments set amount = 3600 where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se modifient plus');
-- facture payée : correction permise, statut et date de paiement gardés ; changement de type solde → autre
select public.facture_corriger('00000000-0000-0000-0000-000000000002', 6900, null, 5.5, 'autre', 'Ligne mal typée');
select pg_temp.ok((select kind = 'autre' and amount = 6900 and paid_at = '2026-10-20' from public.show_payments where id = '00000000-0000-0000-0000-000000000002'), 'payée : corrigée, paiement conservé');
-- commission en booking : montant oui, type non
select public.facture_corriger('00000000-0000-0000-0000-000000000004', 800, 16, 20, null, 'Facture de commission à 16 %');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000004', 800, 16, 20, 'autre', 'x')$$, 'seuls acompte, solde et autre');
-- refus : commission de production, ligne non émise, aucun changement, valeurs hors bornes, hors équipe
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000003', 1600, 16, null, null, 'x')$$, 'Commission de production');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000005', 200, null, null, null, 'x')$$, 'pas encore émise');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3500, 35, 5.5, 'acompte', 'x')$$, 'Aucun changement');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', -1, 35, 5.5, null, 'x')$$, 'Montant HT');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3500, 35, 150, null, 'x')$$, 'TVA entre');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 'NaN'::numeric, 35, 5.5, null, 'x')$$, 'Montant HT');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 'Infinity'::numeric, 35, 5.5, null, 'x')$$, 'Montant HT');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 1e30, 35, 5.5, null, 'x')$$, 'Montant HT');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3600, 'NaN'::numeric, 5.5, null, 'x')$$, 'du cachet entre');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3600, 35, 5.5, null, E'\n\t \r')$$, 'Motif obligatoire');
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000006', 1000, 20, null, null, 'x')$$, 'Date en booking');
set essai.team = 'off';
select pg_temp.refus($$select public.facture_corriger('00000000-0000-0000-0000-000000000001', 3700, 35, 5.5, null, 'x')$$, 'Réservé');
set essai.team = 'on';
-- l'annonce seule ne permet pas d'effacer le n°, l'envoi, le paiement, Pennylane, ni de changer la date
begin;
select set_config('matrice.regularisation', 'correction_facture', true);
select pg_temp.refus($$update public.show_payments set amount = 1, invoice_number = null where id = '00000000-0000-0000-0000-000000000001'$$, 'ne s’effacent pas');
select pg_temp.refus($$update public.show_payments set amount = 1, show_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se modifient plus');
select pg_temp.refus($$update public.show_payments set amount = 1, payee = 'autre compte' where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se modifient plus');
select pg_temp.refus($$update public.show_payments set amount = 1, paid_at = '2026-11-01' where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se modifient plus');
rollback;
-- suppression toujours refusée
select pg_temp.refus($$delete from public.show_payments where id = '00000000-0000-0000-0000-000000000001'$$, 'ne se supprime pas');
select pg_temp.ok((select count(*) = 3 from public.facture_corrections), 'trois corrections tracées, aucune pour les refus');
\echo BILAN v1.68 : tous les contrôles sont passés
