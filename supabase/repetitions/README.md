# Répétitions sur le projet Supabase de TEST

Scripts générés pour répéter un lot sur « Lartbo-matrice-test » (dthfocplfzzmkgaxhmwk) **dans une seule transaction entièrement
annulée** (erreur voulue « BILAN … TOUT EST ANNULÉ » à la fin) : aucune modification persistante. Ils refusent de s'exécuter
ailleurs que sur le projet de test (contrôle de l'adresse des fonctions, absence de l'identifiant de production, nombre de dates).

- `2026-10-27_repetition_lot_d1_test.sql` : lot D1 (migrations v1.42, v1.43, v1.44 — corps identiques aux fichiers de
  `supabase/migrations/`), 87 essais sur des données fictives, retour arrière, redéploiement.

## Installation durable sur le projet de test (autorisée par Anthony le 27/10/2026)

- `2026-10-27_installation_lot_d1_test.sql` : état de la production après C1, puis déploiement D1 (corps identique au script de
  production), **validé** — uniquement sur « Lartbo-matrice-test » (garde d'identité). Sauvegarde préalable du test : schéma
  `sauvegarde_20261027` (copie de chaque table, des fonctions et des droits).
- `2026-10-27_retour_arriere_lot_d1_test.sql` : retour arrière au corps identique à celui de production, garde du test.
- Puis `supabase/migrations/2026-10-27_v1.45_droits_truncate.sql` (droits TRUNCATE) ; retour : `supabase/retours-arriere/`.

## Essais sur une base PostgreSQL locale jetable (sans Supabase)

- `2026-11-07_v1.60.3_suppression_date_base_locale.sql` puis la migration v1.60.3 (deux fois) puis
  `2026-11-07_v1.60.3_suppression_date_essai.sql` : suppression contrôlée d'une date (date rouverte supprimée avec son historique
  archivé, refus : résultat clôturé, facture émise, versement, devis / facture Pennylane, rattachement, pièce à rattacher, hors calcul ;
  journal en lecture seule ; tâches détachées annotées ; archivage / restauration et leurs refus ; aucun rappel pour une date
  archivée ; gardes de generate_reminders, fiche_get et fiche_submit ; fiche publique « Dossier indisponible » ; notifications
  retirées ; restauration avec relances suspendues puis réactivation explicite ; alerte de facture sur une date archivée). Données fictives uniquement.

## Cas d'essai isolé « ESSAI promo » (v1.60.4) — hors production uniquement

Décision d'Anthony du 08/11/2026 : aucune donnée fictive dans les comptes opérationnels ; essai exécuté hors production.
- `2026-11-08_v1.60.4_essai_promo_coproduction.sql` : artiste inactif « ESSAI promo », coproducteur et structure fictifs, 3 dates de
  coproduction passées (promotion : charge commune / L'ArtBo seule / coproducteur seul ; supportée ≠ payée), dépenses payées ;
  identifiants fixes. Refusé sans `set essai.cible = 'jetable';` (ou `'test'`) et refusé si le projet de production est reconnu.
  Résultats attendus (calcul à la main) en tête du fichier.
- `2026-11-08_v1.60.4_essai_promo_nettoyage.sql` : arrêt sans rien toucher si un identifiant porte autre chose ou si une ligne de
  n'importe quelle table du schéma public (inventaire à l'exécution, toutes colonnes) contient un identifiant d'essai hors du
  périmètre (DÉPENDANCE OPÉRATIONNELLE) ; sinon TRACE CONSERVÉE : copie complète de chaque date (lignes, historique de clôture,
  artiste / coproducteur / structure d'essai) dans le journal `show_deletions`, puis retrait des seules lignes d'essai des tables
  actives. Classement explicite (en tête du script) : TRACES CONSERVÉES, jamais modifiées ni bloquantes — `finance_log`,
  `show_deletions`, `client_errors` (journal des erreurs, relecture de a7216a9), rien d'autre ; toute autre table = dépendance
  opérationnelle (dont `pennylane_rattachements`, `notifications`, et les tables techniques `_folder_jobs`, `_koza_job`,
  `_lartbotrice_job`, `_probe` : relecture de 932725a). Option `set essai.notifications = 'conserver';` : notifications du SEUL
  dossier d'essai (sans tâche, artiste vide ou d'essai, aucune autre référence citée) copiées dans la trace puis retirées ; toute
  autre notification bloque. Bilan du nombre réel de lignes traitées (« rien à retirer » au second lancement).
