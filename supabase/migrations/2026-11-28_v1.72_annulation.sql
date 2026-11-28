-- v1.72 — L3 du point 02 « Annuler la date » (décisions d'Anthony du 28/11/2026, 12 h 08).
--  1. Une date ENGAGÉE (contrat signé, facture émise, encaissement, commission versée ou dépense engagée même non payée —
--     show_engagee) ne passe en « Annulée » que par « Annuler la date » (show_annuler) ; « Sans Suite » y est refusé. Garde de la base
--     (shows_annulation_guard) sur tous les chemins ; date non engagée : comportement inchangé.
--  2. Fiche d'annulation (annulations) : conditions initiales figées (copie), régime, montant total dû après annulation HT acompte
--     compris (cession ; 0 = sans frais), motif et date obligatoires, justificatif (lien ou référence) ; journal avant / après
--     (annulations_journal). Une seule fiche active par date.
--  3. Factures émises et paiements jamais modifiés. Lignes NON émises (acompte, solde, autre) : le solde (sinon la première ligne non
--     émise) garde seulement ce qui reste à facturer (montant dû − facturé net après avoirs) ; les autres, ou toutes si rien ne reste,
--     « ne doivent plus être émises » (show_payments.annulation, montant 0) — visibles, hors des montants à facturer et des relances.
--     Montant initial gardé dans la fiche. Une ligne « ne doit plus être émise » ne s'émet pas (garde show_payments_annulation_guard).
--  4. Commission : montant existant gardé (« À revoir », L5). Booking : écran limité à la commission. Coproduction, coréalisation :
--     motif, documents et mouvements, sans calcul (L8).
--  5. Relances (reminder_candidates, même règle : js/reminders.js) : date annulée = aucune relance d'organisation ni des lignes
--     abandonnées. Cession (ajustement du 28/11/2026, 13 h 25) : « Facture de solde à faire » pour le solde recalculé ; « Facture à
--     envoyer » tant que le facturé net ne dépasse pas le montant retenu (annulation_depasse), sinon facture « à régulariser » sans
--     relance ; impayé gardé seulement si le montant réclamé (restes dus HT des factures relancées) ne dépasse pas ce qui reste dû
--     (montant dû − encaissé HT), sinon « À régulariser », relance suspendue. Booking : commission à revoir → relance suspendue.
--  5 bis. Ajout d'une ligne de facturation (acompte, solde, autre) sur une date annulée avec fiche : refusé en base (même garde) ;
--     le solde recalculé reste facturable et « Rétablir la date » fonctionne (transaction annoncée).
--  6. Correction (annulation_corriger) : motif obligatoire, trace avant / après. Rétablir (annulation_retablir) : seulement si aucune
--     facture, aucun avoir, aucun paiement ni remboursement n'a été ajouté ou modifié depuis (empreinte) ; les lignes reprennent leur
--     état d'origine et la date son statut d'avant.
-- Aucun document ni mouvement financier créé. Aucune donnée existante modifiée. Rejouable.
-- Retour arrière : réappliquer reminder_candidates de la v1.70 ; drop des déclencheurs et fonctions v1.72 ; tables et colonne gardées.
begin;

-- ─── tables ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.show_payments add column if not exists annulation text;
alter table public.show_payments drop constraint if exists show_payments_annulation_check;
alter table public.show_payments add constraint show_payments_annulation_check check (annulation is null or annulation in ('abandonnee', 'recalculee'));
comment on column public.show_payments.annulation is 'v1.72 (L3) : ligne non émise d''une date annulée — abandonnee (ne doit plus être émise, montant 0) ou recalculee (reste à facturer après annulation) ; montant initial dans annulations.lignes';

create table if not exists public.annulations (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete restrict,
  regime text not null check (regime in ('cession', 'booking', 'coprod', 'corea')),
  montant_du_ht numeric(12,2) check (montant_du_ht is null or (montant_du_ht >= 0 and montant_du_ht < 100000000)),
  motif text not null check (btrim(motif) <> ''),
  decide_le date not null,
  justificatif text,
  statut_avant text not null,
  initial jsonb not null,
  lignes jsonb not null default '[]'::jsonb,
  empreinte text,
  created_at timestamptz not null default now(),
  created_by text,
  corrige_at timestamptz, corrige_par text,
  retablie_at timestamptz, retablie_par text, retablie_motif text,
  constraint annulations_montant check ((regime = 'cession') = (montant_du_ht is not null)),
  constraint annulations_retablie check ((retablie_at is null) = (retablie_motif is null))
);
create unique index if not exists annulations_active on public.annulations (show_id) where retablie_at is null;
comment on table public.annulations is 'v1.72 (L3) : fiche d''annulation d''une date engagée — conditions initiales figées, montant dû après annulation, lignes recalculées / abandonnées ; jamais supprimée';

create table if not exists public.annulations_journal (
  id bigint generated always as identity primary key,
  annulation_id uuid not null references public.annulations(id) on delete restrict,
  show_id uuid not null,
  action text not null check (action in ('annuler', 'corriger', 'retablir')),
  avant jsonb, apres jsonb, motif text, auteur text,
  at timestamptz not null default now()
);
create index if not exists annulations_journal_annulation on public.annulations_journal (annulation_id);
comment on table public.annulations_journal is 'v1.72 (L3) : historique des annulations de dates (annuler, corriger, rétablir) : avant / après, motif, auteur, date';

do $$ declare t text; begin
  foreach t in array array['annulations', 'annulations_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using (public.is_team())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ─── règles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- date engagée (décision 1 du 28/11/2026) — même règle : js/calc.js dateEngagee
create or replace function public.show_engagee(p_show uuid) returns boolean
 language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.shows s where s.id = p_show and s.contract_signed is not null)
      or exists (select 1 from public.show_payments p where p.show_id = p_show and p.hors_calcul is null and public.payment_is_emitted(p))
      or exists (select 1 from public.reglements r where r.show_id = p_show and r.etat = 'fait' and r.annule_at is null)
      or exists (select 1 from public.commission_transfers t join public.show_payments p on p.id = t.payment_id where p.show_id = p_show)
      or exists (select 1 from public.budget_lines l where l.show_id = p_show and (l.amount is not null or l.paid_at is not null or l.reimbursed_at is not null
                   or nullif(btrim(l.doc_number), '') is not null or l.file_path is not null))
$$;
-- interne (gardes et fonctions d'annulation) : l'application calcule de son côté (js/calc.js dateEngagee)
revoke all on function public.show_engagee(uuid) from public, anon, authenticated;

-- régime de l'annulation : booking (commission seule), coproduction, coréalisation (sans calcul, L8), sinon cession — js/annulation-regles.js
create or replace function public.annulation_regime(s public.shows) returns text
 language sql immutable set search_path = public, pg_temp
as $$
  select case when coalesce(s.prod_mode, 'production') = 'booking' then 'booking' when s.contract_type = 'Co-Production' then 'coprod'
              when s.contract_type = 'Co-Réalisation' then 'corea' else 'cession' end
$$;
revoke all on function public.annulation_regime(public.shows) from public, anon, authenticated;

-- TVA d'une ligne de cession (même règle que reglement_couverture et js/calc.js payVat)
create or replace function public.annulation_tva(p public.show_payments) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(p.vat_rate, (select s.vat_rate from public.shows s where s.id = p.show_id), 5.5) $$;
revoke all on function public.annulation_tva(public.show_payments) from public, anon, authenticated;

-- encaissé net HT d'une ligne : mouvements faits (équivalent HT au centime), sinon paiement historique au montant de la ligne (E1)
-- — même règle : js/calc.js encaisseHt (mouvementsOf)
create or replace function public.annulation_encaisse_ht(p public.show_payments) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select sum(round((case when r.sens = 'remboursement' then -1 else 1 end) * r.montant_ttc / (1 + public.annulation_tva(p) / 100), 2))
                     from public.reglements r where r.payment_id = p.id and r.etat = 'fait' and r.annule_at is null), 0)
       + case when p.paid_at is not null and not exists (select 1 from public.reglements r where r.payment_id = p.id and r.etat = 'fait'
                and r.annule_at is null and r.sens = 'encaissement') then coalesce(public.payment_amount_now(p), 0) else 0 end
