-- =====================================================================================================
-- v1.51 — Coréalisation, coproduction, taxe CNM (décisions d'Anthony du 27/10/2026, soir)
-- 1. Taxe CNM : taux par date (vide = Réglages), structure qui supporte contractuellement la charge, prise en compte
--    éventuelle dans le résultat partagé d'une coréalisation ; la confirmation d'une date ne crée PLUS de ligne de facturation
--    « Taxe CNM » (les lignes existantes restent intactes).
-- 2. Structure qui encaisse les recettes (billetterie) d'une date ; coréalisation : tarifs, break validé, méthode, charges
--    déductibles (JSON « corea »).
-- 3. Coproduction : « Clôturer le résultat » (résultat définitif enregistré, montants verrouillés), réouverture explicite,
--    motivée et tracée (table result_closures, jamais modifiée ni effacée) ; date de paiement réel du reversement.
-- 4. Commission en coréalisation : base = MG + part du résultat validée (shows.corea_share) ; payment_amount_for mise à jour.
-- 5. Coproduction : qualification explicite des lignes de Factures (show_payments.coprod_role / coprod_holder), verrou après clôture.
-- Aucune donnée existante n'est modifiée (colonnes ajoutées vides ; aucun update / delete).
-- Retour arrière : voir la fin du fichier.
-- =====================================================================================================

-- ─────────────── 1. Colonnes ───────────────
alter table public.shows add column if not exists cnm_pct numeric check (cnm_pct is null or (cnm_pct >= 0 and cnm_pct <= 100));
alter table public.shows add column if not exists cnm_bearer text check (cnm_bearer is null or cnm_bearer in ('artbo', 'organisateur', 'partenaire'));
alter table public.shows add column if not exists cnm_in_result boolean not null default false;
alter table public.shows add column if not exists ticket_holder text check (ticket_holder is null or ticket_holder in ('artbo', 'organisateur', 'partenaire'));
alter table public.shows add column if not exists corea jsonb;
alter table public.shows add column if not exists result_closed_at timestamptz;
alter table public.shows add column if not exists result_closed_by text;
alter table public.shows add column if not exists result_closed jsonb;
alter table public.shows add column if not exists reversement_paid_at date;
comment on column public.shows.cnm_pct is 'Taux de la taxe CNM pour cette date (vide = réglage default_cnm_pct)';
comment on column public.shows.cnm_bearer is 'Structure qui supporte contractuellement la taxe CNM (artbo / organisateur / partenaire) ; vide = usage habituel';
comment on column public.shows.cnm_in_result is 'Coréalisation : la taxe CNM est déduite du résultat net partagé (si le contrat le prévoit)';
comment on column public.shows.ticket_holder is 'Structure qui encaisse les recettes de billetterie (détenteur de la billetterie)';
comment on column public.shows.corea is 'Coréalisation : tarifs (label, price TTC, vat, qty, after), break validé, méthode validée, charges déductibles';

-- ─────────────── 2. Plus de ligne de facturation « Taxe CNM » à la confirmation ───────────────
-- même fonction que la v1.46, sans les deux insertions de la ligne « cnm »
create or replace function public.on_show_confirmed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      -- v1.51 : plus de ligne « Taxe CNM » (la taxe est calculée dans le budget de la date, décision du 27/10/2026)
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

-- ─────────────── 3. Clôture du résultat d'une coproduction ───────────────
create table if not exists public.result_closures (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete restrict,
  action text not null check (action in ('close', 'reopen')),
  reason text,
  snapshot jsonb,
  by_email text,
  at timestamptz not null default now()
);
alter table public.result_closures enable row level security;
drop policy if exists result_closures_team_read on public.result_closures;
create policy result_closures_team_read on public.result_closures for select to authenticated using (public.is_team());
-- aucune écriture directe : uniquement par close_result / reopen_result (journal jamais modifié ni effacé)
revoke insert, update, delete, truncate on public.result_closures from anon, authenticated;
grant select on public.result_closures to authenticated;

create or replace function public.close_result(p_show uuid, p_snapshot jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  select * into s from shows where id = p_show for update;
  if not found then raise exception 'Date introuvable'; end if;
  if s.contract_type is distinct from 'Co-Production' then raise exception 'Clôture du résultat : réservée aux coproductions'; end if;
  if s.result_closed_at is not null then raise exception 'Le résultat de cette date est déjà clôturé'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Synthèse du résultat manquante'; end if;
  perform set_config('matrice.result_rpc', 'on', true);
  update shows set result_closed_at = now(), result_closed_by = who, result_closed = p_snapshot where id = p_show;
  insert into result_closures (show_id, action, snapshot, by_email) values (p_show, 'close', p_snapshot, who);
  return now();
end $$;

create or replace function public.reopen_result(p_show uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indique le motif de la réouverture'; end if;
  select * into s from shows where id = p_show for update;
  if not found then raise exception 'Date introuvable'; end if;
  if s.result_closed_at is null then raise exception 'Le résultat de cette date n''est pas clôturé'; end if;
  perform set_config('matrice.result_rpc', 'on', true);
  insert into result_closures (show_id, action, reason, snapshot, by_email) values (p_show, 'reopen', btrim(p_reason), s.result_closed, who);
  update shows set result_closed_at = null, result_closed_by = null, result_closed = null where id = p_show;
end $$;
revoke all on function public.close_result(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.close_result(uuid, jsonb) to authenticated;
revoke all on function public.reopen_result(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reopen_result(uuid, text) to authenticated;

-- Verrou : résultat clôturé = montants de la date figés (budget de production, cachet, partenaire, parts, billetterie) ;
-- la clôture et la réouverture ne passent que par les deux fonctions ci-dessus. Les dates de paiement restent modifiables.
create or replace function public.result_lock_shows() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.result_closed_at is distinct from old.result_closed_at or new.result_closed is distinct from old.result_closed
      or new.result_closed_by is distinct from old.result_closed_by)
     and coalesce(current_setting('matrice.result_rpc', true), '') <> 'on' then
    raise exception 'Clôture et réouverture du résultat : utiliser les boutons « Clôturer le résultat » / « Rouvrir »';
  end if;
  -- changement de mode de l'artiste propagé aux dates (project_mode_to_shows, Q10) : une date clôturée garde son mode, sans
  -- faire échouer l'enregistrement du projet (relecture v1.51, B3)
  if old.result_closed_at is not null and new.result_closed_at is not null and pg_trigger_depth() > 1
     and new.prod_mode is distinct from old.prod_mode then
    new.prod_mode := old.prod_mode;
    new.prod_mode_manual := old.prod_mode_manual;
  end if;
  if old.result_closed_at is not null and new.result_closed_at is not null and (
       new.production is distinct from old.production or new.fee_ht is distinct from old.fee_ht
    or new.partner_id is distinct from old.partner_id or new.partner_pct is distinct from old.partner_pct
    or new.contract_type is distinct from old.contract_type or new.ticket_holder is distinct from old.ticket_holder
    or new.cnm_pct is distinct from old.cnm_pct or new.prod_mode is distinct from old.prod_mode) then
    raise exception 'Résultat clôturé : montants verrouillés. Rouvre le résultat (avec un motif) pour les modifier.';
  end if;
  return new;
end $$;
drop trigger if exists result_lock_shows on public.shows;
create trigger result_lock_shows before update on public.shows for each row execute function public.result_lock_shows();

create or replace function public.result_lock_budget_lines() returns trigger
language plpgsql set search_path = public as $$
begin
  -- l'ancienne ET la nouvelle date : une dépense ne quitte ni ne rejoint une date clôturée (relecture v1.51, B2)
  if not exists (select 1 from shows where result_closed_at is not null
                  and id in (case when tg_op <> 'INSERT' then old.show_id end, case when tg_op <> 'DELETE' then new.show_id end)) then
    return coalesce(new, old);
  end if;
  if tg_op in ('INSERT', 'DELETE') or new.show_id is distinct from old.show_id or new.amount is distinct from old.amount
     or new.forecast is distinct from old.forecast or new.qty is distinct from old.qty or new.unit_cost is distinct from old.unit_cost
     or new.category is distinct from old.category or new.payer is distinct from old.payer or new.vat_rate is distinct from old.vat_rate
     or new.amount_ttc is distinct from old.amount_ttc or new.label is distinct from old.label
     or new.supplier is distinct from old.supplier or new.auto is distinct from old.auto then
    raise exception 'Résultat clôturé : les dépenses de cette date sont verrouillées. Rouvre le résultat (avec un motif) pour les modifier.';
  end if;
  return new;
end $$;
drop trigger if exists result_lock_budget_lines on public.budget_lines;
create trigger result_lock_budget_lines before insert or update or delete on public.budget_lines
  for each row execute function public.result_lock_budget_lines();

-- ─────────────── 4. Commission en coréalisation : sur MG + part du résultat validée (décision d'Anthony du 27/10/2026, au soir) ───────────────
-- rémunération brute de l'artiste = MG (cachet HT) + part du résultat net après break ; commission = brute × taux (paramétrage existant :
-- ligne > date > artiste > Réglages, aucune exception par nom) ; nette = brute − commission. La part n'entre dans la base qu'une fois
-- VALIDÉE sur la date (shows.corea_share, vide = MG seul). Une commission déjà figée (montant saisi / figé au versement ou à la facture)
-- n'est jamais recalculée ; aucune ligne existante n'est modifiée (colonne ajoutée vide).
alter table public.shows add column if not exists corea_share numeric check (corea_share is null or corea_share >= 0);
comment on column public.shows.corea_share is 'Coréalisation : part du résultat net après break VALIDÉE (HT) ; entre dans la base de la commission (MG + part)';

create or replace function public.corea_share_of(p_show uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce((select s.corea_share from public.shows s where s.id = p_show and s.contract_type = 'Co-Réalisation'), 0)
$$;
revoke all on function public.corea_share_of(uuid) from public, anon, authenticated, service_role;
grant execute on function public.corea_share_of(uuid) to authenticated, service_role;

-- même fonction que la v1.46 ; seule la base des commissions (artbo, partner) change
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

revoke all on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) to authenticated, service_role;

-- garde : la part validée (ou le contrat) ne change pas si une commission / part partenaire déjà émise ou versée SANS montant figé en
-- dépend (son montant changerait) — même règle que shows_frozen_guard pour le cachet et les % (l'application refuse aussi : changeBlocked)
create or replace function public.corea_share_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (case when old.contract_type = 'Co-Réalisation' then coalesce(old.corea_share, 0) else 0 end)
     is not distinct from (case when new.contract_type = 'Co-Réalisation' then coalesce(new.corea_share, 0) else 0 end) then return new; end if;
  if exists (select 1 from public.show_payments p where p.show_id = new.id and p.kind in ('artbo', 'partner') and p.amount is null
             and public.payment_is_emitted(p)) then
    raise exception 'Une commission de cette date est déjà émise ou versée sans montant figé : la part du résultat retenue ne change plus (son montant changerait). Une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.corea_share_guard() from public, anon, authenticated, service_role;
drop trigger if exists corea_share_guard on public.shows;
create trigger corea_share_guard before update of corea_share, contract_type on public.shows for each row execute function public.corea_share_guard();

-- ─────────────── 5. Coproduction : recettes complémentaires qualifiées explicitement (décision d'Anthony du 28/10/2026) ───────────────
-- Une ligne de Factures d'une coproduction ne devient JAMAIS d'office une recette du résultat : elle est qualifiée à la main
-- (recette complémentaire / hors calcul / déjà comptabilisée ailleurs) ; une recette complémentaire a sa structure qui l'encaisse.
-- Colonnes ajoutées vides : aucune ligne existante requalifiée. Après clôture, une ligne qualifiée est verrouillée (montant,
-- qualification, encaisseur), sa date d'encaissement reste libre ; une ligne non qualifiée (ex. facture du reversement) reste libre.
alter table public.show_payments add column if not exists coprod_role text check (coprod_role is null or coprod_role in ('recette', 'hors_resultat', 'ailleurs'));
alter table public.show_payments add column if not exists coprod_holder text check (coprod_holder is null or coprod_holder in ('artbo', 'partenaire'));
comment on column public.show_payments.coprod_role is 'Coproduction : recette (complémentaire, dans le résultat une fois) / hors_resultat / ailleurs (déjà comptée) ; vide = non qualifiée';
comment on column public.show_payments.coprod_holder is 'Coproduction : structure qui doit encaisser la recette complémentaire (artbo / partenaire)';

create or replace function public.result_lock_payments() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from shows where result_closed_at is not null
                  and id in (case when tg_op <> 'INSERT' then old.show_id end, case when tg_op <> 'DELETE' then new.show_id end)) then
    return coalesce(new, old);
  end if;
  if (tg_op = 'INSERT' and new.coprod_role is not null) or (tg_op = 'DELETE' and old.coprod_role is not null)
     or (tg_op = 'UPDATE' and (old.coprod_role is not null or new.coprod_role is not null) and (
          new.coprod_role is distinct from old.coprod_role or new.coprod_holder is distinct from old.coprod_holder
       or new.amount is distinct from old.amount or new.pct is distinct from old.pct or new.kind is distinct from old.kind
       or new.show_id is distinct from old.show_id)) then
    raise exception 'Résultat clôturé : les recettes qualifiées de cette date sont verrouillées. Rouvre le résultat (avec un motif) pour les modifier.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.result_lock_payments() from public, anon, authenticated, service_role;
drop trigger if exists result_lock_payments on public.show_payments;
create trigger result_lock_payments before insert or update or delete on public.show_payments
  for each row execute function public.result_lock_payments();

-- Retour arrière (après accord) :
--   drop trigger result_lock_budget_lines on budget_lines ; drop trigger result_lock_shows on shows ;
--   drop function result_lock_budget_lines(), result_lock_shows(), close_result(uuid, jsonb), reopen_result(uuid, text) ;
--   drop trigger result_lock_payments on show_payments ; drop function result_lock_payments() ;
--   drop trigger corea_share_guard on shows ; drop function corea_share_guard() ; recréer payment_amount_for dans sa version v1.46
--   (la colonne corea_share vide redonne de toute façon le calcul sur le cachet seul) ; puis drop function corea_share_of(uuid) ;
--   recréer on_show_confirmed dans sa version v1.46 (supabase/migrations/2026-10-27_v1.46_finances.sql) ;
--   la table result_closures et les colonnes ajoutées restent (aucune perte) tant qu'une suppression n'est pas décidée.
