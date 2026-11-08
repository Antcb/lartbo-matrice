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

## v1.64 — délais et automatismes (base locale jetable)

- Base locale v1.60.3 + migrations v1.60.3 et v1.60.6, puis `2026-11-09_v1.64_delais_essai.sql` (depuis la racine du dépôt ; il
  applique deux fois `2026-11-09_v1.64_delais.sql` dans la transaction) : sans réglage, 19 relances de 14 règles identiques à la
  v1.60.6 (règles, clés anti-doublon, échéances) et aucune notification nouvelle ; délai modifié pour toutes les dates (échéance
  déplacée, clé inchangée, pas de doublon), règle désactivée, nouvelles dates seulement (`from`), versions successives, réglage
  abîmé (version ignorée, la précédente gardée), instant d'enregistrement à la milliseconde, week-ends (0 jour → lundi,
  politique désactivable, solde toujours vendredi), contraintes d'écriture (délais et réglages simples), priorité de la prochaine
  échéance choisie pour la date. Tout est annulé (rollback).
- `2026-11-08_v1.63_messagerie_base_locale.sql` puis `supabase/migrations/2026-11-06_v1.61_messagerie.sql` (deux fois : rejouable) puis
  `2026-11-08_v1.63_messagerie_essai.sql` (transaction annulée, après les migrations v1.47 et cle_boite) : 83 essais — adresse du script de la boîte modifiable par le titulaire seulement, — titulaire non écrit par la migration, adresse lisible par le serveur seul, — boîte réservée au propriétaire (RLS, rattachement manuel), absence automatique signalée, rétablissement avec échéance future, rattachement (dont « aucun suivi » choisi à la main conservé, correction A → B : relances de B suspendues, celles de A signalées et rétablies seulement sur demande ; non-remise, réponse automatique et message de l'équipe sans suspension ; dépose Apple Mail ↔ synchronisation dans les deux sens), (unique, plusieurs contacts d'une structure,
  plusieurs structures ou suivis, fil de prospection, conversation connue par References dont réponse Apple Mail, déjà rattachée),
  aucun doublon (synchronisations répétées, envoi depuis L'ArtBotrice, mail déposé depuis Apple Mail), relances suspendues à la
  réponse (pas sur un avis de non-remise), rattachement manuel (équipe, bonne structure, journal qui suit), droits, RLS, tâche
  planifiée (rien sans adresse, jamais hors Supabase, secret en en-tête seulement). Garde de prérequis vérifiée sur une base vide.
