-- =====================================================================================================
-- v1.46 — Lot V1.46a : FINANCES (décisions d'Anthony du 27/10/2026, état des lieux V1)
--  1. Factures : la date d'envoi se saisit à la main. Une facture faite (numéro ou lien Pennylane) sans date d'envoi donne le
--     rappel « Facture à envoyer » 3 jours après (jour ouvré), maintenu jusqu'à la saisie de la date d'envoi.
--     show_payments.invoiced_on : jour où la facture a été faite (date de la facture Pennylane, posée par la synchronisation ;
--     sinon jour où le numéro / le lien est noté pour la première fois, posé par le déclencheur ci-dessous). Les lignes déjà
--     numérotées ne sont PAS modifiées (le rappel prend alors la date de création de la ligne).
--  2. Factures impayées : rappel 10 jours après l'envoi ou la dernière relance, SANS limite de 120 jours (Q13), pour TOUTES les
--     factures suivies (plus seulement le premier acompte / le premier solde), jusqu'au paiement ; suspension à la main, ligne par
--     ligne (show_payments.reminders_paused). Commission à virer : délai au premier encaissement, toutes lignes confondues (Q14).
--  3. Acompte par défaut (§6.4, Q3) : réglage appliqué tel quel, 0 % compris (= date sans acompte : seul le solde est créé) ;
--     50 seulement si le réglage est absent ou vide (plus de 20 dans on_show_confirmed).
--  4. Commission par défaut (§6.3, Q1–Q2) : % de la ligne > % de la date > % de l'artiste > Réglages selon le mode de la date
--     (default_commission_pct) ; plus de repli à 0 dans payment_amount_for, plus de l'ancien réglage default_artbo_pct.
--  5. Compte d'encaissement : renseigné seulement à l'enregistrement du paiement — ensure_production_payments ne pose plus
--     payee = 'compte' à la création des lignes (les lignes existantes gardent leur compte).
-- Même règle côté application : js/reminders.js, js/selectors.js (showCommissionPct, defaultAcompte), js/calc.js (payAmount),
-- js/views/production.js (case « Relances suspendues ») ; fonction Pennylane : regles.ts (pctCommission), index.ts (invoiced_on).
-- Aucune donnée existante n'est modifiée par cette migration (deux colonnes ajoutées, vides / à faux).
-- Retour arrière : voir la fin du fichier.
-- =====================================================================================================

alter table public.show_payments add column if not exists invoiced_on date;
alter table public.show_payments add column if not exists reminders_paused boolean not null default false;
comment on column public.show_payments.invoiced_on is 'Jour où la facture a été faite (date Pennylane, sinon premier numéro / lien noté) : départ du rappel « Facture à envoyer » (v1.46).';
comment on column public.show_payments.reminders_paused is 'Relances « Paiement à vérifier » suspendues à la main pour cette facture (v1.46) ; la facture reste impayée et comptée.';

-- ─────────────── 1. Jour où la facture est faite ───────────────
create or replace function public.show_payments_invoiced_on() returns trigger
language plpgsql set search_path = public as $$
begin
  -- seulement quand la ligne DEVIENT une facture faite (aucun numéro ni lien avant) : jamais une ligne historique déjà numérotée
  if new.invoiced_on is null
     and (nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null)
     and (tg_op = 'INSERT' or (nullif(btrim(old.invoice_number), '') is null and nullif(btrim(old.pennylane_id), '') is null)) then
    new.invoiced_on := (now() at time zone 'Europe/Paris')::date;
  end if;
  return new;
end $$;
drop trigger if exists show_payments_invoiced_on on public.show_payments;
create trigger show_payments_invoiced_on before insert or update of invoice_number, pennylane_id on public.show_payments
  for each row execute function public.show_payments_invoiced_on();

-- ─────────────── 2. Commission par défaut d'une date (même règle que js/selectors.js showCommissionPct) ───────────────
-- % de l'artiste, sinon Réglages selon le mode de la DATE (p_mode, sinon celui de la date, sinon celui de l'artiste) ;
-- 15 (booking) / 20 (production) seulement si le réglage est absent, vide ou nul — comme defaultCommission en JS
create or replace function public.default_commission_pct(p_show uuid, p_mode text)
returns numeric language sql stable set search_path = public as $$
  select coalesce(pr.default_artbo_pct,
           case when nullif(btrim(public.setting_text(k.cle)), '')::numeric > 0 then nullif(btrim(public.setting_text(k.cle)), '')::numeric end,
           case when k.mode = 'booking' then 15 else 20 end)
    from public.shows s
    left join public.projects pr on pr.id = s.project_id
    cross join lateral (select coalesce(p_mode, s.prod_mode, pr.mode, 'production') mode) m
    cross join lateral (select m.mode, case when m.mode = 'booking' then 'default_artbo_pct_booking' else 'default_artbo_pct_production' end cle) k
   where s.id = p_show
