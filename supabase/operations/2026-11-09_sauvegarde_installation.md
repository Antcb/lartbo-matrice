# V1.60.7 — Sauvegardes durables : demande de déploiement unique

Branches `dev/sauvegarde-declenchement` de `lartbo-matrice` et de `lartbo-matrice-backup` (relues, aucun bloquant).
**V1.60.7 n'est pas autorisée en production** : ce document est la demande. Aucun secret ne passe par une conversation, seulement
par les écrans Supabase et GitHub.

## 1. Ce qui est vérifié (base PostgreSQL jetable, 70 essais ; imitation locale de la fonction serveur)
- ouverture au **démarrage réel** de la copie, jamais à heure fixe une fois l'activation faite ;
- **une seule sauvegarde à la fois** (verrou dans la base + `concurrency` GitHub) ; relance manuelle pendant une copie : refusée, visible ;
- accès limité à **45 min**, fermeture **en fin de traitement** (succès comme échec) et **fermeture de secours** par la base
  (tâche `sauvegarde-interruption`, 15 min au plus après l'échéance : 1 h au plus au total) ;
- **seule l'exécution concernée** ferme sa fenêtre ; une fenêtre ouverte à la main n'est pas refermée par la fin d'une copie ;
- **tentatives bornées** : 4 créneaux par nuit, 6 démarrages par jour au plus, et **aucune nouvelle copie après une réussite** du jour ;
- **sans le nouveau secret** : fonctionnement d'avant à l'identique (créneau principal seul, fenêtre fixe, aucune tentative parasite).

## 2. Fuseau du découpage quotidien : UTC partout
- « Déjà faite », la **limite de 6 démarrages** et l'**alerte** se comptent par **jour UTC** (00:00–24:00 UTC = 01:00→01:00 à Paris en
  hiver, 02:00→02:00 en été). Le jour d'une exécution est la date UTC de son **démarrage réel**, quel que soit le fuseau (vérifié avec
  une session à UTC+14).
- Créneaux (UTC) : copie complète 01:41, 04:41, 07:41, 10:41 ; JSON 02:17, 05:17, 08:17, 11:17. Alerte : 13:07 UTC (14:07 à Paris
  en hiver, 15:07 en été).
- **Exécution retardée après minuit** (par exemple le créneau de 10:41 parti à 00:30 le lendemain, ou un créneau de 22:41) :
  - elle compte pour le **jour de son démarrage réel** (le nouveau jour) et fait une vraie copie de l'état à 00:30 ;
  - **pas de copie en double** : les créneaux suivants de ce jour voient « déjà faite » (vérifié) ;
  - **pas de jour silencieux** : la veille, si aucune copie n'avait réussi à 13:07 UTC, l'alerte est déjà partie. Aucune donnée n'est
    perdue : la copie de 00:30 contient tout jusqu'à 00:30. Seul l'écart entre deux copies s'allonge (signalé par l'alerte).
- Copie démarrée avant minuit et finie après : elle compte pour la veille ; le premier créneau du jour en refait une (vérifié). Deux
  copies à quelques heures d'intervalle : sans inconvénient.
- Aucun cas ne demande de correction. Seule limite connue : une copie encore en cours à 13:07 UTC déclenche l'alerte du jour ; si elle
  réussit ensuite, l'alerte a été envoyée à tort (rare : créneau de 10:41 retardé de plus de 2 h).

## 3. Alerte d'absence : indépendante de GitHub
- Déclenchée par **pg_cron dans Supabase** (tâche `sauvegarde-controle`, `7 13 * * *`, `select private.sauvegarde_controler()`). Elle
  lit seulement le journal `private.sauvegarde_executions` et écrit une notification (cloche de la Matrice, puis récap mail du matin à
  anthony@ et production@, envoyé par le script Google). Aucun appel à GitHub ni à l'extérieur (vérifié dans le texte de la fonction).
