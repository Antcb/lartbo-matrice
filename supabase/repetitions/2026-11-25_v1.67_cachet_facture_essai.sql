-- v1.67 — essai de la migration 2026-11-25_v1.67_cachet_facture.sql sur une base locale JETABLE (données FICTIVES) :
-- psql -v ON_ERROR_STOP=1 -f ce_fichier (il crée le strict nécessaire, applique la migration DEUX fois, puis contrôle).
\set ON_ERROR_STOP 1
create table public.settings (key text primary key, value jsonb);
create table public.shows (id uuid primary key, project_id uuid, prod_mode text);
create table public.budget_lines (id uuid primary key default gen_random_uuid(), project_id uuid, show_id uuid, category text, label text, supplier text,
  auto text, payer text, sort int, unit_cost numeric, qty numeric);
create unique index budget_lines_show_auto_key on public.budget_lines (show_id, auto) where auto in ('movinmotion', 'cnm') and show_id is not null;
insert into public.settings values ('movinmotion_payslip_cost', '20');
insert into public.shows values ('00000000-0000-0000-0000-00000000000a', null, 'production'), ('00000000-0000-0000-0000-00000000000b', null, 'production');
-- ligne ancienne (avant la migration) : sera vide (= au cachet)
insert into public.budget_lines (show_id, category, label, qty, unit_cost) values ('00000000-0000-0000-0000-00000000000a', 'Staff', 'Cachets', 3, 250);
\i supabase/migrations/2026-11-25_v1.67_cachet_facture.sql
\i supabase/migrations/2026-11-25_v1.67_cachet_facture.sql
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
select pg_temp.ok((select pay_mode from public.budget_lines where label = 'Cachets') is null, 'ancienne ligne : mode vide (= au cachet), rien modifié');
do $$ begin insert into public.budget_lines (show_id, category, pay_mode) values ('00000000-0000-0000-0000-00000000000a', 'Staff', 'autre'); raise exception 'ÉCHEC : valeur interdite acceptée';
  exception when check_violation then raise notice 'ok : mode inconnu refusé'; end $$;
-- date A : ligne au cachet → ligne Movinmotion posée (une seule, même appelée deux fois)
select public.ensure_movinmotion('00000000-0000-0000-0000-00000000000a'); select public.ensure_movinmotion('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from public.budget_lines where show_id = '00000000-0000-0000-0000-00000000000a' and auto = 'movinmotion') = 1, 'cachet : une ligne Movinmotion, coût figé');
select pg_temp.ok((select unit_cost from public.budget_lines where show_id = '00000000-0000-0000-0000-00000000000a' and auto = 'movinmotion') = 20, 'coût par bulletin du réglage');
-- date B : seulement une ligne sur facture → aucune ligne Movinmotion
insert into public.budget_lines (show_id, category, label, qty, unit_cost, pay_mode) values ('00000000-0000-0000-0000-00000000000b', 'Staff', 'Bob', 1, 400, 'facture');
select public.ensure_movinmotion('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.budget_lines where show_id = '00000000-0000-0000-0000-00000000000b' and auto = 'movinmotion') = 0, 'facture seule : aucun bulletin, aucune ligne Movinmotion');
insert into public.budget_lines (show_id, category, label, qty, unit_cost, pay_mode) values ('00000000-0000-0000-0000-00000000000b', 'Staff', 'Alice', 1, 250, 'cachet');
select public.ensure_movinmotion('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.budget_lines where show_id = '00000000-0000-0000-0000-00000000000b' and auto = 'movinmotion') = 1, 'cachet ajouté : ligne Movinmotion posée');
\echo BILAN v1.67 : tous les contrôles sont passés
