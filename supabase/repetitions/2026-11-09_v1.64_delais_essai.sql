-- v1.64 — ESSAI « Délais et automatismes » sur BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production).
-- Préalable : base locale v1.60.3 (2026-11-07_v1.60.3_suppression_date_base_locale.sql + migration v1.60.3) puis migration v1.60.6.
-- Lancer depuis la racine du dépôt : psql -v ON_ERROR_STOP=1 -d essai -f supabase/repetitions/2026-11-09_v1.64_delais_essai.sql
-- Tout est annulé (rollback). Données fictives. Contrôles :
--  1. sans réglage : mêmes relances, mêmes clés anti-doublon, mêmes échéances qu'en v1.60.6 (toutes les règles) ; aucune notification
--     nouvelle après la migration ; migration rejouée sans effet ;
--  2. délai modifié pour toutes les dates : échéance déplacée, clé inchangée (pas de doublon) ; relance désactivée : plus de candidat ;
--  3. délai modifié pour les nouvelles dates seulement (from) : dates existantes inchangées ;
--  4. contrôle à l'écriture (contrainte) ; réglage abîmé (30 février, 9999-99-99, an 0, n = 5.0…) : valeurs par défaut ou version
--     ignorée, generate_reminders ne s'arrête pas ;
--  5. priorité de la date : prochaine échéance choisie à la réactivation (reminders_next) gardée.
begin;
-- table des réglages (absente de la base locale minimale ; même structure que supabase/schema.sql)
create table if not exists public.settings (key text primary key, value jsonb not null);
create temp table avant as
  select c.r, c.show_id, c.r || ':' || c.k || ':' || c.raw || coalesce(':a' || c.reactiv, '') cle,
         greatest(case when c.w then public.workday(c.raw) when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int else c.raw end, (c.nxt ->> c.r)::date) due, c.t
  from public.reminder_candidates(null, true) c where false;
