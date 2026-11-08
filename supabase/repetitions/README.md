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

## Cas d'essai isolé « ESSAI promo » (v1.60.4, à lancer par Anthony s'il le décide)

- `2026-11-08_v1.60.4_essai_promo_coproduction.sql` : artiste inactif « ESSAI promo », coproducteur et structure fictifs, 3 dates
  de coproduction passées (promotion : charge commune / L'ArtBo seule / coproducteur seul ; supportée ≠ payée), dépenses payées ;
  identifiants fixes ; aucune facture, aucune relance, aucun dossier Drive demandé. Résultats attendus (calcul à la main) en tête du
  fichier, vérifiés par `tests/e2e/essai-promo-v1604.spec.js`.
- `2026-11-08_v1.60.4_essai_promo_nettoyage.sql` : retrait exact par identifiants fixes. Arrêt sans rien toucher si un identifiant
  porte autre chose, ou si UNE ligne de n'importe quelle table du schéma public (inventaire fait à l'exécution, toutes colonnes :
  clés, colonnes sans clé, tableaux, texte, JSON) contient un identifiant d'essai hors du périmètre ; journaux `finance_log` et
  `show_deletions` conservés. Rejoué après relecture (B1) sur une base jetable complète (toutes les migrations) : 21 cas
  d'accrochage (modèles de mail, Pennylane, tâches, journal et membres d'artiste, événements, notifications, structure
  administrative ou coproducteur par défaut d'un artiste réel, spectacle, contact, Factures, dépenses, suivi…) → arrêt, aucune
  ligne modifiée ; cas propre et cas clôturé → seules les lignes d'essai supprimées.
- Essayés sur une base PostgreSQL 16 locale jetable (base locale v1.60.3 + migration v1.60.3 + `on_show_confirmed` de la v1.51) :
  création, refus d'une seconde création, clôture puis nettoyage, arrêt du nettoyage sur une tâche ajoutée, artiste réel témoin intact.
