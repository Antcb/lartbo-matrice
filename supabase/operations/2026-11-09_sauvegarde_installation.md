# V1.60.7 — Sauvegardes durables : demande de déploiement unique

Branches `dev/sauvegarde-declenchement` de `lartbo-matrice` (sur `main` v1.60.6) et de `lartbo-matrice-backup`.
**V1.60.7 n'est pas autorisée en production** : ce document est la demande. Aucun secret ne passe par une conversation, seulement
par les écrans Supabase, GitHub et Google.

## 1. Ce qui est vérifié (base PostgreSQL jetable ; imitation locale de la fonction serveur)
- ouverture au **démarrage réel** de la copie, jamais à heure fixe une fois l'activation faite ;
- **une seule sauvegarde à la fois** (verrou dans la base + `concurrency` GitHub) ; relance manuelle pendant une copie : refusée, visible ;
- accès limité à **45 min**, fermeture **en fin de traitement** (succès comme échec) et **fermeture de secours** par la base
  (tâche `sauvegarde-interruption`, 15 min au plus après l'échéance : 1 h au plus au total) ;
- **seule l'exécution concernée** ferme sa fenêtre ; une fenêtre ouverte à la main n'est pas refermée par la fin d'une copie ;
- **tentatives bornées** : 4 créneaux par nuit, 6 démarrages par jour au plus, et **aucune nouvelle copie après une réussite** du jour ;
- **sans le nouveau secret** : fonctionnement d'avant à l'identique (créneau principal seul, fenêtre fixe, aucune tentative parasite) ;
- **surveillance armée dès la migration**, tout échec notifié tout de suite, coupure de l'alerte dans tout retour arrière.

## 2. Fuseau du découpage quotidien : UTC partout
- « Déjà faite », la **limite de 6 démarrages** et l'**alerte** se comptent par **jour UTC** (00:00–24:00 UTC = 01:00→01:00 à Paris en
  hiver, 02:00→02:00 en été). Le jour d'une exécution est la date UTC de son **démarrage réel**, quel que soit le fuseau (vérifié avec
  une session à UTC+14).
- Créneaux (UTC) : copie complète 01:41, 04:41, 07:41, 10:41 ; JSON 02:17, 05:17, 08:17, 11:17. Alerte : 13:07 UTC (14:07 à Paris
  en hiver, 15:07 en été).
- **Exécution retardée après minuit** (par exemple le créneau de 10:41 parti à 00:30 le lendemain) :
  - elle compte pour le **jour de son démarrage réel** (le nouveau jour) et fait une vraie copie de l'état à 00:30 ;
  - **pas de copie en double** : les créneaux suivants de ce jour voient « déjà faite » (vérifié) ;
  - **pas de jour silencieux** : la veille, si aucune copie n'avait réussi à 13:07 UTC, l'alerte est déjà partie. Aucune donnée n'est
    perdue : la copie de 00:30 contient tout jusqu'à 00:30.
- Copie démarrée avant minuit et finie après : elle compte pour la veille ; le premier créneau du jour en refait une (vérifié).
- Limite connue : une copie encore en cours à 13:07 UTC déclenche l'alerte du jour, à tort si elle réussit ensuite (rare).

## 3. Alerte d'absence : indépendante de GitHub, armée dès la migration
- **Déclenchement** : par **pg_cron dans Supabase** (tâche `sauvegarde-controle`, `7 13 * * *`, `select private.sauvegarde_controler()`).
  Elle lit le journal `private.sauvegarde_executions` et la date de mise en place, puis écrit une notification : cloche de la
  Matrice, puis récap mail du matin à anthony@ et production@, envoyé par le script Google.
  Aucun appel à GitHub ni à l'extérieur (vérifié dans le texte de la fonction).
