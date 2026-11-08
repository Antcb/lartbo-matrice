# Agendas Google des artistes — préparation, essai et publication (guide d'Anthony)

Préparé le 08/11/2026 (décisions d'Anthony du 08/11). Tout se fait **dans le navigateur** : rien à installer, aucune commande.
Claude donne une étape à la fois et attend « fait » avant la suivante. Aucun agenda d'artiste réel n'est lu avant la fin de l'essai
et l'autorisation de publication. Le script ne demande qu'un accès : **voir** les agendas (il ne peut rien créer, modifier ni supprimer).
La messagerie est un autre lot : celui-ci se teste et se publie sans elle.

## Partie 1 — Anthony prépare deux agendas d'essai dans SON Google (≈ 15 min, aucune donnée d'artiste)

1. **Créer les agendas** — ouvrir https://calendar.google.com (ton compte) › colonne de gauche « Autres agendas » › **+** ›
   « Créer un agenda » › Nom : `Essai artiste A` › « Créer l'agenda ». Recommencer avec `Essai artiste B`.
2. **Partager A avec tous les détails** — survoler « Essai artiste A » › **⋮** › « Paramètres et partage » › « Partager avec des personnes
   ou des groupes spécifiques » › « Ajouter des personnes et des groupes » › `production@lartboristerie.com` › Autorisations :
   **« Afficher tous les détails des événements »** › Envoyer.
3. **Partager B en disponibilités seulement** — même chemin pour « Essai artiste B », Autorisations :
   **« Afficher uniquement les disponibilités (masquer les détails) »**.
4. **Accepter sur production@** — dans la boîte de production@, ouvrir chacun des deux mails de partage › « Ajouter cet agenda »
   (sans cela, le script ne les voit pas).
5. **Créer les événements d'essai** (bouton « Créer » › choisir l'agenda dans la liste de l'événement › « Enregistrer ») :

| # | Agenda | Titre | Quand | Réglage particulier | Ce que l'essai vérifie |
|---|---|---|---|---|---|
| E1 | A | `[SHOW] Bataclan` | sam. 12/12/2026, 20 h – 23 h | Lieu : `Bataclan, 50 bd Voltaire, 75011 Paris` | « Show » (crochets) → repère Paris « Date artiste — calendrier Google » |
| E2 | A | `show - Le Transbordeur` | dim. 13/12/2026, 20 h – 23 h | Lieu : `Le Transbordeur, Lyon` | minuscules → repère Lyon |
| E3 | A | `Showroom Paris` | lun. 14/12/2026, 10 h – 12 h | Lieu : `Paris` | pas « Show » : indisponible, aucun repère |
| E4 | A | `Slideshow photos` | lun. 14/12/2026, 15 h – 16 h | — | pas « Show » |
| E5 | A | `Show` | mar. 15/12/2026, 20 h – 22 h | Lieu : `Stade, Saint-Denis` | ville ambiguë (93 / La Réunion) → « localisation à préciser », aucun repère |
| E6 | A | `Rendez-vous perso` | mer. 16/12/2026, 9 h – 10 h | Lieu : `10 rue Essai, Paris` ; « Visibilité par défaut » → **Privé** | « Indisponible », ni titre ni lieu enregistrés |
| E7 | A | `Libre pour répéter` | jeu. 17/12/2026, 14 h – 16 h | « Occupé » → **Disponible** | ni indisponibilité ni alerte |
| E8 | A | `Vacances` | **journée entière** du lun. 21/12 au mer. 23/12/2026 | case « Toute la journée » | « jusqu'au 23/12 », sans décalage |
| E9 | A | `Cours de chant` | lun. 04/01/2027, 18 h – 19 h, **toutes les semaines**, 4 fois | « Ne se répète pas » → « Toutes les semaines le lundi » › fin après 4 occurrences | une ligne par occurrence |
| E9b | A | (occurrence du 11/01) | passer à 20 h – 21 h | à l'enregistrement : « **Cet événement** » | exception mise à jour, pas de doublon |
| E9c | A | (occurrence du 18/01) | supprimer | « **Cet événement** » | occurrence absente, gardée « supprimée » |
| E10 | A | `Show New York` | sam. 09/01/2027, 20 h – 23 h | lien « Fuseau horaire » › **New York** | affiché le 09/01 ; à Paris il est le 10/01 à 2 h |
| E11 | B | `Studio` | ven. 18/12/2026, 10 h – 18 h | — | période « Indisponible » sans détail |

## Partie 2 — séance (une seule autorisation), d'abord sur le projet de TEST, puis en production

Même ordre les deux fois. Sur le projet de test, l'essai porte sur un **artiste fictif** créé pour l'occasion ; en production, après
l'essai, seuls les agendas que de vrais artistes auront partagés seront reliés, plus tard, un par un.

1. **Migration** (Claude) : `supabase/migrations/2026-11-06_v1.62_agendas_artistes.sql` — gardes d'empreinte ; elle crée aussi les deux
   secrets dédiés (tâche planifiée, script des agendas).
2. **Fonction serveur** (Claude) : déploiement de `cal-sync` (vérification du jeton par la passerelle désactivée : la fonction contrôle
   elle-même chaque appel — SECURITE_SYNCHRO.md) ; puis `backup-export` (sauvegarde des deux nouvelles tables).
3. **Script avec son secret** (Anthony, sur production@) :
   a. Application › Réglages › « Agendas des artistes » › « Copier le code du script » ;
   b. https://script.google.com connecté avec **production@** › « Nouveau projet » › nommer `Matrice Agendas` › coller dans `Code.gs` ;
   c. « Copier le fichier appsscript.json » dans l'application › script.google.com › ⚙ Paramètres du projet › cocher « Afficher le fichier
      manifeste » › ouvrir `appsscript.json` › tout remplacer par le texte copié › Enregistrer ;
   d. le secret (seul chemin, le même que l'aide des Réglages) : Supabase › projet concerné › **Table Editor** › en haut à gauche,
      liste des schémas : **private** › table `import_secrets` › ligne `cal_script_secret` › copier la valeur de la colonne `value`
      (jamais dans une conversation) › script.google.com › ⚙ › « Propriétés du script » › Ajouter : nom `SECRET_AGENDAS`, valeur
      collée › Enregistrer ;
   e. « Déployer » › « Nouveau déploiement » › type « Application Web » › Exécuter en tant que : **moi** › Accès : **tout le monde** ›
      Déployer › autoriser (seul accès demandé : voir les agendas) › copier l'adresse qui finit par `/exec` ;
   f. Application › Réglages › « Adresse du script des agendas » › coller › « Tester » (attendu : « Script des agendas OK : N agendas visibles par production@ (script v…) »).
   En production, refaire seulement d et f avec le secret et l'application de production (même script, même adresse).
   **Dès que `SECRET_AGENDAS` reçoit la valeur de production, le projet de test ne peut plus appeler le script** (son secret est
   refusé : « Code secret du script des calendriers incorrect ») : c'est voulu — un seul projet lit les agendas à la fois.
4. **Activation** (Claude) : adresse de la fonction dans `private.sync_urls` → synchronisation toutes les 5 minutes.
5. **Essais** (Anthony dans l'application, Claude relève les preuves) :

| # | Action | Preuve attendue |
|---|---|---|
| A1 | fiche de l'artiste fictif › « Relier son agenda Google » | A et B proposés (B « disponibilités seulement »), jamais l'agenda principal de production@ ; choisir A (et rien d'autre : seuls les noms des autres agendas sont listés, aucun n'est lu) |
| A2 | Booking, année 2026 puis 2027 | E1–E6, E8–E10 en indisponibilités « Agenda Google » ; E6 « Indisponible » ; E7 absent ; E8 « jusqu'au 23/12 » ; E9 : 3 lignes (11/01 à 20 h) |
| A3 | carte | repères Paris et Lyon distincts ; « Localisation à préciser » : E5 (ville ambiguë) et E10 (« Show New York », sans lieu) ; rien pour E3, E4 |
| A4 | nouvelle date en option le **12/12/2026** | une alerte : E1 « chevauchement horaire » ; Annuler n'enregistre rien |
| A5 | nouvelle date en option le **09/01/2027** | une alerte : E10 « événement artiste le même jour » ; « Enregistrer quand même » enregistre |
| A6 | nouvelle date en option le **10/01/2027** | une alerte : E10 « chevauchement horaire » (2 h à Paris) |
| A7 | nouvelle date le **17/12/2026** | aucune alerte (E7 « Disponible ») |
| A8 | date « Confirmée Artiste » le 12/12 › sur E1 « Associer à une date » | date inchangée, E1 plus affiché en double |
| A9 | archiver la date d'A5 puis la restaurer | alerte d'agenda avant restauration ; Annuler ne restaure rien ; relances restées suspendues |
| A10 | modifier E2 (heure), supprimer E4 dans Google › « Actualiser » | E2 à jour, E4 disparu, aucun doublon |
| A11 | « Actualiser » deux fois sans rien changer | aucune ligne réécrite (Claude regarde les journaux) |
| A12 | 2ᵉ artiste fictif › relier B | E11 « Indisponible », badge « disponibilités seulement » |
| A13 | retirer le partage de A avec production@ › « Actualiser » | erreur affichée, « disponibilités plus à jour » dans la fiche et en tête de Booking, jamais « libre » |
| A14 | (Claude) appels de `cal-sync` sans justificatif, faux secret, compte hors équipe | refusés (403) |

Après l'essai : déconnecter les artistes fictifs, retirer les partages et supprimer les deux agendas d'essai (ou les garder pour plus tard).
