# Messagerie — séance d'essai réel Gmail (document unique)

Préparé le 06/11/2026, mis à jour le 09/11/2026 (comptes désignés par Anthony). Rien n'est lancé avant son message « je suis
devant l'écran ». Étapes **web uniquement** pour Anthony (aucune installation, aucun terminal), une à la fois. Durée visée : 40 min.

## 1. Comptes désignés et périmètre STRICT
| Compte | Rôle |
|---|---|
| **anthony@lartboristerie.com** | **sa vraie boîte de production** ; titulaire de la boîte dans le projet de TEST (connexion à l'application de test avec ce compte) |
| **colbe.anthony@gmail.com** | seul correspondant (alias `colbe.anthony+salle@gmail.com`, `+copie@…` pour les copies et adresses « inconnues ») |

Aucun autre correspondant n'est sollicité. On ne lit, ne synchronise, ne range ni ne rattache **que les conversations TEST** :
celles qui portent le libellé Gmail **« Matrice-essai »**, posé à la main par Anthony. Aucun import global de la boîte, aucune
synchronisation planifiée (`private.sync_urls` du projet de test reste **vide** : « Actualiser » seulement, par Anthony).

### Mode essai (garanti par le script lui-même, puis par le serveur)
- **Script d'essai séparé** dans anthony@ : projet Apps Script « Prospection (essai) », distinct du script de production (qui n'est
  pas touché), branché sur le projet Supabase de TEST. Propriétés : `MODE_ESSAI` = `oui` · `LIBELLE_ESSAI` = `Matrice-essai` ·
  `DESTINATAIRES_ESSAI` = `colbe.anthony@gmail.com, anthony@lartboristerie.com`.
- **Conversation autorisée** = au moins un de ses messages porte le libellé. Une réponse arrivée ensuite (Gmail ne lui pose pas le
  libellé) reste donc lisible ; une autre conversation au même objet est refusée ; une conversation dont on retire le libellé
  n'est plus lue.
- **Chaque action de boîte** est vérifiée dans le script avant toute lecture : liste et recherche limitées au libellé ; lecture,
  réponse, rangement, pièce jointe, relance, statut et recherche par Message-ID refusés hors conversation TEST ; envois réservés
  aux destinataires d'essai (alias compris) ; conversation créée ou continuée depuis l'application marquée « Matrice-essai » ;
  le libellé ne se retire pas depuis l'application ; liste des libellés réduite à « Matrice-essai ».
- **Synchronisation** : une lecture de la liste des conversations portant le libellé (au plus 50), puis lecture des seules
  conversations changées depuis le passage précédent. Jamais l'historique de toute la boîte.