$$;
revoke all on function public.annulation_encaisse_ht(public.show_payments) from public, anon, authenticated;

-- reste dû HT d'une facture émise — même règle : js/calc.js resteDu
create or replace function public.annulation_reste_ht(p public.show_payments) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$
  select case when p.paid_at is not null or not public.payment_is_emitted(p) then 0
              when not exists (select 1 from public.reglements r where r.payment_id = p.id and r.annule_at is null)
                then greatest(0, round(coalesce(public.payment_amount_now(p), 0) - least(public.avoir_couvert(p.id), greatest(0, coalesce(public.payment_amount_now(p), 0))), 2))
              else (select round(greatest(0, c.net - c.enc) / (1 + public.annulation_tva(p) / 100), 2) from public.reglement_couverture(p) c) end
$$;
revoke all on function public.annulation_reste_ht(public.show_payments) from public, anon, authenticated;

-- relance d'impayé d'une date annulée (décision 6) : gardée seulement si le montant réclamé (restes dus des factures relancées) ne
-- dépasse pas ce qui reste dû après annulation (montant dû − encaissé) ; booking / coproduction / coréalisation : jamais (à revoir)
-- — même règle : js/annulation.js relanceImpaye
create or replace function public.annulation_relance_impaye(p_show uuid) returns boolean
 language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select (select coalesce(sum(public.annulation_reste_ht(p)), 0) from public.show_payments p
             where p.show_id = p_show and p.hors_calcul is null and p.kind in ('acompte', 'solde', 'autre') and public.payment_is_emitted(p)
               and p.sent_at is not null and p.paid_at is null and not p.reminders_paused
               and not coalesce(p.amount > 0 and public.avoir_couvert(p.id) > 0 and public.avoir_couvert(p.id) >= p.amount - 0.005, false))
           <= greatest(0, a.montant_du_ht - (select coalesce(sum(public.annulation_encaisse_ht(p)), 0) from public.show_payments p
                                             where p.show_id = p_show and p.hors_calcul is null and p.kind in ('acompte', 'solde', 'autre'))) + 0.01
      from public.annulations a where a.show_id = p_show and a.retablie_at is null and a.regime = 'cession'), false)
