-- v1.42.0 (lot D1, demandes d'Anthony du 26/10/2026) — PRÉPARÉE, NON APPLIQUÉE : tests locaux, répétition sur le projet de test,
-- puis application seulement sur autorisation explicite d'Anthony.
--
-- 1. MONTANTS FIGÉS. Une facture d'acompte / de solde émise, une commission versée, une part partenaire versée garde à jamais le
--    montant qu'elle avait à ce moment-là : il est enregistré dans show_payments.amount dès que la ligne devient émise / versée
--    (déclencheur show_payments_freeze). Les lignes pas encore émises restent calculées (cachet × %).
--    Règle écrite deux fois (§8.4) : côté application js/calc.js (payAmount, soldeDue, freezeOnEmit).
-- 2. CACHET / % / MODE d'une date : refusés s'ils changeraient le montant d'une ligne déjà émise ou versée dont le montant n'est pas
--    encore figé (déclencheur shows_frozen_guard). Une fois les montants figés, le cachet peut changer sans toucher au passé.
-- 3. RÉGULARISATION CONTRÔLÉE des lignes historiques (émises avant ce lot, montant encore calculé) : la protection A1 accepte
--    UNIQUEMENT de remplir un montant vide (jamais d'en changer un), et seulement dans une transaction qui l'annonce explicitement
--    (set_config('matrice.regularisation', 'gel', true)) — script validé par Anthony, ligne par ligne. Chaque ligne est journalisée.
--    Retour arrière d'une régularisation (« degel ») : seul un montant posé par une régularisation contrôlée peut être revidé,
--    dans une transaction qui l'annonce ; jamais un montant figé à l'émission, au versement ou saisi. Journalisé lui aussi.
-- 4. JOURNAL FINANCIER (public.finance_log) : toute modification d'un cachet, d'un %, du mode, d'un montant, d'un compte
--    d'encaissement, d'une date d'envoi / de paiement, d'un numéro ou d'un lien Pennylane est tracée (avant, après, quand, qui).
--    Lecture : équipe seulement. Écriture : uniquement par les déclencheurs (aucun droit d'écriture pour l'application).
-- 5. MODE ET TVA D'UNE DATE DÉJÀ ENGAGÉE (décisions d'Anthony du 26/10, points 5 et 7) :
--    - une date dont une ligne porte une opération enregistrée (envoyée, payée / versée, numérotée ou liée à Pennylane — y compris
--      une commission de production seulement numérotée) ne change plus de mode : ni directement, ni quand l'artiste change de mode,
--      ni quand elle change d'artiste (project_mode_to_shows, show_follow_project_mode : définition élargie) ;
--    - la TVA d'une date ne change plus si une ligne émise en dépend (ligne sans TVA propre, hors commissions et parts à 20 %).
--    Même règle côté application : js/calc.js changeBlocked (mode : hasFinancialRecord ; TVA : simulation des montants TTC).
-- Aucune donnée existante n'est modifiée par cette migration. Retour arrière : voir la fin du fichier.

-- ─────────────── Calcul du montant d'une ligne (même règle que js/calc.js payAmount / soldeDue) ───────────────
-- p_fee / p_artbo / p_partner / p_mode : valeurs de la date à utiliser (permet de simuler un changement de cachet ou de %).
create or replace function public.payment_amount_for(p public.show_payments, p_fee numeric, p_artbo numeric, p_partner numeric, p_mode text)
returns numeric language plpgsql stable set search_path = public as $$
declare done numeric; fixed numeric; fee numeric := coalesce(p_fee, 0);
begin
  if p.amount is not null then return p.amount; end if;
  if p.kind = 'artbo' then return round(fee * coalesce(p.pct, p_artbo, 0)) / 100; end if;
  if p.kind = 'partner' then return round(fee * coalesce(p_artbo, 0) * coalesce(p.pct, p_partner, 0) / 100) / 100; end if;
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
end $$;

-- Ligne émise / versée (même définition que js/calc.js isInvoiced et que la protection A1) :
-- commission d'une date en PRODUCTION = seulement versée (paid_at) ; toute autre ligne = envoyée, payée, numérotée ou liée à Pennylane
create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  select case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;

create or replace function public.payment_amount_now(p public.show_payments)
returns numeric language sql stable set search_path = public as $$
  select public.payment_amount_for(p, s.fee_ht, s.artbo_pct, s.partner_pct, s.prod_mode) from public.shows s where s.id = p.show_id
$$;

-- ─────────────── 1. Montant figé au moment où la ligne devient émise / versée ───────────────
create or replace function public.show_payments_freeze() returns trigger
language plpgsql set search_path = public as $$
declare v numeric; fee numeric;
begin
  if new.amount is not null or new.kind not in ('acompte', 'solde', 'autre', 'artbo', 'partner') then return new; end if;
  if not public.payment_is_emitted(new) then return new; end if;
  if tg_op = 'UPDATE' and public.payment_is_emitted(old) then return new; end if;   -- déjà émise avant : régularisation contrôlée (§3)
  select fee_ht into fee from public.shows where id = new.show_id;
  if fee is null then return new; end if;                                                 -- cession pas encore saisie : rien à figer
  if new.kind = 'solde' and exists (select 1 from public.show_payments q where q.show_id = new.show_id and q.kind = 'solde' and q.id <> new.id) then
    return new;                                                                           -- plusieurs soldes : jamais figé automatiquement
  end if;
  v := public.payment_amount_now(new);
  if v is not null then new.amount := round(v, 2); end if;                               -- au centime (relecture D1)
  return new;
end $$;
drop trigger if exists show_payments_freeze on public.show_payments;
create trigger show_payments_freeze before insert or update on public.show_payments
  for each row execute function public.show_payments_freeze();

-- Date « engagée » : une de ses lignes porte une opération enregistrée, quel que soit le mode (définition large, comme la
-- suppression d'une date — js/calc.js changeBlocked, EMITTED_FIELDS)
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))
$$;

