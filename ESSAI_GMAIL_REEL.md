# Messagerie — séance d'essai réel Gmail (document unique)

Préparé le 06/11/2026, mis à jour le 08/11/2026 (décisions d'Anthony). **Aucun contact réel, aucune boîte réelle d'Anthony, aucune
donnée de production.** Rien n'est lancé avant son message « je suis devant l'écran ». Étapes **web uniquement** pour Anthony
(aucune installation, aucun terminal), une à la fois. Durée visée : 40 min. Ne bloque ni Apple Mail ni la v1.60.5.

## 1. Deux comptes de test à désigner (indispensables, et suffisants)
| Compte | Rôle | Pourquoi un seul compte ne suffit pas |
|---|---|---|
| **T1** | joue la boîte **anthony@** (script de prospection) **et** le compte d'Anthony dans l'application de test : le script n'accepte une action de boîte que si l'identité signée par le serveur = le compte qui l'exécute (règle de la v1.60.4) | — |
| **T2** | joue les **correspondants** (organisateurs) ; alias `T2+salle@…`, `T2+copie@…` pour les copies | un message de T1 vers un alias de T1 reste un message **envoyé par T1** : il ne peut tester ni une réponse reçue (rattachement, relance suspendue, absence automatique), ni une réponse écrite dans un autre logiciel |

Comptes Gmail gratuits possibles. Anthony les crée ou les désigne ; je n'en crée aucun ; aucun mot de passe dans la conversation.

## 2. Une seule demande d'autorisation (tout ce que la séance nécessite)
Anthony autorise en une fois, **sur le projet Supabase de TEST uniquement** :
1. appliquer la migration `supabase/migrations/2026-11-06_v1.61_messagerie.sql` (une transaction, rejouable) ;
2. ajouter **T1** comme membre de l'équipe du projet de test (connexion à l'application de test avec T1) et l'inscrire titulaire de la
   boîte d'essai : `private.mailbox_owners` (`anthony` → adresse de T1) — aucune adresse n'est écrite dans le code ni la migration ;
   la migration de la clé de boîte `2026-11-08_v1.60.4_cle_boite.sql` doit être appliquée avant (prérequis vérifié) ;
3. déployer la fonction `mail-sync` (`index.ts`, `regles.ts` et `../script-google/identite.ts`, vérification du jeton désactivée : la
   fonction contrôle chaque appel, SECURITE_SYNCHRO.md) et la fonction `script-google` à jour (`index.ts`, `identite.ts`) ;
4. inscrire l'adresse de la tâche planifiée dans `private.sync_urls` (synchronisation toutes les 5 min, projet de test seulement) ;
5. créer des données fictives : structures, contacts aux adresses de T2, suivis, un artiste fictif avec une fiche technique ;
6. **côté Google (sur T1)** : un projet Apps Script « Prospection (essai) », propriétés `WEBHOOK_SECRET` et `CLE_BOITE` (recopiées par
   Anthony depuis le projet de test, jamais dans la conversation), avec les accès que Google demandera à l'autorisation :
   lire, modifier, rédiger et envoyer des mails ; voir les fichiers Drive ; se connecter à un service externe (pièces jointes) ;
7. **côté Google (sur T2)** : deux PDF dans Drive, l'un partagé avec T1 (lecteur), l'autre non ;
8. retour arrière après l'essai : ligne `private.sync_urls` retirée (tables laissées, vides d'effet).

