# Essai réel Google Agenda — une seule séance guidée (≈ 30 min) · v1.62 agendas des artistes

Préparé le 08/11/2026. Rien n'est lancé sans Anthony. Côté base : projet Supabase **de test** uniquement. Côté Google : lecture seule
(le script ne demande que « Voir vos agendas » ; il ne peut rien créer, modifier ni supprimer).
La messagerie a son propre essai (ESSAI_GMAIL_REEL.md) : **ce lot se teste et se livre sans elle**.

## Faut-il un compte Google de test ?
| Besoin | Compte de test ? | Pourquoi |
|---|---|---|
| Recevoir les partages et lire les agendas | **Non** : production@ (le vrai compte, en lecture seule) | c'est le compte retenu ; le script ne voit que les agendas qu'on lui partage |
| Agendas d'artiste à lire | **Non** : deux agendas **créés par Anthony** dans son propre Google (« Essai artiste A », « Essai artiste B ») | un agenda secondaire se crée, se partage, se vide et se supprime sans toucher à ses agendas réels |
| Base, fonction serveur, tâche planifiée | **Non** : projet Supabase de test (fait par Claude, avec l'accord d'Anthony au moment de la séance) | — |
| Seul cas qui en exige un : ne pas vouloir installer le script sur production@ | Oui (un compte qui joue production@) | sinon inutile |

## Ce qu'Anthony fait (web uniquement, une étape à la fois, Claude attend sa confirmation)
1. **Créer les deux agendas d'essai** — calendar.google.com (son compte) › « Autres agendas » › **+** › « Créer un agenda » : « Essai artiste A », puis « Essai artiste B ».
2. **Les partager avec production@** — paramètres de l'agenda › « Partager avec des personnes » › production@ :
   A = « **Afficher tous les détails des événements** » ; B = « **Afficher uniquement les disponibilités (masquer les détails)** ».
3. **Installer le script sur production@** — dans l'application (projet de test) : Réglages › « Agendas des artistes » : « Copier le code du
   script » et « Copier le fichier appsscript.json », puis sur script.google.com **connecté avec production@** : nouveau projet
   « Matrice Agendas », coller le code, afficher et remplacer le manifeste ; Propriétés du script › `SECRET_AGENDAS` = le secret **propre à ce script**
   du projet de test (Supabase › SQL Editor : `select value from private.import_secrets where key = 'cal_script_secret'` — copié par
   Anthony, jamais dans la conversation ; distinct du code du script principal).
4. **Déployer et autoriser** — Déployer › Nouveau déploiement › Application Web · Exécuter en tant que : moi · Accès : tout le monde ›
   autoriser (un seul accès demandé : **voir** les agendas) › coller l'adresse …/exec dans Réglages › « Tester » (attendu : « 2 agendas… (script v1.6x) »).
5. **Relier** — fiche d'un artiste fictif du projet de test › « Relier son agenda Google » › « Essai artiste A ».
6. **Créer les événements d'essai** dans « Essai artiste A » (liste ci-dessous), puis « Actualiser » dans la fiche ; Claude relève les preuves.

## Événements à créer et preuves attendues
| # | Dans « Essai artiste A » (sauf mention) | Preuve attendue dans l'application |
|---|---|---|
| A1 | — | liste des agendas : A et B (B « disponibilités seulement »), jamais l'agenda principal de production@ |
| A2 | « Répétition » un mardi 14 h–16 h ; puis changer l'heure et le titre ; puis le supprimer | ligne mise à jour au passage suivant, puis plus affichée (gardée « supprimée »), jamais en double |
| A3 | « Cours » chaque lundi pendant 4 semaines ; modifier l'heure d'**une** occurrence ; supprimer **une autre** | 3 lignes, l'exception à jour, l'occurrence supprimée absente |
| A4 | « Vacances » journée entière sur 3 jours | « jusqu'au » = le 3ᵉ jour, sans décalage |
| A5 | « Show New York » 20 h, fuseau de l'événement **New York** | affiché le jour de New York ; option posée le lendemain à Paris → « chevauchement horaire » |
| A6 | « [SHOW] Bataclan, Paris » · « show - Le Transbordeur, 69100 Lyon » · « Showroom Paris » · « Show » lieu « Saint-Denis » | repères Paris et Lyon « Date artiste — calendrier Google » ; Showroom : rien ; Saint-Denis : « localisation à préciser » |
| A7 | un événement réglé sur « **Disponible** » | ni indisponibilité ni avertissement |
| A8 | un événement « **Privé** » (visibilité) | « Indisponible », sans titre ni lieu (vérifié dans la table par Claude) |
| A9 | dans « Essai artiste B » : un événement quelconque ; relier B à un 2ᵉ artiste fictif | période « Indisponible » sans détail, mode « disponibilités seulement » |
| A10 | retirer le partage de A avec production@ | erreur affichée, « disponibilités plus à jour » dans la fiche et en tête de Booking, jamais « libre » |
| A11 | (après remise du partage) Intérêt puis Option sur un jour occupé | une seule alerte avec la raison ; Annuler n'enregistre rien ; « Enregistrer quand même » enregistre |
| A12 | une date « Confirmée Artiste » le jour d'un « Show » | « Associer à une date » : date inchangée, plus de double affichage |
| A13 | (Claude) appels de la fonction sans justificatif / faux secret / compte hors équipe | refusés (403) — SECURITE_SYNCHRO.md |
| A14 | « Actualiser » deux fois sans rien changer dans Google | aucune ligne d'événement réécrite (Supabase › journaux : aucune écriture) |

Après la séance : retirer les partages, supprimer les deux agendas d'essai (ou les garder pour un prochain essai), déconnecter dans la fiche.

## Ce que Claude fait sur le projet de test (avec l'accord d'Anthony, jamais sur la production)
Migration `2026-11-06_v1.62_agendas_artistes.sql` (gardes d'empreinte ; déjà essayée sur une base locale jetable), déploiement de la
fonction `cal-sync` (vérification du jeton par la passerelle désactivée : la fonction contrôle elle-même chaque appel), réglage
`calendar_script_url` (fait par Anthony à l'étape 4), adresse de la fonction dans `private.sync_urls` (active la tâche toutes les 5 min).
