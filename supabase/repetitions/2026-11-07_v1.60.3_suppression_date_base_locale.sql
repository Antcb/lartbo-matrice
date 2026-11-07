-- v1.60.3 — BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production) pour essayer la suppression contrôlée d'une date.
-- Usage : createdb essai ; psql -d essai -f ce_fichier ; psql -d essai -f supabase/migrations/2026-11-07_v1.60.3_suppression_date.sql (deux fois : rejouable) ;
--         psql -d essai -f supabase/repetitions/2026-11-07_v1.60.3_suppression_date_essai.sql
-- Les fonctions de garde (factures émises, hors calcul, verrous du résultat, journal financier, clôture / réouverture) sont
-- recopiées telles quelles des migrations v1.42, v1.43, v1.44, v1.51 et v1.56.9 (extraction automatique).
-- Base de test MINIMALE et jetable (aucune donnée réelle) : tables utiles à la suppression d'une date, clés étrangères relevées
-- en production (tâches et rattachements : NO ACTION ; result_closures : RESTRICT), vraies fonctions de garde des migrations.
set check_function_bodies = false;
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon, service_role;
create table public.app_users (email text primary key);
create or replace function public.is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where email = lower(auth.jwt() ->> 'email')) $$;
create table public.projects (id uuid primary key default gen_random_uuid(), name text);
create table public.shows (id uuid default gen_random_uuid() not null, project_id uuid, structure_id uuid, venue text not null, date date, date_end date, city text, department text, lat double precision, lng double precision, status text default 'Intérêt Salle'::text not null, request_date date, contract_type text, ticketing_type text, fee_ht numeric, partner_id uuid, artbo_pct numeric, partner_pct numeric, conf_kit_sent date, contract_sent date, contract_signed date, contract_cosigned_sent date, boucle_tech date, ticketing_enabled boolean default false not null, capacity integer, comps integer, tickets_sold integer, ticketing_url text, communication_enabled boolean default true not null, boucle_com date, poster_request_date date, poster_status text default 'Quantité à demander'::text, poster_a3 integer default 0, poster_a2 integer default 0, poster_b1 integer default 0, poster_contact_id uuid, poster_delivery text, instagram_url text, facebook_url text, drive_folder_id text, drive_folder_requested_at timestamp with time zone, drive_folder_error text, notes text, notion_id text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), precontract_done date, break_even integer, prod_mode text, prospect_id uuid, vat_rate numeric, fiche_token text default replace((gen_random_uuid())::text, '-'::text, ''::text), fiche jsonb default '{}'::jsonb not null, fiche_submitted_at timestamp with time zone, mail_log jsonb default '{}'::jsonb not null, conf_contact_id uuid, fiche_validated_at timestamp with time zone, contract_data jsonb default '{}'::jsonb not null, contract_doc_id text, contract_pdf_id text, invitations integer, cr_producer_pct numeric, cr_break text, show_time text, set_length text, pennylane_quote_id text, pennylane_quote_url text, budget_note text, production jsonb, terms_validated_at timestamp with time zone, prod_mode_manual boolean default false not null, cnm_pct numeric, cnm_bearer text, cnm_in_result boolean default false not null, ticket_holder text, corea jsonb, result_closed_at timestamp with time zone, result_closed_by text, result_closed jsonb, reversement_paid_at date, corea_share numeric);
alter table public.shows add primary key (id);
alter table public.shows add column spectacle_id uuid;
create table public.show_payments (id uuid primary key default gen_random_uuid(), show_id uuid not null references public.shows(id) on delete cascade,
  kind text not null, label text not null default '', pct numeric, amount numeric, invoice_number text, sent_at date, paid_at date, declared_at date,
  sort int default 0, import_key text, created_at timestamptz default now(), pennylane_id text, pennylane_url text, vat_rate numeric, payee text,
  file_path text, drive_file_id text, hors_calcul text, coprod_role text, coprod_holder text, reminded_at date);
create table public.budget_lines (id uuid primary key default gen_random_uuid(), project_id uuid, show_id uuid references public.shows(id) on delete cascade,
  category text, label text, amount numeric, forecast numeric, qty numeric, unit_cost numeric, payer text, vat_rate numeric, amount_ttc numeric, supplier text, auto boolean, file_path text);
