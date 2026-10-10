# Script Google (compte production@lartboristerie.com)

Il fait tout ce qui touche à Google : dossiers Drive des dates, brouillons Gmail,
récap quotidien des rappels par mail. Une seule installation, ~10 minutes.

## Installation

1. Connecté en **production@lartboristerie.com**, ouvrir https://script.google.com › **Nouveau projet**, le nommer « Matrice ».
2. Remplacer le contenu de `Code.gs` par celui de `apps-script/Code.gs` (ce dépôt). Enregistrer.
3. ⚙️ **Paramètres du projet** › **Propriétés du script** › ajouter :
   | Propriété | Valeur |
   |---|---|
   | `SUPABASE_URL` | `https://ypvvjoqhzddzbmerypdc.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | clé **service_role** (Supabase › Project Settings › API Keys) — secrète |
   | `WEBHOOK_SECRET` | le code secret (Matrice › Réglages › Google › « Copier ») |
   | `TEMPLATE_FOLDER_ID` | `1LjcPIKo3zsOejsj8Dm1_nigbwPFg8QTU` (dossier modèle d'une date) |
   | `ARTISTS_ROOT_ID` | `1jcudFeSxND8_NuriMUOpUdOAybTd5e0l` (dossier qui contient les dossiers artistes) |
   | `PRODUCTION_FOLDER` | `032_Production` |
4. **Déployer** › **Nouveau déploiement** › type **Application Web** : exécuter en tant que **Moi**, accès **Tout le monde**. Autoriser l'accès (Drive, Gmail). Copier l'URL `…/exec`.
5. Dans la Matrice › **Réglages › Google** : coller l'URL dans « Adresse du script », puis **Tester le script**.
6. Dans Supabase, mettre la même URL dans le réglage `drive_webhook_url` : c'est fait automatiquement par l'étape 5 (même réglage).
7. **Déclencheurs** (icône réveil) › **Ajouter** : fonction `dailyJob`, déclencheur temporel, **tous les jours, entre 7 h et 8 h**.
8. Matrice › Réglages › Google › **Rattacher les dossiers Drive existants** (une fois).

Après une modification de `Code.gs` : **Déployer › Gérer les déploiements › ✏️ › Nouvelle version** (l'URL ne change pas).

## Ce que fait le script

- `create_folder` (automatique quand une date passe en Confirmée) : `<Artiste>/032_Production/<Année>/MM_DD • Ville • Salle (CP)`, copie du dossier modèle.
- `draft` : brouillon Gmail préparé depuis la Matrice (pièces jointes Drive du modèle incluses).
- `link_folders` : rattache les dossiers `MM_DD • …` (ou anciens `MM-DD • …`) aux dates du même artiste et du même jour.
- `folder_path` : chemin du dossier, pour « Copier le chemin Finder ».
- `dailyJob` : brouillons des boucles arrivées à échéance + mail récap des nouvelles notifications à Anthony et Chloé.
