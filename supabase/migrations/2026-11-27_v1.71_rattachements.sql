-- v1.71 — L2b du point 02 « Rattachements manuels » (décisions d'Anthony du 27/11/2026, 11 h 55).
--  1. Avoirs et documents négatifs (pennylane_avoirs) : rattachement MANUEL à une ligne, correction, détachement ; classement
--     « Hors MATRICE / sans objet » (motif obligatoire, consultable, corrigeable) ; qualification facultative (« Erreur de
--     facturation »). Toute l'équipe ; motif obligatoire pour une correction ou un détachement ; auteur, date et liens avant / après
--     gardés (rattachements_journal). Une décision manuelle n'est jamais défaite par la synchronisation (rattache_mode = 'manuel').
--  2. Facture RÉÉMISE (option B, Champs des Notes) : la ligne suit la nouvelle facture Pennylane (synchronisation, numéro, lien) ;
--     l'ancienne facture reste visible dans son historique (factures_remplacees) ; les avoirs de l'ancienne facture restent visibles
--     mais ne réduisent plus le net facturé de la ligne (facture_remplacee) ; aucun encaissement créé, effacé ni dupliqué ; même
--     montant HT exigé (sinon : correction de facture, v1.68). Écriture par la fonction serveur « pennylane » (lecture Pennylane) ;
--     détachement par l'équipe (motif obligatoire).
--  3. Virement GROUPÉ réparti à la main (virements_groupes) : chaque affectation est un encaissement de la ligne (reglements) ; un
--     reste non attribué est permis et affiché ; le cumul des affectations ne dépasse JAMAIS le montant TTC du virement, contrôlé par
--     la base à l'enregistrement (déclencheur, verrou sur le virement) — R3.
--  4. avoir_couvert et reglement_couverture : RÉÉCRITES ENTIÈREMENT (gardes d'empreinte) — avoirs d'une facture remplacée exclus.
--  5. Ajustements du 27/11/2026, 16 h 16 : PDF de chaque facture gardé avec elle (réémission) ; identifiant Pennylane du virement
--     obligatoire ; montant d'un virement groupé jamais sous le total attribué ; rattachement manuel contredit par Pennylane :
--     « À vérifier » persistant, gardé jusqu'à correction ou confirmation (avoir_confirmer, motif).
-- Aucune donnée existante n'est modifiée. Aucun appel à Pennylane. Rejouable.
-- Retour arrière : réappliquer avoir_couvert (v1.69) et reglement_couverture (v1.70) ; drop des fonctions et déclencheurs v1.71 ;
-- tables et colonnes gardées (historique).
begin;

-- ─── 1. avoirs : colonnes et états ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.pennylane_avoirs add column if not exists rattache_mode text not null default 'auto';
alter table public.pennylane_avoirs add column if not exists qualification text;
alter table public.pennylane_avoirs add column if not exists classement_motif text;
alter table public.pennylane_avoirs add column if not exists facture_remplacee boolean not null default false;
alter table public.pennylane_avoirs drop constraint if exists pennylane_avoirs_etat_check;
alter table public.pennylane_avoirs add constraint pennylane_avoirs_etat_check check (etat in ('rattache', 'a_rattacher', 'hors_matrice'));
alter table public.pennylane_avoirs drop constraint if exists pennylane_avoirs_mode_check;
alter table public.pennylane_avoirs add constraint pennylane_avoirs_mode_check check (rattache_mode in ('auto', 'manuel'));
alter table public.pennylane_avoirs drop constraint if exists pennylane_avoirs_qualification_check;
alter table public.pennylane_avoirs add constraint pennylane_avoirs_qualification_check check (qualification is null or qualification in ('erreur_facturation'));
alter table public.pennylane_avoirs drop constraint if exists pennylane_avoirs_hors_check;
alter table public.pennylane_avoirs add constraint pennylane_avoirs_hors_check check ((etat = 'hors_matrice') = (nullif(btrim(classement_motif), '') is not null));

-- ─── journal des rattachements (avant / après, auteur, date, motif) ──────────────────────────────────────────────────────────
create table if not exists public.rattachements_journal (
  id bigint generated always as identity primary key,
  objet text not null check (objet in ('avoir', 'reemission', 'virement_groupe')),
  objet_id text not null,
  action text not null,
  avant jsonb,
  apres jsonb,
  motif text,
  auteur text,
  at timestamptz not null default now()
);
create index if not exists rattachements_journal_objet on public.rattachements_journal (objet, objet_id);
comment on table public.rattachements_journal is 'v1.71 (L2b) : historique des rattachements manuels (avoirs, réémissions, virements groupés) : avant / après, motif, auteur';
alter table public.rattachements_journal enable row level security;
drop policy if exists team_read on public.rattachements_journal;
create policy team_read on public.rattachements_journal for select to authenticated using (public.is_team());
revoke all on public.rattachements_journal from anon;
revoke insert, update, delete on public.rattachements_journal from authenticated;

-- ─── 2. factures remplacées par une réémission ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.factures_remplacees (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.show_payments(id) on delete restrict,
  show_id uuid not null references public.shows(id) on delete restrict,
  pennylane_id text not null,                 -- facture d'origine (remplacée)
  invoice_number text,
  pennylane_url text,
  drive_file_id text,                         -- PDF de la facture d'origine dans le Drive (gardé avec elle, jamais effacé)
  remplacee_par_pennylane_id text not null,   -- facture réémise que la ligne suit maintenant
  remplacee_par_numero text,
  reemise_drive_file_id text,                 -- PDF de la facture réémise, gardé ici si la réémission est détachée (pas de copie au retour)
  motif text,
  created_at timestamptz not null default now(),
  created_by text,
  detache_at timestamptz, detache_par text, detache_motif text,
  constraint factures_remplacees_detache check ((detache_at is null) = (detache_motif is null))
);
create unique index if not exists factures_remplacees_active on public.factures_remplacees (pennylane_id) where detache_at is null;
create index if not exists factures_remplacees_payment on public.factures_remplacees (payment_id);
comment on table public.factures_remplacees is 'v1.71 (L2b) : facture d''origine remplacée par une facture réémise (la ligne suit la réémission) ; gardée visible';
alter table public.factures_remplacees enable row level security;
drop policy if exists team_read on public.factures_remplacees;
create policy team_read on public.factures_remplacees for select to authenticated using (public.is_team());
revoke all on public.factures_remplacees from anon;
revoke insert, update, delete on public.factures_remplacees from authenticated;

-- ─── 3. virements groupés ────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.virements_groupes (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,        -- virement Pennylane (obligatoire, décision du 27/11/2026, 16 h 16) : jamais compté par la synchronisation
  montant_ttc numeric(12,2) not null check (montant_ttc > 0 and montant_ttc < 100000000),
  date date not null,
  reference text,
  created_at timestamptz not null default now(),
  created_by text
);
comment on table public.virements_groupes is 'v1.71 (L2b) : virement couvrant plusieurs factures, réparti à la main (reglements.virement_groupe_id) ; cumul jamais au-delà du montant (R3)';
alter table public.virements_groupes enable row level security;
drop policy if exists team_read on public.virements_groupes;
create policy team_read on public.virements_groupes for select to authenticated using (public.is_team());
revoke all on public.virements_groupes from anon;
revoke insert, update, delete on public.virements_groupes from authenticated;

alter table public.reglements add column if not exists virement_groupe_id uuid references public.virements_groupes(id) on delete restrict;
create index if not exists reglements_virement_groupe on public.reglements (virement_groupe_id);
alter table public.reglements drop constraint if exists reglements_virement_groupe;
alter table public.reglements add constraint reglements_virement_groupe check (virement_groupe_id is null
  or (sens = 'encaissement' and etat = 'fait' and source = 'manuel' and transaction_id is null));

do $$ declare t text; begin
  foreach t in array array['rattachements_journal', 'factures_remplacees', 'virements_groupes'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- plafond (R3, décision du 27/11/2026) : cumul des affectations actives d'un virement groupé ≤ son montant TTC, contrôlé à chaque
-- enregistrement ; le virement est verrouillé pendant le contrôle (deux enregistrements simultanés ne peuvent pas le dépasser)
create or replace function public.reglements_virement_plafond() returns trigger
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare v public.virements_groupes; deja numeric;
begin
  if new.virement_groupe_id is null or new.annule_at is not null then return new; end if;
  select * into v from public.virements_groupes where id = new.virement_groupe_id for update;
  if not found then raise exception 'Virement groupé introuvable'; end if;
  select coalesce(sum(montant_ttc), 0) into deja from public.reglements
   where virement_groupe_id = v.id and annule_at is null and id <> new.id;
  if deja + new.montant_ttc > v.montant_ttc + 0.005 then
    raise exception 'Virement groupé de % € TTC : % € TTC déjà attribués, reste % € TTC — affectation refusée (le cumul ne dépasse jamais le virement)',
      replace(to_char(v.montant_ttc, 'FM999999990.00'), '.', ','), replace(to_char(deja, 'FM999999990.00'), '.', ','),
      replace(to_char(greatest(v.montant_ttc - deja, 0), 'FM999999990.00'), '.', ',') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.reglements_virement_plafond() from public, anon, authenticated;
drop trigger if exists reglements_virement_plafond on public.reglements;
create trigger reglements_virement_plafond before insert or update on public.reglements
  for each row execute function public.reglements_virement_plafond();

-- (décision du 27/11/2026, 16 h 16) le montant d'un virement groupé ne descend jamais sous le total déjà attribué
create or replace function public.virements_groupes_plancher() returns trigger
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare deja numeric;
begin
  if new.montant_ttc is not distinct from old.montant_ttc then return new; end if;
  select coalesce(sum(montant_ttc), 0) into deja from public.reglements where virement_groupe_id = old.id and annule_at is null;
  if new.montant_ttc < deja - 0.005 then
    raise exception 'Virement groupé : montant % € TTC inférieur au total déjà attribué (% € TTC) — refusé',
      replace(to_char(new.montant_ttc, 'FM999999990.00'), '.', ','), replace(to_char(deja, 'FM999999990.00'), '.', ',') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.virements_groupes_plancher() from public, anon, authenticated;
drop trigger if exists virements_groupes_plancher on public.virements_groupes;
create trigger virements_groupes_plancher before update on public.virements_groupes for each row execute function public.virements_groupes_plancher();

-- ─── 4. calculs : avoirs d'une facture remplacée exclus ──────────────────────────────────────────────────────────────────────
do $m$
declare a text := pg_get_functiondef('public.avoir_couvert(uuid)'::regprocedure);
        c text := pg_get_functiondef('public.reglement_couverture(public.show_payments)'::regprocedure);
begin
  if md5(a) <> '9e8a85420d1f0f2aedaa0620084501ad' and position('v1.71 (L2b)' in a) = 0 then
    raise exception 'v1.71 : avoir_couvert n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(a);
  end if;
  if md5(c) <> '7fe386450579a6b8ddb091f43aaee66a' and position('v1.71 (L2b)' in c) = 0 then
    raise exception 'v1.71 : reglement_couverture n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(c);
  end if;
end $m$;
-- montant HT couvert par les avoirs rattachés (non disparus) d'une ligne — même règle : js/calc.js avoirCouvert
-- v1.71 (L2b) : avoirs d'une facture remplacée par une réémission exclus (ils annulent l'ancienne facture, pas celle que la ligne suit)
create or replace function public.avoir_couvert(p_payment uuid) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$
  -- v1.71 (L2b) : avoirs d'une facture remplacée exclus
  select coalesce(sum(a.amount_ht), 0) from public.pennylane_avoirs a
   where a.payment_id = p_payment and a.etat = 'rattache' and a.gone_at is null and not a.facture_remplacee
$$;
revoke all on function public.avoir_couvert(uuid) from public, anon, authenticated;

-- couverture d'une ligne par ses mouvements enregistrés (TTC) : net facturé (TTC facture − TTC avoirs rattachés), encaissé net
-- (encaissements − remboursements faits, non annulés), date du dernier encaissement. Même calcul : js/calc.js factureNetTtc / encaisseTtc
-- v1.71 (L2b) : avoirs d'une facture remplacée par une réémission exclus
create or replace function public.reglement_couverture(p public.show_payments, out net numeric, out enc numeric, out dernier date, out nb int)
 language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare vat numeric := coalesce(p.vat_rate, case when p.kind in ('artbo', 'partner') then 20 end, (select s.vat_rate from public.shows s where s.id = p.show_id), 5.5);
begin
  -- v1.71 (L2b) : avoirs d'une facture remplacée exclus
  net := greatest(0, round(coalesce(p.amount, public.payment_amount_now(p), 0) * (1 + vat / 100), 2)
    - coalesce((select sum(coalesce(a.amount_ttc, round(a.amount_ht * (1 + vat / 100), 2))) from public.pennylane_avoirs a
                 where a.payment_id = p.id and a.etat = 'rattache' and a.gone_at is null and not a.facture_remplacee), 0));
  select coalesce(sum(case when x.sens = 'encaissement' then x.montant_ttc else -x.montant_ttc end), 0),
         max(x.date) filter (where x.sens = 'encaissement'), count(*) filter (where x.sens = 'encaissement')
    into enc, dernier, nb from public.reglements x where x.payment_id = p.id and x.etat = 'fait' and x.annule_at is null;
end $$;
revoke all on function public.reglement_couverture(public.show_payments) from public, anon, authenticated;

-- ligne qui peut recevoir un document (avoir, réémission) ou une affectation : facture émise suivie, pas hors calcul — même règle que
-- reglement_saisir (production : acompte, solde, autre ligne ; booking : facture de commission)
create or replace function public.ligne_suivie(p public.show_payments) returns boolean
 language sql stable security definer set search_path = public, pg_temp
as $$
  select p.hors_calcul is null and public.payment_is_emitted(p) and exists (select 1 from public.shows s where s.id = p.show_id
    and ((coalesce(s.prod_mode, 'production') <> 'booking' and p.kind in ('acompte', 'solde', 'autre')) or (s.prod_mode = 'booking' and p.kind = 'artbo')))
$$;
revoke all on function public.ligne_suivie(public.show_payments) from public, anon, authenticated;

-- ─── 1. avoirs : rattacher / corriger, détacher, classer hors MATRICE, qualifier (équipe) ────────────────────────────────────
create or replace function public.avoir_rattacher(p_avoir uuid, p_payment uuid, p_motif text default null) returns public.pennylane_avoirs
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.pennylane_avoirs; n public.pennylane_avoirs; p public.show_payments; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if length(m) > 500 then raise exception 'Motif : 500 caractères au plus'; end if;
  select * into a from public.pennylane_avoirs where id = p_avoir for update;
  if not found then raise exception 'Document introuvable'; end if;
  if a.gone_at is not null then raise exception 'Document disparu de Pennylane : il ne se rattache plus'; end if;
  select * into p from public.show_payments where id = p_payment;
  if not found then raise exception 'Ligne de facturation introuvable'; end if;
  if not public.ligne_suivie(p) then raise exception 'Cette ligne ne reçoit pas de document (facture émise suivie, pas hors calcul)'; end if;
  if a.etat = 'rattache' and a.payment_id = p.id then raise exception 'Document déjà rattaché à cette ligne'; end if;
  -- correction (déjà rattaché ou classé) : motif obligatoire
  if a.etat <> 'a_rattacher' and m is null then raise exception 'Motif obligatoire pour corriger un rattachement ou un classement'; end if;
  -- un remboursement enregistré sur ce document : jamais déplacé avec lui (ni effacé, ni dupliqué)
  if exists (select 1 from public.reglements r where r.avoir_id = a.id and r.annule_at is null) then
    raise exception 'Un remboursement est enregistré sur ce document : rattachement inchangé (annule d''abord le remboursement)'; end if;
  update public.pennylane_avoirs set etat = 'rattache', payment_id = p.id, show_id = p.show_id, reason = null, classement_motif = null,
    rattache_mode = 'manuel', rattache_origine = a.credited_pennylane_id,
    facture_remplacee = a.credited_pennylane_id is not null and a.credited_pennylane_id is distinct from p.pennylane_id
      and exists (select 1 from public.factures_remplacees f where f.payment_id = p.id and f.pennylane_id = a.credited_pennylane_id and f.detache_at is null)
   where id = a.id returning * into n;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('avoir', a.id::text, case when a.etat = 'a_rattacher' then 'rattacher' else 'corriger' end,
          jsonb_build_object('etat', a.etat, 'payment_id', a.payment_id, 'show_id', a.show_id, 'classement_motif', a.classement_motif),
          jsonb_build_object('etat', n.etat, 'payment_id', n.payment_id, 'show_id', n.show_id), m, auth.jwt() ->> 'email');
  return n;
end $$;

-- (décision du 27/11/2026, 16 h 16) rattachement manuel contredit par la facture d'origine que Pennylane indique ensuite : signal
-- « À vérifier » persistant, rattachement gardé ; résolu en corrigeant (avoir_rattacher) ou en CONFIRMANT le rattachement (motif)
create or replace function public.avoir_confirmer(p_avoir uuid, p_motif text) returns public.pennylane_avoirs
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.pennylane_avoirs; n public.pennylane_avoirs; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 500 then raise exception 'Motif obligatoire (500 caractères au plus)'; end if;
  select * into a from public.pennylane_avoirs where id = p_avoir for update;
  if not found then raise exception 'Document introuvable'; end if;
  if a.etat <> 'rattache' then raise exception 'Document non rattaché : rien à confirmer'; end if;
  if a.rattache_origine is not distinct from a.credited_pennylane_id then raise exception 'Aucun écart à confirmer'; end if;
  update public.pennylane_avoirs set rattache_origine = a.credited_pennylane_id, rattache_mode = 'manuel' where id = a.id returning * into n;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('avoir', a.id::text, 'confirmer', jsonb_build_object('payment_id', a.payment_id, 'rattache_origine', a.rattache_origine),
          jsonb_build_object('payment_id', n.payment_id, 'origine_pennylane', a.credited_pennylane_id), m, auth.jwt() ->> 'email');
  return n;
end $$;

create or replace function public.avoir_detacher(p_avoir uuid, p_motif text) returns public.pennylane_avoirs
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.pennylane_avoirs; n public.pennylane_avoirs; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 500 then raise exception 'Motif obligatoire (500 caractères au plus)'; end if;
  select * into a from public.pennylane_avoirs where id = p_avoir for update;
  if not found then raise exception 'Document introuvable'; end if;
  if a.etat = 'a_rattacher' then raise exception 'Document déjà « à rattacher »'; end if;
  if exists (select 1 from public.reglements r where r.avoir_id = a.id and r.annule_at is null) then
    raise exception 'Un remboursement est enregistré sur ce document : rattachement inchangé (annule d''abord le remboursement)'; end if;
  -- décision manuelle : la synchronisation ne le rattache plus de lui-même
  update public.pennylane_avoirs set etat = 'a_rattacher', payment_id = null, show_id = null, classement_motif = null, rattache_origine = null,
    facture_remplacee = false, rattache_mode = 'manuel', reason = 'Détaché à la main : ' || m
   where id = a.id returning * into n;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('avoir', a.id::text, 'detacher', jsonb_build_object('etat', a.etat, 'payment_id', a.payment_id, 'show_id', a.show_id, 'classement_motif', a.classement_motif),
          jsonb_build_object('etat', n.etat), m, auth.jwt() ->> 'email');
  return n;
end $$;

create or replace function public.avoir_classer_hors(p_avoir uuid, p_motif text) returns public.pennylane_avoirs
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.pennylane_avoirs; n public.pennylane_avoirs; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 500 then raise exception 'Motif obligatoire (500 caractères au plus)'; end if;
  select * into a from public.pennylane_avoirs where id = p_avoir for update;
  if not found then raise exception 'Document introuvable'; end if;
  if a.etat = 'hors_matrice' then raise exception 'Document déjà classé « Hors MATRICE »'; end if;
  if exists (select 1 from public.reglements r where r.avoir_id = a.id and r.annule_at is null) then
    raise exception 'Un remboursement est enregistré sur ce document : classement refusé (annule d''abord le remboursement)'; end if;
  update public.pennylane_avoirs set etat = 'hors_matrice', payment_id = null, show_id = null, classement_motif = m, rattache_origine = null,
    facture_remplacee = false, rattache_mode = 'manuel', reason = null
   where id = a.id returning * into n;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('avoir', a.id::text, 'classer_hors_matrice', jsonb_build_object('etat', a.etat, 'payment_id', a.payment_id, 'show_id', a.show_id),
          jsonb_build_object('etat', n.etat), m, auth.jwt() ->> 'email');
  return n;
end $$;

create or replace function public.avoir_qualifier(p_avoir uuid, p_qualification text) returns public.pennylane_avoirs
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.pennylane_avoirs; n public.pennylane_avoirs; q text := nullif(btrim(p_qualification), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if q is not null and q not in ('erreur_facturation') then raise exception 'Qualification inconnue'; end if;
  select * into a from public.pennylane_avoirs where id = p_avoir for update;
  if not found then raise exception 'Document introuvable'; end if;
  if a.qualification is not distinct from q then return a; end if;
  update public.pennylane_avoirs set qualification = q where id = a.id returning * into n;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, auteur)
  values ('avoir', a.id::text, 'qualifier', jsonb_build_object('qualification', a.qualification), jsonb_build_object('qualification', q), auth.jwt() ->> 'email');
  return n;
end $$;

-- ─── 2. réémission (option B) ────────────────────────────────────────────────────────────────────────────────────────────────
-- appelée par la fonction serveur « pennylane » (rôle de service) APRÈS lecture de la facture réémise dans Pennylane : jamais par
-- l'application (sinon des données Pennylane pourraient être forgées)
create or replace function public.facture_reemise_enregistrer(p_payment uuid, p_pennylane_id text, p_invoice_number text, p_url text,
  p_amount_ht numeric, p_motif text, p_auteur text) returns public.factures_remplacees
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare p public.show_payments; f public.factures_remplacees; montant numeric; m text := nullif(btrim(p_motif), '');
begin
  if nullif(btrim(p_pennylane_id), '') is null or nullif(btrim(p_invoice_number), '') is null then raise exception 'Facture réémise : identifiant et numéro Pennylane requis'; end if;
  if length(m) > 500 then raise exception 'Motif : 500 caractères au plus'; end if;
  select * into p from public.show_payments where id = p_payment for update;
  if not found then raise exception 'Ligne de facturation introuvable'; end if;
  if not public.ligne_suivie(p) then raise exception 'Cette ligne ne suit pas de facture (facture émise suivie, pas hors calcul)'; end if;
  if nullif(btrim(p.pennylane_id), '') is null then raise exception 'La ligne n''est liée à aucune facture Pennylane : rattache-la d''abord'; end if;
  if p.pennylane_id = p_pennylane_id then raise exception 'La ligne suit déjà cette facture'; end if;
  if exists (select 1 from public.show_payments x where x.pennylane_id = p_pennylane_id or upper(btrim(x.invoice_number)) = upper(btrim(p_invoice_number))) then
    raise exception 'Cette facture Pennylane est déjà liée à une ligne de MATRICE'; end if;
  if exists (select 1 from public.factures_remplacees x where x.pennylane_id = p_pennylane_id and x.detache_at is null) then
    raise exception 'Cette facture est déjà une facture remplacée'; end if;
  montant := coalesce(p.amount, public.payment_amount_now(p));
  if p_amount_ht is null or montant is null or abs(p_amount_ht - montant) > 0.01 then
    raise exception 'Montant HT différent de la ligne (% € contre % €) : ce n''est pas une simple réémission — utilise la correction de facture',
      coalesce(p_amount_ht::text, '?'), coalesce(montant::text, '?'); end if;
  insert into public.factures_remplacees (payment_id, show_id, pennylane_id, invoice_number, pennylane_url, drive_file_id, remplacee_par_pennylane_id, remplacee_par_numero, motif, created_by)
  values (p.id, p.show_id, p.pennylane_id, p.invoice_number, p.pennylane_url, p.drive_file_id, p_pennylane_id, btrim(p_invoice_number), m, p_auteur) returning * into f;
  -- la ligne suit la facture réémise (option B) : numéro, identifiant, lien ; montant, dates d'envoi et de paiement inchangés.
  -- PDF (décision d'Anthony du 27/11/2026, 16 h 16) : celui de l'ancienne facture reste avec elle (factures_remplacees.drive_file_id) ;
  -- la ligne reprend le PDF déjà rangé de CETTE réémission s'il existe (réémission détachée puis rattachée : pas de copie), sinon la
  -- synchronisation range le nouveau PDF à côté de l'ancien (l'ancien n'est jamais déplacé ni écrasé)
  update public.show_payments set pennylane_id = p_pennylane_id, invoice_number = btrim(p_invoice_number), pennylane_url = nullif(btrim(p_url), ''),
    drive_file_id = (select x.reemise_drive_file_id from public.factures_remplacees x where x.payment_id = p.id and x.remplacee_par_pennylane_id = p_pennylane_id
                      and x.reemise_drive_file_id is not null order by x.detache_at desc nulls last limit 1)
   where id = p.id;
  -- avoirs de la facture remplacée : restent visibles, ne réduisent plus le net facturé de la ligne
  update public.pennylane_avoirs set facture_remplacee = true where payment_id = p.id and credited_pennylane_id = f.pennylane_id;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('reemission', f.id::text, 'rattacher', jsonb_build_object('payment_id', p.id, 'pennylane_id', p.pennylane_id, 'invoice_number', p.invoice_number),
          jsonb_build_object('payment_id', p.id, 'pennylane_id', p_pennylane_id, 'invoice_number', btrim(p_invoice_number)), m, p_auteur);
  return f;
end $$;
revoke all on function public.facture_reemise_enregistrer(uuid, text, text, text, numeric, text, text) from public, anon, authenticated;

create or replace function public.facture_reemise_detacher(p_id uuid, p_motif text) returns public.factures_remplacees
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare f public.factures_remplacees; p public.show_payments; m text := nullif(btrim(p_motif), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if m is null or length(m) > 500 then raise exception 'Motif obligatoire (500 caractères au plus)'; end if;
  select * into f from public.factures_remplacees where id = p_id and detache_at is null for update;
  if not found then raise exception 'Réémission introuvable ou déjà détachée'; end if;
  select * into p from public.show_payments where id = f.payment_id for update;
  if p.pennylane_id is distinct from f.remplacee_par_pennylane_id then raise exception 'La ligne ne suit plus cette facture réémise : rien à détacher'; end if;
  if exists (select 1 from public.show_payments x where x.id <> p.id and (x.pennylane_id = f.pennylane_id or upper(btrim(x.invoice_number)) = upper(btrim(f.invoice_number)))) then
    raise exception 'La facture d''origine est liée à une autre ligne : détachement refusé'; end if;
  update public.factures_remplacees set detache_at = now(), detache_par = auth.jwt() ->> 'email', detache_motif = m, reemise_drive_file_id = p.drive_file_id
   where id = f.id returning * into f;
  -- chaque PDF reste avec sa facture : la ligne reprend celui de la facture d'origine ; celui de la réémission est gardé sur f
  update public.show_payments set pennylane_id = f.pennylane_id, invoice_number = f.invoice_number, pennylane_url = f.pennylane_url, drive_file_id = f.drive_file_id where id = p.id;
  update public.pennylane_avoirs set facture_remplacee = false where payment_id = p.id and credited_pennylane_id = f.pennylane_id;
  insert into public.rattachements_journal (objet, objet_id, action, avant, apres, motif, auteur)
  values ('reemission', f.id::text, 'detacher', jsonb_build_object('payment_id', p.id, 'pennylane_id', p.pennylane_id, 'invoice_number', p.invoice_number),
          jsonb_build_object('payment_id', p.id, 'pennylane_id', f.pennylane_id, 'invoice_number', f.invoice_number), m, auth.jwt() ->> 'email');
  return f;
end $$;

-- ─── 3. virements groupés : créer, affecter (équipe) ─────────────────────────────────────────────────────────────────────────
create or replace function public.virement_groupe_creer(p_montant numeric, p_date date, p_reference text, p_transaction_id text) returns public.virements_groupes
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare v public.virements_groupes; t text := nullif(btrim(p_transaction_id), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if p_montant is null or p_montant = 'NaN'::numeric or p_montant <= 0 or p_montant >= 100000000 then raise exception 'Montant TTC du virement à saisir (positif)'; end if;
  if p_date is null then raise exception 'Date du virement à saisir'; end if;
  -- (décision d'Anthony du 27/11/2026, 16 h 16) identifiant Pennylane du virement exigé avant toute répartition : la synchronisation
  -- ne peut alors jamais enregistrer de nouveau le virement entier pour une ligne
  if t is null or t !~ '^[0-9]{1,20}$' then raise exception 'Identifiant Pennylane du virement à saisir (chiffres seulement, tel qu''indiqué par la synchronisation)'; end if;
  if t is not null and (exists (select 1 from public.pennylane_virements x where x.transaction_id = t)
     or exists (select 1 from public.reglements x where x.transaction_id = t)) then
    raise exception 'Ce virement Pennylane est déjà compté pour une ligne : il ne se répartit pas une seconde fois'; end if;
  if t is not null and exists (select 1 from public.virements_groupes x where x.transaction_id = t) then raise exception 'Ce virement Pennylane est déjà un virement groupé'; end if;
  insert into public.virements_groupes (transaction_id, montant_ttc, date, reference, created_by)
  values (t, round(p_montant, 2), p_date, nullif(btrim(p_reference), ''), auth.jwt() ->> 'email') returning * into v;
  insert into public.rattachements_journal (objet, objet_id, action, apres, auteur)
  values ('virement_groupe', v.id::text, 'creer', to_jsonb(v), auth.jwt() ->> 'email');
  return v;
end $$;

-- affectation = encaissement de la ligne (mêmes contrôles que reglement_saisir), daté du virement, lié au virement groupé ; le
-- plafond est contrôlé par le déclencheur dans la même opération (refus → rien n'est enregistré)
create or replace function public.virement_groupe_affecter(p_virement uuid, p_payment uuid, p_montant numeric, p_compte text default null) returns public.reglements
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare v public.virements_groupes; r public.reglements;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  select * into v from public.virements_groupes where id = p_virement;
  if not found then raise exception 'Virement groupé introuvable'; end if;
  r := public.reglement_saisir(p_payment, 'encaissement', 'fait', p_montant, v.date, p_compte,
         coalesce(v.reference, 'Virement groupé du ' || to_char(v.date, 'DD/MM/YYYY')), null);
  update public.reglements set virement_groupe_id = v.id where id = r.id returning * into r;
  insert into public.rattachements_journal (objet, objet_id, action, apres, auteur)
  values ('virement_groupe', v.id::text, 'affecter', jsonb_build_object('reglement_id', r.id, 'payment_id', r.payment_id, 'montant_ttc', r.montant_ttc), auth.jwt() ->> 'email');
  return r;
end $$;

-- droits : équipe (contrôle is_team dans chaque fonction), jamais anonyme
do $$ declare f text; begin
  foreach f in array array['public.avoir_rattacher(uuid, uuid, text)', 'public.avoir_confirmer(uuid, text)', 'public.avoir_detacher(uuid, text)', 'public.avoir_classer_hors(uuid, text)',
    'public.avoir_qualifier(uuid, text)', 'public.facture_reemise_detacher(uuid, text)', 'public.virement_groupe_creer(numeric, date, text, text)',
    'public.virement_groupe_affecter(uuid, uuid, numeric, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