$$;
-- interne (reminder_candidates) : l'application calcule de son côté (js/calc.js etatAnnulation)
revoke all on function public.annulation_relance_impaye(uuid) from public, anon, authenticated;

-- facturé au-delà du montant retenu (cession) : facturé net des lignes émises, après avoirs, supérieur au montant dû — la facture est
-- alors « à régulariser » et n'est plus relancée pour l'envoi (décision du 28/11/2026, 13 h 25) ; même calcul que annulation_appliquer
-- et js/annulation-regles.js planAnnulation (depassement)
create or replace function public.annulation_depasse(p_show uuid) returns boolean
 language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select (select coalesce(sum(greatest(0, coalesce(public.payment_amount_now(x), 0) - least(public.avoir_couvert(x.id), greatest(0, coalesce(public.payment_amount_now(x), 0))))), 0)
              from public.show_payments x
             where x.show_id = p_show and x.hors_calcul is null and x.kind in ('acompte', 'solde', 'autre') and public.payment_is_emitted(x))
           > a.montant_du_ht + 0.005
      from public.annulations a where a.show_id = p_show and a.retablie_at is null and a.regime = 'cession'), false)
$$;
-- interne (reminder_candidates)
revoke all on function public.annulation_depasse(uuid) from public, anon, authenticated;

-- empreinte des opérations financières de la date (rétablir seulement si rien n'a été ajouté ni modifié depuis l'annulation) :
-- factures (émission), avoirs, encaissements / remboursements, réémissions, versements de commission ; les montants posés par
-- l'annulation elle-même (lignes recalculées / abandonnées) n'y entrent pas
create or replace function public.annulation_empreinte(p_show uuid) returns text
 language sql stable security definer set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    (select string_agg(concat_ws(',', p.id, p.kind, p.sent_at, p.paid_at, btrim(p.invoice_number), btrim(p.pennylane_id), p.hors_calcul,
            case when p.annulation is null then concat_ws('/', p.amount, p.pct) end), ';' order by p.id) from public.show_payments p where p.show_id = p_show),
    (select string_agg(concat_ws(',', r.id, r.sens, r.etat, r.montant_ttc, r.date, r.annule_at, r.transaction_id), ';' order by r.id)
       from public.reglements r where r.show_id = p_show),
    (select string_agg(concat_ws(',', a.id, a.etat, a.payment_id, a.amount_ht, a.amount_ttc, a.gone_at, a.facture_remplacee), ';' order by a.id)
       from public.pennylane_avoirs a where a.show_id = p_show or a.payment_id in (select id from public.show_payments where show_id = p_show)),
    (select string_agg(concat_ws(',', f.id, f.detache_at), ';' order by f.id) from public.factures_remplacees f where f.show_id = p_show),
    (select string_agg(concat_ws(',', t.id, t.amount, t.transferred_at), ';' order by t.id)
       from public.commission_transfers t join public.show_payments p on p.id = t.payment_id where p.show_id = p_show)))
