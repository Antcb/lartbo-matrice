-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v1.60.4 — CAS D'ESSAI ISOLÉ « ESSAI promo » : promotion locale d'une coproduction (retour d'Anthony du 08/11/2026)
-- Données 100 % FICTIVES, identifiants FIXES, retirées exactement par 2026-11-08_v1.60.4_essai_promo_nettoyage.sql.
-- JAMAIS EN PRODUCTION (décision d'Anthony du 08/11/2026 : pas de données fictives dans les comptes opérationnels pour refaire un
-- calcul déjà vérifié) : le script s'arrête s'il reconnaît le projet de production. Exécuté par l'agent sur une base PostgreSQL
-- jetable locale construite depuis les migrations du dépôt (résultats : tests/outils/essai-promo.mjs) ; utilisable aussi sur
-- « Lartbo-matrice-test ». Aucun partenaire, artiste, structure, contact ou compte réel n'est utilisé ni modifié.
--
-- Ce que le script crée (et rien d'autre) :
--   • artiste   e55a1000-0000-4000-a000-000000000001  « ESSAI promo »  — INACTIF (hors des listes et totaux par défaut), mode production,
--               sans compte dédié (aucun solde de compte), sans partenaire par défaut ;
--   • coproducteur (partners) e55a1000-0000-4000-a000-000000000002 « ESSAI promo — coproducteur fictif » ;
--   • structure e55a1000-0000-4000-a000-000000000003 « ESSAI promo — salle fictive » — INACTIVE (cachée de la liste des structures),
--               sans coordonnées (absente de la carte), sans contact (rien vers Brevo) ;
--   • 3 dates « Co-Production » confirmées, PASSÉES (10, 11 et 12/10/2026 : aucune relance administrative), une par cas :
--       …011  cas 1 : promotion = charge commune          · billetterie encaissée par le coproducteur · promo payée par L'ArtBo
--       …012  cas 2 : promotion = L'ArtBoristerie seule   · billetterie encaissée par L'ArtBo          · promo payée par le coproducteur
--       …013  cas 3 : promotion = le coproducteur seul    · billetterie encaissée par le coproducteur · promo payée par L'ArtBo
--     → celui qui SUPPORTE la promotion (promo_debtor) est chaque fois distinct de celui qui la PAIE (promo_payer) ;
--   • 6 lignes de dépenses (2 par date) : « Location salle (essai) » 3 000 € payée par le coproducteur, « Technique (essai) » 1 500 €
--     payée par L'ArtBo, toutes deux payées le 14/10/2026.
--
-- Garde-fous :
--   • coproduction : la base ne crée AUCUNE ligne de facturation (on_show_confirmed) → rien dans Pennylane, factures, commissions,
--     indicateurs de Production (montants nuls), relances de factures ;
--   • dossier Drive : drive_folder_requested_at et drive_folder_error renseignés → on_show_confirmed n'appelle PAS le script Google
--     (aucun dossier créé). Dans l'application, ne pas cliquer « Créer le dossier » ni « Lier un dossier » sur ces dates ;
--   • dates passées sans étape de suivi ni facture : generate_reminders n'en tire aucune notification (reminder_candidates) ;
--   • « Communication » désactivée sur les dates ; aucun contact, aucun suivi, aucune tâche créés ;
--   • l'artiste inactif est masqué partout par défaut (Booking, Production, Ticketing, carte, totaux) : pour l'essai, choisir
--     « ESSAI promo » dans le filtre Artistes (ou « Afficher les inactifs »), année 2026, onglet Production.
--   Ce qui PEUT encore le voir (aucun mécanisme d'exclusion existant) : la sauvegarde nocturne / l'export JSON (copie des tables) ;
--   le journal financier finance_log (écrit par déclencheur à chaque création / modification / suppression des dates : il garde
--   ces lignes après le nettoyage, identifiables par leurs show_id fixes) ; les listes de choix (coproducteur dans les menus
--   « Coproducteur », structure dans la recherche avec les inactives en dernier) ; tout écran où l'on affiche volontairement les
--   artistes inactifs (totaux alors augmentés de 0 € : coproductions sans cachet ni facture).
--
-- RÉSULTATS ATTENDUS (calcul indépendant, fait à la main — vérifiés sur les mêmes données en fausse base par
-- tests/e2e/essai-promo-v1604.spec.js). Paramètres communs : 1 tarif « Plein » 21,10 € TTC (TVA 5,5 % → 20,00 € HT), 500 billets prévus,
-- 400 vendus ; CNM 3,5 % (taux posé sur la date : cnm_pct), SACEM 0 % (posée à 0 pour un calcul lisible), pas de DL ; dépenses 4 500 €
-- (3 000 coproducteur + 1 500 L'ArtBo) ; promotion locale 10 % de la recette nette ; partage : 50 % des bénéfices à L'ArtBo,
-- 40 % des pertes (artbo_loss_share, distinct, jamais déduit du % des bénéfices).
--
--   Réel (400 billets) : recette HT 8 000 ; CNM 280 ; recette nette 7 720 ; promo 772 ; résultat global = 7 720 − 4 500 − 772 = 2 448.
--   Prévu (500 billets) : recette HT 10 000 ; CNM 350 ; nette 9 650 ; promo 965 ; résultat global 4 185.
--
--   │ RÉEL                               │ cas 1 commune │ cas 2 L'ArtBo seule │ cas 3 coproducteur seul │
--   │ Résultat partagé                   │     2 448,00  │  3 220,00 (+772)    │  3 220,00 (+772)        │
--   │ Part de L'ArtBo                    │     1 224,00  │    838,00 (1 610−772)│  1 610,00               │
--   │ Part du coproducteur               │     1 224,00  │  1 610,00           │    838,00 (1 610−772)   │
--   │ Résultat global (somme des parts)  │     2 448,00  │  2 448,00           │  2 448,00               │
--   │ Recette nette gardée par l'encaisseur│ 7 720 (coprod)│  7 720 (L'ArtBo)   │  7 720 (coprod)         │
--   │ Payé par L'ArtBo (dépenses + promo)│ 1 500 + 772   │  1 500              │  1 500 + 772            │
--   │ Payé par le coproducteur           │     3 000     │  3 000 + 772        │  3 000                  │
--   │ Position L'ArtBo / coproducteur    │ −2 272 / 4 720│  6 220 / −3 772     │ −2 272 / 4 720          │
--   │ Avance de promotion (pour l'autre) │       0       │    772              │    772                  │
--   │ Reversement                        │ 3 496 coprod → L'ArtBo │ 5 382 L'ArtBo → coprod │ 3 882 coprod → L'ArtBo │
--   │ Contrôle : position + reversement = part │ 1 224 / 1 224 │ 838 / 1 610 │ 1 610 / 838            │
--   Pas de double déduction : la promotion n'est retirée qu'UNE fois (du résultat global ; et, quand une seule partie la supporte,
--   rajoutée au résultat partagé puis retirée de la seule part de cette partie) : part L'ArtBo + part coproducteur = résultat global.
--
--   │ PRÉVU (500 billets)                │ cas 1         │ cas 2               │ cas 3                   │
--   │ Résultat partagé                   │     4 185,00  │  5 150,00           │  5 150,00               │
--   │ Part de L'ArtBo / coproducteur     │ 2 092,50 / 2 092,50 │ 1 610,00 / 2 575,00 │ 2 575,00 / 1 610,00 │
--   │ Résultat global                    │     4 185,00  │  4 185,00           │  4 185,00               │
--
--   Points d'équilibre (prévu, un seul tarif : les trois scénarios donnent le même nombre ; par billet : HT 20 €, CNM 0,70 €,
--   nette 19,30 €, promo 1,93 €) :
--   │ Lecture                            │ cas 1         │ cas 2               │ cas 3                   │
--   │ Résultat partagé                   │   260 billets │   234 (19,30 n ≥ 4 500)  │   234                │
--   │ Part de L'ArtBo                    │   260         │   292 (7,72 n ≥ 2 250)   │   234                │
--   │ Résultat global (promo comprise)   │   260 (17,37 n ≥ 4 500) │ 260       │   260                   │
--
-- Clôture : les trois dates sont complètes (billets vendus, payeurs, dates de paiement, encaissement de la billetterie, promotion
-- supportée / payée / payée le) → reversement définitif (non provisoire) et « Clôturer le résultat » possible. Une clôture faite
-- pendant l'essai est retirée par le nettoyage (y compris son historique result_closures de ces 3 dates fictives seulement).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  -- cible déclarée explicitement (ligne « set essai.cible = 'jetable' | 'test'; » à placer avant ce script) : sans elle, rien
  if coalesce(current_setting('essai.cible', true), '') not in ('jetable', 'test') then
    raise exception 'ARRÊT : cible non déclarée. Ajoute avant le script : set essai.cible = ''jetable''; (ou ''test'' sur le projet de test). Jamais en production. Rien n''a été créé.';
  end if;
  -- jamais en production (identifiant du projet de production dans les réglages, même garde que les essais du 27/10/2026)
  if exists (select 1 from public.settings where value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRÊT : ceci est la PRODUCTION — l''essai « ESSAI promo » est réservé à une base jetable ou au projet de test. Rien n''a été créé.';
  end if;
  -- jamais par-dessus des données existantes : rien ne doit déjà porter ces identifiants ou ces noms
  if exists (select 1 from public.projects where id = 'e55a1000-0000-4000-a000-000000000001' or name = 'ESSAI promo')
     or exists (select 1 from public.partners where id = 'e55a1000-0000-4000-a000-000000000002' or name = 'ESSAI promo — coproducteur fictif')
     or exists (select 1 from public.structures where id = 'e55a1000-0000-4000-a000-000000000003' or name = 'ESSAI promo — salle fictive')
     or exists (select 1 from public.shows where id in ('e55a1000-0000-4000-a000-000000000011', 'e55a1000-0000-4000-a000-000000000012', 'e55a1000-0000-4000-a000-000000000013'))
     or exists (select 1 from public.budget_lines where id::text like 'e55a1000-0000-4000-a000-0000000000__') then
    raise exception 'ESSAI promo déjà présent (ou nom déjà pris) : lance d''abord 2026-11-08_v1.60.4_essai_promo_nettoyage.sql. Rien n''a été créé.';
  end if;
end $$;

insert into public.projects (id, name, active, mode, notes)
values ('e55a1000-0000-4000-a000-000000000001', 'ESSAI promo', false, 'production',
        'Données d''essai FICTIVES (v1.60.4, promotion locale en coproduction). À retirer avec supabase/repetitions/2026-11-08_v1.60.4_essai_promo_nettoyage.sql.');

insert into public.partners (id, name, default_pct, notes)
values ('e55a1000-0000-4000-a000-000000000002', 'ESSAI promo — coproducteur fictif', 0, 'Coproducteur FICTIF de l''essai v1.60.4 (aucune structure réelle).');

insert into public.structures (id, name, city, country, inactive_at, notes)
values ('e55a1000-0000-4000-a000-000000000003', 'ESSAI promo — salle fictive', 'Ville fictive', 'France', date '2026-11-08',
        'Structure FICTIVE de l''essai v1.60.4 (inactive : cachée par défaut ; aucun contact).');

-- paramètres de production communs à reprendre dans chaque date (seuls promo_debtor / promo_payer et l'encaisseur changent)
insert into public.shows (id, project_id, structure_id, venue, city, date, status, contract_type, prod_mode, prod_mode_manual, fee_ht, vat_rate,
                          partner_id, capacity, cnm_pct, ticket_holder, ticketing_enabled, communication_enabled,
                          drive_folder_requested_at, drive_folder_error, notes, production)
select v.id::uuid, 'e55a1000-0000-4000-a000-000000000001', 'e55a1000-0000-4000-a000-000000000003', v.venue, 'Ville fictive', v.d::date,
       'Confirmée Salle', 'Co-Production', 'production', true, 0, 5.5,
       'e55a1000-0000-4000-a000-000000000002', 600, 3.5, v.holder, true, false,
       now(), 'essai fictif : ne pas créer de dossier Drive', 'ESSAI v1.60.4 — ' || v.cas,
       jsonb_build_object('vat', 5.5, 'sacem_pct', 0, 'artbo_share', 50, 'artbo_loss_share', 40, 'promo_net_pct', 10, 'promo_dl_pct', 0,
                          'promo_debtor', v.debtor, 'promo_payer', v.payer, 'promo_paid_at', '2026-10-15', 'receipts_cashed_at', '2026-10-20',
                          'tickets', jsonb_build_array(jsonb_build_object('label', 'Plein', 'qty', 500, 'price', 21.1, 'real_qty', 400, 'dl_prod', 0, 'dl_net', 0)))
from (values
  ('e55a1000-0000-4000-a000-000000000011', 'ESSAI promo — cas 1 charge commune',     '2026-10-10', 'partenaire', 'commun',     'artbo',      'cas 1 : promotion charge commune, payée par L''ArtBo'),
  ('e55a1000-0000-4000-a000-000000000012', 'ESSAI promo — cas 2 L''ArtBo seule',      '2026-10-11', 'artbo',      'artbo',      'partenaire', 'cas 2 : promotion supportée par L''ArtBo seule, payée par le coproducteur'),
  ('e55a1000-0000-4000-a000-000000000013', 'ESSAI promo — cas 3 coproducteur seul',   '2026-10-12', 'partenaire', 'partenaire', 'artbo',      'cas 3 : promotion supportée par le coproducteur seul, payée par L''ArtBo')
) as v(id, venue, d, holder, debtor, payer, cas);

insert into public.budget_lines (id, show_id, project_id, category, label, supplier, payer, forecast, amount, paid_at, sort)
select l.id::uuid, l.show_id::uuid, 'e55a1000-0000-4000-a000-000000000001', l.cat, l.label, 'Fournisseur fictif', l.payer, l.amount, l.amount, date '2026-10-14', l.sort
from (values
  ('e55a1000-0000-4000-a000-000000000021', 'e55a1000-0000-4000-a000-000000000011', 'Salle',     'Location salle (essai)', 'partenaire', 3000, 1),
  ('e55a1000-0000-4000-a000-000000000022', 'e55a1000-0000-4000-a000-000000000011', 'Promoteur', 'Technique (essai)',      'artbo',      1500, 2),
  ('e55a1000-0000-4000-a000-000000000023', 'e55a1000-0000-4000-a000-000000000012', 'Salle',     'Location salle (essai)', 'partenaire', 3000, 1),
  ('e55a1000-0000-4000-a000-000000000024', 'e55a1000-0000-4000-a000-000000000012', 'Promoteur', 'Technique (essai)',      'artbo',      1500, 2),
  ('e55a1000-0000-4000-a000-000000000025', 'e55a1000-0000-4000-a000-000000000013', 'Salle',     'Location salle (essai)', 'partenaire', 3000, 1),
  ('e55a1000-0000-4000-a000-000000000026', 'e55a1000-0000-4000-a000-000000000013', 'Promoteur', 'Technique (essai)',      'artbo',      1500, 2)
) as l(id, show_id, cat, label, payer, amount, sort);

-- Contrôles après création (la transaction est annulée si l'un échoue)
do $$
declare n_pay int; n_lines int; n_notif int; n_drive int;
begin
  select count(*) into n_pay from public.show_payments where show_id::text like 'e55a1000-0000-4000-a000-00000000001_';
  if n_pay <> 0 then raise exception 'Contrôle : % ligne(s) de facturation créée(s) pour les coproductions d''essai (attendu 0) — tout est annulé', n_pay; end if;
  select count(*) into n_lines from public.budget_lines where id::text like 'e55a1000-0000-4000-a000-00000000002_';
  if n_lines <> 6 then raise exception 'Contrôle : % ligne(s) de dépenses (attendu 6) — tout est annulé', n_lines; end if;
  select count(*) into n_drive from public.shows where id::text like 'e55a1000-0000-4000-a000-00000000001_' and drive_folder_requested_at is not null and drive_folder_id is null;
  if n_drive <> 3 then raise exception 'Contrôle : dossier Drive — état inattendu sur % date(s) — tout est annulé', 3 - n_drive; end if;
  -- relances candidates (fonction de la v1.60.3 ; base plus ancienne : contrôle sauté, le dire)
  if to_regprocedure('public.reminder_candidates(uuid, boolean)') is null then
    raise notice 'reminder_candidates absente (migration v1.60.3 non appliquée) : contrôle des relances non fait ici';
    n_notif := 0;
  else
    execute $q$select count(*) from public.reminder_candidates(null, false) c where c.show_id::text like 'e55a1000-0000-4000-a000-00000000001_'$q$ into n_notif;
  end if;
  if n_notif <> 0 then raise exception 'Contrôle : % relance(s) candidate(s) sur les dates d''essai (attendu 0) — tout est annulé', n_notif; end if;
  raise notice 'ESSAI promo créé : 1 artiste inactif, 1 coproducteur fictif, 1 structure inactive, 3 dates, 6 dépenses ; 0 facture, 0 relance, aucun dossier Drive demandé.';
end $$;

commit;
