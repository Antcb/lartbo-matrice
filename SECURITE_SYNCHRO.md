# Fonctions de synchronisation automatique — mécanisme d'accès (mail-sync, cal-sync)

Décision d'Anthony du 06/11/2026 : l'absence de session utilisateur pour un appel automatique ne rend pas la fonction publique.
Le réglage de la passerelle Supabase (vérification du jeton désactivée pour accepter l'appel de la tâche planifiée) **n'est pas**
la protection : chaque fonction contrôle elle-même chaque appel, avant de renvoyer ou d'écrire quoi que ce soit.

## Deux justificatifs acceptés, rien d'autre
| Appelant | Justificatif | Contrôle dans la fonction |
|---|---|---|
| Tâche planifiée de la base (toutes les 5 min) | en-tête `x-hook-secret` = secret serveur **dédié** (`mail_sync_hook` / `cal_sync_hook`) | secret lu côté serveur (`import_secret`, réservé au rôle serveur), comparaison à temps constant |
| Membre de l'équipe dans l'application (« Actualiser », choix d'un agenda…) | session Supabase de l'utilisateur (`Authorization: Bearer …`) | `is_team()` exécuté **avec la session de l'appelant** |
| Messagerie (`mail-sync` : « Actualiser », conversations ouvertes) | session du **propriétaire de la boîte** (décision du 08/11/2026) | `is_mailbox_owner('anthony')` exécuté avec la session de l'appelant ; tout autre membre de l'équipe → 403 |

Appels de `mail-sync` vers le script de prospection (`history`, `thread`) : identité du **titulaire inscrit** signée par le serveur avec la clé dédiée `mailbox_sign_key` (même mécanisme que le relais, `script-google/identite.ts`) ; la synchronisation planifiée n'a pas de session, mais seul ce code serveur, déclenché par le secret `mail_sync_hook` ou par la session du titulaire, lit la clé et l'adresse (rôle serveur, schéma privé). Réponse acceptée seulement si le compte qui exécute le script est ce titulaire.

Tout autre appel (aucun justificatif, secret faux ou vide, session d'un compte hors équipe, session expirée) → **403** : rien n'est
renvoyé ni écrit (la fonction lit seulement ses réglages et le secret pour décider). Le secret de la tâche planifiée ne permet QUE la synchronisation planifiée : les actions de l'application (relire des conversations
précises, liste des agendas, actualisation d'un seul artiste) exigent une session de l'équipe.

## Le secret dédié
- Tiré au hasard par la migration (environ 244 bits aléatoires), rangé dans `private.import_secrets` (schéma privé, comme le jeton Pennylane) ;
  jamais saisi, jamais affiché, distinct du code des scripts Google (`drive_webhook_secret`) et d'une fonction à l'autre.
- Lu seulement par : la fonction de la tâche planifiée (`mail_sync_tick` / `cal_sync_tick`, SECURITY DEFINER, interdite aux
  rôles `anon` et `authenticated`) et la fonction serveur (`import_secret`, rôle serveur seulement).
- Jamais envoyé au navigateur, jamais dans une adresse (en-tête HTTP seulement), jamais écrit dans un journal par notre code
  (les erreurs journalisées ne contiennent que des messages). Limite connue : l'extension d'appels HTTP de la base (pg_net) garde
  la requête, en-têtes compris, dans sa file interne le temps de l'envoyer — table du schéma `net`, inaccessible aux comptes ;
  même fonctionnement que l'appel existant de brevo-sync.
- Rotation : `update private.import_secrets set value = … where key = 'mail_sync_hook'` (une opération SQL autorisée) — la tâche
  planifiée et la fonction le relisent à chaque appel, aucun redéploiement.
- L'adresse appelée est lue dans `private.sync_urls` (schéma privé) et doit être `https://<projet>.supabase.co/functions/v1/<nom>` :
  aucun compte ne peut détourner l'appel (et donc le secret) vers un autre serveur.

## Vérifications avant déploiement (projet de test)
1. Sans en-tête ni session → 403. 2. `x-hook-secret` faux → 403. 3. Session d'un compte hors équipe → 403.
4. Session d'un membre de l'équipe → 200. 5. Secret dédié → 200 (synchronisation). 6. Liste des agendas avec le secret de la tâche → 403.
7. Journaux de la fonction (Supabase › Edge Functions › Logs) : aucun secret visible. 8. `select * from private.import_secrets` impossible
pour un compte connecté. — **Non vérifié tant que les fonctions ne sont pas déployées sur le projet de test.**

## Adresse du script de la boîte (relecture de f95da56)
Le serveur envoie à `prospect_script_url` des demandes signées au nom du titulaire : cette adresse n'est modifiable (insertion,
remplacement, effacement) que par le titulaire de la boîte (`is_mailbox_owner('anthony')`, règle `setting_write_ok` et RLS de
`settings`) ; registre vide → par SQL seulement. Anthony la change dans Réglages › Prospection, connecté avec son compte. La
vérification du compte qui répond (`compteOk`) n'est qu'un contrôle de cohérence : elle se fie au script appelé et ne protège pas
seule. La signature nomme la cible et la boîte : une demande captée sur l'adresse du script principal (`drive_webhook_url`,
modifiable par l'équipe) est refusée par le script de la boîte.
