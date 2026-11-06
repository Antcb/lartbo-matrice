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
  resolved_payment_id uuid references public.show_payments(id) on delete set null
);
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
returns jsonb language plpgsql security definer set search_path = public as $$
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
  if coalesce(src.show_id, pend.show_id) is distinct from tgt.show_id then raise exception 'Cette facture appartient à une autre date'; end if;
  if tgt.pennylane_id = p_pennylane_id then raise exception 'La facture est déjà sur cette ligne'; end if;
  if tgt.pennylane_id is not null or nullif(btrim(tgt.invoice_number), '') is not null or tgt.paid_at is not null then
    raise exception 'La ligne choisie a déjà sa facture (ou un paiement) : corrige d''abord cette ligne-là';
  end if;
  if has_src and coalesce(btrim(p_motif), '') = '' then raise exception 'Motif obligatoire pour corriger un rattachement'; end if;
  if has_src and src.paid_at is not null then raise exception 'La ligne d''origine est payée : correction à faire à la main avec ta comptabilité'; end if;
  amt := coalesce(src.amount, pend.amount_ht);
  before_j := jsonb_build_object('source', case when has_src then to_jsonb(src) end, 'cible', to_jsonb(tgt));

  if has_src then
    -- montant figé par la synchronisation ? (dernière écriture du montant faite par le serveur, à la valeur actuelle — journal financier)
    select coalesce((select f.actor = 'service_role' and f.new_value ~ '^-?[0-9]+(\.[0-9]+)?$' and f.new_value::numeric = src.amount from finance_log f
      where f.table_name = 'show_payments' and f.row_id::text = src.id::text and f.field = 'amount' order by f.at desc, f.id desc limit 1), false) into figee;
    -- la facture quitte sa ligne : numéro, lien, envoi, relance et rangement la suivent ; la ligne retrouve son calcul automatique
    -- si son montant était celui de la facture (figé par la synchronisation), sinon le montant saisi est gardé
    update show_payments set pennylane_id = null, pennylane_url = null, invoice_number = null, invoiced_on = null, sent_at = null,
      reminded_at = null, drive_file_id = null,
      amount = case when figee then null else amount end
      where id = src.id;
  end if;
  update show_payments set pennylane_id = p_pennylane_id,
      pennylane_url = coalesce(src.pennylane_url, pend.url), invoice_number = coalesce(src.invoice_number, pend.invoice_number),
      invoiced_on = coalesce(src.invoiced_on, pend.invoice_date), sent_at = coalesce(tgt.sent_at, src.sent_at),
      reminded_at = coalesce(tgt.reminded_at, src.reminded_at), drive_file_id = coalesce(tgt.drive_file_id, src.drive_file_id),
      amount = coalesce(tgt.amount, amt)
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
