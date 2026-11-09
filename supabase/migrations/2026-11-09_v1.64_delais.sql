-- =====================================================================================================
-- v1.64 — Délais et automatismes (demande d'Anthony du 09/11/2026, §2) : les délais EXISTANTS des rappels deviennent réglables
-- (Réglages › Délais et automatismes) ; AUCUN nouvel automatisme. Même règle côté application : js/reminders.js (DELAY_RULES,
-- delaysOf, remindersOf).
--
-- Réglage « delais » (table settings, clé existante ou absente) : {règle: [{on, n, from}]} — versions dans l'ordre d'enregistrement ;
-- from = null : toutes les dates ; from = 'AAAA-MM-JJ' : seulement les dates créées (shows.created_at, jour de Paris) à partir de ce
-- jour. La dernière version applicable l'emporte ; valeur illisible ignorée (défaut gardé) : un réglage abîmé n'arrête jamais
-- generate_reminders. SANS réglage : valeurs par défaut = règles en place (v1.60.6, solde à J-7) → notifications identiques.
-- Aucune ligne de settings n'est créée ni modifiée par cette migration.
--
-- Clé anti-doublon : INCHANGÉE pour toutes les notifications existantes. Elle garde l'échéance brute calculée avec les délais par
-- défaut (constantes historiques ci-dessous, jamais à modifier) ; l'échéance réelle suit le réglage. Changer un délai ne recrée donc
-- jamais une notification déjà créée pour la même étape (pas de doublon), et ne fait partir une relance qu'à sa nouvelle échéance.
-- generate_reminders forme la clé avec r:k (k contient déjà l'échéance brute par défaut) au lieu de r:k:raw — même texte de clé.
--
-- Règles propres à une date (priment sur le réglage général, déjà en place, réutilisées telles quelles) : relances suspendues d'une
-- date restaurée (reminders_suspended_at), prochaine échéance choisie à la réactivation (reminders_next, plancher), relances
-- d'impayé suspendues facture par facture (show_payments.reminders_paused).
--
-- Garde (avant toute écriture) : generate_reminders = v1.60.3 (md5(pg_get_functiondef) 584374b0cb052c5fa226427b837b30a1) et
-- reminder_candidates = v1.60.6 (808cb33bf574c49d64279f7dceecbde9, migration 2026-11-09_v1.60.6_solde_j7.sql), ou déjà cette version
-- (marqueur « v1.64 délais ») ; sinon arrêt, rien n'est appliqué. Appliquer d'abord la v1.60.6 ET son opération
-- supabase/operations/2026-11-09_v1.60.6_rappels_solde.sql (elle reconstruit les clés au format v1.60.6).
-- Rejouable (create or replace). Retour arrière (après accord) : réappliquer reminder_candidates de la v1.60.6 et generate_reminders de
-- la v1.60.3 ; la fonction delais_dossier peut rester (inutilisée).
-- =====================================================================================================

do $m$
declare b text;
begin
  b := pg_get_functiondef('public.generate_reminders()'::regprocedure);
  if md5(b) <> '584374b0cb052c5fa226427b837b30a1' and position('v1.64 délais' in b) = 0 then
    raise exception 'v1.64 : generate_reminders n''est pas la version v1.60.3 attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  b := pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure);
  if md5(b) <> '808cb33bf574c49d64279f7dceecbde9' and position('v1.64 délais' in b) = 0 then
    raise exception 'v1.64 : reminder_candidates n''est pas la version v1.60.6 attendue (empreinte %) : appliquer d''abord 2026-11-09_v1.60.6_solde_j7.sql ; migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;

-- ─────────────── 1. Délais d'une date (même résolution que js/reminders.js delaysOf) ───────────────
-- Valeurs par défaut : MÊMES valeurs que DELAY_RULES (js/reminders.js) — contrôle automatique : tests/static/delais.mjs.
create or replace function public.delais_dossier(p_created timestamptz)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with def(k, n, mx) as (values ('precontrat', 10, 365), ('contrat_envoi', 10, 365), ('contrat_signe', 10, 365), ('contrat_cosigne', 10, 365),
         ('facture_acompte', 0, 365), ('solde_envoi', 7, 365), ('booking_commission', 0, 365), ('facture_envoi', 3, 365), ('paiement', 10, 365),
         ('commission', 10, 365), ('commission_partenaire', 10, 365), ('boucle_accueil', 4, 24), ('boucle_com', 0, 365)),
  reg as (select value v from settings where key = 'delais' and jsonb_typeof(value) = 'object'),
  jour as (select (p_created at time zone 'Europe/Paris')::date j)
  select jsonb_object_agg(def.k, coalesce((
    select jsonb_build_object('on', not coalesce(x -> 'on' = 'false'::jsonb, false),
                              'n', case when jsonb_typeof(x -> 'n') = 'number' and (x ->> 'n') ~ '^\d{1,3}$' and (x ->> 'n')::int <= def.mx
                                        then (x ->> 'n')::int else def.n end)
    from reg, jour, jsonb_array_elements(case when jsonb_typeof(reg.v -> def.k) = 'array' then reg.v -> def.k else '[]'::jsonb end) with ordinality e(x, i)
    where jsonb_typeof(x) = 'object'
      and (x -> 'from' is null or x -> 'from' = 'null'::jsonb
           or ((x ->> 'from') ~ '^\d{4}-\d{2}-\d{2}$' and jour.j is not null and jour.j >= (x ->> 'from')::date))
    order by i desc limit 1), jsonb_build_object('on', true, 'n', def.n)))
  from def
$function$;
revoke all on function public.delais_dossier(timestamptz) from public, anon, authenticated, service_role;

-- ─────────────── 2. Relances candidates (RÉÉCRITE ENTIÈREMENT, §7.5 ; texte v1.60.6 + délais réglables) ───────────────
-- v1.64 délais : chaque règle lit son activation (on) et son délai (n) dans delais_dossier(created_at) ; k = clé anti-doublon
-- complète sauf la règle (échéance brute calculée avec les délais par DÉFAUT, constantes historiques) ; raw = échéance réelle.
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
      -- rappels administratifs (étapes, boucles, factures à faire, partenaire) : dates passées de plus de 120 jours exclues ;
      -- factures (à envoyer, impayées) et commission à virer : sans limite de durée (Q13, décision du 27/10)
      (sh.date is null or sh.date >= (now() at time zone 'Europe/Paris')::date - 120) recent,
      sh.reminders_next nxt, to_char(sh.reminders_reactivated_at, 'YYYYMMDDHH24MISS') reactiv,   -- v1.60.3 : relances réactivées
      public.delais_dossier(sh.created_at) cfg,   -- v1.64 délais
      sh.conf_kit_sent, sh.precontract_done, sh.contract_sent, sh.contract_signed, sh.contract_cosigned_sent, sh.boucle_tech, sh.boucle_com,
      a.id a_id,
      (a.sent_at is not null or a.paid_at is not null or nullif(btrim(a.invoice_number), '') is not null or nullif(btrim(a.pennylane_id), '') is not null) a_emis,
      so.id so_id,
      (so.sent_at is not null or so.paid_at is not null or nullif(btrim(so.invoice_number), '') is not null or nullif(btrim(so.pennylane_id), '') is not null) so_emis,
      c.id c_id, c.label c_label,
      (c.sent_at is not null or c.paid_at is not null or nullif(btrim(c.invoice_number), '') is not null or nullif(btrim(c.pennylane_id), '') is not null) c_emis,
      case when c.id is null then null when c.paid_at is not null and public.commission_transferred(c.id) = 0 then 0
           else greatest(public.commission_total(c) - public.commission_transferred(c.id), 0) end c_reste,
      pt.id pt_id, pt.sent_at pt_sent, pt.paid_at pt_paid, pt.label pt_label,
      -- premier encaissement, même partiel, toutes lignes acompte / solde confondues (Q14)
      (select min(x.paid_at) from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind in ('acompte', 'solde')) cashed
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival')
      and sh.archived_at is null   -- v1.60.3 : une date archivée ne produit aucun rappel (comme dans js/reminders.js)
      and (p_all or sh.reminders_suspended_at is null)   -- v1.60.3 : date restaurée, relances pas encore réactivées (p_all : relances concernées malgré la suspension)
      and (p_show is null or sh.id = p_show)
  ), d as (
    -- délais de la date : on (activée) et n (délai) par règle
    select s.*, (cfg #>> '{precontrat,on}')::boolean on_pc, (cfg #>> '{precontrat,n}')::int n_pc,
      (cfg #>> '{contrat_envoi,on}')::boolean on_ce, (cfg #>> '{contrat_envoi,n}')::int n_ce,
      (cfg #>> '{contrat_signe,on}')::boolean on_cs, (cfg #>> '{contrat_signe,n}')::int n_cs,
      (cfg #>> '{contrat_cosigne,on}')::boolean on_cc, (cfg #>> '{contrat_cosigne,n}')::int n_cc,
      (cfg #>> '{facture_acompte,on}')::boolean on_fa, (cfg #>> '{facture_acompte,n}')::int n_fa,
      (cfg #>> '{solde_envoi,on}')::boolean on_so, (cfg #>> '{solde_envoi,n}')::int n_so,
      (cfg #>> '{booking_commission,on}')::boolean on_bc, (cfg #>> '{booking_commission,n}')::int n_bc,
      (cfg #>> '{facture_envoi,on}')::boolean on_fe, (cfg #>> '{facture_envoi,n}')::int n_fe,
      (cfg #>> '{paiement,on}')::boolean on_pa, (cfg #>> '{paiement,n}')::int n_pa,
      (cfg #>> '{commission,on}')::boolean on_co, (cfg #>> '{commission,n}')::int n_co,
      (cfg #>> '{commission_partenaire,on}')::boolean on_cp, (cfg #>> '{commission_partenaire,n}')::int n_cp,
      (cfg #>> '{boucle_accueil,on}')::boolean on_ba, (cfg #>> '{boucle_accueil,n}')::int n_ba,
      (cfg #>> '{boucle_com,on}')::boolean on_bo, (cfg #>> '{boucle_com,n}')::int n_bo
    from s
  ), f as (
    -- factures suivies : production = acomptes, soldes, autres lignes ; booking = facture de commission (jamais acompte / solde)
    select x.id, x.show_id, x.kind, x.sent_at, x.paid_at, x.reminded_at, x.reminders_paused, d.date show_date,
      d.on_fe, d.n_fe, d.n_so, d.on_pa, d.n_pa,
      concat_ws(' ', nullif(x.label, ''), '(' || nullif(btrim(x.invoice_number), '') || ')') nom,
      (nullif(btrim(x.invoice_number), '') is not null or nullif(btrim(x.pennylane_id), '') is not null) faite,
      coalesce(x.invoiced_on, (x.created_at at time zone 'Europe/Paris')::date) faite_le,
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn
    from show_payments x join d on d.id = x.show_id
    where x.hors_calcul is null and ((d.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (d.mode = 'booking' and x.kind = 'artbo'))
  ), cand as (
    -- k : clé anti-doublon sans la règle (…:échéance brute avec les délais PAR DÉFAUT, comme avant v1.64) ; raw : échéance réelle ;
    -- w : échéance « J+n » décalée au lundi si elle tombe le week-end
    select 'precontrat' r, id, id || ':' || (conf_kit_sent + 10) k, conf_kit_sent + n_pc raw, true w, 'Pré-contrat à compléter' t from d where on_pc and mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_envoi', id, id || ':' || (precontract_done + 10), precontract_done + n_ce, true, 'Contrat à envoyer' from d where on_ce and mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_signe', id, id || ':' || (contract_sent + 10), contract_sent + n_cs, true, 'Contrat signé à récupérer' from d where on_cs and mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_cosigne', id, id || ':' || (contract_signed + 10), contract_signed + n_cc, true, 'Contrat co-signé à renvoyer' from d where on_cc and mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'facture_acompte', id, id || ':' || contract_sent, contract_sent + n_fa, false, 'Facture d’acompte à faire (contrat envoyé)' from d where on_fa and mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not coalesce(so_emis, false)
    -- solde : jour ouvré le plus proche de J-n en reculant (samedi / dimanche → vendredi)
    union all select 'solde_envoi', id, id || ':' || ((date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int),
                     (date - n_so) - (case extract(isodow from date - n_so) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Facture de solde à faire' from d where on_so and mode <> 'booking' and date is not null and so_id is not null and not so_emis and date >= (now() at time zone 'Europe/Paris')::date - 30
    union all select 'booking_commission', id, id || ':' || contract_cosigned_sent, contract_cosigned_sent + n_bc, false, 'Facture de commission à faire (contrat co-signé)' from d where on_bc and mode = 'booking' and recent and contract_cosigned_sent is not null and c_id is not null and not c_emis
    -- facture faite, pas de date d'envoi : n jours après (3 par défaut), jusqu'à la saisie de la date d'envoi (une clé par facture) ;
    -- facture de SOLDE d'une date qui a un jour de concert : jamais avant le jour du rappel du solde (v1.60.6)
    union all select 'facture_envoi', show_id, show_id || ':' || id || ':' || (faite_le + 3),
                     case when kind = 'solde' and show_date is not null
                          then greatest(faite_le + n_fe, (show_date - n_so) - (case extract(isodow from show_date - n_so) when 6 then 1 when 7 then 2 else 0 end)::int)
                          else faite_le + n_fe end, true, 'Facture à envoyer : ' || nom from f where on_fe and faite and sent_at is null and paid_at is null
    -- facture envoyée impayée : n jours (10 par défaut) après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end || ':' || (greatest(sent_at, reminded_at) + 10),
                     greatest(sent_at, reminded_at) + n_pa, true,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where on_pa and sent_at is not null and paid_at is null and not reminders_paused
    union all select 'commission', id, id || ':' || (cashed + 10), cashed + n_co, true, coalesce(c_label,'Commission L’ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser'
                     from d where on_co and mode <> 'booking' and cashed is not null and c_id is not null and c_reste > 0.004
    union all select 'commission_partenaire', id, id || ':' || (cashed + 10), cashed + n_cp, true, 'Facture ' || coalesce(nullif(pt_label, ''),'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from d where on_cp and mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id || ':' || (date - interval '4 months')::date, (date - make_interval(months => n_ba))::date, false, 'Boucle accueil & technique à envoyer (J-' || n_ba || ' mois)' from d where on_ba and mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'boucle_com', id, id || ':' || contract_cosigned_sent, contract_cosigned_sent + n_bo, false, 'Boucle communication à envoyer' from d where on_bo and mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
  )
  select c.r, c.id, c.k, c.raw, c.w, c.t, s.venue, s.proj, s.date, s.city, s.nxt, s.reactiv from cand c join s on s.id = c.id
$function$;
revoke all on function public.reminder_candidates(uuid, boolean) from public, anon, authenticated, service_role;

-- ─────────────── 3. Notifications (RÉÉCRITE ENTIÈREMENT, §7.5 ; texte v1.60.3, seule la clé change de forme, pas de texte) ───────────────
create or replace function public.generate_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  -- relances candidates : reminder_candidates (dates confirmées, sans date archivée — archived_at — ni relances suspendues)
  -- v1.64 délais : clé anti-doublon = règle:k[:a…] (k porte l'échéance brute par défaut : même clé qu'avant pour toutes les
  -- notifications existantes) ; l'échéance réelle (raw) suit le réglage « delais »
  with ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || c.venue,
           concat_ws(' · ', nullif(c.proj,''), to_char(c.date, 'DD/MM/YYYY'), c.city),
           c.show_id, c.r || ':' || c.k || coalesce(':a' || c.reactiv, '')   -- v1.60.3 : clés propres après réactivation
    from public.reminder_candidates(null, false) c
    -- échéance : J+n décalée au lundi (w) ; boucle accueil & technique (mois calendaires) : samedi / dimanche → vendredi précédent
    -- (Q12, v1.49 — même règle que js/reminders.js workDayBefore)
    -- v1.60.3 : relances réactivées après une restauration — la relance ne part qu'à la prochaine échéance choisie pour elle
    -- (reminders_next), jamais avant son échéance d'origine (greatest)
    where c.raw is not null and greatest(case when c.w then public.workday(c.raw)
                                      when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int
                                      else c.raw end, (c.nxt ->> c.r)::date) <= (now() at time zone 'Europe/Paris')::date   -- jour de Paris (C §1.2)
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;
revoke all on function public.generate_reminders() from public, anon, authenticated, service_role;
grant execute on function public.generate_reminders() to service_role;
