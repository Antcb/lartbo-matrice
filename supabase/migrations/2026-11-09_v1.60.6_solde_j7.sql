-- =====================================================================================================
-- v1.60.6 — Facture de solde : retour à J-7 (demande d'Anthony du 09/11/2026, « Urgence : délai de facture de solde »).
--
-- Cause constatée (aucune règle J-7 modifiée) : la règle « Facture de solde à faire » (solde_envoi) est toujours au jour ouvré de
-- J-7 (inchangée depuis v1.7 / v1.39). Depuis la v1.46a (27/10, commit 4fd7169), une facture FAITE (numéro ou lien Pennylane) sans
-- date d'envoi déclenche « Facture à envoyer » 3 jours après la date de la facture, quelle que soit la date du concert ; une facture
-- de solde faite un mois avant le concert donnait donc le rappel d'envoi un mois avant. Rappel interne seulement (notification et
-- récapitulatif quotidien) : aucune facture n'est envoyée automatiquement.
--
-- Correction (même règle que js/reminders.js sendDue) : le rappel « Facture à envoyer » d'une ligne de SOLDE d'une date qui a un jour
-- de concert tombe au plus tôt le jour du rappel du solde : échéance = max(facture faite + 3 j décalé au lundi, jour ouvré de J-7).
-- Acomptes, autres lignes, commission (booking) et date sans jour de concert : inchangés. Seule reminder_candidates est remplacée ;
-- generate_reminders n'est PAS modifiée (elle applique déjà le plancher nxt par greatest). Clé anti-doublon inchangée.
--
-- Garde (avant toute écriture) :
--  - generate_reminders = texte de la v1.60.3, empreinte md5(pg_get_functiondef) 584374b0cb052c5fa226427b837b30a1 (relevée en
--    production par l'intégrateur le 09/11/2026, identique au texte du dépôt appliqué sur une base locale jetable) ;
--  - reminder_candidates = texte de la v1.60.3 (supabase/migrations/2026-11-07_v1.60.3_suppression_date.sql), empreinte
--    md5(pg_get_functiondef) e07c2a94a3416d5ff7fa08a677a731e2 calculée sur une base locale jetable à partir du dépôt (non relevée en
--    production : à confirmer par la lecture préalable de la séance), ou déjà cette version (marqueur « v1.60.6 solde J-7 ») ;
--  sinon arrêt, rien n'est appliqué.
-- Rejouable (create or replace ; une deuxième exécution reconnaît le marqueur).
-- Notifications déjà générées devenues prématurées : supabase/operations/2026-11-09_v1.60.6_rappels_solde.sql (APRÈS cette migration).
-- Retour arrière (après accord) : réappliquer la seule fonction reminder_candidates de la migration v1.60.3 (create or replace).
-- =====================================================================================================

do $m$
declare b text;
begin
  b := pg_get_functiondef('public.generate_reminders()'::regprocedure);
  if md5(b) <> '584374b0cb052c5fa226427b837b30a1' then
    raise exception 'v1.60.6 : generate_reminders n''est pas la version v1.60.3 attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  b := pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure);
  if md5(b) <> 'e07c2a94a3416d5ff7fa08a677a731e2' and position('v1.60.6 solde J-7' in b) = 0 then
    raise exception 'v1.60.6 : reminder_candidates n''est pas la version v1.60.3 attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;

-- Texte de la v1.60.3, seule la dernière requête change (plancher J-7 du solde). Droits inchangés (revoke ci-dessous, comme v1.60.3).
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
  ), f as (
    -- factures suivies : production = acomptes, soldes, autres lignes ; booking = facture de commission (jamais acompte / solde)
    select x.id, x.show_id, x.kind, x.sent_at, x.paid_at, x.reminded_at, x.reminders_paused,
      concat_ws(' ', nullif(x.label, ''), '(' || nullif(btrim(x.invoice_number), '') || ')') nom,
      (nullif(btrim(x.invoice_number), '') is not null or nullif(btrim(x.pennylane_id), '') is not null) faite,
      coalesce(x.invoiced_on, (x.created_at at time zone 'Europe/Paris')::date) faite_le,
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn
    from show_payments x join s on s.id = x.show_id
    where x.hors_calcul is null and ((s.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (s.mode = 'booking' and x.kind = 'artbo'))
  ), cand as (
    -- k : clé anti-doublon (règle:date:échéance, comme avant pour la première ligne de chaque sorte) ; raw : échéance brute ;
    -- w : échéance « J+n » décalée au lundi si elle tombe le week-end
    select 'precontrat' r, id, id::text k, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_envoi', id, id::text, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_signe', id, id::text, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'contrat_cosigne', id, id::text, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'facture_acompte', id, id::text, contract_sent, false, 'Facture d’acompte à faire (contrat envoyé)' from s where mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not coalesce(so_emis, false)
    union all select 'solde_envoi', id, id::text, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Facture de solde à faire' from s where mode <> 'booking' and date is not null and so_id is not null and not so_emis and date >= (now() at time zone 'Europe/Paris')::date - 30
    union all select 'booking_commission', id, id::text, contract_cosigned_sent, false, 'Facture de commission à faire (contrat co-signé)' from s where mode = 'booking' and recent and contract_cosigned_sent is not null and c_id is not null and not c_emis
    -- facture faite, pas de date d'envoi : 3 jours après, jusqu'à la saisie de la date d'envoi (une clé par facture)
    union all select 'facture_envoi', show_id, show_id || ':' || id, faite_le + 3, true, 'Facture à envoyer : ' || nom from f where faite and sent_at is null and paid_at is null
    -- facture envoyée impayée : 10 jours après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end, greatest(sent_at, reminded_at) + 10, true,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where sent_at is not null and paid_at is null and not reminders_paused
    union all select 'commission', id, id::text, cashed + 10, true, coalesce(c_label,'Commission L’ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser'
                     from s where mode <> 'booking' and cashed is not null and c_id is not null and c_reste > 0.004
    union all select 'commission_partenaire', id, id::text, cashed + 10, true, 'Facture ' || coalesce(nullif(pt_label, ''),'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from s where mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id::text, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'boucle_com', id, id::text, contract_cosigned_sent, false, 'Boucle communication à envoyer' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
  )
  -- v1.60.6 solde J-7 (demande d'Anthony du 09/11) : « Facture à envoyer » d'une facture de SOLDE d'une date qui a un jour de
  -- concert : jamais avant le jour du rappel du solde (jour ouvré de J-7, même calcul que solde_envoi et js/reminders.js
  -- soldeReminderDay). Ce plancher passe par nxt (plancher par relance, déjà appliqué par generate_reminders : greatest), combiné
  -- avec une éventuelle prochaine échéance choisie à la réactivation ; la clé anti-doublon garde la date brute (facture faite + 3 j).
  select c.r, c.id, c.k, c.raw, c.w, c.t, s.venue, s.proj, s.date, s.city,
         case when fs.id is null then s.nxt
              else coalesce(s.nxt, '{}'::jsonb) || jsonb_build_object(c.r, greatest((s.nxt ->> c.r)::date,
                     (s.date - 7) - (case extract(isodow from s.date - 7) when 6 then 1 when 7 then 2 else 0 end)::int)) end nxt,
         s.reactiv
  from cand c join s on s.id = c.id
  left join f fs on c.r = 'facture_envoi' and fs.kind = 'solde' and s.date is not null and fs.show_id = c.id and c.k = c.id || ':' || fs.id
$function$;
revoke all on function public.reminder_candidates(uuid, boolean) from public, anon, authenticated, service_role;
