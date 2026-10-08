# Journal des versions — Matrice Booking L'ArtBoristerie

Numérotation : **majeur.mineur.correctif**. Un correctif répare quelque chose, une version mineure ajoute une fonctionnalité, une version majeure change profondément l'outil.
Pour publier une nouvelle version : `python3 tools/bump_version.py minor "Ce qui change"` (voir README).

<!-- nouvelles versions ci-dessous -->

## 1.6.0 — 08/10/2026
- Code réorganisé en fichiers séparés (un fichier par onglet, réglages, calculs, carte…), comme la Matrice Production AccessFac
- Numéro de version affiché dans l'app (en-tête et onglet Réglages) et rechargement automatique des fichiers à chaque version
- Journal des versions (ce fichier)
- Sauvegarde quotidienne de la base et des pièces jointes dans un dépôt privé

## 1.5.1 — 08/10/2026
- Tâches terminées et suivis clos masqués par défaut, avec un bouton pour les afficher

## 1.5.0 — 08/10/2026
- Tâches : nom modifiable directement dans la liste, plusieurs projets par tâche
- Reprise des tâches multi-projets de Notion (185 tâches)

## 1.4.0 — 08/10/2026
- Structures : recherche par nom, ville, code postal, département, région, type ; recherche « autour de » une ville avec rayon
- Localisation automatique des structures (1 157 avec coordonnées, 1 003 avec département)
- Suivi : plusieurs artistes par suivi (127 suivis Notion restaurés), pièces jointes dès la création
- Envoi de pièces jointes depuis l'iPhone
- Plus de suggestion de mot de passe dans les champs de recherche

## 1.3.0 — 08/10/2026
- Version téléphone : tableaux en fiches, bascule Liste / Carte en Booking, formulaires plein écran
- Fiche structure : boutons Nouvelle date et Nouvelle tâche

## 1.2.1 — 07/10/2026
- Carte : fond OpenStreetMap (CARTO exige désormais une clé)

## 1.2.0 — 07/10/2026
- Suivi : filtres artiste + statut combinés
- Résumé par IA (Gemini ou Claude, clé à configurer) et bouton « Copier pour ChatGPT »

## 1.1.0 — 07/10/2026
- Suivi complet importé de Notion : résumés, journal des échanges, 199 PDF de mails
- Page structure : contacts, suivi, dates, tâches

## 1.0.0 — 07/10/2026
- Lancement : Booking (carte, trajets), Production (suivi admin, facturation, commissions L'ArtBo / Pyrprod), Ticketing, Communication, Projets, To Do, Contacts, Structures, Réglages
- Import de l'espace Notion (dates, structures, contacts, projets, suivis, tâches)
