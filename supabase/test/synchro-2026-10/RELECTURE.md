# Relecture indépendante — `synchro_test.sql` (mise à niveau du schéma du projet de TEST)

- Relecteur : instance de Claude distincte, sans l'historique du développement. Aucune ligne du lot écrite par moi. Limites : même famille de modèle, consignes rédigées par l'agent développeur.
- Date : 23/10/2026. Fichiers relus : `synchro_test.sql` (526 lignes), `ECARTS.md`, `sync_test_rollback.md`, `r1/garde_synchro_suspension.sql`, `b1/schema_prod.sql`.
- Rien n'a été modifié : ni les fichiers, ni les bases. Production : lecture du **catalogue** seulement. Test : catalogue, `count(*)`, `settings` (valeurs masquées sauf `functions_base_url`).

## Verdict : **bloquants : aucun**

Deux points sont à faire **avant** l'exécution, sans changer le script (voir R1 et R2).

## 1. Garde-fou et transaction

| Condition | Production (catalogue lu le 23/10) | Test |
|---|---|---|
| 3. `private.comptes_suspendus` (l. 34) | `to_regclass` = **NULL** → refus | présente |
| 6. `pg_cron` (l. 45) | **installé** (1.6.4, tâche `rappels-quotidiens`) → refus | absent |
| 1. `functions_base_url` (l. 30) | non lu (donnée de réglage de la production, hors de mon accès) | `https://dthfocplfzzmkgaxhmwk…` → passe |
| 2. compte testeuse, 4. volumes, 5. intégrations | non lus en production | passent : 4/15/25/30/28/20, 7 réglages d'intégration vides |

- Les conditions 3 et 6 suffisent, chacune seule, à refuser en production. Le premier bloc `do` est la première instruction après `begin` / `set local`, donc **rien n'est écrit** avant le refus.
- Une seule transaction. Aucune instruction non transactionnelle : pas de `concurrently`, pas de `vacuum`, pas d'`alter type … add value`. Les déclencheurs d'événement du test (`pgrst_ddl_watch`, `issue_pg_net_access`…) envoient seulement un `NOTIFY` au commit.
- **Essai local** (PostgreSQL 16, cluster jetable sur le port 55499, détruit ensuite). Schéma du test reconstitué (`r1/schema_test.sql`, plus les 17 index réels du test, `is_team()` exacte du test, jeu fictif minimal 4/15/25/30/28/20), empreinte de l'adresse remplacée.
  - **Script complet** : les contrôles 9.1 à 9.4 passent, ainsi que les sections 2, 6 et 10 de 9.5. Il échoue en section 12, car le cluster local n'a pas de règles d'accès. Après cet échec : ni `client_errors`, ni `prod_mode_manual`, ni déclencheur → **annulation totale vérifiée**.
  - **Sans le bloc 9.5** : « Synchronisation du test OK ». Le second passage ne change rien.

## 2. Données, appels sortants, tâches planifiées

