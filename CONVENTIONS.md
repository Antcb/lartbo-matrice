# CONVENTIONS.md — Règles fonctionnelles, métier et techniques

S'applique à l'application, aux pages publiques (`fiche.html`, `artiste.html`, `rh.html`), aux fonctions serveur (`supabase/functions/*`), à la base Supabase et aux scripts Google (`apps-script/*.gs`).

**Légende des marqueurs**
- **[EN PLACE]** convention déjà appliquée : à respecter.
- **[NOUVELLE]** convention définie ici, qui ne change pas le comportement actuel : obligatoire pour tout nouveau code.
- **[À VALIDER]** proposition d'arbitrage entre des pratiques contradictoires : **non applicable** tant qu'Anthony ne l'a pas validée. D'ici là : ne pas généraliser l'une des pratiques, ne pas en créer une nouvelle.
- **[CORRECTION]** écart actuel du code à corriger dans un chantier dédié (récapitulatif §10).

---

## 1. Dates et heures

### 1.1 Deux types de valeurs, jamais mélangés [EN PLACE]
| Type | Stockage | Exemples | Lecture |
|---|---|---|---|
| **Date simple** (jour, sans heure) | `date` Postgres, chaîne `AAAA-MM-JJ` en JS | `shows.date`, `tasks.deadline`, `show_payments.sent_at` / `paid_at` (type date malgré le suffixe `_at`), `budget_lines.paid_at`, `prospect_logs.date` | utilisée telle quelle, **jamais** convertie par `new Date(x)` sans heure (risque de décalage) |
| **Date avec heure** (horodatage) | `timestamptz` | `created_at`, `updated_at`, `tasks.done_at`, `prospects.mail_sent_at`, `shows.fiche_submitted_at`, `terms_validated_at` | toujours convertie en heure locale pour l'affichage |

### 1.2 Fuseau de référence
- [NOUVELLE] **Europe/Paris** est l'heure de référence de toute règle métier (« aujourd'hui », échéances, date d'un mail, date d'une facture).
- [EN PLACE] Dans le navigateur : `today()` (`js/utils.js`) donne le jour **local**. Toute « date du jour » s'obtient par `today()`, jamais par `new Date().toISOString().slice(0,10)` (jour UTC : la veille entre 0 h et 2 h).
- [NOUVELLE] Pour transformer un horodatage en date simple : passer l'horodatage **complet** à `fmtDate()` (qui convertit en heure locale) ; **interdit** : `.slice(0,10)` sur un horodatage.
- [EN PLACE] Fonctions serveur : seule `resume-suivi` utilise `timeZone:'Europe/Paris'`. [CORRECTION] `pennylane/index.ts` (`today`, `plusDays`) calcule en UTC : la date de devis/facture et `paid_at` par défaut peuvent tomber la veille.
- [EN PLACE] SQL : `current_date` (UTC) dans `generate_reminders`, sans effet pratique car la tâche tourne à 5 h UTC. [NOUVELLE] Toute nouvelle fonction SQL utilise `(now() at time zone 'Europe/Paris')::date`.
- [EN PLACE] Apps Script : `Utilities.formatDate(…, 'Europe/Paris', …)` aux endroits datés. [CORRECTION] `Code.gs` utilise aussi `new Date().getFullYear()` (fuseau du projet Apps Script, non versionné).

### 1.3 Affichage
| Besoin | Format | Fonction officielle | Statut |
|---|---|---|---|
| Date | `JJ/MM/AAAA` | `fmtDate(d)` (`fmtNum` pour une date simple) | [EN PLACE] |
| Date courte avec jour | `sam. 10/01` | `fmtShort(d)` | [EN PLACE] |
| Jour de la semaine | `samedi` | `fmtWeekday(d)` | [EN PLACE] |
| Période | `10 → 12/07` | `period(s)` | [EN PLACE] |
| Date longue | voir 1.4 | — | [À VALIDER] |
| Libellé d'une date de concert | `JJ/MM/AAAA · Lieu · Ville` | `showLabel(s)` (`js/selectors.js`) | [EN PLACE] |
**Interdit** : `split('-').reverse().join('/')`, `toLocaleDateString()` direct dans une vue, format ISO affiché à l'utilisateur. [CORRECTION] 10 recodages manuels (selectors, exports, budget, fiche, forms, autocomplete, employees, drafts, pennylane) et 3 `toLocaleDateString` dans les pages publiques.

### 1.4 Date longue [À VALIDER]
Pratiques actuelles : `contract.js` « samedi 1er mars 2027 » ; `prospection.js` « samedi 1 mars 2027 » ; SQL `fr_date` « Samedi 1er mars 2027 » (mails, fiche).
Proposition : **« samedi 1er mars 2027 »** (jour en minuscule, « 1er », mois en lettres) partout ; majuscule seulement en début de phrase, ajoutée par le modèle. Une seule fonction JS (à créer dans `utils.js`, `longDate`) et `fr_date` alignée.

