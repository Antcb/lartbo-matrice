# MATRICE — prototype UX/UI V3 (tableau de bord, navigation modulaire, préférences, panneau latéral)

Branche `ux/refonte-uxui`, créée depuis `main` au commit `ee1f806` (v1.68.3, 26/11/2026). `main` inchangée depuis.
Référentiel graphique sur cette branche : **cahier des charges UX/UI v1.0** (arbitrage A2). `DESIGN_SYSTEM.md` reste celui de `main`.

## Isolation

- Dossier autonome : **aucun fichier de l'application n'est modifié** (`index.html`, `js/`, `css/`, `supabase/`, `apps-script/` intacts).
- **Données fictives** uniquement (`js/data.js`) : aucun artiste, lieu, contact ni montant réel.
- Aucune connexion : ni Supabase, ni Google, ni Pennylane, ni Brevo. Aucun appel réseau.
- Préférences gardées dans le stockage local du navigateur, sous une clé propre (`matrice-proto.prefs.v1`), conformément à l'arbitrage A12.
- GitHub Pages ne publie que `main` : ce dossier n'est pas en ligne depuis le dépôt. La démonstration est hébergée à part (lien transmis dans le compte rendu).

## V3 (26/11/2026) — direction artistique

- Trame de points supprimée ; fond clair neutralisé (`#F3F3F1`, sans dominante verte) ; palette sombre inchangée ; teintes tertiaires V2 conservées.
- Verre sans motif de fond : translucidité, reflet supérieur (sur l'élément vitré seulement), liserés de 0,5 px, ombre de séparation en deux plans. Désactivable.
- Sauge renforcée sur les éléments actifs : lentille sauge fine dans la navigation et la barre du bas, ligne sélectionnée avec filet sauge.
- Mac : cartes à la hauteur de leur contenu (plus de vides dans Tâches et Billetterie) ; panneau : statut et lieu dans l'en-tête, faits clés, listes à filets, note distincte.
- iPhone : barre du bas affinée (50 px), libellés courts des indicateurs sans coupure de mot (libellé complet lu par les lecteurs d'écran), en-têtes de cartes et lignes plus compacts, feuille « Modules » en deux colonnes par module sans répéter la barre du bas, contrôles segmentés affinés (zone tactile de 44 px conservée), interrupteur Animations verrouillé et décoché quand le système impose la réduction.

## V2 (26/11/2026) — après consultation sur Mac et iPhone

- **Couches** : socle minéral avec trame de points de précision (sans dégradé) · surfaces métier opaques · navigation en verre · panneaux et menus.
- **Verre** : barre latérale flottante, barre du bas, menus, recherche et feuille « Modules » en verre (flou + saturation, liseré lumineux, ombre diffuse). La trame du socle rend le flou perceptible **sans qu'aucune donnée ne passe derrière**. Désactivable (Préférences › Effets).
- **Mac** : barre latérale détachée ; mode réduit = rail de 60 px avec sous-onglets en menu flottant et contenu élargi ; panneau de consultation **ancré et non bloquant** (l'espace de travail se resserre, Échap ferme) ; préférences en colonnes fluides ; indicateurs en IBM Plex Mono 30 px avec libellés techniques ; graphique : prévisionnel en aplat léger, réalisé en graphite, repère « aujourd'hui ».
- **iPhone** : navigation unique (barre du bas en verre + feuille « Modules », plus de menu hamburger) ; 4 indicateurs sur une ligne (2 × 2 si texte ≥ 112 % ou écran trop étroit), montants abrégés avec bouton « Afficher les montants exacts » ; actions d'en-tête réduites à leur icône ; les listes passent à la ligne au lieu de couper (aucune information masquée) ; panneau en feuille haute.
- **Accessibilité** : textes des statuts et priorités en couleur neutre (couleur sur l'icône seulement) ; teinte tertiaire assombrie ; lien « Aller au contenu » ; contrastes vérifiés automatiquement (axe-core).

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