- Aucun `insert`, `update` ni `delete` sur `public.*`. Une seule écriture : `storage.buckets.file_size_limit`. Les déclencheurs `protect_bucket_control_update*` du test ne portent que sur les colonnes de cycle de vie (définitions relues).
- Aucun `cron.schedule`. Le script refuse de tourner si `pg_cron` est présent.
- Les 5 déclencheurs ajoutés n'agissent que sur les écritures futures.
- Essai en transaction annulée, avec le rôle `authenticated` (aucune erreur de droit) :
  - nettoyage d'un e-mail ;
  - changement de mode d'un artiste dans les deux sens ;
  - confirmation d'une date ;
  - **0 appel sortant** (le `net.http_post` local lève une exception s'il est appelé).
- Le contrôle de fin compare la file `net.http_request_queue` (0 aujourd'hui dans le test) avant et après.

## 3. Verrou S1

- `is_team()` et `private.comptes_suspendus` ne sont modifiées par aucune instruction.
- Le contrôle 9.1 vérifie ensuite :
  - le md5 de la définition de `is_team()` et ses droits ;
  - le nombre de lignes de la table et leur empreinte, qui ne doit pas être vide ;
  - une **simulation de session** : la testeuse doit être refusée, un membre de l'équipe accepté.

  Ce contrôle est probant, car le test réel a 3 `app_users`, 0 adresse en majuscules et la testeuse est bien suspendue (1 ligne). Son blocage de connexion est actif (`banned_until` dans le futur).
- L'écart avec le garde-fou d'origine (refus tant qu'une suspension est en cours) est justifié dans `ECARTS.md` §4 et doit être validé par Anthony.

## 4. Fidélité à la production

- **16 fonctions** :
  - le texte du script est identique **au caractère près** aux blocs de `b1/schema_prod.sql` (comparaison Python, caractères invisibles compris) ;
  - le md5 de `pg_get_functiondef` relu aujourd'hui en production est égal aux 16 valeurs de la l. 448-463 ;
  - leur propriétaire en production est `postgres` ;
  - en local, ces md5 sont égaux une fois les fonctions créées.
- **Droits** : pour chacune des 26 fonctions de 9.4, l'ACL de production relue est égale à la valeur attendue. Après le script, toutes les fonctions communes ont les mêmes droits qu'en production, **sauf `is_team()`** (écart volontaire n° 25).
- **Déclencheurs et index** : la liste de la production est égale à celle du test, plus les 5 déclencheurs et les 3 index du script (texte relu des deux côtés).
- **Empreintes de 9.5** : les valeurs de production recalculées aujourd'hui sont égales à celles du script (sections 2, 6, 10, 12 et 18).
  - Sections 12 et 18 : j'ai simulé dans le test la règle et la limite ajoutées. Résultat : `e5e19509…` (27) et `0da93d34…` (3), soit exactement les valeurs attendues. Ces empreintes passeront donc dans le test.
- **`client_errors`** : identique à la production :
  - colonnes, identité `always`, clé primaire ;
  - RLS et règle « insert own errors » ;
  - droits `arwdDxtm` et `rwU` ;
  - hors temps réel.
- **Autres alignements** : `prod_mode_manual` (`boolean not null default false`, n° 71), `import_secrets.value not null` et la limite de 50 Mo de `suivi` sont conformes à la production.
- **Secrets** : aucun dans les 16 corps de fonction. J'ai cherché adresses web, référence à la production, jetons et longues chaînes ; seule chaîne longue trouvée : `booking_commission_payee`.
- La seule donnée de personne est l'**empreinte md5** de l'adresse de la testeuse.
- L'ancienne `_push` du test, qui contenait une phrase secrète, est remplacée et non recopiée.

## 5. Retour arrière

Essayé en local : application du script, puis du retour arrière (avec les 5 définitions de `work/test_avant/` insérées), puis comparaison `pg_dump -s` avec l'état initial.

Différences constatées :
- `_push` neutralisée, comme annoncé ;
- l'ordre des lignes `GRANT` (sans effet) ;
- les corps des 5 fonctions : ceux de `test_avant` remplacent mes coquilles locales, ce qui est attendu.

Le garde-fou du retour arrière (conditions 1 à 3) refuse en production grâce à la condition 3.

## 6. Effets de bord

- **Application** : le dépôt n'appelle par RPC aucune fonction devenue réservée au serveur. Seule `ensure_movinmotion` est appelée (`js/budget-actions.js:39`), et elle reste ouverte. `import_secret` et `is_team` ne sont appelées que par des fonctions serveur.
- L'application 1.40.2 a besoin de `prod_mode_manual` : le script comble ce manque.
- **Scripts du jeu fictif** : `r1/seed_fictif.sql` et `r1/r1_purge.sql` refuseront ensuite de tourner, comme annoncé dans `ECARTS.md` §5. Il faudra les réviser avant tout rechargement.

## Remarques (non bloquantes)

- **R1 — à faire avant l'exécution.** Le retour arrière dépend de `sync_test/work/test_avant/*.sql`, qui se trouve dans le dossier **temporaire** de la session. Il faut copier ces 5 définitions à un endroit durable (par exemple le dépôt, `supabase/test/`) ou les relire dans le test juste avant l'exécution. Sinon, le retour arrière de ces 5 fonctions ne sera plus possible.
- **R2 — à faire avant l'exécution.** Anthony doit valider l'adaptation du garde-fou S1 (`ECARTS.md` §4) et la décision n° 25 (`is_team()` reste ouverte à `anon` / `public` dans le test).
- **R3.** Le contrôle S1 ne photographie pas les droits de la table `private.comptes_suspendus`. Le script ne les touche pas, mais une ligne de plus dans `_sync_avant` (`relacl`) rendrait la preuve complète.
- **R4.** Les messages `raise notice` et `raise warning` (succès, blocage de connexion) risquent de ne pas s'afficher dans l'outil Supabase. Le succès se lit donc à l'**absence d'erreur**. Un `select` de confirmation après le `commit` serait plus lisible.
- **R5.** Dès que `brevo_api_key` sera renseignée dans le test, `brevo_queue` (version production) appellera la fonction `brevo-sync` du test. Cela est déjà signalé dans `ECARTS.md` : à revoir avant S2.
- **R6.** Le retour arrière rouvre les droits de `_push` (neutralisée) à `anon`. C'est sans risque réel, mais inutile : cette ligne peut être retirée de l'étape 4.

## Non vérifié

- **Exécution réelle sur le projet de test** : non faite (interdit). Le passage du bloc 9.5 dans le test est déduit par calcul, pas observé.
- **Conditions 1, 2, 4 et 5 en production** : non lues, car ce sont des données (réglages, comptes, volumes). Le refus repose sur les conditions 3 et 6, vérifiées dans le catalogue.
- **Comportement exact de l'outil Supabase `execute_sql`** avec `begin` / `commit` explicites dans un envoi unique : l'atomicité est attendue, mais non observée.
- **Lancement avec `psql`** : essayé seulement en local, avec PostgreSQL 16 au lieu de 17. Différence observée : le droit `m` (MAINTAIN) n'existe qu'en 17, ce qui est sans effet sur les contrôles.
- **Réglages d'authentification et fonctions serveur (edge)** : non comparés.

---

# Seconde relecture — commit `6821d1d6d4e1e0eed3711f2aa9d73e8345fcb978` (branche `dev/s0-synchro-test`), 24/10/2026

Fichier relu : `supabase/test/synchro-2026-10/synchro_test.sql` au commit exact (`git show 6821d1d:…`). Même relecteur, mêmes interdits : Supabase en lecture du catalogue seulement, essais sur un cluster local jetable (port 55499, **détruit**), aucun commit, aucun push. Le dépôt n'a pas été modifié ; ce complément est à recopier dans `supabase/test/synchro-2026-10/RELECTURE.md` par l'agent développeur (la copie du dépôt diffère de celle-ci).

## Verdict : **bloquants : aucun**

## 1. Ce qui a changé depuis la première relecture
- `git diff main...6821d1d` ne touche que `supabase/test/synchro-2026-10/` (9 fichiers, aucun fichier de l'application).
- `cf9786c:synchro_test.sql` est identique octet pour octet au script relu le 23/10 ; `6821d1d` n'y ajoute que le bloc S1 (l. 49-65) : 3 refus, levés **avant toute écriture** (juste après le garde-fou à 6 conditions).
- Les 5 fichiers `avant/*.sql` sont identiques aux définitions utilisées pour l'essai de retour arrière du 23/10 → la remarque R1 (définitions dans un dossier temporaire) est **levée**.

## 2. Refus S1 — essai local (schéma du test reconstitué, RLS et règles du test, empreinte de l'adresse remplacée)
État relevé après chaque essai : `client_errors`, `prod_mode_manual`, nombre de déclencheurs, index de `budget_lines`, nombre de fonctions, retour de `_push`, file `pg_net`, limite de `suivi`.

| Cas | Préparation | Résultat | État après |
|---|---|---|---|
| Témoin (aucune exécution) | — | — | absente / 0 / 10 / 2 / 66 / ancienne / 0 / null |
| 1. Verrou retiré de `is_team()` | `is_team()` remplacée par la version de production | `Refus (S1 verrou)` (l. 65) | **identique au témoin** |
| 2. Ligne de la testeuse supprimée | `delete from private.comptes_suspendus` | `Refus (S1 suspension)` | **identique** |
| 3a. Blocage vide | `banned_until = null` | `Refus (S1 blocage)` | **identique** |
| 3b. Blocage expiré | `banned_until = now() - 1 min` | `Refus (S1 blocage)` | **identique** |
| Nominal (script complet) | — | passe tout jusqu'à 9.5, puis échec section 6 (la reconstitution n'a pas les 17 index du test) | **identique** (annulation totale, une preuve de plus) |
| Nominal (sans le bloc 9.5) | — | « Synchronisation du test OK » | présente / 1 / 15 / 5 / 76 / « désactivé » / 0 / 52428800 |

Le passage du bloc 9.5 dans le vrai test reste démontré par calcul (première relecture, §4).

## 3. État réel du test aujourd'hui (lecture seule, 24/10 09:12 UTC)
- ligne de la testeuse dans `private.comptes_suspendus` : **1** ;
- `banned_until` : **11/11/2026**, actif (`> now()`) ;
- verrou présent dans `is_team()` (md5 `828f25e9…`) ;
- volumes 4/15/25/30/28/20, `pg_cron` absent, `client_errors` absente.

→ Les 3 conditions sont remplies : le script passerait aujourd'hui. **À savoir : après le 11/11/2026, il refusera** (blocage expiré), sauf prolongation du blocage.

## 4. `is_team()` laissée exécutable par `anon` : démonstration sur la copie locale APRÈS synchronisation
- **Signature** : `is_team()`, **0 paramètre**. Aucune entrée possible.
- **Résultat pour un anonyme** : `false` sans jeton, `false` avec un jeton `anon`. Elle ne renvoie `true` que si la session porte l'adresse d'un membre de l'équipe : via l'API, ces réglages viennent du jeton signé et l'anonyme ne peut pas les forger (PostgREST n'expose pas `set_config`). Ce cas n'existe donc que pour un accès SQL direct, qui donne déjà tous les droits.
- **Lectures** : **0 ligne** sur les 23 tables de `public` et sur la vue `show_payments_computed` (`security_invoker`).
- **Écritures** : `insert` refusé par la RLS sur `contacts`, `settings`, `budget_lines`, `client_errors`, `notifications`.
- **`private`** : `permission denied for schema private` (`comptes_suspendus`, `import_secrets`). Dans le vrai test, `anon` n'a pas l'usage de `private` (catalogue).
- **Équipe et testeuse inchangées** : un membre lit 30 dates et 1 ligne de budget ; la testeuse suspendue, 0 et 0.

### Liste exhaustive des fonctions de `public` / `private` exécutables par `anon`

Production : **24** fonctions (catalogue lu aujourd'hui). Test après synchronisation : **25**, soit **les mêmes 24 plus `is_team()`**. Aucune fonction de `private` n'est accessible (pas d'usage du schéma). Les 24 ont un md5 identique dans les deux projets : les 16 déjà présentes dans le test ont été vérifiées dans le catalogue ; les 8 nouvelles sont recopiées de la production.

Appel de chaque fonction par `anon` en local, avec des valeurs piégées :

| Fonctions | Ce qu'un anonyme en tire |
|---|---|
| `is_team()` | toujours `false` : rien |
| `setting_text`, `setting_num` (droits de l'appelant) | `NULL`, car la RLS de `settings` bloque l'anonyme : aucun réglage lisible |
| `artist_token_ok`, `rh_token_ok` | `false` pour un jeton inventé. Elles répondent seulement « ce jeton existe-t-il ? » ; les jetons font 32 caractères aléatoires (impossibles à deviner). Même chose qu'en production, voulu |
| `artist_get`, `fiche_get`, `rh_get` | `NULL` avec un jeton inventé, `%` ou `null` (comparaison stricte, jeton d'au moins 16 caractères). Les pages publiques à jeton, conçues pour cela ; `rh_get` masque IBAN, n° de sécurité sociale, etc. |
| `artist_submit`, `fiche_submit`, `rh_submit` | « Lien invalide » sans jeton valide |
| `ensure_movinmotion` (droits de l'appelant) | rien : la RLS de `shows` cache tout, aucune ligne insérée |
| 7 fonctions de déclencheur (`contacts_clean`, `shows_defaults`, `brevo_contact_trg`, `touch_updated_at`, `project_mode_to_shows`, `show_follow_project_mode`, `structures_place_clean`) | « trigger functions can only be called as triggers » |
| `clean_email`, `clean_phone`, `workday`, `fr_date`, `fr_eur`, `contact_first_name` | calculs purs sur la valeur fournie, sans accès aux données |

Les 11 fonctions sensibles du test (`generate_reminders`, `_push`, `import_secret`, `ai_key_status`, `set_ai_key`, `mail_vars`, `request_drive_folder`, `pennylane_status`, `set_pennylane_key`, `brevo_queue`, `ensure_production_payments`) ainsi que `artist_sync` et `artist_info_save` répondent toutes : **permission denied**.

Hors périmètre, identique en production et non touché par le script :
- `net.http_get` et `net.http_post` sont exécutables par `anon`. C'est le réglage par défaut de Supabase. Le schéma `net` n'est pas exposé par l'API.
- Les dépôts de fichiers anonymes à jeton (`artiste`, `rh`) dans `storage` ont des empreintes de règles identiques à la production.

**Conclusion** : laisser `anon` sur `is_team()` ne donne à un visiteur anonyme **aucune information et aucun contournement**.

## 5. Faut-il retirer `anon` de `is_team()` ?
- **Effet démontré** (en local, avec `revoke execute on function public.is_team() from public, anon`) : une seule différence pour un anonyme. La lecture de `budget_lines` renvoie **`permission denied for function is_team`** au lieu de 0 ligne. La cause : sa règle `budget_team` vise le rôle `public`, donc aussi `anon`. Toutes les autres tables restent à 0 ligne, car leurs règles ne visent que `authenticated`. C'est exactement le comportement de la production.
- **Pas de casse pour l'application** :
  - les pages publiques (`fiche.html`, `artiste.html`, `rh.html`) n'utilisent que les 6 fonctions à jeton et les dépôts de fichiers à jeton, jamais `is_team()` en anonyme ;
  - les fonctions serveur l'appellent avec le jeton de l'utilisateur (`authenticated`) ;
  - le verrou S1 n'est pas affaibli, car `authenticated` garde le droit.
- **Avis du relecteur** : retirer `anon` est **préférable**, mais n'est **pas nécessaire pour la sécurité**.
  - Avantages : identique à la production (un écart de moins, n° 25 d'`ECARTS.md`) ; une erreur visible plutôt qu'un 0 ligne silencieux si un futur écran tentait une lecture anonyme ; principe du moindre droit.
  - Si Anthony le décide dans ce script : ajouter `revoke execute on function public.is_team() from public, anon;` et adapter le contrôle 9.1, qui compare les droits de `is_team()` avant et après. Il devrait comparer à `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. Ce changement doit repasser en relecture.
  - Sinon, le laisser tel quel est sans risque (§4).

## 6. Remarques restantes (non bloquantes)
- **R2** reste à valider par Anthony : la décision n° 25 (`is_team()`, voir §5). L'adaptation du garde-fou S1 est désormais tranchée (refus).
- **R3, R4, R6** de la première relecture : inchangées, facultatives.
- **Nouveau** : le script cessera de passer après le 11/11/2026 si le blocage de connexion n'est pas prolongé (comportement voulu, à connaître).
- **Nouveau, purement cosmétique** : l'avertissement de fin sur le blocage de connexion (contrôle 9.1) ne peut plus se déclencher, puisque ce cas est désormais refusé dès le début.

## 7. Non vérifié
- Exécution réelle sur le projet de test (interdit).
- Reconstitution locale : elle ne contient qu'un index du test au lieu de 17 et une partie seulement des colonnes réelles des vues. Les règles d'accès et les droits sont reproduits d'après le catalogue du 24/10.
- Les fonctions à jeton chargées en local sont les définitions de production, de md5 identique à celles du test.
- Le comportement de PostgREST (impossible de forger les réglages du jeton, schémas exposés) est raisonné d'après la configuration standard de Supabase, pas essayé.
- Les tests automatiques du dépôt (`tests/`) n'ont pas été lancés : le lot ne touche que `supabase/test/`.
