# Messagerie intégrée (boîte anthony@) et calendriers Google des artistes — plan de réalisation

Demandes d'Anthony du 06/11/2026. Développement sur branche, avec des données et messages de test ; aucune connexion de production,
aucun envoi à des contacts réels, aucune modification de messages ou de calendriers réels sans autorisation.

## 1. Messagerie — circuit retenu (aucun second circuit)

```
L'ArtBotrice (navigateur, équipe connectée)
   └─ fonction serveur « script-google » (existante : contrôle is_team, secret côté serveur)
        └─ script Google de PROSPECTION sur anthony@ (existant : envoi UTF-8, réponses dans le fil)
             └─ Gmail (référence : libellés, lu/non lu, archive, corbeille ; visibles dans Apple Mail)
tâche planifiée (Supabase, toutes les 5 min) → fonction serveur « mail-sync » → même script : historique Gmail depuis le dernier passage
```

- **Aucun secret dans le navigateur**, aucun nouveau secret dans le script : la synchronisation passe par le relais serveur existant.
- production@ (script principal, mails des dates) n'est pas touché ; il viendra ensuite par le même modèle.

### Script de prospection (anthony@) — actions ajoutées
| Action | Rôle |
|---|---|
| `threads` | liste de conversations (boîte de réception, libellé, recherche Gmail, non lus), par pages |
| `thread` | conversation complète : messages, expéditeur, `Reply-To`, destinataires, copies, date, `Message-ID`, pièces jointes (nom, taille, type) |
| `labels` | libellés existants (= dossiers d'Apple Mail sous le compte) |
| `modify` | ajouter / retirer un libellé, retirer de la boîte de réception (archiver), corbeille, lu / non lu — jamais de suppression définitive |
| `compose` | répondre, répondre à tous, transférer, nouveau mail ; brouillon (créé ou mis à jour) ou envoi ; dans le fil (`threadId`, `In-Reply-To`, `References`) — même fabrication MIME que les relances actuelles |
| `attachment` | contenu d'une pièce jointe reçue (aperçu, « Conserver dans le projet » explicite) |
| `history` | changements depuis le dernier passage (nouveaux messages reçus et envoyés, y compris depuis Apple Mail ; libellés) |

### Base (migration dédiée)
- `mail_threads` : conversation Gmail (identifiant unique), boîte, objet, participants, dernier message, non lu, libellés, rattachement
  (structure, suivi, artiste/spectacle, date), état du rattachement (`auto` / `manuel` / `a_rattacher`) et sa raison affichée.
- `mail_messages` : message Gmail (identifiant unique → **aucun doublon** aux synchronisations et reprises), sens, participants, date,
  pièces jointes, lien vers la ligne du journal du suivi.
- Accès équipe seule (RLS `is_team()`), sauvegarde JSON comprise.

### Rattachement (règles d'Anthony)
1. Conversation déjà rattachée : elle garde son suivi (y compris les fils de prospection existants : `prospects.mail_thread_id`).
2. Nouvelle conversation : adresses des participants comparées aux adresses des contacts (jamais le seul domaine, jamais « le premier trouvé »).
   Un seul contact → une seule structure → un seul suivi ouvert : rattachement automatique, affiché, corrigeable. Sinon : « À rattacher », avec
   les choix possibles ; contact inconnu : rattachement manuel et création de contact proposée.
3. Lecture et réponse possibles même « À rattacher ».

### Historique et relances
- Chaque message reçu ou envoyé d'une conversation rattachée entre une seule fois dans le journal du suivi (participants, date, pièces jointes).
- Envoi enregistré seulement après la réponse « envoyé » de Gmail ; un échec n'écrit rien.
- Réponse reçue : la tâche de relance automatique du suivi est suspendue et la réponse signalée ; structures inactives : relances déjà suspendues (inchangé).
- « Programmer une relance » depuis la conversation ou le suivi (tâche existante).

### Éditeur
- Templates existants : insertion **sans écraser** le texte, les destinataires ni les pièces jointes ; variables remplies depuis le contexte choisi
  (structure, contact, artiste/spectacle, date) ; variables manquantes surlignées et listées avant l'envoi.
- « Ajouter depuis un projet/spectacle » : fiche technique, dossier de presse, autres documents de l'artiste déjà stockés dans l'application
  (44 fichiers dans le stockage privé « artiste », aussi rangés dans le Drive) — aucun nouveau téléversement. Vraie pièce jointe, jamais un lien.
  Nom et taille affichés ; total limité avant l'envoi (Gmail : 25 Mo par message).
- Documents seulement en lien Drive : joints depuis le Drive si le compte anthony@ y a accès ; sinon signalés, avec la marche à suivre (partager le
  dossier avec anthony@, ou déposer le fichier dans la fiche artiste).

### Première livraison (utilisable de bout en bout)
Espace Mails (boîte de réception, recherche, non lus, « À rattacher », libellés) → lecture d'une conversation → rattachement → réponse /
répondre à tous / transférer avec template et documents du projet → journal du suivi → rangement (libellé, archive, corbeille) → relance.
Ensuite : brouillons repris depuis Gmail, pièces jointes reçues conservées dans un projet, boîte production@.

### Intervention d'Anthony (web uniquement, pas à pas)
- Remplacer le code du script de prospection sur anthony@ et publier une nouvelle version (même adresse) — après son accord.
- Autoriser l'activation de la synchronisation (tâche planifiée) en production.

## 2. Calendriers Google des artistes

- **Lecture seule** (Google → L'ArtBotrice), jamais d'écriture dans le calendrier source ; aucun contrat, facture, commission ni ligne financière.
- Connexion : un calendrier par artiste, choisi explicitement dans la fiche artiste ; suspendre / déconnecter ; dernière synchronisation et erreurs.
- Lecture par le script Google existant du compte avec lequel les calendriers sont partagés (service Calendar ajouté, nouvelle autorisation).
- Synchronisation incrémentale (jeton de synchronisation Google) : créations, modifications, suppressions, récurrences et exceptions
  (occurrences développées), journées entières et plusieurs jours, fuseaux horaires ; une seule ligne par occurrence (aucun doublon).
- Table `artist_calendar_events` (artiste, calendrier, événement + occurrence uniques, début / fin, journée entière, occupé / disponible,
  titre et lieu seulement s'ils sont accessibles, « Show », localisation résolue ou « à préciser »).
- Booking : indisponibilités affichées à part (origine Google) ; « Disponible » ne bloque pas ; chevauchement avec une option ou une date →
  avertissement, poursuite possible après confirmation. Accès « disponibilités seulement » : périodes « Indisponible » sans détail.
- Carte : titre contenant « show » (sans casse) **et** lieu permettant d'identifier une ville → repère distinct « Date artiste — calendrier
  Google » ; sinon « localisation à préciser », jamais de repère approximatif ; mis à jour ou retiré avec l'événement.
- Dates « Option / Confirmée artiste » existantes : ni supprimées ni converties ; association explicite proposée quand un événement Google
  leur correspond (pas de double affichage, pas de fusion arbitraire).
- Accès perdu ou synchronisation en échec : « disponibilités plus à jour », jamais « libre ».
