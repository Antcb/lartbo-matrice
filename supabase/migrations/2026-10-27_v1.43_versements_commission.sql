-- v1.43.0 (lot D1, décisions d'Anthony du 27/10/2026) — PRÉPARÉE, NON APPLIQUÉE : tests locaux, répétition sur le projet de test,
-- puis application seulement sur autorisation explicite d'Anthony. Prérequis : migration v1.42 (montants figés, journal) appliquée.
--
-- COMMISSION DE PRODUCTION = UN MONTANT TOTAL DÛ + L'HISTORIQUE DE SES VERSEMENTS (option B retenue le 27/10)
--  * La ligne de commission (show_payments, kind 'artbo', date en production) reste UNIQUE par date (index ci-dessous) ;
--    son montant (amount) est la commission TOTALE due, figée dès le premier versement.
--  * Chaque transfert réel vers L'ArtBoristerie est une ligne de public.commission_transfers : montant, date, référence
--    bancaire, note (ex. « retenue sur l'acompte »). Un versement enregistré ne se modifie plus et ne se supprime pas.
--  * Déjà transféré = somme des versements ; reste = total − déjà transféré ; « versée » (paid_at) seulement quand le reste est nul.
--  * Compte de l'artiste : seuls les versements sont déduits. Rappels : sur le reste à transférer. Jamais de facture (production).
--  * Une commission marquée « versée » AVANT ce lot, sans versement détaillé, compte comme versée en totalité à sa date
--    (compatibilité) ; ses versements historiques se notent ensuite par un script validé par Anthony.
--  * Une ancienne version de l'application qui note directement une date de versement crée automatiquement le versement du
--    reste (même règle que « Noter un versement »).
-- Règle écrite deux fois (§8.4) : côté application js/calc.js (transfersOf, commissionState), js/budget.js, js/reminders.js.
-- Aucune donnée existante n'est modifiée par cette migration. Retour arrière : voir la fin du fichier.

-- ─────────────── 1. Une seule commission par date ───────────────
create unique index if not exists show_payments_une_commission on public.show_payments (show_id) where kind = 'artbo';

-- ─────────────── 2. Versements ───────────────
create table if not exists public.commission_transfers (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.show_payments(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  transferred_at date not null,
  reference text,                   -- libellé du relevé bancaire (ex. « VIR INT. TL CARCASSONNE ACOMPT »)
  note text,                        -- ex. « retenue sur l'acompte, sans virement distinct »
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists commission_transfers_payment on public.commission_transfers (payment_id, transferred_at);
alter table public.commission_transfers enable row level security;
drop policy if exists commission_transfers_read on public.commission_transfers;
create policy commission_transfers_read on public.commission_transfers for select to authenticated using (public.is_team());
drop policy if exists commission_transfers_add on public.commission_transfers;
create policy commission_transfers_add on public.commission_transfers for insert to authenticated with check (public.is_team());
-- droits par défaut de Supabase : tout est accordé aux visiteurs sur une nouvelle table → tout leur est retiré (relecture D1, B1)
revoke all on public.commission_transfers from public, anon;
revoke update, delete, truncate, references, trigger on public.commission_transfers from authenticated;
grant select, insert on public.commission_transfers to authenticated;
-- mises à jour en direct (autres postes) comme les autres tables de l'application, si la publication existe
do $p$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commission_transfers') then
    execute 'alter publication supabase_realtime add table public.commission_transfers';
  end if;
end $p$;

-- Date « engagée » (décision 5) : un versement de commission compte aussi comme une opération enregistrée (relecture D1, B2) —
-- son mode ne change plus (sinon la commission versée deviendrait une facture de booking). Même règle : js/calc.js hasFinancialRecord
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                        or exists (select 1 from public.commission_transfers t where t.payment_id = p.id)))
$$;

-- Total dû d'une commission (montant figé, sinon calcul du moment) et déjà transféré
create or replace function public.commission_total(p public.show_payments)
returns numeric language sql stable set search_path = public as $$
  select round(coalesce(p.amount, public.payment_amount_now(p)), 2)
$$;
create or replace function public.commission_transferred(p_payment uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0) from public.commission_transfers where payment_id = p_payment
$$;

-- Avant un versement : seulement une commission de PRODUCTION ; jamais au-delà du total ; total figé au premier versement
create or replace function public.commission_transfer_before() returns trigger
language plpgsql set search_path = public as $$
declare l public.show_payments; total numeric; done numeric;
begin
  if tg_op <> 'INSERT' then
    -- seul retour arrière permis : SUPPRIMER un versement, dans un script de retour arrière qui l'annonce ; jamais le modifier
    if tg_op = 'DELETE' and coalesce(current_setting('matrice.regularisation', true), '') = 'retour_versement' then
      return old;
    end if;
    raise exception 'Un versement de commission enregistré ne se modifie pas et ne se supprime pas (une régularisation se décide à part).'
      using errcode = 'P0001';
  end if;
  select * into l from public.show_payments where id = new.payment_id for update;
  if l.id is null or l.kind <> 'artbo'
     or exists (select 1 from public.shows s where s.id = l.show_id and coalesce(s.prod_mode, 'production') = 'booking') then
    raise exception 'Un versement ne se note que sur la commission d''une date en production (en booking, la commission est une facture).'
      using errcode = 'P0001';
  end if;
  total := public.commission_total(l);
  done := public.commission_transferred(l.id);
  if total is null or total <= 0 then
    raise exception 'Commission sans montant : saisis d''abord le cachet ou le montant de la commission.' using errcode = 'P0001';
  end if;
  -- un versement noté sur une commission déjà marquée versée (sans détail) ne peut que la détailler (script validé)
  if done + new.amount > total + 0.004 then
    raise exception 'Versement trop élevé : il reste % € à transférer sur cette commission.', replace(to_char(greatest(total - done, 0), 'FM999999990.00'), '.', ',')
      using errcode = 'P0001';
  end if;
  if l.amount is null then
    update public.show_payments set amount = total where id = l.id;   -- total figé au premier versement (jamais recalculé ensuite)
  end if;
  new.created_by := public.finance_actor();   -- toujours l'auteur réel (jamais une valeur fournie par l'application)
  return new;
end $$;
drop trigger if exists commission_transfer_before on public.commission_transfers;
create trigger commission_transfer_before before insert or update or delete on public.commission_transfers
  for each row execute function public.commission_transfer_before();

-- Après un versement : commission « versée » (paid_at = date du dernier versement) dès que le reste est nul
create or replace function public.commission_transfer_after() returns trigger
language plpgsql set search_path = public as $$
declare l public.show_payments;
begin
  if tg_op <> 'INSERT' then return null; end if;
  select * into l from public.show_payments where id = new.payment_id;
  if l.paid_at is null and public.commission_transferred(l.id) >= public.commission_total(l) - 0.004 then
    update public.show_payments set paid_at = (select max(transferred_at) from public.commission_transfers where payment_id = l.id)
     where id = l.id;
  end if;
  return null;
end $$;
drop trigger if exists commission_transfer_after on public.commission_transfers;
create trigger commission_transfer_after after insert on public.commission_transfers
  for each row execute function public.commission_transfer_after();

-- ─────────────── 3. Commission qui a des versements : verrouillée ───────────────
-- Total, %, type, date : figés dès le premier versement. « Versée » seulement quand tout est transféré (sauf ancienne
-- application : une date de versement notée directement crée le versement du reste, voir § 4). Jamais supprimée.
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
    elsif coalesce(current_setting('matrice.regularisation', true), '') = 'degel' and new.amount = done then
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
drop trigger if exists show_payments_commission_lock on public.show_payments;
create trigger show_payments_commission_lock before update or delete on public.show_payments
  for each row execute function public.show_payments_commission_lock();

-- ─────────────── 4. Ancienne application : date de versement notée directement → versement du reste ───────────────
create or replace function public.show_payments_commission_paid() returns trigger
language plpgsql set search_path = public as $$
declare total numeric; done numeric;
begin
  if new.kind <> 'artbo' or old.paid_at is not null or new.paid_at is null
     or exists (select 1 from public.shows s where s.id = new.show_id and coalesce(s.prod_mode, 'production') = 'booking') then
    return null;
  end if;
  total := public.commission_total(new); done := public.commission_transferred(new.id);
  if total - done > 0.004 then
    insert into public.commission_transfers (payment_id, amount, transferred_at, note)
    values (new.id, round(total - done, 2), new.paid_at, 'versement noté par sa date (montant restant)');
  end if;
  return null;
end $$;
drop trigger if exists show_payments_commission_paid on public.show_payments;
create trigger show_payments_commission_paid after update of paid_at on public.show_payments
  for each row execute function public.show_payments_commission_paid();

-- ─────────────── 5. Protection A1 : régularisation « commission partielle » (décision d'Anthony du 27/10, Carcassonne) ───────────────
-- Une commission de production marquée versée alors qu'une partie seulement a été transférée : dans une transaction qui
-- l'annonce (« commission_partielle »), avec ses versements DÉJÀ enregistrés, elle redevient « versée en partie » : total
-- relevé (jamais sous le déjà transféré), date de versement retirée. Rien d'autre ne change ; les versements restent.
create or replace function public.show_payments_emitted_guard() returns trigger
language plpgsql set search_path = public as $$   -- §7.3
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
end $$;

-- ─────────────── 6. Journal : versements tracés (montant, date, référence) ───────────────
create or replace function public.finance_log_transfers() returns trigger
language plpgsql security definer set search_path = public as $$
declare sid uuid; src text;
begin
  select show_id into sid from public.show_payments where id = coalesce(new.payment_id, old.payment_id);
  src := case when coalesce(current_setting('matrice.regularisation', true), '') = 'retour_versement' then 'retour arrière de régularisation'
              when coalesce(current_setting('matrice.regularisation', true), '') = 'commission_partielle' then 'régularisation contrôlée (commission partielle)'
              when coalesce(current_setting('matrice.regularisation', true), '') <> '' then 'régularisation contrôlée'
              when coalesce(current_setting('request.jwt.claims', true), '') <> '' then 'application / fonction serveur'
              else 'base (éditeur SQL, tâche planifiée)' end;
  insert into public.finance_log (table_name, row_id, show_id, op, field, old_value, new_value, actor, source)
  values ('commission_transfers', coalesce(new.id, old.id), sid, tg_op, 'versement',
          case when tg_op = 'INSERT' then null else concat_ws(' · ', old.amount, old.transferred_at, old.reference) end,
          case when tg_op = 'DELETE' then null else concat_ws(' · ', new.amount, new.transferred_at, new.reference) end,
          public.finance_actor(), src);
  return null;
end $$;
drop trigger if exists finance_log_transfers on public.commission_transfers;
create trigger finance_log_transfers after insert or update or delete on public.commission_transfers
  for each row execute function public.finance_log_transfers();

-- ─────────────── 7. Rappels : commission de production à transférer = RESTE dû (versements partiels compris) ───────────────
-- Texte identique à la version v1.41 (relances C1) sauf la ligne « commission » : reste = total − versements, montant indiqué.
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

-- ─────────────── 8. Droits ───────────────
revoke execute on function public.commission_total(public.show_payments) from public, anon;
revoke execute on function public.commission_transferred(uuid) from public, anon;
grant execute on function public.commission_total(public.show_payments) to authenticated, service_role;
grant execute on function public.commission_transferred(uuid) to authenticated, service_role;
revoke execute on function public.commission_transfer_before() from public, anon, authenticated;
revoke execute on function public.commission_transfer_after() from public, anon, authenticated;
revoke execute on function public.show_payments_commission_lock() from public, anon, authenticated;
revoke execute on function public.show_payments_commission_paid() from public, anon, authenticated;
revoke execute on function public.finance_log_transfers() from public, anon, authenticated;

-- Retour arrière (seulement si aucun versement n'a été enregistré ; sinon décision d'Anthony) :
--   drop trigger commission_transfer_before, commission_transfer_after, finance_log_transfers on public.commission_transfers ;
--   drop trigger show_payments_commission_lock, show_payments_commission_paid on public.show_payments ; drop table public.commission_transfers ;
--   drop function commission_transfer_before(), commission_transfer_after(), show_payments_commission_lock(),
--     show_payments_commission_paid(), finance_log_transfers(), commission_total(show_payments), commission_transferred(uuid) ;
--   drop index public.show_payments_une_commission ; recréer show_has_financial_record, generate_reminders (v1.41) et
--   show_payments_emitted_guard dans leur version d'avant (v1.42 / v1.41).
