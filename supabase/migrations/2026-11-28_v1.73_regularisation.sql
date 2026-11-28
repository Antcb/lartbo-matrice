-- v1.73 — L4 du point 02 « Suivi des régularisations » (décisions d'Anthony du 28/11/2026, 16 h 46).
--  Fiche d'annulation (cession) : pour chaque rubrique, prévu / fait / reste — facturation et avoirs (HT), encaissement et remboursements
--  (TTC, établi seulement si toutes les lignes ont la TVA de la date) : annulation_suivi, même calcul que js/annulation-regles.js
--  suiviRegularisation. Un avoir rattaché ne vaut jamais remboursement ; une saisie « à faire » ne compte pas comme remboursée.
--  1. Clôture manuelle (annulation_cloturer) : la base revérifie les conditions ; auteur et date dans l'historique.
--  2. Avenant signé (case + lien, annulation_avenant) requis, sauf annulation sans frais sans facture émise ; justificatif inchangé.
--  3. Commission « à revoir », ou non due mais déjà facturée ou versée : bloque (motif affiché) ; traitement en L5.
--  4. Dépenses dues : ne bloquent pas.  5. Remboursement fait non rapproché : suffit (date, compte, référence).
--  6. Mouvement après clôture qui fait réapparaître un reste ou rend une condition incertaine : dossier rouvert automatiquement
--     (annulation_verifier_cloture, déclencheurs sur factures, encaissements / remboursements, avoirs, versements de commission ; cause
--     dans l'historique) ; une synchronisation sans effet sur les conditions ne rouvre rien.
--  7. Rappels « Avoir à émettre » et « Remboursement à faire » (reminder_candidates, même règle : js/reminders.js).
-- Aucun avoir, aucun remboursement, aucun document créé. Aucune donnée existante modifiée. Rejouable.
-- Retour arrière : réappliquer reminder_candidates et annulation_corriger de la v1.72 ; drop des déclencheurs et fonctions v1.73 ;
-- colonnes gardées.
begin;

-- gardes : v1.72 en place (table annulations avec origine) ; corps de production attendus, sinon arrêt sans rien appliquer
do $g$
declare rc text := (select prosrc from pg_proc where oid = 'public.reminder_candidates(uuid, boolean)'::regprocedure);
        co text := (select prosrc from pg_proc where oid = 'public.annulation_corriger(uuid, numeric, text, date, text, text, text, text, text)'::regprocedure);
begin
  if to_regclass('public.annulations') is null or not exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name = 'annulations' and column_name = 'origine') then
    raise exception 'v1.73 : la v1.72 (fiche d''annulation avec origine) n''est pas en place : migration arrêtée, rien n''est appliqué';
  end if;
  if md5(rc) <> '4104f175d8bd03dc9fc7fbae4823d273' and position('v1.73 (L4)' in rc) = 0 then
    raise exception 'v1.73 : reminder_candidates n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(rc);
  end if;
  if md5(co) <> '6dffe80b33993abbe942630f1ac0d7c5' and position('v1.73 (L4)' in co) = 0 then
    raise exception 'v1.73 : annulation_corriger n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(co);
  end if;
end $g$;

-- ─── fiche d'annulation : avenant, clôture, réouverture ─────────────────────────────────────────────────────────────────────
alter table public.annulations add column if not exists avenant_signe boolean not null default false;
alter table public.annulations add column if not exists avenant_lien text;
alter table public.annulations add column if not exists cloture_at timestamptz;
alter table public.annulations add column if not exists cloture_par text;
alter table public.annulations add column if not exists reouvert_at timestamptz;
alter table public.annulations add column if not exists reouvert_cause text;
alter table public.annulations drop constraint if exists annulations_avenant;
alter table public.annulations add constraint annulations_avenant check ((not avenant_signe or nullif(btrim(avenant_lien), '') is not null)
  and (avenant_lien is null or length(avenant_lien) <= 1000));
comment on column public.annulations.cloture_at is 'v1.73 (L4) : dossier « Régularisé » (clôture manuelle revérifiée par la base, annulation_cloturer) ; vidé à la réouverture automatique';
alter table public.annulations_journal drop constraint if exists annulations_journal_action_check;
alter table public.annulations_journal add constraint annulations_journal_action_check
  check (action in ('annuler', 'corriger', 'retablir', 'avenant', 'cloturer', 'rouvrir'));

-- ─── suivi des régularisations (même calcul : js/annulation-regles.js suiviRegularisation, js/calc.js etatAnnulation) ───────
create or replace function public.annulation_suivi(p_show uuid) returns jsonb
 language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare a public.annulations; s public.shows; p public.show_payments; c public.show_payments;
        tva numeric; uni boolean := true; brut numeric := 0; avo numeric := 0; enc_ht numeric := 0; enc_ttc numeric := 0; remb_fait numeric := 0;
        remb_afaire numeric := 0; emise boolean := false; m numeric; du numeric; du_ttc numeric; net numeric; arat int;
        r_fact numeric; r_avoir numeric; att_ht numeric; att_ttc numeric; remb_ht numeric; remb_ttc numeric; versee boolean;
        bl jsonb := '[]'::jsonb; dispense boolean; tol constant numeric := 0.01;
begin
  select * into a from public.annulations x where x.show_id = p_show and x.retablie_at is null;
  if not found then return null; end if;
  if a.regime <> 'cession' or a.montant_du_ht is null then
    return jsonb_build_object('cession', false, 'pret', false, 'blocages', jsonb_build_array(jsonb_build_object('code', 'regime')));
  end if;
  select * into s from public.shows where id = p_show;
  tva := coalesce(s.vat_rate, 5.5); du := a.montant_du_ht; du_ttc := round(du * (1 + tva / 100), 2);
  for p in select * from public.show_payments x where x.show_id = p_show and x.hors_calcul is null and x.kind in ('acompte', 'solde', 'autre') loop
    if public.annulation_tva(p) <> tva then uni := false; end if;
    if public.payment_is_emitted(p) then
      emise := true; m := greatest(0, coalesce(public.payment_amount_now(p), 0));
      brut := brut + m; avo := avo + least(public.avoir_couvert(p.id), m);
    end if;
    enc_ht := enc_ht + public.annulation_encaisse_ht(p);
    -- encaissé net TTC : mouvements faits (± remboursements faits), sinon paiement historique au TTC de la facture (même règle : mouvementsOf)
    enc_ttc := enc_ttc + coalesce((select sum(case when r.sens = 'encaissement' then r.montant_ttc else -r.montant_ttc end) from public.reglements r
                                    where r.payment_id = p.id and r.etat = 'fait' and r.annule_at is null), 0)
      + case when p.paid_at is not null and not exists (select 1 from public.reglements r where r.payment_id = p.id and r.etat = 'fait' and r.annule_at is null
               and r.sens = 'encaissement') then round(coalesce(public.payment_amount_now(p), 0) * (1 + public.annulation_tva(p) / 100), 2) else 0 end;
    remb_fait := remb_fait + coalesce((select sum(r.montant_ttc) from public.reglements r where r.payment_id = p.id and r.sens = 'remboursement'
                                        and r.etat = 'fait' and r.annule_at is null), 0);
    remb_afaire := remb_afaire + coalesce((select sum(r.montant_ttc) from public.reglements r where r.payment_id = p.id and r.sens = 'remboursement'
                                          and r.etat = 'a_faire' and r.annule_at is null), 0);
  end loop;
  brut := round(brut, 2); avo := round(avo, 2); net := round(brut - avo, 2); enc_ht := round(enc_ht, 2); enc_ttc := round(enc_ttc, 2);
  r_fact := greatest(0, round(du - net, 2)); r_avoir := greatest(0, round(net - du, 2));
  att_ht := greatest(0, round(du - enc_ht, 2)); remb_ht := greatest(0, round(enc_ht - du, 2));
  att_ttc := case when uni then greatest(0, round(du_ttc - enc_ttc, 2)) end; remb_ttc := case when uni then greatest(0, round(enc_ttc - du_ttc, 2)) end;
  if r_fact > tol then bl := bl || jsonb_build_object('code', 'facturation'); end if;
  if r_avoir > tol then bl := bl || jsonb_build_object('code', 'avoir'); end if;
  if coalesce(att_ttc, att_ht) > tol then bl := bl || jsonb_build_object('code', 'encaissement'); end if;
  if coalesce(remb_ttc, remb_ht) > tol then bl := bl || jsonb_build_object('code', 'remboursement'); end if;
  select count(*) into arat from public.pennylane_avoirs x where x.show_id = p_show and x.etat = 'a_rattacher' and x.gone_at is null;
  if arat > 0 then bl := bl || jsonb_build_object('code', 'a_rattacher'); end if;
  dispense := du <= tol and not emise;
  if not dispense and not (a.avenant_signe and nullif(btrim(a.avenant_lien), '') is not null) then bl := bl || jsonb_build_object('code', 'avenant'); end if;
  select * into c from public.show_payments x where x.show_id = p_show and x.hors_calcul is null and x.kind = 'artbo' order by x.sort limit 1;
  if found then
    versee := c.paid_at is not null or coalesce((select sum(t.amount) from public.commission_transfers t where t.payment_id = c.id), 0) > 0.005;
    if a.commission <> 'non_due' or versee then bl := bl || jsonb_build_object('code', 'commission'); end if;
  end if;
  return jsonb_build_object('cession', true, 'du', du, 'du_ttc', case when uni then du_ttc end, 'tva_uniforme', uni, 'facture_brut_ht', brut, 'avoirs_ht', avo,
    'facture_net_ht', net, 'encaisse_ht', enc_ht, 'encaisse_ttc', enc_ttc, 'rembourse_ttc', round(remb_fait, 2), 'remboursement_a_faire_ttc', round(remb_afaire, 2),
    'reste_facturer_ht', r_fact, 'avoir_reste_ht', r_avoir, 'attendu_ht', att_ht, 'attendu_ttc', att_ttc, 'rembourser_ht', remb_ht, 'rembourser_ttc', remb_ttc,
    'avoirs_a_rattacher', arat, 'avenant_dispense', dispense, 'blocages', bl, 'pret', jsonb_array_length(bl) = 0);
end $$;
-- interne (clôture, réouverture, rappels) : l'application calcule de son côté
revoke all on function public.annulation_suivi(uuid) from public, anon, authenticated;

create or replace function public.annulation_motifs(v jsonb) returns text
 language sql immutable set search_path = public, pg_temp
as $$
  select string_agg(case b ->> 'code' when 'regime' then 'cession seulement (booking : L5 ; coproduction, coréalisation : L8)'
    when 'facturation' then 'reste à facturer' when 'avoir' then 'avoir à émettre' when 'encaissement' then 'reste à encaisser'
    when 'remboursement' then 'reste à rembourser' when 'a_rattacher' then 'avoir importé à rattacher sur la date'
    when 'avenant' then 'avenant signé à renseigner' when 'commission' then 'commission à revoir ou à régulariser (L5)' else b ->> 'code' end, ' ; ')
  from jsonb_array_elements(coalesce(v -> 'blocages', '[]'::jsonb)) b
$$;
revoke all on function public.annulation_motifs(jsonb) from public, anon, authenticated;

-- réouverture automatique (décision 6) : dossier régularisé dont une condition n'est plus remplie → « À régulariser », cause dans l'historique
create or replace function public.annulation_verifier_cloture(p_show uuid, p_cause text) returns void
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; v jsonb; cause text;
begin
  select * into a from public.annulations x where x.show_id = p_show and x.retablie_at is null and x.cloture_at is not null for update;
  if not found then return; end if;
  v := public.annulation_suivi(p_show);
  if coalesce((v ->> 'pret')::boolean, false) then return; end if;
  cause := left(coalesce(p_cause, 'Mouvement') || ' : ' || coalesce(public.annulation_motifs(v), 'condition non vérifiable'), 1000);
  update public.annulations set cloture_at = null, cloture_par = null, reouvert_at = now(), reouvert_cause = cause where id = a.id;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'rouvrir', jsonb_build_object('cloture_at', a.cloture_at, 'cloture_par', a.cloture_par), v, cause,
    coalesce(auth.jwt() ->> 'email', 'automatique'));