- **Armée par la migration** (`private.sauvegarde_surveillance`, date de mise en place) :
  - aucune attente d'une première exécution ;
  - seul un délai de grâce de **24 h** après la mise en place évite une alerte le jour même ;
  - le contrôle ne tourne qu'**une fois par jour, à 13:07 UTC** : la **première alerte possible arrive donc entre 24 h et environ
    48 h après la migration** (migration à 12:00 UTC → premier contrôle armé le lendemain à 13:07 ; migration à 14:00 UTC → le
    surlendemain à 13:07) ;
  - **pendant ce délai, les signaux d'avant restent actifs et inchangés** : mail de GitHub à chaque exécution en échec, et contrôle de
    la copie complète par le workflow JSON (échec si la dernière copie complète date d'avant-hier) ;
  - ensuite, pas de réussite du jour = alerte, pour la copie complète **et** pour le JSON, même si aucune exécution n'a jamais eu lieu
    (vérifié sur une base neuve, journal vide).
- **Pendant le déploiement** : l'ancien circuit n'écrit rien dans le journal. Faire donc les étapes 2 à 8 de la demande dans les
  **24 h** qui suivent la migration en production ; sinon, l'alerte quotidienne rappelle que le nouveau circuit n'a rien enregistré.
  C'est voulu : aucune période sans surveillance.
- **Échec**, première sauvegarde comprise : notification immédiate (« … : échec »), une fois par exécution. L'alerte de 13:07 reste due
  tant qu'aucune réussite n'est enregistrée ce jour-là. Un démarrage qui n'arrive même pas jusqu'à la base, par exemple une fonction
  absente, est couvert par l'alerte de 13:07 et par le mail de GitHub.
- **Coupure** : `supabase/retours-arriere/2026-11-09_sauvegarde_alerte_coupure.sql`, toujours en premier dans un retour arrière.
  Rejouer la migration la réarme, avec une nouvelle date de mise en place.
- Essais : aucune exécution depuis 3 jours → 2 alertes ; base neuve sans exécution → 2 alertes après le délai ; coupure → plus rien.
- Non vérifié : l'exécution réelle par pg_cron. En local, pg_cron est simulé ; la tâche, sa commande et son horaire sont vérifiés.

## 4. Tables du schéma `private` : décision explicite pour chacune
| Table | Décision | Où elle est déclarée |
|---|---|---|
| `import_secrets` | **exclue** : jamais copiée ; présence seulement (nom + empreinte tronquée, archive chiffrée) | exclusions décidées : `outils/prive_classement.sql` (sauvegarde), `tests/static/sauvegarde-declenchement.mjs` |
| `mailbox_owners` | **copiée** (nom de boîte + adresse du titulaire ; pas de neutralisation à la restauration) | grant du §1 de l'accord, migration v1.60.7, `outils/role_sauvegarde.sql` |
| `notion_raw`, `notion_cursor` | **copiées** (archive Notion) | `outils/role_sauvegarde.sql`, migration v1.60.7 |
| `sauvegarde_fenetre` | **copiée** | `outils/fenetre_connexion.sql` |
| `sauvegarde_executions`, `sauvegarde_surveillance` (nouvelles) | **copiées** (journal et date de mise en place, aucun secret) | migration v1.60.7 |
| `sync_urls` (messagerie v1.61, à venir) | **copiée**, sous conditions à remplir par le lot messagerie (voir ci-dessous) | migration v1.60.7 (si la table existe déjà), `outils/role_sauvegarde.sql` |

- **`sync_urls`** : elle est prévue pour la seule adresse de la fonction serveur `mail-sync`
  (`https://<projet>.supabase.co/functions/v1/mail-sync`). **Ce format n'est vérifié qu'à l'utilisation** (`mail_sync_tick` ignore une
  autre adresse) : la table elle-même n'a **aucune contrainte**. Le secret d'appel est `mail_sync_hook`, rangé dans `import_secrets`
  (présence seulement). Elle ne garde ni rattachement ni anti-doublon : ceux-ci sont dans les tables `public` de la messagerie,
  copiées.
  - **À faire par le lot messagerie** (point transmis) : une **contrainte de format** sur `sync_urls.url` (même expression que
    `mail_sync_tick`) et le **droit de lecture** `grant select on private.sync_urls to sauvegarde;`, dans sa migration. La décision
    « copiée » ne vaut qu'avec cette contrainte ; sans elle, la ressaisir avec Anthony.
  - Une base restaurée n'appelle rien : tâches planifiées arrêtées, `mail_sync_hook` absent.
  - Si la messagerie est installée **après** la v1.60.7, sa migration doit porter
    `grant select on private.sync_urls to sauvegarde;` (à signaler à ce lot). Sinon : alerte « Schéma privé » à la copie suivante,
    corrigée en rejouant `outils/role_sauvegarde.sql`.
