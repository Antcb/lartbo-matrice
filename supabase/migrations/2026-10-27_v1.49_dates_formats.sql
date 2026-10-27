-- =====================================================================================================
-- v1.49 — Lot Dates et formats (CONVENTIONS §1.2, §1.6, §2.4 ; décision Q12)
--  1. Rappel « Boucle accueil & technique » : 4 mois calendaires avant le concert, samedi / dimanche → vendredi précédent
--     (generate_reminders ; même règle que js/reminders.js). La clé anti-doublon reste la date brute : aucune notification en double.
--  2. Variables des mails : {{acompte_pct}} et {{tva}} affichés « 50 % » / « 5,5 % » (espace insécable), comme l'application.
-- Fonctions réécrites en entier depuis leur version en production (v1.46 pour generate_reminders, v1.44 pour mail_vars).
-- Aucune donnée n'est modifiée. Retour arrière : recréer ces deux fonctions dans leur version d'avant.
-- =====================================================================================================

-- ─────────────── 1. Rappels ───────────────
create or replace function public.generate_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
      -- rappels administratifs (étapes, boucles, factures à faire, partenaire) : dates passées de plus de 120 jours exclues ;
      -- factures (à envoyer, impayées) et commission à virer : sans limite de durée (Q13, décision du 27/10)
      (sh.date is null or sh.date >= current_date - 120) recent,
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
    select 'precontrat' r, id, id::text k, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_envoi', id, id::text, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_signe', id, id::text, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= current_date)
    union all select 'contrat_cosigne', id, id::text, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= current_date)
    union all select 'facture_acompte', id, id::text, contract_sent, false, 'Facture d’acompte à faire (contrat envoyé)' from s where mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not coalesce(so_emis, false)
    union all select 'solde_envoi', id, id::text, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Facture de solde à faire' from s where mode <> 'booking' and date is not null and so_id is not null and not so_emis and date >= current_date - 30
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
    union all select 'boucle_accueil', id, id::text, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= current_date)
    union all select 'boucle_com', id, id::text, contract_cosigned_sent, false, 'Boucle communication à envoyer' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= current_date)
  ), ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || s.venue,
           concat_ws(' · ', nullif(s.proj,''), to_char(s.date, 'DD/MM/YYYY'), s.city),
           s.id, c.r || ':' || c.k || ':' || c.raw
    from cand c join s on s.id = c.id
    -- échéance : J+n décalée au lundi (w) ; boucle accueil & technique (4 mois calendaires) : samedi / dimanche → vendredi précédent
    -- (Q12, v1.49 — même règle que js/reminders.js workDayBefore) ; la clé anti-doublon garde la date brute (aucune notification en double)
    where c.raw is not null and (case when c.w then public.workday(c.raw)
                                      when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int
                                      else c.raw end) <= current_date
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;

-- ─────────────── 2. Variables des mails ───────────────
CREATE OR REPLACE FUNCTION public.mail_vars(p_show uuid, p_contact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; c contacts%rowtype;
  acpt numeric; vat numeric; site text;
begin
  select * into s from shows where id = p_show;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  select * into c from contacts where id = coalesce(p_contact, s.conf_contact_id);
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' and hors_calcul is null order by sort limit 1;
  acpt := coalesce(acpt, case when s.terms_validated_at is not null or s.contract_type = 'Co-Production' then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
  vat := coalesce(s.vat_rate, 5.5);
  site := coalesce(nullif(setting_text('site_url'), ''), 'https://antcb.github.io/lartbo-matrice/');
  return jsonb_build_object(
    'artiste', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', fr_date(s.date), 'date_longue', fr_date(s.date, true),
    'ville', coalesce(s.city, st.city, ''),
    'cp', coalesce(nullif(case when s.department ~ '^\d$' then '0' || s.department else upper(s.department) end, ''),
                 case when lower(trim(st.city)) = lower(trim(s.city)) and st.postal_code ~ '^\d{5}$' then
                   case when st.postal_code ~ '^9[78]' then left(st.postal_code, 3) when st.postal_code ~ '^20' then (case when st.postal_code::int < 20200 then '2A' else '2B' end) else left(st.postal_code, 2) end end, ''),
    'code_postal', coalesce(st.postal_code, ''),
    'lieu', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'adresse', coalesce(nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),
    'jauge', coalesce(s.capacity, (select e.capacity from structure_events e where e.structure_id = st.id and e.capacity is not null order by e.date_start nulls last limit 1), nullif(st.capacity_1, 0))::text,
    'cachet_ht', fr_eur(s.fee_ht),
    'cachet_ttc', fr_eur(round(s.fee_ht * (1 + vat / 100), 2)),
    'tva', replace(rtrim(rtrim(to_char(vat, 'FM990.99'), '0'), '.'), '.', ',') || chr(160) || '%',
    'type_contrat', coalesce(s.contract_type, ''),
    'acompte_pct', replace(rtrim(rtrim(to_char(acpt, 'FM990.99'), '0'), '.'), '.', ',') || chr(160) || '%',   -- « 50 % » (espace insécable, §2.4, v1.49)
    'contact', contact_first_name(c.first_name, c.last_name, c.display_name),
    'contact_email', coalesce(nullif(concat_ws(', ', nullif(trim(c.email), ''), nullif(trim(c.email_2), '')), ''), ''),
    'structure', coalesce(st.name, ''),
    'lien_fiche', site || 'fiche.html?t=' || s.fiche_token,
    'personnes', coalesce(pr.road_people::text, ''),
    'horaire', coalesce(nullif(s.show_time, ''), nullif(s.contract_data->>'show_time', ''), nullif(s.fiche->>'show_time', ''), ''),
    'duree_set', coalesce(nullif(s.set_length, ''), nullif(s.contract_data->>'set_length', ''), nullif(s.fiche->>'set_length', ''), ''),
    'chambres', concat_ws(' et ', case when pr.rooms_single > 0 then pr.rooms_single || ' single-room' || case when pr.rooms_single > 1 then 's' else '' end end,
                                  case when pr.rooms_twin > 0 then pr.rooms_twin || ' twin-room' || case when pr.rooms_twin > 1 then 's' else '' end end),
    'invitations', coalesce(s.invitations::text, ''),
    'montage', coalesce(rtrim(rtrim(to_char(pr.setup_hours, 'FM990.99'), '0'), '.') || ' h', ''));
end $function$;

-- ─────────────── Droits (mêmes droits qu'en production) ───────────────
revoke all on function public.generate_reminders() from public, anon, authenticated, service_role;
grant execute on function public.generate_reminders() to service_role;
revoke all on function public.mail_vars(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mail_vars(uuid, uuid) to authenticated, service_role;