end $$;
revoke all on function public.annulation_verifier_cloture(uuid, text) from public, anon, authenticated;

create or replace function public.annulation_mouvement_trg() returns trigger
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare ids uuid[]; i uuid; cause text;
begin
  -- opérations de l'annulation elle-même (annuler, corriger, rétablir) : vérifiées par leur fonction, à la fin
  if coalesce(current_setting('matrice.annulation', true), '') = 'on' then return null; end if;
  if tg_table_name = 'show_payments' then ids := array[new.show_id, old.show_id]; cause := 'Facture modifiée';
  elsif tg_table_name = 'reglements' then ids := array[new.show_id, old.show_id]; cause := 'Encaissement ou remboursement modifié';
  elsif tg_table_name = 'pennylane_avoirs' then
    ids := array[new.show_id, old.show_id, (select x.show_id from public.show_payments x where x.id = new.payment_id),
                 (select x.show_id from public.show_payments x where x.id = old.payment_id)]; cause := 'Avoir modifié';
  else ids := array[(select x.show_id from public.show_payments x where x.id = new.payment_id), (select x.show_id from public.show_payments x where x.id = old.payment_id)];
    cause := 'Versement de commission modifié';
  end if;
  for i in select distinct u from unnest(ids) u where u is not null loop
    if exists (select 1 from public.annulations x where x.show_id = i and x.retablie_at is null and x.cloture_at is not null) then
      perform public.annulation_verifier_cloture(i, cause);
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.annulation_mouvement_trg() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['show_payments', 'reglements', 'pennylane_avoirs', 'commission_transfers'] loop
    execute format('drop trigger if exists annulation_mouvement on public.%I', t);
    execute format('create trigger annulation_mouvement after insert or update or delete on public.%I for each row execute function public.annulation_mouvement_trg()', t);
  end loop;
