-- =====================================================================================================
-- RETOUR ARRIÈRE DURABLE LOT D1 SUR LE PROJET DE TEST (dthfocplfzzmkgaxhmwk)
-- Corps IDENTIQUE au retour arrière de production, garde du projet de test.
-- =====================================================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $g$
begin
  -- IDENTITÉ (même contrôle que le déploiement C1 du 26/10)
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%dthfocplfzzmkgaxhmwk%') then
    raise exception 'ARRET : ce n''est pas le projet de TEST (dthfocplfzzmkgaxhmwk) — rien n''a été fait'; end if;
  if exists (select 1 from public.settings where value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : l''identifiant de l''autre projet est présent dans les réglages — rien n''a été fait'; end if;
  if (select count(*) from public.shows) >= 200 then
    raise exception 'ARRET : nombre de dates incohérent avec le projet de TEST — rien n''a été fait'; end if;
end $g$;
-- Instantané des données : le retour arrière ne doit RIEN changer aux données (le journal est GARDÉ, en lecture seule)
drop table if exists _d1_ra;
create temp table _d1_ra on commit drop as select (select count(*) from public.show_payments) n_lignes, (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t) lignes,
       (select count(*) from public.shows) n_dates, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t) dates,
       (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t) artistes;
do $p$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) <> 4 or to_regclass('public.finance_log') is null then
    raise exception 'ARRET : le lot D1 n''est pas (entièrement) en place — rien n''a été fait'; end if;
end $p$;
-- v1.44 (coproductions) : seulement si AUCUNE ligne n'est classée hors calcul (sinon : retour arrière du script F d'abord)
do $h$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_payments' and column_name = 'hors_calcul')
     and exists (select 1 from public.show_payments where hors_calcul is not null) then
    raise exception 'ARRET : des lignes sont classées hors calcul — retour arrière du script F d''abord — rien n''a été fait'; end if;
end $h$;
drop trigger if exists show_payments_hors_calcul_guard on public.show_payments;
drop trigger if exists commission_transfers_hors_calcul on public.commission_transfers;
drop function if exists public.show_payments_hors_calcul_guard();
drop function if exists public.commission_transfers_hors_calcul();
-- fonctions de production : versions d'avant v1.44 (textes relevés en production, empreintes contrôlées ci-dessous)
CREATE OR REPLACE FUNCTION public.ensure_production_payments(p_show uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ac numeric := coalesce(setting_num('default_acompte_pct'), 50); s record; has_ac boolean; has_so boolean; sum_ac numeric; mx int;
begin
  select * into s from shows where id = p_show;
  if s is null or coalesce(s.prod_mode, 'production') = 'booking' or s.status not in ('Confirmée Salle','Confirmée Festival') then return; end if;
  perform pg_advisory_xact_lock(hashtext('pay:' || p_show));
  select coalesce(max(sort), 0) into mx from show_payments where show_id = p_show;
  has_ac := exists (select 1 from show_payments where show_id = p_show and kind = 'acompte');
  has_so := exists (select 1 from show_payments where show_id = p_show and kind = 'solde');
  -- rien de prévu : acompte par défaut + solde ; un solde déjà là sans acompte = choix « sans acompte », gardé tel quel
  if not has_ac and not has_so then
    insert into show_payments (show_id, kind, label, pct, sort, payee) values
      (p_show, 'acompte', 'Acompte', ac, mx + 1, 'compte'), (p_show, 'solde', 'Solde', greatest(0, 100 - ac), mx + 2, 'compte');
  elsif not has_so then
    select coalesce(sum(pct), 0) into sum_ac from show_payments where show_id = p_show and kind = 'acompte';
    insert into show_payments (show_id, kind, label, pct, sort, payee) values (p_show, 'solde', 'Solde', greatest(0, 100 - sum_ac), mx + 1, 'compte');
  end if;
end $function$
;
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
begin
  if setting_text('import_mode') = 'true' then return new; end if;
  if new.status not in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  select * into p from projects where id = new.project_id;
  if new.artbo_pct is null then
    update shows set artbo_pct = coalesce(p.default_artbo_pct, setting_num(case when coalesce(new.prod_mode, p.mode) = 'booking' then 'default_artbo_pct_booking' else 'default_artbo_pct_production' end), setting_num('default_artbo_pct')) where id = new.id;
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
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
        (new.id, 'solde', 'Solde', 100 - coalesce(setting_num('default_acompte_pct'), 20), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fiche_get(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; pays jsonb; vat numeric; acpt numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  vat := coalesce(s.vat_rate, 5.5);
  select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'kind', p.kind, 'pct', p.pct, 'due_label', p.due_label,
           'ht', coalesce(p.amount, round(s.fee_ht * p.pct) / 100)) order by p.sort), '[]')
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde');
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type, 'prod_mode', coalesce(s.prod_mode, 'production'),
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break, 'show_time', s.show_time, 'set_length', s.set_length,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $function$
;
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
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  acpt := coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
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
    'tva', replace(rtrim(rtrim(to_char(vat, 'FM990.99'), '0'), '.'), '.', ',') || ' %',
    'type_contrat', coalesce(s.contract_type, ''),
    'acompte_pct', replace(rtrim(rtrim(to_char(acpt, 'FM990.99'), '0'), '.'), '.', ',') || '%',
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
end $function$
;
-- calculs : versions v1.42 / v1.43
create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  select case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                        or exists (select 1 from public.commission_transfers t where t.payment_id = p.id)))
$$;
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
      (so.sent_at is not null or so.paid_at is not null or nullif(btrim(so.invoice_number), '') is not null
       or nullif(btrim(so.pennylane_id), '') is not null) so_emis,
      c.id c_id, c.sent_at c_sent, c.paid_at c_paid, c.label c_label,
      case when c.id is null then null when c.paid_at is not null and public.commission_transferred(c.id) = 0 then 0
           else greatest(public.commission_total(c) - public.commission_transferred(c.id), 0) end c_reste,
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
    union all select 'facture_acompte', id, contract_sent, false, 'Facture d''acompte à envoyer (contrat envoyé)' from s where mode <> 'booking' and contract_sent is not null and a_id is not null and a_sent is null and not coalesce(so_emis, false)
    union all select 'acompte_paye', id, a_last + 10, true, 'Paiement de l''acompte à vérifier' from s where mode <> 'booking' and a_sent is not null and a_paid is null
    union all select 'solde_paye', id, so_last + 10, true, 'Paiement du solde à vérifier' from s where mode <> 'booking' and so_sent is not null and so_paid is null
    union all select 'solde_envoi', id, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Envoyer la facture de solde' from s where mode <> 'booking' and date is not null and so_id is not null and so_sent is null and date >= current_date - 30
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_reste > 0.004
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
drop index if exists public.show_payments_une_commission;
create unique index show_payments_une_commission on public.show_payments (show_id) where kind = 'artbo';   -- version v1.43
alter table public.show_payments drop column if exists hors_calcul;
-- v1.43 (versements de commission) : seulement si AUCUN versement n'est enregistré (sinon : décision d'Anthony)
do $v$ begin
  if to_regclass('public.commission_transfers') is not null and exists (select 1 from public.commission_transfers) then
    raise exception 'ARRET : des versements de commission sont enregistrés — retour arrière impossible sans décision d''Anthony — rien n''a été fait'; end if;
