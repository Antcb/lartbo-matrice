# Livraison regroupée V1.57 → V1.60 — séquence de production à approuver

Préparée le 06/11/2026. **Rien n'est exécuté sans l'autorisation d'Anthony.** Chaque étape a son contrôle ; tout écart = **arrêt** (voir en bas), compte rendu, et aucune étape suivante.

Prérequis : séance sur le projet de test réussie (appels 1 à 5 de `essai/plan-test/` du dépôt de sauvegarde, répétés sur base jetable : conformes).

| # | Étape | Contrôle (preuve attendue) |
|---|---|---|
| 1 | **Sauvegarde fraîche** : ouverture d'une fenêtre exceptionnelle de 1 h (`private.sauvegarde_ouvrir('1 hour')`), lancement manuel de « Sauvegarde complète », fermeture anticipée de la fenêtre | exécution verte, rapport « Conforme » (réserves connues : 57 fichiers stockés absents ; 1 section de structure sur 18) ; fenêtre refermée |
| 2a | **Migration v1.57** `2026-11-04_v1.57_spectacles.sql` (mécanisme de migrations) | table `spectacles` (RLS, équipe seule, temps réel), `shows.spectacle_id` vide partout, anciennes lignes Movinmotion inchangées |
| 2b | **Migration v1.59** `2026-11-05_v1.59_acompte_artiste.sql` | s'arrête d'elle-même si une fonction n'est pas la version attendue ; `projects.default_acompte_pct` vide partout ; 4 fonctions modifiées, droits conservés |
| 2c | **Migration v1.60** `2026-11-06_v1.60_structure_admin_reference.sql` | même garde ; `artist_get` / `artist_sync` modifiées, droits et SECURITY DEFINER conservés |
| 3 | **Fonction `backup-export`** déployée avec le contenu complet du fichier de la PR | version en ligne identique au dépôt (contenu comparé) |
| 4 | **Sauvegarde JSON** lancée à la main (« Sauvegarde quotidienne ») | exécution verte ; `donnees/spectacles.json` présent ; nombre de tables attendu |
| 5a | **Fusion PR #28** (v1.57 → v1.59), « Rebase and merge » | arbre publié = arbre relu (`8995fe3`) ; `tests` verts sur `main` ; GitHub Pages publié |
| 5b | **PR #29** recalée sur `main` (contenu identique vérifié), puis fusion | arbre publié = arbre relu ; `tests` verts ; Pages publié ; version affichée 1.60.1 |
| 6 | **POGO TANGO** : `supabase/operations/2026-11-06_pogo_tango_structure_administrative.sql` | « La Pignata », ses 4 contacts et ses 27 dates inchangés ; aucun numéro de TVA ; RNA et représentant « à compléter » |
| 7A1 | **TVA groupe A1** (La Rayonne, Cabaret Sauvage, Le Family → 0 %, HT inchangé) — *approuvable séparément* | 3 dates à 0 %, cachets inchangés |
| 7A2 | **TVA groupe A2** (Le Bayou, L’Atelier des Môles) — *seulement après accord d’Anthony sur les confirmations de juin* | 2 dates à 0 %, cachets inchangés, aucun renvoi automatique |
| 7B | **TVA groupe B** (8 dates sans cachet → 0 %) — *approuvable séparément* | 8 dates à 0 %, aucun montant ni document |
| 8 | **Vérifications après publication** (lecture seule) | ouverture de l'application, onglets Spectacles / Budget / Fiche artiste, alerte TVA disparue pour La Pigñata, sauvegarde de la nuit suivante « Conforme » |

Non concernés : scripts Google (aucune modification dans ces lots), Pennylane (aucune facture ni brouillon modifié ; prochaines commissions booking de La Pigñata adressées à POGO TANGO).

Option séparée : fusion de la branche `dev/b1-restauration-json` du dépôt de sauvegarde (script et procédure de restauration JSON ; aucun changement de la sauvegarde en service).

## Arrêt et retour à un état compatible

- **Échec à l'étape 1** : rien n'est engagé ; on s'arrête.
- **Échec d'une migration (2a/2b/2c)** : chaque migration est une transaction ; v1.59 et v1.60 s'annulent d'elles-mêmes si une fonction diffère. Les migrations déjà passées restent compatibles avec l'application en ligne (v1.56.7 : elle ignore la nouvelle table, les colonnes vides ne changent rien). Arrêt, compte rendu.
- **Échec de l'export ou de la sauvegarde JSON (3/4)** : redéploiement de la version de `backup-export` de `main` (sans les spectacles) pour garder une sauvegarde quotidienne ; application non publiée ; arrêt. Si nécessaire : retour des fonctions modifiées à leur texte de production (relevé de structure de la sauvegarde). **Aucune suppression** de table ou de colonne sans décision d'Anthony.
- **Anomalie après publication (5)** : signalement immédiat ; retour à la version précédente de l'application par une PR de retour (jamais de push direct) ; les données ajoutées restent.
- **Opérations 6/7** : transactions avec garde-fous (doublon, état relevé le 06/11) ; tout écart = rien n'est modifié.
