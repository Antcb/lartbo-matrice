# DESIGN_SYSTEM.md — Cohérence visuelle de la Matrice

Source unique des règles visuelles et du comportement des composants de l'application **et** des pages publiques (`fiche.html`, `artiste.html`, `rh.html`, export artiste `js/artist-export.js`).
Feuilles de style : `css/styles.css` (tout) et `css/fiche.css` (pages publiques + fiches artiste/salarié dans l'app, chargé aussi par `index.html`).

**Légende des marqueurs** (utilisée dans tout le document)
- **[EN PLACE]** convention déjà appliquée dans le code : à respecter.
- **[NOUVELLE]** convention définie ici, sans changer l'apparence actuelle : à appliquer à tout nouveau code.
- **[DÉCIDÉ Qn]** choix arbitré par Anthony (question n du document « Arbitrages du référentiel Matrice », 21/10/2026) : définitif et obligatoire ; si le code ne le respecte pas encore, l'écart est une **[CORRECTION]**.
- **[CORRECTION]** écart actuel du code par rapport à la règle : à corriger lors d'un chantier dédié (liste récapitulative §13).

Identité conservée : police **Geist**, bleu L'ArtBo **#283C63** pour les actions et les titres, couleurs réservées aux statuts. Aucune nouvelle identité graphique.

---

## 1. Couleurs

### 1.1 Jetons existants (`styles.css` `:root`) [EN PLACE]
| Jeton | Valeur | Usage unique |
|---|---|---|
| `--brand` | #283C63 | titres, bouton principal, élément actif plein, soulignement d'onglet |
| `--brand-2` | #3A5488 | liens, survol de bouton, focus (`:focus-visible`) |
| `--brand-ink` | #FFFFFF | texte sur `--brand` |
| `--brand-tint` | #E8ECF3 | élément sélectionné (fond clair), ligne mise en évidence |
| `--bg` | #EEF1F5 | fond de page |
| `--panel` | #FFFFFF | fond des panneaux, tableaux, champs, menus, fenêtres |
| `--soft` | #F6F8FA | fond secondaire : en-têtes de tableau, encarts gris, survol discret |
| `--ink` | #16213A | texte principal |
| `--muted` | #5B677D | texte secondaire, libellés, aides |
| `--faint` | #8A94A6 | texte tertiaire (indications de dépôt, valeurs vides) |
| `--line` | #DCE1E8 | bordures (champs, panneaux) |
| `--line-2` | #E9EDF2 | séparateurs internes (lignes de tableau, pastilles) |
| `--ok` | #1D6B3A | succès, payé, fait |
| `--warn` | #B7790F | attention, à vérifier, valeur saisie à la place d'un calcul |
| `--danger` | #B8352B | erreur, retard, suppression |

Couleurs des **statuts de date** : uniquement `STATUS_COLOR` (`js/constants.js`) via `stColor()` / `stBadge()` / `stSelect()` [EN PLACE]. Couleurs des **pôles** : réglage `departments` via `deptColor()` [EN PLACE].

### 1.2 Règles [NOUVELLE]
- Aucune couleur écrite en dur (hex, rgb) hors `:root`, hors `STATUS_COLOR` et hors couleurs de pôles. `#fff` s'écrit `var(--panel)` (fond) ou `var(--brand-ink)` (texte sur fond plein).
- Une couleur = un sens [DÉCIDÉ Q31] : vert = fait / payé / succès ; jaune-orangé = attention / à vérifier ; rouge = **retard**, erreur, suppression ; bleu = action / sélection ; **violet = échéance du jour** (uniquement). Aucune teinte « décorative ». Une échéance du jour ne doit jamais ressembler à un retard ou à une erreur (violet ≠ rouge), et un retard jamais à une erreur de saisie (pastille pleine `.urg.late` ≠ bordure/texte d'erreur).
- En JS, ne pas recopier une couleur de statut ou de jeton : lire `STATUS_COLOR`, `deptColor()` ou passer par une classe CSS.

### 1.3 Couleurs sémantiques uniformisées [DÉCIDÉ Q31]
Une seule couleur de fond par signification (aujourd'hui 5 verts, 6 jaunes, 3 rouges) : jetons **à créer** dans `:root`, puis remplacement de toutes les variantes.
| Jeton (à créer) | Valeur (déjà utilisée, conservée) | Remplace | Texte associé |
|---|---|---|---|
| `--ok-tint` | #E3F1E7 (`.ok-badge`) | #E7F3EA, #F4FAF6 (`is-paid`), #F3FAF5, #EEF6F0 | `--ok` |
| `--warn-tint` | #FFF1D6 (`.warn-badge`) | #FFF6E0, #FFE9A8, #FDF3E1, #FBF0D9, #FFF9EC (`has-doc`) | #8A5A00 (contraste suffisant sur fond clair ; `--warn` reste pour le texte sur fond blanc) |
| `--danger-tint` | #FBE4E1 (`.urg.crit`) | #FBEDEC, #F6D5D2 | `--danger` |
| `--today` | #6D2FB0 (`.urg.today`) | — (violet **conservé**, réservé à l'échéance du jour) | texte `--brand-ink` sur fond `--today` |
[NOUVELLE] Les couleurs de statut proches d'un jeton (`STATUS_COLOR['Annulée']` #C8372D ≈ `--danger`) restent dans `STATUS_COLOR` (couleurs de statut, hors jetons sémantiques).

---

## 2. Espacements

### 2.1 Échelle [EN PLACE]
Échelle **6 · 12 · 18 px** (jetons `--sp-1/2/3`, utilitaires) + 24 px pour les écarts de mise en page.
Utilitaires officiels : `.m0`, `.mt0`, `.mt-sm` (6), `.mt` (12), `.mt-lg` (18), `.mb-sm` (6), `.mb` (12), `.mb-lg` (18).

### 2.2 Règles [NOUVELLE]
- Marge entre blocs : utiliser les utilitaires ci-dessus. **Interdit** : `style="margin…"` dans le JS.
- Valeurs autorisées pour `margin` / `padding` / `gap` dans le CSS : **4, 6, 8, 10, 12, 16, 18, 24 px** (les valeurs déjà majoritaires). Toute autre valeur (14, 20, 26, 9…) est interdite dans le nouveau code, sauf compensation technique documentée en commentaire (ex. le décalage d'alignement de 9 px, §5).
- Espace sous un en-tête de page : `.view-head` (18). Sous un bloc : 18 (`.suivi-block`, `.struct-hero`). Entre éléments d'une liste d'actions : `gap:8px` (`.vh-actions`).

### 2.3 Uniformisation [DÉCIDÉ Q30]
- Les utilitaires reposent sur les jetons (`.mt{margin-top:var(--sp-2)}`…) — sans changement visuel.
- Marge basse d'un bloc principal : **18** ; d'un sous-bloc : **12** (aujourd'hui 10/12/14/16/18 selon le bloc). [CORRECTION]

---

## 3. Typographie

### 3.1 Base [EN PLACE]
- `body` : Geist, 14 px, interligne 1,5, `--ink`. Téléphone (≤ 760 px) : 15 px, champs à 16 px (évite le zoom iOS).
- Chiffres alignés : classe `.num` (`tabular-nums`) sur toute colonne de montants.

### 3.2 Échelle des titres (une seule convention par niveau)
| Niveau | Élément officiel | Taille | Couleur | Statut |
|---|---|---|---|---|
| Titre de page | `<h1>` dans `viewHead()` | `--fs-h1` 34 (28 sur téléphone) | `--brand` | [EN PLACE] |
| Titre de section (groupe de blocs, mois, fenêtre) | `<h2>` | `--fs-h2` 22 | `--brand` | [EN PLACE] |
| Titre de panneau | `<h3 class="panel-title">` | `--fs-h3` 18 | `--brand` | [EN PLACE] (Réglages) |
| Intertitre / étiquette de bloc | `<h3 class="block-title">` (dans un panneau : `<h4 class="block-title">`) | 13, gras 700 | `--muted` | [EN PLACE] |
| Repli (section dépliable) | `fold()` (`.fold-head`) | 14, 700 | `--muted` | [EN PLACE] |

**Règle [DÉCIDÉ Q32]** : **grands titres bleus pour les sections principales**, **petits titres gris pour les sous-sections**.
- *Section principale* = un bloc de premier niveau d'une page ou d'un onglet : un `.panel` ou un bloc de même niveau (`.suivi-block` d'une page Suivi, bloc d'accueil d'une fiche, cadre de Réglages). **Les blocs « Contacts », « Tâches » et « Journal » (journal des échanges) des pages Suivi, Artistes et Structures sont des sections principales** [Q32]. Son titre : `<h2>` si c'est un groupe de blocs, sinon `<h3 class="panel-title">` (18 px, `--brand`).
- *Sous-section* = un intertitre **à l'intérieur** d'une section principale (liste, tableau, groupe de champs) : `.block-title` (13 px, 700, `--muted`).
- [CORRECTION] Suivi, Projets et Structures utilisent `.block-title` (petit gris) comme titre de leurs blocs principaux (« Contacts », « Tâches », « Journal des échanges »…) ; Réglages est conforme.
- [CORRECTION] Variantes à supprimer : `.section-title` (1 usage), `.month`, `.group-head h2` → `<h2>` ; tailles 20 px (`.route-box .fold-head`), 26/30 px (`.day b`) ramenées à l'échelle [DÉCIDÉ Q30].

### 3.3 Textes secondaires (une classe par rôle) [NOUVELLE]
| Rôle | Classe officielle | Rendu |
|---|---|---|
| Aide sous un champ ou sous un bloc | `.help` | 12, `--muted` |
| Texte secondaire en ligne (date, compteur, précision) | `.muted` (+ `.small` 12 ou `.tiny` 11) | `--muted` |
| Sous-titre de page | `sub` de `viewHead()` | `--muted` |
| Sous-ligne dans une cellule | `<span class="sub">` dans un `td` | 13, `--muted`, bloc |
| Note à côté d'un titre | `.title-note` | 13, 400, `--muted` |
| Indication de dépôt de fichier | `.drop-hint` | 13, `--faint` |
| Libellé de champ | `.field > label` | 12, 600, `--muted` |
| Texte d'état | `.ok-txt`, `.warn-txt` | `--ok` / `--warn`, 600 |

Interdit : `style="font-size:…"` et `style="color:…"` dans le JS. [CORRECTION] Il n'existe pas de `.danger-txt` : à créer pour remplacer les `style="color:var(--danger)"` (production.js, budget.js, ticketing.js, forms.js).
Graisses autorisées : 400, 500, 600, 700 (800 réservé aux gros chiffres `.stat b`).

---

## 4. Largeurs de contenu [EN PLACE sauf mention]
| Élément | Largeur |
|---|---|
| Contenu principal (`main`) et en-tête (`.top-row`) | max 1560 px, centré, marges 24 px (12 px sur téléphone) |
| Pages publiques (`.fiche-main`) | max 820 px |
| Fenêtre standard (`dialog`) | min(760 px, 94vw) |
| Fenêtre large (`dialog.wide`) | min(1000 px, 96vw) |
| Fenêtre mail (`dialog.mail`) | min(1100 px, 96vw), hauteur min(94vh, 980 px) |
| Formulaires « clé / valeur » (`.kv-grid`, `.bt-form`) | max 520 px |
| Résumé de budget (`.budget-sum`) | max 720 px — [CORRECTION] cadre `.tbl-wrap` à 760 px : aligner à 720 |
Règle [NOUVELLE] : aucune largeur maximale en style inline (`style="max-width:…"`) ; créer ou réutiliser une classe.

---

## 5. Alignements et centrages
- [EN PLACE] Texte à gauche ; **montants et nombres alignés à droite** (`td.num`, `th.num`), avec `.num`.
- [EN PLACE] En-tête de page (`viewHead`) : titre à gauche, actions **à droite du titre** sur ordinateur (même sur plusieurs lignes), filtres en dessous.
- [EN PLACE] Champs modifiables dans un tableau (`cIn`, `cSel`, `cAc`, `dateInput`) : décalés de −9 px (padding 8 + bordure 1) pour que le texte s'aligne sur celui des cellules voisines (`styles.css` règles `td:not(.num) > …:first-child` et `td.num > …`). Ne pas recréer d'autre compensation.
  - [CORRECTION] `.budget-table` : `td` à 8 px de padding mais `th` à 10 px (décalage de 2 px) ; `.bt-tiers` (padding 0) reçoit quand même −9 px ; `.urg` dans `.due-cell` décalé de 1 px.
- [EN PLACE] Centrage réservé : écrans vides (`.empty`), cases à cocher seules, boutons-icônes.
- Contenu vertical d'une cellule : en haut (`vertical-align:top`), en-tête en bas.

---

## 6. Dimensions des champs et boutons

### 6.1 Hauteurs [EN PLACE]
| Jeton | Valeur | Usage unique |
|---|---|---|
| `--h` | 36 | bouton standard, champ de formulaire, sélecteur de filtre, recherche |
| `--h-sm` | 32 | champ dans une cellule de tableau |
| `--h-xs` | 28 | petit bouton `.btn.sm`, bouton-icône `.btn.icon.sm` |
| `--h-pill` | 26 | pastille cliquable |
Écran de connexion : 42 px (seule exception admise).
[CORRECTION] valeurs en dur à remplacer par le jeton : `.seg .btn` 32 → `--h-sm`, `.pop-actions .btn` 26 → `--h-pill`, `.rt-btn`/`.rt-bar select`/`.rt-link input` 30 → `--h-sm`.

### 6.2 Boutons — une seule famille `.btn` [EN PLACE]
| Variante | Classe | Usage |
|---|---|---|
| Standard | `.btn` | action secondaire |
| Principal | `.btn.primary` | **une** action principale par zone (Enregistrer, Nouvelle …) |
| Discret | `.btn.ghost` | action tertiaire, liens d'action dans une liste |
| Destructif | `.btn.danger` (souvent `.btn.icon.sm.ghost.danger` avec ✕) | supprimer |
| Petit | `.btn.sm` | dans un tableau, une liste, un bloc |
| Icône | `.btn.icon` / `.btn.icon.sm` | toujours avec `aria-label` |
| Activé (bascule) | `.btn.on` ou `aria-pressed="true"` | filtre, bouton à deux états |
| Fichier | `.btn.file-btn` + `input.file-input` | choisir un fichier |
Ordre des classes : `btn [sm] [variante]` (ex. `btn sm primary`). Interdit : redéfinir la taille ou les couleurs d'un `.btn` pour un écran donné. [CORRECTION] `.fp-btn` (fiche.css) et le bouton de l'export artiste recréent un bouton : à remplacer par `.btn`.

### 6.3 Champs [EN PLACE]
| Contexte | Rendu officiel |
|---|---|
| Formulaire (fenêtre, page publique) | `.field` > `label` + champ : hauteur `--h`, padding 0 10, bordure `--line`, rayon `--r` ; zone de texte min 84 px |
| Barre de filtres / recherche | `.sel`, `.search`, `.inp` (hauteur `--h`) |
| Cellule de tableau | champ transparent, bordure visible au survol, `--h-sm` (via `cIn` / `cSel`) |
| Nombre dans un tableau | aligné à droite, 90 px (`.narrow` 72 px, `.narrow2`) |
[CORRECTION] Une quinzaine de règles redéfinissent un « champ bordé » (`.steps input`, `.link-row input`, `.sel-wrap select`, `.kv-grid input` avec 5 `!important`, `.vf-table input` ×2, `fiche.css .fiche-grid`…). Sur les pages publiques, `.field input` (très spécifique) annule le padding et la **bordure rouge d'erreur** de `fiche.css` : l'erreur n'est visible que par l'anneau.

---

## 7. Bordures, rayons, ombres [EN PLACE]
- Bordure standard : 1 px `--line` ; séparateur interne : 1 px `--line-2`.
- Rayons : `--r-sm` 6 (petit bouton, champ de cellule) · `--r` 8 (champ, bouton, menu de suggestions, toast) · `--r-lg` 12 (panneau, tableau, fenêtre, menu) · **999 px** pour toute pastille (seule valeur en dur admise).
- Ombres : `--shadow` (panneaux, tableaux) · `--shadow-pop` (menus, listes flottantes, fenêtres).
- [CORRECTION] valeurs en dur : rayons 10/4/3/2 px, ombres de `dialog` (`rgba(0,0,0,.28)`) et `.tag-dd-list`, bordure `#CBD6E8` (×3).

---

## 8. Grilles et tableaux

### 8.1 Panneaux et grilles [EN PLACE]
- Cadre standard : `.panel` (+ `.pad` pour le padding 16/18) ; tableau : `.tbl-wrap` > `table`.
- Grille de cartes : `.grid-cards` (`minmax(340px, 1fr)`).
- Mise en page deux colonnes : passe en une colonne à ≤ 1100 px.
[NOUVELLE] Interdit : `grid-template-columns` en style inline. [CORRECTION] `settings.js` (`minmax(360px…)` inline), `projects.js:138` (`.log-form` inline qui bloque la version téléphone), ratios de colonnes tous différents (1.15/1, 1.6/1, 1.2/1, 1/1.4).
**Proportions [DÉCIDÉ Q34]** : deux proportions privilégiées pour une mise en page à deux colonnes — **50/50** (`1fr 1fr`) et **66/33** (`2fr 1fr`, ou `1fr 2fr` si la colonne étroite est à gauche). Exception admise seulement si le contenu ou l'affichage l'impose (ex. colonne de libellés de largeur fixe, carte), avec la raison en commentaire dans le CSS.

### 8.2 Tableaux [EN PLACE]
- `table` : cellules 8/10 px, séparateur `--line-2`, en-tête collant (`th` : fond `--soft`, 12 px, 600, `--muted`).
- Montants : `td.num` / `th.num`. Ligne cliquable : `tr.click` (survol sur les cellules).
- Ligne de total : `tr.bill-total` (fond `--soft`, gras) — [NOUVELLE] seule classe de total ; [CORRECTION] `.total-row` et `tr.t` (export) font la même chose.
- Intertitre dans un tableau : `tr.cat-row` (fond `--soft`, 13 px).
- États de ligne : `is-paid` (payé), `has-doc` (pièce reçue, non payée), `task-done`, `leaving` (en cours de disparition, 5 s), `just-added`, `budget-over`.
- Tableau vide : une ligne `<td colspan class="empty">` ou `<div class="empty panel">`.
- Liste longue : au-delà de 300 lignes, afficher les 300 premières **avec** la phrase « 300 premiers résultats affichés — affine la recherche. » [NOUVELLE] (déjà le cas Structures/Contacts ; [CORRECTION] Suivi coupe à 500 sans message).
- [CORRECTION] Classes utilisées sans style : `.prod-table`, `.bill-total.ok`, `.bill-total.warn`.

### 8.3 Tableaux sur tablette/téléphone [EN PLACE]
`render()` (`js/app.js`) ajoute `.cards` et `data-label` : en dessous du seuil des fiches (§11.1 : **≤ 1023 px** [DÉCIDÉ Q35] ; aujourd'hui ≤ 1024 px), chaque ligne devient une fiche. [CORRECTION] les libellés se décalent après une cellule `colspan` ; les `tfoot` et les tableaux rendus hors `render()` (fenêtres) ne sont pas convertis.

---

## 9. Composants officiels (à réutiliser, jamais à recréer)
| Besoin | Composant officiel | Fichier |
|---|---|---|
| En-tête de page | `viewHead(title, {sub, filters, actions})` | `js/ui/bits.js` |
| Onglets d'une page | `tabsBar(key, tabs)` + `curTab()` (classes `.subtabs`, `.subtab`) | `js/ui/bits.js` |
| Section repliable | `fold(key, title, inner, {open, count})` | `js/ui/bits.js` |
| Filtres année / artistes | `filterBar()`, `projPicker()`, `inactiveToggle()` | `js/ui/bits.js`, `js/ui/projpicker.js` |
| Pastilles de statut / pôle / tag | `stBadge`, `stSelect`, `pstBadge`, `deptBadge`, `tag`, `projTag` | `js/ui/bits.js` |
| Champ modifiable dans un tableau | `cIn`, `cSel`, `cChk`, `cAc`, `cUrl`, `projChips` | `js/ui/cells.js` |
| Fenêtre de formulaire | `openModal({title, fields, values, onSave, onDelete, deleteAsk, …})`, `field()` | `js/ui/modal.js` |
| Fenêtre de dialogue (§9.1, Q20) — partout depuis la v1.48 | `ask({title, text, actions, cancel})` → valeur ou `null` ; `confirmAsk(titre, texte, action, {danger})` → booléen ; `askText({title, label, type, check…})` → texte ou `null` (mot de passe masqué) ; `inform({title, text, value})` ; `copyText(texte, message, titre)` | `js/ui/dialog.js` |
| Erreur sous un champ (§9.1, Q23) — en place v1.48 dans la fenêtre de saisie | `<p class="help err">` sous le champ + classe `bad` sur le champ (texte et bordure `--danger`) | `css/styles.css` |
| Date | `dateInput(value, attrs)` | `js/ui/datefield.js` |
| Nombre (virgule) | automatique sur tout `input[type=number]` | `js/ui/numfield.js` |
| Recherche avec suggestions | `acInput(kind, opts)` / `cAc` | `js/ui/autocomplete.js` |
| Choix d'artistes (ligne) | `projChips` + `ui/projmenu.js` | |
| Étiquettes | `ui/tagpicker.js` | |
| Texte enrichi | `ui/richtext.js` | |
| Zone de fichiers | `dropZone(owner)` + `fileRow(f)` | `js/ui/bits.js` |
| Message court | `toast(msg, err, action)` | `js/utils.js` |
| Zone de texte qui grandit | `autosize()` / `autosizeAll()` | `js/ui/modal.js` |
Pages publiques : `ui/dropfiles.js`, `ui/filepick.js`, `ui/autogrow.js` [EN PLACE]. [CORRECTION] elles n'utilisent ni `dateInput`, ni `numfield`, ni `toast` (copies locales `note()`), ni `field()`.

Menus et listes flottantes [NOUVELLE] : style unique = fond `--panel`, bordure `--line`, rayon `--r-lg` (menus) ou `--r` (suggestions), ombre `--shadow-pop`, élément actif `--brand-tint`. [CORRECTION] `.tag-dd-list` et `.rt-pop` dérogent.
Pastilles [NOUVELLE] : affichage = `.badge` (+ variante) ; filtre cliquable = `.tag-chip` (actif `.on`) ; choix multiple dans un formulaire = `.pills`. [CORRECTION] `.chip-btn`, `.tp-opt` (identique à `.tag-chip`), `.ok-badge`/`.warn-badge` (sans bordure) dupliquent `.badge`.
Dépliage [NOUVELLE] : `fold()` pour une section ; `<details>` stylé uniquement pour un menu (`.tag-dd`). [CORRECTION] `details.mt` sans style (employees.js), `.pp-toggle` à flèche texte. Dates passées d'une fiche artiste ou structure : section `fold()` fermée par défaut, titre « Dates passées » + compteur [DÉCIDÉ Q28].

### 9.1 Composants décidés, à créer (n’existent pas encore — sauf la fenêtre de dialogue, en place partout depuis la v1.48 : `js/ui/dialog.js`)
| Besoin | Comportement obligatoire | Décision |
|---|---|---|
| **Fenêtre de dialogue** (confirmation, saisie, alerte, mot de passe) — remplace `alert`, `confirm`, `prompt` | Style des fenêtres (`dialog`, `--r-lg`, `--shadow-pop`) ; titre ; texte de l'action **et de ses conséquences** (« et ses 2 pièces jointes ») ; bouton d'action nommé (`.btn.danger` pour détruire, `.btn.primary` sinon) ; « Annuler » en `.btn` ; question à deux issues = deux boutons nommés + « Annuler ». **Annuler, Échap et clic à l'extérieur ne déclenchent jamais l'action.** Mot de passe : champ masqué. Focus initial sur le bouton le moins risqué. Plein écran sur téléphone (comme `dialog`). | Q20 |
| **Suppression différée** | Après confirmation : l'élément passe en attente de suppression **côté serveur** et disparaît de l'écran (classe `leaving`), toast « <Élément> supprimé — **Annuler** » pendant 5 s (`toast(msg, false, {label:'Annuler', fn})`) ; Annuler rétablit l'élément ; passé 5 s, la suppression est définitive même si la page est fermée (`CONVENTIONS.md` §4.4). | Q19 |
| **Réinitialiser les filtres** | Bouton `.btn.sm.ghost` « Réinitialiser les filtres », placé dans la zone `filters` de `viewHead`, visible seulement si au moins un filtre diffère de sa valeur par défaut ; toast « Filtres réinitialisés ». | Q27 |
| **Compte d'encaissement « Non renseigné »** | Valeur affichée en `.warn-txt` « Non renseigné » dans le sélecteur du compte ; à la mise en « réglée » d'une facture sans compte, la ligne est mise en évidence et une fenêtre (Q20) demande le compte. | Q6 |
| **Message d'erreur sous un champ** | `.help` en couleur `--danger` sous le champ + bordure `--danger` du champ (mail invalide, champ obligatoire). | Q23 |
| **Indicateur de version des scripts Google** | Dans Réglages › Google, une pastille par script : `.ok-badge` « À jour », `.warn-badge` « Mise à jour nécessaire », `.badge` « Impossible à vérifier ». | Q37 |
| **Lien direct d'une fiche** | Bouton `.btn.sm.ghost` « Copier le lien » dans les actions de `viewHead` des fiches artiste, structure, suivi et date ; toast « Lien copié ». | Q25 |

---

## 10. Interdits (sauf exception technique justifiée en commentaire)
1. `style="…"` dans le HTML généré par le JS. **Exceptions admises** : valeur calculée à l'exécution (variable `--c:` de couleur de statut/pôle, largeur en %, position de photo, styles inline d'un mail envoyé — `rtStyle()` — car les clients mail ignorent les classes).
2. Couleur, taille de police, rayon, ombre ou hauteur hors jetons / hors échelle.
3. Nouveau composant qui duplique un composant du §9 (nouveau type de bouton, de menu, de fenêtre, de pastille, de champ).
4. Nouvelle règle CSS ajoutée « en fin de fichier » qui en écrase une autre : **modifier la règle d'origine** dans sa section (`styles.css` est organisé en 17 sections, cf. sommaire en tête de fichier).
5. Fenêtres natives du navigateur (`alert`, `confirm`, `prompt`) [DÉCIDÉ Q20] — utiliser la fenêtre de dialogue de l'application (§9.1, `CONVENTIONS.md` §4.5).

---

## 11. Responsive

### 11.1 Points de rupture
[EN PLACE] utilisés aujourd'hui : 1100, 1024, 900, 761/760, 720 (styles.css) et 640 (fiche.css), + `pointer:coarse`.
Seuils officiels [DÉCIDÉ Q30, Q35] — les autres (900, 720, 640) sont ramenés à ceux-ci [CORRECTION] :
| Seuil | Rôle |
|---|---|
| ≤ 1100 px | grilles en une colonne, panneau latéral sous le contenu |
| ≤ 1023 px | tableaux transformés en fiches empilées |
| ≤ 760 px (téléphone) | en-tête compact, fenêtres plein écran, champs 16 px, marges 12 px |
| `pointer:coarse` (écran tactile) | cibles tactiles ≥ 40 px, pas de sélection ni de focus automatiques, calendrier natif |

**Tablettes en paysage [DÉCIDÉ Q35]** : de 1 024 à 1 100 px (iPad en paysage compris), les **tableaux classiques sont conservés** (pas de fiches). Ils doivent rester lisibles : aucune information coupée (pas de texte tronqué sans moyen de le lire, pas de colonne masquée) ; si le tableau est plus large que l'écran, **défilement horizontal** dans son cadre `.tbl-wrap` (`overflow:auto`), la page elle-même ne défile jamais horizontalement. [CORRECTION] aujourd'hui les fiches s'appliquent dès 1 024 px (`@media (max-width:1024px)`).
[NOUVELLE] Un nouveau code n'introduit aucun autre seuil.

### 11.2 Règles [EN PLACE]
- Téléphone : menus (notifications, compte) en position fixe sous l'en-tête, pleine largeur ; choix d'artiste en feuille du bas (`.pm-sheet`) ; fenêtres plein écran.
- Écran tactile : pas de `select()` automatique ni d'`autofocus` sur un champ (évite le clavier qui masque la liste).

### 11.3 [CORRECTION] défauts confirmés
- `.suivi-grid` reste en deux colonnes sur tablette/téléphone (règle à 1100 px annulée par une règle placée plus loin).
- `.log-form` du journal projet ne se replie pas (grille en style inline).
- Les règles ≤ 1024 de l'en-tête écrasent celles ≤ 760.
- `.view-head .search` garde 180–220 px sur téléphone ; `.near-form .search` 260 px.
- `.side` garde un défilement interne en tablette.
- `dialog.mail` à 96vw au lieu de 100vw sur téléphone.
- Boutons `.btn.sm` à 28 px au doigt (cible trop petite).

---

## 12. États visuels (une seule représentation par état)
| État | Rendu officiel | Statut |
|---|---|---|
| Normal | jetons de base | [EN PLACE] |
| Survol | bouton : bordure `--brand-2` ; ghost : fond `--soft` ; champ de cellule : bordure `--line` ; ligne cliquable : fond `--soft` | [EN PLACE] |
| Focus clavier | `outline: 2px solid --brand-2` (`:focus-visible`) ; champ de cellule : bordure `--brand-2` + fond `--panel` | [EN PLACE] |
| Filtre actif | **bleu plein** : fond `--brand`, texte `--brand-ink` (`.tag-chip.on`, `.pills` cochées, bouton de filtre appliqué) | [DÉCIDÉ Q33] |
| Élément sélectionné dans une liste | **bleu pâle** : fond `--brand-tint` (+ bordure `--brand-2` pour un bouton bascule) — `.ac-item.on`, `.pm-item` coché, `.btn.on` ; onglet actif : soulignement `--brand` | [DÉCIDÉ Q33] — [CORRECTION] vérifier chaque composant de sélection contre cette règle |
| Désactivé | `opacity:.5`, curseur par défaut, attribut `disabled` | [EN PLACE] |
| Erreur | bordure `--danger` + anneau ; message `toast(…, true)` (fond `--danger`) ; texte `.danger-txt` (à créer) | [NOUVELLE] — [CORRECTION] bordure invisible sur les pages publiques |
| Succès | `toast(msg)` ; ligne `is-paid` ; texte `.ok-txt` ; pastille `.ok-badge` | [EN PLACE] |
| Attention | `.warn-txt`, `.warn-badge`, ligne `has-doc`, valeur saisie à la place d'un calcul `.override` | [EN PLACE] |
| Chargement | bouton désactivé dont le texte devient « … en cours » ; `aria-busy="true"` ; écran de démarrage `.loading` | [EN PLACE] (pratique) — [NOUVELLE] obligatoire pour toute action > 1 s |
| Disparition différée | `leaving` (opacité 0,45, 5 s, bouton Annuler dans le toast) — terminer, clore, annuler **et supprimer** | [EN PLACE] (terminer/clore/annuler) — [DÉCIDÉ Q19] pour les suppressions |
| Échéance du jour | pastille `.urg.today`, fond `--today` (violet), texte blanc | [DÉCIDÉ Q31] |
| Retard | pastille `.urg.late`, fond `--danger`, texte blanc ; date en retard `.late-cell` (texte `--danger`) | [EN PLACE] — distinct de l'échéance du jour et des erreurs de saisie |
| Valeur non renseignée | texte « Non renseigné » en `.warn-txt` (jamais une valeur supposée) | [DÉCIDÉ Q6] |

---

## 13. Corrections futures nécessaires (récapitulatif, non faites)
1. Jetons morts : `--sp-*` inutilisés par les utilitaires, `--semi` et `--cond` sans effet.
2. ~140 tailles de police et ~470 marges/paddings en dur ; 27 couleurs hors palette ; 82 `style=` dans le JS (≈ 60 à convertir en classes).
3. Doublons CSS : `.side` ×4, `.prod-body` ×4, `.suivi-grid` ×2, `.vf-table input` ×2… ; classes sans usage trouvé dans le JS ni le HTML (à vérifier avant tout retrait, une classe pouvant être construite dynamiquement) : `.af-dl`, `.dept-filter`, `.fiche-line`, `.gm-list`, `.gm-row`, `.gm-search`, `.mail-btns`, `.mail-done`, `.prod-mails`, `.quick`, `.sr`.
4. Déclaration invalide : `.af-copy{font:600 11px/1 inherit}` (ignorée).
5. Pages publiques : titres 30/18 au lieu de 34/22, libellés 13 au lieu de 12, seuil 640.
6. Export artiste (`js/artist-export.js`) : palette et tableaux propres (`--b`, `--m`, `#e5e7eb`) au lieu des jetons.
7. Défauts responsive du §11.3 et alignements du §5.
8. Couleurs recopiées en JS : `booking.js` (statuts), `selectors.js` (`#8A94A6`), `actions.js`, `mail.js` (`#FFE9A8`).
9. Décisions à appliquer : jetons `--ok-tint`, `--warn-tint`, `--danger-tint`, `--today` (§1.3) ; titres des blocs principaux de Suivi, Projets et Structures (§3.2) ; proportions 50/50 et 66/33 (§8.1) ; seuils responsive et tableaux conservés de 1 024 à 1 100 px (§11) ; sélection bleu plein / bleu pâle (§12) ; composants du §9.1 (fenêtre de dialogue, suppression différée, réinitialisation des filtres, « Non renseigné », erreur sous un champ, indicateur de version, copie de lien).
