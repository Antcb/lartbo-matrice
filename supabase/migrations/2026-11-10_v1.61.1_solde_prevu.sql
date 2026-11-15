-- =====================================================================================================
-- v1.61.1 — Solde prévu (décision d'Anthony du 10/11/2026), qui REMPLACE la règle du 26/10 (lot C1) « solde à facturer = cession −
-- acomptes EFFECTIVEMENT facturés » :
--   « Tu ne mets pas 100 % pour le solde alors qu'un acompte est prévu ! Tu mets les bons % dès le début, et au pire tu réadaptes si
--     un acompte est modifié. »
-- Règle : solde non émis = cession − TOUS les acomptes de la date (prévus et facturés, hors lignes hors calcul) ; un montant saisi
-- fait foi ; un solde déjà émis garde son montant figé (inchangé). L'acompte n'est plus « caduc » quand le solde est facturé avant
-- lui : il reste dû (même compte, mêmes relances) jusqu'à ce que l'utilisateur le retire (0 %).
-- Même règle (§8.4) : application js/calc.js (soldeDue, payAmount, acompteState, acompteRetire, changeBlocked), js/reminders.js ;
-- fonction edge supabase/functions/pennylane/regles.ts (montantAttendu, acomptesDeLaDate) — à redéployer avec cette migration.
--
--   1. payment_amount_for : solde de production = cession − tous les acomptes (sert au gel à l'émission, show_payments_freeze, et à
--      la garde shows_frozen_guard). Les lignes hors calcul sont aussi écartées des autres soldes (comme paymentsOf en JS).
--   2. show_payments_caduc_guard : ne refuse plus l'émission d'un acompte après le solde ; garde SEULEMENT le verrou transactionnel
--      par date (émissions simultanées d'un acompte et d'un solde). Le déclencheur reste en place (aucun drop).
--   3. reminder_candidates : « Facture d'acompte à faire » n'est plus coupée par un solde facturé ; un acompte retiré (0 % / 0 €, non
--      facturé) n'est plus réclamé. Texte = v1.64 délais + ces deux changements.
--
-- AUCUNE donnée modifiée : les montants déjà figés (soldes émis) ne bougent pas ; aucune ligne n'est créée, corrigée ni supprimée.
-- Conséquence à connaître (non vérifiée en production) : une date de production dont le solde a été facturé à 100 % avant ce lot
-- alors qu'un acompte prévu restait non facturé (ancien « caduc ») affichera cet acompte comme dû (relance « Facture d'acompte à faire »
-- si le contrat est envoyé et la date récente, montant « à venir » sur le compte, total des factures > cession) jusqu'à ce qu'il soit
-- retiré (0 %). Lecture conseillée avant application (lecture seule) :
--   select s.id, s.venue, s.date, a.id acompte, a.pct, a.amount from shows s join show_payments a on a.show_id = s.id and a.kind = 'acompte'
--    where coalesce(s.prod_mode, 'production') <> 'booking' and a.hors_calcul is null and not public.payment_is_emitted(a)
--      and exists (select 1 from show_payments so where so.show_id = s.id and so.kind = 'solde' and so.hors_calcul is null and public.payment_is_emitted(so));
--
-- Garde (avant toute écriture) : reminder_candidates = v1.64 (marqueur « v1.64 délais ») et payment_amount_for = v1.51 (marqueur
-- « base (v1.51) ») ou déjà cette version (marqueur « v1.61.1 solde prévu ») ; sinon arrêt, rien n'est appliqué.
-- Rejouable (create or replace). Retour arrière (après accord) : réappliquer payment_amount_for de 2026-10-27_v1.51_corea_coprod_cnm.sql,
-- show_payments_caduc_guard de 2026-10-26_v1.41_acompte_caduc.sql (fonction seule) et reminder_candidates de 2026-11-09_v1.64_delais.sql.
-- =====================================================================================================

do $m$
declare b text;
begin
  b := pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure);
  if position('v1.64 délais' in b) = 0 then
    raise exception 'v1.61.1 : reminder_candidates n''est pas la version v1.64 attendue (empreinte %) : appliquer d''abord 2026-11-09_v1.64_delais.sql ; migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  b := pg_get_functiondef('public.payment_amount_for(public.show_payments,numeric,numeric,numeric,text)'::regprocedure);
  if position('base (v1.51)' in b) = 0 and position('v1.61.1 solde prévu' in b) = 0 then
    raise exception 'v1.61.1 : payment_amount_for n''est pas la version v1.51 attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;

