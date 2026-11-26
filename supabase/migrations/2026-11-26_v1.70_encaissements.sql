-- v1.70 — L2a du point 02 « Encaissements et remboursements » (décisions d'Anthony du 26/11/2026, 18 h 47 : D10, E1 à E4, R1, R2).
--  1. reglements (table NOUVELLE) : encaissements et remboursements RÉELS d'une ligne de facturation, en TTC (base du rapprochement
--     bancaire, E2), un par mouvement : date, montant, compte, référence, source (« manuel » ou « pennylane ») et identifiant du virement
--     Pennylane quand il est rapproché (unique : jamais compté deux fois). Remboursement « à faire » (intention : montant, motif) puis
--     « fait » (date, compte, référence). Jamais effacé : une saisie manuelle non rapprochée s'annule avec un motif (R2, traçable).
--     Écriture : fonctions reglement_saisir / reglement_effectuer / reglement_annuler (équipe) et fonction serveur « pennylane ».
--  2. Paiements historiques (E1) : AUCUNE ligne créée, aucune date ni montant réécrits ; un paiement noté avant L2a reste lu tel quel
--     (sa date « Payée », le montant de la ligne) par l'application, sans écriture.
--  3. reminder_candidates : RÉÉCRITE ENTIÈREMENT (CONVENTIONS §7.5) = texte de production v1.69 (empreinte du corps
--     37b36adf92cc516bfe3dc751216d170a) + le premier encaissement (commission à virer, Q14) tient compte d'un encaissement partiel
--     enregistré (même règle : js/reminders.js).
-- Aucune donnée existante n'est modifiée ; aucun appel à Pennylane.
-- Retour arrière : réappliquer reminder_candidates de la v1.69 ; drop des trois fonctions ; la table est gardée (historique).
-- Rejouable (if not exists / create or replace).
begin;