do $e$
declare t date := (now() at time zone 'Europe/Paris')::date; p uuid := gen_random_uuid();
begin
  insert into projects (id, name) values (p, 'ESSAI délais');
  -- dates couvrant toutes les règles (production) + une date en booking
  insert into shows (id, project_id, venue, date, status, prod_mode, conf_kit_sent, precontract_done, contract_sent, contract_signed, contract_cosigned_sent, created_at) values
    ('00000000-0000-4000-a000-000000000001', p, 'Pré', t + 200, 'Confirmée Salle', 'production', t - 12, null, null, null, null, now() - interval '30 days'),
    ('00000000-0000-4000-a000-000000000002', p, 'Envoi', t + 150, 'Confirmée Salle', 'production', t - 30, t - 11, null, null, null, now() - interval '30 days'),
    ('00000000-0000-4000-a000-000000000003', p, 'Signé', t + 100, 'Confirmée Salle', 'production', t - 40, t - 30, t - 13, null, null, now() - interval '30 days'),
    ('00000000-0000-4000-a000-000000000004', p, 'Cosigné', t + 60, 'Confirmée Salle', 'production', t - 50, t - 40, t - 30, t - 14, null, now() - interval '30 days'),
    ('00000000-0000-4000-a000-000000000005', p, 'Factures', t + 20, 'Confirmée Festival', 'production', t - 90, t - 80, t - 70, t - 60, t - 50, now() - interval '30 days'),
    ('00000000-0000-4000-a000-000000000006', p, 'Booking', t + 40, 'Confirmée Salle', 'booking', null, null, null, null, t - 3, now() - interval '30 days');
  insert into show_payments (id, show_id, kind, label, pct, amount, invoice_number, invoiced_on, sent_at, paid_at, sort) values
    -- acompte pas fait (contrat envoyé) sur « Signé » ; solde pas fait sur « Cosigné » (J-7 à venir) et « Factures »
    ('00000000-0000-4000-b000-000000000031', '00000000-0000-4000-a000-000000000003', 'acompte', 'Acompte', 30, null, null, null, null, null, 1),
    ('00000000-0000-4000-b000-000000000032', '00000000-0000-4000-a000-000000000003', 'solde', 'Solde', 70, null, null, null, null, null, 2),
    ('00000000-0000-4000-b000-000000000041', '00000000-0000-4000-a000-000000000004', 'solde', 'Solde', 100, null, null, null, null, null, 1),
    -- « Factures » : acompte payé (encaissement), solde fait non envoyé (plancher J-7), autre ligne envoyée impayée, commission, partenaire
    ('00000000-0000-4000-b000-000000000051', '00000000-0000-4000-a000-000000000005', 'acompte', 'Acompte', 30, null, 'F-1', t - 40, t - 39, t - 20, 1),
    ('00000000-0000-4000-b000-000000000052', '00000000-0000-4000-a000-000000000005', 'solde', 'Solde', 70, null, 'F-2', t - 5, null, null, 2),
    ('00000000-0000-4000-b000-000000000053', '00000000-0000-4000-a000-000000000005', 'autre', 'Frais', null, 300, 'F-3', t - 30, t - 25, null, 3),
    ('00000000-0000-4000-b000-000000000054', '00000000-0000-4000-a000-000000000005', 'artbo', 'Commission', 15, 1500, null, null, null, null, 4),
    ('00000000-0000-4000-b000-000000000055', '00000000-0000-4000-a000-000000000005', 'partner', 'Partenaire', 5, null, null, null, null, null, 5),
    -- booking : commission pas faite (contrat co-signé) — et une commission faite non envoyée (facture à envoyer)
    ('00000000-0000-4000-b000-000000000061', '00000000-0000-4000-a000-000000000006', 'artbo', 'Commission', 15, null, null, null, null, null, 1);
  update shows set fee_ht = 10000 where id = '00000000-0000-4000-a000-000000000005';   -- commission L'ArtBo à verser
  -- booking : commission faite et envoyée, impayée (paiement à vérifier, règle booking_commission_payee) sur une 2e date
  insert into shows (id, project_id, venue, date, status, prod_mode, created_at) values ('00000000-0000-4000-a000-000000000007', p, 'Booking 2', t + 10, 'Confirmée Salle', 'booking', now() - interval '30 days');
  insert into show_payments (id, show_id, kind, label, pct, invoice_number, invoiced_on, sent_at, sort) values
    ('00000000-0000-4000-b000-000000000071', '00000000-0000-4000-a000-000000000007', 'artbo', 'Commission', 15, 'F-9', t - 20, t - 18, 1);
  insert into avant
    select c.r, c.show_id, c.r || ':' || c.k || ':' || c.raw || coalesce(':a' || c.reactiv, ''),
           greatest(case when c.w then public.workday(c.raw) when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int else c.raw end, (c.nxt ->> c.r)::date), c.t
    from public.reminder_candidates(null, true) c join shows sh on sh.id = c.show_id where sh.project_id = p;
  perform public.generate_reminders();
end $e$;
\i supabase/migrations/2026-11-09_v1.64_delais.sql
\i supabase/migrations/2026-11-09_v1.64_delais.sql
create temp view apres as
  select c.r, c.show_id, c.r || ':' || c.k || coalesce(':a' || c.reactiv, '') cle, c.raw,
         greatest(case when c.w then public.workday(c.raw) when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int else c.raw end, (c.nxt ->> c.r)::date) due, c.t
  from public.reminder_candidates(null, true) c join shows sh on sh.id = c.show_id join projects pr on pr.id = sh.project_id where pr.name = 'ESSAI délais';
do $e$
declare n int; m int; regles text; jour date := (now() at time zone 'Europe/Paris')::date;
  f uuid := '00000000-0000-4000-a000-000000000005'; pre uuid := '00000000-0000-4000-a000-000000000001';