end $$;

-- ─── fonctions de l'équipe ──────────────────────────────────────────────────────────────────────────────────────────────────
-- avenant signé (décision 2) : case + lien ; décocher rouvre un dossier régularisé qui en a besoin
create or replace function public.annulation_avenant(p_id uuid, p_signe boolean, p_lien text) returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; n public.annulations; l text := nullif(btrim(p_lien), '');
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  if p_signe is null then raise exception 'Indique si l''avenant est signé'; end if;
  if p_signe and l is null then raise exception 'Lien vers l''avenant signé obligatoire'; end if;
  if length(l) > 1000 then raise exception 'Lien : 1 000 caractères au plus'; end if;
  select * into a from public.annulations where id = p_id and retablie_at is null for update;
  if not found then raise exception 'Fiche d''annulation introuvable ou rétablie'; end if;
  update public.annulations set avenant_signe = p_signe, avenant_lien = l where id = a.id returning * into n;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'avenant', jsonb_build_object('avenant_signe', a.avenant_signe, 'avenant_lien', a.avenant_lien),
    jsonb_build_object('avenant_signe', n.avenant_signe, 'avenant_lien', n.avenant_lien), null, auth.jwt() ->> 'email');
  perform public.annulation_verifier_cloture(a.show_id, 'Avenant modifié');
  select * into n from public.annulations where id = a.id;
  return n;