- **Aucun droit global automatique sur le schéma `private`** : aucun `alter default privileges` (vérifié par le test `tests`). Une table
  privée non déclarée est **exclue** de la copie, avec une alerte « Schéma privé ».
- **Tables `public` : droits inchangés dans ce lot.** Le droit de lecture par défaut du rôle de sauvegarde sur les futures tables `public`
  existe depuis le B1 (réglages retirés) ; ni la migration ni `outils/role_sauvegarde.sql` n'y touchent.

## 5. Demande de déploiement (dans cet ordre ; état après chaque étape)
**Prérequis déjà autorisé** (§1 de l'accord) : `grant select on private.mailbox_owners to sauvegarde;`, puis relance vérifiée de la
copie complète.

**Réserves connues**, toujours signalées telles quelles par la vérification nocturne, sans changement dans ce lot :
- 57 fichiers stockés absents ;
- 1 section de structure sur 18 différente (17/18).

| # | Qui | Étape | État ensuite |
|---|---|---|---|
| 1 | Claude | **Migration sur le projet de test** `2026-11-09_v1.60.7_sauvegarde_declenchement.sql`. Elle exige le rôle `sauvegarde` et la fenêtre : s'ils manquent sur le test, y jouer d'abord `outils/role_sauvegarde.sql` et `outils/fenetre_connexion.sql`, sans mot de passe. Contrôles : dernière requête de la migration (0 table privée non classée, coffre illisible, aucun accès du navigateur) ; `select private.sauvegarde_controler()` → « délai de grâce jusqu'à … » | test seulement |
| 2 | Claude | **Migration en production**, avec empreinte identique à l'étape 1 et une sauvegarde fraîche réussie juste avant. **Vérifier l'initialisation de la surveillance** : `private.sauvegarde_surveillance` active, date = maintenant ; tâche `sauvegarde-controle` présente et active ; `sauvegarde_controler()` → « délai de grâce jusqu'à … » | journal, fonctions, **surveillance armée** (délai de grâce 24 h). Fenêtre fixe et workflows **inchangés** |
| 3 | Anthony | **Fusion de la demande lartbo-matrice v1.60.7** (« Rebase and merge »), tests et CodeQL verts sur le commit final. Claude vérifie ensuite que le contenu publié est identique au commit relu | Matrice en 1.60.7 (aucun changement visible : version et fichiers serveur) |
| 4 | Claude | **Fonction serveur** `sauvegarde-fenetre` (`index.ts` + `regles.ts` de `main`, « Verify JWT » désactivé), puis **vérification que la version en ligne est identique au dépôt** | fonction prête, appelée par personne |
| 5 | Anthony | **Secret GitHub**, étapes web ci-dessous | secret rangé ; les workflows de `main` ne l'utilisent pas encore : aucun changement |
| 6 | Anthony | **Fusion** de la demande `dev/sauvegarde-declenchement` du dépôt de sauvegarde (« Rebase and merge ») | démarrage réel actif **en plus** de la fenêtre fixe (filet gardé) |
| 7 | Anthony puis Claude | **Essai réel en journée**, hors fenêtre fixe (entre 05:00 et 23:00 UTC) : Actions › « Sauvegarde complète » › Run workflow, puis « Sauvegarde quotidienne » › Run workflow | les deux types ont une réussite enregistrée |
| 8 | — | **Nuit suivante** : le créneau 01:41 copie, les 3 suivants répondent « déjà faite » ; pas d'alerte à 13:07 | — |
| 9 | Claude | **Retrait de l'ancienne fenêtre fixe**, seulement si les critères ci-dessous sont remplis : `supabase/operations/2026-11-09_sauvegarde_activation.sql`. Une seule transaction ; elle refuse d'elle-même sans copie réussie refermée **par elle-même**, pendant une copie, dans la fenêtre fixe, ou si la connexion est encore ouverte | connexion ouverte uniquement par le démarrage réel |

**Étape 5 — secret GitHub (Anthony, web uniquement)**
1. Supabase › projet **Lartbo-matrice** › **Table Editor** › schéma `private` › table `import_secrets` › ligne
   `sauvegarde_declenchement_secret` : copier la valeur (64 caractères).
2. GitHub › `lartbo-matrice-backup` › **Settings** › **Secrets and variables** › **Actions** › **New repository secret** :
   Name `SAUVEGARDE_SIGNAL_SECRET`, Secret : coller, puis **Add secret**.
3. Vider le presse-papiers. Ne jamais coller la valeur ailleurs.

**Critères de réussite de l'étape 7, conditions de l'étape 9** (contrôlés par Claude en lecture seule ; ils couvrent les **deux**
types, copie complète et JSON, chacun surveillé séparément)
- exécution « Sauvegarde complète » **verte** : « Démarrage réel », « Fermeture de la connexion », vérification, enregistrement, bilan ;
  exécution « Sauvegarde quotidienne » **verte** ;
- dans `private.sauvegarde_executions` : une ligne `complete` « succes » **refermée par elle-même** (`fermeture_titulaire <= fin`) et
  une ligne `json` « succes » ;
- **fermeture vérifiée** : après la copie, `rolcanlogin = false` pour le rôle `sauvegarde` (hors fenêtre fixe), aucune session du rôle ;
- `base/derniere-copie.txt` : « vérification : success », « Fenêtre de connexion : OK », « Schéma privé : OK » ; restauration vérifiée,
  y compris `mailbox_owners` et son contenu (manifeste identique) ; réserves connues inchangées ;
- `sauvegarde_controler()` ne produit **aucune** alerte ce jour-là ;
- la nuit suivante (étape 8) : une seule copie, les créneaux de rattrapage en « déjà faite ».

**Retour arrière, à chaque état** : toujours **d'abord couper l'alerte** (`supabase/retours-arriere/2026-11-09_sauvegarde_alerte_coupure.sql`).
- Après l'étape 9 : **couper l'alerte**, puis remettre la fenêtre fixe (section « RETOUR » de l'opération d'activation), puis les points
  suivants.
- Après les étapes 5 à 8 : couper l'alerte ; supprimer le secret GitHub `SAUVEGARDE_SIGNAL_SECRET`. Les workflows reviennent d'eux-mêmes
  au fonctionnement d'avant (créneau principal seul). Si besoin, annuler la fusion par une nouvelle demande.
- Après les étapes 2 à 4 : `supabase/retours-arriere/2026-11-09_sauvegarde_declenchement_retour_arriere.sql`. Il coupe l'alerte,
  retire les fonctions et la tâche, et garde le journal. Fonction serveur : la supprimer dans Supabase › Edge Functions.
- Aucune donnée métier n'est touchée, à aucune étape.

## 6. Après une restauration : clés à remplacer
Le coffre n'est jamais copié. Nouvelles valeurs par `outils/regenerer_cles.sql` (dépôt de sauvegarde) : aucune migration rejouée,
aucune valeur affichée (nom, longueur, empreinte). Puis recopie de `mailbox_sign_key` dans la propriété `CLE_BOITE` du script de
prospection et de `sauvegarde_declenchement_secret` dans le secret GitHub. Marche à suivre : `RESTAURATION.md` §3, étape 6. Vérifié sur
la base jetable : les valeurs changent, rien n'est affiché.

## 7. Règle durable
Toute nouvelle table `private.*` est déclarée dans sa migration : `grant select … to sauvegarde` (copiée) ou ajout aux exclusions
décidées (secrets : présence seulement). Le test `tests` et l'alerte « Schéma privé » le contrôlent.