- Essai : **aucune exécution depuis 3 jours** (GitHub n'a rien lancé) → alerte pour la copie complète ET pour le JSON, une seule fois par
  jour et par type.
- Armement : dès la **première exécution enregistrée** (étape 6 de la demande ci-dessous). Avant, le contrôle reste muet : l'ancien
  fonctionnement n'écrit rien dans le journal. Il ne dépend plus de GitHub ensuite.
- Le mail d'échec de GitHub reste un complément, plus le seul signal.
- Non vérifié : l'exécution réelle par pg_cron. En local, pg_cron est simulé ; la tâche, sa commande et son horaire sont vérifiés.

## 4. Tables du schéma `private` : décision explicite pour chacune
| Table | Décision | Où elle est déclarée |
|---|---|---|
| `import_secrets` | **exclue** : jamais copiée ; seule la présence est relevée (nom de clé + empreinte tronquée, archive chiffrée) | exclusions décidées : `outils/prive_classement.sql` (sauvegarde) et `tests/static/sauvegarde-declenchement.mjs` |
| `mailbox_owners` | **copiée** (nom de boîte + adresse du titulaire, aucun secret ; pas de neutralisation à la restauration) | grant du §1 de l'accord d'Anthony, repris par la migration v1.60.7 et `outils/role_sauvegarde.sql` |
| `notion_raw`, `notion_cursor` | **copiées** (archive Notion) | `outils/role_sauvegarde.sql`, repris par la migration v1.60.7 |
| `sauvegarde_fenetre` | **copiée** (réglage de la fenêtre) | `outils/fenetre_connexion.sql` |
| `sauvegarde_executions` (nouvelle) | **copiée** (journal, aucun secret ; l'exécution en cours est neutralisée à la restauration) | migration v1.60.7 (table + séquence) |
| `sync_urls` (lot messagerie, à venir) | **à décider par Anthony** avant sa migration (proposition : exclue, présence seulement, si elle contient des jetons) | — |

- **Aucun droit global automatique sur le schéma `private`** : aucun `alter default privileges` (vérifié par le test `tests`).
- Une table privée non déclarée est **exclue** de la copie avec une alerte « Schéma privé ». Le test `tests` refuse aussi une
  migration qui crée une table privée sans décision.
- Une table créée en production hors des migrations serait signalée par cette alerte dès la première copie.
- À noter, inchangé depuis le B1 : le schéma `public` a un droit de lecture par défaut pour le rôle de sauvegarde sur ses futures
  tables (la table des réglages en est retirée).

## 5. Demande de déploiement (dans cet ordre ; état après chaque étape)
Prérequis déjà autorisé (§1 de l'accord) : `grant select on private.mailbox_owners to sauvegarde;`, puis relance vérifiée de la
copie complète.

| # | Qui | Étape | État ensuite |
|---|---|---|---|
| 1 | Claude | **Migration sur le projet de test** `2026-11-09_v1.60.7_sauvegarde_declenchement.sql`. Elle exige le rôle `sauvegarde` et la fenêtre : s'ils manquent sur le test, y jouer d'abord `outils/role_sauvegarde.sql` et `outils/fenetre_connexion.sql`, sans mot de passe. Contrôle : dernière requête de la migration (0 table privée non classée, coffre illisible, aucun accès du navigateur) | test seulement ; production inchangée |
| 2 | Claude | **Migration en production** (empreinte identique à l'étape 1, sauvegarde fraîche réussie juste avant) | journal, fonctions et tâche `sauvegarde-controle` créés. Fenêtre fixe 01:30–04:30 **inchangée**, workflows inchangés, alerte non armée |
| 3 | Claude | **Fonction serveur** `sauvegarde-fenetre` (`index.ts` + `regles.ts`, « Verify JWT » désactivé), puis comparaison de la version en ligne avec le dépôt | fonction prête, appelée par personne |
| 4 | Anthony | **Secret GitHub**, étapes web ci-dessous | secret rangé ; les workflows de `main` ne l'utilisent pas encore : aucun changement |
| 5 | Anthony | **Fusion** de la demande `dev/sauvegarde-declenchement` du dépôt de sauvegarde (« Rebase and merge ») | démarrage réel actif **en plus** de la fenêtre fixe (filet de sécurité gardé) |
| 6 | Anthony puis Claude | **Essai réel en journée**, hors fenêtre fixe (entre 05:00 et 23:00 UTC) : Actions › « Sauvegarde complète » › Run workflow, puis « Sauvegarde quotidienne » › Run workflow | alerte armée |
| 7 | — | **Nuit suivante** : le créneau 01:41 copie, les 3 suivants répondent « déjà faite » | — |
| 8 | Claude | **Retrait de l'ancienne fenêtre fixe**, seulement si les critères ci-dessous sont remplis : `supabase/operations/2026-11-09_sauvegarde_activation.sql`. Elle refuse d'elle-même sans copie réussie à fermeture enregistrée, pendant une copie, dans la fenêtre fixe, ou si la connexion est encore ouverte | connexion ouverte uniquement par le démarrage réel |

**Étape 4 — secret GitHub (Anthony, web uniquement)**
1. Supabase › projet **Lartbo-matrice** › **Table Editor** › schéma `private` › table `import_secrets` › ligne
   `sauvegarde_declenchement_secret` : copier la valeur (64 caractères).
2. GitHub › `lartbo-matrice-backup` › **Settings** › **Secrets and variables** › **Actions** › **New repository secret** :
   Name `SAUVEGARDE_SIGNAL_SECRET`, Secret : coller, puis **Add secret**.
3. Vider le presse-papiers. Ne jamais coller la valeur ailleurs.

**Critères de réussite de l'étape 6, conditions de l'étape 8** (contrôlés par Claude en lecture seule)
- exécution « Sauvegarde complète » **verte** : « Démarrage réel », « Fermeture de la connexion », vérification, enregistrement, bilan ;
- dans `private.sauvegarde_executions` : une ligne `complete` « succes » dont la fermeture est enregistrée (`fenetre_jusqu_a <= fin`),
  et une ligne `json` « succes » ;
- **fermeture vérifiée** : après la copie, `rolcanlogin = false` pour le rôle `sauvegarde` (hors fenêtre fixe), aucune session du rôle ;
- `base/derniere-copie.txt` : « vérification : success », « Fenêtre de connexion : OK », « Schéma privé : OK » ;
- restauration vérifiée, y compris `mailbox_owners` et son contenu (manifeste identique) ;
- la nuit suivante (étape 7) : une seule copie, les créneaux de rattrapage en « déjà faite ».

**Retour arrière, à chaque état**
- Après l'étape 8 : remettre la fenêtre fixe (section « RETOUR » de l'opération d'activation).
- Après les étapes 4 à 7 : supprimer le secret GitHub `SAUVEGARDE_SIGNAL_SECRET`. Les workflows reviennent d'eux-mêmes au
  fonctionnement d'avant (créneau principal seul). Si besoin, annuler la fusion par une nouvelle demande.
- Après les étapes 2 et 3 : `supabase/retours-arriere/2026-11-09_sauvegarde_declenchement_retour_arriere.sql` (fonctions et tâche
  retirées, journal gardé). Fonction serveur : la supprimer dans Supabase › Edge Functions.
- Aucune donnée métier n'est touchée, à aucune étape.

## 6. Règle durable
Toute nouvelle table `private.*` est déclarée dans sa migration : `grant select … to sauvegarde` (copiée) ou ajout aux exclusions
décidées (secrets : présence seulement). Le test `tests` et l'alerte « Schéma privé » le contrôlent.