begin
  -- 1. identique à la v1.60.6 sans réglage
  select count(*), string_agg(distinct r, ',' order by r) into n, regles from avant;
  if n < 15 then raise exception '1 : jeu d''essai incomplet (% relances : %)', n, regles; end if;
  select count(*) into m from (select r, show_id, cle, due, t from avant except select r, show_id, cle, due, t from apres) x;
  select count(*) + m into m from (select r, show_id, cle, due, t from apres except select r, show_id, cle, due, t from avant) x;
  if m <> 0 then raise exception '1 : % écart(s) avec la v1.60.6 sans réglage', m; end if;
  if public.generate_reminders() <> 0 then raise exception '1 : notifications nouvelles après la migration'; end if;
  raise notice '1 : % relances identiques (%)', n, regles;

  -- 2. délai modifié pour toutes les dates : paiement 10 → 5, précontrat 10 → 20 ; solde 7 → 14 ; boucle com désactivée
  insert into settings (key, value) values ('delais', jsonb_build_object(
    'paiement', jsonb_build_array(jsonb_build_object('on', true, 'n', 5, 'from', null)),
    'precontrat', jsonb_build_array(jsonb_build_object('on', true, 'n', 20, 'from', null)),
    'solde_envoi', jsonb_build_array(jsonb_build_object('on', true, 'n', 14, 'from', null)),
    'boucle_com', jsonb_build_array(jsonb_build_object('on', false, 'n', 0, 'from', null))))
  on conflict (key) do update set value = excluded.value;
  if (select raw from apres where r = 'autre_payee') <> jour - 25 + 5 then raise exception '2 : paiement %', (select raw from apres where r = 'autre_payee'); end if;
  if (select cle from apres where r = 'autre_payee') <> (select cle from avant where r = 'autre_payee') then raise exception '2 : clé paiement changée'; end if;
  if (select raw from apres where r = 'precontrat') <> jour - 12 + 20 then raise exception '2 : précontrat'; end if;
  if (select due from apres where r = 'solde_envoi' and show_id = '00000000-0000-4000-a000-000000000004')
     <> (jour + 60 - 14) - (case extract(isodow from jour + 60 - 14) when 6 then 1 when 7 then 2 else 0 end)::int then raise exception '2 : solde J-14'; end if;
  -- plancher de la facture de solde à envoyer : suit le délai du solde (J-14)
  if (select due from apres where r = 'facture_envoi' and show_id = f)
     <> greatest(public.workday(jour - 5 + 3), (jour + 20 - 14) - (case extract(isodow from jour + 20 - 14) when 6 then 1 when 7 then 2 else 0 end)::int) then raise exception '2 : plancher solde'; end if;
  if exists (select 1 from apres where r = 'boucle_com') then raise exception '2 : boucle com désactivée encore candidate'; end if;
  -- précontrat (déjà notifié à J+10) repoussé à J+20 : pas de doublon ; paiement (déjà notifié) avancé : pas de doublon
  if public.generate_reminders() <> 0 then raise exception '2 : doublon après changement de délai'; end if;
  select count(*) into n from notifications where kind = 'precontrat' and show_id = pre;
  if n <> 1 then raise exception '2 : % notifications précontrat', n; end if;

  -- 3. nouvelles dates seulement : paiement 5 à partir de demain → dates créées il y a 30 jours : défaut 10
  update settings set value = jsonb_build_object('paiement', jsonb_build_array(jsonb_build_object('on', true, 'n', 5, 'from', (jour + 1)::text))) where key = 'delais';
  if (select raw from apres where r = 'autre_payee') <> jour - 25 + 10 then raise exception '3 : date existante modifiée'; end if;
  -- version « toutes les dates » puis version « nouvelles dates » : la date existante garde la première
  update settings set value = jsonb_build_object('paiement', jsonb_build_array(jsonb_build_object('on', true, 'n', 8, 'from', null), jsonb_build_object('on', false, 'n', 8, 'from', (jour + 1)::text))) where key = 'delais';
  if (select raw from apres where r = 'autre_payee') <> jour - 25 + 8 then raise exception '3 : versions'; end if;
  if (public.delais_dossier(now() + interval '2 days') #>> '{paiement,on}')::boolean then raise exception '3 : nouvelle date : relance désactivée attendue'; end if;

  -- 4 bis. contrôle à l'écriture (contrainte settings_delais_valide) : valeurs refusées, valeurs justes acceptées (5.0 = entier)
  declare refus int := 0; v text; begin
    foreach v in array array['{"paiement": [{"on": true, "n": 5, "from": "2026-02-30"}]}', '{"paiement": [{"on": true, "n": 5, "from": "9999-99-99"}]}',
      '{"paiement": [{"on": true, "n": 5, "from": "0000-01-01"}]}', '{"paiement": [{"on": true, "n": 5.5}]}', '{"paiement": [{"on": true, "n": 400}]}',
      '{"boucle_accueil": [{"on": true, "n": 30}]}', '{"inconnue": [{"n": 1}]}', '{"paiement": "x"}', '"texte"', '{"paiement": [{"on": "oui", "n": 1}]}',
      '{"paiement": [{"on": true, "n": 1, "from": 20261101}]}'] loop
      begin update settings set value = v::jsonb where key = 'delais'; exception when check_violation then refus := refus + 1; end;
    end loop;
    if refus <> 11 then raise exception '4 bis : % refus sur 11', refus; end if;
  end;
  update settings set value = '{"paiement": [{"on": true, "n": 5.0, "from": null, "at": "x", "by": "y"}, {"on": false, "n": 2, "from": "2026-02-28"}]}'::jsonb where key = 'delais';
  if (public.delais_dossier(now() - interval '400 days') #>> '{paiement,n}')::int <> 5 then raise exception '4 bis : 5.0 non lu comme 5'; end if;

  -- 4. réglage abîmé (écrit avant la contrainte, ou contrainte retirée) : défauts, rien ne s'arrête — contrainte retirée DANS la
  -- transaction annulée pour l'essai seulement
  alter table settings drop constraint settings_delais_valide;
  -- relecture de 86d397e (B1) : jour impossible ou an 0 dans « from » → version ignorée, generate_reminders ne s'arrête pas ; n = 5.0 → 5
  foreach regles in array array['2026-02-30', '9999-99-99', '0000-01-01', '2026-13-01'] loop
    update settings set value = jsonb_build_object('paiement', jsonb_build_array(jsonb_build_object('on', true, 'n', 4, 'from', null),
      jsonb_build_object('on', false, 'n', 2, 'from', regles))) where key = 'delais';
    if (select raw from apres where r = 'autre_payee') <> jour - 25 + 4 then raise exception '4 : « from » % non ignoré', regles; end if;
    perform public.generate_reminders();
  end loop;
  update settings set value = '{"paiement": [{"on": true, "n": 5.0, "from": null}]}'::jsonb where key = 'delais';
  if (select raw from apres where r = 'autre_payee') <> jour - 25 + 5 then raise exception '4 : n = 5.0'; end if;
  update settings set value = '{"paiement": "x", "precontrat": [{"n": "abc"}, {"n": 9999}, 3, {"from": "demain", "n": 1}], "solde_envoi": [{"n": -2}]}'::jsonb where key = 'delais';
  if (select raw from apres where r = 'autre_payee') <> jour - 25 + 10 or (select raw from apres where r = 'precontrat') <> jour - 12 + 10 then raise exception '4 : défauts non gardés'; end if;
  if (public.delais_dossier(now()) #>> '{solde_envoi,n}')::int <> 7 then raise exception '4 : solde'; end if;
  perform public.generate_reminders();
  update settings set value = '"texte"'::jsonb where key = 'delais';
  if (public.delais_dossier(null) #>> '{paiement,n}')::int <> 10 then raise exception '4 : réglage non objet'; end if;
  perform public.generate_reminders();

  -- 5. priorité de la date : prochaine échéance choisie (reminders_next) plus tardive que le délai réglé
  update settings set value = jsonb_build_object('paiement', jsonb_build_array(jsonb_build_object('on', true, 'n', 1, 'from', null))) where key = 'delais';
  perform set_config('matrice.archive_rpc', 'on', true);
  update shows set reminders_next = jsonb_build_object('autre_payee', (jour + 30)::text) where id = f;
  perform set_config('matrice.archive_rpc', '', true);
  if (select due from apres where r = 'autre_payee') <> jour + 30 then raise exception '5 : plancher de la date perdu'; end if;
  raise notice 'ESSAI v1.64 : tout est conforme';
end $e$;
rollback;
