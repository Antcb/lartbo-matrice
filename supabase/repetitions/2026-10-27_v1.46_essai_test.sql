-- =====================================================================================================
-- ESSAI v1.46 (lot V1.46a — Finances) — PROJET DE TEST UNIQUEMENT, dans une transaction ANNULÉE à la fin (rien n'est gardé).
-- Usage : ce fichier entoure la migration 2026-10-27_v1.46_finances.sql (insérée à la place de la ligne repère ci-dessous) :
--   begin ; garde « projet de test » ; migration ; scénarios avec contrôles (exception « ECHEC » = échec) ; bilan renvoyé par
--   une exception finale « ESSAI v1.46 RÉUSSI » qui annule tout (le rollback final ne sert qu'en lecture manuelle).
-- Données : uniquement des lignes fictives créées ici (artiste « ESSAI v1.46 »).
-- =====================================================================================================
begin;
do $g$ begin
  if exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ceci est la PRODUCTION — essai réservé au projet de test'; end if;
end $g$;

--@@MIGRATION@@

create temp table essai_bilan (n serial, quoi text);
do $e$
declare pa uuid; pb uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; v numeric; c int; x record; nb int; d date;
  ok text := '';
begin
  insert into projects (name, mode) values ('ESSAI v1.46 A', 'production') returning id into pa;
  insert into projects (name, mode, default_artbo_pct) values ('ESSAI v1.46 B', 'production', 12) returning id into pb;

  -- 1. acompte par défaut à 0 % : seul le solde (100 %) est créé, sans compte d'encaissement
  update settings set value = to_jsonb(0) where key = 'default_acompte_pct';
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id)
    values (pa, 'ESSAI 1', current_date + 60, 'Option Salle', 'Cession', 10000, 'production', 'essai') returning id into s1;
  update shows set status = 'Confirmée Salle' where id = s1;
  select count(*) into c from show_payments where show_id = s1 and kind = 'acompte';
  if c <> 0 then raise exception 'ECHEC 1 : acompte créé avec un réglage à 0 %%'; end if;
  select pct into v from show_payments where show_id = s1 and kind = 'solde';
  if v is distinct from 100 then raise exception 'ECHEC 1 : solde % au lieu de 100', v; end if;
  -- commission de la date : Réglages production (artiste A sans %)
  select artbo_pct into v from shows where id = s1;
  if v is distinct from public.default_commission_pct(s1, 'production') or v is null then raise exception 'ECHEC 1 : commission de la date %', v; end if;
  insert into essai_bilan (quoi) values ('1 acompte 0 % → solde seul 100 %, commission Réglages production ' || v || ' %');

  -- 2. réglage vide : 50 / 50 ; artiste B (12 %) : commission 12 %
  update settings set value = to_jsonb(''::text) where key = 'default_acompte_pct';
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id)
    values (pb, 'ESSAI 2', current_date + 60, 'Option Salle', 'Cession', 10000, 'production', 'essai') returning id into s2;
  update shows set status = 'Confirmée Salle' where id = s2;
  select string_agg(kind || '=' || coalesce(pct::text, '-') || '/' || coalesce(payee, 'vide'), ' ' order by sort) into ok from show_payments where show_id = s2;
  if ok not like 'acompte=50/vide solde=50/vide artbo=-/vide%' then raise exception 'ECHEC 2 : lignes %', ok; end if;
  select artbo_pct into v from shows where id = s2;
  if v <> 12 then raise exception 'ECHEC 2 : commission % au lieu de 12 (artiste)', v; end if;
  insert into essai_bilan (quoi) values ('2 réglage vide → ' || ok || ' ; commission artiste 12 %');

  -- 3. ensure_production_payments : lignes recréées sans compte d'encaissement ; réglage 30 → 30 / 70
  update settings set value = to_jsonb(30) where key = 'default_acompte_pct';
  delete from show_payments where show_id = s2 and kind in ('acompte', 'solde');
  perform public.ensure_production_payments(s2);
  select string_agg(kind || '=' || coalesce(pct::text, '-') || '/' || coalesce(payee, 'vide'), ' ' order by sort) into ok from show_payments where show_id = s2 and kind in ('acompte', 'solde');
  if ok <> 'acompte=30/vide solde=70/vide' then raise exception 'ECHEC 3 : %', ok; end if;
  insert into essai_bilan (quoi) values ('3 ensure_production_payments → ' || ok);

  -- 4. commission sans % sur la date : % de l'artiste (12 %), plus jamais 0 ; booking sans % d'artiste : Réglages booking
  update shows set artbo_pct = null where id = s2;
  select public.payment_amount_now(p) into v from show_payments p where show_id = s2 and kind = 'artbo';
  if v <> 1200 then raise exception 'ECHEC 4 : commission % au lieu de 1 200 (12 %% artiste)', v; end if;
  if public.default_commission_pct(s1, 'booking') is distinct from coalesce(case when nullif(btrim(setting_text('default_artbo_pct_booking')), '')::numeric > 0 then nullif(btrim(setting_text('default_artbo_pct_booking')), '')::numeric end, 15) then
    raise exception 'ECHEC 4 : défaut booking %', public.default_commission_pct(s1, 'booking'); end if;
  insert into essai_bilan (quoi) values ('4 commission sans % de date → ' || v || ' € (artiste 12 %) ; défaut booking ' || public.default_commission_pct(s1, 'booking') || ' %');

  -- 5. jour de la facture : posé quand la ligne devient une facture (numéro) ; jamais sur une ligne déjà numérotée
  update show_payments set invoice_number = 'ESSAI-1' where show_id = s2 and kind = 'acompte';
  select invoiced_on into d from show_payments where show_id = s2 and kind = 'acompte';
  if d is distinct from (now() at time zone 'Europe/Paris')::date then raise exception 'ECHEC 5 : invoiced_on %', d; end if;
  update show_payments set invoiced_on = null where show_id = s2 and kind = 'acompte';   -- simule une ligne historique numérotée
  update show_payments set pennylane_id = 'essai-99' where show_id = s2 and kind = 'acompte';
  select invoiced_on into d from show_payments where show_id = s2 and kind = 'acompte';
  if d is not null then raise exception 'ECHEC 5 : ligne historique datée %', d; end if;
  insert into essai_bilan (quoi) values ('5 invoiced_on posé au premier numéro, jamais sur une ligne déjà numérotée');

  -- 6. rappels : facture faite non envoyée (5 jours) ; impayées sans limite de 120 jours ; relances suspendues ; booking
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id, artbo_pct)
    values (pa, 'ESSAI 6', current_date - 400, 'Confirmée Salle', 'Cession', 8000, 'production', 'essai', 15) returning id into s4;
  delete from show_payments where show_id = s4;
  insert into show_payments (show_id, kind, label, pct, sort, invoice_number, invoiced_on) values (s4, 'acompte', 'Acompte 1', 30, 1, 'ESSAI-A1', current_date - 7);
  insert into show_payments (show_id, kind, label, pct, sort, invoice_number, sent_at) values (s4, 'acompte', 'Acompte 2', 20, 2, 'ESSAI-A2', current_date - 405);
  insert into show_payments (show_id, kind, label, amount, sort, invoice_number, sent_at) values (s4, 'autre', 'Frais', 300, 3, 'ESSAI-O', current_date - 401);
  insert into show_payments (show_id, kind, label, pct, sort, invoice_number, sent_at, reminders_paused) values (s4, 'solde', 'Solde', 50, 4, 'ESSAI-S', current_date - 400, true);
  insert into projects (name, mode) values ('ESSAI v1.46 C', 'booking') returning id into pa;
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id, artbo_pct)
    values (pa, 'ESSAI 7', current_date - 300, 'Confirmée Salle', 'Cession', 5000, 'booking', 'essai', 15) returning id into s5;
  delete from show_payments where show_id = s5;
  insert into show_payments (show_id, kind, label, pct, sort, invoice_number, sent_at) values (s5, 'solde', 'Solde artiste', 100, 1, 'ART-1', current_date - 300);
  insert into show_payments (show_id, kind, label, sort, invoice_number, sent_at) values (s5, 'artbo', 'Commission', 2, 'ESSAI-C', current_date - 290);
  nb := public.generate_reminders();
  select string_agg(title, ' | ' order by title) into ok from notifications where show_id in (s4, s5);
  if ok is null
     or position('Facture à envoyer : Acompte 1 (ESSAI-A1) — ESSAI 6' in ok) = 0
     or position('Paiement à vérifier : Acompte 2 (ESSAI-A2) — ESSAI 6' in ok) = 0
     or position('Paiement à vérifier : Frais (ESSAI-O) — ESSAI 6' in ok) = 0
     or position('ESSAI-S' in ok) > 0
     or position('Paiement à vérifier : Commission (ESSAI-C) — ESSAI 7' in ok) = 0
     or position('ART-1' in ok) > 0 then
    raise exception 'ECHEC 6 : notifications %', ok; end if;
  -- relancée deux fois de suite : une seule notification par échéance
  c := public.generate_reminders();
  select count(*) into c from notifications where show_id in (s4, s5);
  if c <> 4 then raise exception 'ECHEC 6 : % notifications au lieu de 4 après une seconde exécution', c; end if;
  -- clé de la première ligne inchangée (compatibilité) : acompte_paye:<date>:<échéance> ; autres lignes : :<ligne>
  select string_agg(split_part(dedupe_key, ':', 1) || ':' || (case when array_length(string_to_array(dedupe_key, ':'), 1) > 3 then 'ligne' else 'date' end), ' ' order by dedupe_key) into ok
    from notifications where show_id in (s4, s5);
  insert into essai_bilan (quoi) values ('6 rappels → ' || nb || ' notification(s) créées en tout (dont données du projet de test), clés : ' || ok);
  insert into essai_bilan (quoi) values ('6 libellés : ' || (select string_agg(title, ' | ' order by title) from notifications where show_id in (s4, s5)));

  -- 7. payée : plus de rappel à la prochaine échéance ; date d'envoi saisie : « Paiement à vérifier » remplace « Facture à envoyer »
  update show_payments set sent_at = current_date - 12 where show_id = s4 and label = 'Acompte 1';
  perform public.generate_reminders();
  select count(*) into c from notifications where show_id = s4 and title like 'Paiement à vérifier : Acompte 1 (ESSAI-A1)%';
  if c <> 1 then raise exception 'ECHEC 7 : % rappel(s) de paiement après envoi', c; end if;
  insert into essai_bilan (quoi) values ('7 date d’envoi saisie → rappel de paiement 10 jours après');
end $e$;

-- droits : identiques à la production (relevés le 27/10/2026)
insert into essai_bilan (quoi)
select p.proname || ' ' || coalesce(array_to_string(p.proacl, ','), 'défaut') || case when p.prosecdef then ' definer' else '' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('on_show_confirmed', 'ensure_production_payments', 'generate_reminders', 'payment_amount_for', 'default_commission_pct', 'show_payments_invoiced_on');

-- fin : l'exception annule TOUT (migration comprise) et renvoie le bilan
do $f$ begin raise exception 'ESSAI v1.46 RÉUSSI (tout est annulé, rien n''est gardé) :%', E'\n' || (select string_agg(n || '. ' || quoi, E'\n' order by n) from essai_bilan); end $f$;
rollback;
