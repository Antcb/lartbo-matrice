-- =====================================================================================================
-- v1.56.9 — Rattachement des factures Pennylane faites depuis le devis (demande d'Anthony du 06/11/2026, signalement Monestier).
-- Aucune donnée existante modifiée par cette migration ; aucun document Pennylane modifié, jamais.
--   - pennylane_a_rattacher : factures du devis que la synchronisation n'a PAS reliées seule (plusieurs correspondances possibles,
--     montant d'un acompte noté à la main, acompte caduc, aucune ligne de ce montant) — l'utilisateur choisit la ligne ;
--   - pennylane_rattachements : historique de chaque choix ou correction (qui, quand, motif, avant / après) ; une facture qui y
--     figure n'est plus jamais reliée automatiquement (la correction est préservée aux synchronisations suivantes) ;
--   - pennylane_rattacher(...) : seul chemin d'écriture, réservé à l'équipe, transaction unique, contrôles de doublon.
-- Retour arrière : ne plus appeler la fonction ; les tables peuvent rester (historique).
-- =====================================================================================================
create table if not exists public.pennylane_a_rattacher (
  id uuid primary key default gen_random_uuid(),
  pennylane_id text not null unique,
  show_id uuid references public.shows(id) on delete cascade,
  invoice_number text,
  amount_ht numeric,
  invoice_date date,
  url text,
  reason text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolved_payment_id uuid references public.show_payments(id) on delete set null,
  cancelled_at timestamptz                       -- facture annulée dans Pennylane : plus rattachable
);
create index if not exists pennylane_a_rattacher_show on public.pennylane_a_rattacher (show_id) where resolved_at is null;
-- une facture d'acompte / de solde n'est jamais sur deux lignes (les factures de commission groupées sur plusieurs dates restent possibles)
create unique index if not exists show_payments_pennylane_unique_bill on public.show_payments (pennylane_id)
  where pennylane_id is not null and kind in ('acompte', 'solde');
comment on table public.pennylane_a_rattacher is 'Factures Pennylane du devis non reliées automatiquement : à rattacher à la main (choix de l''utilisateur)';

create table if not exists public.pennylane_rattachements (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  show_id uuid references public.shows(id) on delete set null,
  pennylane_id text not null,
  invoice_number text,
  from_payment_id uuid,
  to_payment_id uuid,
  motif text,
  before jsonb,
  after jsonb
);
create index if not exists pennylane_rattachements_pid on public.pennylane_rattachements (pennylane_id);
comment on table public.pennylane_rattachements is 'Historique des rattachements manuels de factures Pennylane (une facture présente ici n''est plus reliée automatiquement)';

do $$ declare t text; begin
  foreach t in array array['pennylane_a_rattacher', 'pennylane_rattachements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using (public.is_team())', t);   -- lecture seule : écriture par la fonction
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- Protection des factures émises (§7.3, show_payments_emitted_guard) : fonction RÉÉCRITE ENTIÈREMENT ci-dessous (QA B2) — texte de
-- production relevé le 07/11/2026 (empreinte 208e21f521e534840b603225af5e5a06) + une seule exception ajoutée (bloc « v1.56.9 »).
-- Garde : si la fonction en base n'est ni cette version de production ni la nouvelle, la migration s'arrête (rien n'est appliqué).
do $m$
declare n text := pg_get_functiondef('public.show_payments_emitted_guard'::regproc);
begin
  if md5(n) <> '208e21f521e534840b603225af5e5a06' and position('rattachement_pennylane' in n) = 0 then
    raise exception 'v1.56.9 : show_payments_emitted_guard n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(n);
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

/**
 * Rattache (ou rattache autrement) une facture Pennylane du devis à une ligne d'acompte ou de solde de la MÊME date.
 *   p_pennylane_id : facture ; p_payment : ligne choisie ; p_motif : obligatoire pour une correction (facture déjà sur une autre ligne).
 * Contrôles : équipe ; ligne d'acompte / solde de production, de la date de la facture ; ligne cible sans autre facture ;
 * facture jamais sur deux lignes ; ligne payée jamais vidée (à traiter à la main). Le document Pennylane n'est jamais modifié.
 * Ce qui suit la facture d'une ligne à l'autre : n° de facture, lien Pennylane, date de facture, date d'envoi, relance, rangement Drive.
 * Montant : la ligne cible prend le montant de la facture (si elle n'en a pas de saisi) ; la ligne quittée retrouve son calcul
 * automatique si son montant était celui de la facture (figé par la synchronisation).
 */
create or replace function public.pennylane_rattacher(p_pennylane_id text, p_payment uuid, p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me text := coalesce(auth.jwt() ->> 'email', ''); figee boolean := false; has_src boolean; has_pend boolean; tgt record; src record; pend record; sh record; amt numeric; before_j jsonb; after_j jsonb;
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe'; end if;
  if coalesce(btrim(p_pennylane_id), '') = '' or p_payment is null then raise exception 'Facture et ligne à choisir'; end if;
  -- (un enregistrement PL/pgSQL « is null » n'est vrai que si TOUS ses champs sont vides : présence testée par FOUND)
  select * into tgt from show_payments where id = p_payment for update;
  if not found or tgt.kind not in ('acompte', 'solde') or tgt.hors_calcul is not null then raise exception 'Ligne d''acompte ou de solde introuvable'; end if;
  select id, prod_mode, pennylane_quote_id into sh from shows where id = tgt.show_id;
  if sh.prod_mode = 'booking' then raise exception 'Date en booking : les factures d''acompte et de solde sont celles de l''artiste'; end if;
  select * into src from show_payments where pennylane_id = p_pennylane_id and id <> p_payment for update; has_src := found;
  select * into pend from pennylane_a_rattacher where pennylane_id = p_pennylane_id; has_pend := found;
  if not has_src and not has_pend then raise exception 'Facture inconnue : lance d''abord « Synchroniser Pennylane »'; end if;
  if has_pend and pend.cancelled_at is not null then raise exception 'Facture annulée dans Pennylane : elle ne se rattache plus'; end if;
  if coalesce(src.show_id, pend.show_id) is distinct from tgt.show_id then raise exception 'Cette facture appartient à une autre date'; end if;
  if tgt.pennylane_id = p_pennylane_id then raise exception 'La facture est déjà sur cette ligne'; end if;
  -- ligne cible : sans facture Pennylane ; un n° noté à la main n'est accepté que s'il est CELUI de cette facture (Monestier : l'acompte
  -- noté à la main est bien ce document) ; une ligne payée sans n° n'est jamais choisie (paiement d'un autre document ?)
  if tgt.pennylane_id is not null then raise exception 'La ligne choisie a déjà sa facture Pennylane : corrige d''abord cette ligne-là'; end if;
  if nullif(btrim(tgt.invoice_number), '') is not null
     -- même comparaison que la synchronisation (norm : lettres et chiffres seuls, sans casse) : « F2026108 » = « F-2026-108 »
     and upper(regexp_replace(tgt.invoice_number, '[^A-Za-z0-9]', '', 'g')) <> upper(regexp_replace(coalesce(src.invoice_number, pend.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) then
    raise exception 'La ligne choisie porte déjà le n° % (cette facture : %) : ce n''est pas le même document', tgt.invoice_number, coalesce(src.invoice_number, pend.invoice_number, '?');
  end if;
  if tgt.paid_at is not null and nullif(btrim(tgt.invoice_number), '') is null then
    raise exception 'La ligne choisie est payée sans n° de facture : vérifie d''abord quel document a été payé';
  end if;
  if has_src and coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire pour corriger un rattachement'; end if;
  if has_src and src.paid_at is not null then raise exception 'La ligne d''origine est payée : correction à faire à la main avec ta comptabilité'; end if;
  amt := coalesce(src.amount, pend.amount_ht);
  before_j := jsonb_build_object('source', case when has_src then to_jsonb(src) end, 'cible', to_jsonb(tgt));

  if has_src then
    perform set_config('matrice.regularisation', 'rattachement_pennylane', true);   -- exception de la protection, pour cette transaction
    -- montant figé par la synchronisation ? (dernière écriture du montant faite par le serveur, à la valeur actuelle — journal financier)
    select coalesce((select f.actor = 'service_role' and f.new_value ~ '^-?[0-9]+(\.[0-9]+)?$' and f.new_value::numeric = src.amount from finance_log f
      where f.table_name = 'show_payments' and f.row_id::text = src.id::text and f.field = 'amount' order by f.at desc, f.id desc limit 1), false)
      -- ou posé par un rattachement manuel précédent de cette facture (la ligne n'avait pas de montant avant)
      or exists (select 1 from pennylane_rattachements h where h.to_payment_id = src.id and h.pennylane_id = p_pennylane_id
                   and h.before -> 'cible' ->> 'amount' is null and (h.after -> 'cible' ->> 'amount')::numeric = src.amount)
      into figee;
    -- la facture quitte sa ligne : numéro, lien, envoi, relance et rangement la suivent ; la ligne retrouve son calcul automatique
    -- si son montant était celui de la facture (figé par la synchronisation), sinon le montant saisi est gardé
    update show_payments set pennylane_id = null, pennylane_url = null, invoice_number = null, invoiced_on = null, sent_at = null,
      reminded_at = null, drive_file_id = null,
      amount = case when figee then null else amount end
      where id = src.id;
    perform set_config('matrice.regularisation', '', true);
  end if;
  update show_payments set pennylane_id = p_pennylane_id,
      pennylane_url = coalesce(src.pennylane_url, pend.url), invoice_number = coalesce(src.invoice_number, pend.invoice_number),
      invoiced_on = coalesce(src.invoiced_on, pend.invoice_date), sent_at = coalesce(tgt.sent_at, src.sent_at),
      reminded_at = coalesce(tgt.reminded_at, src.reminded_at), drive_file_id = coalesce(tgt.drive_file_id, src.drive_file_id),
      -- montant : celui de la facture si la ligne n'en a pas ET n'est pas encore émise ; une ligne émise garde le sien (§7.3)
      amount = case when tgt.amount is null and tgt.sent_at is null and tgt.paid_at is null and nullif(btrim(tgt.invoice_number), '') is null then amt else tgt.amount end
    where id = tgt.id;
  if (select count(*) from show_payments where pennylane_id = p_pennylane_id) <> 1 then raise exception 'Doublon : la facture serait sur deux lignes'; end if;
  select jsonb_build_object('source', (select to_jsonb(x) from show_payments x where x.id = src.id), 'cible', (select to_jsonb(x) from show_payments x where x.id = tgt.id)) into after_j;
  insert into pennylane_rattachements (actor, show_id, pennylane_id, invoice_number, from_payment_id, to_payment_id, motif, before, after)
    values (nullif(me, ''), tgt.show_id, p_pennylane_id, coalesce(src.invoice_number, pend.invoice_number), src.id, tgt.id, nullif(btrim(p_motif), ''), before_j, after_j);
  update pennylane_a_rattacher set resolved_at = now(), resolved_by = nullif(me, ''), resolved_payment_id = tgt.id where pennylane_id = p_pennylane_id;
  return jsonb_build_object('ok', true, 'from', src.id, 'to', tgt.id, 'invoice_number', coalesce(src.invoice_number, pend.invoice_number));
end $$;
revoke all on function public.pennylane_rattacher(text, uuid, text) from public, anon;
grant execute on function public.pennylane_rattacher(text, uuid, text) to authenticated;
