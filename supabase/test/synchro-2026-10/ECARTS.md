# S0 — Écarts de schéma Supabase : production ↔ test (relevé du 23/10/2026)

- Production : `ypvvjoqhzddzbmerypdc`. Test : `dthfocplfzzmkgaxhmwk`.
- Relevé **en lecture seule** : catalogue uniquement, avec `b1/per_ord.sql`, puis le détail par instruction pour les sections différentes.
- Aucune donnée métier de la production n'a été lue : seulement des `count(*)`.
- Aucun secret ne figure dans ce document. Les corps de fonctions n'y sont pas recopiés.
- Script correspondant : `synchro_test.sql`, **non exécuté**. Retour arrière : `sync_test_rollback.md`.

## 1. Vue d'ensemble par section d'empreinte

| Section | Production (n) | Test (n) | Après le script |
|---|---|---|---|
| 0 en-tête, 5 clés étrangères, 9 vues, 15 droits schémas, 16 temps réel | = | = | identiques (déjà) |
| 1 extensions | 7 | 6 | reste différente : `pg_cron` volontairement absent du test |
| 2 séquences | 1 | 0 | **identique** (contrôlé en fin de script) |
| 3 tables | 29 | 26 | reste différente : tables exclues, verrou S1, tables Notion |
| 4 contraintes | 49 | 46 | reste différente (mêmes raisons) |
| 6 index | 20 | 17 | **identique** (contrôlé) |
| 8 fonctions | 62 | 34 | reste différente : fonctions exclues, `is_team` S1, `_exec` |
| 10 déclencheurs | 15 | 10 | **identique** (contrôlé) |
| 11 RLS | 26 | 22 | reste différente : tables techniques exclues |
| 12 règles d'accès | 27 | 26 | **identique** (contrôlé) |
| 13 droits tables | 115 | 96 | reste différente : objets exclus, verrou S1 |
| 14 droits fonctions | 111 | 68 | reste différente : fonctions exclues ; droits de `is_team` |
| 17 tâches planifiées | 1 | — | reste différente : aucune tâche planifiée dans le test (voulu) |
| 18 espaces de fichiers | 3 | 3 | **identique** (contrôlé) |

Section 7 (séquences rattachées) : vide des deux côtés.

**Constat** : sur les 67 objets communs relevés le 22/10, aucune différence nouvelle. Les écarts ci-dessous sont exactement ceux de l'audit S0, avec deux précisions : `private.import_secrets.value` et les tables Notion.

## 2. Tableau des écarts

Légende :
- **A** : à aligner, fait par le script.
- **T** : à garder propre au test.
- **S** : à signaler, non traité par le script.

### 2.1 Structure (tables, colonnes, séquence, contraintes, index, RLS, règles)

