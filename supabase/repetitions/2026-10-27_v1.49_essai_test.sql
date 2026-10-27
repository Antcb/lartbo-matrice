-- =====================================================================================================
-- ESSAI v1.49 (Dates et formats) — PROJET DE TEST UNIQUEMENT, transaction ANNULÉE (exception finale) : rien n'est gardé.
-- La migration 2026-10-27_v1.49_dates_formats.sql est insérée à la place de la ligne repère ci-dessous, précédée de la v1.46
-- si le projet de test ne l’a pas encore (ordre réel de mise en ligne).
-- =====================================================================================================
begin;
do $g$ begin
  if exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ceci est la PRODUCTION — essai réservé au projet de test'; end if;
end $g$;

--@@MIGRATION@@

create temp table essai_bilan (n serial, quoi text);
do $e$
declare pa uuid; s1 uuid; s2 uuid; d date; v jsonb; k text; c int;
begin
  insert into projects (name, mode) values ('ESSAI v1.49', 'production') returning id into pa;
  -- concert dont la date à J-4 mois tombe un dimanche, dans le passé proche : rappel attendu (vendredi précédent déjà passé)
  d := current_date + interval '4 months' - ((extract(isodow from (current_date)::date)::int) % 7) * interval '1 day';   -- J-4 mois = un dimanche ≤ aujourd'hui
  d := (date_trunc('day', d))::date;
  while extract(isodow from (d - interval '4 months')::date) <> 7 loop d := d - 1; end loop;
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id)
    values (pa, 'ESSAI B', d, 'Confirmée Salle', 'Cession', 5000, 'production', 'essai') returning id into s1;
  perform public.generate_reminders();
  select dedupe_key into k from notifications where show_id = s1 and kind = 'boucle_accueil';
  if (d - interval '4 months')::date - 2 <= current_date then
    if k is null then raise exception 'ECHEC 1 : boucle accueil non rappelée (échéance vendredi %)', (d - interval '4 months')::date - 2; end if;
    if k <> 'boucle_accueil:' || s1 || ':' || (d - interval '4 months')::date then raise exception 'ECHEC 1 : clé %', k; end if;
  end if;
  insert into essai_bilan (quoi) values ('1 boucle accueil : concert ' || d || ', J-4 mois ' || (d - interval '4 months')::date || ' (dimanche) → rappel dès le vendredi ' || ((d - interval '4 months')::date - 2) || ', clé sur la date brute : ' || coalesce(k, 'pas encore due'));
  -- variables des mails : « 30 % » et « 5,5 % » avec espace insécable
  insert into shows (project_id, venue, date, status, contract_type, fee_ht, prod_mode, drive_folder_id, vat_rate)
    values (pa, 'ESSAI M', current_date + 200, 'Option Salle', 'Cession', 5000, 'production', 'essai', 5.5) returning id into s2;
  insert into show_payments (show_id, kind, label, pct, sort) values (s2, 'acompte', 'Acompte', 30, 1);
  v := public.mail_vars(s2, null);
  if v->>'acompte_pct' <> '30' || chr(160) || '%' then raise exception 'ECHEC 2 : acompte_pct « % »', v->>'acompte_pct'; end if;
  if v->>'tva' <> '5,5' || chr(160) || '%' then raise exception 'ECHEC 2 : tva « % »', v->>'tva'; end if;
  insert into essai_bilan (quoi) values ('2 mail_vars : acompte_pct « ' || (v->>'acompte_pct') || ' », tva « ' || (v->>'tva') || ' » (espace insécable)');
end $e$;
insert into essai_bilan (quoi)
select '3 droits ' || p.proname || ' ' || coalesce(array_to_string(p.proacl, ','), 'défaut') || case when p.prosecdef then ' definer' else '' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('generate_reminders', 'mail_vars');
do $f$ begin raise exception 'ESSAI v1.49 RÉUSSI (tout est annulé, rien n''est gardé) :%', E'\n' || (select string_agg(n || '. ' || quoi, E'\n' order by n) from essai_bilan); end $f$;
rollback;
