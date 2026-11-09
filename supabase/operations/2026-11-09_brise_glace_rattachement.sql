-- Brise Glace (concert du 02/12/2026) — facture Pennylane F-AB-2026-11-107 (id 34170228875264) reliée au SOLDE au lieu de l'ACOMPTE.
-- OPÉRATION CONTRÔLÉE, PRÉPARÉE, NON EXÉCUTÉE. À lancer SEULEMENT après la confirmation d'Anthony, dans Pennylane, que la facture
-- F-AB-2026-11-107 est l'ACOMPTE (vérification décrite dans le compte rendu du 09/11/2026).
--
-- Origine (analyse du 09/11, code du dépôt) : le 06/11 à 13:59 la synchronisation tournait sur le code v1.51.0 (commit 2cbd65e, en
-- ligne depuis le 28/10) : le solde attendu = cession − acomptes facturés = 228,99 € = montant de la facture 107 → reliée au solde,
-- montant figé. La règle « solde douteux » (v1.56.9, fonction pennylane v16 du 07/11, gardée en v17) signale désormais ce cas
-- « à rattacher » sans rien relier.
--
-- Ce que fait l'opération (une transaction, tout ou rien) :
--  1. INVENTAIRE en lecture seule (section 1, à lancer d'abord, seule) ;
--  2. vérifie l'état exact attendu (identifiants, numéros, montants, dates, absence d'envoi / de paiement du solde, journal, aucun
--     rattachement ni signalement existant, n° F-AB-2026-11-33 inconnu ailleurs, aucune autre facture Pennylane connue pour la date,
--     migrations v1.56.9 et v1.60.6 en place) ; au moindre écart : arrêt, RIEN n'est modifié ;
--  3. appelle la fonction existante public.pennylane_rattacher (v1.56.9 — même chemin que l'action « Corriger » de l'application) :
--     - ACOMPTE : reçoit le lien Pennylane (id, page) ; garde son n° F-AB-2026-11-107, sa date d'envoi (05/11), sa date de facture
--       (05/11) et son montant figé 228,99 € (ligne émise : montant inchangé, v1.42) ;
--     - SOLDE : perd n°, lien, date de facture, relance, rangement Drive ; son montant figé par la synchronisation (journal : dernière
--       écriture du montant par service_role = 228,99) est vidé → il reprend son montant CALCULÉ (cession − acomptes facturés) ;
--     - historique dans pennylane_rattachements (motif) : la synchronisation ne relie plus jamais cette facture automatiquement ;
--     - journal financier (finance_log) écrit par les déclencheurs habituels (aucun déclencheur désactivé) ;
--  4. contrôle le résultat (lignes, journal, historique, rappels v1.60.6) ; sinon tout est annulé.
-- Ensuite : le solde redevient « à facturer » → rappel « Facture de solde à faire » au jour ouvré de J-7 (mercredi 25/11/2026) ;
-- la notification « Facture à envoyer : Solde (F-AB-2026-11-107) » retirée le 09/11 (clé « …:retire-v1.60.6 ») ne revient pas :
-- le solde n'est plus une facture faite (aucun candidat « facture_envoi » pour lui).
--
-- Ne touche à AUCUN document Pennylane (aucune création, modification ni envoi), à aucun fichier Drive (un PDF déjà rangé sous le nom
-- « … Solde » le reste : à renommer à la main si Anthony le souhaite — voir l'inventaire, drive_file_id), à aucun mail, à aucune autre
-- date ni ligne. Rejouable : une deuxième exécution reconnaît l'état corrigé et s'arrête sans rien modifier.
-- Retour arrière : supabase/retours-arriere/2026-11-09_brise_glace_rattachement_retour_arriere.sql
--
-- Exécution (après accord) : dans la même séance SQL, d'abord
--   set operation.confirmation = '107-est-l-acompte';
--   set operation.operateur = '<adresse de l''équipe qui a confirmé, ex. anthony@…>';   -- doit figurer dans app_users
-- puis la section 2. L'opérateur est noté comme auteur dans pennylane_rattachements et finance_log (source « application / fonction
-- serveur », celle de pennylane_rattacher).

