# MATRICE — prototype UX/UI n° 1 (tableau de bord et navigation modulaire)

Branche `ux/refonte-uxui`, créée depuis `main` au commit `ee1f806` (v1.68.3, 26/11/2026).
Référentiel graphique sur cette branche : **cahier des charges UX/UI v1.0** (arbitrage A2). `DESIGN_SYSTEM.md` reste celui de `main`.

## Isolation

- Dossier autonome : **aucun fichier de l'application n'est modifié** (`index.html`, `js/`, `css/`, `supabase/`, `apps-script/` intacts).
- **Données fictives** uniquement (`js/data.js`) : aucun artiste, lieu, contact ni montant réel.
- Aucune connexion : ni Supabase, ni Google, ni Pennylane, ni Brevo. Aucun appel réseau.
- Préférences gardées dans le stockage local du navigateur, sous une clé propre (`matrice-proto.prefs.v1`), conformément à l'arbitrage A12.
- GitHub Pages ne publie que `main` : ce dossier n'est pas en ligne depuis le dépôt. La démonstration est hébergée à part (lien transmis dans le compte rendu).

## Contenu

| Élément testé | Où |
|---|---|
| Palette Minéral & Sauge, mode sombre Graphite doux | partout ; Préférences › Apparence |
| Polices réelles, hébergées localement : Space Grotesk, Geist, IBM Plex Mono | `assets/fonts` |
| Navigation modulaire (architecture validée, 8 modules) | barre latérale, tiroir sur tablette, barre du bas et feuille « Modules » sur téléphone |
| Raccourcis personnalisables | étoile « Raccourci » sur chaque écran ; Préférences › Raccourcis |
| Modules dépliables, réorganisables, masquables | barre latérale ; Préférences › Modules |
| Profils métier (configuration de départ, pas des droits) | Préférences › Profil métier |
| Modes clair, sombre, système, horaires | Préférences › Apparence |
| Densité compacte, standard, confort (par type d'appareil) | Préférences › Densité |
| Taille du texte, graisse, interligne, espacement, contraste, alternance | Préférences › Confort de lecture |
| Effets de verre et animations désactivables | Préférences › Effets |
| Tableau de bord personnalisable : 4 indicateurs, 6 blocs | Tableau de bord › Personnaliser |
| Graphiques : barres réel / prévisionnel, remplissage billetterie, vue tableau | Tableau de bord |
| Panneau latéral de consultation | clic sur une date |
| Recherche globale Cmd/Ctrl + K (inactive dans les éditeurs de texte, A11) | partout |
| Représentation des 11 statuts sans dépendre de la couleur (A4) | Booking ; Préférences |
| Mails masqué hors titulaire (A8) | Préférences › Compte de démonstration |

Les autres onglets affichent « Écran non prototypé à ce stade », avec l'existant de MATRICE 1.68 et les accès transversaux conservés. Aucun module futur (subventions, tour management) n'apparaît dans la navigation.

## Fichiers

```
index.html          page unique
css/tokens.css      jetons : couleurs, typographie, rayons, densité, durées (source unique)
css/app.css         composants et mise en page
js/data.js          structure de navigation + données fictives
js/app.js           comportement (JavaScript natif, sans framework)
js/icons.js         icônes Lucide copiées localement (généré par outils/generer-icones.mjs)
assets/             polices et licences (SIL OFL 1.1 ; Lucide : ISC)
```

Consulter en local (développeur) : `python3 -m http.server` dans ce dossier, puis http://localhost:8000.