$$;
revoke all on function public.annulation_empreinte(uuid) from public, anon, authenticated;

-- copie figée des conditions initiales (date, lignes avec montant du moment, encaissements, avoirs, commission, dépenses engagées)
create or replace function public.annulation_copie(p_show uuid) returns jsonb
 language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'show', (select jsonb_build_object('status', s.status, 'date', s.date, 'venue', s.venue, 'city', s.city, 'contract_type', s.contract_type,
               'prod_mode', coalesce(s.prod_mode, 'production'), 'fee_ht', s.fee_ht, 'vat_rate', s.vat_rate, 'artbo_pct', s.artbo_pct,
               'partner_pct', s.partner_pct, 'contract_signed', s.contract_signed, 'corea_share', s.corea_share) from public.shows s where s.id = p_show),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'label', p.label, 'sort', p.sort, 'pct', p.pct, 'amount', p.amount,
               'montant_ht', public.payment_amount_now(p), 'emise', public.payment_is_emitted(p), 'invoice_number', p.invoice_number,
               'sent_at', p.sent_at, 'paid_at', p.paid_at, 'pennylane_id', p.pennylane_id, 'avoir_ht', public.avoir_couvert(p.id),
               'encaisse_ht', public.annulation_encaisse_ht(p), 'hors_calcul', p.hors_calcul) order by p.sort, p.id)
             from public.show_payments p where p.show_id = p_show), '[]'::jsonb),
    'commission_versee', (select coalesce(sum(t.amount), 0) from public.commission_transfers t join public.show_payments p on p.id = t.payment_id where p.show_id = p_show),
    'depenses', coalesce((select jsonb_agg(jsonb_build_object('label', coalesce(l.label, l.category), 'amount', l.amount, 'paid_at', l.paid_at) order by l.sort, l.id)
             from public.budget_lines l where l.show_id = p_show and (l.amount is not null or l.paid_at is not null or l.reimbursed_at is not null
               or nullif(btrim(l.doc_number), '') is not null or l.file_path is not null)), '[]'::jsonb))
$$;
revoke all on function public.annulation_copie(uuid) from public, anon, authenticated;

-- applique le montant dû aux lignes NON émises (cession) et renvoie leur plan [{payment_id, kind, label, montant_initial, nouveau, etat}]
-- — même calcul : js/annulation-regles.js planAnnulation. Appelée dans une transaction annoncée (matrice.annulation = on).
create or replace function public.annulation_appliquer(p_show uuid, p_du numeric) returns jsonb
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare fact numeric; reste numeric; cible uuid; p public.show_payments; init numeric; nouv numeric; plan jsonb := '[]'::jsonb;
begin
  select coalesce(sum(greatest(0, coalesce(public.payment_amount_now(x), 0) - least(public.avoir_couvert(x.id), greatest(0, coalesce(public.payment_amount_now(x), 0))))), 0)
    into fact from public.show_payments x
   where x.show_id = p_show and x.hors_calcul is null and x.kind in ('acompte', 'solde', 'autre') and public.payment_is_emitted(x);
  reste := greatest(0, round(p_du - fact, 2));
  select x.id into cible from public.show_payments x
   where x.show_id = p_show and x.hors_calcul is null and x.kind in ('acompte', 'solde', 'autre') and not public.payment_is_emitted(x)
   order by (x.kind = 'solde') desc, x.sort nulls last, x.id limit 1;
  -- montants initiaux lus AVANT toute écriture (le solde calculé dépend des acomptes)
  for p in select * from public.show_payments x where x.show_id = p_show and x.hors_calcul is null and x.kind in ('acompte', 'solde', 'autre')
             and not public.payment_is_emitted(x) order by x.sort nulls last, x.id loop
    init := round(coalesce(public.payment_amount_now(p), 0), 2);
    nouv := case when p.id = cible then reste else 0 end;
    plan := plan || jsonb_build_object('payment_id', p.id, 'kind', p.kind, 'label', p.label, 'pct', p.pct, 'amount', p.amount, 'montant_initial', init,
      'nouveau', nouv, 'etat', case when nouv > 0 then 'recalculee' else 'abandonnee' end);
  end loop;
  update public.show_payments x set amount = (e ->> 'nouveau')::numeric, annulation = e ->> 'etat'
    from jsonb_array_elements(plan) e where x.id = (e ->> 'payment_id')::uuid;
  return jsonb_build_object('facture_net', fact, 'reste', reste, 'plan', plan);
