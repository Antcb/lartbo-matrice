-- v1.68 — point n°23 (décisions d'Anthony du 26/11/2026) : « Déverrouiller pour corriger » une facture émise, dans MATRICE seulement.
-- Une facture émise (envoyée, numérotée, liée à Pennylane ou payée) reste verrouillée par défaut (§6.3–6.4, show_payments_emitted_guard).
-- Une correction explicite, avec motif obligatoire, peut aligner le SUIVI MATRICE sur la facture réellement émise :
--   modifiables : montant HT, % du cachet, TVA de la ligne ;
--   inchangés   : TYPE de la ligne (décision du 26/11/2026 après essai : un solde émis reclassé faisait recréer un second solde et
--                 son rappel), date du concert (rattachement), n° de facture, date d'envoi, date et statut de paiement, identifiant et lien
--                 Pennylane, destinataire (« arrive sur »), classement hors calcul ;
--   factures payées comprises ; jamais une commission de production (pas une facture : ses règles de versement restent inchangées).
-- Le document Pennylane n'est ni modifié, ni annulé, ni réémis : aucune fonction de cette migration n'appelle Pennylane.
--  1. facture_corrections (table NOUVELLE) : historique de chaque correction (qui, quand, motif, avant / après) ; lecture équipe,
--     écriture par la seule fonction facture_corriger.
--  2. facture_corriger(...) : contrôles, écriture dans une transaction annoncée « correction_facture », historique. Après elle, la
--     ligne est de nouveau verrouillée (rien n'est « ouvert » durablement : aucune colonne d'état de déverrouillage).
--  3. show_payments_emitted_guard : réécrite entièrement = texte de production relevé le 26/11/2026 (empreinte
--     08302c0ce88a5f10bc6d386c689ee5c8) + UNE exception (bloc « v1.68 ») ; si la fonction en base n'est pas cette version, la migration s'arrête.
-- Aucune donnée existante n'est modifiée.
-- Retour arrière : drop function public.facture_corriger(uuid, numeric, numeric, numeric, text) ; réappliquer le
--   show_payments_emitted_guard de la v1.56.9 (supabase/migrations/2026-11-07_v1.56.9_rattachement_pennylane.sql) ; la table
--   facture_corrections est gardée (historique).
-- Rejouable (if not exists / create or replace).
begin;

create table if not exists public.facture_corrections (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  payment_id uuid not null,
  show_id uuid references public.shows(id) on delete set null,
  invoice_number text,
  motif text not null,
  before jsonb not null,
  after jsonb not null
);
create index if not exists facture_corrections_payment on public.facture_corrections (payment_id);
comment on table public.facture_corrections is 'v1.68 : corrections de factures émises dans MATRICE (déverrouillage explicite, motif) ; la facture Pennylane n''est jamais touchée';
alter table public.facture_corrections enable row level security;
drop policy if exists team_read on public.facture_corrections;
create policy team_read on public.facture_corrections for select to authenticated using (public.is_team());   -- écriture : facture_corriger
revoke all on public.facture_corrections from anon;
revoke insert, update, delete on public.facture_corrections from authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'facture_corrections') then
    alter publication supabase_realtime add table public.facture_corrections;
  end if;
end $$;