create table public.tasks (id uuid primary key default gen_random_uuid(), title text not null, status text default 'To Do', show_id uuid references public.shows(id));
create table public.attachments (id uuid primary key default gen_random_uuid(), name text not null, path text not null unique);
create table public.commission_transfers (id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.show_payments(id) on delete restrict,
  amount numeric(12,2) not null, transferred_at date not null);
create table public.result_closures (id uuid primary key default gen_random_uuid(), show_id uuid not null references public.shows(id) on delete restrict,
  action text not null check (action in ('close', 'reopen')), reason text, snapshot jsonb, by_email text, at timestamptz not null default now());
create table public.pennylane_a_rattacher (id uuid primary key default gen_random_uuid(), pennylane_id text not null unique,
  show_id uuid references public.shows(id) on delete cascade, reason text not null default 'x', resolved_at timestamptz, cancelled_at timestamptz);
create table public.pennylane_rattachements (id bigint generated always as identity primary key, show_id uuid references public.shows(id), pennylane_id text not null);
create table public.finance_log (id bigint generated always as identity primary key, at timestamptz not null default now(), table_name text not null,
  row_id uuid not null, show_id uuid, op text not null, field text not null, old_value text, new_value text, actor text, source text);
create or replace function public.payment_amount_now(p public.show_payments) returns numeric language sql stable as $$ select p.amount $$;
create or replace function public.finance_actor() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  session_user::text)
$$;

create or replace function public.finance_log_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f text; o jsonb; n jsonb;
  fields text[] := case tg_table_name when 'shows' then array['fee_ht', 'artbo_pct', 'partner_pct', 'vat_rate', 'prod_mode', 'contract_type']
                   else array['amount', 'pct', 'vat_rate', 'kind', 'show_id', 'payee', 'sent_at', 'paid_at', 'invoice_number', 'pennylane_id', 'hors_calcul'] end;   -- hors_calcul : v1.44
  src text := case when coalesce(current_setting('matrice.regularisation', true), '') = 'gel' then 'régularisation contrôlée'
                   when coalesce(current_setting('matrice.regularisation', true), '') in ('degel', 'retour_versement') then 'retour arrière de régularisation'
                   when coalesce(current_setting('matrice.regularisation', true), '') = 'commission_partielle' then 'régularisation contrôlée (commission partielle)'
                   when coalesce(current_setting('matrice.regularisation', true), '') = 'acompte_facture' then 'régularisation contrôlée (facture émise)'
                   when coalesce(current_setting('matrice.regularisation', true), '') = 'hors_calcul' then 'régularisation contrôlée (hors calcul)'
                   when coalesce(current_setting('request.jwt.claims', true), '') <> '' then 'application / fonction serveur'
                   else 'base (éditeur SQL, tâche planifiée)' end;
  sid uuid; fsrc text;
begin
  o := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  sid := case tg_table_name when 'shows' then coalesce(n ->> 'id', o ->> 'id')::uuid else coalesce(n ->> 'show_id', o ->> 'show_id')::uuid end;
  foreach f in array fields loop
    if (o -> f) is distinct from (n -> f) and not (coalesce(o -> f, 'null'::jsonb) = 'null'::jsonb and coalesce(n -> f, 'null'::jsonb) = 'null'::jsonb) then
      -- « régularisation contrôlée » pour un montant : SEULEMENT le cas de l'exception A1 (ligne déjà émise avant, montant vide
      -- rempli). Un montant figé à l'émission dans la même transaction garde la source ordinaire : il ne pourra jamais être revidé.
      fsrc := src;
      -- (deux IF imbriqués : l'expression qui lit OLD comme ligne de facturation n'est évaluée que pour show_payments)
      if src = 'régularisation contrôlée' and tg_table_name = 'show_payments' and f = 'amount' then
        if tg_op <> 'UPDATE' or (o ->> 'amount') is not null then
          fsrc := 'base (éditeur SQL, tâche planifiée)';
        elsif not public.payment_is_emitted(old) then
          fsrc := 'base (éditeur SQL, tâche planifiée)';
        end if;
      end if;
      insert into public.finance_log (table_name, row_id, show_id, op, field, old_value, new_value, actor, source)
      values (tg_table_name, coalesce(n ->> 'id', o ->> 'id')::uuid, sid, tg_op, f, o ->> f, n ->> f, public.finance_actor(), fsrc);
    end if;
  end loop;
  return null;
