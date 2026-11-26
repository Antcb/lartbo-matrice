-- v1.69 — L1 du point 02 « Annulations de dates et avoirs » (décisions d'Anthony du 26/11/2026, D7) : import des AVOIRS Pennylane.
-- Anthony crée les avoirs et les factures de régularisation dans Pennylane ; MATRICE les importe et les affiche.
--  1. pennylane_avoirs (table NOUVELLE) : un avoir par identifiant Pennylane (aucun doublon), rattaché à la ligne de facturation dont
--     la facture d'ORIGINE a cet identifiant Pennylane ; lien ambigu → « À rattacher » (etat = 'a_rattacher', motif). Écriture par la
--     seule fonction serveur « pennylane » (clé de service) ; lecture équipe. Un avoir disparu de Pennylane est gardé (gone_at).
--     pennylane_virements (table NOUVELLE) : virements rapprochés déjà comptés comme encaissement (jamais deux fois).
--  2. avoir_couvert(paiement) : montant HT couvert par les avoirs rattachés (même règle : js/calc.js avoirCouvert).
--  3. reminder_candidates : RÉÉCRITE ENTIÈREMENT (CONVENTIONS §7.5) = texte de production relevé le 26/11/2026 (corps identique à
--     supabase/migrations/2026-11-10_v1.61.1_solde_prevu.sql, empreinte du corps b713325bb648651b08d35b402795a39f) + la colonne
--     « soldee » : une facture soldée par ses avoirs (montant > 0, au moins un avoir, entièrement couvert) ne donne plus
--     « Facture à envoyer » ni « Paiement à vérifier ».
-- Aucun encaissement, aucun remboursement n'est créé ; aucune donnée existante n'est modifiée ; aucun appel à Pennylane.
-- Retour arrière : réappliquer reminder_candidates de la v1.61.1 ; drop function public.avoir_couvert(uuid) ; la table est gardée.
-- Rejouable (if not exists / create or replace).
begin;

create table if not exists public.pennylane_avoirs (
  id uuid primary key default gen_random_uuid(),
  pennylane_id text not null unique,                 -- identifiant Pennylane de l'avoir : clé d'import, jamais de doublon
  invoice_number text,
  invoice_date date,
  amount_ht numeric(12,2) not null check (amount_ht >= 0),   -- montant couvert, toujours positif (signe Pennylane ignoré)
  amount_ttc numeric(12,2),
  credited_pennylane_id text,                        -- facture d'origine selon Pennylane (null : non indiquée)
  credited_invoice_number text,
  rattache_origine text,                             -- facture d'origine au moment du rattachement : écart signalé tant que Pennylane en indique une autre
  etat text not null default 'a_rattacher' check (etat in ('rattache', 'a_rattacher')),
  payment_id uuid references public.show_payments(id) on delete restrict,
  show_id uuid references public.shows(id) on delete restrict,
  reason text,                                       -- motif d'un avoir « À rattacher »
  pl_status text,
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,                               -- plus dans Pennylane : gardé, hors calcul
  constraint pennylane_avoirs_etat_ligne check ((etat = 'rattache') = (payment_id is not null))
);
alter table public.pennylane_avoirs add column if not exists rattache_origine text;   -- rejouable sur une base qui aurait déjà la v1.69.0
create index if not exists pennylane_avoirs_payment on public.pennylane_avoirs (payment_id);
create index if not exists pennylane_avoirs_show on public.pennylane_avoirs (show_id);
comment on table public.pennylane_avoirs is 'v1.69 (L1, point 02) : avoirs importés de Pennylane, rattachés à la facture d''origine ; aucun encaissement ni remboursement';
alter table public.pennylane_avoirs enable row level security;
drop policy if exists team_read on public.pennylane_avoirs;
create policy team_read on public.pennylane_avoirs for select to authenticated using (public.is_team());   -- écriture : fonction pennylane
revoke all on public.pennylane_avoirs from anon;
revoke insert, update, delete on public.pennylane_avoirs from authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pennylane_avoirs') then
    alter publication supabase_realtime add table public.pennylane_avoirs;
  end if;
end $$;

-- virements Pennylane déjà comptés comme encaissement d'une ligne (décision d'Anthony du 26/11/2026, 17 h 21) : un même virement
-- n'est jamais compté deux fois ; écriture par la seule fonction serveur « pennylane »
create table if not exists public.pennylane_virements (
  id bigint generated always as identity primary key,
  transaction_id text not null unique,
  payment_id uuid not null references public.show_payments(id) on delete restrict,
  pennylane_invoice_id text,
  amount numeric(12,2),
  tx_date date,
  origine text not null default 'synchronisation' check (origine in ('synchronisation', 'historique')),   -- historique : virement d'un paiement noté avant L1, réservé pour sa ligne
  counted_at timestamptz not null default now()
);
alter table public.pennylane_virements add column if not exists origine text not null default 'synchronisation';
create index if not exists pennylane_virements_payment on public.pennylane_virements (payment_id);
comment on table public.pennylane_virements is 'v1.69 (L1, point 02) : virements rapprochés déjà comptés comme encaissement d''une ligne (jamais deux fois)';
alter table public.pennylane_virements enable row level security;
drop policy if exists team_read on public.pennylane_virements;
create policy team_read on public.pennylane_virements for select to authenticated using (public.is_team());
revoke all on public.pennylane_virements from anon;
revoke insert, update, delete on public.pennylane_virements from authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pennylane_virements') then
    alter publication supabase_realtime add table public.pennylane_virements;
  end if;
end $$;

-- montant HT couvert par les avoirs rattachés (non disparus) d'une ligne — même règle : js/calc.js avoirCouvert
create or replace function public.avoir_couvert(p_payment uuid) returns numeric
 language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(a.amount_ht), 0) from public.pennylane_avoirs a
   where a.payment_id = p_payment and a.etat = 'rattache' and a.gone_at is null
$$;
-- utilisée seulement à l'intérieur de reminder_candidates (security definer) : aucun appel direct (relecture v1.69)
revoke all on function public.avoir_couvert(uuid) from public, anon, authenticated;

-- reminder_candidates : garde — corps de production attendu (ou déjà la v1.69), sinon arrêt sans rien appliquer
do $m$
declare b text := (select prosrc from pg_proc where oid = 'public.reminder_candidates(uuid, boolean)'::regprocedure);
begin
  if md5(b) <> 'b713325bb648651b08d35b402795a39f' and position('v1.69 (L1, point 02)' in b) = 0 then
    raise exception 'v1.69 : reminder_candidates n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
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
      (select min(x.paid_at) from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind in ('acompte', 'solde')) cashed
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival')
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
$function$;

commit;