-- L'artiste change de mode : ses dates suivent, sauf mode manuel ou date engagée (définition large, décision du 26/10)
create or replace function public.project_mode_to_shows() returns trigger
language plpgsql as $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows s set prod_mode = new.mode
     where s.project_id = new.id and not s.prod_mode_manual and not public.show_has_financial_record(s.id);
  end if;
  return new;
end $function$;

-- La date change d'artiste : son mode suit le nouvel artiste, sauf mode manuel ou date engagée
create or replace function public.show_follow_project_mode() returns trigger
language plpgsql as $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual and not public.show_has_financial_record(new.id) then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$;

-- ─────────────── 2. Cachet / % / mode refusés s'ils changeaient un montant émis non figé ───────────────
create or replace function public.shows_frozen_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.fee_ht is not distinct from old.fee_ht and new.artbo_pct is not distinct from old.artbo_pct
     and new.partner_pct is not distinct from old.partner_pct and new.prod_mode is not distinct from old.prod_mode
     and new.vat_rate is not distinct from old.vat_rate then
    return new;
  end if;
  -- mode d'une date engagée : jamais changé (nature des opérations déjà enregistrées)
  if new.prod_mode is distinct from old.prod_mode and public.show_has_financial_record(new.id) then
    raise exception 'Cette date a des opérations financières enregistrées (facture, versement, numéro ou lien Pennylane) : son mode booking / production ne change plus. Une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  -- TVA de la date : refusée si une ligne émise sans TVA propre en dépend (son TTC changerait)
  if new.vat_rate is distinct from old.vat_rate and exists (select 1 from public.show_payments p where p.show_id = new.id
       and p.vat_rate is null and p.kind not in ('artbo', 'partner') and public.payment_is_emitted(p)) then
    raise exception 'Des factures de cette date sont déjà émises avec la TVA de la date : la TVA ne change plus (leur montant TTC changerait). Une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.show_payments p where p.show_id = new.id and p.amount is null and public.payment_is_emitted(p)
             and public.payment_amount_for(p, old.fee_ht, old.artbo_pct, old.partner_pct, old.prod_mode)
                 is distinct from public.payment_amount_for(p, new.fee_ht, new.artbo_pct, new.partner_pct, new.prod_mode)) then
    raise exception 'Des factures ou des commissions de cette date sont déjà émises ou versées sans montant figé : ce changement (cachet, %%, mode) modifierait leur montant. Il est refusé ; une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists shows_frozen_guard on public.shows;
create trigger shows_frozen_guard before update on public.shows for each row execute function public.shows_frozen_guard();