- **Coût en lectures** : 1 lecture de la liste des libellés (une fois par appel), 1 lecture de la liste des conversations
  « Matrice-essai » (ne renvoie qu'elles), puis 1 lecture par conversation TEST changée ; contrôle d'une conversation désignée :
  1 lecture de ses seuls libellés. Pour une dizaine de conversations TEST : quelques dizaines de lectures par séance, très loin du
  quota d'un compte (50 000 lectures Gmail par jour en Workspace, [quotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas)).
- **Sûreté** : `MODE_ESSAI` posé sans libellé existant (ou libellé système) ni destinataires valides → toutes les actions de boîte
  et d'envoi sont refusées (« Mode essai : … »). Côté serveur, le réglage `mail_essai_libelle` = `Matrice-essai` du projet de test
  fait refuser toute réponse d'un script qui n'est pas en mode essai sur ce libellé et n'enregistre que les conversations qui le
  portent. L'espace Mails affiche « Mode essai ».
- **Destinataires** : chaque adresse de chaque champ (À, Copie, Copie cachée) doit être une adresse d'essai (alias « + » compris) ;
  séparateur « , » seulement — « ; », adresses collées par une espace, adresse cachée dans un nom ou un domaine, virgule dans un
  nom entre guillemets : refusés (au moindre doute, refus). Un brouillon désigné doit appartenir à une conversation TEST.
- **Propriété `MODE_ESSAI`** : toute valeur non vide active le mode, « non » compris ; pour le quitter, **supprimer** la propriété.
- **Limites connues (documentées)** : (a) envoi réussi mais libellé non posé (incident Gmail) → succès avec avertissement « pose-le
  à la main », jamais une erreur qui pousserait à renvoyer ; (b) `files_info` (taille des documents Drive proposés en pièces jointes)
  n'est pas limité au périmètre d'essai : lecture seule, au nom du titulaire, des seuls fichiers dont l'identifiant est fourni par
  l'application (aucune lecture de Gmail) ; (c) le rôle `sauvegarde` reçoit la lecture de `private.sync_urls` ici, mais l'usage du
  schéma `private` lui est accordé par le lot sauvegardes (v1.60.7) : sans lui, la lecture reste impossible.

## 2. Actions de la séance
### Côté Google — Anthony (web, dans l'ordre)
1. **Gmail d'anthony@** › Paramètres › Libellés › Créer un libellé `Matrice-essai`.
2. **colbe.anthony@gmail.com** : écrire à anthony@ un mail « [TEST Matrice] Proposition essai 1 » ; puis un second, depuis l'alias
   `colbe.anthony+salle@gmail.com`, « [TEST Matrice] Essai 2 ».
3. **Gmail d'anthony@** : poser le libellé `Matrice-essai` sur ces deux conversations (et seulement elles).
4. **colbe.anthony@gmail.com › Drive** : déposer deux PDF de test ; partager le premier avec anthony@ (Lecteur), pas le second.
5. **anthony@ › script.google.com** › Nouveau projet « Prospection (essai) » › coller le code (application de TEST › Réglages ›
   Prospection › « Copier le code du script ») › Services › + › **Gmail API** › Paramètres du projet › Propriétés du script :
   `WEBHOOK_SECRET` (valeur `drive_webhook_secret` du projet de **test**), `CLE_BOITE` (valeur `mailbox_sign_key` du projet de
   **test**, schéma `private` › `import_secrets`) — recopiées par Anthony, jamais dans la conversation — puis `MODE_ESSAI`,
   `LIBELLE_ESSAI`, `DESTINATAIRES_ESSAI` (valeurs du §1) › Déployer › Application Web (Exécuter en tant que : moi · Accès : tout
   le monde) › Autoriser (lire, modifier, rédiger, envoyer des mails ; lire Drive ; service externe) › copier l'adresse `…/exec`.
   C'est aussi l'essai de la règle d'administration de lartboristerie.com (accès « tout le monde » à une application Web).
6. **Application de TEST** (bandeau TEST), connecté avec anthony@ › Réglages › Prospection : coller l'adresse ; « Tester le script »
   doit afficher `v1.61.0` et le mode essai actif.

### Côté projet Supabase de TEST — l'intégrateur (après accord, jamais en production)
1. Migrations dans l'ordre : `2026-11-08_v1.60.4_cle_boite.sql`, `_titulaire.sql`, `_titulaire_rls.sql` (si absentes), puis
   `2026-11-06_v1.61_messagerie.sql` (rejouable).
2. Registre : `insert into private.mailbox_owners values ('anthony', 'anthony@lartboristerie.com')` (si absent).
3. Réglage `mail_essai_libelle` = `Matrice-essai` ; `private.sync_urls` **vide** (vérifié).
4. Fonctions `script-google` (`index.ts`, `identite.ts`) et `mail-sync` (`index.ts`, `regles.ts`, `../script-google/identite.ts`).
5. Données fictives : structures et contacts aux seules adresses colbe.anthony(+…)@gmail.com, suivis, un artiste fictif avec une
   fiche technique et les deux PDF Drive.

## 3. Ordre de publication OBLIGATOIRE (essai puis production)
0. **Déjà en production (v1.60.4, 08/11)** : clé de la boîte `2026-11-08_v1.60.4_cle_boite.sql`, registre et protection de l'adresse
   `2026-11-08_v1.60.4_titulaire.sql` + `_titulaire_rls.sql` (RLS du registre, appliquée à la main), titulaire inscrit
   (`anthony` → anthony@lartboristerie.com) ; la migration messagerie les exige et n'y touche pas ;
1. **Migration** messagerie (avant la fusion : l'interface écrit `prospect_logs.gmail_message_id` ; si la colonne manquait, la ligne serait
   écrite sans l'identifiant — jamais perdue — mais reconnue seulement par le jour et le texte) ;
2. **interface** (fusion de la branche, après la v1.60.4 Apple Mail) ;
3. **fonctions `script-google` et `mail-sync`, puis aussitôt le script `Prospection.gs`** : le texte signé passe en v2 (cible et
   boîte en plus) des deux côtés ; entre les deux déploiements, la recherche par Message-ID (Apple Mail) sur anthony@ est refusée
   (« signature invalide », rien consulté) — à faire dans la même minute ;
4. **script `Prospection.gs`** redéployé (« ping » doit renvoyer `v1.61.0` ; propriété `CLE_BOITE` déjà en place depuis la v1.60.4) ;
   (titulaire déjà inscrit en production) ;
5. en dernier, **`private.sync_urls`** (active la synchronisation planifiée).
En production : même ordre, sur autorisation séparée après l'essai.

## 4. Scénarios (sur les seules conversations « Matrice-essai »)
| # | Scénario | Preuve |
|---|---|---|
| 1 | « Actualiser » | seules les conversations TEST apparaissent ; « Mode essai » affiché |
| 2 | Conversation 1 (contact connu, une structure, un suivi ouvert) | « Rattachée automatiquement » ; une ligne au journal |
| 3 | Conversation 2 (alias inconnu), puis l'alias inscrit dans deux structures | « À rattacher » + raison ; choix de structure demandé |
| 4 | Répondre, répondre à tous (+ `+copie`), transférer à colbe.anthony@ | même fil chez les deux ; journal après l'envoi ; conversation toujours « Matrice-essai » |
| 5 | Réponse de colbe.anthony@ dans la conversation 1 (sans libellé posé) | récupérée à « Actualiser », une fois |
| 6 | Réponse envoyée depuis Apple Mail dans la conversation 1 | reprise au journal une fois |
| 7 | Brouillon : enregistrer, rouvrir, envoyer ; puis brouillon supprimé dans Gmail | un seul brouillon ; second cas : rien ne part |
| 8 | Documents : fiche technique, PDF partagé, PDF non partagé | deux vraies pièces reçues ; le non partagé signalé |
| 9 | Pièces de 18,5 Mo | refus avant l'envoi |
| 10 | Libellé Gmail, archive, corbeille, retour, depuis l'application | visibles dans Gmail et Apple Mail |
| 11 | Relance programmée sur le suivi, puis réponse de colbe.anthony@ ; puis réponse d'absence (Gmail de colbe.anthony@ › Réponse automatique) | réponse : relance suspendue ; absence : signalée, relance maintenue |
| 12 | Image hébergée envoyée par colbe.anthony@ | non chargée avant « Afficher les images » |
| 13 | Envoi à une autre adresse depuis l'application | refusé (« Destinataire hors des adresses d'essai »), rien ne part |
| 14 | Conversation réelle (non TEST) : ouverture forcée par son identifiant | refusée par le script ; rien n'est lu |
| 15 | Libellé retiré de la conversation 2 dans Gmail | plus lue à l'actualisation suivante |
| 16 | `MODE_ESSAI` gardé, `LIBELLE_ESSAI` vidé | tout est refusé (« Mode essai : … ») ; puis remis |

## 5. Retour arrière (fin de séance)
- **anthony@** : script.google.com › « Prospection (essai) » › Déployer › Gérer les déploiements › Archiver, puis mettre le projet
  à la corbeille ; Gmail › retirer le libellé `Matrice-essai` des conversations TEST puis supprimer le libellé (les mails restent) ;
  si souhaité, supprimer les conversations TEST.
- **colbe.anthony@** : désactiver la réponse automatique ; retirer le partage du PDF.
- **Projet de test** (intégrateur) : vider `prospect_script_url` et `mail_essai_libelle`, vérifier `private.sync_urls` vide,
  retirer les données fictives de la séance.

## 6. Ce qui reste impossible à vérifier sans la production
Synchronisation générale de la boîte (import initial sur 14 jours, volumes et quotas réels, reprise après un point d'historique
expiré), rattachement face aux vrais contacts et suivis, suspension des relances sur de vraies réponses d'organisateurs, script de
production redéployé avec la messagerie, fonctions et migration en production, tâche planifiée (`sync_urls`).
Déjà vérifié sans Google : script exécuté avec des services Google simulés (`tests/static/messagerie-regles.mjs`), base PostgreSQL
locale jetable (`supabase/repetitions/2026-11-08_v1.63_messagerie_essai.sql`, 89 essais), navigateur sur fausse base.

## 7. Risque connu, non corrigé dans ce lot (signalé)
L'action **`mail`** (premier mail de prospection, droits de l'équipe) joint des pièces par `blobs_` : un identifiant Drive ou une
adresse fournis par la demande sont lus avec les droits du compte anthony@ (sans le contrôle d'adresse signée de `strictBlobs_`).
Un membre de l'équipe pourrait ainsi faire joindre à un mail qu'il envoie un fichier du Drive d'anthony@ dont il connaît l'identifiant.
À décider : appliquer à `mail` / `reply` la même restriction que la messagerie (liens signés du stockage, identifiants proposés par
l'application), ou réserver ces pièces au titulaire.