end $$;

-- clôture manuelle (décision 1) : la base revérifie les conditions ; auteur et date dans l'historique
create or replace function public.annulation_cloturer(p_id uuid) returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; n public.annulations; v jsonb;
begin
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  select * into a from public.annulations where id = p_id and retablie_at is null for update;
  if not found then raise exception 'Fiche d''annulation introuvable ou rétablie'; end if;
  perform 1 from public.shows where id = a.show_id for update;
  if a.cloture_at is not null then raise exception 'Dossier déjà régularisé'; end if;
  v := public.annulation_suivi(a.show_id);
  if not coalesce((v ->> 'pret')::boolean, false) then
    raise exception 'Clôture impossible : %', public.annulation_motifs(v) using errcode = 'P0001';
  end if;
  update public.annulations set cloture_at = now(), cloture_par = auth.jwt() ->> 'email', reouvert_at = null, reouvert_cause = null
   where id = a.id returning * into n;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'cloturer', jsonb_build_object('reouvert_at', a.reouvert_at, 'reouvert_cause', a.reouvert_cause), v, null, auth.jwt() ->> 'email');
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.annulation_avenant(uuid, boolean, text)', 'public.annulation_cloturer(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- annulation_corriger : identique à la v1.72, plus la vérification de la clôture à la fin — v1.73 (L4)
create or replace function public.annulation_corriger(p_id uuid, p_montant numeric, p_motif text, p_decide_le date, p_justificatif text, p_motif_correction text,
  p_origine text default null, p_commission text default null, p_origine_precision text default null)
 returns public.annulations
 language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.annulations; n public.annulations; m text := nullif(btrim(p_motif), ''); mc text := nullif(btrim(p_motif_correction), '');
        j text := nullif(btrim(p_justificatif), ''); res jsonb; gardees jsonb; op text := nullif(btrim(p_origine_precision), '');
begin
  -- v1.73 (L4) : vérification de la clôture à la fin (annulation_verifier_cloture)
  if not public.is_team() then raise exception 'Accès refusé'; end if;
  -- v1.72.3 : origine et commission corrigibles (vides = inchangées) ; précision : remplacée telle que saisie
  if p_origine is not null and p_origine not in ('artiste', 'organisateur', 'commun', 'autre') then raise exception 'Indique qui est à l''origine de l''annulation (artiste, organisateur, décision commune ou autre)'; end if;
  if p_commission is not null and p_commission not in ('a_revoir', 'non_due') then raise exception 'Commission : « à revoir » ou « non due »'; end if;
  if length(op) > 500 then raise exception 'Précision sur l''origine : 500 caractères au plus'; end if;
  if mc is null or length(mc) > 1000 then raise exception 'Motif de la correction obligatoire (1 000 caractères au plus)'; end if;
  if m is null or length(m) > 1000 then raise exception 'Motif obligatoire (1 000 caractères au plus)'; end if;
  if p_decide_le is null then raise exception 'Date de la décision obligatoire'; end if;
  if length(j) > 1000 then raise exception 'Justificatif : 1 000 caractères au plus'; end if;
  select * into a from public.annulations where id = p_id and retablie_at is null for update;
  if not found then raise exception 'Fiche d''annulation introuvable ou rétablie'; end if;
  perform 1 from public.shows where id = a.show_id for update;
  if a.regime = 'cession' and (p_montant is null or p_montant = 'NaN'::numeric or p_montant < 0 or p_montant >= 100000000) then
    raise exception 'Montant total dû après annulation à saisir (HT, acompte compris ; 0 = sans frais)'; end if;
  if a.regime <> 'cession' and p_montant is not null then raise exception 'Pas de montant à saisir pour cette date (calcul hors de ce lot)'; end if;
  perform set_config('matrice.annulation', 'on', true);
  if a.regime = 'cession' then
    -- lignes émises depuis l'annulation : gardées telles quelles (leur plan d'origine reste dans la fiche) ; les autres sont recalculées
    select coalesce(jsonb_agg(e), '[]'::jsonb) into gardees from jsonb_array_elements(a.lignes) e
     where exists (select 1 from public.show_payments x where x.id = (e ->> 'payment_id')::uuid and public.payment_is_emitted(x));
    perform public.annulation_defaire(a);
    res := public.annulation_appliquer(a.show_id, round(p_montant, 2));
  end if;
  perform set_config('matrice.annulation', '', true);
  update public.annulations set montant_du_ht = case when a.regime = 'cession' then round(p_montant, 2) end, motif = m, decide_le = p_decide_le, justificatif = j,
    origine = coalesce(p_origine, a.origine), commission = coalesce(p_commission, a.commission), origine_precision = case when p_origine is null then a.origine_precision else op end,
    lignes = case when a.regime = 'cession' then gardees || coalesce(res -> 'plan', '[]'::jsonb) else a.lignes end,
    corrige_at = now(), corrige_par = auth.jwt() ->> 'email'
   where id = a.id returning * into n;
  update public.annulations set empreinte = public.annulation_empreinte(a.show_id) where id = a.id returning * into n;
  insert into public.annulations_journal (annulation_id, show_id, action, avant, apres, motif, auteur)
  values (a.id, a.show_id, 'corriger', jsonb_build_object('montant_du_ht', a.montant_du_ht, 'motif', a.motif, 'origine', a.origine, 'origine_precision', a.origine_precision,
      'commission', a.commission, 'decide_le', a.decide_le, 'justificatif', a.justificatif, 'lignes', a.lignes),
    jsonb_build_object('montant_du_ht', n.montant_du_ht, 'motif', n.motif, 'origine', n.origine, 'origine_precision', n.origine_precision,
      'commission', n.commission, 'decide_le', n.decide_le, 'justificatif', n.justificatif, 'lignes', n.lignes), mc, auth.jwt() ->> 'email');
  -- v1.73 (L4) : dossier régularisé dont la correction fait réapparaître un reste → rouvert (cause dans l'historique)
  perform public.annulation_verifier_cloture(a.show_id, 'Annulation corrigée');
  select * into n from public.annulations where id = a.id;
  return n;
end $$;


-- reminder_candidates : v1.72 + rappels de régularisation — v1.73 (L4)
create or replace function public.reminder_candidates(p_show uuid default null, p_all boolean default false)
 returns table (r text, show_id uuid, k text, raw date, w boolean, t text, venue text, proj text, date date, city text, nxt jsonb, reactiv text)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (
    -- v1.73 (L4) : rappels « Avoir à émettre » et « Remboursement à faire » (annulation_suivi)
    -- v1.72 (L3) : date annulée avec une fiche d'annulation (décisions du 28/11/2026, 12 h 08, 13 h 25 et 14 h 31), cession seulement :
    -- « Facture à faire » dès le jour de l'annulation pour chaque ligne recalculée non émise de montant positif (annulation_facture) ; « Facture à envoyer » tant que le facturé net ne dépasse pas
    -- le montant retenu (envoi_ok, annulation_depasse) ; impayé seulement si le montant réclamé ne dépasse pas ce qui reste dû
    -- (impaye_ok, annulation_relance_impaye) ; rien d'autre (lignes « ne doit plus être émise » exclues : f) — même règle : js/reminders.js
    select an.id is not null annule, (an.id is not null and an.regime = 'cession' and public.annulation_relance_impaye(sh.id)) impaye_ok,
      (an.id is not null and an.regime = 'cession' and not public.annulation_depasse(sh.id)) envoi_ok,
      an.regime an_regime, (an.created_at at time zone 'Europe/Paris')::date annul_le,   -- v1.72.3 : jour de l'annulation (Paris)
      -- v1.73 (L4) : suivi des régularisations (avoir à émettre, remboursement à faire) — même calcul : js/annulation-regles.js
      case when an.regime = 'cession' then public.annulation_suivi(sh.id) end suivi,
      sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
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
    left join annulations an on an.show_id = sh.id and an.retablie_at is null
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
    where (sh.status in ('Confirmée Salle','Confirmée Festival') or (sh.status = 'Annulée' and an.id is not null))
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
      coalesce(x.amount > 0 and public.avoir_couvert(x.id) > 0 and public.avoir_couvert(x.id) >= x.amount - 0.005, false) soldee,
      -- v1.72.3 : ligne recalculée d'une date annulée (cession), encore à émettre avec un montant positif
      (d.an_regime = 'cession' and x.annulation = 'recalculee' and not public.payment_is_emitted(x) and coalesce(public.payment_amount_now(x), 0) > 0.005) annul_a_faire,
      d.annul_le
    from show_payments x join d on d.id = x.show_id
    where x.hors_calcul is null and ((d.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (d.mode = 'booking' and x.kind = 'artbo'))
      and x.annulation is distinct from 'abandonnee'   -- v1.72 : ligne qui ne doit plus être émise, jamais relancée
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
    -- v1.72.3 (28/11/2026, 14 h 31) : date annulée — ligne recalculée à émettre, due dès le jour de l'annulation (solde ou non)
    union all select 'annulation_facture', show_id, show_id || ':' || id || ':' || annul_le, annul_le, false,
                     'Facture à faire (date annulée) : ' || nom from f where annul_a_faire
    -- v1.73 (L4, décision 7 du 28/11/2026, 16 h 46) : un rappel par type et par dossier, dû dès l'annulation, avec le montant restant ;
    -- l'avoir rattaché ne solde que le rappel d'avoir ; seul un remboursement FAIT réduit le reste à rembourser ; TTC non établi : « TTC à vérifier »
    union all select 'annulation_avoir', id, id || ':' || annul_le, annul_le, false,
                     'Avoir à émettre (date annulée) : ' || replace(to_char((suivi ->> 'avoir_reste_ht')::numeric, 'FM999999990.00'), '.', ',') || ' € HT'
                from d where suivi is not null and (suivi ->> 'avoir_reste_ht')::numeric > 0.01
    union all select 'annulation_remboursement', id, id || ':' || annul_le, annul_le, false,
                     'Remboursement à faire (date annulée) : ' || case when suivi ->> 'rembourser_ttc' is null then 'TTC à vérifier'
                       else replace(to_char((suivi ->> 'rembourser_ttc')::numeric, 'FM999999990.00'), '.', ',') || ' € TTC' end
                from d where suivi is not null and coalesce((suivi ->> 'rembourser_ttc')::numeric, (suivi ->> 'rembourser_ht')::numeric) > 0.01
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
   where not s.annule or (s.impaye_ok and c.r in ('acompte_paye', 'solde_paye', 'autre_payee'))
      or (s.envoi_ok and c.r = 'facture_envoi') or c.r in ('annulation_facture', 'annulation_avoir', 'annulation_remboursement')
$function$;


commit;
