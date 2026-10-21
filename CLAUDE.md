# CLAUDE.md — Instructions permanentes (Matrice · L'ArtBoristerie Productions)

Ces instructions sont **obligatoires** avant et pendant toute intervention sur ce dépôt. Elles s'appliquent à **toutes les pages** : l'application (`index.html`) **et** les pages publiques (`fiche.html`, `artiste.html`, `rh.html`, export artiste), ainsi qu'à Supabase (base, fonctions serveur) et aux scripts Google (`apps-script/`).

Référentiel (à lire **avant chaque développement**, dans cet ordre) :
1. [`CONVENTIONS.md`](CONVENTIONS.md) — règles métier, calculs, saisies, navigation, données, sécurité
2. [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) — règles visuelles et comportement des composants
3. [`QA_CHECKLIST.md`](QA_CHECKLIST.md) — contrôles à faire après chaque développement

Les règles marquées **[DÉCIDÉ Qn]** ont été arbitrées par Anthony (Q0 à Q38, 21/10/2026) et sont définitives. En cas de contradiction, ces trois documents l'emportent sur le comportement du code existant ; un écart du code est une **[CORRECTION]** à faire dans un chantier autorisé, jamais un modèle à reproduire.

---

## 1. Communication avec Anthony
- Toujours en **français**, court et structuré (il lit souvent sur téléphone).
- **En cas de doute sur une logique métier ou sur sa portée : demander avant de coder.** Ne jamais trancher seul une règle ambiguë ni inventer une règle métier.
- Signaler explicitement **tout contrôle non réalisé** (« non vérifié : … ») — ne jamais présenter comme vérifié ce qui ne l'a pas été (rendu non ouvert dans un navigateur, script Google non redéployé, test non lancé, Greptile sans réponse).