end $v$;
drop trigger if exists commission_transfer_before on public.commission_transfers;
drop trigger if exists commission_transfer_after on public.commission_transfers;
drop trigger if exists finance_log_transfers on public.commission_transfers;
drop trigger if exists show_payments_commission_lock on public.show_payments;
drop trigger if exists show_payments_commission_paid on public.show_payments;
-- fonction « date engagée » : version v1.42 (sans les versements) avant de retirer la table
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))
$$;
drop table if exists public.commission_transfers;
drop function if exists public.commission_transfer_before();
drop function if exists public.commission_transfer_after();
drop function if exists public.show_payments_commission_lock();
drop function if exists public.show_payments_commission_paid();
drop function if exists public.finance_log_transfers();
drop function if exists public.commission_total(public.show_payments);
drop function if exists public.commission_transferred(uuid);
drop index if exists public.show_payments_une_commission;
-- Rappels : version de production v1.41 (texte identique au fichier 2026-10-26_v1.41_relances_c1.sql)
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
      (so.sent_at is not null or so.paid_at is not null or nullif(btrim(so.invoice_number), '') is not null
       or nullif(btrim(so.pennylane_id), '') is not null) so_emis,
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
    union all select 'facture_acompte', id, contract_sent, false, 'Facture d''acompte à envoyer (contrat envoyé)' from s where mode <> 'booking' and contract_sent is not null and a_id is not null and a_sent is null and not coalesce(so_emis, false)
    union all select 'acompte_paye', id, a_last + 10, true, 'Paiement de l''acompte à vérifier' from s where mode <> 'booking' and a_sent is not null and a_paid is null
    union all select 'solde_paye', id, so_last + 10, true, 'Paiement du solde à vérifier' from s where mode <> 'booking' and so_sent is not null and so_paid is null
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
-- v1.42
drop trigger show_payments_freeze on public.show_payments;
drop trigger shows_frozen_guard on public.shows;
drop trigger finance_log_shows on public.shows;
drop trigger finance_log_payments on public.show_payments;
drop function public.show_payments_freeze();
drop function public.shows_frozen_guard();
drop function public.finance_log_write();
drop function public.finance_actor();
drop function public.payment_amount_now(public.show_payments);
drop function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text);
-- Fonctions de mode (artiste → dates) et protection A1 : versions de production d'avant le lot D1 (relevées le 26/10/2026)
CREATE OR REPLACE FUNCTION public.project_mode_to_shows()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows s set prod_mode = new.mode
     where s.project_id = new.id and not s.prod_mode_manual
       and not exists (select 1 from public.show_payments p where p.show_id = s.id
                        and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(s.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                             or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null)));
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.show_follow_project_mode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual
     and not exists (select 1 from public.show_payments p where p.show_id = new.id
                      and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(new.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                           or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))) then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$
