-- =====================================================================================================
-- DÉPLOIEMENT LOT D1 SUR LE PROJET DE TEST — corps et contrôles IDENTIQUES au script de production, garde du test
-- Pour un test déjà dans l'état de la production après C1 (par ex. après le retour arrière durable).
-- =====================================================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $g$
begin
  -- IDENTITÉ (même contrôle que le déploiement C1 du 26/10)
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%dthfocplfzzmkgaxhmwk%') then
    raise exception 'ARRET : ce n''est pas le projet de TEST (dthfocplfzzmkgaxhmwk) — rien n''a été fait'; end if;
  if exists (select 1 from public.settings where value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : l''identifiant de l''autre projet est présent dans les réglages — rien n''a été fait'; end if;
  if (select count(*) from public.shows) >= 200 then
    raise exception 'ARRET : nombre de dates incohérent avec le projet de TEST — rien n''a été fait'; end if;
end $g$;
do $v$
begin
  -- VERSIONS DE DÉPART (relevées en production le 26/10/2026, lecture seule) : protections A1 et C1 du déploiement C1, sans le lot D1
  if md5(pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) <> 'cd2ea4e4c8d85e9ea58d3166d5040978' then
    raise exception 'ARRET : la protection A1 n''est pas la version de départ attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.show_payments_caduc_guard()'::regprocedure)) <> 'd713c4d0d1d45d2359981c49f1bf2239' then
    raise exception 'ARRET : la protection C1 (acompte caduc) n''est pas la version de départ attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) <> 'ae7f1ea9d1646f23f3aa57d292d40b18'
     or md5(pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) <> '45fe55a664ff4c423386a7d6f280cbd0' then
    raise exception 'ARRET : les fonctions de mode (artiste → dates) ne sont pas la version de départ attendue — rien n''a été fait'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('project_mode_to_shows', 'show_follow_project_mode')) <> 2 then
    raise exception 'ARRET : déclencheurs de mode absents — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.generate_reminders()'::regprocedure)) <> '6f834c203fcdae7b7a02c06df4c1f81d' then
    raise exception 'ARRET : la fonction des rappels n''est pas la version de départ attendue (v1.41) — rien n''a été fait'; end if;
  if to_regclass('public.commission_transfers') is not null or exists (select 1 from pg_indexes where indexname = 'show_payments_une_commission') then
    raise exception 'ARRET : les versements de commission (v1.43) sont déjà (en partie) présents — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.ensure_production_payments(uuid)'::regprocedure)) <> 'd55c81ebb5ef14b26aacf6de07681fb7' then
    raise exception 'ARRET : ensure_production_payments n''est pas la version de production attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.on_show_confirmed()'::regprocedure)) <> 'f0cfdf80d6b7c8d3c7e1d7c4093201dd' then
    raise exception 'ARRET : on_show_confirmed n''est pas la version de production attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.fiche_get(text)'::regprocedure)) <> '18c6b88bcb0c9b56ed2062cd83ca338e' then
    raise exception 'ARRET : fiche_get n''est pas la version de production attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.mail_vars(uuid, uuid)'::regprocedure)) <> 'a1bb413b3f321997c4f3b87b338ed53d' then
    raise exception 'ARRET : mail_vars n''est pas la version de production attendue — rien n''a été fait'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_payments' and column_name = 'hors_calcul') then
    raise exception 'ARRET : la colonne hors_calcul (v1.44) est déjà présente — rien n''a été fait'; end if;
  if exists (select 1 from public.show_payments where kind = 'artbo' group by show_id having count(*) > 1) then
    raise exception 'ARRET : une date a plusieurs lignes de commission — rien n''a été fait (à examiner)'; end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) or to_regprocedure('public.show_payments_freeze()') is not null then
    raise exception 'ARRET : le lot D1 est déjà (en partie) présent — rien n''a été fait'; end if;
end $v$;
-- Instantané des données (empreintes complètes) : la migration ne doit RIEN changer aux données
drop table if exists _d1_avant;
create temp table _d1_avant on commit drop as select (select count(*) from public.show_payments) n_lignes, (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t) lignes,
       (select count(*) from public.shows) n_dates, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t) dates,
       (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t) artistes,
       (select count(*) from pg_class where relname = 'finance_log' and relnamespace = 'public'::regnamespace) journal_existe;