-- ─────────────── 1. Montant calculé d'une ligne (texte v1.51 ; seul le solde de production change) ───────────────
create or replace function public.payment_amount_for(p public.show_payments, p_fee numeric, p_artbo numeric, p_partner numeric, p_mode text)
 returns numeric
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare done numeric; fixed numeric; fee numeric := coalesce(p_fee, 0); pct_com numeric; base numeric;
begin
  if p.amount is not null then return p.amount; end if;
  if p.kind in ('artbo', 'partner') then
    -- % de la ligne (commission) > % de la date > % de l'artiste > Réglages selon le mode de la date (v1.46 : plus de repli à 0)
    pct_com := coalesce(p_artbo, public.default_commission_pct(p.show_id, p_mode), 0);
    -- base (v1.51) : cachet HT ; en coréalisation, MG + part du résultat VALIDÉE (rémunération brute de l'artiste)
    base := fee + public.corea_share_of(p.show_id);
    if p.kind = 'artbo' then return round(base * coalesce(p.pct, pct_com)) / 100; end if;
    return round(base * pct_com * coalesce(p.pct, p_partner, 0) / 100) / 100;
  end if;
  if p.kind = 'solde' and coalesce(p_mode, 'production') <> 'booking' then
    -- v1.61.1 solde prévu (décision d'Anthony du 10/11/2026, remplace la règle C1 du 26/10) : solde de production = cession − TOUS
    -- les acomptes de la date (prévus et facturés, hors lignes hors calcul) − autres soldes figés ; un autre solde calculé placé avant lui prend le reste
    -- (plusieurs soldes = anomalie signalée par l'application). Sert au gel à l'émission (= soldeDue en JS). Pour un solde DÉJÀ émis
    -- sans montant (historique, 0 après régularisation), le JS (payAmount) prend cachet × % : les deux varient avec le cachet, la garde
    -- shows_frozen_guard refuse donc les mêmes changements que changeBlocked (relecture D1, point 1)
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
end $function$;

revoke all on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) to authenticated, service_role;

-- ─────────────── 2. Acompte après le solde : plus de refus « caduc », verrou des émissions simultanées gardé ───────────────
-- (create or replace de la fonction seule : le déclencheur show_payments_caduc_guard existant reste tel quel, aucun drop)
create or replace function public.show_payments_caduc_guard() returns trigger
language plpgsql set search_path = public as $$   -- §7.3
begin
  -- v1.61.1 solde prévu (décision d'Anthony du 10/11/2026) : plus d'acompte « caduc ». Un acompte non facturé reste dû même quand
  -- le solde l'est déjà, et peut donc s'émettre ; seul le verrou par date est gardé.
  if new.kind not in ('acompte', 'solde')
     or not (new.sent_at is not null or new.paid_at is not null
             or nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null) then
    return new;                                                     -- ni acompte ni solde émis : rien à contrôler
  end if;
  -- FACTURATION SIMULTANÉE : chaque émission d'acompte ou de solde prend un verrou propre à la date, gardé jusqu'à la fin de sa
  -- transaction (le gel du solde à son émission lit alors des acomptes à jour). Verrou « conseil » : ne bloque ni la lecture, ni
  -- les autres dates, ni les autres colonnes / lignes de la date.
  perform pg_advisory_xact_lock(hashtext('show_payments_emission'), hashtext(new.show_id::text));
  return new;
end $$;
revoke execute on function public.show_payments_caduc_guard() from public, anon, authenticated;   -- §7.3

-- ─────────────── 3. Relances candidates (RÉÉCRITE ENTIÈREMENT, §7.5 ; texte v1.64 délais + acompte toujours dû) ───────────────
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
      -- v1.61.1 solde prévu : acompte RETIRÉ (0 % ou 0 €, non facturé) — plus dû, plus réclamé (même règle : js/calc.js acompteRetire)
      coalesce(a.amount = 0 or (a.amount is null and a.pct = 0), false) a_retire,
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
      (cfg #>> '{boucle_com,on}')::boolean on_bo, (cfg #>> '{boucle_com,n}')::int n_bo,
      (cfg #>> '{weekend_apres,on}')::boolean wa, (cfg #>> '{weekend_avant,on}')::boolean wb   -- politique des week-ends
    from s
  ), f as (
    -- factures suivies : production = acomptes, soldes, autres lignes ; booking = facture de commission (jamais acompte / solde)
    select x.id, x.show_id, x.kind, x.sent_at, x.paid_at, x.reminded_at, x.reminders_paused, d.date show_date,
      d.on_fe, d.n_fe, d.n_so, d.on_pa, d.n_pa, d.wa,
      concat_ws(' ', nullif(x.label, ''), '(' || nullif(btrim(x.invoice_number), '') || ')') nom,
      (nullif(btrim(x.invoice_number), '') is not null or nullif(btrim(x.pennylane_id), '') is not null) faite,
      coalesce(x.invoiced_on, (x.created_at at time zone 'Europe/Paris')::date) faite_le,
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn
    from show_payments x join d on d.id = x.show_id
    where x.hors_calcul is null and ((d.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (d.mode = 'booking' and x.kind = 'artbo'))
  ), cand as (
    -- k : clé anti-doublon sans la règle (…:échéance brute avec les délais PAR DÉFAUT, comme avant v1.64) ; raw : échéance réelle ;
    -- w : échéance après une étape (0 jour compris) décalée au lundi si elle tombe le week-end, selon la politique (wa, décision du
    -- 09/11) ; boucle accueil & technique : vendredi précédent (wb) appliqué ici ; solde : vendredi précédent toujours (v1.60.6)
    select 'precontrat' r, id, id || ':' || (conf_kit_sent + 10) k, conf_kit_sent + n_pc raw, wa w, 'Pré-contrat à compléter' t from d where on_pc and mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_envoi', id, id || ':' || (precontract_done + 10), precontract_done + n_ce, wa, 'Contrat à envoyer' from d where on_ce and mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_signe', id, id || ':' || (contract_sent + 10), contract_sent + n_cs, wa, 'Contrat signé à récupérer' from d where on_cs and mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_cosigne', id, id || ':' || (contract_signed + 10), contract_signed + n_cc, wa, 'Contrat co-signé à renvoyer' from d where on_cc and mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    -- v1.61.1 solde prévu (décision d'Anthony du 10/11/2026) : l'acompte non facturé reste réclamé même si le solde est déjà facturé
    -- (plus d'acompte « caduc ») ; seul un acompte retiré (0 %) sort de ce rappel
    union all select 'facture_acompte', id, id || ':' || contract_sent, contract_sent + n_fa, wa, 'Facture d’acompte à faire (contrat envoyé)' from d where on_fa and mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not a_retire
    -- solde : jour ouvré le plus proche de J-n en reculant (samedi / dimanche → vendredi)
    union all select 'solde_envoi', id, id || ':' || ((date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int),
                     (date - n_so) - (case extract(isodow from date - n_so) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Facture de solde à faire' from d where on_so and mode <> 'booking' and date is not null and so_id is not null and not so_emis and date >= (now() at time zone 'Europe/Paris')::date - 30
    union all select 'booking_commission', id, id || ':' || contract_cosigned_sent, contract_cosigned_sent + n_bc, wa, 'Facture de commission à faire (contrat co-signé)' from d where on_bc and mode = 'booking' and recent and contract_cosigned_sent is not null and c_id is not null and not c_emis
    -- facture faite, pas de date d'envoi : n jours après (3 par défaut), jusqu'à la saisie de la date d'envoi (une clé par facture) ;
    -- facture de SOLDE d'une date qui a un jour de concert : jamais avant le jour du rappel du solde (v1.60.6)
    union all select 'facture_envoi', show_id, show_id || ':' || id || ':' || (faite_le + 3),
                     case when kind = 'solde' and show_date is not null
                          then greatest(faite_le + n_fe, (show_date - n_so) - (case extract(isodow from show_date - n_so) when 6 then 1 when 7 then 2 else 0 end)::int)
                          else faite_le + n_fe end, wa, 'Facture à envoyer : ' || nom from f where on_fe and faite and sent_at is null and paid_at is null
    -- facture envoyée impayée : n jours (10 par défaut) après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end || ':' || (greatest(sent_at, reminded_at) + 10),
                     greatest(sent_at, reminded_at) + n_pa, wa,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where on_pa and sent_at is not null and paid_at is null and not reminders_paused
    union all select 'commission', id, id || ':' || (cashed + 10), cashed + n_co, wa, coalesce(c_label,'Commission L’ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser'
                     from d where on_co and mode <> 'booking' and cashed is not null and c_id is not null and c_reste > 0.004
    union all select 'commission_partenaire', id, id || ':' || (cashed + 10), cashed + n_cp, wa, 'Facture ' || coalesce(nullif(pt_label, ''),'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from d where on_cp and mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id || ':' || (date - interval '4 months')::date, case when wb then (date - make_interval(months => n_ba))::date - (case extract(isodow from (date - make_interval(months => n_ba))::date) when 6 then 1 when 7 then 2 else 0 end)::int
                     else (date - make_interval(months => n_ba))::date end, false, 'Boucle accueil & technique à envoyer (J-' || n_ba || ' mois)' from d where on_ba and mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'boucle_com', id, id || ':' || contract_cosigned_sent, contract_cosigned_sent + n_bo, wa, 'Boucle communication à envoyer' from d where on_bo and mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
  )
  select c.r, c.id, c.k, c.raw, c.w, c.t, s.venue, s.proj, s.date, s.city, s.nxt, s.reactiv from cand c join s on s.id = c.id
$function$;
revoke all on function public.reminder_candidates(uuid, boolean) from public, anon, authenticated, service_role;