-- show_payments_emitted_guard : fonction RÉÉCRITE ENTIÈREMENT (CONVENTIONS §7.5) — texte de production relevé le 26/11/2026
-- (empreinte 08302c0ce88a5f10bc6d386c689ee5c8, identique à la version v1.56.9) + une seule exception ajoutée (bloc « v1.68 »).
-- Garde : si la fonction en base n'est ni cette version de production ni la nouvelle, la migration s'arrête (rien n'est appliqué).
do $m$
declare n text := pg_get_functiondef('public.show_payments_emitted_guard'::regproc);
begin
  if md5(n) <> '08302c0ce88a5f10bc6d386c689ee5c8' and position('v1.68 : CORRECTION D''UNE FACTURE ÉMISE' in n) = 0 then
    raise exception 'v1.68 : show_payments_emitted_guard n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(n);
  end if;
end $m$;
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
  -- v1.68 : CORRECTION D'UNE FACTURE ÉMISE déverrouillée à la main (facture_corriger, transaction annoncée « correction_facture »,
  -- décisions d'Anthony du 26/11/2026) : montant, % et TVA alignés sur la facture réellement émise ; rien d'autre ne change (type,
  -- date, n°, envoi, paiement, Pennylane, destinataire, hors calcul). Jamais une commission de production.
  if not self_paid and coalesce(current_setting('matrice.regularisation', true), '') = 'correction_facture'
     and new.amount is not null
     and new.show_id is not distinct from old.show_id and new.sent_at is not distinct from old.sent_at
     and new.paid_at is not distinct from old.paid_at and new.invoice_number is not distinct from old.invoice_number
     and new.pennylane_id is not distinct from old.pennylane_id and new.pennylane_url is not distinct from old.pennylane_url
     and new.payee is not distinct from old.payee and new.hors_calcul is not distinct from old.hors_calcul
     and new.kind is not distinct from old.kind then
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

/** Corriger une facture émise dans MATRICE (déverrouillage explicite) : montant HT, %, TVA (type figé) ; motif obligatoire ; historique */
drop function if exists public.facture_corriger(uuid, numeric, numeric, numeric, text, text);   -- première version (jamais appliquée en production)
create or replace function public.facture_corriger(p_payment uuid, p_amount numeric, p_pct numeric, p_vat numeric, p_motif text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me text := coalesce(auth.jwt() ->> 'email', ''); r public.show_payments; a public.show_payments;
        m text := btrim(coalesce(p_motif, ''), E' \t\r\n');   -- espaces, tabulations et retours à la ligne
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe' using errcode = '42501'; end if;
  if m = '' then raise exception 'Motif obligatoire pour corriger une facture émise' using errcode = '22023'; end if;
  if length(m) > 500 then raise exception 'Motif trop long (500 caractères au plus)' using errcode = '22023'; end if;
  select * into r from public.show_payments where id = p_payment for update;
  if not found then raise exception 'Ligne de facturation introuvable' using errcode = 'P0001'; end if;
  if r.hors_calcul is not null then raise exception 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se corrige pas' using errcode = 'P0001'; end if;
  if r.kind = 'artbo' and exists (select 1 from public.shows s where s.id = r.show_id and coalesce(s.prod_mode, 'production') <> 'booking') then
    raise exception 'Commission de production : ce n''est pas une facture, ses règles de versement restent inchangées' using errcode = 'P0001';
  end if;
  if r.kind in ('acompte', 'solde', 'autre') and exists (select 1 from public.shows s where s.id = r.show_id and s.prod_mode = 'booking') then
    raise exception 'Date en booking : les factures d''acompte et de solde sont celles de l''artiste, elles ne se corrigent pas ici' using errcode = 'P0001';
  end if;
  if r.kind not in ('acompte', 'solde', 'autre', 'artbo', 'partner') then raise exception 'Cette ligne ne se corrige pas ici' using errcode = 'P0001'; end if;
  if not public.payment_is_emitted(r) then raise exception 'Facture pas encore émise : elle se modifie directement dans le tableau' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount < 0 or p_amount = 'NaN'::numeric or p_amount >= 100000000 then
    raise exception 'Montant HT à saisir (0 ou plus, moins de 100 millions)' using errcode = '22023'; end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 100 or p_pct = 'NaN'::numeric) then raise exception '%% du cachet entre 0 et 100' using errcode = '22023'; end if;
  if p_vat is not null and (p_vat < 0 or p_vat > 100 or p_vat = 'NaN'::numeric) then raise exception 'TVA entre 0 et 100 %%' using errcode = '22023'; end if;
  if round(p_amount, 2) is not distinct from r.amount and p_pct is not distinct from r.pct and p_vat is not distinct from r.vat_rate then
    raise exception 'Aucun changement à enregistrer' using errcode = '22023';
  end if;
  perform set_config('matrice.regularisation', 'correction_facture', true);   -- exception de la protection, pour cette transaction
  update public.show_payments set amount = round(p_amount, 2), pct = p_pct, vat_rate = p_vat where id = r.id returning * into a;
  perform set_config('matrice.regularisation', '', true);
  insert into public.facture_corrections (actor, payment_id, show_id, invoice_number, motif, before, after)
  values (nullif(me, ''), r.id, r.show_id, r.invoice_number, m,
          jsonb_build_object('amount', r.amount, 'pct', r.pct, 'vat_rate', r.vat_rate),
          jsonb_build_object('amount', a.amount, 'pct', a.pct, 'vat_rate', a.vat_rate));
  return jsonb_build_object('ok', true, 'row', to_jsonb(a));
end $$;
revoke all on function public.facture_corriger(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.facture_corriger(uuid, numeric, numeric, numeric, text) to authenticated;

commit;