create temp table if not exists _d1_journal (n bigint) on commit drop;
truncate _d1_journal;
do $j$ begin if to_regclass('public.finance_log') is not null then execute 'insert into _d1_journal select count(*) from public.finance_log'; end if; end $j$;

-- ===== Migration v1.42 — texte identique au fichier supabase/migrations/2026-10-26_v1.42_montants_figes_journal.sql =====
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
  -- classement « hors calcul » posé ou retiré (v1.44, régularisation annoncée) : ce n'est pas une émission, rien à figer
  if tg_op = 'UPDATE' and (to_jsonb(new) -> 'hors_calcul') is distinct from (to_jsonb(old) -> 'hors_calcul') then return new; end if;
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
revoke insert, update, delete, truncate, references, trigger on public.finance_log from service_role;  -- la sauvegarde ne fait que lire ; le journal n'est écrit que par déclencheur (relecture D1)
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

-- ===== Migration v1.43 — texte identique au fichier supabase/migrations/2026-10-27_v1.43_versements_commission.sql =====
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
revoke truncate, references, trigger on public.commission_transfers from service_role;   -- vider la table contournerait les déclencheurs (relecture finale D1)
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

-- ===== Migration v1.44 — texte identique au fichier supabase/migrations/2026-10-27_v1.44_coproduction_hors_calcul.sql =====
-- =====================================================================================================
-- v1.44 — Lot D1 : COPRODUCTIONS (décision d'Anthony du 27/10/2026, Rockstore)
-- Une coproduction n'est pas une production classique : aucune facture de cession, aucun acompte, aucun solde, aucune
-- commission L'ArtBo ni part partenaire générés automatiquement. Ses opérations financières RÉELLES s'ajoutent à la main
-- quand elles existent ; aucune n'est inventée.
--  1. show_payments.hors_calcul (motif) : ligne GARDÉE pour la traçabilité (import…), ignorée de tout calcul — indicateurs,
--     comptes, rappels, Pennylane, fiche publique, mails, date engagée, garde du cachet. Le motif se pose / se retire
--     SEULEMENT dans une transaction annoncée (« hors_calcul »), sans rien changer d'autre, et c'est journalisé ; une ligne
--     hors calcul ne se modifie plus et ne se supprime pas ; aucun versement de commission ne s'y note.
--     Seule une ligne ARTIFICIELLE d'import d'une date « Co-Production » (acompte, solde, commission, part partenaire, avec
--     import_key, sans montant figé, facture numérotée autre que « N.C », Pennylane, pièce, déclaration ni versement) peut l'être.
--  2. Lignes automatiques : plus créées pour une date « Co-Production » (confirmation de la date, passage booking → production) ;
--     la taxe CNM (billetterie) reste prévue comme avant.
--  3. Fiche publique et variables des mails : sans les lignes hors calcul ; coproduction sans acompte = 0 %.
-- Même règle côté application : js/calc.js (paymentsOf, isCoproduction), budget.js, production.js, confirm-flow.js, mail.js ;
-- fonction Pennylane : lignes hors calcul jamais reliées, synchronisées ni facturées.
-- =====================================================================================================

alter table public.show_payments add column if not exists hors_calcul text;
comment on column public.show_payments.hors_calcul is 'Motif : ligne gardée pour la traçabilité mais hors de tout calcul (lot D1, v1.44). Posé/retiré seulement par une régularisation annoncée (matrice.regularisation = hors_calcul).';

-- une seule commission L'ArtBo QUI COMPTE par date (v1.43) : une commission hors calcul (import) n'empêche pas d'en noter une réelle
drop index if exists public.show_payments_une_commission;
create unique index show_payments_une_commission on public.show_payments (show_id) where kind = 'artbo' and hors_calcul is null;

-- ─────────────── 1. Garde : le classement « hors calcul » ne se change que par un script annoncé ───────────────
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
drop trigger if exists show_payments_hors_calcul_guard on public.show_payments;
create trigger show_payments_hors_calcul_guard before insert or update or delete on public.show_payments
  for each row execute function public.show_payments_hors_calcul_guard();

create or replace function public.commission_transfers_hors_calcul() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.show_payments p where p.id = new.payment_id and p.hors_calcul is not null) then
    raise exception 'Ligne hors calcul : aucun versement ne s''y note.' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists commission_transfers_hors_calcul on public.commission_transfers;
create trigger commission_transfers_hors_calcul before insert on public.commission_transfers
  for each row execute function public.commission_transfers_hors_calcul();