end $$;
revoke all on function public.annulation_appliquer(uuid, numeric) from public, anon, authenticated;

-- remet les lignes encore non émises d'une fiche dans leur état d'origine (montant, %, sans marque) — transaction annoncée
create or replace function public.annulation_defaire(a public.annulations) returns void
 language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.show_payments x set amount = case when e ? 'amount' and e ->> 'amount' is not null then (e ->> 'amount')::numeric end, annulation = null
    from jsonb_array_elements(a.lignes) e
   where x.id = (e ->> 'payment_id')::uuid and not public.payment_is_emitted(x);
end $$;
revoke all on function public.annulation_defaire(public.annulations) from public, anon, authenticated;

-- ─── gardes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.shows_annulation_guard() returns trigger
 language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status or coalesce(current_setting('matrice.annulation', true), '') = 'on' then return new; end if;
  if exists (select 1 from public.annulations a where a.show_id = old.id and a.retablie_at is null) then
    raise exception 'Date annulée avec une fiche d''annulation : son statut ne change que par « Rétablir la date »' using errcode = 'P0001';
  end if;
  if new.status in ('Annulée', 'Sans Suite') and coalesce(old.status, '') not in ('Annulée', 'Sans Suite') and public.show_engagee(old.id) then
    raise exception 'Date engagée (contrat signé, facture émise, encaissement, commission versée ou dépense engagée) : passe par « Annuler la date »%',
      case when new.status = 'Sans Suite' then ' (« Sans Suite » n''est pas possible pour une date engagée)' else '' end using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.shows_annulation_guard() from public, anon, authenticated;
drop trigger if exists shows_annulation_guard on public.shows;
create trigger shows_annulation_guard before update of status on public.shows for each row execute function public.shows_annulation_guard();

create or replace function public.show_payments_annulation_guard() returns trigger
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare annonce boolean := coalesce(current_setting('matrice.annulation', true), '') = 'on';
begin
  -- (ajustement du 28/11/2026, 13 h 25) aucune ligne de facturation ajoutée — ni rattachée par changement de date ou de nature — à
  -- une date annulée avec une fiche active : le montant dû se change par « Corriger l'annulation » ; même règle : js/calc.js insertBlocked
  if not annonce and new.kind in ('acompte', 'solde', 'autre')
     and (tg_op = 'INSERT' or new.show_id is distinct from old.show_id or new.kind is distinct from old.kind)
     and exists (select 1 from public.annulations a where a.show_id = new.show_id and a.retablie_at is null) then
    raise exception 'Date annulée : aucune ligne de facturation (acompte, solde, autre ligne) ne s''y ajoute ; passe par « Corriger l''annulation »' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if new.annulation is not null and not annonce then
      raise exception 'Le marquage d''annulation d''une ligne ne se pose que par « Annuler la date » ou « Corriger l''annulation »' using errcode = 'P0001'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.annulation is not null and not annonce then
      raise exception 'Ligne fixée par l''annulation de la date : elle ne se supprime pas' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.annulation is distinct from old.annulation and not annonce then
    raise exception 'Le marquage d''annulation d''une ligne ne change que par « Annuler la date », « Corriger l''annulation » ou « Rétablir la date »' using errcode = 'P0001';
  end if;
  if old.annulation is not null and not annonce and (new.amount is distinct from old.amount or new.pct is distinct from old.pct
       or new.kind is distinct from old.kind or new.show_id is distinct from old.show_id) then
    raise exception 'Montant fixé par l''annulation de la date : passe par « Corriger l''annulation »' using errcode = 'P0001';
  end if;
  if new.annulation = 'abandonnee' and (new.sent_at is not null or new.paid_at is not null
       or nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null) then
    raise exception 'Cette ligne ne doit plus être émise (date annulée) : corrige d''abord l''annulation' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.show_payments_annulation_guard() from public, anon, authenticated;