| # | Objet | Écart | Décision |
|---|---|---|---|
| 1 | `public.shows.prod_mode_manual` | colonne absente du test (production : `boolean not null default false`, colonne n° 71, la dernière) | **A**. Ajoutée en dernière position. Les mises à jour de données de v1.36 ne sont pas reprises : 0 date du jeu fictif n'est concernée (vérifié) |
| 2 | `public.client_errors` | table absente du test, avec sa séquence d'identité, sa clé primaire, la RLS, la règle « insert own errors » et ses droits | **A**. Table **vide**, aucune ligne de la production. Hors temps réel, comme en production |
| 3 | `private.import_secrets.value` | `not null` en production, acceptée vide dans le test | **A** (coffre vide dans le test) |
| 4 | index `budget_lines_project`, `budget_lines_show`, `budget_lines_one_auto` (unique, partiel) | absents du test | **A** (0 doublon dans le test, vérifié) |
| 5 | `private.comptes_suspendus` et sa clé primaire | test seulement | **T** (verrou S1) |
| 6 | `public._folder_jobs` (table, clé, RLS, droits) | production seulement | **S**. Proposée par l'audit §4.1, mais elle ne sert qu'à `_folder_tick`, exclue. Sans cette fonction, la table serait inutile : **à décider** |
| 7 | `public._koza_job`, `public._lartbotrice_job` (table, clé, RLS, droits) | production seulement | **S**. Exclues : techniques, sans lien avec la Matrice (§7.8) |
| 8 | `private.notion_cursor` | `done` sans valeur par défaut dans le test (production : `false`) | **S**. Import Notion exclu |
| 9 | `private.notion_raw` | clé primaire sur `source` dans le test, sur `page_id` en production ; `page_id` et `props` acceptent le vide dans le test | **S**. Import Notion exclu. L'alignement exigerait de **supprimer** une contrainte : validation requise |
| 10 | espace de fichiers `suivi` | limite de taille : 50 Mo en production, aucune dans le test | **A** (réglage d'une ligne de `storage.buckets`, aucun fichier) |

### 2.2 Fonctions

| # | Fonction | Écart | Décision |
|---|---|---|---|
| 11 | `clean_email`, `clean_phone`, `contacts_clean`, `structures_place_clean`, `workday`, `ensure_movinmotion`, `ensure_production_payments`, `project_mode_to_shows`, `show_follow_project_mode`, `show_mode_payments` | 10 fonctions absentes du test | **A**. Texte identique à la production au caractère près, y compris les caractères invisibles des expressions de nettoyage (md5 contrôlé) |
| 12 | `generate_reminders` | version du test antérieure au décalage au jour ouvré (`workday`, colonnes `raw`/`w`) | **A** |
| 13 | `artist_info_save` | une seule ligne de commentaire en moins dans le test | **A** |
| 14 | `brevo_queue`, `pennylane_status`, `set_pennylane_key` | coquilles vides dans le test (sans droits du propriétaire ni `search_path`) | **A**, remplacement explicite décidé à l'audit §4.1. Neutralité : `brevo_queue` s'arrête si `brevo_api_key` est vide (contrôlé en début et en fin de script) ; le coffre du test est vide ; aucune fonction serveur dans le test. **À revérifier avant S2** (fonction `brevo-sync` du test) |
| 15 | `_push(text)` | test : phrase secrète en clair, droits du propriétaire, appelable par un visiteur anonyme ; production : neutralisée (« désactivé ») | **A**. Version production neutralisée ; le secret disparaît du test. L'ancienne version **n'est ni recopiée ni restaurable** (voir R4) |
| 16 | `is_team()` | corps différent (verrou S1) | **T**. Non touchée ; contrôlée avant et après |
| 17 | `_exec(text, text)` | test seulement (neutralisée, `service_role`) | **S**. Retrait = R4, sur autorisation (§7.8) |
| 18 | `private.geo_fill`, `n_date`, `n_date_end`, `n_multi`, `n_num`, `n_people`, `n_place`, `n_rel`, `n_sel`, `n_text`, `notion_pull`, `notion_source_id`, `notion_transform` | 13, production seulement | **S**. Exclues (import Notion) |
| 19 | `_export_ddl`, `_export_ddl2`, `_folder_tick`, `_koza_tick`, `_lartbotrice_tick`, `_push_table` | 6, production seulement | **S**. Exclues (techniques). Plusieurs font des appels sortants (`net`) |

**Secrets** : les 16 fonctions reprises ont été contrôlées par motifs (jeton, adresse web, référence au projet de production, longue chaîne littérale) ; aucun secret. La seule longue chaîne trouvée est un nom de réglage (`booking_commission_payee`). **Aucune valeur factice n'a été nécessaire.**

### 2.3 Déclencheurs

| # | Déclencheur | Décision |
|---|---|---|
| 20 | `contacts_clean` (contacts), `structures_place_clean` (structures), `project_mode_to_shows` (projects), `show_follow_project_mode` et `show_mode_payments` (shows) : absents du test | **A**. Ils agissent seulement sur les écritures **futures**. Les contacts fictifs déjà « sales » (cas de nettoyage) restent tels quels jusqu'à leur prochaine modification |

### 2.4 Droits d'exécution des fonctions (risque R3)

| # | Fonctions | Test aujourd'hui | Production = après script | Décision |
|---|---|---|---|---|
| 21 | `generate_reminders`, `import_secret`, `on_show_confirmed`, `brevo_queue`, `_push` | public, anon, authenticated, service_role | service_role | **A** |
| 22 | `ai_key_status`, `mail_vars`, `request_drive_folder`, `set_ai_key`, `pennylane_status`, `set_pennylane_key` | public, anon, authenticated, service_role | authenticated, service_role | **A** |
| 23 | `fiche_get`, `fiche_submit`, `rh_get`, `rh_submit` | public, anon, authenticated, service_role | anon, authenticated, service_role | **A** |
| 24 | 10 nouvelles fonctions | — | comme en production (8 ouvertes à tous ; `ensure_production_payments` et `show_mode_payments` : service_role) | **A** |
| 25 | **`is_team()`** | public, anon, authenticated, service_role | authenticated, service_role | **S, à décider**. Non modifiée pour respecter la consigne « ne pas toucher `is_team()` ». Ligne prête : `revoke execute on function public.is_team() from public, anon;` (le contrôle 9.1 du script devra alors être ajusté, car il compare les droits avant et après) |

Les droits sur les tables communes sont **identiques** des deux côtés. `client_errors` reçoit les mêmes droits qu'en production. À signaler : en production, le visiteur anonyme a tous les droits de table sur `client_errors` (seule la RLS le bloque), comme sur les autres tables.

### 2.5 Extensions et tâches planifiées

| # | Objet | Décision |
|---|---|---|
| 26 | `pg_cron` et la tâche `rappels-quotidiens` (5 h UTC, `generate_reminders`) : production seulement | **T**. Aucun rappel automatique dans le test. Le script **refuse** de tourner si `pg_cron` y apparaît |

### 2.6 Décompte

- **À aligner (A)**, 53 éléments :
  - structure (7) : 1 colonne, 1 table avec sa séquence, sa clé, sa RLS, sa règle et ses droits, 1 contrainte `not null`, 3 index, 1 réglage d'espace de fichiers ;
  - 16 fonctions (10 absentes, 6 différentes) et 5 déclencheurs ;
  - droits d'exécution de 15 fonctions existantes, plus 10 nouvelles.
- **Propre au test (T)**, 3 éléments : table de suspension (avec sa clé), `is_team()` avec verrou, absence de `pg_cron` et de la tâche planifiée. Ainsi que les réglages d'intégration vides, que le script ne touche pas.
- **À signaler (S)**, 7 lignes du tableau : n° 6, 7, 8, 9, 17, 18-19, 25. Ce sont 26 objets exclus au total : 3 tables techniques, 2 tables Notion, `_exec`, 19 fonctions, les droits de `is_team`.

## 3. Ce que fait le script (`synchro_test.sql`)

1. **Garde-fou** à 6 conditions indépendantes, plus la condition « verrou » du garde-fou S1. Vérifié en production, par comptages : les conditions 1 (réglage), 2 (compte), 3 (table de suspension), 4 (volumes : 22 artistes, 5 826 structures, 8 457 contacts) et 6 (`pg_cron` présent) y sont **fausses**. Le script y serait donc refusé. Dans le test, toutes sont vraies aujourd'hui.
2. **Photographie « avant »** :
   - verrou S1 : définition et droits de `is_team`, contenu de la suspension ;
   - volumes, réglages, file `pg_net`.
3. **Alignement**, dans cet ordre :
   - colonne ;
   - 16 fonctions ;
   - 5 déclencheurs ;
   - 3 index ;
   - `client_errors` ;
   - `import_secrets` ;
   - droits ;
   - espace `suivi`.
4. **Contrôles de fin** (toute anomalie annule l'ensemble) :
   - **verrou S1 inchangé** : définition, droits et contenu. Simulation de session : la testeuse est **refusée** et un membre de l'équipe accepté. Le blocage de connexion fait seulement l'objet d'un avertissement, car le script n'y touche pas ;
   - **jeu fictif inchangé** : 4 / 15 / 25 / 30 / 28 / 20. Équipe, budgets, notifications, réglages et file `pg_net` inchangés ; `client_errors` vide ;
   - **texte des 16 fonctions = production** (md5) et propriétaire `postgres` ;
   - **droits d'exécution de 26 fonctions = production** ;
   - **empreintes = production** pour les sections 2, 6, **10 (déclencheurs : `12e6097f…`, 15 objets)**, 12 et 18 ;
   - puis `commit`.

## 4. Écart assumé avec le garde-fou S1 rédigé le 22/10 (`r1/garde_synchro_suspension.sql`)

Le garde-fou d'origine **refuse de tourner tant qu'une suspension est en cours**. Or elle l'est (1 ligne). Il prévoyait en plus que la synchronisation installe `is_team()` avec verrou.

La consigne de ce lot est différente : ne pas toucher `is_team()` du test ni la table, et vérifier que le verrou reste actif. J'ai donc fait ceci :
- **conservé** tel quel le contrôle « `is_team()` a perdu son verrou » ;
- **remplacé** le refus « suspension en cours » par une photographie avant / après et une simulation de session.

Conséquence : **si la suspension est levée avant l'exécution**, le contrôle de fin échoue volontairement (« table de suspension modifiée ou vide ») et rien n'est appliqué. Il faudra alors adapter ce contrôle.

**À valider par Anthony.**

## 5. Effets de bord à connaître
- Après synchronisation :
  - le garde-fou de `r1/seed_fictif.sql` refusera de tourner : empreinte des déclencheurs et de `brevo_queue` modifiée ;
  - celui de `r1/r1_purge.sql` aussi : `client_errors` présente.
  
  Les deux sont à réviser avant tout rechargement du jeu fictif.
- `brevo_queue` (version production) mettra un appel `pg_net` en file **dès que** `brevo_api_key` sera renseignée dans le test. Aujourd'hui elle est vide : aucun appel (essayé en local).
- `generate_reminders` n'est appelée par aucune tâche planifiée dans le test. Elle n'agit que si on la lance à la main.

## 6. Vérifications faites
- **Lecture du catalogue des deux projets** :
  - empreintes par section ;
  - détail par instruction ;
  - définitions des fonctions différentes ;
  - droits ;
  - protections de `storage.buckets` (elles ne portent que sur les colonnes de cycle de vie).
- **Copie exacte** des 16 définitions de production, par encodage base64. md5 local identique à la production pour les 16.
- **Essai complet hors ligne**, sur une instance PostgreSQL 16 locale isolée (port 55433, arrêtée ensuite), avec :
  - la reproduction du schéma du test (`r1/schema_test.sql`) ;
  - le verrou S1 et `is_team()` du test ;
  - le jeu fictif (`r1/seed_fictif.sql`, empreinte de l'adresse remplacée et un contrôle d'empreinte ignoré, car spécifiques au vrai test).

  Résultats :
  - script complet : tous les contrôles passent jusqu'aux empreintes de section. La section 6 diffère localement, car la reproduction n'a pas les 17 index du test. Le refus annule bien tout ;
  - sans le bloc d'empreintes : « Synchronisation du test OK ». **Second passage sans effet** ;
  - **refus vérifiés** pour 5 cas : base dont le réglage n'est pas celui du test, `is_team` sans verrou, suspension levée, Brevo réglé, jeu fictif modifié. Dans chaque cas, rien n'est créé ;
  - **retour arrière** (`sync_test_rollback.md`) essayé en local : on revient à l'état initial, sauf `_push`, qui reste neutralisée ;
  - **essai fonctionnel** (transaction annulée) : nettoyage d'un contact, département vidé hors France, changement de mode d'un artiste suivi par ses dates avec création des paiements de production (28 → 36), 8 rappels au jour ouvré, **0 appel sortant**.

## 7. Non vérifié
- **Exécution réelle sur le projet de test** : non faite (interdit dans ce lot).
- **Égalité des empreintes de fin dans le vrai test** :
  - sections 2, 6, 10, 12, 18 calculées sous PostgreSQL 17 et le même `search_path` que l'outil Supabase, mais non rejouées dans le test après application ;
  - le calcul local (PostgreSQL 16) ne pouvait pas les reproduire.
- **Script lancé avec `psql`** : non essayé. Le script fixe le `search_path`, mais un autre client pourrait modifier le texte des empreintes. Dans ce cas, le refus est sûr et rien n'est appliqué.
- **Réglages d'authentification et fonctions serveur (edge)** : hors du catalogue SQL, non comparés.
- **Contenu de `_push` du test** : non relu, car il contient la phrase secrète. Seuls ses attributs ont été lus.
