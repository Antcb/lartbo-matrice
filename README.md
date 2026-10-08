# Matrice Booking — L'ArtBoristerie

Outil de booking et de production qui remplace l'espace Notion : contacts et structures, booking avec carte et trajets, production (suivi admin, facturation, commissions), ticketing, communication, projets, suivi des structures et To Do.

- En ligne : https://antcb.github.io/lartbo-matrice/
- Accès réservé à anthony@ et production@lartboristerie.com
- Version actuelle : voir `js/config.js` (affichée dans l'app, en haut et dans Réglages) et l'historique dans [CHANGELOG.md](CHANGELOG.md)

## Organisation du code

```
index.html            page unique : charge les bibliothèques, la feuille de style et js/app.js
css/styles.css        toute l'apparence (couleurs, tableaux, version téléphone en bas du fichier)
js/
  config.js           ← version de l'app, adresse Supabase, équipe autorisée
  constants.js        listes métier : statuts, contrats, affiches, priorités, onglets
  state.js            état en mémoire (données, onglet ouvert, filtres)
  utils.js            formats € et dates, messages, mise en forme du texte
  data.js             lecture / écriture dans Supabase, envoi de fichiers
  selectors.js        lecture des données (noms, filtres, suivis, urgence des tâches)
  calc.js             🧮 calculs : acomptes, solde, commission L'ArtBo, part Pyrprod, net
  geo.js              localisation des villes, distances, itinéraires
  ui/cells.js         champs modifiables directement dans les tableaux
  ui/modal.js         fenêtre de formulaire générique
  views/              un fichier par onglet
    booking.js  production.js  ticketing.js  communication.js  projects.js
    todo.js  suivi.js  structures.js  contacts.js  settings.js  auth.js
  forms.js            formulaires de création / modification
  actions.js          ce que fait chaque bouton (data-act="…")
  events.js           saisies, filtres, pièces jointes
  app.js              en-tête, onglets, démarrage
tools/bump_version.py nouvelle version + changelog + rechargement des fichiers
supabase/             structure de la base, import Notion, fonctions serveur
  functions/import-suivi   import du contenu des suivis Notion
  functions/resume-suivi   résumé de suivi par IA
  functions/backup-export  export utilisé par la sauvegarde quotidienne
backup/               modèle du dépôt de sauvegarde privé (lartbo-matrice-backup)
apps-script/          création automatique des dossiers Drive (Code.gs)
```

## Où modifier quoi

| Je veux changer…                                   | Fichier                         |
|----------------------------------------------------|---------------------------------|
| Un statut, une liste déroulante, l'ordre des onglets | `js/constants.js`              |
| Un calcul de commission, d'acompte ou de net        | `js/calc.js`                    |
| Les pourcentages par défaut                         | dans l'app : onglet Réglages    |
| L'affichage d'un onglet                             | `js/views/<onglet>.js`          |
| Les champs d'un formulaire (date, tâche, suivi…)    | `js/forms.js`                   |
| Ce que fait un bouton                               | `js/actions.js`                 |
| Couleurs, tailles, version téléphone                | `css/styles.css`                |
| La carte, les distances, les trajets                | `js/geo.js`, `js/views/booking.js` |
| Les comptes autorisés                               | `js/config.js` + table `app_users` |
| Le nom ou le contenu des dossiers Drive             | `apps-script/Code.gs`           |
| Le texte demandé à l'IA pour les résumés            | `supabase/functions/resume-suivi/index.ts` |

## Publier une mise à jour

1. Faire la modification.
2. Incrémenter la version et noter ce qui change :
   ```
   python3 tools/bump_version.py patch "Correction …"      # 1.6.0 → 1.6.1
   python3 tools/bump_version.py minor "Nouveauté …"       # 1.6.0 → 1.7.0
   python3 tools/bump_version.py major "Refonte …"         # 1.6.0 → 2.0.0
   ```
   Le script met à jour `js/config.js`, ajoute l'entrée en haut de `CHANGELOG.md` et met le numéro de version sur tous les fichiers dans `index.html`, pour que les navigateurs (et les téléphones) rechargent la nouvelle version.
3. `git commit` puis `git push` : GitHub Pages publie en une minute environ.

Tester en local : `python3 -m http.server 8000` dans ce dossier, puis ouvrir http://localhost:8000 (les modules JavaScript ne fonctionnent pas en ouvrant le fichier directement).

## Sauvegarde

Chaque nuit, le dépôt privé `Antcb/lartbo-matrice-backup` récupère toute la base (une copie JSON par table) et les pièces jointes des suivis, et les enregistre dans un commit daté. L'historique Git permet de revenir à n'importe quel jour. Le fonctionnement est décrit dans `backup/README.md`.

## Sécurité

La clé Supabase présente dans `js/config.js` est publique par conception : l'accès aux données est limité par les règles RLS (`supabase/schema.sql`) aux deux comptes de l'équipe. Les clés secrètes (service, Notion, IA, sauvegarde) restent côté serveur, dans le schéma privé de Supabase.