-- ─────────────── 3. Protection A1 : régularisation contrôlée (remplir un montant vide, jamais le changer) ───────────────
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
    -- retour arrière d'une régularisation (décision d'Anthony du 26/10, point 8) : REVIDER un montant, sans rien changer d'autre,
    -- dans une transaction qui l'annonce (« degel »), et SEULEMENT si ce montant a été posé par une régularisation contrôlée
    -- (dernière écriture du montant au journal : vide → cette valeur, source « régularisation contrôlée »). Un montant figé à
    -- l'émission, au versement ou saisi à la main ne se vide jamais.
    if old.amount is not null and new.amount is null
       and new.pct is not distinct from old.pct and new.vat_rate is not distinct from old.vat_rate
       and new.show_id is not distinct from old.show_id and new.kind is not distinct from old.kind
       and coalesce(current_setting('matrice.regularisation', true), '') = 'degel'
       and exists (select 1 from public.finance_log l where l.id = (select max(m.id) from public.finance_log m where m.row_id = old.id and m.field = 'amount')
                     and l.row_id = old.id and l.field = 'amount'
                     and l.source = 'régularisation contrôlée' and l.old_value is null and (case when l.field = 'amount' then l.new_value::numeric end) = old.amount) then
      return new;
    end if;
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ─────────────── 4. Journal des modifications financières ───────────────
create table if not exists public.finance_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  row_id uuid not null,
  show_id uuid,
  op text not null,                 -- INSERT / UPDATE / DELETE
  field text not null,
  old_value text,
  new_value text,
  actor text,                       -- adresse de l'utilisateur connecté, ou rôle (service_role = fonction serveur), ou compte SQL
  source text                       -- régularisation contrôlée, application, éditeur SQL…
);
create index if not exists finance_log_row on public.finance_log (row_id, at);
create index if not exists finance_log_show on public.finance_log (show_id, at);
alter table public.finance_log enable row level security;
drop policy if exists finance_log_read on public.finance_log;
create policy finance_log_read on public.finance_log for select to authenticated using (public.is_team());
-- droits par défaut de Supabase : tout est accordé aux visiteurs sur une nouvelle table → tout leur est retiré (relecture D1, B1)
revoke all on public.finance_log from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.finance_log from authenticated;
grant select on public.finance_log to authenticated;
revoke all on sequence public.finance_log_id_seq from public, anon, authenticated;

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
                   else array['amount', 'pct', 'vat_rate', 'kind', 'show_id', 'payee', 'sent_at', 'paid_at', 'invoice_number', 'pennylane_id'] end;
  src text := case when coalesce(current_setting('matrice.regularisation', true), '') = 'gel' then 'régularisation contrôlée'
                   when coalesce(current_setting('matrice.regularisation', true), '') in ('degel', 'retour_versement') then 'retour arrière de régularisation'
                   when coalesce(current_setting('matrice.regularisation', true), '') = 'commission_partielle' then 'régularisation contrôlée (commission partielle)'
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
revoke execute on function public.finance_log_write() from public, anon, authenticated;
drop trigger if exists finance_log_shows on public.shows;
create trigger finance_log_shows after insert or update or delete on public.shows for each row execute function public.finance_log_write();
drop trigger if exists finance_log_payments on public.show_payments;
create trigger finance_log_payments after insert or update or delete on public.show_payments for each row execute function public.finance_log_write();

revoke execute on function public.show_payments_freeze() from public, anon, authenticated;
-- fonctions de calcul : appelées par les déclencheurs avec les droits de l'utilisateur connecté → gardées pour authenticated
revoke execute on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.payment_amount_now(public.show_payments) from public, anon;
revoke execute on function public.payment_is_emitted(public.show_payments) from public, anon;
revoke execute on function public.finance_actor() from public, anon;
revoke execute on function public.show_has_financial_record(uuid) from public, anon;
grant execute on function public.show_has_financial_record(uuid) to authenticated, service_role;
grant execute on function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.payment_amount_now(public.show_payments) to authenticated, service_role;
grant execute on function public.payment_is_emitted(public.show_payments) to authenticated, service_role;
grant execute on function public.finance_actor() to authenticated, service_role;
revoke execute on function public.shows_frozen_guard() from public, anon, authenticated;

-- Retour arrière (aucune donnée concernée ; le journal peut être gardé) :
--   drop trigger show_payments_freeze on public.show_payments; drop trigger shows_frozen_guard on public.shows;
--   drop trigger finance_log_shows on public.shows; drop trigger finance_log_payments on public.show_payments;
--   drop function public.show_payments_freeze(); drop function public.shows_frozen_guard(); drop function public.finance_log_write();
--   recréer show_payments_emitted_guard, project_mode_to_shows et show_follow_project_mode dans leur version de production
--   d'avant ce lot (textes relevés le 26/10/2026), puis drop function public.show_has_financial_record(uuid).
