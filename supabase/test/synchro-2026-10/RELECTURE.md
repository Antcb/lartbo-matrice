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

Essayé en local : application du script, puis du retour arrière (avec les 5 définitions de `avant/` insérées), puis comparaison `pg_dump -s` avec l'état initial.

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

- **R1 — à faire avant l'exécution.** Le retour arrière dépend de `supabase/test/synchro-2026-10/avant/*.sql`, qui se trouve dans le dossier **temporaire** de la session. Il faut copier ces 5 définitions à un endroit durable (par exemple le dépôt, `supabase/test/`) ou les relire dans le test juste avant l'exécution. Sinon, le retour arrière de ces 5 fonctions ne sera plus possible.
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
