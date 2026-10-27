# Répétitions sur le projet Supabase de TEST

Scripts générés pour répéter un lot sur « Lartbo-matrice-test » (dthfocplfzzmkgaxhmwk) **dans une seule transaction entièrement
annulée** (erreur voulue « BILAN … TOUT EST ANNULÉ » à la fin) : aucune modification persistante. Ils refusent de s'exécuter
ailleurs que sur le projet de test (contrôle de l'adresse des fonctions, absence de l'identifiant de production, nombre de dates).

- `2026-10-27_repetition_lot_d1_test.sql` : lot D1 (migrations v1.42, v1.43, v1.44 — corps identiques aux fichiers de
  `supabase/migrations/`), 86 essais sur des données fictives, retour arrière, redéploiement.

## Installation durable sur le projet de test (autorisée par Anthony le 27/10/2026)

- `2026-10-27_installation_lot_d1_test.sql` : état de la production après C1, puis déploiement D1 (corps identique au script de
  production), **validé** — uniquement sur « Lartbo-matrice-test » (garde d'identité). Sauvegarde préalable du test : schéma
  `sauvegarde_20261027` (copie de chaque table, des fonctions et des droits).
- `2026-10-27_retour_arriere_lot_d1_test.sql` : retour arrière au corps identique à celui de production, garde du test.
- Puis `supabase/migrations/2026-10-27_v1.45_droits_truncate.sql` (droits TRUNCATE) ; retour : `supabase/retours-arriere/`.
