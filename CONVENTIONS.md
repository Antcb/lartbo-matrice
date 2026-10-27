# CONVENTIONS.md — Règles fonctionnelles, métier et techniques

S'applique à l'application, aux pages publiques (`fiche.html`, `artiste.html`, `rh.html`), aux fonctions serveur (`supabase/functions/*`), à la base Supabase et aux scripts Google (`apps-script/*.gs`).
Les décisions **Q0 à Q38** ont été arbitrées par Anthony le 21/10/2026 (document « Arbitrages du référentiel Matrice ») : elles sont **définitives** et remplacent toute proposition antérieure.

**Légende des marqueurs**
- **[EN PLACE]** règle déjà appliquée par le code : à respecter.
- **[NOUVELLE]** règle de développement qui ne change pas le comportement actuel : obligatoire pour tout nouveau code.
- **[DÉCIDÉ Qn]** règle arbitrée par Anthony (question n). Obligatoire. Si le code actuel ne la respecte pas encore, l'écart est listé en **[CORRECTION]** et récapitulé au §10 ; on ne le corrige que dans un chantier autorisé.
- **[CORRECTION]** écart actuel du code par rapport à une règle : à corriger, jamais à reproduire.

Toute règle ci-dessous qui n'est pas encore appliquée par le code **ne doit pas être présentée comme existante** : une fonction ou un réglage « à créer » est nommé comme tel.

---

## 1. Dates et heures

### 1.1 Deux types de valeurs, jamais mélangés [EN PLACE]
| Type | Stockage | Exemples | Règle |
|---|---|---|---|
| **Date simple** (jour, sans heure) | `date` Postgres, chaîne `AAAA-MM-JJ` en JS | `shows.date`, `tasks.deadline`, `show_payments.sent_at` / `paid_at` (type date malgré le suffixe `_at`), `budget_lines.paid_at`, `prospect_logs.date` | utilisée telle quelle ; jamais `new Date(x)` sans heure (décalage de fuseau) |
| **Date avec heure** (horodatage) | `timestamptz` | `created_at`, `updated_at`, `tasks.done_at`, `prospects.mail_sent_at`, `shows.fiche_submitted_at`, `terms_validated_at` | convertie en heure locale (Paris) pour l'affichage |

### 1.2 Fuseau de référence : Europe/Paris
- [NOUVELLE] **Europe/Paris** est l'heure de référence de toute règle métier : « aujourd'hui », échéances, date d'un mail, date d'une facture, date de réalisation d'une tâche.
- [EN PLACE] Navigateur : `today()` (`js/utils.js`) donne le jour local. Toute « date du jour » s'obtient par `today()`, **jamais** par `new Date().toISOString().slice(0,10)` (jour UTC : la veille entre 0 h et 2 h).
- [NOUVELLE] Pour afficher la date d'un horodatage : passer l'horodatage **complet** à `fmtDate()` ; **interdit** : `.slice(0,10)` sur un horodatage.
- [NOUVELLE] Fonctions serveur (edge) : dates calculées avec `timeZone:'Europe/Paris'` (comme `resume-suivi`). [CORRIGÉ v1.49] `pennylane/index.ts` (`today`, `plusDays`) au jour de Paris.
- [NOUVELLE] SQL : toute nouvelle fonction utilise `(now() at time zone 'Europe/Paris')::date`. [EN PLACE] `generate_reminders` utilise `current_date` (UTC) ; sans effet pratique car la tâche planifiée tourne à 5 h UTC.
- [EN PLACE] Apps Script : `Utilities.formatDate(…, 'Europe/Paris', …)` aux endroits datés. [CORRECTION] `Code.gs` utilise aussi `new Date().getFullYear()` (fuseau du projet Apps Script, non versionné).
- [CORRIGÉ v1.49] `today()` et `dayOf(horodatage)` (`js/utils.js`) donnent le jour **de Paris** même si l'ordinateur est réglé sur un autre fuseau ; `fmtDate` reçoit l'horodatage complet partout (notifications, « Faite le », envois, fiches) ; date d'un mail de prospection et de sa relance, date d'un `.eml` sans en-tête : jour de Paris. Pages publiques (`fiche`, `artiste`, `rh` : « envoyée le », date maximale), Réglages (acompte), export artiste et Excel, résumé IA : jour de Paris. `daysUntil` / `daysBetween` comptent depuis le jour de Paris, en jours de calendrier. Contrôle statique : aucune date du jour en UTC, aucun `.slice(0,10)` d'horodatage, aucun `new Date(…).toLocaleDateString('fr-FR' | 'sv-SE')` sans fuseau.

### 1.3 Affichage
| Besoin | Format | Fonction | Statut |
|---|---|---|---|
| Date | `JJ/MM/AAAA` | `fmtDate(d)` (`fmtNum` pour une date simple) | [EN PLACE] |
| Date courte avec jour | `sam. 10/01` | `fmtShort(d)` | [EN PLACE] |
| Jour de la semaine | `samedi` | `fmtWeekday(d)` | [EN PLACE] |
| Période | `10 → 12/07` | `period(s)` | [EN PLACE] |
| Libellé d'une date de concert | `JJ/MM/AAAA · Lieu · Ville` | `showLabel(s)` (`js/selectors.js`) | [EN PLACE] |
| Date longue | voir §1.4 | fonction unique à créer (`longDate` dans `js/utils.js`) + SQL `fr_date` aligné | [DÉCIDÉ Q21] |
**Interdit** : `split('-').reverse().join('/')`, `toLocaleDateString()` direct dans une vue, format ISO affiché à l'utilisateur. [CORRECTION] 10 recodages manuels (selectors, exports, budget, fiche, forms, autocomplete, employees, drafts, pennylane) et 3 `toLocaleDateString` dans les pages publiques.

### 1.4 Date longue [DÉCIDÉ Q21]
- Format : **jour de la semaine et mois en minuscules, « 1er » pour le premier jour du mois**, année en chiffres : `lundi 1er mars 2027`, `mardi 14 juillet 2026`.
- Majuscule **uniquement** quand la date commence une phrase (`Lundi 1er mars 2027, …`) : c'est le gabarit (modèle de mail, contrat) qui met la majuscule, pas la fonction.
- Le jour de la semaine est **toujours calculé** à partir de la date (jamais saisi ni recopié).
- Une seule fonction côté JS et la fonction SQL `fr_date` produisent exactement le même texte.
- [CORRECTION] Aujourd'hui : `contract.js` « lundi 1er mars 2027 » (conforme) ; `prospection.js` « lundi 1 mars 2027 » (sans « 1er ») ; SQL `fr_date` « Lundi 1er mars 2027 » (majuscule systématique) ; `exports.js` met une majuscule à la main.

### 1.5 Saisie et sélection [EN PLACE]
- Application : **toujours** `dateInput(value, attrs)` (`js/ui/datefield.js`) — saisie clavier (`JJ/MM/AAAA`, `JJ/MM`, `JJMMAAAA`…) + calendrier ; couples début/fin gérés par le composant. Jamais d'`<input type=date>` écrit à la main.
- Écran tactile : calendrier natif en touchant l'icône ; pas de sélection automatique du texte.
- [CORRECTION] Pages publiques (`rh.js`, `rh-fields.js`) : `<input type=date>` natifs. Salariés (`views/employees.js`) : dates tapées en ISO (`2026-09-12_25`).

### 1.6 Calculs de dates
- [EN PLACE] `addDays(d, n)` (`js/reminders.js`), `daysUntil`, `daysBetween`, `workDay` (`js/utils.js`) et `public.workday(d)` (SQL) : une échéance « J+n » qui tombe un samedi ou un dimanche passe au **lundi suivant**.
- [EN PLACE] Facture de solde : jour ouvré le plus proche de J-7 en **reculant** (`soldeReminderDay`, même règle en SQL).
- [DÉCIDÉ Q12] Boucle accueil & technique : **4 mois calendaires** avant le concert ; samedi ou dimanche → **vendredi précédent** ; même calcul dans l'interface (`js/reminders.js`) et dans `generate_reminders`. [CORRIGÉ v1.49] application (`addMonths` + `workDayBefore`) et serveur (`generate_reminders`, clé anti-doublon inchangée) identiques.
- [NOUVELLE] Interdit de recréer une fonction d'ajout de jours/mois. [CORRIGÉ v1.49] une seule fonction : `addDays`, `addMonths` (29/02 + 1 an → 28/02), `workDay`, `workDayBefore` (`js/utils.js`) ; `reminders.js` les reprend ; copies retirées (`contract.js`, `views/suivi.js`, `forms.js`, `prospection.js`). Côté serveur : `pennylane/index.ts` `plusDays` au jour de Paris.

---

## 2. Montants, nombres, pourcentages

