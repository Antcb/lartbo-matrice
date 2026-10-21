# CLAUDE.md — Instructions permanentes (Matrice · L'ArtBoristerie Productions)

Ces instructions sont **obligatoires** pour tout développement sur ce dépôt. Elles s'appliquent à **toutes les pages** : l'application (`index.html`) **et** les pages publiques (`fiche.html`, `artiste.html`, `rh.html`, export artiste), ainsi qu'à Supabase (base, fonctions serveur) et aux scripts Google (`apps-script/`).

Référentiel (à lire **avant chaque développement**, dans cet ordre) :
1. [`CONVENTIONS.md`](CONVENTIONS.md) — règles fonctionnelles, métier et techniques
2. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) — règles visuelles et composants officiels
3. [`QA_CHECKLIST.md`](QA_CHECKLIST.md) — contrôles à faire avant toute mise en ligne

En cas de contradiction : ces trois documents l'emportent sur les habitudes du code existant. Une règle marquée **[À VALIDER]** n'est pas encore en vigueur : on garde le comportement actuel et on ne le généralise pas.

---

## 1. Communication avec Anthony
- Toujours en **français**, court et structuré (il lit souvent sur téléphone).
- **En cas de doute sur une logique métier ou sur sa portée : demander avant de coder.** Ne jamais trancher seul une règle ambiguë.
- Signaler explicitement **tout contrôle non réalisé** (« non vérifié : … ») — ne jamais présenter comme vérifié ce qui ne l'a pas été (ex. rendu visuel non ouvert dans un navigateur, script Google non redéployé, test non lancé).

## 2. Avant de modifier
1. Lire les trois documents du référentiel.
2. **Analyser les conséquences globales** : chercher toutes les occurrences de la même logique (vues, modales, pages publiques, SQL, fonctions edge, Apps Script). Une règle s'applique **partout** — jamais seulement à l'écran signalé.
3. Pour les dépendances et l'impact d'une modification non triviale : **interroger Greptile** (voir §6) et confronter sa réponse au code.
4. **Réutiliser** les composants et fonctions existants listés dans `DESIGN_SYSTEM.md` §9 et `CONVENTIONS.md` §8.2. Interdit de recréer une fonction qui existe (date, montant, arrondi, échappement, toast, appel Apps Script…).

## 3. Sources de vérité (ne jamais les contredire)
- **Réglages** (table `settings`, onglet Réglages) : paramètres et valeurs par défaut (pourcentages, coût Movinmotion, CNM, pôles, dossiers Drive, modèles).
- **COST€** (onglet des coûts réels du budget Excel de l'artiste) : dépenses réelles des tournées. Un écart Matrice ↔ COST€ est une anomalie à signaler, pas à « corriger » en silence.
- **Pennylane** : numéros, montants et statut payé des factures.
- **Google Drive** : les fichiers déjà présents. **Ne jamais supprimer, déplacer ni écraser un fichier Drive existant** (en particulier les modèles de contrats de management et de booking). Un remplacement n'est fait qu'après accord explicite, et l'ancien fichier part à la corbeille, jamais supprimé définitivement.

## 4. Dépendances à toujours vérifier
- **Supabase** : triggers (`shows_confirmed`, `show_follow_project_mode`, `project_mode_to_shows`, `show_mode_payments`, `contacts_clean`, `structures_place_clean`, `brevo_contacts`…), fonction planifiée `generate_reminders` (tous les jours à 5 h UTC), RLS `is_team()`, fonctions publiques à jeton (`fiche_*`, `artist_*`, `rh_*`).
- **Règles écrites deux fois** (JS + SQL / edge / Apps Script) : toute modification d'un côté impose la même modification de l'autre (liste dans `CONVENTIONS.md` §8.4).
- **Scripts Google** (`apps-script/*.gs`) : ils ne se mettent **pas** à jour tout seuls. Toute modification doit être signalée à Anthony avec la marche à suivre (Réglages › Google › « Copier le code à jour », coller dans Code.gs, nouvelle version de déploiement). Tant que ce n'est pas fait : « non vérifié en production ».
- **Fonctions edge** (`supabase/functions/*`) : déployées avec le contenu complet du fichier ; vérifier après déploiement que la version en ligne est identique au dépôt.

## 5. Publier une modification (procédure obligatoire)
1. Tests locaux (`QA_CHECKLIST.md` §T) + contrôles de la checklist concernés.
2. `python3 tools/bump_version.py patch|minor "description en français"` — **jamais** de modification manuelle de `APP_VERSION`, du `CHANGELOG.md` ou des `?v=`. Tout nouveau module JS impose de relancer le script (carte d'import).
3. Commit (message `vX.Y.Z : …` en français) puis push sur `main` (= mise en ligne GitHub Pages).
4. Migration SQL : fichier `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql` **et** application en base (voir `CONVENTIONS.md` §7.5).
5. **Revue Greptile jusqu'à 0 remarque** (§6). Chaque remarque est soit corrigée, soit réfutée avec justification écrite.
6. Compte rendu : ce qui a changé, ce qui reste à faire par Anthony (script Google…), et les contrôles non réalisés.

## 6. Greptile
- Revue de code : pousser l'arbre de `main` sur la branche `review/full` (PR n°1) puis commenter la PR :
  ```
  T=$(git rev-parse main^{tree}); git fetch -q origin review/full:refs/remotes/origin/review/full
  C=$(git commit-tree $T -p origin/review/full -m "vX.Y.Z"); git push -q origin $C:refs/heads/review/full
  gh api repos/Antcb/lartbo-matrice/issues/1/comments -f body="@greptileai relis la vX.Y.Z (…)"
  ```
  puis lire les commentaires de revue de la PR créés après la demande.
- Analyse de dépendances : poser la question en commentaire de la PR n°1 (« Question d'analyse, pas de relecture de diff : … »).
- Si Greptile ne répond pas : le dire dans le compte rendu (« revue Greptile non obtenue ») — ne jamais l'omettre.

## 7. Interdits
- Supprimer ou réécrire en masse des données Supabase sans accord explicite.
- Lancer une migration destructive (`drop`, suppression de colonne, `delete` massif) sans accord explicite.
- Ajouter une dépendance externe (bibliothèque, service payant) sans accord : **préférer les solutions gratuites**.
- Introduire un style inline, une couleur ou une taille hors jetons, un nouveau composant qui en duplique un existant (`DESIGN_SYSTEM.md` §10).
- Laisser une correction « à moitié » : une règle corrigée l'est sur tous les écrans et tous les chemins (modale, tableau, page publique, serveur).