## 3. Ordre de publication OBLIGATOIRE (essai puis production)
0. **Clé de la boîte** `2026-11-08_v1.60.4_cle_boite.sql` (publiée avec Apple Mail v1.60.4 ; prérequis vérifié par la migration) ;
1. **Migration** messagerie (avant la fusion : l'interface écrit `prospect_logs.gmail_message_id` ; si la colonne manquait, la ligne serait
   écrite sans l'identifiant — jamais perdue — mais reconnue seulement par le jour et le texte) ;
2. **interface** (fusion de la branche, après la v1.60.4 Apple Mail) ;
3. **fonctions `script-google` et `mail-sync`, puis aussitôt le script `Prospection.gs`** : le texte signé passe en v2 (cible et
   boîte en plus) des deux côtés ; entre les deux déploiements, la recherche par Message-ID (Apple Mail) sur anthony@ est refusée
   (« signature invalide », rien consulté) — à faire dans la même minute ;
4. **script `Prospection.gs`** redéployé (« ping » doit renvoyer `v1.61.0` ; propriété `CLE_BOITE` déjà en place depuis la v1.60.4) ;
   inscription du titulaire (`private.mailbox_owners`, adresse de connexion d'Anthony = compte qui exécute le script) ;
5. en dernier, **`private.sync_urls`** (active la synchronisation planifiée).
En production : même ordre, sur autorisation séparée après l'essai.

## 4. Déroulé guidé (Anthony, web uniquement)
1. Désigner T1 et T2 (adresses seulement).
2. **T2 › drive.google.com** : déposer deux PDF ; Partager le premier avec T1 (Lecteur), pas le second.
3. **T1 › script.google.com** › Nouveau projet › coller le code (application de test › Réglages › Prospection › « Copier le code du
   script ») › Services › + › **Gmail API** › Ajouter › Paramètres du projet › Propriétés du script › `WEBHOOK_SECRET` = valeur de
   `drive_webhook_secret` du projet de **test** (Supabase › Table Editor › `settings`) et `CLE_BOITE` = valeur de `mailbox_sign_key`
   (Table Editor › schéma `private` › `import_secrets`) — recopiées par Anthony, jamais dans la conversation
   › Déployer › Nouveau déploiement › Application Web (Exécuter en tant que : moi · Accès : tout le monde) › **Autoriser**
   (écran « application non validée » : Paramètres avancés › Continuer) › copier l'adresse `…/exec`.
4. **Application de test** (bandeau TEST), connecté avec **T1** › Réglages › Prospection : coller l'adresse ; « Tester le script »
   doit afficher `v1.61.0`.
5. Je fais les étapes Supabase 1 à 5 de la demande (§2) et je confirme chacune.
6. Facultatif : ajouter T1 dans Apple Mail (Réglages Système › Comptes Internet) ; sinon « non vérifié avec Apple Mail ».
7. Scénarios (§5), puis retour arrière (§2.8).

## 5. Scénarios et preuve attendue
| # | Scénario | Preuve |
|---|---|---|
| 1 | T2 écrit à T1 (contact connu, une structure, un suivi ouvert) | « Rattachée automatiquement » ; une ligne au journal |
| 2 | T2 écrit depuis un alias inconnu, puis depuis une adresse inscrite dans deux structures | « À rattacher » + raison ; lecture et réponse possibles ; choix de structure demandé |
| 3 | Répondre, répondre à tous (T2 + `T2+copie`), transférer | même fil chez T2 et dans « Envoyés » de T1 ; journal complété **après** l'envoi |
| 4 | Brouillon : enregistrer, fermer, rouvrir, envoyer ; puis brouillon supprimé dans Gmail avant l'envoi | un seul brouillon ; second cas : message clair, rien ne part. Brouillon commencé dans Gmail : à finir dans Gmail (limite affichée) |
| 5 | Documents : fiche technique (stockage), PDF Drive partagé avec T1, PDF non partagé | deux vraies pièces reçues chez T2 ; le non partagé signalé, jamais joint |
| 6 | 18,5 Mo bruts | refus avant l'envoi, rien dans Gmail |
| 7 | Libellé, archive, corbeille, retour de corbeille depuis l'application | visibles dans Gmail web de T1 |
| 8 | Dans Gmail web de T1 (et Apple Mail si ajouté) : libellé, archive, lu, réponse | repris à la synchronisation suivante ; réponse au journal une fois |
| 9 | « Actualiser » trois fois + deux passages planifiés | aucun doublon ; dernière synchronisation à jour |
| 10 | Relance programmée, puis T2 répond | relance suspendue, une notification « Réponse reçue » |
| 11 | T2 active une réponse d'absence et T1 lui écrit ; puis T1 écrit à une adresse inexistante | absence : **signalée** (notification « Réponse automatique », marquée au journal), relance maintenue, aucune reprogrammation ; non-remise : marquée, relance maintenue |
| 12 | Conversation corrigée de A vers B | relances de B suspendues ; A non réactivée ; notification « Relances à vérifier » → « Rétablir les relances » demande une échéance future si la leur est passée |
| 13 | T2 envoie une image hébergée | non chargée avant « Afficher les images » |
| 14 | Adresse du script faussée | erreur affichée avec l'heure ; « dernière synchronisation réussie » inchangée |
| 15 | Anthony se connecte à l'application de test avec **son propre compte** (membre de l'équipe, mais pas titulaire de la boîte d'essai, qui est T1) et ouvre « Mails » | message « réservée au titulaire » ; une action de boîte forcée est refusée par le script (« réservée à son titulaire ») ; `mail-sync` répond 403 ; journal des suivis toujours visible |
| 17 | Même compte (non titulaire) : Réglages › Prospection › modifier l'adresse du script | « modifiable seulement par le titulaire », rien changé ; avec T1 (titulaire) : enregistrée |
| 16 | Propriété `CLE_BOITE` retirée du script, puis remise | « ajoute la propriété CLE_BOITE », rien lu ni envoyé ; la synchronisation affiche l'erreur et reprend ensuite |

Contrôles en base de test après chaque bloc : `mail_messages` (identifiant Gmail unique), `prospect_logs` (`author = 'Messagerie'`),
`tasks` de relance, `notifications` (`mail-reponse:%`, `mail-auto:%`, `mail-relances:%`), `mail_sync_state`.

## 6. Déjà vérifié sans Google (simulé, réseau bloqué)
Script de prospection exécuté avec des services Google simulés (`tests/static/messagerie-regles.mjs`), base PostgreSQL locale jetable
(`supabase/repetitions/2026-11-08_v1.63_messagerie_essai.sql`, 83 essais), navigateur sur fausse base (`e2e/messagerie-*.spec.js`).
Non couvert : production@ (plus tard).

## 7. Risque connu, non corrigé dans ce lot (signalé)
L'action **`mail`** (premier mail de prospection, droits de l'équipe) joint des pièces par `blobs_` : un identifiant Drive ou une
adresse fournis par la demande sont lus avec les droits du compte anthony@ (sans le contrôle d'adresse signée de `strictBlobs_`).
Un membre de l'équipe pourrait ainsi faire joindre à un mail qu'il envoie un fichier du Drive d'anthony@ dont il connaît l'identifiant.
À décider : appliquer à `mail` / `reply` la même restriction que la messagerie (liens signés du stockage, identifiants proposés par
l'application), ou réserver ces pièces au titulaire.