drop trigger if exists show_payments_annulation_guard on public.show_payments;
create trigger show_payments_annulation_guard before insert or update or delete on public.show_payments for each row execute function public.show_payments_annulation_guard();

-- ─── fonctions de l'équipe ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.show_annuler(p_show uuid, p_montant numeric, p_motif text, p_decide_le date, p_justificatif text default null)
 returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.shows; reg text; a public.annulations; m text := nullif(btrim(p_motif), ''); j text := nullif(btrim(p_justificatif), ''); res jsonb;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 1000 then raise exception 'Motif obligatoire (1 000 caractères au plus)'; end if;
  if p_decide_le is null then raise exception 'Date de la décision obligatoire'; end if;
  if length(j) > 1000 then raise exception 'Justificatif : 1 000 caractères au plus'; end if;
  select * into s from public.shows where id = p_show for update;
  if not found then raise exception 'Date introuvable'; end if;
  if s.status in ('Annulée', 'Sans Suite') then raise exception 'Date déjà en « % »', s.status; end if;
  if s.archived_at is not null then raise exception 'Date archivée : restaure-la d''abord'; end if;
  if exists (select 1 from public.annulations x where x.show_id = s.id and x.retablie_at is null) then raise exception 'Cette date a déjà une fiche d''annulation'; end if;
  if not public.show_engagee(s.id) then raise exception 'Date non engagée : elle passe en « Annulée » directement, sans fiche'; end if;
  reg := public.annulation_regime(s);
  if reg = 'cession' and (p_montant is null or p_montant = 'NaN'::numeric or p_montant < 0 or p_montant >= 100000000) then
    raise exception 'Montant total dû après annulation à saisir (HT, acompte compris ; 0 = sans frais)'; end if;
  if reg <> 'cession' and p_montant is not null then raise exception 'Pas de montant à saisir pour cette date (calcul hors de ce lot)'; end if;
  insert into public.annulations (show_id, regime, montant_du_ht, motif, decide_le, justificatif, statut_avant, initial, created_by)
  values (s.id, reg, case when reg = 'cession' then round(p_montant, 2) end, m, p_decide_le, j, s.status, public.annulation_copie(s.id), auth.jwt() ->> 'email')
  returning * into a;
  perform set_config('matrice.annulation', 'on', true);
  if reg = 'cession' then res := public.annulation_appliquer(s.id, a.montant_du_ht); end if;
  update public.shows set status = 'Annulée' where id = s.id;
  perform set_config('matrice.annulation', '', true);
  update public.annulations set lignes = coalesce(res -> 'plan', '[]'::jsonb), empreinte = public.annulation_empreinte(s.id) where id = a.id returning * into a;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, s.id, 'annuler', jsonb_build_object('status', s.status), jsonb_build_object('status', 'Annulée', 'montant_du_ht', a.montant_du_ht,
    'decide_le', a.decide_le, 'justificatif', a.justificatif, 'lignes', a.lignes), m, auth.jwt() ->> 'email');
  return a;
end $$;