### 1.5 Saisie et sélection
- [EN PLACE] Application : **toujours** `dateInput(value, attrs)` (`js/ui/datefield.js`) — saisie clavier `JJ/MM/AAAA` (ou `JJ/MM`, `JJMMAAAA`…) + calendrier ; couples début/fin gérés par le composant. Jamais d'`<input type=date>` écrit à la main.
- [EN PLACE] Écran tactile : le calendrier natif s'ouvre en touchant l'icône ; pas de sélection automatique du texte.
- [CORRECTION] Pages publiques (`rh.js`, `rh-fields.js`) : `<input type=date>` natifs. Salariés (`views/employees.js`) : dates tapées en ISO (`2026-09-12_25`) dans un champ libre.

### 1.6 Calculs de dates
- [EN PLACE] `addDays(d, n)` (`js/reminders.js`), `daysUntil(d)`, `daysBetween(a, b)` (`js/utils.js`), `workDay(d)` (`js/utils.js`) et `public.workday(d)` (SQL) : une échéance qui tombe un samedi ou un dimanche passe au **lundi suivant**.
- [EN PLACE] Facture de solde : jour ouvré le plus proche de J-7 **en reculant** (`soldeReminderDay`, même règle en SQL).
- [NOUVELLE] Interdit de recréer une fonction d'ajout de jours. [CORRECTION] copies : `contract.js` (addDays), `views/suivi.js` (addD, addY — `addY('2028-02-29',1)` donne une date inexistante), `forms.js` (inDays), `prospection.js` (calcul J+10 et J-2 à la main), `pennylane/index.ts` (plusDays, UTC).

---

## 2. Montants, nombres, pourcentages