;
drop function public.show_has_financial_record(uuid);
drop function public.payment_is_emitted(public.show_payments);
CREATE OR REPLACE FUNCTION public.show_payments_emitted_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$   -- §7.3
declare
  -- commission de production : la date doit exister et ne pas être en booking. Date introuvable (suppression en chaîne : la date
  -- est déjà effacée quand ce déclencheur passe) → définition complète, comme pour toute autre ligne (relecture C1, B1)
  self_paid boolean := old.kind = 'artbo' and exists (select 1 from public.shows where id = old.show_id and coalesce(prod_mode, 'production') <> 'booking');
  emitted boolean := case when self_paid then old.paid_at is not null
                     else old.sent_at is not null or old.paid_at is not null
                          or nullif(btrim(old.invoice_number), '') is not null or nullif(btrim(old.pennylane_id), '') is not null end;
begin
  if not emitted then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Facture déjà émise : elle ne se supprime pas (ni seule, ni avec sa date).' using errcode = 'P0001';
  end if;
  if (old.paid_at is not null and new.paid_at is null)
     or (not self_paid and ((old.sent_at is not null and new.sent_at is null)
       or (nullif(btrim(old.invoice_number), '') is not null and nullif(btrim(new.invoice_number), '') is null)
       or (nullif(btrim(old.pennylane_id), '') is not null and nullif(btrim(new.pennylane_id), '') is null))) then
    raise exception 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas.' using errcode = 'P0001';
  end if;
  if new.amount is distinct from old.amount or new.pct is distinct from old.pct or new.vat_rate is distinct from old.vat_rate
     or new.show_id is distinct from old.show_id or new.kind is distinct from old.kind then
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $function$;
do $ctl$
begin
  if md5(pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) <> 'cd2ea4e4c8d85e9ea58d3166d5040978' then
    raise exception 'ECHEC : la protection A1 n''a pas retrouvé sa version d''avant le lot D1 — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.show_payments_caduc_guard()'::regprocedure)) <> 'd713c4d0d1d45d2359981c49f1bf2239' then
    raise exception 'ECHEC : la protection C1 a été modifiée — TOUT EST ANNULÉ'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('show_payments_emitted_guard', 'show_payments_caduc_guard')) <> 2 then
    raise exception 'ECHEC : protections A1 / C1 absentes — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) <> 'ae7f1ea9d1646f23f3aa57d292d40b18'
     or md5(pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) <> '45fe55a664ff4c423386a7d6f280cbd0' then
    raise exception 'ECHEC : fonctions de mode non revenues à leur version d''avant — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.generate_reminders()'::regprocedure)) <> '6f834c203fcdae7b7a02c06df4c1f81d' then
    raise exception 'ECHEC : la fonction des rappels n''est pas revenue à sa version d''avant — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.ensure_production_payments(uuid)'::regprocedure)) <> 'd55c81ebb5ef14b26aacf6de07681fb7' then
    raise exception 'ECHEC : ensure_production_payments n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.on_show_confirmed()'::regprocedure)) <> 'f0cfdf80d6b7c8d3c7e1d7c4093201dd' then
    raise exception 'ECHEC : on_show_confirmed n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.fiche_get(text)'::regprocedure)) <> '18c6b88bcb0c9b56ed2062cd83ca338e' then
    raise exception 'ECHEC : fiche_get n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.mail_vars(uuid, uuid)'::regprocedure)) <> 'a1bb413b3f321997c4f3b87b338ed53d' then
    raise exception 'ECHEC : mail_vars n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_payments' and column_name = 'hors_calcul') then
    raise exception 'ECHEC : colonne hors_calcul encore présente — TOUT EST ANNULÉ'; end if;
  if to_regclass('public.commission_transfers') is not null then
    raise exception 'ECHEC : table des versements encore présente — TOUT EST ANNULÉ'; end if;
  if to_regprocedure('public.show_has_financial_record(uuid)') is not null then
    raise exception 'ECHEC : fonction du lot D1 encore présente — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) then
    raise exception 'ECHEC : déclencheurs du lot D1 encore présents — TOUT EST ANNULÉ'; end if;
  if (select (n_lignes, lignes, n_dates, dates, artistes) is distinct from
             ((select count(*) from public.show_payments), (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t),
              (select count(*) from public.shows), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t),
              (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t)) from _d1_ra) then
    raise exception 'ECHEC : des données ont changé pendant le retour arrière — TOUT EST ANNULÉ'; end if;
end $ctl$;
commit;
