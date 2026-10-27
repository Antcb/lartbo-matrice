-- =====================================================================================================
-- v1.51 — Coréalisation, coproduction, taxe CNM (décisions d'Anthony du 27/10/2026, soir)
-- 1. Taxe CNM : taux par date (vide = Réglages), structure qui supporte contractuellement la charge, prise en compte
--    éventuelle dans le résultat partagé d'une coréalisation ; la confirmation d'une date ne crée PLUS de ligne de facturation
--    « Taxe CNM » (les lignes existantes restent intactes).
-- 2. Structure qui encaisse les recettes (billetterie) d'une date ; coréalisation : tarifs, break validé, méthode, charges
--    déductibles (JSON « corea »).
-- 3. Coproduction : « Clôturer le résultat » (résultat définitif enregistré, montants verrouillés), réouverture explicite,
--    motivée et tracée (table result_closures, jamais modifiée ni effacée) ; date de paiement réel du reversement.
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

-- Retour arrière (après accord) :
--   drop trigger result_lock_budget_lines on budget_lines ; drop trigger result_lock_shows on shows ;
--   drop function result_lock_budget_lines(), result_lock_shows(), close_result(uuid, jsonb), reopen_result(uuid, text) ;
--   recréer on_show_confirmed dans sa version v1.46 (supabase/migrations/2026-10-27_v1.46_finances.sql) ;
--   la table result_closures et les colonnes ajoutées restent (aucune perte) tant qu'une suppression n'est pas décidée.