create or replace function public.annulation_corriger(p_id uuid, p_montant numeric, p_motif text, p_decide_le date, p_justificatif text, p_motif_correction text)
 returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; n public.annulations; m text := nullif(btrim(p_motif), ''); mc text := nullif(btrim(p_motif_correction), '');
        j text := nullif(btrim(p_justificatif), ''); res jsonb; gardees jsonb;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if mc is null or length(mc) > 1000 then raise exception 'Motif de la correction obligatoire (1 000 caractères au plus)'; end if;
  if m is null or length(m) > 1000 then raise exception 'Motif obligatoire (1 000 caractères au plus)'; end if;
  if p_decide_le is null then raise exception 'Date de la décision obligatoire'; end if;
  if length(j) > 1000 then raise exception 'Justificatif : 1 000 caractères au plus'; end if;
  select * into a from public.annulations where id = p_id and retablie_at is null for update;
  if not found then raise exception 'Fiche d''annulation introuvable ou rétablie'; end if;
  perform 1 from public.shows where id = a.show_id for update;
  if a.regime = 'cession' and (p_montant is null or p_montant = 'NaN'::numeric or p_montant < 0 or p_montant >= 100000000) then
    raise exception 'Montant total dû après annulation à saisir (HT, acompte compris ; 0 = sans frais)'; end if;
  if a.regime <> 'cession' and p_montant is not null then raise exception 'Pas de montant à saisir pour cette date (calcul hors de ce lot)'; end if;
  perform set_config('matrice.annulation', 'on', true);
  if a.regime = 'cession' then
    -- lignes émises depuis l'annulation : gardées telles quelles (leur plan d'origine reste dans la fiche) ; les autres sont recalculées
    select coalesce(jsonb_agg(e), '[]'::jsonb) into gardees from jsonb_array_elements(a.lignes) e
     where exists (select 1 from public.show_payments x where x.id = (e ->> 'payment_id')::uuid and public.payment_is_emitted(x));
    perform public.annulation_defaire(a);
    res := public.annulation_appliquer(a.show_id, round(p_montant, 2));
  end if;
  perform set_config('matrice.annulation', '', true);
  update public.annulations set montant_du_ht = case when a.regime = 'cession' then round(p_montant, 2) end, motif = m, decide_le = p_decide_le, justificatif = j,
    lignes = case when a.regime = 'cession' then gardees || coalesce(res -> 'plan', '[]'::jsonb) else a.lignes end,
    corrige_at = now(), corrige_par = auth.jwt() ->> 'email'
   where id = a.id returning * into n;
  update public.annulations set empreinte = public.annulation_empreinte(a.show_id) where id = a.id returning * into n;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'corriger', jsonb_build_object('montant_du_ht', a.montant_du_ht, 'motif', a.motif, 'decide_le', a.decide_le, 'justificatif', a.justificatif, 'lignes', a.lignes),
    jsonb_build_object('montant_du_ht', n.montant_du_ht, 'motif', n.motif, 'decide_le', n.decide_le, 'justificatif', n.justificatif, 'lignes', n.lignes), mc, auth.jwt() ->> 'email');
  return n;
end $$;

create or replace function public.annulation_retablir(p_id uuid, p_motif text) returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; n public.annulations; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 1000 then raise exception 'Motif obligatoire (1 000 caractères au plus)'; end if;
  select * into a from public.annulations where id = p_id and retablie_at is null for update;
  if not found then raise exception 'Fiche d''annulation introuvable ou déjà rétablie'; end if;
  perform 1 from public.shows where id = a.show_id for update;
  if public.annulation_empreinte(a.show_id) is distinct from a.empreinte then
    raise exception 'Une facture, un avoir, un paiement ou un remboursement a été ajouté ou modifié depuis l''annulation : la date reste à régulariser (rien n''est rétabli)';
  end if;
  perform set_config('matrice.annulation', 'on', true);
  perform public.annulation_defaire(a);
  update public.shows set status = a.statut_avant where id = a.show_id;
  update public.annulations set retablie_at = now(), retablie_par = auth.jwt() ->> 'email', retablie_motif = m where id = a.id returning * into n;
  perform set_config('matrice.annulation', '', true);
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'retablir', jsonb_build_object('status', 'Annulée', 'lignes', a.lignes), jsonb_build_object('status', a.statut_avant), m, auth.jwt() ->> 'email');
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.show_annuler(uuid, numeric, text, date, text)',
    'public.annulation_corriger(uuid, numeric, text, date, text, text)', 'public.annulation_retablir(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ─── relances ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- reminder_candidates : garde — corps de production v1.70 attendu (ou déjà la v1.72), sinon arrêt sans rien appliquer