-- ─────────────── 1. Inventaire (lecture seule) ───────────────
select s.id, s.date, s.venue, s.city, s.status, coalesce(s.prod_mode, 'production') mode, s.fee_ht, s.pennylane_quote_id,
       s.archived_at, s.result_closed_at
  from public.shows s where s.id::text like 'b021e7d4-%';
select p.id, p.kind, p.label, p.pct, p.amount, public.payment_amount_now(p) montant_retenu, p.invoice_number, p.invoiced_on, p.sent_at,
       p.paid_at, p.reminded_at, p.pennylane_id, p.pennylane_url, p.drive_file_id, p.hors_calcul, p.sort
  from public.show_payments p where p.show_id::text like 'b021e7d4-%' order by p.sort, p.kind;
select f.at, f.actor, f.source, f.row_id, f.field, f.old_value, f.new_value
  from public.finance_log f where f.show_id::text like 'b021e7d4-%' order by f.at, f.id;
select 'rattachements' t, count(*) from public.pennylane_rattachements where pennylane_id = '34170228875264'
union all select 'à rattacher', count(*) from public.pennylane_a_rattacher where pennylane_id = '34170228875264'
union all select 'n° 107 ou 33 à rattacher / déjà rattaché (toutes dates)', (select count(*) from public.pennylane_a_rattacher
    where upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) in ('FAB202611107', 'FAB20261133'))
  + (select count(*) from public.pennylane_rattachements where upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) in ('FAB202611107', 'FAB20261133'))
union all select 'autres factures Pennylane connues de la date', (select count(*) from public.pennylane_a_rattacher where show_id::text like 'b021e7d4-%')
  + (select count(*) from public.pennylane_rattachements where show_id::text like 'b021e7d4-%')
  + (select count(*) from public.show_payments where show_id::text like 'b021e7d4-%' and pennylane_id is not null and pennylane_id <> '34170228875264')
union all select 'autres lignes avec cette facture', count(*) from public.show_payments
  where show_id::text not like 'b021e7d4-%' and (pennylane_id = '34170228875264'
        or upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) in ('FAB202611107', 'FAB20261133'));
-- état de synchronisation : la fonction pennylane ne tient pas de journal de ses passages ; indices lisibles en base : dernière
-- écriture du serveur (service_role) sur les lignes de la date, dernier signalement vu pour la date, dernier signalement vu tous
-- dossiers confondus (mis à jour à chaque passage qui signale au moins une facture)
select 'état de synchronisation' t,
       (select max(f.at) from public.finance_log f where f.show_id::text like 'b021e7d4-%' and f.actor = 'service_role') derniere_ecriture_serveur_date,
       (select max(r.last_seen_at) from public.pennylane_a_rattacher r where r.show_id::text like 'b021e7d4-%') dernier_signalement_date,
       (select max(r.last_seen_at) from public.pennylane_a_rattacher r) dernier_signalement_tous_dossiers;
select n.created_at, n.kind, n.title, n.dedupe_key, n.withdrawn_at, n.withdrawn_reason
  from public.notifications n where n.show_id::text like 'b021e7d4-%' and n.kind in ('facture_envoi', 'solde_envoi', 'acompte_paye', 'solde_paye')
  order by n.created_at;
select c.r, c.k, c.raw, c.nxt, c.t from public.reminder_candidates((select id from public.shows where id::text like 'b021e7d4-%'), true) c
  where c.r in ('facture_envoi', 'solde_envoi', 'facture_acompte', 'acompte_paye', 'solde_paye');

