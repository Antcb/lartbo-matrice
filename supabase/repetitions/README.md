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
- `2026-11-08_v1.62_agendas_base_locale.sql` puis la migration v1.62 agendas (deux fois : rejouable, secret dédié conservé) puis
  `2026-11-08_v1.62_agendas_essai.sql` : droits (équipe, hors équipe, anon), une ligne par occurrence, un agenda par artiste et un
  artiste par agenda, association retirée à la suppression d'une date, schéma privé inaccessible, tâche planifiée (aucun appel sans
  adresse, vers une adresse étrangère ou sans agenda actif ; secret en en-tête seulement), temps réel et RLS. Gardes essayées à la main :
  structure différente de `artist_calendars`, autre `cal_sync_tick`, dépendance absente → arrêt sans rien appliquer ; `private.sync_urls`
  déjà créée par la messagerie → acceptée. Données fictives uniquement (essai du 08/11/2026 : réussi).