### 2.1 Règles générales [EN PLACE]
- Tous les montants de la Matrice sont **HT**, sauf la billetterie du budget de production (TTC, signalé à l'écran).
- Salaires : **coût total employeur** (bulletin).
- Format français : espace pour les milliers, **virgule décimale**, symbole `€` après le montant.
- Saisie : tout `input[type=number]` est converti par `js/ui/numfield.js` (virgule acceptée et affichée ; nombre illisible refusé avec « Nombre illisible »). Ne pas écrire d'autre conversion.

### 2.2 Affichage des centimes [À VALIDER]
Aujourd'hui : `eur(n)` (sans centimes si le montant est rond) dans Booking, Projets, Suivi, Structures ; `eur2(n)` (toujours 2 décimales) dans Production et Budget. Le même cachet apparaît « 1 200 € » ou « 1 200,00 € ».
Proposition : **`eur2` pour tout montant comptable** (factures, paiements, budget, compte, exports, mails de facturation) ; **`eur` uniquement** pour les synthèses non comptables (cartes Booking, cachet indicatif d'un suivi). Interdit dans tous les cas : `toLocaleString(...)+' €'`, `toFixed` affiché, formatage local (`fiche.js` `eur`, `views/budget.js` `money`, `contract.js` `num`).

### 2.3 Arrondis [EN PLACE / CORRECTION]
- Règle : arrondi **au centime, à chaque montant calculé** (`Math.round(x*100)/100`), puis les totaux additionnent des montants déjà arrondis.
- [CORRECTION] La fonction `r2` est définie 6 fois (`calc.js`, `actions.js`, `budget.js`, `views/budget.js`, `confirm-flow.js`, `production-budget.js` — cette dernière transforme une valeur illisible en 0). Une seule doit subsister (à exporter depuis `js/utils.js`).

### 2.4 Pourcentages [EN PLACE]
- Stockés en **points** (15 = 15 %) : `show_payments.pct`, `shows.artbo_pct`, `partner_pct`, `vat_rate`, réglages `default_*`, `production.artbo_share`.
- Seul le taux de remplissage est un ratio 0–1 (calcul interne).
- [NOUVELLE] Affichage : `15 %` (espace insécable avant `%`), au plus 2 décimales sans zéro inutile (`33,33 %`, `5,5 %`). [CORRECTION] « 50% » sans espace dans `mail.js` et dans le SQL `mail_vars` (`acompte_pct`), valeur brute dans `fiche.js`.

### 2.5 Calculs financiers — fonctions officielles [EN PLACE]
| Calcul | Fonction | Fichier |
|---|---|---|
| Lignes de facturation d'une date (triées) | `paymentsOf(showId)` | `js/calc.js` |
| Montant HT d'une ligne (montant saisi, sinon % du cachet) | `payAmount(p)` | `js/calc.js` |
| TVA d'une ligne / TTC | `payVat(p)`, `ttc(ht, taux)`, `showVat(s)` (5,5 par défaut) | `js/calc.js` |
| Répartition acompte/solde | `billingOf(s)`, `billPct(p)` | `js/calc.js` |
| Commission d'une date | `commissionOf(s)`, `commissionAmount(s)` | `js/budget.js` |
| Budget d'une date | `showBudget(s)`, `lineForecast(l)`, `lineValue(l)`, `availableForArtist(s)` | `js/budget.js` |
| Compte dédié | `accountOf(projectId)`, `accountMoves(projectId)` | `js/budget.js` |
| Budget de production | `productionBudget(s, real)` | `js/production-budget.js` |
**Interdit** : recalculer un montant de facture, une commission ou un reste artiste ailleurs que par ces fonctions. Côté serveur, les recalculs existants sont listés au §8.4.

---

## 3. Formulaires

### 3.1 Présentation [EN PLACE]
- Création / modification complète : fenêtre `openModal({title, fields, values, onSave, onDelete})` (`js/ui/modal.js`) ; deux niveaux possibles (fenêtre sur fenêtre).
- Modification rapide : directement dans le tableau (`cIn`, `cSel`, `cAc`, `dateInput`), **enregistrée à la sortie du champ** (gestionnaire `change` global de `js/app.js` sur `data-t` / `data-id` / `data-f`).
- Effet de bord d'un champ : crochet `ACTIONS['change:table.champ']` (`js/actions.js`), jamais un écouteur `change` supplémentaire.
- Pages publiques : formulaires propres (`fiche-fields.js`, `rh-fields.js`, `artist-form.js`).

### 3.2 Champs obligatoires
- [EN PLACE] Pratique actuelle : contrôle dans `onSave` avec `toast('…', true)` et `return false` (la fenêtre reste ouverte).
- [NOUVELLE] Tout champ obligatoire : libellé suivi de `*`, contrôle dans `onSave` avec un message qui nomme le champ (« Indique le nom de la structure »). Jamais de `return false` sans message. [CORRECTION] `editProject` refuse un nom vide sans message.
- [CORRECTION] `rh-fields.js` marque des champs `req:true` respectés sur la page publique mais pas dans la fenêtre salarié de l'app.

### 3.3 Valeurs par défaut
Règle [NOUVELLE] : une valeur par défaut est lue **à un seul endroit** — un réglage (`setting('…')`) ou une constante de `js/constants.js` — jamais un nombre écrit dans une vue, une action ou une fonction serveur. Les priorités métier sont au §6.2.

### 3.4 Validation [À VALIDER]
Aujourd'hui : mails validés par la bulle native du navigateur (fenêtre contact), pas du tout (tableau des membres, `fiche.js`, `rh.js`), en français (`artiste.js`), ou **déplacés en silence** par le trigger `contacts_clean` (mail invalide → notes).
Proposition : un contrôle client unique (mail, téléphone, URL, nombre) avec message en français sous le champ (`.help` en `--danger`), appliqué dans l'app et les pages publiques ; le trigger SQL reste un filet de sécurité et toute correction automatique est signalée dans un toast.

### 3.5 Enregistrement et annulation [EN PLACE]
- `save(table, id, patch)` (`js/data.js`) : mise à jour immédiate à l'écran, retour à l'ancienne valeur et message si Supabase refuse.
- Fenêtre : « Enregistrer » / « Annuler » ; fermer sans enregistrer conserve un brouillon (`js/ui/drafts.js`) restauré à la réouverture.
- [CORRECTION] Clé de brouillon = titre de la fenêtre + id : toutes les « Nouvelle tâche » partagent le même brouillon (peut écraser le pré-remplissage d'une autre structure) ; renommer un lieu rend son brouillon orphelin. Trois mécanismes de brouillon coexistent (drafts.js, journal de suivi `logdraft.*`, pages publiques).

### 3.6 Messages d'erreur [NOUVELLE]
- Toujours en français, avec ce qui n'a pas marché et quoi faire : « Enregistrement impossible : … », « Le script Google n'est pas à jour : Réglages › Google… ».
- **Jamais** de message brut de Supabase, Postgres, Pennylane ou Apps Script seul, et **jamais** sur une page publique (organisateur, artiste, salarié). [CORRECTION] `fiche.js`, `rh.js`, `artiste.js`, `views/settings.js`, `syncLinks`, `actions.js`.
- Erreur silencieuse interdite : toute écriture qui échoue doit produire un message (`toast(…, true)`). [CORRECTION] `removeWhere`, suppression de liens dans `syncLinks`, `refreshFor`.

---

## 4. Actions

### 4.1 Création [EN PLACE]
- `insert(table, values)` (`js/data.js`) ; après création depuis une page (structure, projet, suivi), la nouvelle ligne est **visible et mise en évidence** sans recharger.
- Une seule voie de création par entité. [CORRECTION] deux voies pour un suivi (`newSuivi` et la branche inaccessible de `editProspect`), deux formulaires de contact (complet / rapide sans structures).

### 4.2 Modification [EN PLACE]
Voir §3.1 et §3.5. [NOUVELLE] **Un même champ produit le même effet quel que soit l'endroit où on le modifie** (tableau, fenêtre, conditions, page dédiée). Les effets de bord sont portés par le crochet `change:table.champ` **et** appelés par les fenêtres. [CORRECTION] cachet (`fee_ht`) : remise à zéro des montants saisis seulement depuis le tableau ; statut de suivi : Annuler et relances restaurées seulement depuis le sélecteur.

### 4.3 Terminer, clore, annuler une date — annulation pendant 5 secondes
- [EN PLACE] `saveLinger(table, id, patch, message, {after, onUndo})` : l'élément reste visible 5 s (`LINGER_MS`), toast avec bouton **Annuler**. Utilisé pour : cocher une tâche, clore un suivi depuis son sélecteur, annuler une date.
- [NOUVELLE] Tout passage à un état « terminé / clos / annulé » (tâche Faite ou Annulée, suivi Clos ou Confirmé, date Annulée ou Sans Suite) passe par `saveLinger`, **depuis tous les chemins**, et remplit les champs associés (`tasks.done_at`). [CORRECTION] fenêtre de tâche (pas de `done_at`, pas d'Annuler), fenêtre de suivi, `closeNoAnswer`.

### 4.4 Suppression
- [EN PLACE] Suppression définitive après confirmation ; pas d'annulation possible.
- [NOUVELLE] Supprimer une ligne supprime **aussi** ses fichiers stockés (bucket `suivi`) et ses lignes liées sans cascade SQL ; même fonction depuis la liste et depuis la fenêtre. [CORRECTION] suivi supprimé depuis sa fenêtre (fichiers orphelins), tâche supprimée (fichiers des pièces jointes conservés), `deleteProject` et suppression d'une date (nettoyage client non vérifié).
- Fichiers Google Drive : **jamais supprimés** par la Matrice (cf. `CLAUDE.md` §3). Un remplacement met l'ancien à la corbeille Drive, seulement après choix explicite (« Remplacer l'ancien »).

### 4.5 Confirmation [À VALIDER]
Aujourd'hui : ~30 `confirm()` natifs, 5 `prompt()` (dont le **mot de passe**), 2 `alert()`, plus des fenêtres maison (`askConfirmation`, `askDuplicate`).
Proposition : une fenêtre de confirmation de l'application (composant à créer dans `js/ui/`, sur le modèle d'`openModal`) avec : texte de l'action, conséquence, bouton destructif `.btn.danger` explicite (« Supprimer la tâche ») et « Annuler » qui **annule toujours tout**. [CORRECTION] `forms.js` : le bouton « Annuler » d'un `confirm` signifie « supprimer seulement la tâche ».
D'ici la validation : un nouveau code peut utiliser `confirm()` pour une suppression, avec un texte qui nomme l'élément ; **jamais** `prompt()` ni `alert()`.

### 4.6 Fichiers associés [EN PLACE]
- Envoi : `uploadFiles(owner, files)` (`js/data.js`) → bucket `suivi`, chemin `dossier/horodatage_nom-nettoyé` ; ouverture : `openStored(path)` (lien temporaire).
- Zone de dépôt : `dropZone(owner)` ; glisser-déposer partout ailleurs : `js/ui/dropfiles.js`.
- Mail `.eml` déposé dans un suivi : pièce jointe + entrée « Mail » au journal (sans doublon).
- Pièces du budget : lues par l'IA (`lire-piece`), rangées dans `02_Finance` du dossier Drive de la date ; doublon → choix explicite.
- Nomenclatures Drive : tableau du `README.md` (à respecter à l'identique ; factures de vente : `F-AB-AAAA-MM-NN Client Acompte|Solde.pdf`).

### 4.7 Notifications [EN PLACE]
- Messages d'interface : `toast(msg)` (succès, 3 s), `toast(msg, true)` (erreur), `toast(msg, false, {label, fn})` (action : Annuler, Ouvrir).
- Rappels : table `notifications`, écrits par `generate_reminders` (tous les jours 5 h UTC), clé anti-doublon `règle:id:date`, récapitulatif par mail via Apps Script.
- [CORRECTION] Rapport de synchronisation Pennylane en `alert()`.

### 4.8 Navigation
- [EN PLACE] Changer d'onglet : `go(view)` (`js/app.js`) — remet à zéro les pages détail, mémorise la vue.
- [NOUVELLE] Toute action qui change d'écran passe par `go()` ou par une fonction d'ouverture dédiée (`openStructure`, `openSuivi`, `openProject`…) qui elle-même remet à zéro les autres pages détail. [CORRECTION] `openNotif`, `filterTag`, `newSuivi`, `editStructure`, `editProspect`, `popstate` modifient `S.view` directement.
- [EN PLACE] Retour : bouton « ← … » de la page et bouton retour du navigateur (`js/ui/history.js`). [CORRECTION] le retour navigateur ne passe pas par `cleanupDraft` (un nouveau suivi vide n'est pas supprimé).
- [À VALIDER] Adresses directes (`#structure/…`, `#suivi/…`) pour qu'une page détail survive au rechargement et puisse être partagée.
- Filtres mémorisés [À VALIDER] : aujourd'hui seuls année, artistes, inactifs et « Pour » de To Do survivent au rechargement ; « Tout afficher » de To Do efface aussi le filtre artistes des autres onglets.

---

## 5. Recherche, tri, filtres
- [EN PLACE] Correspondance : `matches(texte, recherche)` (`js/utils.js`) — tous les mots, sans accents, apostrophes et tirets ignorés (`norm`, `hayOf`). Interdit de recréer une normalisation. [CORRECTION] `tagpicker.js` a sa propre `norm`.
- [EN PLACE] Ordre des résultats d'une recherche par nom : d'abord ceux dont le nom **commence** par la saisie, puis ceux dont le nom la contient, puis les autres correspondances (ville, contacts, mails), puis ordre alphabétique.
- [NOUVELLE] Une entité se cherche **sur les mêmes champs** dans sa liste et dans ses champs de suggestion. [CORRECTION] l'autocomplétion des structures ne cherche pas les contacts/tags ; celle des contacts ni téléphones ni postes.
- [EN PLACE] Choix d'artistes : les plus utilisés d'abord (`byUsage`), puis alphabétique ; actifs avant inactifs.
- [EN PLACE] Barre de recherche : un clic sélectionne tout le texte (ordinateur uniquement).
- Tris par défaut [EN PLACE] : dates de concert croissantes (sans date à la fin) dans Booking/Production ; suivis par dernier échange décroissant ; tâches par échéance (`taskSort`) ; tâches terminées par `done_at` décroissant ; lignes de budget par catégorie (`BUDGET_CATS`) puis ordre d'ajout. [À VALIDER] pages Structure et Projet : dates décroissantes (contraire de Booking).
- Exports [CORRECTION] : `exportShows` n'accepte qu'un artiste alors que l'écran en filtre plusieurs ; `exportSuivis` écrit les statuts en anglais.

---

## 6. Règles métier

### 6.1 Sources de vérité [EN PLACE]
| Domaine | Source | Lecture dans le code |
|---|---|---|
| Paramètres et valeurs par défaut | Réglages (table `settings`) | `setting('clé')` |
| Dépenses réelles des tournées | COST€ (budget Excel de l'artiste) | import / saisie dans `budget_lines.amount` |
| Factures (numéro, montant, payé) | Pennylane | synchronisation `pennylane` (action `sync`) |
| Fichiers | Google Drive | Apps Script `Code.gs` |
| Statuts, listes, libellés | `js/constants.js` + contraintes `CHECK` SQL | |
Réglages utilisés : `default_artbo_pct_booking`, `default_artbo_pct_production`, `default_artbo_pct` (ancien), `default_acompte_pct`, `default_solde_pct`, `default_cnm_pct`, `movinmotion_payslip_cost`, `departments`, `budget_template`, `contract_template_cc/cr`, dossiers Drive (`finance_folder_id`, `artist_template_folder_id`…), scripts (`drive_webhook_url`, `prospect_script_url`), signatures.

### 6.2 Priorité des valeurs par défaut
[NOUVELLE] Ordre général : **valeur saisie sur la ligne > valeur de la date > valeur du projet (artiste) > Réglages**. Une constante écrite dans le code n'est admise qu'en dernier recours **et** égale à la valeur par défaut du réglage.

### 6.3 Commission L'ArtBo [À VALIDER]
Pratiques actuelles : ligne `show_payments` de type `artbo` (montant ou %) → sinon `shows.artbo_pct` → sinon **15 en dur** (`budget.js`, `pennylane/index.ts`) ; à la création : `projects.default_artbo_pct` → réglage par mode (`defaultCommission(mode)` : booking 15, production 20) ; `payAmount` → 0 si aucun % ; SQL `schema.sql` → ancien réglage `default_artbo_pct`.
Proposition : ligne `artbo` > `shows.artbo_pct` > `projects.default_artbo_pct` > réglage `default_artbo_pct_booking|production` selon le mode de la date ; suppression des 15 / 0 en dur et de l'ancien réglage. En production, la commission est virée depuis le compte de l'artiste (pas de facture, pas de TVA) ; en booking, facturée à la structure administrative de l'artiste (TVA 20 %).

### 6.4 Acompte et solde [À VALIDER]
Pratiques actuelles : SQL `ensure_production_payments` crée acompte = réglage (50 si vide) + solde = 100 − acomptes (« pas d'acompte » conservé si un solde existe seul) ; Réglages affichent `?? 0` ; « Valider les conditions » force **50 si le réglage vaut 0** ; `on_show_confirmed` utilise un autre défaut (20) pour le solde.
Proposition : le réglage `default_acompte_pct` est utilisé **tel quel, y compris 0** ; 50 uniquement s'il est absent ; le solde est toujours 100 − somme des acomptes, recalculé à chaque modification (client) et à la création (SQL).
Facturation [EN PLACE] : acompte et solde se font **depuis le devis Pennylane** (bouton « Facturer depuis le devis ») ; la synchronisation reconnaît les factures par devis + montant HT et range le PDF dans le Drive.

### 6.5 Cachet [EN PLACE]
`shows.fee_ht`, HT, TVA de la date `shows.vat_rate` (5,5 % par défaut). [À VALIDER] Effet d'une modification du cachet sur les montants de facture saisis à la main (aujourd'hui remis à zéro uniquement depuis le tableau Production) : proposition — remise à zéro des lignes **non envoyées** quel que soit l'endroit, avec un toast qui le dit.

### 6.6 Booking ou production [À VALIDER]
Pratiques : `shows.prod_mode` suit `projects.mode` sauf si `prod_mode_manual` (triggers SQL) ; `isProdShow` (`budget.js`) traite une valeur vide comme **production** ; `isBookingOnly` (`mail.js`) la traite selon le **mode du projet** ; « production propre » (`Production` / `Co-Production`) testée par 4 expressions différentes.
Proposition : `prod_mode` n'est jamais vide (trigger `shows_defaults` déjà en place à la création) ; une seule fonction JS `isBookingShow(s)` et une seule `isOwnProduction(s)`.
Rappel métier : en booking, L'ArtBo envoie la confirmation puis facture sa commission ; pas de budget, pas d'acompte/solde, pas de compte dédié.

### 6.7 Rappels et relances
[EN PLACE] Règles de production (`js/reminders.js` = affichage en rouge ; `generate_reminders` = notifications) : J+10 après « Conf + FT + kit », « Pré-contrat complété », « Contrat envoyé », « Contrat signé » ; J+10 après envoi d'une facture impayée ; jour ouvré ≤ J-7 pour envoyer le solde ; J+10 après le premier encaissement pour la commission ; J-4 mois boucle technique. **Toute échéance J+10 un samedi/dimanche passe au lundi.**
[EN PLACE] Prospection : relance mail à J+10 (jour ouvré) après l'envoi réel, trois relances mail puis une tâche de relance téléphone ; un suivi Clos ou Confirmé n'a plus de relance (`cancelAutoRelances`).
[À VALIDER] Écarts app ↔ serveur : J-122 (app) contre J-4 mois (serveur) ; dates de plus de 120 jours exclues côté serveur seulement ; premier encaissement parmi **toutes** les lignes (app) contre premier acompte/solde (serveur). Proposition : J-4 mois, fenêtre de 120 jours et « premier encaissement toutes lignes » des deux côtés.
[À VALIDER] Le délai de 10 jours est écrit 4 fois (`BOOKING_DAYS`, `RELANCE_DAYS`, `plus10`, SQL) : proposition d'un réglage unique `relance_days`.

### 6.8 Statuts [EN PLACE]
| Entité | Codes stockés | Libellés affichés |
|---|---|---|
| Date (`shows.status`) | français (`Intérêt Salle`… `Sans Suite`), contrainte `CHECK` | identiques ; couleurs `STATUS_COLOR` |
| Suivi (`prospects.status`) | `Mailed`, `Interest`, `Option`, `Confirmed`, `Closed` | `PROSPECT_LABEL` (Mail envoyé, Intérêt…) |
| Tâche (`tasks.status`) | `To Do`, `In Progress`, `Done`, `Cancelled` | `TASK_STATUS_OPTS` (À faire…) |
| Priorité | `D-Day`… `Low` | `PRIORITY_LABEL` |
[NOUVELLE] Les codes stockés ne changent jamais ; l'utilisateur ne voit **que** les libellés (y compris dans les exports). Ajout d'un statut = constante JS + contrainte `CHECK` SQL dans la même version.
[À VALIDER] Pôles : le nom « Booking » est utilisé comme identifiant (`/^booking$/i`, `department:'Booking'`) ; le renommer dans Réglages casse l'échéance J+10 et les relances. Proposition : un identifiant fixe par pôle, distinct du nom affiché.

---

## 7. Supabase

### 7.1 Nommage [EN PLACE / NOUVELLE]
- Tables : anglais, `snake_case`, pluriel (`shows`, `show_payments`, `budget_lines`). Colonnes : `snake_case` ; clé étrangère `<entité>_id` ; tableau de clés `<entité>_ids` ; jeton public `*_token`.
- [EN PLACE] Le suffixe `_at` désigne aujourd'hui **soit** une date (`show_payments.paid_at`) **soit** un horodatage (`tasks.done_at`) : toujours vérifier le type. [NOUVELLE] Nouvelles colonnes : `timestamptz` → suffixe `_at` ; `date` → nom sans `_at` (`deadline`, `date_start`) ou suffixe `_on`. Aucun renommage de l'existant sans validation.
- [NOUVELLE] Tables techniques temporaires : préfixe `_` et suppression prévue dans la même version. [CORRECTION] `_probe`, `_folder_jobs`, `_koza_job`, `_lartbotrice_job` et fonctions `_koza_tick`, `_lartbotrice_tick`, `_folder_tick`, `_push`, `_push_table`, `_export_ddl*` restent en base.

### 7.2 Relations et contraintes
- [EN PLACE] Clés étrangères avec `ON DELETE CASCADE` pour les lignes dépendantes (paiements, journaux, fichiers de suivi, lignes de budget) et `SET NULL` pour les rattachements (structure, contact, artiste).
- [NOUVELLE] Toute nouvelle colonne `*_id` a sa clé étrangère et son index. [CORRECTION] sans clé étrangère : `structure_events.structure_id`, `project_members.project_id`, `project_logs.project_id`, `attachments.*_id`, `notifications.*_id`, `projects.admin_structure_id`, `shows.prospect_id`, `prospects.mail_log_id` (aucune donnée orpheline au 21/10/2026, mais rien ne l'empêche).
- [EN PLACE] `project_id` et `project_ids` coexistent sur `tasks` et `prospects` (lecture : `projIds()`), cohérents au 21/10/2026 ; `shows` n'a que `project_id`.
- [CORRECTION] Champs en double : `projects.pennylane_customer_id` / `structures.pennylane_id` ; capacité et tarif sur `structures` **et** `structure_events` ; `shows.department/city` peuvent différer de la structure (76 / 165 dates, peut-être voulu pour un lieu différent du siège — à confirmer).
- [EN PLACE] Nettoyage automatique en base : `contacts_clean` (mails/téléphones), `structures_place_clean` (département vide hors France).

### 7.3 Sécurité et RLS [EN PLACE]
- Toutes les tables : RLS activé, politique `is_team()` (comptes de `app_users`) pour lecture et écriture.
- Pages publiques : uniquement via fonctions `SECURITY DEFINER` à jeton (`fiche_get/submit`, `artist_get/submit/token_ok`, `rh_get/submit/token_ok`) et dépôt de fichiers vérifié par jeton (buckets `artiste`, `rh`).
- [NOUVELLE] Toute nouvelle fonction : `SET search_path = public`, `revoke execute … from public, anon` sauf page publique justifiée. [CORRECTION] 14 fonctions sans `search_path` ; `pg_net` dans le schéma public ; protection des mots de passe compromis désactivée (Auth).

### 7.4 Secrets
- [EN PLACE] Clés Pennylane et IA : coffre privé (`private.import_secrets`), lues par `import_secret()` côté serveur, saisies par `set_pennylane_key` / `set_ai_key`.
- [NOUVELLE] Aucun nouveau secret dans `settings` ni dans le code.
- [CORRECTION] `brevo_api_key`, `brevo_hook_secret` et `drive_webhook_secret` sont dans `settings`, lisibles par le navigateur des comptes de l'équipe.
- La clé `anon` de `js/config.js` est publique par conception.

### 7.5 Migrations
- [EN PLACE] Un fichier par version : `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql`, rejouable (`if not exists`, `create or replace`).
- [NOUVELLE] Application par le mécanisme de migrations de Supabase (historique enregistré), en plusieurs morceaux si l'outil refuse un lot ; une migration = un numéro de version unique ; **interdit** : modifier une fonction par remplacement de texte dans son code (`pg_get_functiondef` + `replace`) — réécrire la fonction entière.
- [CORRECTION] 30 fichiers dans le dépôt, 13 seulement enregistrés dans l'historique Supabase ; numéros en double (v1.18, v1.26, v1.36) ; `supabase/schema.sql` décrit 13 tables sur 26 (à régénérer depuis la base).

### 7.6 Synchronisation des données [EN PLACE]
- Au démarrage : toutes les tables de `TABLES` (`js/state.js`) sont chargées en mémoire (`loadAll`), puis tenues à jour par le temps réel (`js/realtime.js`, un canal pour toutes les tables).
- Après une écriture qui déclenche un trigger (confirmation d'une date, changement de mode) : relire les lignes touchées avec `refreshFor(table, col, ids)` ou `refreshShowSide(showId)`.
- [NOUVELLE] Toute modification directe de `S.db[table]` est suivie de `touch(table)` (sinon les index en cache sont faux). Toute nouvelle table est ajoutée à `TABLES`, à la publication temps réel et à la sauvegarde (`backup-export`).

### 7.7 Erreurs [NOUVELLE]
Voir §3.6. Côté serveur (edge, Apps Script) : renvoyer `{ ok:false, error:'message français' }`, jamais une exception brute ; une intégration externe (Pennylane, Brevo, Drive, Gmail, IA) réessaie seule sur saturation (429/503) avec délai croissant et ne crée jamais deux fois le même objet (contrôle de doublon avant création).

---

## 8. Architecture

### 8.1 Organisation [EN PLACE]
Voir `README.md` « Organisation du code » et « Où modifier quoi ». Rendu complet par `render()` ; actions par `data-act` → `ACTIONS` (`js/actions.js`), `BUDGET_ACTIONS` (`js/budget-actions.js`), `EMP_ACTIONS` ; données par `js/data.js` ; lectures en cache par `js/selectors.js` (`cached` + `S.rev`).

### 8.2 Réutilisation — fonctions officielles [EN PLACE]
| Besoin | Fonction | Fichier |
|---|---|---|
| Échapper du texte dans du HTML | `esc` | `js/utils.js` |
| HTML enrichi venant de l'utilisateur | `safeHtml` | `js/utils.js` |
| Message | `toast` | `js/utils.js` |
| Dates | `today`, `fmtDate`, `fmtShort`, `fmtWeekday`, `fmtNum`, `period`, `daysUntil`, `daysBetween`, `workDay` ; `addDays` (`js/reminders.js`) | |
| Montants | `eur`, `eur2` | `js/utils.js` |
| Recherche | `norm`, `hayOf`, `matches` | `js/utils.js` |
| Prénom pour un mail | `firstName` | `js/utils.js` |
| Lien | `url` | `js/utils.js` |
| CSV | `downloadCSV`, `parseCSV` | `js/utils.js` |
| Réglage | `setting(k)` | `js/selectors.js` |
| Lectures | `byId`, `projIds`, `projNames`, `linksOfStructure`, `paymentsOf`… | `js/selectors.js`, `js/calc.js` |
| Écritures | `save`, `saveLinger`, `insert`, `remove`, `removeWhere`, `refreshFor`, `uploadFiles`, `openStored` | `js/data.js` |
| Script Google production@ | `callScript(action, payload)` | `js/mail.js` |
| Script Google anthony@ (prospection) | `callProspect(action, payload)` | `js/prospection.js` |
| Fonctions serveur | `sb.functions.invoke(nom, {body, headers:{'x-region':'eu-west-3'}})` | |

### 8.3 Dépendances [NOUVELLE]
- Aucun nouvel import circulaire. Une couche basse (`data.js`, `selectors.js`, `utils.js`, `calc.js`, `budget.js`, `ui/*`) n'importe **jamais** une vue (`views/*`), `actions.js` ou `forms.js`.
- Une vue n'importe pas une autre vue pour réutiliser un fragment : le fragment va dans `ui/` ou dans un module métier.
- Pas d'import dynamique pour contourner un cycle.
- Pages publiques : importent `js/utils.js` plutôt que de recopier `esc`, `eur`, `toast`.
- [CORRECTION] Aujourd'hui : un cycle de 41 modules (cause principale : `render` importé depuis `app.js` par `data.js`, `commission.js`, `budget-template.js`, `ui/modal.js`, `ui/projmenu.js`) ; `forms.js` importe `views/production.js` ; `views/projects.js` importe `views/structures.js` et `views/todo.js` ; `actions.js` importe 4 vues ; `app.js` appelle `toast` sans l'importer (ligne du gestionnaire `change`).

### 8.4 Cohérence JS ↔ SQL ↔ fonctions serveur ↔ Apps Script
[NOUVELLE] Une règle présente des deux côtés est modifiée **dans la même version** des deux côtés, et le commentaire de chaque côté cite l'autre. Liste des doublons connus :
| Règle | JS | Autre côté |
|---|---|---|
| Rappels de production | `js/reminders.js` | SQL `generate_reminders` |
| Jour ouvré | `workDay` | SQL `workday` |
| Montant HT d'une ligne | `payAmount` | vue `show_payments_computed`, `fiche_get`, `pennylane/index.ts` |
| Acompte / solde par défaut | `rebalanceSolde`, `confirm-flow.js`, `views/settings.js` | SQL `ensure_production_payments`, `on_show_confirmed` |
| Ligne Movinmotion | `budget-template.js`, `syncMovinmotionLine` | SQL `ensure_movinmotion` |
| Date longue, euros | `contract.js`, `prospection.js`, `eur` | SQL `fr_date`, `fr_eur` |
| Prénom de contact | `firstName` | SQL `contact_first_name` |
| Choix et remplissage des modèles de mail | `js/mail.js` | `apps-script/Code.gs` (`applies_`, `pickTemplate_`, `fill_`) |
| Nom du lieu sans code, département | `contract.js` (`deptOf`) | `Code.gs` (`dept_`, `cpDept_`, regex du lieu) ; SQL `mail_vars` (regex différente) |
| Nom du fichier de contrat | `contract.js` | `Code.gs` `contractName_` |
| Exercice comptable (oct. → sept.) | `views/projects.js` `fiscalYear` | `Code.gs` `financeYear_` |
| Encodage des mails Gmail | — | `Code.gs` ≈ `Prospection.gs` |

### 8.5 Interdiction des duplications [NOUVELLE]
Avant d'écrire une fonction utilitaire : chercher (`grep`) si elle existe. Une fonction utile à plusieurs modules va dans `js/utils.js` (sans dépendance) ou dans le module métier concerné, puis est importée.
[CORRECTION] Doublons à résorber : `r2` ×6, `num` ×3, `addDays` et équivalents ×7, `esc`/`toast` ×4 (pages publiques), `safeName` ×2, `callScript`/`callProspect`, deux implémentations de hauteur automatique (`ui/modal.js`, `ui/autogrow.js`), `projmenu` ≈ `projpicker`, `isOwnProd` ×2 dans `budget.js`, listes `LOG_KINDS` recopiées.

### 8.6 Scripts Google
- [EN PLACE] Le code est dans `apps-script/` ; Anthony le recopie dans l'éditeur Apps Script et redéploie (Réglages › Google › « Copier le code à jour »). Une action inconnue du script déployé produit le message « Le script Google … n'est pas à jour ».
- [NOUVELLE] Toute nouvelle action du script est tolérante à l'ancien script (message clair, pas de plantage) et signalée dans le compte rendu.
- [À VALIDER] Afficher dans Réglages la version du script déployé (action `ping` renvoyant un numéro) pour savoir si la mise à jour a été faite.

---

## 9. Tests [NOUVELLE]
- Avant chaque mise en ligne : tests automatisés de l'interface (Playwright, données simulées) couvrant les écrans touchés + `QA_CHECKLIST.md`.
- [CORRECTION] Les scripts de test existent seulement dans l'espace de travail temporaire de la session (non versionnés) : à installer dans le dépôt (`tests/`) avec un serveur simulé de Supabase (`mock-supabase.js`) et une commande unique — [À VALIDER] emplacement et outil.

---

## 10. Récapitulatif des corrections futures (non faites)
1. Dates : jour UTC dans Pennylane et `data.js` (.eml), `.slice(0,10)` sur horodatages (~20 endroits), 10 formats manuels, 7 copies d'ajout de jours, `addY` (29 février), saisie ISO des salariés, `<input type=date>` des pages publiques.
2. Montants : `r2` ×6, formats locaux (`fiche.js`, `contract.js`, `views/budget.js`), « 50% » sans espace.
3. Défauts : commission 15/0 en dur, acompte 0→50, payeur vide affiché « L'ArtBo » mais compté « compte dédié » (`production.js` / `budget.js`).
4. Actions : fin de tâche et clôture de suivi selon le chemin, suppression de suivi/tâche sans fichiers, `confirm` ambigu, `prompt` du mot de passe, `alert` Pennylane, erreurs brutes et silencieuses.
5. Navigation : changements de vue hors `go()`, retour navigateur sans nettoyage de brouillon.
6. Pôle « Booking » utilisé comme identifiant.
7. Supabase : clés étrangères manquantes, secrets dans `settings`, `search_path`, historique des migrations, `schema.sql` périmé, objets techniques restants.
8. Architecture : cycle d'imports, `toast` non importé dans `app.js`, doublons du §8.5, écarts JS ↔ SQL du §6.7 et §8.4.
9. Tests non versionnés.