-- ─────────────── 2. Correction (après lecture de l'inventaire et confirmation d'Anthony) ───────────────
do $op$
declare
  pid constant text := '34170228875264';
  num constant text := 'F-AB-2026-11-107';
  conf text := coalesce(current_setting('operation.confirmation', true), '');
  qui text := lower(btrim(coalesce(current_setting('operation.operateur', true), '')));
  motif constant text := 'Opération contrôlée du 09/11/2026 (Brise Glace, 02/12/2026) : F-AB-2026-11-107 est la facture d''ACOMPTE '
    || '(vérifiée dans Pennylane par Anthony) ; reliée au solde le 06/11 par la synchronisation antérieure à la v1.56.9 (montants 50/50 identiques)';
  s public.shows; a public.show_payments; so public.show_payments; a2 public.show_payments; so2 public.show_payments; n int; figee boolean; reste numeric; cands int;
begin
  -- confirmation explicite et opérateur de l'équipe
  if conf <> '107-est-l-acompte' then
    raise exception 'Brise Glace : confirmation absente (set operation.confirmation = ''107-est-l-acompte'') : rien n''est modifié';
  end if;
  if qui = '' or not exists (select 1 from public.app_users where lower(email) = qui) then
    raise exception 'Brise Glace : opérateur absent ou hors équipe (set operation.operateur = ''…'') : rien n''est modifié';
  end if;
  -- migrations nécessaires en place
  if to_regprocedure('public.pennylane_rattacher(text,uuid,text)') is null
     or position('rattachement_pennylane' in pg_get_functiondef('public.show_payments_emitted_guard'::regproc)) = 0 then
    raise exception 'Brise Glace : migration v1.56.9 absente : rien n''est modifié';
  end if;
  if position('v1.60.6 solde J-7' in pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure)) = 0 then
    raise exception 'Brise Glace : migration v1.60.6 absente : rien n''est modifié';
  end if;

  -- la date : une seule, attendue
  select count(*) into n from public.shows where id::text like 'b021e7d4-%';
  if n <> 1 then raise exception 'Brise Glace : % date(s) b021e7d4-… (attendu 1) : rien n''est modifié', n; end if;
  select * into s from public.shows where id::text like 'b021e7d4-%';
  if s.date <> date '2026-12-02' or coalesce(s.prod_mode, 'production') = 'booking' or s.archived_at is not null or s.result_closed_at is not null then
    raise exception 'Brise Glace : date différente de l''état attendu (jour %, mode %, archivée %, résultat clôturé %) : rien n''est modifié',
      s.date, s.prod_mode, s.archived_at, s.result_closed_at;
  end if;
  select count(*) into n from public.show_payments where show_id = s.id and kind in ('acompte', 'solde') and hors_calcul is null;
  if n <> 2 then raise exception 'Brise Glace : % lignes d''acompte / solde (attendu 2) : rien n''est modifié', n; end if;
  select * into a from public.show_payments where show_id = s.id and id::text like 'd83eda31-%' and kind = 'acompte' for update;
  if not found then raise exception 'Brise Glace : ligne d''acompte d83eda31-… introuvable : rien n''est modifié'; end if;
  select * into so from public.show_payments where show_id = s.id and id::text like '7ac2937a-%' and kind = 'solde' for update;
  if not found then raise exception 'Brise Glace : ligne de solde 7ac2937a-… introuvable : rien n''est modifié'; end if;

  -- déjà appliquée ? (rejeu) : état corrigé reconnu → rien à faire
  if a.pennylane_id = pid and so.pennylane_id is null and so.invoice_number is null and so.amount is null
     and exists (select 1 from public.pennylane_rattachements h where h.pennylane_id = pid and h.from_payment_id = so.id and h.to_payment_id = a.id
                   and h.motif like 'Opération contrôlée du 09/11/2026 (Brise Glace%') then
    raise notice 'Brise Glace : opération déjà appliquée (facture 107 sur l''acompte, historique présent) : rien n''est modifié';
    return;
  end if;

  -- état exact attendu (faits relevés le 09/11/2026)
  if not (a.pct = 50 and a.amount = 228.99 and a.sent_at = date '2026-11-05' and a.invoiced_on = date '2026-11-05' and a.paid_at is null
          and a.pennylane_id is null and a.pennylane_url is null and a.invoice_number = num and a.hors_calcul is null) then
    raise exception 'Brise Glace : acompte différent de l''état attendu (%) : rien n''est modifié', to_jsonb(a) - 'file_path' - 'file_name';
  end if;
  if not (so.pct = 50 and so.amount = 228.99 and so.sent_at is null and so.paid_at is null and so.invoiced_on = date '2026-11-05'
          and so.pennylane_id = pid and so.invoice_number = num and so.hors_calcul is null) then
    raise exception 'Brise Glace : solde différent de l''état attendu (déjà envoyé, payé, autre facture ?) (%) : rien n''est modifié', to_jsonb(so) - 'file_path' - 'file_name';
  end if;
  select count(*) into n from public.show_payments where id not in (a.id, so.id)
     and (pennylane_id = pid or upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = 'FAB202611107');
  if n > 0 then raise exception 'Brise Glace : la facture 107 figure sur % autre(s) ligne(s) : rien n''est modifié', n; end if;
  -- n° 33 (premier n° noté sur l'acompte) : s'il est connu ailleurs COMME FACTURE (F-AB-2026-11-33, comparaison normalisée qui ne
  -- confond pas le devis D-AB-2026-11-33 — préfixe F), 33 est peut-être une autre facture → arrêt (relecture de 3dd83dd, B1).
  -- Même contrôle pour 107 hors de ces deux lignes.
  select count(*) into n from public.show_payments where id not in (a.id, so.id)
     and upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = 'FAB20261133';
  if n > 0 then raise exception 'Brise Glace : le n° F-AB-2026-11-33 figure sur % autre(s) ligne(s) : vérifier quel document est l''acompte, rien n''est modifié', n; end if;
  if exists (select 1 from public.pennylane_a_rattacher where upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) in ('FAB20261133', 'FAB202611107'))
     or exists (select 1 from public.pennylane_rattachements where upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) in ('FAB20261133', 'FAB202611107')) then
    raise exception 'Brise Glace : une facture F-AB-2026-11-33 ou -107 est déjà signalée ou rattachée : vérifier quel document est l''acompte, rien n''est modifié';
  end if;
  -- toute AUTRE facture Pennylane connue pour cette date (signalée, rattachée ou reliée à une autre ligne) : arrêt
  if exists (select 1 from public.pennylane_a_rattacher where show_id = s.id and pennylane_id <> pid)
     or exists (select 1 from public.pennylane_rattachements where show_id = s.id and pennylane_id <> pid)
     or exists (select 1 from public.show_payments where show_id = s.id and nullif(btrim(pennylane_id), '') is not null and pennylane_id <> pid) then
    raise exception 'Brise Glace : une autre facture Pennylane est connue pour cette date : situation différente de celle analysée, rien n''est modifié';
  end if;
  if exists (select 1 from public.pennylane_rattachements where pennylane_id = pid) then
    raise exception 'Brise Glace : un rattachement manuel de la facture 107 existe déjà : rien n''est modifié';
  end if;
  if exists (select 1 from public.pennylane_a_rattacher where pennylane_id = pid) then
    raise exception 'Brise Glace : la facture 107 est déjà signalée « à rattacher » : à traiter par l''action de l''application, rien n''est modifié';
  end if;
  -- journal : montant du solde figé par la synchronisation (dernière écriture du montant par service_role, 228,99) → la fonction le
  -- vide et le solde redevient calculé ; numéro de l'acompte passé de 33 à 107 par l'équipe le 06/11
  select coalesce((select f.actor = 'service_role' and f.new_value = '228.99' from public.finance_log f
     where f.table_name = 'show_payments' and f.row_id = so.id and f.field = 'amount' order by f.at desc, f.id desc limit 1), false) into figee;
  if not figee then raise exception 'Brise Glace : le montant du solde n''a pas été figé par la synchronisation (journal) : rien n''est modifié'; end if;
  if not exists (select 1 from public.finance_log f where f.row_id = a.id and f.field = 'invoice_number' and f.old_value = 'F-AB-2026-11-33' and f.new_value = num) then
    raise exception 'Brise Glace : changement de n° de l''acompte (33 → 107) absent du journal : rien n''est modifié';
  end if;

  -- correction : chemin officiel (fonction v1.56.9), en tant que l'opérateur de l'équipe, pour cette transaction seulement
  perform set_config('request.jwt.claims', jsonb_build_object('email', qui, 'role', 'authenticated')::text, true);
  perform public.pennylane_rattacher(pid, a.id, motif);
  perform set_config('request.jwt.claims', '', true);   -- local à la transaction (true) : rien ne reste dans la séance

  -- contrôles après correction (sinon tout est annulé)
  select * into a2 from public.show_payments where id = a.id;
  select * into so2 from public.show_payments where id = so.id;
  if not (a2.pennylane_id = pid and a2.invoice_number = num and a2.pennylane_url is not distinct from so.pennylane_url and a2.sent_at = date '2026-11-05'
          and a2.invoiced_on = date '2026-11-05' and a2.amount = 228.99 and a2.pct = 50 and a2.paid_at is null) then
    raise exception 'Brise Glace : acompte inattendu après correction (%) : tout est annulé', to_jsonb(a2);
  end if;
  if not (so2.pennylane_id is null and so2.pennylane_url is null and so2.invoice_number is null and so2.invoiced_on is null and so2.sent_at is null
          and so2.paid_at is null and so2.amount is null and so2.pct = 50 and so2.reminded_at is null and so2.drive_file_id is null) then
    raise exception 'Brise Glace : solde inattendu après correction (%) : tout est annulé', to_jsonb(so2);
  end if;
  reste := public.payment_amount_now(so2);
  if reste is null or reste <> greatest(0, round((coalesce(s.fee_ht, 0) - 228.99) * 100) / 100) then
    raise exception 'Brise Glace : montant calculé du solde inattendu (%) : tout est annulé', reste;
  end if;
  if (select count(*) from public.pennylane_rattachements where pennylane_id = pid and from_payment_id = so.id and to_payment_id = a.id and actor = qui) <> 1 then
    raise exception 'Brise Glace : historique du rattachement absent : tout est annulé';
  end if;
  -- rappels v1.60.6 : « Facture de solde à faire » au jour ouvré de J-7 ; plus aucun « Facture à envoyer » pour le solde
  select count(*) into cands from public.reminder_candidates(s.id, true) c where c.r = 'solde_envoi' and c.raw = date '2026-11-25';
  if cands <> 1 then raise exception 'Brise Glace : rappel « Facture de solde à faire » du 25/11 absent : tout est annulé'; end if;
  select count(*) into cands from public.reminder_candidates(s.id, true) c where c.r = 'facture_envoi' and c.k = s.id || ':' || so.id;
  if cands <> 0 then raise exception 'Brise Glace : « Facture à envoyer » encore candidat pour le solde : tout est annulé'; end if;
  if exists (select 1 from public.notifications where show_id = s.id and kind = 'facture_envoi' and withdrawn_at is null
               and dedupe_key like 'facture_envoi:' || s.id || ':' || so.id || ':%') then
    raise exception 'Brise Glace : une notification « Facture à envoyer » du solde est active : tout est annulé';
  end if;
  raise notice 'Brise Glace : facture % reliée à l''acompte %, solde % libéré (montant calculé % €) ; rappel solde au 25/11/2026 ; Drive de la ligne quittée : %',
    num, a.id, so.id, to_char(reste, 'FM999999990.00'), coalesce(so.drive_file_id, 'aucun PDF rangé');
end $op$;

-- ─────────────── 3. Vérification (lecture seule, après la section 2) ───────────────
select p.id, p.kind, p.amount, public.payment_amount_now(p) montant_retenu, p.invoice_number, p.invoiced_on, p.sent_at, p.paid_at, p.pennylane_id, p.drive_file_id
  from public.show_payments p where p.show_id::text like 'b021e7d4-%' order by p.sort, p.kind;
select h.at, h.actor, h.from_payment_id, h.to_payment_id, h.motif from public.pennylane_rattachements h where h.pennylane_id = '34170228875264';
