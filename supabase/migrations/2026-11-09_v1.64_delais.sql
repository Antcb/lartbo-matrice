-- =====================================================================================================
-- v1.64 — Délais et automatismes (demande d'Anthony du 09/11/2026, §2) : les délais EXISTANTS des rappels deviennent réglables
-- (Réglages › Délais et automatismes) ; AUCUN nouvel automatisme. Même règle côté application : js/reminders.js (DELAY_RULES,
-- delaysOf, remindersOf).
--
-- Réglage « delais » (table settings, clé existante ou absente) : {règle: [{on, n, from, at, by}]} — versions dans l'ordre
-- d'enregistrement ; from = null : toutes les dates ; from = instant d'enregistrement ('AAAA-MM-JJTHH:MM:SS(.mmm)Z') : seulement
-- les dates créées (shows.created_at) à partir de cet INSTANT (décision d'Anthony du 09/11). La dernière version LISIBLE applicable
-- l'emporte ; une version illisible est ignorée (la précédente reste appliquée, sinon la valeur par défaut) : un réglage abîmé
-- n'arrête jamais generate_reminders. SANS réglage : valeurs par défaut (v1.60.6, solde à J-7) ; seul changement par défaut décidé
-- le 09/11 : les délais de 0 jour (facture d'acompte, facture de commission booking, boucle communication) suivent aussi la règle
-- du lundi (échéance samedi / dimanche → lundi), comme les autres délais après une étape. Clés anti-doublon inchangées.
-- Week-ends (réglables, versions weekend_apres / weekend_avant du même réglage, activées par défaut) : délai après une étape →
-- lundi suivant ; boucle accueil & technique (avant le concert) → vendredi précédent. Solde : règle v1.60.6 fixe (J-n calendaire,
-- samedi / dimanche → vendredi), jamais concernée par ces réglages.
-- Réglages simples (nouvelles tâches / nouveaux documents seulement, jamais recalculés) contrôlés à l'écriture : prospect_relance_on,
-- prospect_relance_days, prospect_relance_max, booking_task_days, pennylane_payment_days, pennylane_quote_days (contrainte
-- settings_reglages_simples, fonction reglage_simple_ok ; même contrôle que js/reminders.js taskDelay et regles.ts delaiDocument).
-- Aucune ligne de settings n'est créée ni modifiée par cette migration.
--
-- Clé anti-doublon : INCHANGÉE pour toutes les notifications existantes. Elle garde l'échéance brute calculée avec les délais par
-- défaut (constantes historiques ci-dessous, jamais à modifier) ; l'échéance réelle suit le réglage. Changer un délai ne recrée donc
-- jamais une notification déjà créée pour la même étape (pas de doublon), et ne fait partir une relance qu'à sa nouvelle échéance.
-- generate_reminders forme la clé avec r:k (k contient déjà l'échéance brute par défaut) au lieu de r:k:raw — même texte de clé.
--
-- Règles propres à une date (priment sur le réglage général, déjà en place, réutilisées telles quelles) : relances suspendues d'une
-- date restaurée (reminders_suspended_at), prochaine échéance choisie à la réactivation (reminders_next, plancher), relances
-- d'impayé suspendues facture par facture (show_payments.reminders_paused).
--
-- Garde (avant toute écriture) : generate_reminders = v1.60.3 (md5(pg_get_functiondef) 584374b0cb052c5fa226427b837b30a1) et
-- reminder_candidates = v1.60.6 (808cb33bf574c49d64279f7dceecbde9, migration 2026-11-09_v1.60.6_solde_j7.sql), ou déjà cette version
-- (marqueur « v1.64 délais ») ; sinon arrêt, rien n'est appliqué.
-- ORDRE OBLIGATOIRE : migration v1.60.6, PUIS l'opération supabase/operations/2026-11-09_v1.60.6_rappels_solde.sql, PUIS cette
-- migration. L'opération v1.60.6 reconstruit les clés au format v1.60.6 (règle:k:échéance) : lancée après la v1.64, elle ne trouverait
-- rien et s'arrêterait sans rien modifier (garde « attendu »), et le rappel prématuré resterait actif.
-- PUBLICATION DU LOT (dans l'ordre, après la v1.60.6 publiée) : 1. cette migration (projet de test, puis production après contrôle
-- des empreintes) ; 2. redéploiement de la fonction edge « pennylane » (index.ts + regles.ts : délais des nouveaux documents lus
-- dans settings ; sans réglage : 14 j / 30 j comme avant) et vérification que la version en ligne est identique au dépôt ;
-- 3. fusion de la branche (application). Aucun script Google modifié. Aucune donnée existante modifiée.
-- Rejouable (create or replace, contrainte ajoutée si absente). Retour arrière (après accord) : réappliquer reminder_candidates de la
-- v1.60.6 et generate_reminders de la v1.60.3 ; les fonctions delais_* / reglage_simple_ok et les contraintes settings_delais_valide /
-- settings_reglages_simples peuvent rester (sans effet sur les rappels).
-- =====================================================================================================

do $m$
declare b text;
begin
  b := pg_get_functiondef('public.generate_reminders()'::regprocedure);
  if md5(b) <> '584374b0cb052c5fa226427b837b30a1' and position('v1.64 délais' in b) = 0 then
    raise exception 'v1.64 : generate_reminders n''est pas la version v1.60.3 attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  b := pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure);
  if md5(b) <> '808cb33bf574c49d64279f7dceecbde9' and position('v1.64 délais' in b) = 0 then
    raise exception 'v1.64 : reminder_candidates n''est pas la version v1.60.6 attendue (empreinte %) : appliquer d''abord 2026-11-09_v1.60.6_solde_j7.sql ; migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;

-- ─────────────── 1. Délais d'une date (même résolution que js/reminders.js delaysOf) ───────────────
-- Délai lisible d'une version : nombre entier (5 ou 5.0, comme okN en JS) entre 0 et la borne ; sinon null (défaut gardé)
create or replace function public.delais_n(p jsonb, p_max int) returns int
 language sql immutable set search_path to 'public'
as $function$
  select case when jsonb_typeof(p) = 'number'
              then case when p::numeric >= 0 and p::numeric <= p_max and p::numeric = trunc(p::numeric) then p::numeric::int end end
$function$;
revoke all on function public.delais_n(jsonb, int) from public, anon;
grant execute on function public.delais_n(jsonb, int) to authenticated, service_role;

-- Instant « AAAA-MM-JJTHH:MM:SS(.mmm)Z » lu sans jamais lever d'erreur : forme exacte ET instant réel (30 février, 9999-99-99,
-- an 0, 25 h → null) ; même contrôle que okFrom (js/reminders.js). Une version dont « from » est illisible est ignorée.
create or replace function public.delais_instant(p text) returns timestamptz
 language plpgsql immutable set search_path to 'public'
as $function$
declare t timestamptz;
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' or left(p, 4) = '0000' then return null; end if;
  t := p::timestamptz;
  if to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') <> left(p, 19) then return null; end if;
  return t;
exception when others then return null;
end $function$;
revoke all on function public.delais_instant(text) from public, anon;
grant execute on function public.delais_instant(text) to authenticated, service_role;

-- Version lisible (même règle que okVersion, js/reminders.js) : objet ; on booléen ou absent ; n entier dans les bornes ;
-- from absent, null ou instant réel
create or replace function public.delais_version_ok(x jsonb, p_max int) returns boolean
 language sql immutable set search_path to 'public'
as $function$
  select coalesce(jsonb_typeof(x) = 'object'
    and (not (x ? 'on') or jsonb_typeof(x -> 'on') = 'boolean')
    and public.delais_n(x -> 'n', p_max) is not null
    and (not (x ? 'from') or jsonb_typeof(x -> 'from') = 'null'
         or (jsonb_typeof(x -> 'from') = 'string' and public.delais_instant(x ->> 'from') is not null)), false)
$function$;
revoke all on function public.delais_version_ok(jsonb, int) from public, anon;
grant execute on function public.delais_version_ok(jsonb, int) to authenticated, service_role;

-- Valeurs par défaut : MÊMES valeurs que DELAY_RULES (js/reminders.js) — contrôle automatique : tests/static/delais.mjs.
create or replace function public.delais_dossier(p_created timestamptz)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with def(k, n, mx) as (values ('precontrat', 10, 365), ('contrat_envoi', 10, 365), ('contrat_signe', 10, 365), ('contrat_cosigne', 10, 365),
         ('facture_acompte', 0, 365), ('solde_envoi', 7, 365), ('booking_commission', 0, 365), ('facture_envoi', 3, 365), ('paiement', 10, 365),
         ('commission', 10, 365), ('commission_partenaire', 10, 365), ('boucle_accueil', 4, 24), ('boucle_com', 0, 365),
         ('weekend_apres', 0, 0), ('weekend_avant', 0, 0)),
  reg as (select value v from settings where key = 'delais' and jsonb_typeof(value) = 'object')
  select jsonb_object_agg(def.k, coalesce((
    select jsonb_build_object('on', not coalesce(x -> 'on' = 'false'::jsonb, false), 'n', public.delais_n(x -> 'n', def.mx))
    from reg, jsonb_array_elements(case when jsonb_typeof(reg.v -> def.k) = 'array' then reg.v -> def.k else '[]'::jsonb end) with ordinality e(x, i)
    where public.delais_version_ok(x, def.mx)
      and (not (x ? 'from') or jsonb_typeof(x -> 'from') = 'null'
           or (p_created is not null and p_created >= public.delais_instant(x ->> 'from')))
    order by i desc limit 1), jsonb_build_object('on', true, 'n', def.n)))
  from def
$function$;
revoke all on function public.delais_dossier(timestamptz) from public, anon, authenticated, service_role;

-- Contrôle à l'écriture du réglage « delais » (relecture de 86d397e) : règles connues, versions lisibles (delais_version_ok) ;
-- at / by (trace) libres. Contrainte de table plutôt que setting_write_ok (texte v1.60.4 inchangé, aucune autre clé touchée) :
-- elle vaut pour tous les comptes, y compris le serveur. Aucune ligne existante (réglage absent).
create or replace function public.delais_valide(v jsonb) returns boolean
 language plpgsql immutable set search_path to 'public'
as $function$
declare k text; liste jsonb; x jsonb; mx int;
begin
  if jsonb_typeof(v) is distinct from 'object' then return false; end if;
  for k, liste in select key, value from jsonb_each(v) loop
    mx := case when k = 'boucle_accueil' then 24 when k in ('weekend_apres', 'weekend_avant') then 0
               when k in ('precontrat', 'contrat_envoi', 'contrat_signe', 'contrat_cosigne', 'facture_acompte', 'solde_envoi', 'booking_commission',
                          'facture_envoi', 'paiement', 'commission', 'commission_partenaire', 'boucle_com') then 365 end;
    if mx is null or jsonb_typeof(liste) <> 'array' then return false; end if;
    for x in select value from jsonb_array_elements(liste) loop
      if not public.delais_version_ok(x, mx) then return false; end if;
    end loop;
  end loop;
  return true;
end $function$;
revoke all on function public.delais_valide(jsonb) from public, anon;
grant execute on function public.delais_valide(jsonb) to authenticated, service_role;

-- Réglages simples (nouvelles tâches / nouveaux documents) : booléen ou entier dans les bornes, sinon refus à l'écriture ; une
-- valeur absente ou illisible donne la valeur par défaut à la lecture (taskDelay, delaiDocument). Autres clés : non concernées.
create or replace function public.reglage_simple_ok(k text, v jsonb) returns boolean
 language sql immutable set search_path to 'public'
as $function$
  select case k
    when 'prospect_relance_on' then jsonb_typeof(v) = 'boolean'
    when 'prospect_relance_days' then public.delais_n(v, 365) is not null
    when 'booking_task_days' then public.delais_n(v, 365) is not null
    when 'pennylane_payment_days' then public.delais_n(v, 365) is not null
    when 'prospect_relance_max' then coalesce(public.delais_n(v, 10) >= 1, false)
    when 'pennylane_quote_days' then coalesce(public.delais_n(v, 365) >= 1, false)
    else true end
$function$;
revoke all on function public.reglage_simple_ok(text, jsonb) from public, anon;
grant execute on function public.reglage_simple_ok(text, jsonb) to authenticated, service_role;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_reglages_simples' and conrelid = 'public.settings'::regclass) then
    alter table public.settings add constraint settings_reglages_simples check (public.reglage_simple_ok(key, value));
  end if;
end $c$;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_delais_valide' and conrelid = 'public.settings'::regclass) then
    alter table public.settings add constraint settings_delais_valide check (key <> 'delais' or public.delais_valide(value));
  end if;
end $c$;

-- ─────────────── 2. Relances candidates (RÉÉCRITE ENTIÈREMENT, §7.5 ; texte v1.60.6 + délais réglables) ───────────────
-- v1.64 délais : chaque règle lit son activation (on) et son délai (n) dans delais_dossier(created_at) ; k = clé anti-doublon
-- complète sauf la règle (échéance brute calculée avec les délais par DÉFAUT, constantes historiques) ; raw = échéance réelle.
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
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn
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
    union all select 'facture_acompte', id, id || ':' || contract_sent, contract_sent + n_fa, wa, 'Facture d’acompte à faire (contrat envoyé)' from d where on_fa and mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not coalesce(so_emis, false)
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
                          else faite_le + n_fe end, wa, 'Facture à envoyer : ' || nom from f where on_fe and faite and sent_at is null and paid_at is null
    -- facture envoyée impayée : n jours (10 par défaut) après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end || ':' || (greatest(sent_at, reminded_at) + 10),
                     greatest(sent_at, reminded_at) + n_pa, wa,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where on_pa and sent_at is not null and paid_at is null and not reminders_paused
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
revoke all on function public.reminder_candidates(uuid, boolean) from public, anon, authenticated, service_role;

-- ─────────────── 3. Notifications (RÉÉCRITE ENTIÈREMENT, §7.5 ; texte v1.60.3 : clé règle:k, vendredi de la boucle calculé en amont) ───────────────
create or replace function public.generate_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  -- relances candidates : reminder_candidates (dates confirmées, sans date archivée — archived_at — ni relances suspendues)
  -- v1.64 délais : clé anti-doublon = règle:k[:a…] (k porte l'échéance brute par défaut : même clé qu'avant pour toutes les
  -- notifications existantes) ; l'échéance réelle (raw) suit le réglage « delais »
  with ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || c.venue,
           concat_ws(' · ', nullif(c.proj,''), to_char(c.date, 'DD/MM/YYYY'), c.city),
           c.show_id, c.r || ':' || c.k || coalesce(':a' || c.reactiv, '')   -- v1.60.3 : clés propres après réactivation
    from public.reminder_candidates(null, false) c
    -- échéance : J+n décalée au lundi (w, politique des week-ends) ; boucle accueil & technique : vendredi précédent déjà appliqué
    -- v1.60.3 : relances réactivées après une restauration — la relance ne part qu'à la prochaine échéance choisie pour elle
    -- (reminders_next), jamais avant son échéance d'origine (greatest)
    -- v1.64 : le vendredi de la boucle accueil & technique est déjà dans raw (politique des week-ends, reminder_candidates)
    where c.raw is not null and greatest(case when c.w then public.workday(c.raw) else c.raw end, (c.nxt ->> c.r)::date)
                                <= (now() at time zone 'Europe/Paris')::date   -- jour de Paris (C §1.2)
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;
revoke all on function public.generate_reminders() from public, anon, authenticated, service_role;
grant execute on function public.generate_reminders() to service_role;