### 2.1 Règles générales [EN PLACE]
- Tous les montants de la Matrice sont **HT**, sauf la billetterie du budget de production (TTC, signalé à l'écran). Salaires : **coût total employeur**.
- Format français : espace pour les milliers, **virgule décimale**, `€` après le montant.
- Saisie : tout `input[type=number]` est converti par `js/ui/numfield.js` (virgule acceptée et affichée ; saisie illisible refusée avec « Nombre illisible »). Aucune autre conversion.
- [DÉCIDÉ Q22] **La précision réelle n'est jamais perdue** : on stocke le montant exact saisi ou calculé (au centime) ; masquer des centimes est un choix d'affichage uniquement.

### 2.2 Affichage des centimes [DÉCIDÉ Q22]
| Contexte | Fonction | Exemple |
|---|---|---|
| **Comptable** : factures, lignes de paiement (acompte, solde, commission, partenaire, CNM, autre), budgets (lignes, résumé, résultat), compte dédié et ses mouvements, exports (xlsx/CSV/PDF), mails de facturation, contrats | `eur2(n)` — centimes **toujours** affichés | `1 200,00 €` |
| **Indicatif** : cartes et listes Booking, cachet affiché dans un suivi ou sur une fiche structure/artiste, statistiques de synthèse | `eur(n)` — centimes masqués **seulement s'ils valent zéro** | `1 200 €`, `1 200,50 €` |
**Interdit** : `toLocaleString(...)+' €'`, `toFixed` affiché, formatage local. [CORRIGÉ v1.49] `fiche.js` et `mail.js` utilisent `eur` / `eur2` ; message de commission partielle en `eur2`. [CORRECTION] restent : `contract.js` `num` (montants en lettres et chiffres des contrats, à revoir avec les modèles), vues comptables qui utilisent `eur` (écran par écran).

### 2.3 Arrondis
- [EN PLACE] Arrondi **au centime, à chaque montant calculé** (`Math.round(x*100)/100`) ; les totaux additionnent des montants déjà arrondis.
- [CORRIGÉ v1.49] `r2` : une seule fonction, exportée par `js/utils.js` (une valeur illisible donne 0) ; les 6 copies sont retirées.

### 2.4 Pourcentages
- [EN PLACE] Stockés en **points** (15 = 15 %) : `show_payments.pct`, `shows.artbo_pct`, `partner_pct`, `vat_rate`, réglages `default_*`, `production.artbo_share`. Seul le taux de remplissage est un ratio 0–1 (calcul interne).
- [NOUVELLE] Affichage : `15 %` (espace insécable avant `%`), 2 décimales au plus, sans zéro inutile (`33,33 %`, `5,5 %`). [CORRIGÉ v1.49] fonction officielle `pct(v)` (`js/utils.js`) : mails (`mail.js`, et SQL `mail_vars` `acompte_pct` / `tva`, migration v1.49), fiche publique (`fiche.js`), Production, Réglages, budget, projets, export artiste, confirmation (répartition, solde), billetterie. Contrôle statique : aucun `${…} %` hors unité placée après une case de saisie. Restent « % » simple : le libellé « Acompte 30 % » envoyé à Pennylane (fonction serveur, à aligner au prochain déploiement de `pennylane`). Exception gardée : texte des modèles de contrat (« TVA 5,5% » vient du modèle Google Docs d'Anthony).

### 2.5 Calculs financiers — fonctions officielles [EN PLACE]
| Calcul | Fonction | Fichier |
|---|---|---|
| Lignes de facturation d'une date | `paymentsOf(showId)` | `js/calc.js` |
| Montant HT d'une ligne (montant saisi, sinon % du cachet) | `payAmount(p)` | `js/calc.js` |
| TVA / TTC | `payVat(p)`, `ttc(ht, taux)`, `showVat(s)` (5,5 par défaut) | `js/calc.js` |
| Répartition acompte/solde | `billingOf(s)`, `billPct(p)` | `js/calc.js` |
| Commission d'une date | `commissionOf(s)`, `commissionAmount(s)` | `js/budget.js` |
| Budget d'une date | `showBudget(s)`, `lineForecast(l)`, `lineValue(l)`, `availableForArtist(s)` | `js/budget.js` |
| Compte dédié | `accountOf(projectId)`, `accountMoves(projectId)` | `js/budget.js` |
| Budget de production | `productionBudget(s, real)` | `js/production-budget.js` |
**Interdit** : recalculer un montant de facture, une commission ou un reste artiste ailleurs que par ces fonctions. Les recalculs côté serveur existants sont listés au §8.4.

---

## 3. Formulaires

### 3.1 Présentation [EN PLACE]
- Création / modification complète : fenêtre `openModal({title, fields, values, onSave, onDelete})` (`js/ui/modal.js`) ; deux niveaux possibles.
- Modification rapide : dans le tableau (`cIn`, `cSel`, `cAc`, `dateInput`), **enregistrée à la sortie du champ** (gestionnaire `change` global de `js/app.js` sur `data-t` / `data-id` / `data-f`).
- Effet de bord d'un champ : crochet `ACTIONS['change:table.champ']` (`js/actions.js`), appelé aussi par les fenêtres qui modifient ce champ (§4.2) ; jamais un écouteur `change` supplémentaire.
- Pages publiques : `fiche-fields.js`, `rh-fields.js`, `artist-form.js`.

### 3.2 Champs obligatoires [NOUVELLE]
- Libellé suivi de `*` ; contrôle dans `onSave` avec `toast('Indique <le champ>', true)` et `return false` (la fenêtre reste ouverte). Jamais de refus sans message. [CORRECTION] `editProject` refuse un nom vide sans message.
- Un champ obligatoire l'est partout où il est saisi. [CORRECTION] `rh-fields.js` : `req:true` respecté sur la page publique, ignoré dans la fenêtre salarié de l'app.

### 3.3 Valeurs par défaut [NOUVELLE]
Une valeur par défaut est lue **à un seul endroit** — un réglage (`setting('…')`) ou une constante de `js/constants.js` — jamais un nombre écrit dans une vue, une action ou une fonction serveur. Les priorités métier sont au §6.2. **Une valeur modifiée volontairement par l'utilisateur n'est jamais rétablie automatiquement** [DÉCIDÉ Q3, Q5].

### 3.4 Validation des saisies
- **Mails** [DÉCIDÉ Q23] : une adresse invalide est **refusée** avec un message en français sous le champ (« Adresse mail invalide : vérifie le @ et le domaine »), dans l'app **et** les pages publiques, quel que soit l'écran (fenêtre, tableau, fiche publique). Une adresse n'est **jamais déplacée automatiquement** dans les notes, le téléphone ou un autre champ. [CORRIGÉ v1.50] contrôle unique `mailOk` / `checkMails` / `fieldError` (`js/utils.js`, même expression que la base) : toutes les fenêtres (plus de bulle du navigateur ; destinataires et copies des fenêtres de mail et de prospection contrôlés adresse par adresse, « Nom <adresse> » accepté), cases des tableaux (membres), écrans enregistrés au fil de la saisie (infos administratives d'une structure, fiche artiste dans l'app : rien n'est enregistré tant que le mail n'est pas corrigé), pages publiques (`fiche.js`, `rh.js`, `artiste.js`, listes comprises) ; une adresse contenant un caractère invisible (n'importe où) est refusée (hors contacts, rien ne la nettoierait en base). `contacts_clean` ne déplace plus jamais un mail : une adresse au mauvais format arrivée par une autre voie reste dans sa case, seulement nettoyée par `clean_email` (minuscules, espaces et invisibles retirés).
- **Doublons de contacts** [DÉCIDÉ 27/10/2026, EN PLACE v1.50] : à l'enregistrement d'un contact (fenêtre ou création rapide), un autre contact qui a déjà l'un de ses mails (mail 1 ou 2, sans tenir compte des majuscules ni des espaces) donne un **avertissement** avec accès à la fiche existante (« Ouvrir la fiche existante » / « Utiliser ce contact ») ou « Enregistrer quand même » ; **aucune fusion automatique** (`contactsWithMail`, `askDuplicate`). Les doublons déjà en base ne sont pas touchés.
- **Téléphones** [DÉCIDÉ Q24] : aucune validation restrictive ; numéros français et internationaux acceptés. Nettoyage autorisé : espaces superflus en début/fin, espaces multiples, caractères invisibles (espaces insécables, zéro-largeur, retours à la ligne). **Interdit** : modifier un chiffre, retirer ou ajouter un préfixe (`+33`, `0033`, `0`), reformater la signification du numéro. [EN PLACE] `clean_phone` (SQL) — à vérifier contre cette règle lors de la correction.
- **Nombres** : `numfield` (§2.1). **Dates** : `dateInput` (§1.5). **URL** : `url()` (`js/utils.js`) ajoute `https://` si absent.

### 3.5 Enregistrement et brouillons [EN PLACE]
- `save(table, id, patch)` (`js/data.js`) : mise à jour immédiate à l'écran ; si Supabase refuse, retour à l'ancienne valeur + message.
- Fenêtre : « Enregistrer » / « Annuler » ; la fermer sans enregistrer garde un brouillon (`js/ui/drafts.js`) restauré à la réouverture.
- [EN PLACE, lot S0-R8] **Stockage du navigateur séparé par environnement** : brouillons, file des résumés IA et préférences passent **uniquement** par `js/storage.js` (`localGet`, `localSet`, `localDel`) ; production : clés historiques inchangées ; test : clés `artbo-test.…`. Accès direct à `localStorage` / `sessionStorage` / `indexedDB` interdit ailleurs (sauf `js/config.js` pour `artbo.env`), contrôlé par `tests/static/check.mjs`. Pages publiques (reconnues par `<body class="fiche-page">`) : environnement tiré **de leur seul lien** (`test` dans l'adresse), jamais du navigateur. Exception connue : la bibliothèque Supabase (`assets/vendor`) garde la session de connexion sous une clé propre à chaque projet (`sb-<projet>-auth-token`), donc déjà séparée.
- [CORRECTION] La clé de brouillon (titre de fenêtre + id) fait partager le même brouillon à toutes les « Nouvelle tâche » (peut écraser un pré-remplissage) et rend orphelin le brouillon d'un lieu renommé ; trois mécanismes de brouillon coexistent (drafts.js, `logdraft.*`, pages publiques).

### 3.6 Messages d'erreur [NOUVELLE]
- Toujours en français : ce qui n'a pas marché + quoi faire (« Enregistrement impossible : … », « Le script Google n'est pas à jour : Réglages › Google… »).
- **Jamais** de message brut (Supabase, Postgres, Pennylane, Apps Script) seul, et **jamais** sur une page publique. [CORRECTION] `fiche.js`, `rh.js`, `artiste.js`, `views/settings.js`, `syncLinks`, `actions.js`.
- Erreur silencieuse interdite : tout échec d'écriture produit `toast(…, true)`. [CORRECTION] `removeWhere`, suppression de liens dans `syncLinks`, `refreshFor`.

---

## 4. Actions

### 4.1 Création [EN PLACE]
- `insert(table, values)` (`js/data.js`) ; la nouvelle ligne est **visible, rangée à sa place logique et mise en évidence** sans recharger.
- Une seule voie de création par entité. [CORRECTION] deux voies pour un suivi (`newSuivi` et la branche inaccessible de `editProspect`), deux formulaires de contact (complet / rapide).

### 4.2 Modification [NOUVELLE]
**Un même champ produit le même effet quel que soit l'écran** (tableau, fenêtre, conditions, page dédiée). Cas du cachet : §6.5. [CORRECTION] statut de suivi : Annuler et relances restaurées seulement depuis le sélecteur.

### 4.3 Terminer, clore, annuler — annulation pendant 5 secondes
- [EN PLACE] `saveLinger(table, id, patch, message, {after, onUndo})` (`js/data.js`, `LINGER_MS` = 5 000) : l'élément reste visible 5 s, toast avec **Annuler** qui rétablit exactement l'état précédent.
- [NOUVELLE] Tout passage à « terminé / clos / annulé » (tâche Faite ou Annulée, suivi Clos ou Confirmé, date Annulée ou Sans Suite) passe par `saveLinger` **depuis tous les chemins**.
- [DÉCIDÉ Q17] Toute tâche qui passe à « Faite » (ou « Annulée ») enregistre **systématiquement** sa date et heure réelles de réalisation dans `tasks.done_at`, quel que soit le chemin (case, fenêtre, relance fermée automatiquement). Repasser la tâche « À faire » vide `done_at`. Les **547 anciennes tâches terminées sans date restent vides** : aucune date n'est inventée (ni `updated_at`, ni autre). [CORRIGÉ v1.46b] la fenêtre de tâche pose / efface `done_at` et passe par `saveLinger` (Annuler 5 s) en passant à « Faite » ou « Annulée ». [CORRECTION] fenêtre de suivi et `closeNoAnswer` sans Annuler.

### 4.4 Suppression [DÉCIDÉ Q18, Q19]
Toute suppression (tâche, suivi, date, structure, contact, artiste, ligne de budget ou de facturation, pièce jointe, journal) suit **dans cet ordre** :
1. **Confirmation explicite** dans une fenêtre de l'application (§4.5) qui nomme l'élément **et annonce ce qui part avec lui**, avec les nombres : « Supprimer la tâche « Relancer X » et ses 2 pièces jointes ? » (pièces jointes, lignes de journal, fichiers stockés).
2. **Attente de suppression pendant 5 secondes** : après confirmation, l'élément passe **en attente de suppression** (enregistré côté serveur) et disparaît de l'écran ; toast « Supprimé — Annuler ». **Annuler** pendant ce délai retire l'attente : rien n'est effacé (ni lignes, ni fichiers).
3. **Suppression définitive passé le délai**, **même si la page a été fermée ou rechargée**, ou si le réseau a été coupé : c'est le **serveur** qui l'exécute, jamais un minuteur du navigateur. Une fois les 5 s écoulées, l'annulation est refusée.
- La suppression d'une **tâche** ou d'un **suivi** supprime ses pièces jointes stockées dans la Matrice (lignes `attachments` / `prospect_files` + fichiers du bucket `suivi`).
- **Les fichiers Google Drive ne sont jamais supprimés** par la Matrice (voir `CLAUDE.md` §3). Un remplacement Drive met l'ancien fichier à la corbeille Drive, uniquement après choix explicite (« Remplacer l'ancien »).
- **Architecture technique retenue** (faisabilité vérifiée le 21/10/2026 : `pg_cron` 1.6.4 accepte une fréquence en secondes ; `pg_net` 0.20.4 présent ; la suppression directe de fichiers en SQL est bloquée par le trigger `storage.protect_objects_delete`, donc les fichiers passent par l'API de stockage) — à construire dans le lot dédié du plan, après validation :
  1. table d'attente (ex. `pending_deletions` : table, identifiant, demandeur, `requested_at`, `execute_after` = `requested_at` + 5 s, résumé de ce qui part), protégée par RLS `is_team()` ;
  2. fonction RPC « demander la suppression » (vérifie les droits, calcule le résumé, crée l'attente) et « annuler » (refusée si `now() >= execute_after`) ;
  3. tâche `pg_cron` toutes les 5 secondes qui exécute les attentes échues : suppression des lignes en base (avec leurs lignes liées), puis envoi des chemins de fichiers à une fonction edge qui les efface via l'API de stockage, avec reprise en cas d'échec (le fichier reste listé tant qu'il n'est pas effacé) ;
  4. côté application : les éléments en attente sont masqués partout (lecture de la table d'attente + temps réel) ; le délai effectif d'effacement est de 5 à 10 s après la confirmation, mais l'annulation est impossible dès 5 s.
- [EN PLACE] Aujourd'hui : suppression immédiate et définitive après un `confirm()` natif.
- [CORRIGÉ v1.46b] suivi supprimé (fenêtre ou liste : `deleteProspect`) et tâche supprimée (fenêtre) : lignes d'abord, puis fichiers stockés effacés (`purgeStored`, échec signalé). [CORRECTION] `deleteProject` et suppression d'une date : nettoyage client non vérifié ; aucune suppression n'a de délai d'annulation.

### 4.5 Fenêtres de dialogue [DÉCIDÉ Q20]
- **Toutes** les fenêtres natives du navigateur sont remplacées par des fenêtres de l'application : `confirm()` (confirmations), `prompt()` (saisies, dont le **mot de passe**, toujours en champ masqué), `alert()` (alertes, rapports comme celui de la synchronisation Pennylane).
- Composant à créer dans `js/ui/` (sur le modèle d'`openModal`, styles `DESIGN_SYSTEM.md` §9) : titre, texte de l'action et de ses conséquences, bouton d'action **explicite** (`.btn.danger` « Supprimer la tâche », `.btn.primary` « Clore le suivi »), et « Annuler ».
- **« Annuler » (et Échap, et le clic hors de la fenêtre) ne déclenche jamais l'action** ni aucune partie de l'action. Une question à deux issues propose deux boutons nommés + « Annuler » ; jamais « OK/Annuler » pour deux actions différentes.
- [EN PLACE v1.46b] Composant `ask({title, text, actions, cancel})` (`js/ui/dialog.js`) : renvoie la valeur du bouton choisi, `null` pour Annuler / Échap / clic dehors. Utilisé pour toute suppression depuis une fenêtre (`openModal` `deleteAsk` / `onDelete(choix)`) et la suppression d'un suivi. Tout nouveau code l'utilise ; **aucun** nouveau `confirm`, `prompt` ou `alert`.
- [CORRIGÉ v1.48] **Plus aucune fenêtre native** (référence des contrôles statiques : 0) : `confirmAsk` (confirmations nommant l'élément et ses conséquences), `askText` (pôle, partenaire, lien Drive, lien ; **mot de passe en champ masqué**, 8 caractères vérifiés dans la fenêtre), `inform` (rapport de synchronisation Pennylane), `copyText` (copie ; si le navigateur la refuse, le texte est présenté sélectionné) ; chaque fenêtre de formulaire qui supprime a sa question (`deleteAsk`) qui nomme l'élément et ce qui part avec lui, d'après les liens réels de la base. Un clic sur le fond dans les 400 ms suivant l'ouverture est ignoré (double-clic). [CORRECTION] membres, journal d'un artiste et événements d'une structure ne sont liés par aucune clé : ils restent en base, invisibles, après la suppression (annoncé dans la question ; nettoyage à décider). [CORRIGÉ v1.46b] supprimer une tâche « Relance téléphone » : « Supprimer seulement la tâche » / « Supprimer et clore le suivi » / « Annuler » (qui ne supprime rien).

### 4.6 Fichiers associés [EN PLACE]
- Envoi : `uploadFiles(owner, files)` (`js/data.js`) → bucket `suivi`, chemin `dossier/horodatage_nom-nettoyé` ; ouverture : `openStored(path)`.
- Zone de dépôt : `dropZone(owner)` ; glisser-déposer : `js/ui/dropfiles.js`.
- Mail `.eml` déposé dans un suivi : pièce jointe + entrée « Mail » au journal (sans doublon).
- Pièces du budget : lues par l'IA (`lire-piece`), rangées dans `02_Finance` du dossier Drive de la date ; doublon → choix explicite.
- Factures de vente Pennylane : rangées par la synchronisation dans la compta (`D - Factures de ventes / AAAA-MM`) et dans `02_Finance` de la date, nom `F-AB-AAAA-MM-NN Client Acompte|Solde.pdf`, sans doublon (vérification par numéro dans chaque dossier).
- Nomenclatures Drive : tableau du `README.md`, à l'identique.

### 4.7 Notifications [EN PLACE]
- Interface : `toast(msg)` (succès), `toast(msg, true)` (erreur), `toast(msg, false, {label, fn})` (Annuler, Ouvrir).
- Rappels : table `notifications`, écrits par `generate_reminders` (tous les jours 5 h UTC, soit 6 h en hiver et 7 h en été à Paris), clé anti-doublon `règle:id:échéance` = **une seule notification par échéance**, jamais une nouvelle chaque jour pour la même dette [DÉCIDÉ Q13] ; récapitulatif par mail via Apps Script.

### 4.8 Navigation
- [EN PLACE] Changer d'onglet : `go(view)` (`js/app.js`) — remet à zéro les pages détail, mémorise la vue.
- [NOUVELLE] Toute action qui change d'écran passe par `go()` ou une fonction d'ouverture dédiée (`openStructure`, `openSuivi`, `openProject`…) qui remet à zéro les autres pages détail. [CORRECTION] `openNotif`, `filterTag`, `newSuivi`, `editStructure`, `editProspect`, `popstate` modifient `S.view` directement ; le retour navigateur ne passe pas par `cleanupDraft`.
- **Liens directs** [DÉCIDÉ Q25] : chaque fiche **artiste, structure, suivi et date** a une adresse propre (dans l'URL, après `#`) qui rouvre la fiche après rechargement, se copie et se partage, et alimente le bouton retour du navigateur. L'adresse ne contourne jamais l'authentification ni la RLS : sans session, la page de connexion s'affiche puis la fiche demandée ; une fiche inexistante ou inaccessible affiche un message en français et revient à la liste. Format exact à définir à l'implémentation (ex. `#structure/<id>`). [CORRECTION] aujourd'hui aucune adresse (`history.pushState` sans URL).

---

## 5. Recherche, tri, filtres
- [EN PLACE] Correspondance : `matches(texte, recherche)` (`js/utils.js`) — tous les mots, sans accents, apostrophes et tirets ignorés (`norm`, `hayOf`). [CORRECTION] `tagpicker.js` a sa propre `norm`.
- [EN PLACE] Ordre des résultats d'une recherche par nom : d'abord les noms qui **commencent** par la saisie, puis ceux qui la contiennent, puis les autres correspondances, puis alphabétique.
- [DÉCIDÉ Q29] Dans **tous** les sélecteurs de structure (champ « Structure » d'une tâche, d'une date, d'un suivi, d'un contact, liste Structures), on retrouve une structure par le **nom de ses contacts** (en plus de ses propres champs). [NOUVELLE] Plus généralement, une entité se cherche sur les mêmes champs dans sa liste et dans ses sélecteurs. [CORRECTION] l'autocomplétion des structures ne cherche ni contacts (sauf mails si la saisie contient `@`), ni tags ; celle des contacts ni téléphones ni postes.
- [EN PLACE] Choix d'artistes : les plus utilisés d'abord (`byUsage`), puis alphabétique ; actifs avant inactifs.
- [EN PLACE] Barre de recherche : un clic sélectionne tout le texte (ordinateur uniquement).
- **Filtre Artistes** [DÉCIDÉ Q26] : un seul filtre Artistes, **commun** aux onglets qui l'affichent (To Do, Booking, Production, Suivi…) [EN PLACE].
- **Persistance des filtres** [DÉCIDÉ Q27] : **tous** les filtres de chaque onglet (artistes, année, inactifs, « Pour », « Afficher », pôle, statut des suivis, tags des structures, recherche autour d'une ville, afficher annulées/closes/terminées) sont conservés après rechargement (`localSet` / `localGet`, préfixe `artbo.`). Chaque onglet qui a des filtres affiche un bouton **« Réinitialiser les filtres »** clairement identifiable, qui remet les filtres **de cet onglet** et le filtre Artistes commun à leur valeur par défaut, en le disant (« Filtres réinitialisés »). [CORRECTION] aujourd'hui seuls année, artistes, inactifs et « Pour » sont gardés ; le reste est perdu au rechargement ; « Tout afficher » (To Do) n'existe que dans To Do.
- Les **recherches tapées** ne sont pas des filtres persistants [NOUVELLE] : elles survivent au changement d'onglet (comportement actuel) mais pas au rechargement.
- Tris par défaut [EN PLACE] : dates de concert croissantes (sans date à la fin) dans Booking/Production ; suivis par dernier échange décroissant ; tâches par échéance (`taskSort`) ; tâches terminées par `done_at` décroissant ; lignes de budget par catégorie (`BUDGET_CATS`) puis ordre d'ajout.
- **Dates sur les fiches artiste et structure** [DÉCIDÉ Q28] : d'abord les **dates futures**, de la plus proche à la plus lointaine ; puis les **dates passées** dans une section repliable (`fold()`), de la plus récente à la plus ancienne. « Future » = date ≥ `today()` ; une date sans jour est rangée avec les futures, en fin de liste. [CORRECTION] aujourd'hui tout est décroissant sur ces fiches.
- Listes longues [NOUVELLE] : au-delà de 300 lignes, 300 premières **avec** le message « 300 premiers résultats affichés — affine la recherche. » [CORRECTION] Suivi coupe à 500 sans message.
- Exports [CORRECTION] : `exportShows` n'accepte qu'un artiste alors que l'écran en filtre plusieurs ; `exportSuivis` écrit les statuts en anglais.

---

## 6. Règles métier

### 6.1 Sources de vérité
| Domaine | Source | Statut |
|---|---|---|
| Paramètres et valeurs par défaut | Réglages (table `settings`) — `setting('clé')` | [EN PLACE] |
| Factures (numéro, montant, payé) | Pennylane — synchronisation `pennylane` (action `sync`) | [EN PLACE] |
| Fichiers | Google Drive (Apps Script `Code.gs`) | [EN PLACE] |
| Statuts, listes, libellés | `js/constants.js` + contraintes `CHECK` SQL | [EN PLACE] |
| Dépenses réelles | voir §6.9 (transition COST€ → Matrice) | [DÉCIDÉ Q8, Q9] |
Réglages utilisés : `default_artbo_pct_booking` (15), `default_artbo_pct_production` (20), `default_artbo_pct` (ancien, 15), `default_acompte_pct` (50), `default_solde_pct` (50), `default_cnm_pct` (3,5), `movinmotion_payslip_cost` (20,3), `departments`, `budget_template`, `contract_template_cc/cr`, dossiers Drive (`finance_folder_id`, `artist_template_folder_id`…), scripts (`drive_webhook_url`, `prospect_script_url`), signatures. (Valeurs au 21/10/2026.)

### 6.2 Priorité des valeurs par défaut [DÉCIDÉ Q1, Q2, Q3]
Ordre général : **valeur saisie sur la ligne (facture) > valeur de la date > valeur de l'artiste (projet) > Réglages**. Une constante écrite dans le code n'est admise qu'en dernier recours et doit être égale à la valeur par défaut du réglage. Une valeur modifiée volontairement par l'utilisateur n'est jamais rétablie automatiquement.

### 6.3 Commission L'ArtBo [DÉCIDÉ Q1, Q2]
1. Commission **explicitement définie sur la facture** : ligne `show_payments` de type `artbo` avec un montant (`amount`) ou un % (`pct`).
2. Sinon **% défini sur la date** : `shows.artbo_pct`.
3. Sinon **% défini sur l'artiste** : `projects.default_artbo_pct` — y compris pour une date en Booking d'un artiste habituellement en Production : **c'est le % de l'artiste qui s'applique, pas le taux Booking des Réglages** [Q2].
4. Sinon **taux par défaut des Réglages** selon le mode de la date : `default_artbo_pct_booking` ou `default_artbo_pct_production` (`defaultCommission(mode)`).
- **Une commission déjà facturée n'est jamais modifiée automatiquement** : ligne `artbo` avec `sent_at`, `invoice_number`, `pennylane_id` ou `paid_at` renseigné → aucun recalcul (changement de cachet, de %, de mode, de réglage). Toute modification est manuelle et explicite. [DÉCIDÉ 26/10, lot C1] Exception : en **production**, la commission n'est pas une facture ; seule sa date de versement (`paid_at`) la fige (§6.3).
- [EN PLACE] En production, la commission est virée depuis le compte de l'artiste (pas de facture, pas de TVA) ; en booking, facturée à la structure administrative de l'artiste (TVA 20 %).
- [DÉCIDÉ 26/10, lot C1] **Commission de production** : ce n'est **pas une facture émise**. On suit seulement son **versement** (`paid_at`, date de versement) ; seul ce versement la fige. Un numéro saisi (historiquement celui de la facture d'acompte) ne la rend pas « émise », ne la met pas dans les factures impayées et ne sert à aucun rapprochement Pennylane. Les 19 lignes historiques numérotées ne sont **pas** modifiées automatiquement (traitement séparé).
- [CORRIGÉ v1.46] Plus de 15 ni de 0 en dur : une date sans % prend le % de l'artiste, sinon le réglage du mode de la **date** — application `showCommissionPct` (`payAmount`, `payPct`, `commissionAmount`, export artiste, indication de « Valider les conditions ») ; base `default_commission_pct` (`payment_amount_for`, `on_show_confirmed`, qui n'utilise plus l'ancien réglage `default_artbo_pct`) ; Pennylane `pctCommission` + `default_commission_pct`. 15 (booking) / 20 (production) seulement si le réglage est absent, vide ou nul.

### 6.4 Acompte et solde [DÉCIDÉ Q3, Q4]
- **Acompte par défaut** : le réglage `default_acompte_pct` est appliqué **tel quel, y compris 0 %** (= date sans acompte). Valeur de secours 50 uniquement si le réglage est **absent** (vide), jamais s'il vaut 0. Un % d'acompte modifié par l'utilisateur sur une date n'est jamais rétabli automatiquement. Réglage à 0 % : aucune ligne d'acompte créée, solde 100 % (« Valider les conditions », `on_show_confirmed`, `ensure_production_payments`). [CORRIGÉ v1.46] `defaultAcompte` (application) et `nullif(…)::numeric, 50` (base) partout ; Réglages affichent le champ vide (50 en indication) si le réglage est vide. Réglage à 0 % : « Appliquer aux dates à venir » ne pose jamais d'acompte à 0 % ni ne supprime de ligne en lot (bouton masqué) ; un acompte prévu se retire date par date (« Valider les conditions » › 0 acompte).
- **Solde à facturer** [DÉCIDÉ 26/10, lot C1] : tant que le solde n'est pas émis, son montant = **cession − acomptes EFFECTIVEMENT facturés** (`soldeDue`, `payAmount`). Un acompte seulement prévu au contrat **ne réduit pas** le solde (cession 10 000 € HT, acompte 30 % prévu non facturé → solde 10 000 € ; acompte facturé → 7 000 €). Un montant saisi à la main fait foi. Le **% prévu** (`pct`, maintenu par `rebalanceSolde`) reste l'**échéancier contractuel** : fiche organisateur, mail, contrat (`planAmount`).
- **Acompte prévu / caduc** [DÉCIDÉ 26/10, lot C1] : un acompte non facturé est « prévu » (affiché, hors indicateurs, hors compte) ; il devient **caduc** quand le solde est facturé : plus réclamé ni relancé, historique conservé (`acompteState`). [Protection lot C1] Un acompte caduc **ne s'émet plus** (numéro, envoi, paiement refusés ; pas de bouton Pennylane) : la date serait facturée au-delà de sa cession ; la synchronisation Pennylane ne le relie jamais et signale dans son rapport une facture qui lui correspondrait. [DÉCIDÉ 26/10, point 3] Même protection **côté base** : déclencheur `show_payments_caduc_guard` (migration v1.41 acompte caduc) — production seulement ; verrou transactionnel par date à chaque émission d'acompte ou de solde (facturation simultanée, garanti en READ COMMITTED) ; un acompte déjà émis n'est pas concerné ; libellé, %, montant, pièce restent modifiables (historique). **Limite connue** [DÉCIDÉ 26/10 : `Import.gs` non modifié] : une fois ce déclencheur en place, relancer l'import Notion (`apps-script/Import.gs`, insertion « ou mise à jour » sur `import_key`) échoue (paquet entier refusé) dès qu'il contient une date de production dont l'acompte et le solde sont tous deux facturés : le déclencheur s'exécute avant l'insertion, même quand la ligne existe déjà ; l'import étant ponctuel (déjà fait), il ne doit pas être relancé sans examen préalable.
- **Émission du solde** : dès que le solde devient émis (numéro, envoi, paiement ou lien Pennylane), son montant est **figé** à ce moment (`freezeOnEmit` ; synchronisation Pennylane : montant HT de la facture Pennylane). Cession vide : rien n'est figé. **Plusieurs lignes de solde** sur une date (anomalie que l'application ne crée pas ; 0 en production au 26/10/2026) : les soldes émis ou saisis sont déduits, seul le premier solde calculé reçoit le reste (la cession n'est jamais comptée deux fois) et l'anomalie est signalée (`multiSolde`) ; aucune donnée corrigée automatiquement. Le % au contrat (`billPct`) reste celui de l'échéancier ; l'onglet Factures affiche la part réelle d'un solde calculé (`billedPct`).
- **Montants figés et historique financier** [DÉCIDÉ 26/10, lot D1 — à mettre en production sur autorisation] :
  - une facture (acompte, solde, autre) garde le montant du moment **dès son émission** ; une commission L'ArtBo et une part partenaire **dès leur versement** (commission de production : seul le versement, règle C1). Les lignes pas encore émises restent calculées. Application : `freezeOnEmit` ; base : `show_payments_freeze` ;
  - **le montant réel d'une facture émise fait référence** : un acompte ou un solde relié à sa facture Pennylane est figé sur le montant HT de cette facture (`figerMontant`) ; une facture groupée (plusieurs dates) n'est jamais reliée automatiquement ;
  - **changer le cachet, un % ou la TVA d'une date déjà facturée** : possible après un **avertissement** (fenêtre de l'application) listant les lignes concernées, à condition que tous les montants facturés ou versés restent inchangés ; refusé tant qu'une ligne émise n'a pas de montant figé (`changeBlocked`, `shows_frozen_guard`). TVA : refusée si une facture émise dépend de la TVA de la date ;
  - **date engagée** (une ligne envoyée, payée / versée, numérotée ou liée à Pennylane, quel que soit le mode) : son **mode booking / production ne change plus**, ni directement, ni quand l'artiste change de mode, ni quand elle change d'artiste (`hasFinancialRecord`, `show_has_financial_record`) ;
  - **lignes historiques** émises sans montant : figées seulement par une **régularisation contrôlée** validée ligne par ligne par Anthony (A1 n'accepte que remplir un montant vide, dans une transaction qui l'annonce). Retour arrière possible **uniquement** pour un montant posé par une régularisation (« degel », journalisé) ; jamais pour un montant figé à l'émission, au versement ou saisi ;
  - **coproduction** (décision d'Anthony du 27/10/2026, Rockstore) : ce n'est pas une production classique — aucune facture de cession, aucun acompte, aucun solde, aucune commission L'ArtBo ni part partenaire ne sont générés (confirmation de la date, validation des conditions, passage en production) ; ses opérations financières **réelles** s'ajoutent à la main et comptent normalement ; aucune n'est inventée. Les lignes déjà créées par l'import sont **gardées** et classées « hors calcul » (motif, journalisé ; régularisation annoncée « hors_calcul », script F) : elles n'entrent dans aucun indicateur, compte, rappel, opération Pennylane, fiche ni mail, ne se modifient plus et ne se suppriment pas ; seule une ligne **artificielle d'import** d'une date « Co-Production » peut l'être (acompte, solde, commission ou part partenaire avec `import_key`, sans montant figé, numéro de facture autre que « N.C », lien Pennylane, pièce, déclaration ni versement) — une opération réelle ne peut jamais être masquée ; dans le tableau par date du compte artiste, une date en Production / Co-Production n'affiche ni cachet, ni commission, ni « reste artiste » calculés (son budget est un prévisionnel à part, onglet Budget de la date) : seuls les montants réalisés (dépenses payées, versements réels à l'artiste) apparaissent, hors totaux du cachet, de la commission, des dépenses et du reste (`js/views/budget.js` `ownProdRow`, décision du 27/10/2026) ;
  - **acompte ou solde facturé à un autre % que la Matrice** (décision d'Anthony du 27/10 : La Puce à l'Oreille, La MOBA, 50 % facturés, 20 % posés par l'import Notion) : régularisation contrôlée « acompte_facture » — le montant encore vide est figé au montant de la **facture** et le % aligné dessus, ensemble et seulement s'ils concordent (cachet × % = montant facturé). Son retour arrière (« degel ») remet le % d'avant seulement si c'est cette régularisation qui l'a changé (journal) ;
  - **journal financier** `finance_log` : cachet, %, TVA, mode, type de contrat, montant, compte d'encaissement, dates d'envoi / de paiement, numéro, lien Pennylane — avant, après, date, auteur, source. Lecture équipe ; écriture par déclencheur seulement. Inclus dans la sauvegarde nocturne complète (vérifiée à chaque restauration d'essai) et dans l'export JSON quotidien ;
  - **commission de production = un total dû + ses versements** [DÉCIDÉ 27/10, lot D1, option B] : la ligne de commission est **unique par date** ; son montant est la commission **totale**, figée au premier versement (jamais recalculée ensuite sur le cachet ou le %). Chaque transfert réel vers L'ArtBo (y compris une retenue sur un acompte, sans virement distinct) est un **versement** (`commission_transfers` : montant, date, référence, note), jamais modifié ni supprimé. Déjà transféré = somme des versements ; reste = total − transféré ; « versée » (`paid_at`) seulement quand le reste est nul. **Compte artiste** : seuls les versements sont déduits ; le reste est « à venir ». **Budget / export artiste** : commission totale comptée une fois, transferts et reste détaillés. **Rappels** : sur le reste (`generate_reminders`, `remindersOf`). Jamais de facture (Pennylane). Commission marquée versée avant ce lot sans versement détaillé : versée en totalité à sa date. Application : `commissionState`, `transfersOf`, action « Noter un versement » ; base : migration v1.43 ;
  - l'import Notion (`apps-script/Import.gs`) ne doit **jamais** être relancé : il réécrirait cachets et lignes et serait refusé en bloc par ces protections.
- **Solde après envoi** (ligne `solde` avec `sent_at` ou `invoice_number` ou `pennylane_id` renseigné) :
  - son montant est **figé** ;
  - **aucun nouvel acompte** ne peut être ajouté d'une manière qui modifierait ce solde ;
  - **aucun acompte existant** ne peut être modifié (montant, %) d'une manière qui changerait le solde facturé : la modification est **bloquée** avec un message en français qui explique pourquoi ;
  - toute correction exceptionnelle passe par une **procédure explicite de régularisation**. **Aucune procédure de régularisation ne doit être développée tant qu'elle n'a pas été définie et validée par Anthony** ; d'ici là, la modification est simplement bloquée avec un message ;
  - **une facture déjà envoyée n'est jamais modifiée silencieusement**, par aucun chemin (écran, trigger SQL, synchronisation).
- [EN PLACE] Une date « sans acompte » (solde seul) est respectée par `ensure_production_payments`.
- [EN PLACE] Facturation : acompte et solde se font **depuis le devis Pennylane** (bouton « Facturer depuis le devis ») ; la synchronisation reconnaît les factures par devis + montant HT et range le PDF dans le Drive.
- [CORRECTION v1.45.2] Une ligne **déjà émise** (numéro, envoi ou paiement noté, `isInvoiced` ; ex. ancienne facture faite hors Pennylane) n'affiche jamais « Créer » (mention « Facture existante ») et la fonction serveur `pennylane` (action `invoice`) refuse d'en créer un brouillon (`emise`) : jamais de seconde facture. Aucune donnée n'est modifiée.
- [CORRECTION] aucun blocage aujourd'hui : un acompte peut être ajouté/modifié après envoi du solde et `rebalanceSolde` peut recalculer le solde.

### 6.5 Cachet [DÉCIDÉ Q5]
- `shows.fee_ht`, HT, TVA de la date `shows.vat_rate` (5,5 % par défaut) [EN PLACE].
- Quand le cachet change, depuis **n'importe quel écran** (tableau Production, fiche de la date, « Valider les conditions ») :
  - lignes non envoyées **en %** : recalculées automatiquement (le % ne change pas, le montant suit) ;
  - ligne non envoyée dont le **montant a été saisi à la main** : l'application **demande explicitement** « Conserver le montant saisi (2 500,00 €) ou recalculer sur le nouveau cachet (3 000,00 €) ? » — **aucun écrasement automatique** d'une saisie manuelle ;
  - lignes envoyées ou payées : **jamais modifiées** (§6.3, §6.4).
  - [DÉCIDÉ 26/10, lot D1] si la date a des lignes émises ou versées : **avertissement** avant le changement ; leurs montants ne changent pas (montants figés, §6.4).
- [CORRECTION] aujourd'hui le tableau Production remet **automatiquement** à zéro les montants saisis (crochet `change:shows.fee_ht`), alors que la fiche de la date et « Valider les conditions » ne font rien.

### 6.6 Compte d'encaissement d'un acompte ou d'un solde [DÉCIDÉ Q6, Q7]
- Champ `show_payments.payee` (`compte` = compte dédié de l'artiste, `artbo`, `artiste`, `autre`).
- **Vide = « Non renseigné »**, affiché tel quel ; **aucune attribution automatique** à un compte supposé (ni compte dédié, ni L'ArtBo).
- Un encaissement « Non renseigné » est **exclu des soldes par compte** (compte dédié de l'artiste, avance L'ArtBo) tant qu'il n'est pas attribué, mais **reste clairement identifiable et compté** dans **les encaissements de chaque date** (onglet Factures, résumé du budget) et dans **les totaux par artiste** (budget et compte de l'artiste, ligne ou mention « dont X € — compte non renseigné »), pour qu'aucun montant ne disparaisse.
- Quand une facture (acompte ou solde) est **marquée réglée** (`paid_at` renseigné à la main ou par la synchronisation Pennylane) sans compte : l'application **demande visiblement** le compte d'encaissement (fenêtre ou mise en évidence de la ligne + message). La synchronisation Pennylane ne choisit jamais le compte : elle signale les lignes à compléter dans son rapport.
- [DÉCIDÉ 27/10/2026, v1.46] Le compte d'encaissement se renseigne **uniquement à l'enregistrement du paiement** : aucune ligne n'est créée avec un compte (`ensure_production_payments` ne pose plus `payee = 'compte'`) ; les lignes existantes gardent le leur.
- **Données historiques** [Q7] : les **225 lignes** acompte/solde sans compte (au 21/10/2026) sont **vérifiées une par une avec Anthony** avant toute correction ; aucune attribution en lot ni automatique.
- [CORRECTION] aujourd'hui l'écran Factures affiche « L'ArtBo » pour une ligne vide d'un artiste sans compte dédié (`views/production.js`), et `accountOf` (`js/budget.js`) compte une ligne vide comme encaissée **sur le compte dédié**.

### 6.7 Booking ou production [DÉCIDÉ Q10, Q11]
- [EN PLACE] Chaque date a un mode `shows.prod_mode` (`booking` / `production`), fixé à la création depuis le mode de l'artiste (`shows_defaults`) ; jamais vide (0 date vide au 21/10/2026). Un mode changé à la main sur une date est marqué `prod_mode_manual` et n'est plus modifié automatiquement.
- **Changement de mode d'un artiste** [Q10] : seules les dates **futures** (date ≥ aujourd'hui, ou sans jour) **sans aucune facture envoyée ni comptabilisée** et non marquées `prod_mode_manual` suivent automatiquement. **Dès qu'une facture de la date est envoyée ou comptabilisée**, le mode de cette date ne change plus automatiquement — définition : au moins une ligne `show_payments` de la date (acompte, solde, commission, partenaire, CNM, autre) avec `sent_at`, `invoice_number`, `pennylane_id` ou `paid_at` renseigné (commission d'une date en production : seulement `paid_at`, lot C1). Les dates passées **conservent leur mode**. [CORRECTION] le trigger `project_mode_to_shows` fait suivre **toutes** les dates non manuelles.
- [NOUVELLE] Une seule fonction JS pour savoir si une date est en booking (à créer, remplace `isProdShow` / `isBookingOnly` / tests en ligne) : elle lit `shows.prod_mode` uniquement.
- **Production L'ArtBo** [Q11] : seules les dates au contrat **Production** ou **Co-Production** ont le budget de production (billetterie, droits, résultat partagé) et sortent du compte dédié de l'artiste. La **Co-Réalisation garde le budget de tournée** (fonctionnement actuel, y compris la ligne de taxe CNM créée à la confirmation). Une seule fonction JS pour ce test (à créer, remplace les 4 expressions actuelles).
- [DÉCIDÉ 26/10, lot C1 — protection] **Changement manuel du mode** (case « Booking uniquement ») refusé dès qu'un acompte ou un solde de la date est émis : ces factures entreraient ou sortiraient en silence du suivi de L'ArtBo (`changeBlocked`).
- Rappel métier [EN PLACE] : en booking, L'ArtBo envoie la confirmation puis facture sa commission ; pas de budget, pas d'acompte/solde, pas de compte dédié.
- [DÉCIDÉ 26/10, lot C1] **Booking : L'ArtBo n'est qu'agent.** Elle confirme la date, émet sa facture de commission à l'artiste et suit son règlement. Les acomptes / soldes d'une date booking sont les **factures de l'artiste à l'organisateur** : gardés en base pour l'historique, mais **ni affichés, ni comptés, ni relancés, ni rattachés à une pièce** (`tracked`) ; aucun devis de cession Pennylane ; le paiement des commissions booking est repris de Pennylane (numéro, lien, date de paiement ; **pas** de rangement automatique de leur PDF dans le Drive, non demandé — `rangeeDansLeDrive`). La fiche organisateur garde l'**échéancier contractuel**, sans suivi financier.

### 6.8 Rappels et relances
- [EN PLACE] Règles de production (`js/reminders.js` = affichage en rouge ; `generate_reminders` = notifications) : rappel après « Conf + FT + kit », « Pré-contrat complété », « Contrat envoyé », « Contrat signé » ; facture envoyée impayée ; jour ouvré ≤ J-7 pour envoyer le solde ; commission à virer ; boucle technique (§1.6) ; boucle com et facture de commission (booking) au contrat co-signé.
- **Délais** [DÉCIDÉ Q15] : **deux réglages distincts**, indépendants (modifier l'un n'affecte jamais l'autre), 10 jours par défaut, réglages à créer :
  - **délai de relance commerciale** : relances de prospection (mail J+n après l'envoi réel) **et toutes les tâches Booking** (échéance par défaut d'une tâche du pôle Booking) ;
  - **délai de rappel administratif et financier** : étapes de contrat, factures impayées, commission à virer.
  - Toute échéance J+n un samedi/dimanche passe au lundi. [CORRECTION] aujourd'hui 10 écrit en dur à 4 endroits (`BOOKING_DAYS`, `RELANCE_DAYS`, `plus10`, SQL).
- **Commission à virer** [DÉCIDÉ Q14] : le délai démarre au **premier encaissement, même partiel**, toutes lignes acompte/solde confondues (règle actuelle de l'app). [CORRIGÉ v1.46] le serveur prend aussi le premier encaissement de toutes les lignes.
- **Impayés** [DÉCIDÉ Q13] : un acompte, un solde ou une commission impayés restent suivis **sans limite de durée**, dans l'app **et** côté serveur ; une même dette ne génère **qu'une notification par échéance** (une relance envoyée crée une nouvelle échéance, donc au plus une nouvelle notification). Les **rappels administratifs** (étapes de contrat, boucles) **conservent leur limite actuelle** (date du concert passée de plus de 120 jours, côté serveur ; côté app, seulement les dates à venir). [CORRIGÉ v1.46] le serveur suit les factures et la commission sans limite de durée.
- [DÉCIDÉ 26/10, lot C1] Booking : **jamais** de relance d'acompte ni de solde (factures de l'artiste) ; seule la commission est relancée. Production : « Facture d'acompte à envoyer » s'arrête quand le solde est facturé (acompte caduc).
- **Prospection** [EN PLACE] : trois relances mail puis une tâche de relance téléphone ; un suivi Clos ou Confirmé n'a plus de relance (`cancelAutoRelances`).
- [DÉCIDÉ 27/10/2026, v1.46] **Factures à envoyer** : la date d'envoi (`sent_at`) se saisit **toujours à la main** (la synchronisation Pennylane ne la remplit jamais). Une facture **faite** (numéro ou lien Pennylane) sans date d'envoi ni de paiement donne le rappel « Facture à envoyer : <ligne> (<numéro>) » **3 jours** après (jour ouvré), **maintenu jusqu'à la saisie** de la date d'envoi. Jour de la facture : `show_payments.invoiced_on` = date de la facture Pennylane (posée à la liaison depuis le devis), sinon jour où le numéro / le lien est noté pour la première fois (déclencheur `show_payments_invoiced_on`) ; ligne historique déjà numérotée : date de création de la ligne, jamais modifiée. Factures suivies : production = acomptes, soldes, autres lignes ; booking = facture de commission. Avant d'être faites : « Facture d'acompte à faire (contrat envoyé) », « Facture de solde à faire » (J-7), « Facture de commission à faire (contrat co-signé) ».
- [DÉCIDÉ 27/10/2026, v1.46] **Factures impayées** : « Paiement à vérifier : <ligne> (<numéro>) » 10 jours après l'envoi ou la dernière relance, **toutes** les factures suivies (plus seulement le premier acompte / solde), **sans limite de 120 jours**, jusqu'au **paiement intégral** (`paid_at`) ; **suspension manuelle** ligne par ligne (case « Relances suspendues », `show_payments.reminders_paused`) — la facture reste impayée et comptée. [CORRIGÉ v1.46] limite de 120 jours côté serveur retirée pour les factures et la commission ; premier encaissement toutes lignes confondues côté serveur (Q14).
- [EN PLACE v1.46] Libellés des rappels identiques dans l'app et les notifications (`sendTitle`, `paidTitle` ↔ `generate_reminders`) ; clé anti-doublon inchangée pour la première ligne de chaque sorte (pas de notification en double au passage à la v1.46).

### 6.9 Dépenses réelles et COST€ [DÉCIDÉ Q8, Q9]
- **À terme, la Matrice est la source de référence des dépenses réelles** (`budget_lines.amount`, pièces, paiements).
- **Périmètre** : **tous les artistes en mode Production** (dates `prod_mode = 'production'`), pas seulement The Locos.
- **Transition contrôlée** : tant que l'exhaustivité et l'exactitude des données reprises dans la Matrice ne sont pas vérifiées artiste par artiste avec Anthony, le fichier Excel **COST€ reste tenu et consulté** ; aucune suppression, aucun arrêt de l'ancien suivi, aucune donnée COST€ écrasée. Un écart Matrice ↔ COST€ est **signalé**, jamais corrigé en silence. La fin de la transition est une décision explicite d'Anthony, artiste par artiste.
- [EN PLACE] Les frais Movinmotion ne figurent pas dans COST€ (normal).
- [DÉCIDÉ 27/10/2026, v1.46] **Un justificatif ne signifie jamais que la dépense est payée** : déposer une pièce (facture, bulletin, note de frais) remplit numéro, date du document, montant et fichier, jamais `paid_at` ; la date de paiement se note à part (`applyPiece`).

### 6.10 Statuts et pôles
| Entité | Codes stockés | Libellés affichés |
|---|---|---|
| Date (`shows.status`) | français (`Intérêt Salle`… `Sans Suite`), contrainte `CHECK` | identiques ; couleurs `STATUS_COLOR` |
| Suivi (`prospects.status`) | `Mailed`, `Interest`, `Option`, `Confirmed`, `Closed` | `PROSPECT_LABEL` |
| Tâche (`tasks.status`) | `To Do`, `In Progress`, `Done`, `Cancelled` | `TASK_STATUS_OPTS` |
| Priorité | `D-Day`… `Low` | `PRIORITY_LABEL` |
- [NOUVELLE] Les codes stockés ne changent jamais ; l'utilisateur ne voit **que** les libellés (y compris dans les exports). Ajout d'un statut = constante JS + contrainte `CHECK` SQL dans la même version.
- **Pôles** [DÉCIDÉ Q16] : chaque pôle a un **identifiant permanent** indépendant de son nom affiché ; les tâches et les automatisations (échéance par défaut du pôle Booking, relances, rattachement au suivi) référencent l'identifiant. **Renommer un pôle ne casse jamais** ses automatisations ni ses liens avec les tâches existantes. [CORRECTION] aujourd'hui le pôle est un texte (`tasks.department`, réglage `departments`) et « Booking » est reconnu par son nom (`/^booking$/i`, `department:'Booking'`). **D'ici la correction : ne pas renommer « Booking ».**

---

### 6.11 Indicateurs financiers [DÉCIDÉ 26/10, lot C1]
Trois indicateurs distincts (`financeOf`, vue Production), **jamais additionnés** (① et ② se recoupent) :
1. **Reste à encaisser — production** : Σ par date de production (cession − déjà encaissé).
2. **Factures émises impayées — production** : factures d'acompte et de solde de production émises et non réglées.
3. **Commissions à encaisser — booking** : factures de commission booking émises et non réglées.
Les factures de l'artiste sur les dates booking n'entrent dans **aucun** des trois.

## 7. Supabase

### 7.1 Nommage
- [EN PLACE] Tables : anglais, `snake_case`, pluriel. Colonnes `snake_case` ; clé étrangère `<entité>_id` ; tableau `<entité>_ids` ; jeton public `*_token`.
- [EN PLACE] Le suffixe `_at` désigne aujourd'hui soit une date (`show_payments.paid_at`) soit un horodatage (`tasks.done_at`) : toujours vérifier le type. [NOUVELLE] Nouvelles colonnes : `timestamptz` → `_at` ; `date` → nom sans `_at` ou suffixe `_on`. Aucun renommage de l'existant sans validation.
- [NOUVELLE] Objet technique temporaire : préfixe `_`, suppression **prévue et validée** (voir §7.8).

### 7.2 Relations et contraintes
- [EN PLACE] Clés étrangères : `ON DELETE CASCADE` pour les lignes dépendantes (paiements, journaux, fichiers de suivi, lignes de budget) ; `SET NULL` pour les rattachements.
- [NOUVELLE] Toute nouvelle colonne `*_id` a sa clé étrangère et son index.
- [DÉCIDÉ Q38] Correction des incohérences de structure : [CORRECTION] sans clé étrangère : `structure_events.structure_id`, `project_members.project_id`, `project_logs.project_id`, `attachments.*_id`, `notifications.*_id`, `projects.admin_structure_id`, `shows.prospect_id`, `prospects.mail_log_id` (aucune donnée orpheline au 21/10/2026) ; champs en double `projects.pennylane_customer_id` / `structures.pennylane_id`, capacité et tarif sur `structures` et `structure_events`. Avant d'ajouter une contrainte : contrôle des données existantes.
- [EN PLACE] `project_id` et `project_ids` coexistent sur `tasks` et `prospects` (lecture : `projIds()`), cohérents au 21/10/2026.
- Ville / département d'une date différents de ceux de sa structure (76 / 165 dates) : peut être voulu (lieu ≠ siège) ; ne pas « corriger » sans validation.

### 7.3 Sécurité et RLS
- [EN PLACE] RLS activé partout, politique `is_team()` (comptes de `app_users`). Pages publiques : uniquement via fonctions `SECURITY DEFINER` à jeton (`fiche_*`, `artist_*`, `rh_*`) et dépôt de fichiers vérifié par jeton (buckets `artiste`, `rh`).
- [NOUVELLE] Toute nouvelle fonction : `SET search_path = public`, `revoke execute … from public, anon` sauf page publique justifiée.
- [DÉCIDÉ Q38] Activer les protections pertinentes : [CORRECTION] 14 fonctions sans `search_path` ; `pg_net` dans le schéma public ; protection Auth contre les mots de passe compromis désactivée.

### 7.4 Secrets [DÉCIDÉ Q38]
- [EN PLACE] Clés Pennylane et IA : coffre privé (`private.import_secrets`), lues par `import_secret()` côté serveur, saisies par `set_pennylane_key` / `set_ai_key`.
- [NOUVELLE] Aucun secret dans `settings`, dans le code, dans un commentaire ou un message.
- [DÉCIDÉ 27/10/2026, CORRIGÉ v1.47] `brevo_api_key`, `brevo_hook_secret` et `drive_webhook_secret` restent dans `settings` (aucune intégration rebranchée) mais **ne sont plus lisibles ni modifiables par le navigateur** : règles d'accès `settings_team_*` (`is_secret_setting`) ; seuls la base (fonctions `SECURITY DEFINER`), les fonctions serveur et les scripts Google (clé serveur) les lisent. Navigateur : scripts Google appelés par le relais serveur `script-google` (compte de l'équipe vérifié, adresse du script contrôlée, code secret ajouté côté serveur ; coupé à 140 s, offre gratuite), « tout envoyer à Brevo » avec la session de l'utilisateur, clé Brevo saisie par `set_brevo_key` et état par `brevo_key_status` (jamais renvoyée). Script de prospection : code secret lu dans ses propriétés (`WEBHOOK_SECRET`), plus jamais injecté dans le code copié. Adresses où le serveur envoie le code secret : le navigateur n'y écrit qu'une adresse de script Google publiée (`…/exec`, règle `setting_write_ok` + contrôle dans les Réglages et dans `script-google`) ; `functions_base_url` n'est pas modifiable depuis le navigateur. Risque assumé : un compte de l'équipe peut toujours désigner un autre script Google publié. [CORRECTION] déplacement physique dans le coffre (`private.import_secrets`) : non fait, il imposerait de réécrire une dizaine de fonctions dont des fonctions techniques (§7.8). **Si une exposition est confirmée** (fuite hors des deux comptes de l'équipe), **rotation** de la clé ou du secret concerné (nouvelle clé Brevo, nouveau secret du script Google redéployé).
- La clé `anon` de `js/config.js` est publique par conception.
- [EN PLACE v1.47] Clé IA (Gemini) envoyée en en-tête (`x-goog-api-key`), jamais dans une adresse. Erreurs des fonctions IA : message français, détail technique seulement dans les journaux du serveur.
- [EN PLACE v1.47] **Politique de sécurité (CSP)** sur toutes les pages (balise générée par `tools/bump_version.py`) : scripts et styles du site seulement (+ polices Google), seul script en ligne permis = la carte d'import (empreinte recalculée à chaque version), connexions limitées à Supabase (production et test) et aux services de carte / d'adresses, aucun cadre ni objet. **Interdit** : gestionnaire d'événement en ligne (`onclick=`…), `eval`, script en ligne — contrôlé par `tests/static/check.mjs`. Un nouveau service appelé depuis le navigateur exige d'ajouter son adresse à la CSP (`CSP` dans `bump_version.py`).

### 7.5 Migrations [DÉCIDÉ Q38]
- [EN PLACE] Un fichier par version : `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql`, rejouable (`if not exists`, `create or replace`).
- [NOUVELLE] Application par le mécanisme de migrations de Supabase (historique enregistré), en plusieurs morceaux si l'outil refuse un lot ; un numéro de version unique par migration ; **interdit** : modifier une fonction par remplacement de texte (`pg_get_functiondef` + `replace`) — réécrire la fonction entière.
- [CORRECTION] mise en cohérence : 30 fichiers dans le dépôt, 13 enregistrés dans l'historique Supabase ; numéros en double (v1.18, v1.26, v1.36) ; `supabase/schema.sql` décrit 13 tables sur 26 (à régénérer depuis la base) ; une partie des objets (notifications, `generate_reminders`, `workday`, triggers de mode, nettoyage des contacts) n'existe que par migrations successives, dont l'ordre détermine le résultat ; `v1.32_brevo_mail2.sql` ne crée le trigger `brevo_contacts` que s'il existe déjà (installation neuve non garantie ; présent en production au 21/10/2026).

### 7.6 Opérations sensibles [DÉCIDÉ Q38]
Avant toute opération sensible (migration qui modifie des données, contrainte ajoutée sur des données existantes, déplacement de secret, correction en lot) : **vérifier que la sauvegarde de la nuit** (dépôt `lartbo-matrice-backup`) est récente et complète, **exporter les lignes concernées** avant modification, puis **vérifier après** (requête de contrôle). Toute modification de données historiques est validée par Anthony.

### 7.7 Synchronisation des données [EN PLACE]
- Au démarrage : toutes les tables de `TABLES` (`js/state.js`) en mémoire (`loadAll`), tenues à jour par le temps réel (`js/realtime.js`).
- Après une écriture qui déclenche un trigger : relire avec `refreshFor(table, col, ids)` ou `refreshShowSide(showId)`.
- [NOUVELLE] Toute modification directe de `S.db[table]` est suivie de `touch(table)`. Toute nouvelle table est ajoutée à `TABLES`, à la publication temps réel et à la sauvegarde (`backup-export`).

### 7.8 Suppression d'objets de la base [DÉCIDÉ Q38]
- **Interdiction** de supprimer automatiquement les 4 tables techniques (`_probe`, `_folder_jobs`, `_koza_job`, `_lartbotrice_job`), les 6 fonctions techniques (`_koza_tick`, `_lartbotrice_tick`, `_folder_tick`, `_push`, `_push_table`, `_export_ddl*`) ou **toute autre donnée ou structure**.
- Une suppression éventuelle exige : recherche des dépendances (code JS, fonctions SQL, triggers, tâches planifiées `cron`, fonctions edge, Apps Script, sauvegarde), puis **validation spécifique** d'Anthony, objet par objet.
- **Ne jamais considérer qu'un objet est inutilisé** uniquement parce qu'aucune référence évidente n'apparaît dans le code.

### 7.9 Erreurs côté serveur [NOUVELLE]
Fonctions edge et Apps Script renvoient `{ ok:false, error:'message français' }`, jamais une exception brute ; une intégration externe (Pennylane, Brevo, Drive, Gmail, IA) réessaie seule sur saturation (429/503) avec délai croissant et ne crée jamais deux fois le même objet (contrôle de doublon avant création).

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
| Lien d'une page publique (fiche, artiste, salarié ; « &test » en test) | `publicLink`, `linkLabel` | `js/selectors.js` |
| Stockage du navigateur (séparé production / test) | `localGet`, `localSet`, `localDel` | `js/storage.js` |
| CSV | `downloadCSV`, `parseCSV` | `js/utils.js` |
| Réglage | `setting(k)` | `js/selectors.js` |
| Lectures | `byId`, `projIds`, `projNames`, `linksOfStructure`, `paymentsOf`… | `js/selectors.js`, `js/calc.js` |
| Écritures | `save`, `saveLinger`, `insert`, `remove`, `removeWhere`, `refreshFor`, `uploadFiles`, `openStored` | `js/data.js` |
| Script Google production@ | `callScript(action, payload)` | `js/mail.js` |
| Script Google anthony@ (prospection) | `callProspect(action, payload)` | `js/prospection.js` |
| Fonctions serveur | `sb.functions.invoke(nom, {body, headers:{'x-region':'eu-west-3'}})` | |

### 8.3 Dépendances [NOUVELLE]
- Aucun nouvel import circulaire. Une couche basse (`data.js`, `selectors.js`, `utils.js`, `calc.js`, `budget.js`, `ui/*`) n'importe jamais une vue (`views/*`), `actions.js` ou `forms.js`.
- Une vue n'importe pas une autre vue pour réutiliser un fragment : le fragment va dans `ui/` ou dans un module métier. Pas d'import dynamique pour contourner un cycle.
- Pages publiques : importent `js/utils.js` plutôt que de recopier `esc`, `eur`, `toast`.
- [CORRECTION] cycle de 41 modules (cause principale : `render` importé depuis `app.js` par `data.js`, `commission.js`, `budget-template.js`, `ui/modal.js`, `ui/projmenu.js`) ; `forms.js` importe `views/production.js` ; `views/projects.js` importe `views/structures.js` et `views/todo.js` ; `actions.js` importe 4 vues ; `app.js` appelle `toast` sans l'importer.

### 8.4 Cohérence JS ↔ SQL ↔ fonctions serveur ↔ Apps Script [NOUVELLE]
Une règle présente des deux côtés est modifiée **dans la même version** des deux côtés, et le commentaire de chaque côté cite l'autre :
| Règle | JS | Autre côté |
|---|---|---|
| Rappels (délais, boucle technique, factures à envoyer, impayés sans limite, relances suspendues, commission ; acompte caduc ; booking sans acompte/solde) | `js/reminders.js` | SQL `generate_reminders`, déclencheur `show_payments_invoiced_on` (migration v1.46) ; `pennylane/index.ts` (`invoiced_on` à la liaison) |
| Facture émise : définition (commission de production = seulement son versement), refus de modification / d'effacement / de suppression ; mode figé d'une date facturée | `js/calc.js` (`isInvoiced`, `emittedFieldsOf`, `changeBlocked`) | SQL déclencheur `show_payments_emitted_guard`, `project_mode_to_shows`, `show_follow_project_mode` (migration v1.40, adaptée lot C1) ; `pennylane/regles.ts` (`emise`) |
| Montant figé à l'émission / au versement ; cachet, %, TVA, mode d'une date engagée (lot D1) | `js/calc.js` (`freezeOnEmit`, `changeBlocked`, `hasFinancialRecord`), `js/actions.js` (avertissement) | SQL `show_payments_freeze`, `shows_frozen_guard`, `show_has_financial_record`, `project_mode_to_shows`, `show_follow_project_mode` (migration v1.42) ; `pennylane/regles.ts` (`figerMontant`) |
| Commission de production : total + versements, reste à transférer, rappels (lot D1) | `js/calc.js` (`commissionState`, `transfersOf`), `js/budget.js` (`accountOf`, `accountMoves`), `js/reminders.js` | SQL `commission_total`, `commission_transferred`, déclencheurs `commission_transfer_*`, `show_payments_commission_*`, `generate_reminders` (migration v1.43) |
| Solde à facturer (cession − acomptes facturés), booking hors suivi | `js/calc.js` (`soldeDue`, `payAmount`, `tracked`, `freezeOnEmit`) | `pennylane/regles.ts` (`montantAttendu`, `payable`, `relieAuDevis`, `factureIsolee`, `rangeeDansLeDrive`) |
| Coproduction : aucune ligne de facturation ni commission générée ; lignes « hors calcul » ignorées partout (lot D1, v1.44) | `js/calc.js` (`paymentsOf`, `counted`, `isCoproduction`, `financeOf`, `changeBlocked`), `js/budget.js` (`commissionAmount`), `confirm-flow.js`, `views/production.js`, `mail.js`, `views/settings.js` | SQL `payment_is_emitted`, `show_has_financial_record`, `generate_reminders`, `on_show_confirmed`, `ensure_production_payments`, `fiche_get`, `mail_vars`, déclencheur `show_payments_hors_calcul_guard` (migration v1.44) ; `pennylane/index.ts` |
| Acompte caduc : ne s'émet plus (production) | `js/calc.js` (`acompteState`, `changeBlocked`) ; `budget-actions.js` (`attachableLines`) | SQL déclencheur `show_payments_caduc_guard` (migration v1.41 acompte caduc) ; `pennylane/regles.ts` (`caduc`) |
| Jour ouvré | `workDay` | SQL `workday` |
| Montant HT d'une ligne | `payAmount` | vue `show_payments_computed`, `fiche_get`, `pennylane/index.ts` |
| Commission par défaut | `showCommissionPct`, `defaultCommission`, `projectCommission` (`payAmount`, `commissionAmount`) | SQL `default_commission_pct` (`payment_amount_for`, `on_show_confirmed`, migration v1.46), `pennylane/regles.ts` (`pctCommission`) |
| Acompte / solde par défaut, solde figé | `defaultAcompte`, `rebalanceSolde`, `confirm-flow.js`, `views/settings.js` | SQL `ensure_production_payments`, `on_show_confirmed` (migration v1.46) |
| Mode des dates | (fonction unique à créer) | SQL `shows_defaults`, `project_mode_to_shows`, `show_follow_project_mode` |
| Ligne Movinmotion | `budget-template.js`, `syncMovinmotionLine` | SQL `ensure_movinmotion` |
| Date longue, euros | (fonction unique à créer), `eur` | SQL `fr_date`, `fr_eur` |
| Prénom de contact | `firstName` | SQL `contact_first_name` |
| Lien de page publique (« &test » dans l'espace de test) | `publicLink` (`selectors.js`), `mailVars` (`mail.js`) | SQL `mail_vars` (`{{lien_fiche}}`, sans « &test » : complété côté JS ; fonction SQL inchangée, décision du 22/10/2026) |
| Mails / téléphones | `mailOk`, `checkMails` (`js/utils.js`) | SQL `contacts_clean` (v1.50 : ne déplace plus), `clean_phone`, `clean_email` |
| Choix et remplissage des modèles de mail | `js/mail.js` | `apps-script/Code.gs` (`applies_`, `pickTemplate_`, `fill_`) |
| Nom du lieu sans code, département | `contract.js` (`deptOf`) | `Code.gs` (`dept_`, `cpDept_`) ; SQL `mail_vars` (regex différente) |
| Nom du fichier de contrat | `contract.js` | `Code.gs` `contractName_` |
| Exercice comptable (oct. → sept.) | `views/projects.js` `fiscalYear` | `Code.gs` `financeYear_` |
| Encodage des mails Gmail | — | `Code.gs` ≈ `Prospection.gs` |

### 8.5 Interdiction des duplications [NOUVELLE]
Avant d'écrire une fonction utilitaire : chercher si elle existe. Une fonction utile à plusieurs modules va dans `js/utils.js` (sans dépendance) ou dans le module métier concerné.
[CORRECTION] `r2` ×6, `num` ×3, `addDays` et équivalents ×7, `esc`/`toast` ×4 (pages publiques), `safeName` ×2, `callScript`/`callProspect`, hauteur automatique ×2 (`ui/modal.js`, `ui/autogrow.js`), `projmenu` ≈ `projpicker`, `isOwnProd` ×2 dans `budget.js`, listes `LOG_KINDS` recopiées.

### 8.6 Scripts Google
- [EN PLACE] Le code est dans `apps-script/` ; Anthony le recopie dans l'éditeur Apps Script et redéploie (Réglages › Google › « Copier le code à jour »). Une action inconnue du script déployé produit « Le script Google … n'est pas à jour ».
- [NOUVELLE] Toute nouvelle action du script est tolérante à l'ancien script (message clair, pas de plantage) et signalée dans le compte rendu.
- **Indicateur de version** [DÉCIDÉ Q37] : Réglages › Google affiche, pour **chaque** script (Code.gs production@, Prospection.gs anthony@), l'un des trois états : **« À jour »**, **« Mise à jour nécessaire »**, **« Impossible à vérifier »**. L'état repose sur une **vérification réelle** : appel au script déployé qui renvoie sa version (numéro écrit dans le code du script), comparé à la version du fichier du dépôt publiée avec l'app ; réponse absente, erreur ou script sans numéro → « Impossible à vérifier » (jamais « À jour » par défaut). [CORRECTION] à créer : aujourd'hui `ping` ne renvoie que le compte.

---

## 9. Tests [DÉCIDÉ Q36]
- Les tests automatiques sont **conservés dans GitHub** (dossier `tests/` du dépôt, Playwright avec données simulées de Supabase), lancés par une commande unique documentée, sans rien publier sur le site.
- Ils couvrent au minimum : **parcours critiques** (créer une date → confirmer → factures → budget ; prospection → relance ; tâche → terminer), **formulaires** (saisie, obligatoires, brouillons, virgule, dates), **filtres** (persistance, réinitialisation, filtre Artistes commun), **suppressions** (confirmation, annulation 5 s, fichiers), **calculs financiers** (commission, acompte/solde, solde figé, cachet, budget, compte, encaissements « Non renseigné »), **principaux affichages** (ordinateur, tablette 1 024–1 100 px, téléphone).
- **Toute correction future est accompagnée de tests** qui auraient détecté le problème et qui protègent contre sa réapparition.
- [CORRECTION] à installer : aujourd'hui les scripts de test existent seulement dans l'espace de travail temporaire des sessions (non versionnés).

---

## 10. Récapitulatif des corrections futures (non faites)
Ordre indicatif ; chaque chantier respecte `CLAUDE.md` §8 (autorisation Q0) et ses tests.
1. **Argent** : commission 15/0 en dur et ancien réglage (§6.3) ; acompte 0→50 et défaut 20 du SQL (§6.4) ; blocage du solde après envoi et procédure de régularisation à définir (§6.4) ; cachet : question conserver/recalculer partout (§6.5) ; compte d'encaissement « Non renseigné » exclu des soldes + demande à l'encaissement (§6.6) ; revue des 225 lignes avec Anthony (§6.6).
2. **Modes** : trigger `project_mode_to_shows` limité aux dates futures non facturées ; fonctions uniques booking / production propre (§6.7).
3. **Rappels** : boucle technique 4 mois + vendredi ; impayés sans limite ; commission au premier encaissement côté serveur ; deux réglages de délai ; libellés identiques (§6.8, §1.6).
4. **Pôles** : identifiants permanents (§6.10).
5. **Tâches, suppressions, fenêtres** : `done_at` systématique ; suppression = confirmation + 5 s + effacement différé avec fichiers ; fenêtres de l'app à la place de `alert/confirm/prompt` (§4.3–4.5).
6. **Formats et saisies** : heure de Paris partout ; date longue unique ; centimes selon le contexte ; « 50 % » ; mails refusés sans déplacement ; téléphones nettoyés sans altération (§1, §2, §3.4).
7. **Navigation** : liens directs ; filtres persistants + « Réinitialiser les filtres » ; tri des dates sur les fiches ; recherche des structures par contact ; changements de vue par `go()` (§4.8, §5).
8. **Supabase** : secrets, contraintes, `search_path`, protection des mots de passe, historique des migrations, `schema.sql` (§7) ; aucune suppression d'objet sans validation (§7.8).
9. **Documentation** : `README.md` à mettre à jour (page `artiste.html` et `js/artiste.js`, modules budget, Brevo, Pennylane, temps réel, fonctions edge récentes, `css/fiche.css`, factures désormais créées et rangées via Pennylane).
10. **Architecture** : cycle d'imports, `toast` non importé dans `app.js`, doublons (§8.3, §8.5), écarts JS ↔ SQL (§8.4).
11. **Outillage** : tests dans le dépôt (§9) ; indicateur de version des scripts Google (§8.6).