end $$;

create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  -- ligne hors calcul (coproduction, import) : ni émise ni versée pour les calculs (v1.44)
  select p.hors_calcul is null and case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;

create or replace function public.commission_total(p public.show_payments)
returns numeric language sql stable set search_path = public as $$
  select round(coalesce(p.amount, public.payment_amount_now(p)), 2)
$$;

create or replace function public.commission_transferred(p_payment uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0) from public.commission_transfers where payment_id = p_payment
$$;

create or replace function public.show_payments_commission_lock() returns trigger
language plpgsql set search_path = public as $$
declare done numeric;
begin
  if old.kind <> 'artbo' or not exists (select 1 from public.commission_transfers where payment_id = old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Cette commission a des versements enregistrés : elle ne se supprime pas (ni seule, ni avec sa date).' using errcode = 'P0001';
  end if;
  done := public.commission_transferred(old.id);
  if new.pct is distinct from old.pct or new.kind is distinct from old.kind or new.show_id is distinct from old.show_id then
    raise exception 'Cette commission a des versements enregistrés : son %%, son type et sa date ne se modifient plus.' using errcode = 'P0001';
  end if;
  if new.amount is distinct from old.amount then
    -- seule exception : la régularisation « commission partielle » validée par Anthony (total relevé, jamais sous le déjà transféré)
    if coalesce(current_setting('matrice.regularisation', true), '') = 'commission_partielle'
       and new.amount is not null and new.amount >= done then
      null;
    -- son retour arrière annoncé (« degel ») : le total revient EXACTEMENT au déjà transféré (journalisé comme retour arrière)
    -- seulement si ce total a été relevé par la régularisation « commission partielle » (dernière écriture du montant au journal :
    -- cette valeur → le total actuel) ; un total figé au premier versement ne se modifie jamais (relecture D1)
    elsif coalesce(current_setting('matrice.regularisation', true), '') = 'degel' and new.amount = done
       and exists (select 1 from public.finance_log l where l.id = (select max(m.id) from public.finance_log m where m.row_id = old.id and m.field = 'amount')
                     and l.source = 'régularisation contrôlée (commission partielle)'
                     and (case when l.field = 'amount' then l.old_value::numeric end) = new.amount
                     and (case when l.field = 'amount' then l.new_value::numeric end) = old.amount) then
      null;
    else
      raise exception 'Cette commission a des versements enregistrés : son montant total ne se modifie plus.' using errcode = 'P0001';
    end if;
  end if;
  if new.paid_at is not null and old.paid_at is null and done < public.commission_total(new) - 0.004 then
    raise exception 'Commission versée en partie : note le versement du reste (% €) au lieu d''une date de versement.',
      replace(to_char(public.commission_total(new) - done, 'FM999999990.00'), '.', ',') using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.show_payments_hors_calcul_guard() returns trigger
language plpgsql set search_path = public as $$
declare annonce boolean := coalesce(current_setting('matrice.regularisation', true), '') = 'hors_calcul';
begin
  if tg_op = 'INSERT' then
    if new.hors_calcul is not null and not annonce then
      raise exception 'Une ligne ne se crée pas « hors calcul » : seule une régularisation annoncée classe une ligne existante.' using errcode = 'P0001'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.hors_calcul is not null then
      raise exception 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se supprime pas (ni seule, ni avec sa date).' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.hors_calcul is not distinct from old.hors_calcul then
    if old.hors_calcul is not null then
      raise exception 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se modifie plus.' using errcode = 'P0001'; end if;
    return new;
  end if;
  if not annonce or (to_jsonb(new) - 'hors_calcul' - 'updated_at') is distinct from (to_jsonb(old) - 'hors_calcul' - 'updated_at') then
    raise exception 'Le classement « hors calcul » ne se change que par une régularisation annoncée, sans rien modifier d''autre.' using errcode = 'P0001'; end if;
  if new.hors_calcul is not null and btrim(new.hors_calcul) = '' then
    raise exception 'Motif « hors calcul » vide.' using errcode = 'P0001'; end if;
  if new.hors_calcul is not null and exists (select 1 from public.commission_transfers t where t.payment_id = old.id) then
    raise exception 'Cette commission a des versements enregistrés : elle ne passe pas hors calcul.' using errcode = 'P0001'; end if;
  -- seule une ligne ARTIFICIELLE d'import d'une coproduction peut passer hors calcul : jamais une opération réelle
  -- (pièce, facture numérotée, Pennylane, montant figé, déclaration, versement)
  if new.hors_calcul is not null then
    if not exists (select 1 from public.shows s where s.id = old.show_id and s.contract_type = 'Co-Production') then
      raise exception 'Seule une ligne d''une date en coproduction peut passer hors calcul.' using errcode = 'P0001'; end if;
    if old.kind not in ('acompte', 'solde', 'artbo', 'partner') then
      raise exception 'Seuls un acompte, un solde, une commission ou une part partenaire importés peuvent passer hors calcul.' using errcode = 'P0001'; end if;
    if old.import_key is null then
      raise exception 'Ligne saisie dans la Matrice (pas issue de l''import) : elle ne passe pas hors calcul.' using errcode = 'P0001'; end if;
    if old.amount is not null or old.declared_at is not null
       or nullif(btrim(old.pennylane_id), '') is not null or nullif(btrim(old.pennylane_url), '') is not null
       or old.file_path is not null or old.drive_file_id is not null
       or (nullif(btrim(old.invoice_number), '') is not null and upper(btrim(old.invoice_number)) <> 'N.C') then
      raise exception 'Ligne portant une opération réelle (montant figé, facture numérotée, Pennylane, pièce ou déclaration) : elle ne passe pas hors calcul.' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

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
  if self_paid and coalesce(current_setting('matrice.regularisation', true), '') = 'commission_partielle'
     and new.paid_at is null and new.amount is not null
     and public.commission_transferred(old.id) > 0 and public.commission_transferred(old.id) < new.amount
     and new.amount >= coalesce(old.amount, 0)
     and new.pct is not distinct from old.pct and new.vat_rate is not distinct from old.vat_rate
     and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
     and new.sent_at is not distinct from old.sent_at and new.invoice_number is not distinct from old.invoice_number
     and new.pennylane_id is not distinct from old.pennylane_id then
    return new;
  end if;
  -- v1.56.9 : CORRECTION d'un rattachement Pennylane faite par pennylane_rattacher (transaction annoncée « rattachement_pennylane ») :
  -- une ligne d'acompte / de solde NON payée peut être libérée de sa facture (n°, lien, envoi) ; rien d'autre ne change
  -- (%, TVA, date, nature) et le montant ne peut que revenir au calcul automatique. Jamais une ligne payée.
  if not self_paid and coalesce(current_setting('matrice.regularisation', true), '') = 'rattachement_pennylane'
     and old.kind in ('acompte', 'solde') and old.paid_at is null and new.paid_at is null
     and new.pennylane_id is null and new.invoice_number is null and new.sent_at is null
     and new.pct is not distinct from old.pct and new.vat_rate is not distinct from old.vat_rate
     and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
     and (new.amount is not distinct from old.amount or new.amount is null) then
    return new;
  end if;
  if (old.paid_at is not null and new.paid_at is null)
     or (not self_paid and ((old.sent_at is not null and new.sent_at is null)
       or (nullif(btrim(old.invoice_number), '') is not null and nullif(btrim(new.invoice_number), '') is null)
       or (nullif(btrim(old.pennylane_id), '') is not null and nullif(btrim(new.pennylane_id), '') is null))) then
    raise exception 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas.' using errcode = 'P0001';
  end if;
  if new.amount is distinct from old.amount or new.pct is distinct from old.pct or new.vat_rate is distinct from old.vat_rate
     or new.show_id is distinct from old.show_id or new.kind is distinct from old.kind then
    -- seule exception (lot D1) : FIGER un montant encore vide, sans rien changer d'autre, dans une transaction de régularisation
    -- annoncée explicitement (script validé par Anthony). Un montant déjà rempli ne change jamais.
    if old.amount is null and new.amount is not null
       and new.pct is not distinct from old.pct and new.vat_rate is not distinct from old.vat_rate
       and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
       and coalesce(current_setting('matrice.regularisation', true), '') = 'gel' then
      return new;
    end if;
    -- acompte ou solde FACTURÉ à un autre % que celui de la Matrice (décision d'Anthony du 27/10 : La Puce à l'Oreille, La MOBA,
    -- 50 % facturés, 20 % posés par l'import Notion) : dans une transaction qui l'annonce (« acompte_facture »), le montant encore
    -- vide est FIGÉ au montant de la facture et le % aligné dessus, ensemble et seulement si les deux concordent
    -- (montant = cachet × % arrondi au centime). Rien d'autre ne change ; un montant déjà rempli ne change jamais.
    if not self_paid and old.kind in ('acompte', 'solde') and old.amount is null and new.amount is not null and new.pct is not null
       and new.amount = round(coalesce((select fee_ht from public.shows where id = old.show_id), 0) * new.pct) / 100
       and new.vat_rate is not distinct from old.vat_rate
       and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
       and new.sent_at is not distinct from old.sent_at and new.paid_at is not distinct from old.paid_at
       and new.invoice_number is not distinct from old.invoice_number and new.pennylane_id is not distinct from old.pennylane_id
       and new.payee is not distinct from old.payee
       and coalesce(current_setting('matrice.regularisation', true), '') = 'acompte_facture' then
      return new;
    end if;
    -- retour arrière d'une régularisation (décision d'Anthony du 26/10, point 8) : REVIDER un montant dans une transaction qui
    -- l'annonce (« degel »), et SEULEMENT si ce montant a été posé par une régularisation contrôlée (dernière écriture du montant
    -- au journal : vide → cette valeur, source « régularisation contrôlée… »). Le % ne revient en arrière QUE s'il a été changé
    -- par cette même régularisation (dernière écriture du % au journal : son ancienne valeur → le % actuel, même source).
    -- Un montant figé à l'émission, au versement ou saisi à la main ne se vide jamais.
    if old.amount is not null and new.amount is null
       and new.vat_rate is not distinct from old.vat_rate
       and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
       and coalesce(current_setting('matrice.regularisation', true), '') = 'degel'
       and exists (select 1 from public.finance_log l where l.id = (select max(m.id) from public.finance_log m where m.row_id = old.id and m.field = 'amount')
                     and l.row_id = old.id and l.field = 'amount'
                     and l.source in ('régularisation contrôlée', 'régularisation contrôlée (facture émise)') and l.old_value is null
                     and (case when l.field = 'amount' then l.new_value::numeric end) = old.amount)
       and (new.pct is not distinct from old.pct
            or exists (select 1 from public.finance_log l where l.id = (select max(m.id) from public.finance_log m where m.row_id = old.id and m.field = 'pct')
                         and l.row_id = old.id and l.field = 'pct' and l.source = 'régularisation contrôlée (facture émise)'
                         and l.new_value is not distinct from old.pct::text and l.old_value is not distinct from new.pct::text)) then
      return new;
    end if;
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $function$;

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