## 2. Avant de modifier
1. Lire les sections concernées des trois documents.
2. **Vérifier les impacts transversaux** : chercher toutes les occurrences de la même logique (vues, fenêtres, tableaux, pages publiques, SQL, fonctions edge, Apps Script). Une règle s'applique **partout**, jamais seulement à l'écran signalé.
3. Pour les dépendances et l'impact d'une modification non triviale : **interroger Greptile** (§6) et confronter sa réponse au code.
4. **Réutiliser** les composants et fonctions existants (`DESIGN_SYSTEM.md` §9, `CONVENTIONS.md` §8.2). Interdit de recréer une fonction ou un composant qui existe (date, montant, arrondi, échappement, toast, fenêtre, appel Apps Script…).
5. **Respecter les règles métier** de `CONVENTIONS.md` §6 (commission, acompte/solde, cachet, compte d'encaissement, modes, rappels, pôles, dépenses réelles).

## 3. Sources de vérité et protection des données
- **Réglages** (table `settings`) : paramètres et valeurs par défaut.
- **Pennylane** : numéros, montants et statut payé des factures. **Une facture envoyée n'est jamais modifiée silencieusement** (`CONVENTIONS.md` §6.3–6.5).
- **Dépenses réelles** : la Matrice devient la référence ; pendant la transition, le fichier Excel **COST€** reste tenu et n'est jamais supprimé, arrêté ni écrasé ; un écart Matrice ↔ COST€ est signalé, jamais corrigé en silence (`CONVENTIONS.md` §6.9).
- **Google Drive** : **ne jamais supprimer, déplacer ni écraser un fichier existant** (en particulier les modèles de contrats de management et de booking). Un remplacement n'a lieu qu'après accord explicite et l'ancien fichier part à la corbeille Drive.
- **Données historiques** : aucune modification, attribution ou complétion en lot (ex. 225 encaissements sans compte, 547 tâches terminées sans date) sans validation d'Anthony ; aucune valeur inventée.
- **Structures de la base** : aucune suppression de table, fonction, colonne ou donnée sans recherche des dépendances **et** validation spécifique (`CONVENTIONS.md` §7.8) ; ne jamais conclure qu'un objet est inutilisé faute de référence évidente.

## 4. Dépendances à toujours vérifier
- **Supabase** : triggers (`shows_confirmed`, `shows_defaults`, `show_follow_project_mode`, `project_mode_to_shows`, `show_mode_payments`, `contacts_clean`, `structures_place_clean`, `brevo_contacts`…), tâche planifiée `generate_reminders` (5 h UTC), RLS `is_team()`, fonctions publiques à jeton (`fiche_*`, `artist_*`, `rh_*`).
- **Règles écrites deux fois** (JS + SQL / edge / Apps Script) : modifier les deux côtés dans la même version (`CONVENTIONS.md` §8.4).
- **Scripts Google** (`apps-script/*.gs`) : ils ne se mettent **pas** à jour tout seuls. Toute modification est signalée à Anthony avec la marche à suivre (Réglages › Google › « Copier le code à jour », coller, nouvelle version de déploiement) ; tant que ce n'est pas fait : « non vérifié en production ».
- **Fonctions edge** (`supabase/functions/*`) : déployées avec le contenu complet du fichier ; vérifier ensuite que la version en ligne est identique au dépôt.

## 5. Publier une modification (procédure obligatoire)
1. **Tests avant intégration** : tests automatiques du dossier `tests/` concernés + nouveau test pour toute correction (`CONVENTIONS.md` §9), puis contrôles de `QA_CHECKLIST.md` adaptés aux parties modifiées et à leurs régressions transversales.
2. `python3 tools/bump_version.py patch|minor "description en français"` — **jamais** de modification manuelle de `APP_VERSION`, du `CHANGELOG.md` ou des `?v=`. Tout nouveau module JS impose de relancer le script (carte d'import).
3. Commit (`vX.Y.Z : …` en français) puis push sur `main` (= mise en ligne GitHub Pages). Un travail de documentation ou exploratoire se fait sur une branche dédiée, non fusionnée sans accord.
4. Migration SQL : fichier `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql` **et** application par le mécanisme de migrations (`CONVENTIONS.md` §7.5), après les vérifications d'opération sensible (§7.6).
5. **Revue Greptile jusqu'à 0 remarque** (§6). Chaque remarque est corrigée ou réfutée avec justification écrite.
6. Compte rendu : ce qui a changé, ce qui reste à faire par Anthony (script Google…), les contrôles **É** et **NV** de la checklist.

## 6. Greptile
- Revue de code : pousser l'arbre de `main` sur la branche `review/full` (PR n°1) puis commenter la PR :
  ```
  T=$(git rev-parse main^{tree}); git fetch -q origin review/full:refs/remotes/origin/review/full
  C=$(git commit-tree $T -p origin/review/full -m "vX.Y.Z"); git push -q origin $C:refs/heads/review/full
  gh api repos/Antcb/lartbo-matrice/issues/1/comments -f body="@greptileai relis la vX.Y.Z (…)"
  ```
  puis lire les commentaires de revue de la PR créés après la demande.
- Analyse de dépendances : question en commentaire de la PR n°1 (« Question d'analyse, pas de relecture de diff : … »).
- Si Greptile ne répond pas : l'écrire dans le compte rendu (« revue Greptile non obtenue »).

## 7. Interdits
- Supprimer ou réécrire en masse des données Supabase, lancer une migration destructive (`drop`, suppression de colonne, `delete` massif) sans accord explicite.
- Ajouter une dépendance externe (bibliothèque, service payant) sans accord : **préférer les solutions gratuites**.
- Introduire un style inline, une couleur ou une taille hors jetons, ou un composant qui en duplique un existant (`DESIGN_SYSTEM.md` §10).
- Introduire une fenêtre native du navigateur (`alert`, `confirm`, `prompt`) (`CONVENTIONS.md` §4.5).
- Laisser une correction « à moitié » : une règle corrigée l'est sur tous les écrans et tous les chemins (fenêtre, tableau, page publique, serveur).

## 8. Autorisation de corriger les bugs évidents [DÉCIDÉ Q0]
Un bug technique **évident** (le code contredit sa propre intention ou une règle décidée, liste dans le document d'arbitrage et dans les **[CORRECTION]** de `CONVENTIONS.md`) peut être corrigé **sans arbitrage individuel**, **uniquement si toutes** ces conditions sont remplies :
1. les règles métier validées sont respectées ;
2. aucune donnée historique n'est modifiée sans validation ;
3. aucune suppression ni migration destructive n'est réalisée sans autorisation ;
4. les impacts sur les autres fonctionnalités sont vérifiés (§2) ;
5. des tests adaptés sont exécutés avant intégration (§5).

Cette autorisation **n'est pas** une autorisation générale de refonte fonctionnelle : tout changement de comportement visible non décidé, toute nouvelle fonctionnalité et toute correction qui exige d'interpréter une règle passent d'abord par Anthony.