create table if not exists public.reglements (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.show_payments(id) on delete restrict,
  show_id uuid not null references public.shows(id) on delete restrict,
  sens text not null check (sens in ('encaissement', 'remboursement')),
  etat text not null default 'fait' check (etat in ('a_faire', 'fait')),
  montant_ttc numeric(12,2) not null check (montant_ttc > 0 and montant_ttc < 100000000),
  date date,                                          -- date du mouvement (obligatoire quand il est fait)
  compte text check (compte in ('compte', 'artbo', 'artiste', 'autre')),   -- mêmes valeurs que show_payments.payee (§6.6)
  reference text,
  motif text,
  source text not null check (source in ('manuel', 'pennylane')),
  transaction_id text unique,                         -- virement Pennylane rapproché : jamais compté deux fois (R1)
  avoir_id uuid references public.pennylane_avoirs(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text,
  rapproche_at timestamptz,
  annule_at timestamptz, annule_par text, annule_motif text,
  constraint reglements_fait_date check (etat <> 'fait' or date is not null),
  constraint reglements_a_faire check (etat <> 'a_faire' or (sens = 'remboursement' and transaction_id is null)),
  constraint reglements_pennylane check (source <> 'pennylane' or transaction_id is not null),
  constraint reglements_annule check ((annule_at is null) = (annule_motif is null))
);
create index if not exists reglements_payment on public.reglements (payment_id);
create index if not exists reglements_show on public.reglements (show_id);
comment on table public.reglements is 'v1.70 (L2a) : encaissements et remboursements réels en TTC, un par mouvement ; jamais effacés (annulation motivée) ; un virement Pennylane jamais compté deux fois';
alter table public.reglements enable row level security;
drop policy if exists team_read on public.reglements;
create policy team_read on public.reglements for select to authenticated using (public.is_team());
revoke all on public.reglements from anon;
revoke insert, update, delete on public.reglements from authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reglements') then
    alter publication supabase_realtime add table public.reglements;
  end if;
end $$;

-- saisie manuelle (équipe) : encaissement fait, remboursement à faire ou fait ; ligne émise, suivie, non hors calcul ;
-- jamais une commission de production (pas une facture)
create or replace function public.reglement_saisir(p_payment uuid, p_sens text, p_etat text, p_montant numeric, p_date date,
  p_compte text, p_reference text, p_motif text) returns public.reglements
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare p public.show_payments; s public.shows; r public.reglements;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  select * into p from public.show_payments where id = p_payment;
  if not found then raise exception 'Ligne de facturation introuvable'; end if;
  select * into s from public.shows where id = p.show_id;
  if p.hors_calcul is not null then raise exception 'Ligne hors calcul : aucun encaissement ni remboursement'; end if;
  if not ((coalesce(s.prod_mode, 'production') <> 'booking' and p.kind in ('acompte', 'solde', 'autre')) or (s.prod_mode = 'booking' and p.kind = 'artbo')) then
    raise exception 'Cette ligne n''est pas une facture suivie (encaissements : acompte, solde, autre ligne ; en booking, la commission)';
  end if;
  if not public.payment_is_emitted(p) then raise exception 'Facture pas encore émise : rien à encaisser ni à rembourser'; end if;
  if p_sens not in ('encaissement', 'remboursement') or p_etat not in ('a_faire', 'fait') or (p_etat = 'a_faire' and p_sens <> 'remboursement') then
    raise exception 'Type de mouvement invalide'; end if;
  if p_montant is null or p_montant = 'NaN'::numeric or p_montant <= 0 or p_montant >= 100000000 then raise exception 'Montant TTC à saisir (positif)'; end if;
  if p_etat = 'fait' and p_date is null then raise exception 'Date du mouvement à saisir'; end if;
  if p_compte is not null and p_compte not in ('compte', 'artbo', 'artiste', 'autre') then raise exception 'Compte inconnu'; end if;
  insert into public.reglements (payment_id, show_id, sens, etat, montant_ttc, date, compte, reference, motif, source, created_by)
  values (p.id, p.show_id, p_sens, p_etat, round(p_montant, 2), case when p_etat = 'fait' then p_date end, p_compte,
          nullif(btrim(p_reference), ''), nullif(btrim(p_motif), ''), 'manuel', auth.jwt() ->> 'email')
  returning * into r;
  return r;
end $$;
revoke all on function public.reglement_saisir(uuid, text, text, numeric, date, text, text, text) from public, anon;
grant execute on function public.reglement_saisir(uuid, text, text, numeric, date, text, text, text) to authenticated;

-- remboursement à faire → fait (date, compte, référence)
create or replace function public.reglement_effectuer(p_id uuid, p_date date, p_compte text, p_reference text) returns public.reglements
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.reglements;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if p_date is null then raise exception 'Date du remboursement à saisir'; end if;
  if p_compte is not null and p_compte not in ('compte', 'artbo', 'artiste', 'autre') then raise exception 'Compte inconnu'; end if;
  update public.reglements set etat = 'fait', date = p_date, compte = coalesce(p_compte, compte), reference = coalesce(nullif(btrim(p_reference), ''), reference)
   where id = p_id and etat = 'a_faire' and annule_at is null returning * into r;
  if not found then raise exception 'Remboursement introuvable, déjà fait ou annulé'; end if;
  return r;
end $$;
revoke all on function public.reglement_effectuer(uuid, date, text, text) from public, anon;
grant execute on function public.reglement_effectuer(uuid, date, text, text) to authenticated;

-- annulation d'une saisie MANUELLE non rapprochée, avec motif ; jamais effacée (R2)
create or replace function public.reglement_annuler(p_id uuid, p_motif text) returns public.reglements
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.reglements;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if nullif(btrim(p_motif), '') is null or length(btrim(p_motif)) > 500 then raise exception 'Motif obligatoire (500 caractères au plus)'; end if;
  update public.reglements set annule_at = now(), annule_par = auth.jwt() ->> 'email', annule_motif = btrim(p_motif)
   where id = p_id and source = 'manuel' and transaction_id is null and annule_at is null returning * into r;
  if not found then raise exception 'Seule une saisie manuelle non rapprochée de Pennylane, pas encore annulée, peut être annulée'; end if;
  return r;
end $$;
revoke all on function public.reglement_annuler(uuid, text) from public, anon;
grant execute on function public.reglement_annuler(uuid, text) to authenticated;

-- reminder_candidates : garde — corps de production v1.69 attendu (ou déjà la v1.70), sinon arrêt sans rien appliquer
do $m$
declare b text := (select prosrc from pg_proc where oid = 'public.reminder_candidates(uuid, boolean)'::regprocedure);
begin
  if md5(b) <> '37b36adf92cc516bfe3dc751216d170a' and position('v1.70 (L2a)' in b) = 0 then
    raise exception 'v1.70 : reminder_candidates n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
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
      -- v1.70 (L2a) : encaissement partiel enregistré (reglements) compris — même règle : js/reminders.js (premierEncaissement)
      least((select min(x.paid_at) from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind in ('acompte', 'solde')),
            (select min(r.date) from reglements r join show_payments x on x.id = r.payment_id where r.show_id = sh.id and x.hors_calcul is null
               and x.kind in ('acompte', 'solde') and r.sens = 'encaissement' and r.etat = 'fait' and r.annule_at is null)) cashed
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