create trigger finance_log_shows after insert or update or delete on public.shows for each row execute function public.finance_log_write();
create trigger finance_log_payments after insert or update or delete on public.show_payments for each row execute function public.finance_log_write();
create trigger show_payments_emitted_guard before update or delete on public.show_payments for each row execute function public.show_payments_emitted_guard();
create trigger show_payments_hors_calcul_guard before insert or update or delete on public.show_payments for each row execute function public.show_payments_hors_calcul_guard();
create trigger show_payments_commission_lock before update or delete on public.show_payments for each row execute function public.show_payments_commission_lock();
create trigger result_lock_shows before update on public.shows for each row execute function public.result_lock_shows();
create trigger result_lock_budget_lines before insert or update or delete on public.budget_lines for each row execute function public.result_lock_budget_lines();
create trigger result_lock_payments before insert or update or delete on public.show_payments for each row execute function public.result_lock_payments();
-- droits comme en production : l'équipe lit / écrit les tables métier, jamais result_closures ni finance_log
grant select, insert, update, delete on public.projects, public.shows, public.show_payments, public.budget_lines, public.tasks, public.attachments to authenticated;
grant select on public.result_closures, public.finance_log, public.pennylane_a_rattacher, public.pennylane_rattachements, public.commission_transfers, public.app_users to authenticated;
grant execute on function public.close_result(uuid, jsonb), public.reopen_result(uuid, text) to authenticated;