-- ─────────────── 2. Calculs : une ligne hors calcul n'est ni émise, ni versée, ni une opération enregistrée ───────────────
create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  -- ligne hors calcul (coproduction, import) : ni émise ni versée pour les calculs (v1.44)
  select p.hors_calcul is null and case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;

create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show and p.hors_calcul is null
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                        or exists (select 1 from public.commission_transfers t where t.payment_id = p.id)))
$$;

-- ─────────────── 3. Rappels (version v1.43 + lignes hors calcul ignorées) ───────────────
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
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
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

-- ─────────────── 4. Lignes automatiques : rien pour une coproduction ───────────────
CREATE OR REPLACE FUNCTION public.on_show_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  url text := setting_text('drive_webhook_url');
  secret text := setting_text('drive_webhook_secret');
  p projects%rowtype;
  partner_default numeric;
begin
  if setting_text('import_mode') = 'true' then return new; end if;
  if new.status not in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  select * into p from projects where id = new.project_id;
  if new.artbo_pct is null then
    update shows set artbo_pct = coalesce(p.default_artbo_pct, setting_num(case when coalesce(new.prod_mode, p.mode) = 'booking' then 'default_artbo_pct_booking' else 'default_artbo_pct_production' end), setting_num('default_artbo_pct')) where id = new.id;
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
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
        (new.id, 'solde', 'Solde', 100 - coalesce(setting_num('default_acompte_pct'), 20), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
    end if;
    -- coproduction : la taxe CNM (billetterie) reste prévue, comme avant ; aucune ligne de facturation
    if new.contract_type = 'Co-Production' and not exists (select 1 from show_payments where show_id = new.id and kind = 'cnm') then
      insert into show_payments (show_id, kind, label, pct, sort) values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
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

CREATE OR REPLACE FUNCTION public.ensure_production_payments(p_show uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ac numeric := coalesce(setting_num('default_acompte_pct'), 50); s record; has_ac boolean; has_so boolean; sum_ac numeric; mx int;
begin
  select * into s from shows where id = p_show;
  if s is null or coalesce(s.prod_mode, 'production') = 'booking' or s.status not in ('Confirmée Salle','Confirmée Festival') then return; end if;
  if s.contract_type = 'Co-Production' then return; end if;   -- coproduction : aucune ligne de facturation générée (27/10/2026)
  perform pg_advisory_xact_lock(hashtext('pay:' || p_show));
  select coalesce(max(sort), 0) into mx from show_payments where show_id = p_show;
  has_ac := exists (select 1 from show_payments where show_id = p_show and kind = 'acompte');
  has_so := exists (select 1 from show_payments where show_id = p_show and kind = 'solde');
  -- rien de prévu : acompte par défaut + solde ; un solde déjà là sans acompte = choix « sans acompte », gardé tel quel
  if not has_ac and not has_so then
    insert into show_payments (show_id, kind, label, pct, sort, payee) values
      (p_show, 'acompte', 'Acompte', ac, mx + 1, 'compte'), (p_show, 'solde', 'Solde', greatest(0, 100 - ac), mx + 2, 'compte');
  elsif not has_so then
    select coalesce(sum(pct), 0) into sum_ac from show_payments where show_id = p_show and kind = 'acompte';
    insert into show_payments (show_id, kind, label, pct, sort, payee) values (p_show, 'solde', 'Solde', greatest(0, 100 - sum_ac), mx + 1, 'compte');
  end if;
end $function$;

-- ─────────────── 5. Fiche publique et mails : sans les lignes hors calcul ───────────────
CREATE OR REPLACE FUNCTION public.fiche_get(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; pays jsonb; vat numeric; acpt numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  vat := coalesce(s.vat_rate, 5.5);
  select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'kind', p.kind, 'pct', p.pct, 'due_label', p.due_label,
           'ht', coalesce(p.amount, round(s.fee_ht * p.pct) / 100)) order by p.sort), '[]')
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde') and p.hors_calcul is null;
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' and hors_calcul is null order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type, 'prod_mode', coalesce(s.prod_mode, 'production'),
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, case when s.terms_validated_at is not null or s.contract_type = 'Co-Production' then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break, 'show_time', s.show_time, 'set_length', s.set_length,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.mail_vars(p_show uuid, p_contact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; c contacts%rowtype;
  acpt numeric; vat numeric; site text;
begin
  select * into s from shows where id = p_show;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  select * into c from contacts where id = coalesce(p_contact, s.conf_contact_id);
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' and hors_calcul is null order by sort limit 1;
  acpt := coalesce(acpt, case when s.terms_validated_at is not null or s.contract_type = 'Co-Production' then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
  vat := coalesce(s.vat_rate, 5.5);
  site := coalesce(nullif(setting_text('site_url'), ''), 'https://antcb.github.io/lartbo-matrice/');
  return jsonb_build_object(
    'artiste', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', fr_date(s.date), 'date_longue', fr_date(s.date, true),
    'ville', coalesce(s.city, st.city, ''),
    'cp', coalesce(nullif(case when s.department ~ '^\d$' then '0' || s.department else upper(s.department) end, ''),
                 case when lower(trim(st.city)) = lower(trim(s.city)) and st.postal_code ~ '^\d{5}$' then
                   case when st.postal_code ~ '^9[78]' then left(st.postal_code, 3) when st.postal_code ~ '^20' then (case when st.postal_code::int < 20200 then '2A' else '2B' end) else left(st.postal_code, 2) end end, ''),
    'code_postal', coalesce(st.postal_code, ''),
    'lieu', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'adresse', coalesce(nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),
    'jauge', coalesce(s.capacity, (select e.capacity from structure_events e where e.structure_id = st.id and e.capacity is not null order by e.date_start nulls last limit 1), nullif(st.capacity_1, 0))::text,
    'cachet_ht', fr_eur(s.fee_ht),
    'cachet_ttc', fr_eur(round(s.fee_ht * (1 + vat / 100), 2)),
    'tva', replace(rtrim(rtrim(to_char(vat, 'FM990.99'), '0'), '.'), '.', ',') || ' %',
    'type_contrat', coalesce(s.contract_type, ''),
    'acompte_pct', replace(rtrim(rtrim(to_char(acpt, 'FM990.99'), '0'), '.'), '.', ',') || '%',
    'contact', contact_first_name(c.first_name, c.last_name, c.display_name),
    'contact_email', coalesce(nullif(concat_ws(', ', nullif(trim(c.email), ''), nullif(trim(c.email_2), '')), ''), ''),
    'structure', coalesce(st.name, ''),
    'lien_fiche', site || 'fiche.html?t=' || s.fiche_token,
    'personnes', coalesce(pr.road_people::text, ''),
    'horaire', coalesce(nullif(s.show_time, ''), nullif(s.contract_data->>'show_time', ''), nullif(s.fiche->>'show_time', ''), ''),
    'duree_set', coalesce(nullif(s.set_length, ''), nullif(s.contract_data->>'set_length', ''), nullif(s.fiche->>'set_length', ''), ''),
    'chambres', concat_ws(' et ', case when pr.rooms_single > 0 then pr.rooms_single || ' single-room' || case when pr.rooms_single > 1 then 's' else '' end end,
                                  case when pr.rooms_twin > 0 then pr.rooms_twin || ' twin-room' || case when pr.rooms_twin > 1 then 's' else '' end end),
    'invitations', coalesce(s.invitations::text, ''),
    'montage', coalesce(rtrim(rtrim(to_char(pr.setup_hours, 'FM990.99'), '0'), '.') || ' h', ''));
end $function$;

-- ─────────────── 6. Droits ───────────────
revoke execute on function public.show_payments_hors_calcul_guard() from public, anon, authenticated;
revoke execute on function public.commission_transfers_hors_calcul() from public, anon, authenticated;
revoke execute on function public.payment_is_emitted(public.show_payments) from public, anon;
grant execute on function public.payment_is_emitted(public.show_payments) to authenticated, service_role;
revoke execute on function public.show_has_financial_record(uuid) from public, anon;
grant execute on function public.show_has_financial_record(uuid) to authenticated, service_role;
-- fonctions de production redéfinies ci-dessus : mêmes droits qu'en production (relevés le 25/10/2026)
revoke all on function public.ensure_production_payments(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ensure_production_payments(uuid) to service_role;
revoke all on function public.on_show_confirmed() from public, anon, authenticated, service_role;
grant execute on function public.on_show_confirmed() to service_role;
revoke all on function public.fiche_get(text) from public, anon, authenticated, service_role;
grant execute on function public.fiche_get(text) to anon, authenticated, service_role;
revoke all on function public.mail_vars(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mail_vars(uuid, uuid) to authenticated, service_role;

-- Retour arrière (seulement si AUCUNE ligne n'est hors calcul) : voir retour_arriere_v1.42_production.sql (fonctions remises dans
-- leur version v1.42 / v1.43 / production, déclencheurs retirés, colonne retirée).

-- ===== Contrôles après la migration (toujours dans la transaction) =====
do $ctl$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) <> 4 then
    raise exception 'ECHEC : déclencheurs du lot D1 absents ou désactivés — TOUT EST ANNULÉ'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('show_payments_emitted_guard', 'show_payments_caduc_guard')) <> 2 then
    raise exception 'ECHEC : protections A1 / C1 absentes ou désactivées — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.show_payments_caduc_guard()'::regprocedure)) <> 'd713c4d0d1d45d2359981c49f1bf2239' then
    raise exception 'ECHEC : la protection C1 a été modifiée — TOUT EST ANNULÉ'; end if;
  if position('show_has_financial_record' in pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) = 0
     or position('show_has_financial_record' in pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) = 0
     or (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('project_mode_to_shows', 'show_follow_project_mode')) <> 2 then
    raise exception 'ECHEC : protection du mode des dates engagées absente — TOUT EST ANNULÉ'; end if;
  if position('degel' in pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) = 0 then
    raise exception 'ECHEC : retour arrière contrôlé absent de A1 — TOUT EST ANNULÉ'; end if;
  if position('matrice.regularisation' in pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) = 0 then
    raise exception 'ECHEC : protection A1 non mise à jour — TOUT EST ANNULÉ'; end if;
  if has_table_privilege('authenticated', 'public.finance_log', 'INSERT') or has_table_privilege('authenticated', 'public.finance_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.finance_log', 'DELETE') or has_table_privilege('anon', 'public.finance_log', 'SELECT')
     or not (select relrowsecurity from pg_class where oid = 'public.finance_log'::regclass) then
    raise exception 'ECHEC : droits du journal trop larges ou RLS inactive — TOUT EST ANNULÉ'; end if;
  if has_function_privilege('authenticated', 'public.finance_log_write()', 'EXECUTE') or has_function_privilege('anon', 'public.show_payments_freeze()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.shows_frozen_guard()', 'EXECUTE') then
    raise exception 'ECHEC : droits d''exécution trop larges — TOUT EST ANNULÉ'; end if;
  -- les déclencheurs appellent les fonctions de calcul avec les droits de l'appelant : l'application et la fonction Pennylane doivent pouvoir les exécuter
  if not (has_function_privilege('authenticated', 'public.payment_is_emitted(public.show_payments)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.payment_amount_now(public.show_payments)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.finance_actor()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.payment_is_emitted(public.show_payments)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.payment_amount_now(public.show_payments)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.finance_actor()', 'EXECUTE'))
     or has_function_privilege('anon', 'public.payment_is_emitted(public.show_payments)', 'EXECUTE')
     or has_function_privilege('anon', 'public.payment_amount_now(public.show_payments)', 'EXECUTE')
     or has_function_privilege('anon', 'public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_actor()', 'EXECUTE') then
    raise exception 'ECHEC : droits des fonctions de calcul incorrects (application ou Pennylane bloquées, ou visiteurs autorisés) — TOUT EST ANNULÉ'; end if;
  -- versements de commission (v1.43)
  if to_regclass('public.commission_transfers') is null or not (select relrowsecurity from pg_class where oid = 'public.commission_transfers'::regclass)
     or (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('commission_transfer_before', 'commission_transfer_after', 'finance_log_transfers', 'show_payments_commission_lock', 'show_payments_commission_paid')) <> 5
     or not exists (select 1 from pg_indexes where indexname = 'show_payments_une_commission') then
    raise exception 'ECHEC : versements de commission incomplets (table, règles d''accès, déclencheurs ou unicité) — TOUT EST ANNULÉ'; end if;
  if has_table_privilege('anon', 'public.finance_log', 'SELECT') or has_table_privilege('anon', 'public.finance_log', 'INSERT')
     or has_table_privilege('anon', 'public.commission_transfers', 'UPDATE') or has_table_privilege('anon', 'public.commission_transfers', 'DELETE')
     or not has_table_privilege('authenticated', 'public.finance_log', 'SELECT') or has_table_privilege('service_role', 'public.finance_log', 'INSERT') or has_table_privilege('service_role', 'public.finance_log', 'DELETE')
     or position('commission_transfers' in pg_get_functiondef('public.show_has_financial_record(uuid)'::regprocedure)) = 0 then
    raise exception 'ECHEC : droits des visiteurs ou date engagée (versements) incorrects — TOUT EST ANNULÉ'; end if;
  if has_table_privilege('authenticated', 'public.commission_transfers', 'UPDATE') or has_table_privilege('authenticated', 'public.commission_transfers', 'DELETE')
     or has_table_privilege('service_role', 'public.commission_transfers', 'TRUNCATE') or has_table_privilege('authenticated', 'public.commission_transfers', 'TRUNCATE')
     or has_table_privilege('anon', 'public.commission_transfers', 'SELECT') or has_table_privilege('anon', 'public.commission_transfers', 'INSERT')
     or not has_table_privilege('authenticated', 'public.commission_transfers', 'INSERT')
     or not has_function_privilege('authenticated', 'public.commission_total(public.show_payments)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.commission_transferred(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.commission_transferred(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.commission_transferred(uuid)', 'EXECUTE') then
    raise exception 'ECHEC : droits des versements de commission incorrects — TOUT EST ANNULÉ'; end if;
  if position('commission_transferred' in pg_get_functiondef('public.generate_reminders()'::regprocedure)) = 0
     or position('commission_partielle' in pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) = 0 then
    raise exception 'ECHEC : rappels ou protection A1 non mis à jour (v1.43) — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from pg_roles where rolname = 'sauvegarde') and not has_table_privilege('sauvegarde', 'public.commission_transfers', 'SELECT') then
    raise exception 'ECHEC : les versements ne seraient pas sauvegardés (rôle sauvegarde sans lecture) — TOUT EST ANNULÉ'; end if;
  -- sauvegarde nocturne complète : le rôle de sauvegarde (s'il existe) doit lire le journal (droits par défaut des futures tables)
  if exists (select 1 from pg_roles where rolname = 'sauvegarde') and not has_table_privilege('sauvegarde', 'public.finance_log', 'SELECT') then
    raise exception 'ECHEC : le journal ne serait pas sauvegardé (rôle sauvegarde sans lecture) — TOUT EST ANNULÉ'; end if;
  -- coproductions (v1.44)
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('show_payments_hors_calcul_guard', 'commission_transfers_hors_calcul')) <> 2
     or position('hors_calcul' in pg_get_functiondef('public.payment_is_emitted(public.show_payments)'::regprocedure)) = 0
     or position('hors_calcul' in pg_get_functiondef('public.show_has_financial_record(uuid)'::regprocedure)) = 0
     or position('hors_calcul' in pg_get_functiondef('public.generate_reminders()'::regprocedure)) = 0
     or position('Co-Production' in pg_get_functiondef('public.ensure_production_payments(uuid)'::regprocedure)) = 0
     or position('hors_calcul' in pg_get_functiondef('public.fiche_get(text)'::regprocedure)) = 0
     or position('hors_calcul' in pg_get_functiondef('public.mail_vars(uuid, uuid)'::regprocedure)) = 0
     or position('hors_calcul' in pg_get_functiondef('public.finance_log_write()'::regprocedure)) = 0 then
    raise exception 'ECHEC : coproductions (v1.44) incomplètes — TOUT EST ANNULÉ'; end if;
  if has_function_privilege('anon', 'public.show_payments_hors_calcul_guard()', 'EXECUTE') or has_function_privilege('authenticated', 'public.show_payments_hors_calcul_guard()', 'EXECUTE')
     or has_function_privilege('anon', 'public.mail_vars(uuid, uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.ensure_production_payments(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.fiche_get(text)', 'EXECUTE') then
    raise exception 'ECHEC : droits des fonctions (v1.44) incorrects — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from public.show_payments where hors_calcul is not null) then
    raise exception 'ECHEC : la migration a classé des lignes hors calcul — TOUT EST ANNULÉ'; end if;
  if (select (n_lignes, lignes, n_dates, dates, artistes) is distinct from
             ((select count(*) from public.show_payments), (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t),
              (select count(*) from public.shows), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t),
              (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t)) from _d1_avant) then
    raise exception 'ECHEC : des données ont changé pendant la migration — TOUT EST ANNULÉ'; end if;
  if (select count(*) from public.finance_log) <> coalesce((select n from _d1_journal), 0) then
    raise exception 'ECHEC : la migration a écrit dans le journal — TOUT EST ANNULÉ'; end if;
end $ctl$;
commit;
