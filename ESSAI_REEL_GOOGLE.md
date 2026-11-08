# Essais réels Gmail et Agenda — UNE séance guidée (comptes de TEST)

Préparé le 07/11/2026, regroupé le 08/11/2026 (v1.63). Rien n'est lancé ni créé sans Anthony ; aucun contact réel, aucune boîte ni
agenda réel, aucune donnée de production. Base : projet Supabase **de test** (« Lartbo-matrice-test »), jamais la production.
Durée visée : 45 min, web uniquement (aucune installation, aucun terminal), une étape à la fois.

## Deux comptes de test : indispensables, et suffisants
| Compte | Rôle | Pourquoi un seul compte ne suffit pas |
|---|---|---|
| **T1** | joue la boîte **anthony@** (script Prospection) et **production@** (script Agendas, lecture seule) | — |
| **T2** | joue les **correspondants** (organisateurs) et l'**artiste** (propriétaire des agendas) | un message de T1 à un alias de T1 reste un message **envoyé par T1** (Gmail le range « Envoyés » et « Boîte de réception ») : il ne peut tester ni une réponse reçue (rattachement, relance suspendue), ni une réponse écrite dans un autre logiciel ; un agenda ne se partage pas avec son propriétaire |

Une boîte unique + alias ne suffit donc pas. Les alias de T2 (`T2+salle@…`, `T2+copie@…`) servent de destinataires et copies supplémentaires.
Comptes Gmail gratuits possibles ; un compte Google Workspace de test n'est utile que pour vérifier une règle d'administration propre au
domaine (elle sera de toute façon vérifiée à l'activation en production).

## Déroulé (Anthony fait, je guide pas à pas)
1. **Comptes** — désigner ou créer T1 et T2 (adresses données en fin d'étape ; aucun mot de passe dans la conversation).
2. **T2 (5 min)** — dans Drive : déposer deux PDF de test, partager le premier avec T1 (lecteur), pas le second. Dans Agenda :
   « Artiste essai A » partagé avec T1 « Afficher tous les détails », « Artiste essai B » partagé « Afficher uniquement les disponibilités ».
3. **T1, script Prospection (10 min)** — script.google.com › Nouveau projet › coller le code (Réglages › Prospection › « Copier le code du script »)
   › Services › + › **Gmail API** › Propriétés du script › `WEBHOOK_SECRET` = valeur de `drive_webhook_secret` du projet de **test**
   (Supabase › Table Editor › `settings`, recopiée par Anthony, jamais dans la conversation) › Déployer › Application Web
   (Exécuter en tant que : moi · Accès : tout le monde) › **Autoriser** : lire, modifier, rédiger et envoyer des mails ; voir les fichiers Drive ;
   se connecter à un service externe (lecture des pièces jointes par lien temporaire). Écran « application non validée » : Paramètres avancés › Continuer.
4. **T1, script Agendas (5 min)** — même chemin, second projet ; autorisation **lecture des agendas** seulement.
5. **Projet Supabase de test (autorisation d'Anthony, 5 min — je fais, il valide)** — migration `2026-11-06_v1.61_messagerie.sql`
   (rejouable) ; fonction `mail-sync` (fichiers `index.ts` et `regles.ts`, vérification du jeton désactivée : la fonction contrôle
   elle-même chaque appel, SECURITE_SYNCHRO.md) ; ligne `mail-sync` dans `private.sync_urls` (adresse du projet de test) ; données
   fictives (structures, contacts aux adresses de T2, suivis, un artiste fictif avec une fiche technique et les deux PDF Drive de T2).
6. **Application, environnement TEST (2 min)** — Réglages › Prospection : adresse du déploiement de T1 ; adresse d'envoi = T1.
7. **Facultatif** — ajouter T1 dans Apple Mail (Réglages Système › Comptes Internet) pour le scénario « changements faits dans Apple Mail ».
   Sinon : « non vérifié avec Apple Mail » (Gmail web suffit pour les libellés, l'archive et la corbeille, qu'Apple Mail lit en IMAP).
8. **Scénarios** — messagerie : ESSAI_GMAIL_REEL.md (12 scénarios) ; agendas : tableau ci-dessous. Puis, sur demande d'Anthony,
   retour arrière du projet de test (tâche planifiée retirée, `private.sync_urls` vidée ; tables vides laissées).

## Agendas (lot « calendriers », même séance)
| # | Scénario (sur les agendas de T2) | Preuve attendue |
|---|---|---|
| A1 | « Artiste essai A » relié à un artiste fictif | A et B proposés, pas l'agenda principal de T1 |
| A2 | création, modification, suppression d'un événement | répercuté au passage suivant ; suppression gardée « supprimée » |
| A3 | récurrence hebdomadaire + exception + occurrence supprimée | une ligne par occurrence, aucun doublon |
| A4 | journée entière, puis trois jours | dates exactes, sans décalage |
| A5 | événement à New York 20 h | jour local juste ; conflit calculé sur les instants réels |
| A6 | « [SHOW] Bataclan, Paris », « Showroom », « show - Le Transbordeur, 69100 Lyon » | repères Paris et Lyon ; rien pour Showroom |
| A7–A9 | « Disponible », événement privé, agenda B | ne bloque pas ; « Indisponible » sans détail |
| A10 | T2 retire le partage | « disponibilités plus à jour », jamais « libre » |
| A11–A12 | option sur un jour occupé ; « Show » associé à une date confirmée | avertissement puis confirmation ; plus de double affichage |
| A13 | appels de synchronisation sans justificatif / faux secret / compte hors équipe | 403 (SECURITE_SYNCHRO.md) |

## Ordre de publication OBLIGATOIRE (production)
1. **Migration** `2026-11-06_v1.61_messagerie.sql` appliquée en production **avant** la fusion de la branche (la fusion publie
   l'interface, qui écrit `prospect_logs.gmail_message_id`). L'interface reste tolérante — si la colonne manque, la ligne du journal
   est écrite sans l'identifiant, jamais perdue — mais la synchronisation ne peut alors reconnaître ces envois que par le jour et le texte.
2. Fusion (interface) ; 3. fonction `mail-sync` (index.ts + regles.ts) ; 4. script Prospection d'anthony@ redéployé (version v1.61.0,
   « ping ») ; 5. en dernier, ligne `private.sync_urls` (active la tâche toutes les 5 min).
Le lot Apple Mail v1.60.4 est publié **avant** la messagerie (branche rebasée dessus).

## Après l'essai, pour la production (autorisations séparées, plus tard)
Dans l'ordre ci-dessus, chacune sur accord explicite d'Anthony.