$$;

-- ─────────────── 3. Montant d'une ligne (même règle que js/calc.js payAmount / soldeDue) : commission sans repli à 0 ───────────────
create or replace function public.payment_amount_for(p public.show_payments, p_fee numeric, p_artbo numeric, p_partner numeric, p_mode text)
 returns numeric
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare done numeric; fixed numeric; fee numeric := coalesce(p_fee, 0); pct_com numeric;
begin
  if p.amount is not null then return p.amount; end if;
  if p.kind in ('artbo', 'partner') then
    -- % de la ligne (commission) > % de la date > % de l'artiste > Réglages selon le mode de la date (v1.46 : plus de repli à 0)
    pct_com := coalesce(p_artbo, public.default_commission_pct(p.show_id, p_mode), 0);
    if p.kind = 'artbo' then return round(fee * coalesce(p.pct, pct_com)) / 100; end if;
    return round(fee * pct_com * coalesce(p.pct, p_partner, 0) / 100) / 100;
  end if;
  if p.kind = 'solde' and coalesce(p_mode, 'production') <> 'booking' then
    -- solde de production : cession − acomptes facturés − autres soldes figés ; un autre solde calculé placé avant lui prend le reste
    -- (plusieurs soldes = anomalie signalée par l'application). Sert au gel à l'émission (= soldeDue en JS). Pour un solde DÉJÀ émis
    -- sans montant (historique, 0 après régularisation), le JS (payAmount) prend cachet × % : les deux varient avec le cachet, la garde
    -- shows_frozen_guard refuse donc les mêmes changements que changeBlocked (relecture D1, point 1)
    if exists (select 1 from public.show_payments q where q.show_id = p.show_id and q.kind = 'solde' and q.id <> p.id and q.amount is null
               and not public.payment_is_emitted(q) and (coalesce(q.sort, 0) < coalesce(p.sort, 0) or (coalesce(q.sort, 0) = coalesce(p.sort, 0) and q.id::text < p.id::text))) then
      return 0;
    end if;
    select coalesce(sum(case when a.amount is not null then a.amount when a.pct is null then 0 else round(fee * a.pct) / 100 end), 0) into done
      from public.show_payments a where a.show_id = p.show_id and a.kind = 'acompte' and a.id <> p.id and public.payment_is_emitted(a);
    select coalesce(sum(case when q.amount is not null then q.amount when q.pct is null then 0 else round(fee * q.pct) / 100 end), 0) into fixed
      from public.show_payments q where q.show_id = p.show_id and q.kind = 'solde' and q.id <> p.id and (q.amount is not null or public.payment_is_emitted(q));
    return greatest(0, round((fee - done - fixed) * 100) / 100);
  end if;
  if p.kind = 'cnm' or p.pct is null then return null; end if;
  return round(fee * p.pct) / 100;
end $function$;

-- ─────────────── 4. Lignes créées à la confirmation : acompte par défaut tel quel, commission par défaut sans ancien réglage ───────────────
CREATE OR REPLACE FUNCTION public.on_show_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  url text := setting_text('drive_webhook_url');
  secret text := setting_text('drive_webhook_secret');
  p projects%rowtype;
  partner_default numeric;
  ac numeric := coalesce(nullif(btrim(setting_text('default_acompte_pct')), '')::numeric, 50);   -- 0 % gardé (= sans acompte) ; 50 si vide (§6.4)
begin
  if setting_text('import_mode') = 'true' then return new; end if;
  if new.status not in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  select * into p from projects where id = new.project_id;
  if new.artbo_pct is null then
    -- % de l'artiste, sinon Réglages selon le mode de la date (§6.3) — plus l'ancien réglage default_artbo_pct
    update shows set artbo_pct = public.default_commission_pct(new.id, coalesce(new.prod_mode, p.mode)) where id = new.id;
  end if;
  if coalesce(new.prod_mode, p.mode, 'production') = 'booking' then
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values (new.id, 'artbo', 'Facture commission (artiste)', null, 30);
    end if;
  else
    if new.partner_id is null and p.default_partner_id is not null then
      select default_pct into partner_default from partners where id = p.default_partner_id;
      update shows set partner_id = p.default_partner_id,
                       partner_pct = coalesce(new.partner_pct, p.default_partner_pct, partner_default)
       where id = new.id;
    end if;
    -- coproduction (décision d'Anthony du 27/10/2026) : ni acompte, ni solde, ni commission L'ArtBo, ni part partenaire générés ;
    -- ses opérations réelles s'ajoutent à la main quand elles existent
    if not exists (select 1 from show_payments where show_id = new.id) and new.contract_type is distinct from 'Co-Production' then
      if ac > 0 then
        insert into show_payments (show_id, kind, label, pct, sort) values (new.id, 'acompte', 'Acompte', ac, 10);
      end if;
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'solde', 'Solde', greatest(0, 100 - ac), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
    end if;
    -- coproduction : la taxe CNM (billetterie) reste prévue, comme avant ; aucune ligne de facturation
    if new.contract_type = 'Co-Production' and not exists (select 1 from show_payments where show_id = new.id and kind = 'cnm') then
      insert into show_payments (show_id, kind, label, pct, sort) values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
    end if;
    if new.contract_type in ('Production','Co-Production','Co-Réalisation') and not new.ticketing_enabled then
      update shows set ticketing_enabled = true where id = new.id;
    end if;
  end if;
  if new.drive_folder_id is null and new.drive_folder_requested_at is null and coalesce(url,'') <> '' then
    update shows set drive_folder_requested_at = now() where id = new.id;
    perform net.http_post(url := url, body := jsonb_build_object('secret', secret, 'show_id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_production_payments(p_show uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ac numeric := coalesce(nullif(btrim(setting_text('default_acompte_pct')), '')::numeric, 50); s record; has_ac boolean; has_so boolean; sum_ac numeric; mx int;
begin
  select * into s from shows where id = p_show;
  if s is null or coalesce(s.prod_mode, 'production') = 'booking' or s.status not in ('Confirmée Salle','Confirmée Festival') then return; end if;
  if s.contract_type = 'Co-Production' then return; end if;   -- coproduction : aucune ligne de facturation générée (27/10/2026)
  perform pg_advisory_xact_lock(hashtext('pay:' || p_show));
  select coalesce(max(sort), 0) into mx from show_payments where show_id = p_show;
  has_ac := exists (select 1 from show_payments where show_id = p_show and kind = 'acompte' and hors_calcul is null);   -- une ligne hors calcul ne compte pas (relecture D1)
  has_so := exists (select 1 from show_payments where show_id = p_show and kind = 'solde' and hors_calcul is null);
  -- rien de prévu : acompte par défaut (sauf 0 % = sans acompte) + solde ; un solde déjà là sans acompte = choix « sans acompte », gardé tel quel.
  -- Compte d'encaissement (payee) jamais posé ici : il se renseigne à l'enregistrement du paiement (décision du 27/10, v1.46)
  if not has_ac and not has_so then
    if ac > 0 then
      insert into show_payments (show_id, kind, label, pct, sort) values (p_show, 'acompte', 'Acompte', ac, mx + 1);
    end if;
    insert into show_payments (show_id, kind, label, pct, sort) values (p_show, 'solde', 'Solde', greatest(0, 100 - ac), mx + 2);
  elsif not has_so then
    select coalesce(sum(pct), 0) into sum_ac from show_payments where show_id = p_show and kind = 'acompte' and hors_calcul is null;
    insert into show_payments (show_id, kind, label, pct, sort) values (p_show, 'solde', 'Solde', greatest(0, 100 - sum_ac), mx + 1);
  end if;
end $function$;

-- ─────────────── 5. Rappels (même règle que js/reminders.js remindersOf ; libellés identiques) ───────────────
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
    union all select 'commission_partenaire', id, id::text, cashed + 10, true, 'Facture ' || coalesce(pt_label,'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from s where mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id::text, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= current_date)
    union all select 'boucle_com', id, id::text, contract_cosigned_sent, false, 'Boucle communication à envoyer' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= current_date)
  ), ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || s.venue,
           concat_ws(' · ', nullif(s.proj,''), to_char(s.date, 'DD/MM/YYYY'), s.city),
           s.id, c.r || ':' || c.k || ':' || c.raw
    from cand c join s on s.id = c.id
    where c.raw is not null and (case when c.w then public.workday(c.raw) else c.raw end) <= current_date
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;

-- ─────────────── 6. Droits (mêmes droits qu'en production, relevés le 27/10/2026) ───────────────
revoke all on function public.show_payments_invoiced_on() from public, anon, authenticated, service_role;
revoke all on function public.default_commission_pct(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.default_commission_pct(uuid, text) to authenticated, service_role;
revoke all on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) to authenticated, service_role;
revoke all on function public.on_show_confirmed() from public, anon, authenticated, service_role;
grant execute on function public.on_show_confirmed() to service_role;
revoke all on function public.ensure_production_payments(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ensure_production_payments(uuid) to service_role;
revoke all on function public.generate_reminders() from public, anon, authenticated, service_role;
grant execute on function public.generate_reminders() to service_role;

-- Retour arrière : recréer payment_amount_for (v1.42), on_show_confirmed et ensure_production_payments (v1.44), generate_reminders
-- (v1.44) dans leur version d'avant ; drop trigger show_payments_invoiced_on on public.show_payments ; drop function
-- show_payments_invoiced_on(), default_commission_pct(uuid, text). Les deux colonnes peuvent rester (vides / à faux) ; les retirer
-- seulement sur décision d'Anthony (invoiced_on peut déjà porter des dates).
