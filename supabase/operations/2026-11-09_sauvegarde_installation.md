# Sauvegardes : démarrage réel — installation (décision d'Anthony du 09/11/2026)

Branches : `dev/sauvegarde-declenchement` dans `lartbo-matrice` **et** dans `lartbo-matrice-backup`. Rien n'est en production tant
que les étapes ci-dessous ne sont pas faites. Aucun secret ne passe par une conversation : seulement les écrans Supabase et GitHub.

## A. Correctif immédiat (sauvegarde complète bloquée depuis la v1.60.4)
Cause : `permission denied for table mailbox_owners` (table privée v1.60.4 non lisible par le rôle de sauvegarde).
1. Supabase › projet **Lartbo-matrice** › **SQL Editor** › nouvelle requête : `grant select on private.mailbox_owners to sauvegarde;` › **Run**.
   (Le rôle a déjà BYPASSRLS : ce droit suffit. La table ne contient que le nom de la boîte et l'adresse de son titulaire, aucun
   secret ; elle n'a pas à être neutralisée à une restauration.)
2. GitHub › `lartbo-matrice-backup` › **Actions** › « Sauvegarde complète » › **Run workflow** — pendant une fenêtre ouverte
   (01:30–04:30 UTC, ou `select private.sauvegarde_ouvrir(interval '1 hour');` dans le SQL Editor).
La migration ci-dessous refait ce droit (sans effet s'il existe déjà).

## B. Mise en service (dans cet ordre)
| # | Qui | Où | Quoi |
|---|---|---|---|
| 1 | Claude, sur autorisation | projet de test puis production | migration `supabase/migrations/2026-11-09_v1.60.7_sauvegarde_declenchement.sql` (le projet de test doit d'abord avoir le rôle `sauvegarde` et la fenêtre : dépôt de sauvegarde, `outils/role_sauvegarde.sql` puis `outils/fenetre_connexion.sql`) |
| 2 | Claude, sur autorisation | production | fonction serveur `sauvegarde-fenetre` (fichiers `index.ts` + `regles.ts`), **Verify JWT désactivé** (comme `backup-export` : la protection est le secret) ; vérifier ensuite que la version en ligne est identique au dépôt |
| 3 | Anthony | Supabase › **Table Editor** › schéma `private` › table `import_secrets` › ligne `sauvegarde_declenchement_secret` | copier la colonne `value` (64 caractères) |
| 4 | Anthony | GitHub › `lartbo-matrice-backup` › **Settings** › **Secrets and variables** › **Actions** › **New repository secret** | Name : `SAUVEGARDE_SIGNAL_SECRET` ; Secret : coller ; **Add secret**. Puis vider le presse-papiers |
| 5 | Anthony | GitHub › `lartbo-matrice-backup` › **Pull requests** | fusionner la demande de `dev/sauvegarde-declenchement` (« Rebase and merge ») |
| 6 | Anthony | GitHub › `lartbo-matrice-backup` › **Actions** › « Sauvegarde complète » › **Run workflow** | essai immédiat : étapes « Démarrage réel » puis « Fermeture de la connexion » vertes |
| 7 | — | nuit suivante | les deux sauvegardes tournent seules (vérifier le lendemain dans Actions : un créneau fait la copie, les autres s'arrêtent en « déjà faite ») |
| 8 | Claude, sur autorisation | production | `supabase/operations/2026-11-09_sauvegarde_activation.sql` : retire la fenêtre fixe 01:30–04:30 et ses tâches (refusé tant qu'aucune copie n'a réussi dans le nouveau mode) |

Avant l'étape 4, les workflows fusionnés gardent exactement le fonctionnement d'avant : seuls le créneau principal (01:41 copie,
02:17 JSON) et les lancements manuels sauvegardent ; les 3 créneaux de rattrapage s'arrêtent tout de suite, sans échec ni mail. Avant l'étape 8,
la fenêtre fixe reste en service : le démarrage réel ne fait qu'ajouter le verrou, le relevé et l'alerte.

## C. Règle durable pour le schéma privé
Toute nouvelle table `private.*` est classée DANS SA MIGRATION : `grant select on private.<table> to sauvegarde` (aucun secret) ou
ajout aux exclusions décidées (secrets : présence seulement). Contrôlé par `tests/static/sauvegarde-declenchement.mjs` (test
`tests`) et, en production, par l'alerte « Schéma privé » de la copie. À décider pour `private.sync_urls` (lot messagerie).

## D. Retour arrière
`supabase/retours-arriere/2026-11-09_sauvegarde_declenchement_retour_arriere.sql` (ordre indiqué en tête du fichier).
