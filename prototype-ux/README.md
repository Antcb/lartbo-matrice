# MATRICE — prototype UX/UI V6.1 « Bento × Liquid Glass »

Branche `ux/refonte-uxui`, créée depuis `main` au commit `ee1f806` (v1.68.3, 26/11/2026). `main` inchangée depuis.
Référentiel graphique sur cette branche : **cahier des charges UX/UI v1.0** (arbitrage A2). `DESIGN_SYSTEM.md` reste celui de `main`.

## Isolation

- Dossier autonome : **aucun fichier de l'application n'est modifié** (`index.html`, `js/`, `css/`, `supabase/`, `apps-script/` intacts).
- **Données fictives** uniquement (`js/data.js`) : aucun artiste, lieu, contact ni montant réel.
- Aucune connexion : ni Supabase, ni Google, ni Pennylane, ni Brevo. Aucun appel réseau.
- Préférences gardées dans le stockage local du navigateur, sous une clé propre (`matrice-proto.prefs.v1`), conformément à l'arbitrage A12.
- GitHub Pages ne publie que `main` : ce dossier n'est pas en ligne depuis le dépôt. La démonstration est hébergée à part (lien transmis dans le compte rendu).

## V6.1 (27/11/2026) — finitions ciblées

- Bandeau Booking : vraie vague organique en trois couches colorées (teintes de la palette), volume et reflet de crête ; contraste ≥ 5:1 sous les lettres.
- Colonne centrale toujours Tâches > Relances prioritaires > Suivis actifs : correction de la reprise des préférences (une ancienne préférence locale inversait l'ordre) ; ordre fixé par la grille, blocs seulement masquables.
- Messagerie : trois tuiles identiques (Non lus, À répondre, À rattacher). Suivis actifs : barres élargies.
- Barre latérale Mac en clair : verre plus naturel, halo turquoise atténué.
- Menu Modules : tableau de bord visible et assombri au-dessus ; fond opaque limité à la surface du menu.
- Barre du bas iPhone : « Modules » n'est plus jamais sélectionné ; un point signale une page hors barre.
- iPhone : bouton « Afficher 4 dates de plus » et sélecteur graphique/tableau allégés, zones tactiles de 44 px conservées.

## V6 (27/11/2026) — Bento, Liquid Flow, Liquid Glass

- Mac : bandeau Booking pleine largeur puis 3 colonnes indépendantes (31 / 27 / 42 %) : Prochaines dates + Billetterie ; Tâches + Relances prioritaires + Suivis actifs ; Finances + Messagerie. Bloc Modules retiré du tableau de bord.
- Bandeau Booking « Liquid Flow » : dégradé plus profond, ruban translucide à liseré lumineux, seconde courbe discrète ; contraste ≥ 5,3:1 mesuré sous les lettres.
- Liquid Glass sur la barre latérale, la barre flottante et le menu Modules (posé sur un voile opaque) ; lentille sur l'élément actif ; menus et recherche opaques car posés sur des données.
- Menu Modules : supports neutres, accent réservé au module actif, un seul contour fin.
- Marqueur pictographique teinté par section ; titres de section en Geist.
- iPhone : 4 prochaines dates puis « Afficher N dates de plus ». Histogramme corrigé (barres identiques, base commune, libellés alignés). Messagerie : « à répondre » affiché avec une valeur fictive, sans règle.

## V5 (27/11/2026) — tableau de bord « Backstage »

- Fonds clairs au choix (Préférences › Apparence › Fond clair) : Blanc Apple `#F5F5F7`, Blanc glacier `#EFF3F5` (défaut), Argent minéral `#E8EBED` ; graphite `#1E1F22` en sombre. Indépendants de la palette et du mode.
- Une composition par section : Booking (bloc signature en dégradé, courbe translucide, 4 indicateurs sur une ligne), Prochaines dates (timeline par mois, statut complet), Tâches (4 compteurs en grille 2 × 2, liste prioritaire, case « Marquer comme faite »), Finances (chiffre d'affaires HT, courbe réalisé / prévisionnel, périodes 1M à Tout, 3 indicateurs TTC dont l'échu non soldé), Billetterie (jauges fines avec repère du break), Suivis actifs (histogramme par statut actif), Relances prioritaires, Messagerie (non lus, à rattacher, avatars), Modules (carrés dégradés, aussi dans la feuille Modules sur iPhone).
- Verre retravaillé (translucidité, reflet, liseré lumineux, ombre diffuse), réservé à la navigation, désactivable.
- Densité : titres, marges, en-têtes et commandes réduits ; réglages de densité et de confort conservés.
- Préférences des versions précédentes reprises (blocs convertis, palette conservée).

## V4 (27/11/2026) — rupture artistique

- Surfaces de référence : ivoire `#F5F2ED` (clair) et graphite `#1E1F22` (sombre).
- Deux identités chromatiques, centralisées dans `css/tokens.css` (une seule interface) : **Electric Lagoon** (défaut, `#247E91` → `#72C9B4`) et **Opal** (`#78B9AD` → `#A6B5E8` → `#D8A4C5`), chacune en clair et en sombre. Choix dans Préférences › Apparence › Identité chromatique, appliqué immédiatement, mémorisé localement, indépendant du mode.
- Marqueurs identitaires : MATRICE `///` en dégradé, courbe en dégradé dans l'en-tête du tableau de bord (jamais derrière des données), tuile d'indicateur mise en avant en dégradé (au choix : toucher une tuile), filet dégradé de l'élément actif, interrupteurs et jauges en dégradé.
- Graphique : courbes lissées par interpolation monotone (passent exactement par chaque valeur, sans bosse ni creux inventés), aire en dégradé, réalisé en trait plein, prévisionnel en pointillés, point choisi lumineux, vue tableau conservée.
- Statuts : couleurs fonctionnelles inchangées ; sur téléphone, libellé court (étape) visible, libellé complet lu par les lecteurs d'écran.

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
