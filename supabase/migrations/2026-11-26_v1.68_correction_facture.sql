-- v1.68 — point n°23 (décisions d'Anthony du 26/11/2026) : « Déverrouiller pour corriger » une facture émise, dans MATRICE seulement.
-- Une facture émise (envoyée, numérotée, liée à Pennylane ou payée) reste verrouillée par défaut (§6.3–6.4, show_payments_emitted_guard).
-- Une correction explicite, avec motif obligatoire, peut aligner le SUIVI MATRICE sur la facture réellement émise :
--   modifiables : montant HT, % du cachet, TVA de la ligne, type (acompte / solde / autre ligne — la commission et la part partenaire
--                 gardent leur type) ;
--   inchangés   : date du concert (rattachement), n° de facture, date d'envoi, date et statut de paiement, identifiant et lien
--                 Pennylane, destinataire (« arrive sur »), classement hors calcul ;
--   factures payées comprises ; jamais une commission de production (pas une facture : ses règles de versement restent inchangées).
-- Le document Pennylane n'est ni modifié, ni annulé, ni réémis : aucune fonction de cette migration n'appelle Pennylane.
--  1. facture_corrections (table NOUVELLE) : historique de chaque correction (qui, quand, motif, avant / après) ; lecture équipe,
--     écriture par la seule fonction facture_corriger.
--  2. facture_corriger(...) : contrôles, écriture dans une transaction annoncée « correction_facture », historique. Après elle, la
--     ligne est de nouveau verrouillée (rien n'est « ouvert » durablement : aucune colonne d'état de déverrouillage).
--  3. show_payments_emitted_guard : UNE exception ajoutée (bloc « v1.68 »), insérée dans le texte de production relevé le 26/11/2026
--     (empreinte 08302c0ce88a5f10bc6d386c689ee5c8) ; si la fonction en base n'est pas cette version, la migration s'arrête.
-- Aucune donnée existante n'est modifiée.
-- Retour arrière : drop function public.facture_corriger(uuid, numeric, numeric, numeric, text, text) ; réappliquer le
--   show_payments_emitted_guard de la v1.56.9 (supabase/migrations/2026-11-07_v1.56.9_rattachement_pennylane.sql) ; la table
--   facture_corrections est gardée (historique).
-- Rejouable (if not exists / create or replace ; bloc v1.68 inséré une seule fois).
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

-- show_payments_emitted_guard : exception « correction_facture » insérée avant le bloc v1.56.9
do $m$
declare n text := pg_get_functiondef('public.show_payments_emitted_guard'::regproc);
        anchor text := '  -- v1.56.9 : CORRECTION d''un rattachement Pennylane';
        bloc text := $b$  -- v1.68 : CORRECTION D'UNE FACTURE ÉMISE déverrouillée à la main (facture_corriger, transaction annoncée « correction_facture »,
  -- décisions d'Anthony du 26/11/2026) : montant, %, TVA et type (acompte / solde / autre) alignés sur la facture réellement émise ;
  -- rien d'autre ne change (date, n°, envoi, paiement, Pennylane, destinataire, hors calcul). Jamais une commission de production.
  if not self_paid and coalesce(current_setting('matrice.regularisation', true), '') = 'correction_facture'
     and new.amount is not null
     and new.show_id is not distinct from old.show_id and new.sent_at is not distinct from old.sent_at
     and new.paid_at is not distinct from old.paid_at and new.invoice_number is not distinct from old.invoice_number
     and new.pennylane_id is not distinct from old.pennylane_id and new.pennylane_url is not distinct from old.pennylane_url
     and new.payee is not distinct from old.payee and new.hors_calcul is not distinct from old.hors_calcul
     and (new.kind is not distinct from old.kind or (old.kind in ('acompte', 'solde', 'autre') and new.kind in ('acompte', 'solde', 'autre'))) then
    return new;
  end if;
$b$;
begin
  if position('correction_facture' in n) > 0 then return; end if;   -- déjà appliquée
  if md5(n) <> '08302c0ce88a5f10bc6d386c689ee5c8' or position(anchor in n) = 0 then
    raise exception 'v1.68 : show_payments_emitted_guard n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(n);
  end if;
  execute replace(n, anchor, bloc || anchor);
end $m$;

/** Corriger une facture émise dans MATRICE (déverrouillage explicite) : montant HT, %, TVA, type ; motif obligatoire ; historique */
create or replace function public.facture_corriger(p_payment uuid, p_amount numeric, p_pct numeric, p_vat numeric, p_kind text, p_motif text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := coalesce(auth.jwt() ->> 'email', ''); r public.show_payments; a public.show_payments; k text; m text := btrim(coalesce(p_motif, ''));
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
  if r.kind not in ('acompte', 'solde', 'autre', 'artbo', 'partner') then raise exception 'Cette ligne ne se corrige pas ici' using errcode = 'P0001'; end if;
  if not public.payment_is_emitted(r) then raise exception 'Facture pas encore émise : elle se modifie directement dans le tableau' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Montant HT à saisir (0 ou plus)' using errcode = '22023'; end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 100) then raise exception '%% du cachet entre 0 et 100' using errcode = '22023'; end if;
  if p_vat is not null and (p_vat < 0 or p_vat > 100) then raise exception 'TVA entre 0 et 100 %%' using errcode = '22023'; end if;
  k := coalesce(nullif(btrim(p_kind), ''), r.kind);
  if k is distinct from r.kind and (r.kind not in ('acompte', 'solde', 'autre') or k not in ('acompte', 'solde', 'autre')) then
    raise exception 'Type : seuls acompte, solde et autre ligne s''échangent (la commission et la part partenaire gardent leur type)' using errcode = '22023';
  end if;
  if round(p_amount, 2) is not distinct from r.amount and p_pct is not distinct from r.pct and p_vat is not distinct from r.vat_rate and k = r.kind then
    raise exception 'Aucun changement à enregistrer' using errcode = '22023';
  end if;
  perform set_config('matrice.regularisation', 'correction_facture', true);   -- exception de la protection, pour cette transaction
  update public.show_payments set amount = round(p_amount, 2), pct = p_pct, vat_rate = p_vat, kind = k where id = r.id returning * into a;
  perform set_config('matrice.regularisation', '', true);
  insert into public.facture_corrections (actor, payment_id, show_id, invoice_number, motif, before, after)
  values (nullif(me, ''), r.id, r.show_id, r.invoice_number, m,
          jsonb_build_object('amount', r.amount, 'pct', r.pct, 'vat_rate', r.vat_rate, 'kind', r.kind),
          jsonb_build_object('amount', a.amount, 'pct', a.pct, 'vat_rate', a.vat_rate, 'kind', a.kind));
  return jsonb_build_object('ok', true, 'row', to_jsonb(a));
end $$;
revoke all on function public.facture_corriger(uuid, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.facture_corriger(uuid, numeric, numeric, numeric, text, text) to authenticated;

commit;
