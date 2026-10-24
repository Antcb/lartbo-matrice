-- v1.40.8 (V1-A lot A2) — PRÉPARÉE, NON APPLIQUÉE : à appliquer seulement sur autorisation explicite d'Anthony.
-- Relances : une facture d'acompte / de solde déjà envoyée et impayée est relancée aussi sur une date booking
-- (décision d'Anthony du 24/10/2026). Une ligne jamais facturée n'a pas de date d'envoi : elle ne génère aucune relance.
-- Règle écrite deux fois (CONVENTIONS §8.4) : côté application js/reminders.js (paidCheck), depuis v1.40.8.
-- Seul changement par rapport à v1.39 (texte identique à la production, vérifié le 24/10/2026) :
--   « acompte_paye » et « solde_paye » ne sont plus limités à « mode <> 'booking' ».
-- Effet estimé au 24/10/2026 (lecture seule) : 1 rappel « Paiement du solde à vérifier » sur une date booking.
-- Aucune donnée existante modifiée. Retour arrière : réappliquer la fonction de 2026-10-21_v1.39_relances_jour_ouvre.sql.

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
      sh.conf_kit_sent, sh.precontract_done, sh.contract_sent, sh.contract_signed, sh.contract_cosigned_sent, sh.boucle_tech, sh.boucle_com,
      a.id a_id, a.sent_at a_sent, a.paid_at a_paid, greatest(a.sent_at, a.reminded_at) a_last,
      so.id so_id, so.sent_at so_sent, so.paid_at so_paid, greatest(so.sent_at, so.reminded_at) so_last,
      c.id c_id, c.sent_at c_sent, c.paid_at c_paid, c.label c_label,
      pt.id pt_id, pt.sent_at pt_sent, pt.paid_at pt_paid, pt.label pt_label
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival') and (sh.date is null or sh.date >= current_date - 120)
  ), cand as (
    -- raw : date brute (clé anti-doublon) ; w : rappel « J+10 » décalé au lundi s'il tombe le week-end
    select 'precontrat' r, id, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_envoi', id, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_signe', id, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= current_date)
    union all select 'contrat_cosigne', id, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= current_date)
    union all select 'facture_acompte', id, contract_sent, false, 'Facture d''acompte à envoyer (contrat envoyé)' from s where mode <> 'booking' and contract_sent is not null and a_id is not null and a_sent is null
    union all select 'acompte_paye', id, a_last + 10, true, 'Paiement de l''acompte à vérifier' from s where a_sent is not null and a_paid is null
    union all select 'solde_paye', id, so_last + 10, true, 'Paiement du solde à vérifier' from s where so_sent is not null and so_paid is null
    union all select 'solde_envoi', id, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Envoyer la facture de solde' from s where mode <> 'booking' and date is not null and so_id is not null and so_sent is null and date >= current_date - 30
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_paid is null
    union all select 'commission_partenaire', id, least(a_paid, so_paid) + 10, true, coalesce(pt_label,'Commission partenaire') || ' : facture à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= current_date)
    union all select 'boucle_com', id, contract_cosigned_sent, false, 'Boucle communication à envoyer (contrat co-signé)' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= current_date)
    union all select 'booking_commission', id, contract_cosigned_sent, false, 'Envoyer la facture de commission à l''artiste' from s where mode = 'booking' and contract_cosigned_sent is not null and c_id is not null and c_sent is null
    union all select 'booking_commission_payee', id, c_sent + 10, true, 'Paiement de la commission à vérifier' from s where mode = 'booking' and c_sent is not null and c_paid is null
  ), ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || s.venue,
           concat_ws(' · ', nullif(s.proj,''), to_char(s.date, 'DD/MM/YYYY'), s.city),
           s.id, c.r || ':' || s.id || ':' || c.raw
    from cand c join s on s.id = c.id
    where c.raw is not null and (case when c.w then public.workday(c.raw) else c.raw end) <= current_date
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;

revoke execute on function public.generate_reminders() from public, anon, authenticated;
