# Messagerie v1.61 — essai avec un vrai Gmail (boîte et destinataires de TEST)

Préparé le 06/11/2026. **Aucun contact réel, aucune boîte réelle d'Anthony, aucune donnée de production.** Rien n'est lancé sans son accord.

## Montage
| Élément | Essai |
|---|---|
| Boîte « anthony@ » simulée | une boîte Google **de test** (B1), qui reçoit le script de prospection v1.61 (copie déployée sur ce seul compte) |
| Correspondants | une seconde boîte de test (B2) et des alias de B2 (`B2+salle@…`, `B2+copie@…`) : réponses, réponses à tous, copies |
| Base | projet Supabase **de test**, après la séance V1.57 → V1.60 (pour ne pas modifier l'état de départ de cette séance) : migration v1.61, fonction `mail-sync`, réglage `prospect_script_url` = adresse du script de B1 |
| Application | version de la branche, environnement **test** (bandeau « TEST ») |
| Données | structures, contacts et suivis fictifs dont les adresses sont celles de B2 |
| Tâche planifiée | activée sur le projet de test seulement (adresse inscrite dans `private.sync_urls` du projet de test) ; jamais en production |

## Scénarios et preuve attendue
| # | Scénario | Preuve |
|---|---|---|
| 1 | B2 écrit à B1 (contact connu, une structure, un suivi ouvert) | conversation « Rattachée automatiquement » ; une seule ligne au journal du suivi |
| 2 | B2 écrit depuis une adresse inconnue / un contact présent dans deux structures | « À rattacher » avec la raison ; lecture et réponse possibles ; rattachement manuel puis journal |
| 3 | Répondre depuis l'application | dans Gmail de B2 : même fil ; dans B1 : « Envoyés », même fil ; journal complété **après** confirmation Gmail |
| 4 | Répondre à tous (B2 + copie `B2+copie`) | destinataires proposés : adresse de réponse + copies, sans B1 ; même fil chez tous |
| 5 | Brouillon : enregistrer, fermer, rouvrir, compléter, envoyer | un seul brouillon dans Gmail (mis à jour, pas dupliqué), disparu après l'envoi ; un seul message envoyé |
| 6 | Documents joints (fiche technique + dossier de presse de l'artiste fictif) | reçus chez B2 en **vraies pièces jointes**, ouvrables, tailles conformes ; aucun lien |
| 7 | Limite : pièces jointes de 18,5 Mo bruts | refus avant l'envoi (≈ 25,4 Mo une fois encodé), rien dans Gmail |
| 8 | Classement : libellé ajouté / retiré, archive, corbeille depuis l'application | visible dans Gmail de B1 (web) au rafraîchissement |
| 9 | Changements externes : dans Gmail de B1, libellé, archive, lu / non lu, réponse envoyée depuis Gmail | répercutés à la synchronisation suivante (≤ 5 min ou « Actualiser ») ; réponse externe au journal une seule fois |
| 10 | Synchronisation sans doublon : « Actualiser » trois fois, puis attendre deux passages planifiés | nombre de messages et de lignes de journal inchangé ; dernière synchronisation à jour, aucune erreur |
| 11 | Relance : programmer une relance sur le suivi, puis B2 répond | relance « Annulée — Suspendue automatiquement : réponse reçue le … » ; une notification « Réponse reçue » |
| 12 | Images distantes : B2 envoie un mail avec une image hébergée | image non chargée à l'ouverture (journal réseau du navigateur) ; chargée seulement après « Afficher les images » |
| 13 | Échec : script de B1 coupé (adresse invalide) | erreur affichée avec l'heure du passage ; « dernière synchronisation réussie » inchangée ; rien de perdu au retour |

Contrôles en base (projet de test) après chaque bloc : `mail_messages` sans doublon (`gmail_message_id` unique), `prospect_logs` avec `author = 'Messagerie'`
une ligne par message, `tasks` de relance, `notifications` `mail-reponse:%`, `mail_sync_state`.

## Ce qu'il faut à Anthony (web uniquement, pas à pas, au moment de l'essai)
1. Choisir les deux boîtes de test (B1, B2) — **question ouverte**.
2. Sur B1 : créer le projet Apps Script, coller le code, activer le service Gmail avancé, déployer (application web), autoriser.
3. Me donner l'adresse du déploiement (pas de secret : le code partagé reste saisi par lui dans Réglages du projet de test).

Non couvert par cet essai : la boîte production@ (plus tard) et l'activation en production (autorisation regroupée).
