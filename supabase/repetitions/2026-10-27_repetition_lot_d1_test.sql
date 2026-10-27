-- =====================================================================================================
-- RÉPÉTITION LOT D1 (v1.42) — UNIQUEMENT « Lartbo-matrice-test » (dthfocplfzzmkgaxhmwk) — SUR AUTORISATION
-- Dans UNE transaction annulée à la fin (erreur voulue « BILAN RÉPÉTITION LOT D1 … ») :
--   0. remet le test dans l'état de la production après C1 (corps de la répétition C1 déjà validée le 26/10) ;
--   1. déploiement D1 : corps IDENTIQUE au script de production + contrôles ;
--   2. essais sur des données FICTIVES créées dans la transaction (aucune donnée du test n'est touchée) ;
--   3. retour arrière : corps IDENTIQUE au script de production + contrôles ;  4. redéploiement ; puis TOUT est annulé.
-- Résultat attendu : « BILAN RÉPÉTITION LOT D1 : CONFORME (…). TOUT EST ANNULÉ. »
-- =====================================================================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $g$
begin
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%dthfocplfzzmkgaxhmwk%') then
    raise exception 'ARRET : l''adresse des fonctions n''est pas celle du projet de TEST — rien n''a été fait'; end if;
  if exists (select 1 from public.settings where value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : l''identifiant du projet de PRODUCTION est présent dans cette base — rien n''a été fait'; end if;
  if (select count(*) from public.shows) >= 200 then
    raise exception 'ARRET : 200 dates ou plus : ce n''est pas la base de test — rien n''a été fait'; end if;
  if coalesce(public.setting_text('drive_webhook_url'), '') <> '' then raise exception 'ARRET : drive_webhook_url renseigné — rien n''a été fait'; end if;
end $g$;

-- ===== 0. État de départ de la production, reproduit sur le test (annulé à la fin) =====
alter table public.shows add column if not exists prod_mode_manual boolean not null default false;
CREATE OR REPLACE FUNCTION public.project_mode_to_shows()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows set prod_mode = new.mode where project_id = new.id and not prod_mode_manual;
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.show_follow_project_mode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$;
drop trigger if exists project_mode_to_shows on public.projects;
drop trigger if exists show_follow_project_mode on public.shows;
create trigger project_mode_to_shows after update of mode on public.projects for each row execute function public.project_mode_to_shows();
create trigger show_follow_project_mode before update of project_id on public.shows for each row execute function public.show_follow_project_mode();
CREATE OR REPLACE FUNCTION public.generate_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
      sh.conf_kit_sent, sh.precontract_done, sh.contract_sent, sh.contract_signed, sh.contract_cosigned_sent, sh.boucle_tech, sh.boucle_com,
      a.id a_id, a.sent_at a_sent, a.paid_at a_paid, greatest(a.sent_at, a.reminded_at) a_last,
      so.id so_id, so.sent_at so_sent, so.paid_at so_paid, greatest(so.sent_at, so.reminded_at) so_last,
      c.id c_id, c.sent_at c_sent, c.paid_at c_paid, c.label c_label,
      pt.id pt_id, pt.sent_at pt_sent, pt.paid_at pt_paid, pt.label pt_label
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival') and (sh.date is null or sh.date >= current_date - 120)
  ), cand as (
    select 'precontrat' r, id, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_envoi', id, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_signe', id, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= current_date)
    union all select 'contrat_cosigne', id, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= current_date)
    union all select 'facture_acompte', id, contract_sent, false, 'Facture d''acompte à envoyer (contrat envoyé)' from s where mode <> 'booking' and contract_sent is not null and a_id is not null and a_sent is null
    union all select 'acompte_paye', id, a_last + 10, true, 'Paiement de l''acompte à vérifier' from s where mode <> 'booking' and a_sent is not null and a_paid is null
    union all select 'solde_paye', id, so_last + 10, true, 'Paiement du solde à vérifier' from s where mode <> 'booking' and so_sent is not null and so_paid is null
    union all select 'solde_envoi', id, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Envoyer la facture de solde' from s where mode <> 'booking' and date is not null and so_id is not null and so_sent is null and date >= current_date - 30
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_paid is null
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
do $fiche0$
declare d text := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
begin
  if position($$ 'prod_mode', coalesce(s.prod_mode, 'production'),$$ in d) > 0 then execute replace(d, $$ 'prod_mode', coalesce(s.prod_mode, 'production'),$$, ''); end if;
end $fiche0$;
do $g2$
begin
  -- VERSIONS DE DÉPART (relevées en production le 26/10/2026, lecture seule) : toute différence arrête tout
  if md5(pg_get_functiondef('public.fiche_get(text)'::regprocedure)) <> '7be275838458bffc9d9e326bcc839a8a' then raise exception 'ARRET : fiche_get n''est pas la version de départ attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.generate_reminders()'::regprocedure)) <> 'a0eb76e247d25a6f282dcbfcba35510e' then raise exception 'ARRET : generate_reminders n''est pas la version de départ attendue (v1.39) — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) <> 'ee8fe413cc80f7d5583da97d5847f615' then raise exception 'ARRET : project_mode_to_shows n''est pas la version de départ attendue — rien n''a été fait'; end if;
  if md5(pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) <> 'c3a835cb29b80e36c7db36a21cc8c2a2' then raise exception 'ARRET : show_follow_project_mode n''est pas la version de départ attendue — rien n''a été fait'; end if;
  if exists (select 1 from pg_trigger where tgname in ('show_payments_emitted_guard', 'show_payments_caduc_guard'))
     or to_regprocedure('public.show_payments_emitted_guard()') is not null or to_regprocedure('public.show_payments_caduc_guard()') is not null then
    raise exception 'ARRET : protections A1 / C1 déjà présentes — rien n''a été fait'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shows' and column_name = 'prod_mode_manual') <> 1
     or (select count(*) from pg_trigger where tgname in ('project_mode_to_shows', 'show_follow_project_mode') and not tgisinternal) <> 2
     or to_regprocedure('public.workday(date)') is null then
    raise exception 'ARRET : dépendances absentes (colonne prod_mode_manual, 2 déclencheurs de mode, workday) — rien n''a été fait'; end if;
end $g2$;
-- Instantané des données (empreintes complètes) : comparé à la fin, toute différence annule tout
create temp table _c1_instantane on commit drop as
select (select count(*) from public.show_payments) n_lignes, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.show_payments t) lignes,
       (select count(*) from public.shows) n_dates, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t) dates,
       (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t) artistes,
       (select count(*) from public.notifications) n_notifs;

-- ===== 1. Déploiement : corps identique au script de production =====
-- ===== Migration 1 : fiche organisateur (A2) — texte identique au fichier =====