- `2026-11-08_v1.60.4_essai_promo_verification.sh` : 20 cas sur base jetable (client_errors citant l'essai → nettoyage réussi,
  ligne intacte ; second lancement et base sans essai → rien à retirer ; clôture ; notification retirée avec / sans option ;
  notification d'une date réelle, N1 tâche réelle, N2 artiste réel, N3 autre référence → arrêt même avec l'option ; K1
  `_koza_job`, `_lartbotrice_job`, `_probe` → arrêt ; dépendances opérationnelles → arrêt, rien touché). Contre-épreuve : le script
  de 932725a échoue sur N1, N2, N3 et K1.
- `tests/outils/essai-promo.mjs extrait.json` : calcule, avec l'application elle-même, les trois scénarios sur les lignes réellement
  enregistrées (après déclencheurs) et compare aux attendus.
- Exécuté le 08/11/2026 sur une base PostgreSQL 16 jetable locale (port 55493, toutes les migrations du dépôt, sans pg_net / pg_cron
  réels) : création refusée sans cible ; 3 scénarios sans écart ; `generate_reminders` : aucune relance d'essai ; aucun appel Drive ;
  clôture du cas 2 puis nettoyage → tables actives identiques à l'état d'avant la création (hors journaux), 3 copies dans
  `show_deletions` (dont l'historique de clôture), journal `finance_log` antérieur intact. Rejeu de 22 cas d'accrochage (modèles de mail, Pennylane, tâches, journal et membres d'artiste, événements, notifications, artiste réel lié, spectacle, contact, Factures, dépenses, suivi) : arrêt,
  aucune ligne modifiée.

## v1.60.6 — facture de solde à J-7 (base locale jetable)

- `2026-11-07_v1.60.3_suppression_date_base_locale.sql`, puis les migrations v1.60.3 et `2026-11-09_v1.60.6_solde_j7.sql` (deux fois),
  puis `2026-11-09_v1.60.6_solde_j7_essai.sql` (lancé depuis la racine du dépôt : il inclut l'opération
  `supabase/operations/2026-11-09_v1.60.6_rappels_solde.sql`) : solde fait tôt (J-7), solde fait après J-7, J-7 un samedi, acompte et
  date sans jour de concert inchangés, plancher de réactivation conservé, retrait du rappel prématuré sans rattrapage puis retour
  unique à J-7. Tout est annulé (rollback). Données fictives uniquement.

## Brise Glace — facture 107 reliée au solde (base locale jetable, 09/11/2026)

- `2026-11-09_base_locale_complete.sh` (+ `2026-11-09_base_locale_socle.sql`) : base modèle jetable construite depuis
  `supabase/schema.sql` et toutes les migrations du dépôt (socle Supabase simulé ; la garde d'empreinte de production de la migration
  v1.60 est neutralisée sur cette base seulement, et signalée). Empreintes obtenues identiques à la production pour
  `generate_reminders` (584374b0…) et `show_payments_emitted_guard` (08302c0c…).
- `2026-11-09_brise_glace_rattachement_essai.sh` : opération `supabase/operations/2026-11-09_brise_glace_rattachement.sql` et retour
  arrière `supabase/retours-arriere/2026-11-09_brise_glace_rattachement_retour_arriere.sql` sur l'état relevé reconstitué par les
  déclencheurs (données fictives) : 22 contrôles — sans confirmation, opérateur hors équipe, nominal (lignes, journal, historique,
  rappels v1.60.6, generate_reminders), rejeu, retour arrière exact et son rejeu, jour ouvré de J-7 (« Facture de solde à faire »
  seulement), états différents (solde envoyé, solde payé, acompte au n° 33, facture signalée, autre jour, deuxième acompte, acompte
  payé), retour arrière refusé après une vraie facture de solde ou sans opération.
- `tests/outils/rejeu-sync-pennylane/` : rejeu de la synchronisation (fonction edge réelle, faux Pennylane, faux Supabase) sur ce cas,
  avec le code du 06/11 (v1.51.0, 2cbd65e) et le code actuel.