do $m$
declare b text := (select prosrc from pg_proc where oid = 'public.reminder_candidates(uuid, boolean)'::regprocedure);
begin
  if md5(b) <> '692d4401e045af57cceb0130e2a52594' and position('v1.72 (L3)' in b) = 0 then
    raise exception 'v1.72 : reminder_candidates n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (
    -- v1.72 (L3) : date annulée avec une fiche d'annulation (décisions du 28/11/2026, 12 h 08 et 13 h 25), cession seulement :
    -- « Facture de solde à faire » pour le solde recalculé (so_recalc) ; « Facture à envoyer » tant que le facturé net ne dépasse pas
    -- le montant retenu (envoi_ok, annulation_depasse) ; impayé seulement si le montant réclamé ne dépasse pas ce qui reste dû
    -- (impaye_ok, annulation_relance_impaye) ; rien d'autre (lignes « ne doit plus être émise » exclues : f) — même règle : js/reminders.js
    select an.id is not null annule, (an.id is not null and an.regime = 'cession' and public.annulation_relance_impaye(sh.id)) impaye_ok,
      (an.id is not null and an.regime = 'cession' and not public.annulation_depasse(sh.id)) envoi_ok,
      (an.id is not null and an.regime = 'cession' and so.annulation = 'recalculee') so_recalc,
      sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
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
      -- v1.70 (L2a) : encaissement partiel enregistré (reglements) compris — même règle : js/reminders.js (premierEncaissement)
      least((select min(x.paid_at) from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind in ('acompte', 'solde')),
            (select min(r.date) from reglements r join show_payments x on x.id = r.payment_id where r.show_id = sh.id and x.hors_calcul is null
               and x.kind in ('acompte', 'solde') and r.sens = 'encaissement' and r.etat = 'fait' and r.annule_at is null)) cashed
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join annulations an on an.show_id = sh.id and an.retablie_at is null
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
    where (sh.status in ('Confirmée Salle','Confirmée Festival') or (sh.status = 'Annulée' and an.id is not null))
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
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn,
      -- v1.69 (L1, point 02) : facture SOLDÉE par ses avoirs Pennylane (montant figé entièrement couvert) : ni « à envoyer » ni
      -- « paiement à vérifier » ; avoir partiel : la facture reste suivie ; sans avoir, ou montant nul / négatif : jamais soldée
      -- (relecture v1.69, B1) — même règle : js/calc.js soldeeParAvoir
      coalesce(x.amount > 0 and public.avoir_couvert(x.id) > 0 and public.avoir_couvert(x.id) >= x.amount - 0.005, false) soldee
    from show_payments x join d on d.id = x.show_id
    where x.hors_calcul is null and ((d.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (d.mode = 'booking' and x.kind = 'artbo'))
      and x.annulation is distinct from 'abandonnee'   -- v1.72 : ligne qui ne doit plus être émise, jamais relancée
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
                          else faite_le + n_fe end, wa, 'Facture à envoyer : ' || nom from f where on_fe and faite and sent_at is null and paid_at is null and not soldee
    -- facture envoyée impayée : n jours (10 par défaut) après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end || ':' || (greatest(sent_at, reminded_at) + 10),
                     greatest(sent_at, reminded_at) + n_pa, wa,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where on_pa and sent_at is not null and paid_at is null and not reminders_paused and not soldee
    union all select 'commission', id, id || ':' || (cashed + 10), cashed + n_co, wa, coalesce(c_label,'Commission L’ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser'
                     from d where on_co and mode <> 'booking' and cashed is not null and c_id is not null and c_reste > 0.004
    union all select 'commission_partenaire', id, id || ':' || (cashed + 10), cashed + n_cp, wa, 'Facture ' || coalesce(nullif(pt_label, ''),'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from d where on_cp and mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id || ':' || (date - interval '4 months')::date, case when wb then (date - make_interval(months => n_ba))::date - (case extract(isodow from (date - make_interval(months => n_ba))::date) when 6 then 1 when 7 then 2 else 0 end)::int
                     else (date - make_interval(months => n_ba))::date end, false, 'Boucle accueil & technique à envoyer (J-' || n_ba || ' mois)' from d where on_ba and mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
    union all select 'boucle_com', id, id || ':' || contract_cosigned_sent, contract_cosigned_sent + n_bo, wa, 'Boucle communication à envoyer' from d where on_bo and mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= (now() at time zone 'Europe/Paris')::date)
  )
  select c.r, c.id, c.k, c.raw, c.w, c.t, s.venue, s.proj, s.date, s.city, s.nxt, s.reactiv from cand c join s on s.id = c.id
   where not s.annule or (s.impaye_ok and c.r in ('acompte_paye', 'solde_paye', 'autre_payee'))
      or (s.envoi_ok and c.r = 'facture_envoi') or (s.so_recalc and c.r = 'solde_envoi')
$function$;

commit;