-- v1.40.9 (V1-A lot A2) — PRÉPARÉE, NON APPLIQUÉE : à appliquer seulement sur autorisation explicite d'Anthony.
-- Fiche publique organisateur : le serveur transmet le mode de la date (« prod_mode » : booking | production).
-- Sur une date booking, la page (js/fiche.js) présente les conditions sous « Échéancier prévu au contrat »,
-- avec % et échéances, sans montant par ligne (décision d'Anthony du 25/10/2026, option A1). Production : inchangé.
-- La page reste compatible avec le serveur actuel : sans « prod_mode », elle s'affiche comme aujourd'hui.
-- Seul changement : une clé ajoutée au résultat de fiche_get. Aucune donnée modifiée, aucune suppression, droits inchangés
-- (create or replace garde les droits existants). Texte de départ relevé en production le 25/10/2026
-- (md5 de pg_get_functiondef = 7be275838458bffc9d9e326bcc839a8a, pour information : le script ne le vérifie pas,
-- il s'arrête si le passage attendu n'est pas dans la fonction).
-- Retour arrière : réexécuter la même opération en retirant « 'prod_mode', coalesce(s.prod_mode, 'production'), ».

do $mig$
declare d text := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
  avant constant text := '''status'', s.status, ''contract_type'', s.contract_type,';
begin
  if position('''prod_mode''' in d) > 0 then raise notice 'fiche_get transmet déjà prod_mode : rien à faire'; return; end if;
  if position(avant in d) = 0 then raise exception 'fiche_get ne correspond pas au texte attendu : migration arrêtée, rien n''est modifié'; end if;
  execute replace(d, avant, avant || ' ''prod_mode'', coalesce(s.prod_mode, ''production''),');
end $mig$;

-- contrôle : doit renvoyer true
select position('''prod_mode''' in pg_get_functiondef('public.fiche_get(text)'::regprocedure)) > 0 as fiche_transmet_le_mode;

-- ===== Migration 2 : factures émises protégées (A1 adaptée C1) — texte identique au fichier =====

-- v1.40.6 — Factures émises protégées CÔTÉ BASE (V1-A lot A1 ; CONVENTIONS §6.4 Q4, §6.7 Q10 ; décision d'Anthony du 24/10/2026).
-- Règle écrite deux fois (§8.4) : côté application js/calc.js (isInvoiced, EMITTED_FIELDS, changeBlocked).
-- Facture « émise » = date d'envoi, date de paiement, numéro ou identifiant Pennylane renseigné.
-- Exception (lot C1, décision d'Anthony du 26/10/2026, avant toute application) : la commission L'ArtBo d'une date en PRODUCTION
-- n'est pas une facture (L'ArtBo se la verse) : seule sa date de versement (paid_at) la fige ; un ancien numéro ne compte pas.
--
-- 1. Une facture émise ne se supprime pas (ni seule, ni avec sa date : la suppression en chaîne est refusée aussi),
--    ne change ni de montant, ni de %, ni de TVA, ni de date, ni de type, et aucun des champs qui la rendent émise
--    ne s'efface (pas de déverrouillage). Libellé, échéance, relance, compte d'encaissement, pièce, lien : modifiables.
-- 2. Le mode booking / production d'une date qui porte une facture émise ne change plus automatiquement
--    (changement de mode de l'artiste, changement d'artiste de la date). Le choix manuel reste contrôlé par l'application.
-- Aucune donnée existante n'est modifiée. Retour arrière : voir la fin du fichier.

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
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists show_payments_emitted_guard on public.show_payments;
create trigger show_payments_emitted_guard before update or delete on public.show_payments
  for each row execute function public.show_payments_emitted_guard();
revoke execute on function public.show_payments_emitted_guard() from public, anon, authenticated;   -- §7.3 (un déclencheur ne vérifie pas ce droit)

-- Mode de l'artiste changé : seules les dates non manuelles SANS facture émise suivent (§6.7).
-- Les deux fonctions de mode gardent exactement les attributs de leur version en production (relevés le 24/10/2026 :
-- plpgsql, sans SECURITY DEFINER ni search_path) ; seule la condition « not exists … » est ajoutée.
create or replace function public.project_mode_to_shows() returns trigger
language plpgsql as $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows s set prod_mode = new.mode
     where s.project_id = new.id and not s.prod_mode_manual
       and not exists (select 1 from public.show_payments p where p.show_id = s.id
                        and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(s.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                             or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null)));
  end if;
  return new;
end $function$;

-- Artiste de la date changé : le mode suit le nouvel artiste, sauf mode manuel ou facture émise sur la date (§6.7)
create or replace function public.show_follow_project_mode() returns trigger
language plpgsql as $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual
     and not exists (select 1 from public.show_payments p where p.show_id = new.id
                      and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(new.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                           or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))) then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$;

-- Retour arrière (aucune donnée concernée) :
--   drop trigger show_payments_emitted_guard on public.show_payments; drop function public.show_payments_emitted_guard();
--   puis recréer project_mode_to_shows et show_follow_project_mode dans leur version précédente
--   (texte relevé en production le 24/10/2026 avant application, sans la condition « not exists … »).

-- ===== Migration 3 : acompte caduc + verrou (C1) — texte identique au fichier =====

-- v1.41.4 (lot C1, décisions d'Anthony du 26/10/2026 : point 3, puis verrou contre la facturation simultanée) — PRÉPARÉE, NON APPLIQUÉE : répétition sur le projet de test,
-- puis application seulement sur autorisation explicite d'Anthony.
-- Acompte CADUC protégé CÔTÉ BASE : sur une date de PRODUCTION dont le solde est déjà facturé (envoyé, payé, numéroté ou lié à
-- Pennylane), un acompte jamais facturé ne peut plus le devenir — ni numéro, ni date d'envoi, ni date de paiement, ni lien Pennylane
-- (sinon la date serait facturée au-delà de sa cession). Une ligne d'acompte DÉJÀ émise n'est pas concernée (protégée par A1).
-- Une ligne d'acompte insérée déjà émise sur une telle date est refusée de la même façon.
-- Facturation SIMULTANÉE (décision d'Anthony du 26/10/2026) : chaque émission d'un acompte ou d'un solde prend un verrou
-- transactionnel propre à la date (pg_advisory_xact_lock) ; deux émissions de la même date se suivent au lieu de se croiser.
-- Garanti en READ COMMITTED (réglage de Supabase : application, synchronisation Pennylane, éditeur SQL) ; une transaction ouverte
-- à la main en REPEATABLE READ / SERIALIZABLE n'est pas couverte. Attente limitée par lock_timeout (8 s pour l'application).
-- Règle écrite deux fois (§8.4) : côté application js/calc.js (changeBlocked, acompteState) ; synchronisation Pennylane :
-- supabase/functions/pennylane/regles.ts (caduc : jamais relié).
-- À appliquer AVEC la migration A1 (2026-10-24_v1.40_factures_emises.sql), avant ou après elle : A1 empêche de contourner ce
-- déclencheur en déplaçant l'acompte vers une autre date (show_id) le temps de l'émettre.
-- Booking : non concerné (acomptes / soldes = factures de l'artiste, hors suivi de L'ArtBo).
-- Libellé, échéance, relance, compte, pièce, % et montant d'un acompte caduc : inchangés par ce déclencheur (historique conservé).
-- Aucune donnée existante n'est lue pour être modifiée ; aucune donnée modifiée. Au 26/10/2026 (lecture seule) : 0 acompte caduc
-- en production. Retour arrière : voir la fin du fichier.

create or replace function public.show_payments_caduc_guard() returns trigger
language plpgsql set search_path = public as $$   -- §7.3
begin
  if new.kind not in ('acompte', 'solde')
     or not (new.sent_at is not null or new.paid_at is not null
             or nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null) then
    return new;                                                     -- ni acompte ni solde émis : rien à contrôler
  end if;
  -- FACTURATION SIMULTANÉE : acompte et solde d'une même date émis dans deux transactions en même temps. Chaque émission
  -- d'acompte ou de solde prend un verrou propre à la date, gardé jusqu'à la fin de sa transaction : la seconde attend la
  -- première, puis (READ COMMITTED, réglage de Supabase) relit les lignes validées entre-temps et refuse l'acompte caduc.
  -- Verrou « conseil » : ne bloque ni la lecture, ni les autres dates, ni les autres colonnes / lignes de la date.
  perform pg_advisory_xact_lock(hashtext('show_payments_emission'), hashtext(new.show_id::text));
  if new.kind = 'solde' then
    return new;                                                     -- solde : seulement le verrou
  end if;
  if tg_op = 'UPDATE' and old.kind = 'acompte'
     and (old.sent_at is not null or old.paid_at is not null
          or nullif(btrim(old.invoice_number), '') is not null or nullif(btrim(old.pennylane_id), '') is not null) then
    return new;                                                     -- déjà émis avant : pas un acompte caduc (A1 le protège)
  end if;
  if exists (select 1 from public.shows s where s.id = new.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
     and exists (select 1 from public.show_payments so where so.show_id = new.show_id and so.kind = 'solde' and so.id <> new.id
                 and (so.sent_at is not null or so.paid_at is not null
                      or nullif(btrim(so.invoice_number), '') is not null or nullif(btrim(so.pennylane_id), '') is not null)) then
    raise exception 'Acompte caduc : le solde de cette date est déjà facturé, cet acompte ne se facture plus (il dépasserait la cession). Une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists show_payments_caduc_guard on public.show_payments;
create trigger show_payments_caduc_guard before insert or update on public.show_payments
  for each row execute function public.show_payments_caduc_guard();
revoke execute on function public.show_payments_caduc_guard() from public, anon, authenticated;   -- §7.3 (un déclencheur ne vérifie pas ce droit)

-- Retour arrière (aucune donnée concernée) :
--   drop trigger show_payments_caduc_guard on public.show_payments; drop function public.show_payments_caduc_guard();

-- ===== Migration 4 : relances C1 — texte identique au fichier =====

-- v1.41.0 (lot C1, décisions d'Anthony du 26/10/2026) — PRÉPARÉE, NON APPLIQUÉE : répétition sur le projet de test, puis
-- application seulement sur autorisation explicite d'Anthony.
-- Relances (generate_reminders), à partir de la v1.39 en production (texte identique, vérifié le 24/10/2026) :
--  * « Facture d'acompte à envoyer » ne part plus quand le SOLDE est déjà facturé (envoyé, payé, numéroté ou dans Pennylane) :
--    l'acompte jamais facturé est alors caduc (plus réclamé, historique conservé).
--  * Booking : inchangé — seule la facture de commission est relancée ; jamais d'acompte ni de solde (factures de l'artiste).
--    Remplace la migration « relances booking » (2026-10-24_v1.40_relances_booking.sql, gardée pour l'historique, marquée
--    ABANDONNÉE), jamais appliquée en production (appliquée seulement sur le projet de test, où cette version la remplace).
-- Règle écrite deux fois (§8.4) : côté application js/reminders.js (remindersOf, « Facture d'acompte à envoyer »).
-- Aucune donnée modifiée. Retour arrière : réappliquer la fonction de 2026-10-21_v1.39_relances_jour_ouvre.sql.

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
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_paid is null
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

do $ctl$
declare l uuid;
begin
  -- 1. versions installées : exactement celles répétées sur le projet de test
  if md5(pg_get_functiondef('public.fiche_get(text)'::regprocedure)) <> '18c6b88bcb0c9b56ed2062cd83ca338e' then raise exception 'ECHEC : fiche_get inattendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.generate_reminders()'::regprocedure)) <> '6f834c203fcdae7b7a02c06df4c1f81d' then raise exception 'ECHEC : relances inattendues — TOUT EST ANNULÉ'; end if;
  if position('not exists' in pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) = 0
     or position('not exists' in pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) = 0 then
    raise exception 'ECHEC : fonctions de mode non adaptées (A1) — TOUT EST ANNULÉ'; end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.show_payments'::regclass and t.tgname in ('show_payments_emitted_guard', 'show_payments_caduc_guard') and t.tgenabled = 'O') <> 2 then
    raise exception 'ECHEC : déclencheurs A1 / C1 absents ou désactivés — TOUT EST ANNULÉ'; end if;
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.show_payments_caduc_guard()'::regprocedure)) = 0 then
    raise exception 'ECHEC : verrou de facturation simultanée absent — TOUT EST ANNULÉ'; end if;
  -- 2. droits : rien d'exécutable par les visiteurs ni les comptes connectés
  if has_function_privilege('anon', 'public.show_payments_emitted_guard()', 'EXECUTE') or has_function_privilege('authenticated', 'public.show_payments_emitted_guard()', 'EXECUTE')
     or has_function_privilege('anon', 'public.show_payments_caduc_guard()', 'EXECUTE') or has_function_privilege('authenticated', 'public.show_payments_caduc_guard()', 'EXECUTE')
     or has_function_privilege('anon', 'public.generate_reminders()', 'EXECUTE') or has_function_privilege('authenticated', 'public.generate_reminders()', 'EXECUTE') then
    raise exception 'ECHEC : droits d''exécution trop larges — TOUT EST ANNULÉ'; end if;
  -- 3. protection A1 réellement active : modifier le montant d'une facture émise doit être refusé (rien n'est écrit)
  select p.id into l from public.show_payments p join public.shows s on s.id = p.show_id
   where p.kind in ('acompte', 'solde') and (p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null) limit 1;
  if l is not null then
    begin
      update public.show_payments set amount = coalesce(amount, 0) + 1 where id = l;
      raise exception using errcode = 'P0002', message = 'ECHEC : une facture émise a pu être modifiée — TOUT EST ANNULÉ';
    exception when sqlstate 'P0001' then null;   -- refus attendu
    end;
  end if;
  if (select (n_lignes, lignes, n_dates, dates, artistes, n_notifs) is distinct from
             ((select count(*) from public.show_payments), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.show_payments t),
              (select count(*) from public.shows), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t),
              (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t), (select count(*) from public.notifications))
       from _c1_instantane) then
    raise exception 'ECHEC : des données ont changé pendant l''opération — TOUT EST ANNULÉ'; end if;
end $ctl$;


-- ===== 0 bis. Versions de départ D1 (identiques à la production) =====
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
end $function$
;
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
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
        (new.id, 'solde', 'Solde', 100 - coalesce(setting_num('default_acompte_pct'), 20), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
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
end $function$
;
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
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde');
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type, 'prod_mode', coalesce(s.prod_mode, 'production'),
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break, 'show_time', s.show_time, 'set_length', s.set_length,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $function$
;
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
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  acpt := coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
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
end $function$
;
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

-- ===== 1. Déploiement D1 : corps identique au script de production =====
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

-- ===== 2. Essais (données fictives, annulées avec tout le reste) =====
create temp table _d1_r (n serial, essai text, attendu text, obtenu text) on commit drop;
create temp table _d1_ids (k text primary key, id uuid) on commit drop;
create temp table _d1_av (n_lignes bigint, lignes text, n_dates bigint, dates text, artistes text) on commit drop;
-- empreinte des données RÉELLES du test avant les essais (les données fictives sont exclues de la comparaison finale)
insert into _d1_av select (select count(*) from public.show_payments), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.show_payments t),
  (select count(*) from public.shows), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t),
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t);
do $t$
declare rw public.show_payments; pj uuid; sa uuid; sb uuid; sc uuid; ld uuid; la uuid; ls uuid; lc uuid; lp uuid; lb uuid; v numeric; t text;
begin
  -- Artiste et dates FICTIFS (cachet 10 000 €, commission 15 %, part partenaire 30 % de la commission, production)
  insert into public.projects (name, mode, active) values ('ESSAI D1 — annulé à la fin', 'production', false) returning id into pj;
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, partner_pct, prod_mode, vat_rate)
    values (pj, 'Salle Essai D1', current_date + 60, 10000, 15, 30, 'production', 5.5) returning id into sa;
  insert into public.shows (project_id, venue, date, prod_mode) values (pj, 'Salle Essai D1 historique', current_date + 61, 'production') returning id into sb;
  delete from public.show_payments where show_id in (sa, sb);   -- lignes créées automatiquement, jamais émises
  insert into public.show_payments (show_id, kind, label, pct, sort) values (sa, 'acompte', 'Acompte', 50, 10) returning id into la;
  insert into public.show_payments (show_id, kind, label, pct, sort) values (sa, 'solde', 'Solde', 50, 20) returning id into ls;
  insert into public.show_payments (show_id, kind, label, sort) values (sa, 'artbo', 'Commission', 30) returning id into lc;
  insert into public.show_payments (show_id, kind, label, sort) values (sa, 'partner', 'Part partenaire', 40) returning id into lp;
  insert into _d1_ids values ('pj', pj), ('sa', sa), ('sb', sb);

  insert into _d1_r (essai, attendu, obtenu) select '1. lignes pas encore émises : montant calculé (vide)', 'vide',
    case when (select count(*) from public.show_payments where show_id = sa and amount is null) = 4 then 'vide' else 'REMPLI' end;
  update public.show_payments set invoice_number = 'ESSAI-COM' where id = lc;
  insert into _d1_r (essai, attendu, obtenu) select '2. commission de production numérotée (C1) : pas émise, pas figée', 'vide',
    coalesce((select amount::text from public.show_payments where id = lc), 'vide');
  update public.show_payments set sent_at = current_date, invoice_number = 'ESSAI-1' where id = la;
  insert into _d1_r (essai, attendu, obtenu) select '3. acompte émis : figé au montant du moment', '5000', (select trim_scale(amount::numeric)::text from public.show_payments where id = la);
  update public.show_payments set paid_at = current_date where id in (lc, lp);
  insert into _d1_r (essai, attendu, obtenu) select '4. commission versée : figée', '1500', (select trim_scale(amount::numeric)::text from public.show_payments where id = lc);
  insert into _d1_r (essai, attendu, obtenu) select '5. part partenaire versée : figée', '450', (select trim_scale(amount::numeric)::text from public.show_payments where id = lp);
  insert into _d1_r (essai, attendu, obtenu) select '6. solde pas encore émis : toujours calculé', 'vide', coalesce((select amount::text from public.show_payments where id = ls), 'vide');
  begin
    update public.shows set fee_ht = 12000 where id = sa;
    insert into _d1_r (essai, attendu, obtenu) select '7. cachet changé, montants émis figés : accepté, émis inchangés', '5000/1500/450 solde 7000',
      (select string_agg(trim_scale(amount::numeric)::text, '/' order by sort) from public.show_payments where id in (la, lc, lp)) || ' solde ' || (select trim_scale(public.payment_amount_now(p))::text from public.show_payments p where id = ls);
  exception when others then insert into _d1_r (essai, attendu, obtenu) values ('7. cachet changé, montants émis figés', '5000/1500/450 solde 7000', 'REFUSÉ : ' || sqlerrm); end;
  begin update public.show_payments set amount = 1 where id = la;
    insert into _d1_r (essai, attendu, obtenu) values ('8. changer un montant figé (A1)', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('8. changer un montant figé (A1)', 'refusé', 'refusé'); end;
  update public.show_payments set sent_at = current_date where id = ls;
  insert into _d1_r (essai, attendu, obtenu) select '9. solde émis : figé (nouvelle cession − acompte facturé)', '7000', (select trim_scale(amount::numeric)::text from public.show_payments where id = ls);
  begin insert into public.show_payments (show_id, kind, label, pct, sent_at, sort) values (sa, 'acompte', 'Acompte caduc', 10, current_date, 15);
    insert into _d1_r (essai, attendu, obtenu) values ('10. acompte caduc (C1) toujours refusé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('10. acompte caduc (C1) toujours refusé', 'refusé', 'refusé'); end;
  update public.show_payments set payee = 'compte' where id = la;
  insert into _d1_r (essai, attendu, obtenu) select '11. compte d''encaissement d''une facture émise : modifiable', 'compte', (select payee from public.show_payments where id = la);

  -- Ligne « historique » : émise sans montant figé (cachet vide au moment de l'émission)
  insert into public.show_payments (show_id, kind, label, pct, sent_at, invoice_number, sort) values (sb, 'acompte', 'Acompte', 50, current_date, 'ESSAI-H', 10) returning id into lb;
  insert into _d1_r (essai, attendu, obtenu) select '12. émise sans cachet : rien à figer', 'vide', coalesce((select amount::text from public.show_payments where id = lb), 'vide');
  begin update public.shows set fee_ht = 4000 where id = sb;
    insert into _d1_r (essai, attendu, obtenu) values ('13. cachet changé alors qu''une ligne émise n''est pas figée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('13. cachet changé alors qu''une ligne émise n''est pas figée', 'refusé', 'refusé'); end;
  begin update public.show_payments set amount = 2000 where id = lb;
    insert into _d1_r (essai, attendu, obtenu) values ('14. remplir un montant vide hors régularisation annoncée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('14. remplir un montant vide hors régularisation annoncée', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'gel', true);
  begin update public.show_payments set amount = 2000, pct = 40 where id = lb;
    insert into _d1_r (essai, attendu, obtenu) values ('15. régularisation qui change aussi le %', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('15. régularisation qui change aussi le %', 'refusé', 'refusé'); end;
  update public.show_payments set amount = 2000 where id = lb;
  insert into _d1_r (essai, attendu, obtenu) select '16. régularisation annoncée : montant vide rempli', '2000', (select trim_scale(amount::numeric)::text from public.show_payments where id = lb);
  begin update public.show_payments set amount = 2100 where id = lb;
    insert into _d1_r (essai, attendu, obtenu) values ('17. régularisation sur un montant déjà figé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('17. régularisation sur un montant déjà figé', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', '', true);

  -- Droits réels : les déclencheurs appellent les fonctions de calcul avec les droits de l'appelant (application connectée,
  -- fonction serveur). On les appelle donc avec chacun de ces rôles (sans dépendre des règles d'accès aux lignes)
  select * into rw from public.show_payments where id = ls;
  foreach t in array array['authenticated', 'service_role'] loop
    begin
      execute format('set local role %I', t);
      perform public.payment_is_emitted(rw), public.payment_amount_now(rw), public.payment_amount_for(rw, 1000, 15, 30, 'production'), public.finance_actor();
      execute 'reset role';
      insert into _d1_r (essai, attendu, obtenu) values ('23. fonctions de calcul exécutables en rôle ' || t, 'oui', 'oui');
    exception when others then
      execute 'reset role';
      insert into _d1_r (essai, attendu, obtenu) values ('23. fonctions de calcul exécutables en rôle ' || t, 'oui', 'NON : ' || sqlerrm);
    end;
  end loop;

  -- Retour arrière contrôlé (« degel ») : seul un montant posé par une régularisation se revide
  perform set_config('matrice.regularisation', 'degel', true);
  begin update public.show_payments set amount = null where id = la;
    insert into _d1_r (essai, attendu, obtenu) values ('24. revider un montant figé à l''émission (même annoncé)', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('24. revider un montant figé à l''émission (même annoncé)', 'refusé', 'refusé'); end;
  update public.show_payments set amount = null where id = lb;
  insert into _d1_r (essai, attendu, obtenu) select '25. revider un montant posé par régularisation (annoncé)', 'vide', coalesce((select amount::text from public.show_payments where id = lb), 'vide');
  -- ligne qui devient émise PENDANT une transaction de régularisation : figée à l'émission, jamais revidable
  perform set_config('matrice.regularisation', 'gel', true);
  insert into public.show_payments (show_id, kind, label, pct, sent_at, sort) values (sa, 'autre', 'Essai émise pendant gel', 10, current_date, 80) returning id into ld;
  if (select amount from public.show_payments where id = ld) is null then raise exception 'ECHEC ESSAIS : ligne 25 bis non figée à l''émission'; end if;
  perform set_config('matrice.regularisation', 'degel', true);
  begin update public.show_payments set amount = null where id = ld;
    insert into _d1_r (essai, attendu, obtenu) values ('25 bis. revider une ligne figée à l''émission pendant une régularisation', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('25 bis. revider une ligne figée à l''émission pendant une régularisation', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', '', true);
  begin update public.show_payments set amount = 2000 where id = lb;
    insert into _d1_r (essai, attendu, obtenu) values ('26. après retour arrière : remplir sans annonce', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('26. après retour arrière : remplir sans annonce', 'refusé', 'refusé'); end;

  -- Mode et TVA d'une date engagée (décisions du 26/10, points 5 et 7)
  insert into public.shows (project_id, venue, date, prod_mode, vat_rate) values (pj, 'Salle Essai D1 libre', current_date + 62, 'production', 5.5) returning id into sc;
  delete from public.show_payments where show_id = sc;
  insert into _d1_ids values ('sc', sc);
  update public.projects set mode = 'booking' where id = pj;
  insert into _d1_r (essai, attendu, obtenu) select '27. artiste passé en booking : date engagée garde son mode, date libre suit', 'production/production/booking',
    (select string_agg(coalesce(prod_mode, 'production'), '/' order by date) from public.shows where id in (sa, sb, sc));
  begin update public.shows set prod_mode = 'booking' where id = sa;
    insert into _d1_r (essai, attendu, obtenu) values ('28. mode d''une date engagée changé directement', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('28. mode d''une date engagée changé directement', 'refusé', 'refusé'); end;
  begin update public.shows set vat_rate = 20 where id = sa;
    insert into _d1_r (essai, attendu, obtenu) values ('29. TVA d''une date dont une facture émise dépend', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('29. TVA d''une date dont une facture émise dépend', 'refusé', 'refusé'); end;
  update public.shows set vat_rate = 20 where id = sc;
  insert into _d1_r (essai, attendu, obtenu) select '30. TVA d''une date sans facture émise', '20', (select trim_scale(vat_rate)::text from public.shows where id = sc);

  -- Journal
  insert into _d1_r (essai, attendu, obtenu) select '18. journal : cachet 10000 → 12000 tracé', 'tracé',
    case when exists (select 1 from public.finance_log where row_id = sa and field = 'fee_ht' and (case when field = 'fee_ht' then old_value::numeric end) = 10000 and (case when field = 'fee_ht' then new_value::numeric end) = 12000 and actor is not null) then 'tracé' else 'ABSENT' end;
  insert into _d1_r (essai, attendu, obtenu) select '19. journal : régularisation puis retour arrière tracés comme tels', 'régularisation contrôlée puis retour arrière de régularisation',
    coalesce((select string_agg(source, ' puis ' order by id) from public.finance_log where row_id = lb and field = 'amount'), 'ABSENT');
  insert into _d1_r (essai, attendu, obtenu) select '20. journal : compte d''encaissement tracé', 'tracé',
    case when exists (select 1 from public.finance_log where row_id = la and field = 'payee' and new_value = 'compte') then 'tracé' else 'ABSENT' end;
  insert into _d1_r (essai, attendu, obtenu) select '21. journal : montants figés tracés (acompte, commission, part, solde)', '4',
    (select count(distinct row_id)::text from public.finance_log where row_id in (la, lc, lp, ls) and field = 'amount');
  begin
    execute 'set local role authenticated';
    insert into public.finance_log (table_name, row_id, op, field) values ('shows', sa, 'UPDATE', 'essai');
    execute 'reset role';
    insert into _d1_r (essai, attendu, obtenu) values ('22. écrire dans le journal depuis l''application', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then
    execute 'reset role';
    insert into _d1_r (essai, attendu, obtenu) values ('22. écrire dans le journal depuis l''application', 'refusé', 'refusé');
  end;
end $t$;
-- ===== Versements de commission (v1.43) — décisions d'Anthony du 27/10 =====
do $v$
declare pj uuid := (select id from _d1_ids where k = 'pj'); sd uuid; se uuid; sf uuid; sg uuid; sh uuid; cd uuid; ce uuid; cf uuid; cg uuid; ch uuid; t1 uuid; tc uuid; r record;
begin
  -- date de production : cachet 12 306,15, commission 15 % (1 845,92 calculés), acompte encaissé il y a 15 jours
  insert into public.shows (project_id, venue, date, status, fee_ht, artbo_pct, partner_pct, prod_mode, vat_rate)
    values (pj, 'Salle Essai versements', current_date + 30, 'Confirmée Salle', 12306.15, 15, 30, 'production', 5.5) returning id into sd;
  -- « Carcassonne » : commission marquée versée AVANT le lot (1 500 le 25/08/2026), sans versement détaillé
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, partner_pct, prod_mode, vat_rate)
    values (pj, 'Féria Essai (Carcassonne)', current_date + 31, 12306.15, 15, 30, 'production', 5.5) returning id into se;
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode) values (pj, 'Salle Essai ancienne appli', current_date + 32, 4000, 15, 'production') returning id into sf;
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode) values (pj, 'Salle Essai booking', current_date + 33, 4000, 15, 'booking') returning id into sg;
  insert into _d1_ids values ('sd', sd), ('se', se), ('sf', sf), ('sg', sg);
  delete from public.show_payments where show_id in (sd, se, sf, sg);
  insert into public.show_payments (show_id, kind, label, pct, amount, sent_at, invoice_number, paid_at, sort)
    values (sd, 'acompte', 'Acompte', 50, 6153.07, current_date - 20, 'ESSAI-V1', current_date - 15, 10);
  insert into public.show_payments (show_id, kind, label, sort) values (sd, 'artbo', 'Commission', 30) returning id into cd;
  insert into public.show_payments (show_id, kind, label, amount, paid_at, sort) values (se, 'artbo', 'Commission', 1500, '2026-08-25', 30) returning id into ce;
  insert into public.show_payments (show_id, kind, label, sort) values (sf, 'artbo', 'Commission', 30) returning id into cf;
  insert into public.show_payments (show_id, kind, label, sort) values (sg, 'artbo', 'Commission', 30) returning id into cg;

  insert into public.commission_transfers (payment_id, amount, transferred_at, reference) values (cd, 1000, current_date - 5, 'ESSAI VIR 1') returning id into t1;
  insert into _d1_r (essai, attendu, obtenu) select '31. 1er versement : total figé, transféré, pas encore « versée »', '1845.92 / 1000 / non versée',
    (select trim_scale(amount)::text || ' / ' || trim_scale(public.commission_transferred(id))::text || ' / ' || case when paid_at is null then 'non versée' else 'VERSÉE' end from public.show_payments where id = cd);
  begin insert into public.commission_transfers (payment_id, amount, transferred_at) values (cd, 900, current_date);
    insert into _d1_r (essai, attendu, obtenu) values ('32. versement au-delà du reste', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('32. versement au-delà du reste', 'refusé', 'refusé'); end;
  begin update public.show_payments set paid_at = current_date where id = cd;
    insert into _d1_r (essai, attendu, obtenu) values ('33. date de versement au lieu du reste (versée en partie)', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('33. date de versement au lieu du reste (versée en partie)', 'refusé', 'refusé'); end;
  begin update public.show_payments set amount = 2000 where id = cd;
    insert into _d1_r (essai, attendu, obtenu) values ('34. total d''une commission versée en partie modifié', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('34. total d''une commission versée en partie modifié', 'refusé', 'refusé'); end;
  begin update public.show_payments set pct = 20 where id = cd;
    insert into _d1_r (essai, attendu, obtenu) values ('35. % d''une commission versée en partie modifié', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('35. % d''une commission versée en partie modifié', 'refusé', 'refusé'); end;
  begin delete from public.show_payments where id = cd;
    insert into _d1_r (essai, attendu, obtenu) values ('36. commission versée en partie supprimée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' or sqlstate '23503' then insert into _d1_r (essai, attendu, obtenu) values ('36. commission versée en partie supprimée', 'refusé', 'refusé'); end;
  begin update public.commission_transfers set amount = 999 where id = t1;
    insert into _d1_r (essai, attendu, obtenu) values ('37. versement enregistré modifié', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('37. versement enregistré modifié', 'refusé', 'refusé'); end;
  begin delete from public.commission_transfers where id = t1;
    insert into _d1_r (essai, attendu, obtenu) values ('38. versement enregistré supprimé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('38. versement enregistré supprimé', 'refusé', 'refusé'); end;
  update public.shows set fee_ht = 20000, artbo_pct = 20 where id = sd;
  insert into _d1_r (essai, attendu, obtenu) select '39. cachet et % changés après un versement : total et versé inchangés', '1845.92 / 1000',
    (select trim_scale(amount)::text || ' / ' || trim_scale(public.commission_transferred(id))::text from public.show_payments where id = cd);
  perform public.generate_reminders();
  insert into _d1_r (essai, attendu, obtenu) select '40. rappel sur le RESTE à transférer', 'un rappel, 845,92 €',
    case when (select count(*) from public.notifications where show_id = sd and kind = 'commission' and title like '%845,92 €%') = 1 then 'un rappel, 845,92 €'
         else 'rappels : ' || coalesce((select string_agg(title, ' | ') from public.notifications where show_id = sd and kind = 'commission'), 'aucun') end;
  insert into public.commission_transfers (payment_id, amount, transferred_at, reference) values (cd, 845.92, current_date - 1, 'ESSAI VIR 2');
  insert into _d1_r (essai, attendu, obtenu) select '41. dernier versement : « versée » à la date du dernier versement, reste nul', 'versée hier / 0',
    (select case when paid_at = current_date - 1 then 'versée hier' else coalesce(paid_at::text, 'NON VERSÉE') end || ' / ' || trim_scale(public.commission_total(p) - public.commission_transferred(id))::text from public.show_payments p where id = cd);
  update public.show_payments set paid_at = current_date where id = cf;
  insert into _d1_r (essai, attendu, obtenu) select '42. ancienne appli (date notée directement) : versement du total créé', '600 / 1 versement',
    (select trim_scale(public.commission_transferred(cf))::text || ' / ' || count(*) || ' versement' from public.commission_transfers where payment_id = cf);
  begin insert into public.commission_transfers (payment_id, amount, transferred_at) values (cg, 100, current_date);
    insert into _d1_r (essai, attendu, obtenu) values ('43. versement sur une commission booking', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('43. versement sur une commission booking', 'refusé', 'refusé'); end;
  -- Carcassonne (montants confirmés) : versement historique, puis régularisation « commission partielle »
  insert into public.commission_transfers (payment_id, amount, transferred_at, reference, note)
    values (ce, 1500, '2026-08-25', 'VIR INT. TL CARCASSONNE ACOMPT', 'retenue sur l''acompte, sans virement distinct') returning id into tc;
  insert into _d1_r (essai, attendu, obtenu) select '44. Carcassonne : versement historique de 1 500 noté, ligne inchangée', '1500 / 1500 / 2026-08-25',
    (select trim_scale(amount)::text || ' / ' || trim_scale(public.commission_transferred(id))::text || ' / ' || paid_at from public.show_payments where id = ce);
  begin update public.show_payments set amount = 1650, paid_at = null where id = ce;
    insert into _d1_r (essai, attendu, obtenu) values ('45. commission partielle sans régularisation annoncée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('45. commission partielle sans régularisation annoncée', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'commission_partielle', true);
  begin update public.show_payments set amount = 1400, paid_at = null where id = ce;
    insert into _d1_r (essai, attendu, obtenu) values ('46. commission partielle sous le déjà transféré', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('46. commission partielle sous le déjà transféré', 'refusé', 'refusé'); end;
  update public.show_payments set amount = 1650, paid_at = null where id = ce;
  perform set_config('matrice.regularisation', '', true);
  insert into _d1_r (essai, attendu, obtenu) select '47. Carcassonne : 1 650 dus, 1 500 transférés, 150 à transférer', '1650 / 1500 / 150 / non versée',
    (select trim_scale(amount)::text || ' / ' || trim_scale(public.commission_transferred(id))::text || ' / ' || trim_scale(amount - public.commission_transferred(id))::text
            || ' / ' || case when paid_at is null then 'non versée' else 'VERSÉE' end from public.show_payments where id = ce);
  -- retour arrière Carcassonne (script de retour arrière D) : la ligne redevient exactement celle d'avant, le versement est retiré
  perform set_config('matrice.regularisation', 'commission_partielle', true);
  update public.show_payments set amount = 1500, paid_at = '2026-08-25' where id = ce;
  perform set_config('matrice.regularisation', 'retour_versement', true);
  delete from public.commission_transfers where id = tc;
  perform set_config('matrice.regularisation', '', true);
  insert into _d1_r (essai, attendu, obtenu) select '48. retour arrière Carcassonne : ligne d''origine, aucun versement', '1500 / 2026-08-25 / 0',
    (select trim_scale(amount)::text || ' / ' || paid_at || ' / ' || (select count(*) from public.commission_transfers where payment_id = ce) from public.show_payments where id = ce);
  insert into _d1_r (essai, attendu, obtenu) select '49. journal : versements tracés', 'tracés',
    case when (select count(*) from public.finance_log where table_name = 'commission_transfers' and row_id in (t1, tc)) >= 3 then 'tracés' else 'ABSENTS' end;
  -- date dont la SEULE opération est un versement de commission : engagée (son mode ne change plus) — relecture D1, B2
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode, prod_mode_manual) values (pj, 'Salle Essai versement seul', current_date + 34, 4000, 15, 'production', true) returning id into sh;
  insert into _d1_ids values ('sh', sh);
  delete from public.show_payments where show_id = sh;
  insert into public.show_payments (show_id, kind, label, sort) values (sh, 'artbo', 'Commission', 30) returning id into ch;
  insert into public.commission_transfers (payment_id, amount, transferred_at) values (ch, 100, current_date);
  begin update public.shows set prod_mode = 'booking' where id = sh;
    insert into _d1_r (essai, attendu, obtenu) values ('51. mode d''une date engagée par un seul versement de commission', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('51. mode d''une date engagée par un seul versement de commission', 'refusé', 'refusé'); end;
  begin insert into public.show_payments (show_id, kind, label, sort) values (sh, 'artbo', 'Commission 2', 31);
    insert into _d1_r (essai, attendu, obtenu) values ('52. seconde commission sur une date', 'refusée', 'ACCEPTÉE');
  exception when unique_violation then insert into _d1_r (essai, attendu, obtenu) values ('52. seconde commission sur une date', 'refusée', 'refusée'); end;
  perform set_config('matrice.regularisation', 'retour_versement', true);
  begin update public.commission_transfers set amount = 99999 where id = t1;
    insert into _d1_r (essai, attendu, obtenu) values ('53. modifier un versement même en retour arrière annoncé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('53. modifier un versement même en retour arrière annoncé', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'degel', true);
  begin update public.show_payments set amount = 50 where id = ch;
    insert into _d1_r (essai, attendu, obtenu) values ('62. retour arrière d''une commission sous le déjà transféré', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('62. retour arrière d''une commission sous le déjà transféré', 'refusé', 'refusé'); end;
  begin update public.show_payments set amount = 100 where id = ch;
    insert into _d1_r (essai, attendu, obtenu) values ('63. retour arrière d''un total figé au premier versement', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('63. retour arrière d''un total figé au premier versement', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', '', true);
  begin
    execute 'set local role authenticated';
    update public.commission_transfers set amount = 1 where id = t1;
    execute 'reset role';
    insert into _d1_r (essai, attendu, obtenu) values ('50. modifier un versement depuis l''application', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then
    execute 'reset role';
    insert into _d1_r (essai, attendu, obtenu) values ('50. modifier un versement depuis l''application', 'refusé', 'refusé');
  end;
end $v$;
-- Acompte facturé à un autre % que la Matrice (La Puce / La MOBA, décision d'Anthony du 27/10) : exception « acompte_facture »
do $af$
declare pj uuid := (select id from _d1_ids where k = 'pj'); si uuid; l1 uuid; l2 uuid;
begin
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode, prod_mode_manual) values (pj, 'Salle Essai acompte facturé', current_date + 36, 4000, 15, 'production', true) returning id into si;
  insert into _d1_ids values ('si', si);
  delete from public.show_payments where show_id = si;
  -- lignes « historiques » : émises sans % ni montant (rien à figer), comme les acomptes importés
  insert into public.show_payments (show_id, kind, label, sent_at, invoice_number, sort) values (si, 'acompte', 'Acompte', current_date, 'ESSAI-AF', 10) returning id into l1;
  insert into public.show_payments (show_id, kind, label, sent_at, invoice_number, sort) values (si, 'acompte', 'Acompte 2', current_date, 'ESSAI-AF2', 11) returning id into l2;
  begin update public.show_payments set pct = 50, amount = 2000 where id = l1;
    insert into _d1_r (essai, attendu, obtenu) values ('56. % et montant d''une facture émise sans régularisation annoncée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('56. % et montant d''une facture émise sans régularisation annoncée', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'acompte_facture', true);
  begin update public.show_payments set pct = 50, amount = 1999 where id = l1;
    insert into _d1_r (essai, attendu, obtenu) values ('57. acompte_facture : montant ≠ cachet × %', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('57. acompte_facture : montant ≠ cachet × %', 'refusé', 'refusé'); end;
  begin update public.show_payments set pct = 50, amount = 2000, invoice_number = 'AUTRE' where id = l1;
    insert into _d1_r (essai, attendu, obtenu) values ('64. acompte_facture qui change aussi le numéro de facture', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('64. acompte_facture qui change aussi le numéro de facture', 'refusé', 'refusé'); end;
  update public.show_payments set pct = 50, amount = 2000 where id = l1;
  insert into _d1_r (essai, attendu, obtenu) select '58. acompte_facture : % et montant concordants', '50/2000', (select trim_scale(pct)::text || '/' || trim_scale(amount)::text from public.show_payments where id = l1);
  begin update public.show_payments set pct = 52.5, amount = 2100 where id = l1;
    insert into _d1_r (essai, attendu, obtenu) values ('59. acompte_facture sur un montant déjà figé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('59. acompte_facture sur un montant déjà figé', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'degel', true);
  update public.show_payments set pct = null, amount = null where id = l1;
  insert into _d1_r (essai, attendu, obtenu) select '60. retour arrière annoncé : % et montant d''avant', 'vide/vide', (select coalesce(pct::text, 'vide') || '/' || coalesce(amount::text, 'vide') from public.show_payments where id = l1);
  perform set_config('matrice.regularisation', 'gel', true);
  update public.show_payments set amount = 1000 where id = l2;
  perform set_config('matrice.regularisation', 'degel', true);
  begin update public.show_payments set pct = 25, amount = null where id = l2;
    insert into _d1_r (essai, attendu, obtenu) values ('61. retour arrière qui change un % non posé par la régularisation', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('61. retour arrière qui change un % non posé par la régularisation', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', '', true);
end $af$;
-- Coproductions (v1.44, décision d'Anthony du 27/10) : aucune ligne inventée ; lignes importées gardées « hors calcul »
do $cp$
declare pj uuid := (select id from _d1_ids where k = 'pj'); sc uuid; sd uuid; la uuid; lc uuid; v jsonb; n int;
begin
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode, prod_mode_manual, contract_type, status)
    values (pj, 'Salle Essai coproduction', current_date + 40, 5000, 15, 'production', true, 'Co-Production', 'Confirmée Salle') returning id into sc;
  insert into _d1_ids values ('scp', sc);
  insert into _d1_r (essai, attendu, obtenu) select '65. coproduction confirmée : aucun acompte, solde, commission ni part partenaire créés', '0',
    (select count(*)::text from public.show_payments where show_id = sc and kind in ('acompte', 'solde', 'artbo', 'partner'));
  perform public.ensure_production_payments(sc);
  insert into _d1_r (essai, attendu, obtenu) select '66. coproduction : aucune ligne créée au passage en production', '0',
    (select count(*)::text from public.show_payments where show_id = sc and kind in ('acompte', 'solde', 'artbo', 'partner'));
  -- lignes « importées » (comme le Rockstore) : acompte « N.C » noté envoyé / payé, commission notée versée ; montant vide comme
  -- à l'import réel (fait avant v1.42) : le cachet est vide le temps de l'insertion, donc rien n'est figé à l'émission
  update public.shows set fee_ht = null where id = sc;
  insert into public.show_payments (show_id, kind, label, pct, invoice_number, sent_at, paid_at, sort, import_key) values (sc, 'acompte', 'Acompte', 20, 'N.C', current_date, current_date, 10, 'essai-d1:acompte') returning id into la;
  insert into public.show_payments (show_id, kind, label, paid_at, sort, import_key) values (sc, 'artbo', 'Commission', current_date, 30, 'essai-d1:artbo') returning id into lc;
  begin update public.show_payments set hors_calcul = 'essai' where id = la;
    insert into _d1_r (essai, attendu, obtenu) values ('67. classer hors calcul sans régularisation annoncée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('67. classer hors calcul sans régularisation annoncée', 'refusé', 'refusé'); end;
  perform set_config('matrice.regularisation', 'hors_calcul', true);
  begin update public.show_payments set hors_calcul = 'essai', label = 'autre' where id = la;
    insert into _d1_r (essai, attendu, obtenu) values ('68. classer hors calcul en changeant autre chose', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('68. classer hors calcul en changeant autre chose', 'refusé', 'refusé'); end;
  update public.show_payments set hors_calcul = 'Coproduction : essai' where id in (la, lc);
  update public.shows set fee_ht = 5000 where id = sc;
  insert into _d1_r (essai, attendu, obtenu) select '69. classement annoncé, journalisé', '2',
    (select count(*)::text from public.finance_log where row_id in (la, lc) and field = 'hors_calcul' and source = 'régularisation contrôlée (hors calcul)');
  perform set_config('matrice.regularisation', '', true);
  begin update public.show_payments set paid_at = null, sent_at = null where id = la;
    insert into _d1_r (essai, attendu, obtenu) values ('70. modifier une ligne hors calcul', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('70. modifier une ligne hors calcul', 'refusé', 'refusé'); end;
  begin delete from public.show_payments where id = lc;
    insert into _d1_r (essai, attendu, obtenu) values ('71. supprimer une ligne hors calcul', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('71. supprimer une ligne hors calcul', 'refusé', 'refusé'); end;
  insert into _d1_r (essai, attendu, obtenu) select '72. ligne hors calcul : ni émise, ni date engagée', 'non/non',
    (select case when public.payment_is_emitted(p) then 'oui' else 'non' end from public.show_payments p where p.id = la) || '/' || case when public.show_has_financial_record(sc) then 'oui' else 'non' end;
  begin insert into public.commission_transfers (payment_id, amount, transferred_at) values (lc, 10, current_date);
    insert into _d1_r (essai, attendu, obtenu) values ('73. versement sur une commission hors calcul', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('73. versement sur une commission hors calcul', 'refusé', 'refusé'); end;
  begin insert into public.show_payments (show_id, kind, label, sort, hors_calcul) values (sc, 'autre', 'x', 90, 'essai');
    insert into _d1_r (essai, attendu, obtenu) values ('74. créer une ligne directement hors calcul', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values ('74. créer une ligne directement hors calcul', 'refusé', 'refusé'); end;
  begin insert into public.show_payments (show_id, kind, label, sort) values (sc, 'artbo', 'Commission réelle (essai)', 31);
    insert into _d1_r (essai, attendu, obtenu) values ('78. commission réelle notée à côté d''une commission hors calcul', 'acceptée', 'acceptée');
  exception when unique_violation then insert into _d1_r (essai, attendu, obtenu) values ('78. commission réelle notée à côté d''une commission hors calcul', 'acceptée', 'REFUSÉE'); end;
  begin insert into public.show_payments (show_id, kind, label, sort) values (sc, 'artbo', 'Seconde commission réelle (essai)', 32);
    insert into _d1_r (essai, attendu, obtenu) values ('79. deux commissions réelles sur une date', 'refusée', 'ACCEPTÉE');
  exception when unique_violation then insert into _d1_r (essai, attendu, obtenu) values ('79. deux commissions réelles sur une date', 'refusée', 'refusée'); end;
  delete from public.show_payments where show_id = sc and kind = 'artbo' and hors_calcul is null;   -- l'essai 78 ne doit pas gêner le nettoyage
  -- cachet d'une coproduction dont l'acompte « N.C » est hors calcul : plus bloqué par cette ligne fictive
  update public.shows set fee_ht = 6000 where id = sc;
  insert into _d1_r (essai, attendu, obtenu) select '75. cachet modifiable malgré la ligne fictive', '6000', (select trim_scale(fee_ht)::text from public.shows where id = sc);
  -- fiche publique : aucune ligne hors calcul, acompte 0 % en coproduction sans acompte
  update public.shows set fiche_token = 'essai-coproduction-d1-' || sc where id = sc;
  v := public.fiche_get('essai-coproduction-d1-' || sc);
  insert into _d1_r (essai, attendu, obtenu) values ('76. fiche publique d''une coproduction : ni acompte ni solde fictifs', '[]/0', coalesce(v ->> 'payments', '?') || '/' || coalesce(v ->> 'acompte_pct', '?'));
  -- rappels : aucun rappel de facture ou de commission pour la coproduction
  perform public.generate_reminders();
  select count(*) into n from public.notifications where show_id = sc and kind in ('facture_acompte', 'acompte_paye', 'solde_envoi', 'solde_paye', 'commission', 'commission_partenaire');
  insert into _d1_r (essai, attendu, obtenu) values ('77. rappels de la coproduction (facture, paiement, commission)', '0', n::text);
  -- 80-86 : le classement « hors calcul » ne peut JAMAIS masquer une opération réelle (seule une ligne artificielle d'import d'une coproduction)
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, prod_mode, prod_mode_manual, contract_type, status)
    values (pj, 'Salle Essai cession', current_date + 41, 5000, 15, 'production', true, 'Cession', 'Confirmée Salle') returning id into sd;
  insert into _d1_ids values ('scq', sd);
  perform set_config('matrice.regularisation', 'hors_calcul', true);
  for v in select jsonb_build_object('e', e, 'sh', sh, 'k', k, 'ik', ik, 'num', num, 'pl', pl, 'amt', amt, 'fp', fp) from (values
      ('80. ligne importée d''une date qui n''est pas une coproduction', 'autre', 'acompte', 'essai-d1:x1', null, null, null, null),
      ('81. ligne saisie dans la Matrice (sans import)', 'copro', 'solde', null, null, null, null, null),
      ('82. ligne avec un vrai numéro de facture', 'copro', 'solde', 'essai-d1:x3', 'F-AB-2099-01-1', null, null, null),
      ('83. ligne reliée à Pennylane', 'copro', 'solde', 'essai-d1:x4', null, 'pl-essai', null, null),
      ('84. ligne au montant figé', 'copro', 'solde', 'essai-d1:x5', null, null, 100, null),
      ('85. ligne avec une pièce jointe', 'copro', 'solde', 'essai-d1:x6', null, null, null, 'essai/piece.pdf'),
      ('86. taxe CNM importée', 'copro', 'cnm', 'essai-d1:x7', null, null, null, null)) t(e, sh, k, ik, num, pl, amt, fp) loop
    perform set_config('matrice.regularisation', '', true);
    insert into public.show_payments (show_id, kind, label, sort, import_key, invoice_number, pennylane_id, amount, file_path)
      values (case when v->>'sh' = 'copro' then sc else sd end, v->>'k', 'Essai', 95, v->>'ik', v->>'num', v->>'pl', (v->>'amt')::numeric, v->>'fp') returning id into la;
    perform set_config('matrice.regularisation', 'hors_calcul', true);
    begin update public.show_payments set hors_calcul = 'Coproduction : essai' where id = la;
      insert into _d1_r (essai, attendu, obtenu) values (v->>'e', 'refusé', 'ACCEPTÉ');
    exception when sqlstate 'P0001' then insert into _d1_r (essai, attendu, obtenu) values (v->>'e', 'refusé', 'refusé'); end;
  end loop;
  perform set_config('matrice.regularisation', '', true);
end $cp$;
-- Aucune donnée réelle touchée : empreintes recalculées SANS les données fictives = empreintes d'avant (lignes / dates / artistes fictifs exclus)
do $chk$
declare ko text;
begin
  if (select count(*) from public.show_payments where show_id in (select id from _d1_ids where k in ('sa', 'sb', 'sc'))) <> 6 then
    raise exception 'ECHEC ESSAIS : nombre de lignes fictives inattendu — TOUT EST ANNULÉ'; end if;
  if (select (n_lignes, lignes, n_dates, dates, artistes) is distinct from
        ((select count(*) from public.show_payments where show_id not in (select id from _d1_ids)),
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.show_payments t where t.show_id not in (select id from _d1_ids)),
         (select count(*) from public.shows where id not in (select id from _d1_ids)),
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t where t.id not in (select id from _d1_ids)),
         (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t where t.id not in (select id from _d1_ids))) from _d1_av) then
    raise exception 'ECHEC ESSAIS : des données réelles du test ont changé — TOUT EST ANNULÉ'; end if;
  select string_agg(essai || ' → attendu « ' || attendu || ' », obtenu « ' || coalesce(obtenu, 'rien') || ' »', ' | ' order by n) into ko
    from _d1_r where obtenu is distinct from attendu;
  if ko is not null then raise exception 'ECHEC ESSAIS — TOUT EST ANNULÉ : %', ko; end if;
  if (select count(*) from _d1_r) <> 86 then raise exception 'ECHEC ESSAIS : % essais au lieu de 86 — TOUT EST ANNULÉ', (select count(*) from _d1_r); end if;
end $chk$;
-- Fin des essais : versements fictifs retirés (retour arrière contrôlé), pour que le retour arrière de la migration puisse s'essayer
do $n$ begin
  perform set_config('matrice.regularisation', 'hors_calcul', true);   -- classements fictifs retirés (retour arrière de v1.44 possible)
  update public.show_payments set hors_calcul = null where hors_calcul is not null and show_id in (select id from _d1_ids);
  perform set_config('matrice.regularisation', 'retour_versement', true);
  delete from public.commission_transfers where payment_id in (select p.id from public.show_payments p where p.show_id in (select id from _d1_ids));
  perform set_config('matrice.regularisation', '', true);
end $n$;

-- ===== 3. Retour arrière : corps identique au script de production =====
-- Instantané des données : le retour arrière ne doit RIEN changer aux données (le journal est GARDÉ, en lecture seule)
drop table if exists _d1_ra;
create temp table _d1_ra on commit drop as select (select count(*) from public.show_payments) n_lignes, (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t) lignes,
       (select count(*) from public.shows) n_dates, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t) dates,
       (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t) artistes;
do $p$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) <> 4 or to_regclass('public.finance_log') is null then
    raise exception 'ARRET : le lot D1 n''est pas (entièrement) en place — rien n''a été fait'; end if;
end $p$;
-- v1.44 (coproductions) : seulement si AUCUNE ligne n'est classée hors calcul (sinon : retour arrière du script F d'abord)
do $h$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_payments' and column_name = 'hors_calcul')
     and exists (select 1 from public.show_payments where hors_calcul is not null) then
    raise exception 'ARRET : des lignes sont classées hors calcul — retour arrière du script F d''abord — rien n''a été fait'; end if;
end $h$;
drop trigger if exists show_payments_hors_calcul_guard on public.show_payments;
drop trigger if exists commission_transfers_hors_calcul on public.commission_transfers;
drop function if exists public.show_payments_hors_calcul_guard();
drop function if exists public.commission_transfers_hors_calcul();
-- fonctions de production : versions d'avant v1.44 (textes relevés en production, empreintes contrôlées ci-dessous)
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
end $function$
;
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
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
        (new.id, 'solde', 'Solde', 100 - coalesce(setting_num('default_acompte_pct'), 20), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
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
end $function$
;
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
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde');
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type, 'prod_mode', coalesce(s.prod_mode, 'production'),
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break, 'show_time', s.show_time, 'set_length', s.set_length,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $function$
;
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
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  acpt := coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
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
end $function$
;
-- calculs : versions v1.42 / v1.43
create or replace function public.payment_is_emitted(p public.show_payments)
returns boolean language sql stable set search_path = public as $$
  select case when p.kind = 'artbo' and exists (select 1 from public.shows s where s.id = p.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
              then p.paid_at is not null
              else p.sent_at is not null or p.paid_at is not null or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null end
$$;
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                        or exists (select 1 from public.commission_transfers t where t.payment_id = p.id)))
$$;
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
drop index if exists public.show_payments_une_commission;
create unique index show_payments_une_commission on public.show_payments (show_id) where kind = 'artbo';   -- version v1.43
alter table public.show_payments drop column if exists hors_calcul;
-- v1.43 (versements de commission) : seulement si AUCUN versement n'est enregistré (sinon : décision d'Anthony)
do $v$ begin
  if to_regclass('public.commission_transfers') is not null and exists (select 1 from public.commission_transfers) then
    raise exception 'ARRET : des versements de commission sont enregistrés — retour arrière impossible sans décision d''Anthony — rien n''a été fait'; end if;
end $v$;
drop trigger if exists commission_transfer_before on public.commission_transfers;
drop trigger if exists commission_transfer_after on public.commission_transfers;
drop trigger if exists finance_log_transfers on public.commission_transfers;
drop trigger if exists show_payments_commission_lock on public.show_payments;
drop trigger if exists show_payments_commission_paid on public.show_payments;
-- fonction « date engagée » : version v1.42 (sans les versements) avant de retirer la table
create or replace function public.show_has_financial_record(p_show uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.show_payments p where p.show_id = p_show
                   and (p.sent_at is not null or p.paid_at is not null
                        or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))
$$;
drop table if exists public.commission_transfers;
drop function if exists public.commission_transfer_before();
drop function if exists public.commission_transfer_after();
drop function if exists public.show_payments_commission_lock();
drop function if exists public.show_payments_commission_paid();
drop function if exists public.finance_log_transfers();
drop function if exists public.commission_total(public.show_payments);
drop function if exists public.commission_transferred(uuid);
drop index if exists public.show_payments_une_commission;
-- Rappels : version de production v1.41 (texte identique au fichier 2026-10-26_v1.41_relances_c1.sql)
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
    union all select 'commission', id, least(a_paid, so_paid) + 10, true, coalesce(c_label,'Commission L''ArtBo') || ' : à te verser (virement du compte de l''artiste vers L''ArtBo)'
                     from s where mode <> 'booking' and coalesce(a_paid, so_paid) is not null and c_id is not null and c_paid is null
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
-- v1.42
drop trigger show_payments_freeze on public.show_payments;
drop trigger shows_frozen_guard on public.shows;
drop trigger finance_log_shows on public.shows;
drop trigger finance_log_payments on public.show_payments;
drop function public.show_payments_freeze();
drop function public.shows_frozen_guard();
drop function public.finance_log_write();
drop function public.finance_actor();
drop function public.payment_amount_now(public.show_payments);
drop function public.payment_amount_for(public.show_payments, numeric, numeric, numeric, text);
-- Fonctions de mode (artiste → dates) et protection A1 : versions de production d'avant le lot D1 (relevées le 26/10/2026)
CREATE OR REPLACE FUNCTION public.project_mode_to_shows()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows s set prod_mode = new.mode
     where s.project_id = new.id and not s.prod_mode_manual
       and not exists (select 1 from public.show_payments p where p.show_id = s.id
                        and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(s.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                             or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null)));
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.show_follow_project_mode()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual
     and not exists (select 1 from public.show_payments p where p.show_id = new.id
                      and (p.paid_at is not null or (not (p.kind = 'artbo' and coalesce(new.prod_mode, 'production') <> 'booking')) and (p.sent_at is not null
                           or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null))) then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$
;
drop function public.show_has_financial_record(uuid);
drop function public.payment_is_emitted(public.show_payments);
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
  if (old.paid_at is not null and new.paid_at is null)
     or (not self_paid and ((old.sent_at is not null and new.sent_at is null)
       or (nullif(btrim(old.invoice_number), '') is not null and nullif(btrim(new.invoice_number), '') is null)
       or (nullif(btrim(old.pennylane_id), '') is not null and nullif(btrim(new.pennylane_id), '') is null))) then
    raise exception 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas.' using errcode = 'P0001';
  end if;
  if new.amount is distinct from old.amount or new.pct is distinct from old.pct or new.vat_rate is distinct from old.vat_rate
     or new.show_id is distinct from old.show_id or new.kind is distinct from old.kind then
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $function$;
do $ctl$
begin
  if md5(pg_get_functiondef('public.show_payments_emitted_guard()'::regprocedure)) <> 'cd2ea4e4c8d85e9ea58d3166d5040978' then
    raise exception 'ECHEC : la protection A1 n''a pas retrouvé sa version d''avant le lot D1 — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.show_payments_caduc_guard()'::regprocedure)) <> 'd713c4d0d1d45d2359981c49f1bf2239' then
    raise exception 'ECHEC : la protection C1 a été modifiée — TOUT EST ANNULÉ'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('show_payments_emitted_guard', 'show_payments_caduc_guard')) <> 2 then
    raise exception 'ECHEC : protections A1 / C1 absentes — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.project_mode_to_shows()'::regprocedure)) <> 'ae7f1ea9d1646f23f3aa57d292d40b18'
     or md5(pg_get_functiondef('public.show_follow_project_mode()'::regprocedure)) <> '45fe55a664ff4c423386a7d6f280cbd0' then
    raise exception 'ECHEC : fonctions de mode non revenues à leur version d''avant — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.generate_reminders()'::regprocedure)) <> '6f834c203fcdae7b7a02c06df4c1f81d' then
    raise exception 'ECHEC : la fonction des rappels n''est pas revenue à sa version d''avant — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.ensure_production_payments(uuid)'::regprocedure)) <> 'd55c81ebb5ef14b26aacf6de07681fb7' then
    raise exception 'ECHEC : ensure_production_payments n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.on_show_confirmed()'::regprocedure)) <> 'f0cfdf80d6b7c8d3c7e1d7c4093201dd' then
    raise exception 'ECHEC : on_show_confirmed n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.fiche_get(text)'::regprocedure)) <> '18c6b88bcb0c9b56ed2062cd83ca338e' then
    raise exception 'ECHEC : fiche_get n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if md5(pg_get_functiondef('public.mail_vars(uuid, uuid)'::regprocedure)) <> 'a1bb413b3f321997c4f3b87b338ed53d' then
    raise exception 'ECHEC : mail_vars n''est pas la version de production attendue — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_payments' and column_name = 'hors_calcul') then
    raise exception 'ECHEC : colonne hors_calcul encore présente — TOUT EST ANNULÉ'; end if;
  if to_regclass('public.commission_transfers') is not null then
    raise exception 'ECHEC : table des versements encore présente — TOUT EST ANNULÉ'; end if;
  if to_regprocedure('public.show_has_financial_record(uuid)') is not null then
    raise exception 'ECHEC : fonction du lot D1 encore présente — TOUT EST ANNULÉ'; end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in ('show_payments_freeze', 'shows_frozen_guard', 'finance_log_shows', 'finance_log_payments')) then
    raise exception 'ECHEC : déclencheurs du lot D1 encore présents — TOUT EST ANNULÉ'; end if;
  if (select (n_lignes, lignes, n_dates, dates, artistes) is distinct from
             ((select count(*) from public.show_payments), (select md5(coalesce(string_agg((to_jsonb(t) - 'hors_calcul')::text, '|' order by t.id), '')) from public.show_payments t),
              (select count(*) from public.shows), (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.shows t),
              (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.projects t)) from _d1_ra) then
    raise exception 'ECHEC : des données ont changé pendant le retour arrière — TOUT EST ANNULÉ'; end if;
end $ctl$;

-- ===== 4. Redéploiement après retour arrière =====
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

do $fin$ begin
  raise exception using errcode = 'P0001', message = 'BILAN RÉPÉTITION LOT D1 : CONFORME (' || (select count(*) from _d1_r) || ' essais réussis, retour arrière, redéploiement). TOUT EST ANNULÉ.';
end $fin$;
commit;
