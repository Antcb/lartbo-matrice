# PLAN_EXECUTION.md — Mise en conformité de la Matrice avec le référentiel

Plan établi le 22/10/2026 à partir de `CLAUDE.md`, `CONVENTIONS.md`, `DESIGN_SYSTEM.md`, `QA_CHECKLIST.md` (intégrés à `main` avec ce plan), de l'audit du code, des analyses Greptile antérieures (PR n°1 ; la question du 21/10 à 21 h 51 UTC sur les zones à risque de régression est restée **sans réponse** — non vérifié par Greptile) et d'une lecture seule de Supabase (projets `Lartbo-matrice` et `Lartbo-matrice-test`).
**Statut : proposition, en attente de validation d'Anthony. Aucun lot n'est commencé.**

> **Mise à jour du 22/10/2026** : les fiches S0, F1 et S1 à S7 sont remplacées par l'annexe détaillée [`PLAN_SECURITE.md`](PLAN_SECURITE.md) (constat sur les secrets, nouvel ordre, vérifications de Q19).

Règles qui s'appliquent à chaque lot : `CLAUDE.md` (dont §8, autorisation Q0), tests avant intégration, `QA_CHECKLIST.md` adaptée, relecture indépendante sans bloquant (`CLAUDE.md` §6), une branche par lot, **aucune fusion dans `main` sans l'accord d'Anthony**, aucune donnée historique supprimée, aucune table ou fonction supprimée sans autorisation spécifique.

---

## 1. Résumé des principaux problèmes et risques

| # | Problème | Gravité | Lots |
|---|---|---|---|
| 1 | **Secrets lisibles par le navigateur** : clé API Brevo, code secret du webhook Brevo et **code secret des scripts Google** sont dans `settings`, et le navigateur les envoie lui-même (appels directs à Apps Script et à `brevo-sync`, code de Prospection.gs rempli dans le navigateur). Les sortir du navigateur impose de faire passer ces appels par le serveur. | Haute | S2, S3 |
| 2 | **Aucun test versionné** : chaque correction risque une régression invisible. | Haute | F1 |
| 3 | **Production directe** : un push sur `main` publie le site, et Supabase n'a pas d'environnement de recette à jour (le projet de test existe mais il lui manque des tables et des migrations). | Haute | S0, F1 |
| 4 | **Factures modifiables après envoi** : rien n'empêche un acompte ou un recalcul de modifier un solde déjà envoyé ; commission par défaut à 15 % ou 0 selon l'endroit ; acompte 0 % transformé en 50 %. | Haute | B1–B3 |
| 5 | **Encaissements sans compte** : 225 lignes, affichées « L'ArtBo » mais comptées sur le compte dédié. | Haute | B5, B6 |
| 6 | **Changement de mode d'un artiste** : modifie toutes les dates, y compris passées et facturées. | Haute | B7 |
| 7 | **Suppressions** : immédiates, sans annulation, fichiers orphelins ; la règle décidée (attente de 5 s gérée par le serveur) demande une nouvelle architecture. | Moyenne | B13, B14 |
| 8 | **Fenêtres natives** (43 `confirm`/`prompt`/`alert` au comptage automatique du 22/10/2026, référence `tests/baselines/fenetres-natives.json`), dont un « Annuler » qui supprime quand même et un mot de passe saisi en clair. | Moyenne | B11, B12 |
| 9 | **Dates en heure universelle** à plusieurs endroits (Pennylane, mails après minuit, notifications) ; rappels différents entre l'app et le serveur. | Moyenne | F4, F9 |
| 10 | **Cycle d'imports de 41 modules** et rendu global : toute modification de `data.js`, `app.js` ou de la navigation peut casser des écrans éloignés. | Moyenne (risque) | F6 |
| 11 | **Base** : 13 migrations enregistrées sur 30, `schema.sql` périmé, clés étrangères manquantes, fonctions sans `search_path`, fonction edge `pl-probe` déployée mais absente du dépôt. | Moyenne | S4, F7, F8 |
| 12 | **Design** : 140 tailles de police, 470 marges, 27 couleurs et 82 styles inline en dur ; défauts responsive confirmés. | Basse (visible) | Phase 4 |

---

## 2. Ordre recommandé (et écarts par rapport à l'ordre des phases)

1. **S0 puis F1 avant tout le reste** : sans environnement de recette ni tests versionnés, aucun lot ne peut être validé sans toucher la production. F1 (Phase 2) est donc avancé en tête.
2. **Phase 1 — Sécurité** : S1 → S2 → S4 → S5 → S6, puis S3 (le plus lourd).
3. **Socle technique de la Phase 2** avant les fonctionnalités : F2, F3, F5, F6, F4, F7, F8, F9, F10.
4. **B11 (fenêtre de dialogue) au début de la Phase 3** : B4, B12, B14 et S3 (saisie du mot de passe) en dépendent.
5. **Phase 3** : argent d'abord (B1 → B2 → B3 → B4 → B5 → B6), puis modes (B7), délais et pôles (B8, B9), tâches (B10), suppressions (B13 → B14), navigation (F6 requis → B15, B16, B17, B18), saisies et formats (B19, B20), scripts Google (B21), COST€ (B22).
6. **Phase 4 — Design** en dernier, sauf D6-a (défauts responsive confirmés) qui peut passer tôt car il est isolé.

Durée : non estimée en jours ; chaque lot est conçu pour être livré et validé seul.

---

> **Ajout du 22/10/2026** : alertes CodeQL analysées dans `PLAN_SECURITE.md` §7 ; nouveaux lots **S8** (messages d'erreur des fonctions serveur) et **S9** (bibliothèques externes copiées localement, proposé comme premier lot de code après l'intégration du référentiel).

## 3. Dépendances techniques importantes

- **S0 (recette à jour)** est requis par tout lot qui touche Supabase.
- **F1 (tests)** est requis par tous les lots.
- **F3 (fonctions communes)** précède F4, F9, B20 (une seule fonction de date, de mois, d'arrondi).
- **F6 (casser le cycle `render` ↔ `data`)** précède B11, B15, B16 (fenêtres asynchrones, routeur, filtres).
- **B11 (fenêtre de dialogue)** précède B4 (question conserver/recalculer), B12 (remplacement des fenêtres natives), B14 (confirmation de suppression), B5 (demande du compte d'encaissement), S3 (mot de passe).
- **B13 (serveur de suppression différée)** précède B14 (côté application).
- **B1 → B2 → B3** touchent les mêmes fonctions (`calc.js`, `actions.js` `rebalanceSolde`/`setBill`, `confirm-flow.js`, `ensure_production_payments`, `on_show_confirmed`) : à faire dans cet ordre, un par un.
- **Lots avec script Google** (S3, B21) : effet réel seulement après redéploiement manuel par Anthony.
- **Règles écrites des deux côtés** (`CONVENTIONS.md` §8.4) : chaque lot concerné modifie JS **et** SQL/edge dans la même version.

---

## 4. Plan détaillé par phases et par lots

Format de chaque lot : priorité · problèmes corrigés · fichiers · Supabase · dépendances · risques de régression · tests · décisions/autorisations · critères de fin.

### Préalable

#### S0 — Remettre l'environnement de recette à niveau
- **Priorité** : bloquante.
- **Corrige** : impossibilité de tester sans toucher la production (le projet `Lartbo-matrice-test` n'a pas `client_errors`, `_folder_jobs`, et une partie des migrations récentes).
- **Fichiers** : `supabase/migrations/*` (lecture), `js/config.js` (aucune modification : le mode `?test` existe déjà).
- **Supabase** : appliquer sur le **projet de test uniquement** les migrations manquantes ; comparer les deux schémas (tables, colonnes, fonctions, triggers, cron) jusqu'à égalité.
- **Dépendances** : aucune.
- **Risques** : nul pour la production ; données de test différentes de la production (copie partielle).
- **Tests** : comparaison automatique des schémas ; ouverture de l'app en `?test`.
- **Autorisation** : appliquer des migrations sur le projet de test.
- **Fin** : schémas identiques (hors données), app fonctionnelle en `?test`, procédure écrite dans `README.md` (section « Recette »).

### Phase 1 — Sécurité

#### S1 — Sauvegarde vérifiée et point de restauration
- **Priorité** : bloquante pour tout lot sensible.
- **Corrige** : absence de vérification de la sauvegarde avant les opérations sensibles (Q38).
- **Fichiers** : `backup/README.md` (lecture), dépôt privé `lartbo-matrice-backup`, fonction `backup-export`.
- **Supabase** : aucune modification ; vérifier que la sauvegarde de la nuit contient toutes les tables (26) et les fichiers des 3 buckets.
- **Dépendances** : aucune.
- **Risques** : aucun.
- **Tests** : restauration d'essai d'une table sur le projet de test.
- **Autorisation** : accès au dépôt privé de sauvegarde (à ajouter à la session si besoin).
- **Fin** : rapport « sauvegarde complète et restaurable », procédure d'export ponctuel avant opération sensible écrite.

#### S2 — Clé API Brevo hors des réglages
- **Priorité** : haute.
- **Corrige** : `brevo_api_key` lisible par le navigateur (Q38).
- **Fichiers** : `supabase/functions/brevo-sync/index.ts` (lecture de la clé), `js/views/settings.js` (saisie de la clé via une fonction dédiée, sur le modèle de `set_pennylane_key`), `js/actions.js` (test Brevo).
- **Supabase** : nouvelle fonction `set_brevo_key` (coffre `private.import_secrets` ou Vault) ; après vérification en recette puis en production, **retrait** de la valeur de `settings` (la ligne reste, vidée — pas de suppression de structure).
- **Dépendances** : S0, S1, F1.
- **Risques** : synchronisation Brevo interrompue si la fonction ne lit plus la clé ; trigger `brevo_contact_trg` à vérifier.
- **Tests** : création d'un contact en recette → contact créé dans Brevo (compte de test ou contrôle par l'API) ; Réglages › Brevo : état de la clé affiché sans la clé.
- **Autorisation** : retrait de la clé de `settings` en production ; **rotation de la clé** dans Brevo si Anthony juge qu'il y a eu exposition (intervention manuelle d'Anthony dans Brevo).
- **Fin** : plus aucune clé Brevo lisible par le navigateur ; synchronisation vérifiée en production.

#### S3 — Codes secrets des scripts Google et du webhook Brevo hors du navigateur
- **Priorité** : haute (lot le plus lourd de la phase).
- **Corrige** : `drive_webhook_secret` et `brevo_hook_secret` lus et envoyés par le navigateur (`mail.js` `callScript`, `prospection.js` `callProspect`, `actions.js` copie du script et appel `brevo-sync`).
- **Fichiers** : nouvelle fonction edge « relais » (appel des scripts Google pour l'équipe connectée, `is_team()` vérifié), `js/mail.js`, `js/prospection.js`, `js/actions.js`, `js/views/settings.js`, `apps-script/Code.gs` et `Prospection.gs` (aucun changement de logique, éventuellement nouveau secret).
- **Supabase** : secrets dans le coffre ; fonctions SQL qui appellent les scripts (`v1.7`, `v1.28` : `request_drive_folder`, fiche artiste) lisent le secret depuis le coffre.
- **Dépendances** : S0, S1, F1, B11 (copie du code du script sans exposer le secret : nouvelle façon de transmettre le secret à Anthony).
- **Risques** : **tous** les appels Drive, Gmail, contrats, prospection, salariés passent par le relais : régression possible sur chacun ; délai de 6 min des scripts à respecter ; temps de réponse.
- **Tests** : chaque action des scripts (`ping`, dossier de date, dossier artiste, brouillon, prospection, contrat, pièces RH, rangement de factures) en recette.
- **Autorisation** : architecture du relais ; **nouveau secret** des scripts (rotation) = **redéploiement manuel des deux scripts par Anthony**.
- **Fin** : `setting('drive_webhook_secret')` et `brevo_hook_secret` absents du navigateur ; toutes les actions des scripts vérifiées en production après redéploiement.

#### S4 — Durcissement des fonctions et de l'authentification
- **Priorité** : haute.
- **Corrige** : 14 fonctions sans `search_path`, droits `anon` sur des fonctions de trigger, protection Auth contre les mots de passe compromis désactivée (Q38).
- **Fichiers** : nouvelle migration ; aucun JS.
- **Supabase** : `alter function … set search_path = public` (sans réécrire les fonctions) ; `revoke execute … from anon` sur les fonctions de trigger ; `pg_net` dans le schéma public **laissé tel quel** (le déplacer peut casser les appels existants — à réévaluer séparément).
- **Dépendances** : S0, S1.
- **Risques** : une fonction appelée par les pages publiques perd ses droits → pages publiques cassées.
- **Tests** : fiche, artiste, rh en recette (lecture + envoi) ; alertes de sécurité Supabase relancées.
- **Autorisation** : activation de la protection des mots de passe dans le tableau de bord Supabase (**intervention manuelle d'Anthony**, non faisable par les outils disponibles).
- **Fin** : alertes `function_search_path_mutable` et `anon_security_definer` (fonctions de trigger) à zéro ; pages publiques vérifiées.

#### S5 — Contenus HTML et injections
- **Priorité** : moyenne.
- **Corrige** : nettoyage `safeHtml` incomplet (n'élimine pas `xlink:href`, `data:`, `srcdoc`, SVG) pour les mails affichés ; audit des `innerHTML` sans `esc` ; pages publiques avec leurs propres `esc`.
- **Fichiers** : `js/utils.js` (`safeHtml`, `md`), `js/ui/richtext.js`, `js/mail.js`, `js/views/suivi.js` (journal HTML), pages publiques.
- **Supabase** : aucune.
- **Dépendances** : F1.
- **Risques** : mise en forme d'anciens mails modifiée par un nettoyage plus strict.
- **Tests** : jeux d'entrées malveillantes (balises, attributs, liens `javascript:` et `data:`) sur journal, mails, notes, fiches publiques.
- **Autorisation** : aucune (correction Q0).
- **Fin** : aucun script exécutable injectable ; affichage des mails existants inchangé.

#### S6 — Pages publiques : erreurs et jetons
- **Priorité** : moyenne.
- **Corrige** : messages techniques bruts montrés aux organisateurs, artistes et salariés (E2) ; contrôle des fonctions à jeton (`fiche_*`, `artist_*`, `rh_*`).
- **Fichiers** : `js/fiche.js`, `js/artiste.js`, `js/rh.js`.
- **Supabase** : lecture des fonctions à jeton ; aucune modification sans constat.
- **Dépendances** : F1.
- **Risques** : faibles.
- **Tests** : envoi de fiche avec réseau coupé, jeton invalide, fichier trop gros.
- **Autorisation** : aucune.
- **Fin** : messages en français uniquement ; un jeton ne donne accès qu'à sa date / son artiste / son salarié.

#### S7 — Inventaire des objets non versionnés
- **Priorité** : basse.
- **Corrige** : fonction edge `pl-probe` déployée mais absente du dépôt ; 4 tables et 6 fonctions techniques.
- **Fichiers** : aucun (rapport).
- **Supabase** : lecture seule ; recherche des dépendances (cron, triggers, appels).
- **Dépendances** : aucune.
- **Risques** : aucun (pas de suppression).
- **Autorisation** : **chaque suppression éventuelle fera l'objet d'une demande spécifique** (Q38).
- **Fin** : rapport par objet (utilité, dépendances, recommandation) remis à Anthony.

### Phase 2 — Fiabilité

#### F1 — Tests automatiques dans le dépôt (avancé en tête)
- **Priorité** : bloquante.
- **Corrige** : tests non versionnés (Q36).
- **Fichiers** : nouveau dossier `tests/` (Playwright + `mock-supabase.js` + données simulées), `package.json` de test, documentation dans `README.md` ; aucun fichier de l'application.
- **Supabase** : aucune (tests sur données simulées ; un second niveau de tests sur le projet de test pour les triggers et fonctions SQL).
- **Dépendances** : aucune.
- **Risques** : aucun pour l'application.
- **Tests** : la suite elle-même, couvrant au départ les parcours critiques existants (création → confirmation → factures → budget ; prospection → relance ; tâche → terminer ; suppression ; filtres ; budget et compte ; affichage ordinateur, tablette 1 024–1 100 px, téléphone).
- **Autorisation** : emplacement `tests/` et une commande unique (`npm test` dans `tests/`).
- **Fin** : suite lancée en une commande, verte sur `main` actuel, documentée ; chaque lot suivant y ajoute ses tests.

#### F2 — Bugs techniques isolés
- **Priorité** : haute (rapide).
- **Corrige** : `toast` non importé dans `app.js` ; `addY` qui produit le 29/02/2029 (`views/suivi.js`) ; listes `LOG_KINDS` recopiées.
- **Fichiers** : `js/app.js`, `js/views/suivi.js`, `js/actions.js`, `js/forms.js`, `js/views/projects.js`.
- **Supabase** : aucune.
- **Dépendances** : F1.
- **Risques** : faibles.
- **Tests** : saisie d'un nombre illisible hors `numfield` ; date « jusqu'au » au 29 février ; types d'échange.
- **Autorisation** : aucune (Q0).
- **Fin** : tests verts, aucun changement visible hors correction.

#### F3 — Fonctions communes (dates, arrondis, utilitaires)
- **Priorité** : haute.
- **Corrige** : `r2` ×6, `addDays`/équivalents ×7, `num` ×3, `safeName` ×2 ; création des fonctions uniques (ajout de jours/mois, date longue `longDate`, arrondi) **sans changer les résultats** sauf la date longue de prospection (« 1er », Q21).
- **Fichiers** : `js/utils.js`, `js/calc.js`, `js/budget.js`, `js/views/budget.js`, `js/actions.js`, `js/confirm-flow.js`, `js/production-budget.js`, `js/contract.js`, `js/prospection.js`, `js/forms.js`, `js/views/suivi.js`.
- **Supabase** : `fr_date` aligné sur la date longue décidée (jour en minuscule, majuscule ajoutée par les modèles en début de phrase) — **vérifier tous les modèles de mail qui commencent par la date**.
- **Dépendances** : F1.
- **Risques** : un mail ou contrat dont la date ouvre la phrase perd sa majuscule ; arrondis : écart de 0,01 € si une copie de `r2` se comportait différemment (`production-budget.js`).
- **Tests** : tableaux de cas (montants, dates limites, week-ends, 29 février, 31 → 4 mois) avant/après identiques ; rendu des modèles de mail.
- **Autorisation** : liste des modèles de mail à adapter (majuscule) montrée à Anthony.
- **Fin** : une seule fonction par besoin, `grep` sans copie, tests verts.

#### F4 — Heure de Paris partout
- **Priorité** : haute.
- **Corrige** : jour UTC dans `pennylane/index.ts` (date de devis/facture, `paid_at` par défaut), `prospection.js` `checkProspect` (date du mail et donc relance), `data.js` (.eml), `.slice(0,10)` sur horodatages (~20 endroits : notifications, « Faite le », envois).
- **Fichiers** : ceux listés + vues concernées.
- **Supabase** : redéploiement de `pennylane`.
- **Dépendances** : F1, F3.
- **Risques** : dates affichées qui changent d'un jour pour les actions faites entre 0 h et 2 h (c'est le but).
- **Tests** : horloge simulée à 0 h 30 (Paris) sur chaque cas (QA H4).
- **Autorisation** : aucune (Q0).
- **Fin** : QA H1–H4 validés.

#### F5 — Messages d'erreur fiables
- **Priorité** : moyenne.
- **Corrige** : messages bruts (`views/settings.js`, `syncLinks`, `actions.js`), échecs silencieux (`removeWhere`, `syncLinks`, `refreshFor`).
- **Fichiers** : `js/data.js`, `js/actions.js`, `js/views/settings.js`.
- **Supabase** : aucune.
- **Dépendances** : F1.
- **Risques** : messages plus nombreux en cas de réseau instable.
- **Tests** : refus simulés sur chaque écriture.
- **Autorisation** : aucune.
- **Fin** : QA E1–E2 validés.

#### F6 — Casser le cycle d'imports du rendu
- **Priorité** : haute (prérequis technique).
- **Corrige** : `data.js`, `commission.js`, `budget-template.js`, `ui/modal.js`, `ui/projmenu.js` importent `render` depuis `app.js` (cycle de 41 modules) ; `forms.js` importe une vue ; imports dynamiques de contournement.
- **Fichiers** : `js/app.js`, `js/data.js`, `js/state.js` (point d'enregistrement du rendu), modules cités ; déplacement de `driveHTML` hors de `views/production.js`.
- **Supabase** : aucune.
- **Dépendances** : F1.
- **Risques** : **élevés** — ordre de chargement des modules, écran blanc au démarrage, rendu non rafraîchi après une écriture.
- **Tests** : suite complète + démarrage à froid, connexion, temps réel (deux onglets).
- **Autorisation** : aucune décision métier ; validation après tests.
- **Fin** : plus de cycle passant par `app.js` (vérifié par un script d'analyse des imports ajouté aux tests).

#### F7 — Historique des migrations et schéma documenté
- **Priorité** : moyenne.
- **Corrige** : 13 migrations enregistrées sur 30, numéros en double, `schema.sql` périmé, trigger `brevo_contacts` non recréé sur une installation neuve.
- **Fichiers** : `supabase/schema.sql` (régénéré), `supabase/migrations/` (nouveau fichier de rattrapage idempotent), `README.md`.
- **Supabase** : enregistrement de l'historique **sans modifier les objets** ; vérification que le schéma régénéré recrée une base identique (essai sur une base vide de test).
- **Dépendances** : S0, S1.
- **Risques** : faible si aucun objet n'est modifié.
- **Tests** : comparaison schéma production ↔ schéma reconstruit.
- **Autorisation** : écriture dans l'historique des migrations de la production.
- **Fin** : historique complet, `schema.sql` à jour, installation neuve identique.

#### F8 — Contraintes de liens manquantes
- **Priorité** : moyenne.
- **Corrige** : clés étrangères absentes (`structure_events`, `project_members`, `project_logs`, `attachments`, `notifications`, `projects.admin_structure_id`, `shows.prospect_id`, `prospects.mail_log_id`) ; index manquants.
- **Fichiers** : nouvelle migration.
- **Supabase** : contrôle d'orphelins **avant** (0 au 21/10/2026), ajout des contraintes (`SET NULL` ou `CASCADE` selon le cas — à valider ligne par ligne) ; **aucune donnée supprimée**.
- **Dépendances** : S1, F7.
- **Risques** : une contrainte `CASCADE` mal choisie supprime des lignes liées lors d'une future suppression.
- **Tests** : création/suppression en recette pour chaque lien.
- **Autorisation** : **tableau des comportements de suppression par lien** à valider par Anthony.
- **Fin** : alertes Supabase de liens sans index traitées ; aucun orphelin possible.

#### F9 — Rappels identiques dans l'app et sur le serveur
- **Priorité** : haute.
- **Corrige** : boucle technique J-4 mois → vendredi si week-end (Q12) ; impayés sans limite, une notification par échéance (Q13) ; commission au premier encaissement côté serveur (Q14) ; libellés communs.
- **Fichiers** : `js/reminders.js` ; migration `generate_reminders` (réécriture complète).
- **Supabase** : `generate_reminders` ; **ne pas** renuméroter les anciennes notifications.
- **Dépendances** : F1, F3, S0.
- **Risques** : lors du premier passage, des notifications d'anciens impayés (> 120 jours) apparaissent une fois — **prévoir l'aperçu de la liste avant mise en production**.
- **Tests** : SQL en recette (jeux de dates, double exécution sans doublon), app (rouge identique).
- **Autorisation** : validation de la liste des notifications que le premier passage créera.
- **Fin** : QA G4 validé ; mêmes échéances app/serveur sur un jeu de 50 dates.

#### F10 — Mise à jour du README
- **Priorité** : basse.
- **Corrige** : README incomplet (artiste.html, modules récents, Pennylane, Brevo, temps réel, fonctions edge, `fiche.css`, factures désormais automatisées).
- **Fichiers** : `README.md`.
- **Dépendances** : aucune. **Fin** : README cohérent avec le référentiel.

### Phase 3 — Fonctionnalités

#### B11 — Composant fenêtre de dialogue (avancé en tête de phase)
- **Priorité** : haute (prérequis).
- **Corrige** : absence de composant pour Q20.
- **Fichiers** : nouveau `js/ui/dialog.js` (confirmation, saisie, mot de passe, alerte, choix à deux issues), styles dans `css/styles.css` section 16.
- **Supabase** : aucune.
- **Dépendances** : F1, F6.
- **Risques** : faibles (nouveau composant, pas encore utilisé).
- **Tests** : Annuler / Échap / clic extérieur ne déclenchent rien ; focus ; téléphone plein écran ; deux fenêtres successives.
- **Autorisation** : aperçu visuel validé par Anthony.
- **Fin** : composant documenté dans `DESIGN_SYSTEM.md` §9 (passage de « à créer » à [EN PLACE]).

#### B1 — Commission : ordre de priorité et commission facturée figée
- **Priorité** : haute.
- **Corrige** : 15 % / 0 en dur (`budget.js` `commissionAmount`, `calc.js` `payAmount`, `pennylane/index.ts`, `confirm-flow.js`), ancien réglage dans `on_show_confirmed`/`schema.sql` ; date Booking d'un artiste en Production (Q1, Q2) ; recalcul d'une commission facturée.
- **Fichiers** : `js/budget.js`, `js/calc.js`, `js/selectors.js`, `js/confirm-flow.js`, `js/actions.js` (crochets `change:projects.default_artbo_pct`, `change:shows.fee_ht`), `js/commission.js`, `supabase/functions/pennylane/index.ts`.
- **Supabase** : `on_show_confirmed` (réécriture complète) ; aucune donnée existante modifiée.
- **Dépendances** : F1, F3.
- **Risques** : montants de commission affichés qui changent pour les dates sans % (1 date au 21/10/2026) ; budget, compte dédié et Pennylane concernés.
- **Tests** : matrice de cas QA M5 ; comparaison avant/après des commissions de toutes les dates (aucune commission facturée ne change).
- **Autorisation** : liste des dates dont la commission affichée changerait.
- **Fin** : QA M5 validé ; une seule fonction de commission par défaut côté JS et côté SQL.

#### B2 — Acompte par défaut respecté (0 % compris)
- **Priorité** : haute.
- **Corrige** : 0 → 50 dans « Valider les conditions », défaut 20 dans `on_show_confirmed`, affichage 0 si vide dans Réglages (Q3).
- **Fichiers** : `js/confirm-flow.js`, `js/views/settings.js`.
- **Supabase** : `on_show_confirmed`, `ensure_production_payments` (lecture du réglage tel quel).
- **Dépendances** : B1 (mêmes fonctions SQL).
- **Risques** : dates confirmées après le changement sans acompte si le réglage passe à 0.
- **Tests** : QA M6 (0 %, vide, % modifié).
- **Autorisation** : aucune (décidé).
- **Fin** : QA M6 validé en recette puis production.

#### B3 — Solde figé après envoi
- **Priorité** : haute.
- **Corrige** : solde recalculable et acomptes modifiables après envoi du solde (Q4).
- **Fichiers** : `js/actions.js` (`rebalanceSolde`, `setBill`, ajout de ligne), `js/confirm-flow.js` (`syncAcomptes`), `js/views/production.js` (champs verrouillés + message), `js/budget-actions.js` (synchronisation Pennylane : n'écrit jamais un montant).
- **Supabase** : garde-fou serveur (trigger qui refuse la modification du montant/% d'une ligne de solde envoyée et l'ajout d'un acompte qui la changerait) — **à valider** ; `ensure_production_payments` inchangé pour les dates sans solde envoyé.
- **Dépendances** : B2.
- **Risques** : blocage d'une correction légitime (aucune procédure de régularisation tant qu'elle n'est pas définie : le blocage est voulu).
- **Tests** : QA M7 par l'écran, par une requête directe (trigger) et par la synchronisation.
- **Autorisation** : garde-fou serveur (trigger) oui/non.
- **Fin** : aucune modification possible d'un solde envoyé, par aucun chemin.

#### B4 — Cachet : conserver ou recalculer
- **Priorité** : haute.
- **Corrige** : remise à zéro automatique depuis le tableau ; rien depuis la fiche et les conditions (Q5).
- **Fichiers** : `js/actions.js` (crochet `change:shows.fee_ht`), `js/forms.js` (fiche de la date), `js/confirm-flow.js`.
- **Supabase** : aucune.
- **Dépendances** : B3, B11.
- **Risques** : fenêtre qui s'affiche lors de chaque modification du cachet (seulement si une ligne saisie à la main non envoyée existe).
- **Tests** : QA M8 sur les trois chemins.
- **Autorisation** : aucune.
- **Fin** : QA M8 validé.

#### B5 — Compte d'encaissement « Non renseigné »
- **Priorité** : haute.
- **Corrige** : ligne vide affichée « L'ArtBo » mais comptée sur le compte dédié (Q6).
- **Fichiers** : `js/views/production.js` (affichage, demande au paiement), `js/budget.js` (`accountOf`, `accountMoves` : exclusion), `js/views/budget.js` et `js/views/projects.js` (totaux « dont X € — compte non renseigné »), `js/budget-actions.js` (rapport de synchronisation Pennylane).
- **Supabase** : aucune (pas de valeur par défaut ajoutée à la colonne).
- **Dépendances** : B11, F1.
- **Risques** : **les soldes des comptes dédiés baissent** pour les artistes qui ont des lignes vides (montants exclus) — c'est l'effet voulu, à présenter avant.
- **Tests** : QA M9 ; comparaison des soldes par artiste avant/après.
- **Autorisation** : tableau des soldes avant/après par artiste.
- **Fin** : QA M9 validé ; aucun montant disparu du total des encaissements.

#### B6 — Revue des 225 encaissements sans compte
- **Priorité** : moyenne (manuel).
- **Corrige** : données historiques incomplètes (Q7).
- **Fichiers** : aucun ; export (tableur) des 225 lignes avec date, artiste, montant, référence Pennylane.
- **Supabase** : lecture ; corrections **une par une après validation d'Anthony**, avec export avant.
- **Dépendances** : B5, S1.
- **Risques** : erreur d'attribution — d'où la validation ligne par ligne.
- **Autorisation** : **intervention d'Anthony** (choix du compte pour chaque ligne ou groupe).
- **Fin** : chaque ligne attribuée ou volontairement laissée « Non renseigné ».

#### B7 — Modes Booking / Production
- **Priorité** : haute.
- **Corrige** : changement de mode d'un artiste appliqué à toutes les dates (Q10) ; deux lectures du mode (`isProdShow`, `isBookingOnly`) ; « production propre » testée par 4 expressions (Q11).
- **Fichiers** : `js/budget.js`, `js/mail.js`, `js/calc.js`, `js/reminders.js`, `js/views/production.js`, `js/views/settings.js`, `js/budget-actions.js`, `js/budget-template.js`, `js/production-budget.js`.
- **Supabase** : `project_mode_to_shows` (dates futures sans facture envoyée ni comptabilisée seulement) ; `show_mode_payments` vérifié.
- **Dépendances** : F1, S0.
- **Risques** : effets en chaîne des triggers (création/suppression de lignes de paiement selon le mode).
- **Tests** : QA G1–G3 ; requête avant/après sur toutes les dates d'un artiste dont on change le mode en recette.
- **Autorisation** : aucune (décidé) ; validation des résultats en recette.
- **Fin** : QA G1–G3 validés.

#### B8 — Deux délais de relance
- **Priorité** : moyenne.
- **Corrige** : 10 jours écrit 4 fois (Q15).
- **Fichiers** : `js/prospection.js`, `js/forms.js`, `js/reminders.js`, `js/views/settings.js`.
- **Supabase** : deux réglages (valeur 10) ; `generate_reminders` lit le délai administratif.
- **Dépendances** : F9.
- **Risques** : faibles.
- **Tests** : modifier un délai ne change pas les échéances de l'autre.
- **Autorisation** : noms affichés des deux réglages dans Réglages.
- **Fin** : QA G4 (partie délais) validé.

#### B9 — Pôles à identifiant permanent
- **Priorité** : moyenne.
- **Corrige** : pôle reconnu par son nom (Q16).
- **Fichiers** : `js/constants.js`, `js/selectors.js` (`departments`), `js/forms.js`, `js/prospection.js`, `js/actions.js`, `js/views/suivi.js`, `js/views/todo.js`, `js/views/settings.js`, exports.
- **Supabase** : identifiant ajouté au réglage `departments` ; **migration des 896 tâches** vers l'identifiant (ajout d'une colonne, l'ancienne valeur texte conservée tant que la reprise n'est pas validée).
- **Dépendances** : S1, F1, S0.
- **Risques** : tâches sans pôle affiché, filtres To Do, relances.
- **Tests** : QA G5 (renommer un pôle en recette).
- **Autorisation** : **migration de données des tâches** (export avant).
- **Fin** : renommer un pôle ne casse rien ; ancienne colonne conservée jusqu'à validation.

#### B10 — Tâches terminées : date réelle et Annuler partout
- **Priorité** : moyenne.
- **Corrige** : `done_at` absent depuis la fenêtre ; pas d'Annuler depuis la fenêtre de tâche, la fenêtre de suivi, `closeNoAnswer` (Q17).
- **Fichiers** : `js/forms.js`, `js/actions.js`, `js/prospection.js`.
- **Supabase** : aucune ; les 547 anciennes tâches restent sans date.
- **Dépendances** : F1.
- **Risques** : relances restaurées par Annuler.
- **Tests** : QA I2–I3.
- **Autorisation** : aucune.
- **Fin** : QA I2–I3 validés.

#### B12 — Remplacement des fenêtres natives
- **Priorité** : moyenne.
- **Corrige** : ~30 `confirm`, 5 `prompt` (dont mot de passe en clair), 2 `alert` ; « Annuler » ambigu de la relance téléphone (Q20). Découpage en trois sous-lots : B12-a confirmations hors suppression, B12-b saisies (pôle, partenaire, mot de passe, liens), B12-c alertes (rapport Pennylane, export).
- **Fichiers** : `js/actions.js`, `js/budget-actions.js`, `js/contract.js`, `js/mail.js`, `js/prospection.js`, `js/commission.js`, `js/views/settings.js`, `js/forms.js`, `js/ui/shortcuts.js`, `js/artist-export.js`.
- **Supabase** : aucune.
- **Dépendances** : B11.
- **Risques** : fonctions synchrones qui deviennent asynchrones (ordre des actions) — c'est le principal risque relevé par l'analyse.
- **Tests** : chaque appel remplacé : action confirmée / annulée / Échap.
- **Autorisation** : aucune.
- **Fin** : `grep` sans `confirm(`, `prompt(`, `alert(` dans `js/` (hors suppressions traitées en B14).

#### B13 — Suppression différée : partie serveur
- **Priorité** : moyenne.
- **Corrige** : pas d'attente de suppression côté serveur (Q19).
- **Fichiers** : migration (table d'attente, RPC demander/annuler, tâche `pg_cron` toutes les 5 s), nouvelle fonction edge d'effacement des fichiers (API de stockage, reprise sur échec).
- **Supabase** : nouvelle table, 2 fonctions RPC, 1 tâche planifiée, 1 fonction edge. Faisabilité vérifiée : `pg_cron` 1.6.4 (fréquence en secondes), `pg_net` 0.20.4, suppression SQL directe des fichiers bloquée (`protect_objects_delete`) → API de stockage obligatoire.
- **Dépendances** : S0, S1, F8 (comportement des liens connu).
- **Risques** : charge de la tâche toutes les 5 s (faible) ; suppression en chaîne via les liens ; fichiers non effacés si la fonction edge échoue (reprise prévue).
- **Tests** : en recette : demander/annuler/laisser expirer ; page fermée ; double demande ; fichier introuvable ; deux onglets.
- **Autorisation** : **architecture serveur** (nouvelle table, tâche planifiée) avant développement.
- **Fin** : une suppression demandée puis non annulée est exécutée en 5 à 10 s, page ouverte ou non ; annulation refusée après 5 s.

#### B14 — Suppression différée : partie application
- **Priorité** : moyenne.
- **Corrige** : suppressions immédiates, fichiers orphelins (suivi depuis la fenêtre, tâche), confirmation sans nombre de pièces jointes (Q18, Q19).
- **Fichiers** : `js/data.js` (`remove` → demande de suppression), `js/actions.js`, `js/forms.js`, `js/budget-actions.js`, `js/realtime.js` (masquage des éléments en attente), vues concernées.
- **Supabase** : aucune (utilise B13).
- **Dépendances** : B11, B13.
- **Risques** : **élevés** — toutes les suppressions de l'app changent ; éléments en attente encore visibles dans un calcul (budget, compteurs) pendant 5 s.
- **Tests** : QA I4 complet pour chaque type d'élément.
- **Autorisation** : aucune (décidé).
- **Fin** : QA I4 validé pour tâche, suivi, date, structure, contact, artiste, lignes, pièces jointes.

#### B15 — Liens directs vers les fiches
- **Priorité** : moyenne.
- **Corrige** : pas d'adresse par fiche (Q25) ; changements d'écran hors `go()` (`openNotif`, `filterTag`, `newSuivi`, `editStructure`, `editProspect`, `popstate`) ; retour navigateur sans nettoyage de brouillon.
- **Fichiers** : `js/app.js`, `js/ui/history.js`, `js/actions.js`, `js/forms.js`, vues de fiches.
- **Supabase** : aucune (RLS inchangée).
- **Dépendances** : F6, F1.
- **Risques** : navigation et bouton retour sur tous les écrans.
- **Tests** : QA N1–N3.
- **Autorisation** : format des adresses (ex. `#structure/<id>`).
- **Fin** : QA N1–N3 validés.

#### B16 — Filtres conservés et « Réinitialiser les filtres »
- **Priorité** : moyenne.
- **Corrige** : filtres perdus au rechargement ; « Tout afficher » limité à To Do (Q26, Q27).
- **Fichiers** : `js/state.js`, `js/events.js`, `js/actions.js`, `js/ui/bits.js`, vues avec filtres.
- **Supabase** : aucune.
- **Dépendances** : F6.
- **Risques** : filtres « oubliés » qui masquent des éléments (d'où le bouton visible).
- **Tests** : QA N4.
- **Autorisation** : aucune.
- **Fin** : QA N4 validé.

#### B17 — Dates des fiches artiste et structure
- **Priorité** : basse.
- **Corrige** : ordre décroissant sur les fiches (Q28).
- **Fichiers** : `js/views/structures.js`, `js/views/projects.js`.
- **Dépendances** : F1. **Risques** : faibles. **Tests** : QA N5. **Fin** : QA N5 validé.

#### B18 — Recherche de structure par contact
- **Priorité** : basse.
- **Corrige** : sélecteurs de structure qui ignorent les contacts (Q29) ; champs de recherche différents entre listes et sélecteurs.
- **Fichiers** : `js/ui/autocomplete.js`, `js/views/structures.js`, `js/views/contacts.js`.
- **Dépendances** : F1. **Risques** : suggestions plus nombreuses (ordre conservé). **Tests** : QA N6. **Fin** : QA N6 validé.

#### B19 — Mails et téléphones
- **Priorité** : moyenne.
- **Corrige** : validations différentes ; mail invalide déplacé en silence par `contacts_clean` (Q23) ; nettoyage des téléphones à vérifier (Q24).
- **Fichiers** : nouveau contrôle commun dans `js/utils.js`, `js/forms.js`, `js/actions.js`, `js/views/projects.js`, `js/fiche.js`, `js/rh.js`, `js/artiste.js`.
- **Supabase** : `contacts_clean` (ne déplace plus ; refuse ou laisse), `clean_phone` vérifié contre Q24 ; **aucune donnée historique modifiée**.
- **Dépendances** : F1, F3.
- **Risques** : imports (Notion, Movinmotion) bloqués par des mails invalides — à traiter avec un rapport plutôt qu'un refus en lot.
- **Tests** : QA F6–F7 sur tous les chemins.
- **Autorisation** : comportement des imports en lot face à un mail invalide (refus de la ligne + rapport).
- **Fin** : QA F6–F7 validés.

#### B20 — Centimes et pourcentages
- **Priorité** : basse.
- **Corrige** : `eur`/`eur2` selon le contexte (Q22) ; formats locaux ; « 50% ».
- **Fichiers** : vues comptables (`production.js`, `budget.js`, `projects.js`, exports, `mail.js`, `contract.js`, `fiche.js`) ; SQL `mail_vars` (pourcentage).
- **Dépendances** : F3. **Risques** : textes des mails et contrats modifiés. **Tests** : QA M1, M4. **Fin** : QA M1 validé écran par écran.

#### B21 — Indicateur de version des scripts Google
- **Priorité** : moyenne.
- **Corrige** : impossible de savoir si les scripts sont à jour (Q37).
- **Fichiers** : `apps-script/Code.gs`, `apps-script/Prospection.gs` (numéro de version renvoyé par `ping`), `js/views/settings.js`, `tools/bump_version.py` (numéro des scripts) — **à valider**.
- **Supabase** : aucune (ou via le relais de S3).
- **Dépendances** : S3 recommandé avant (sinon l'appel passe encore par le navigateur).
- **Risques** : faibles.
- **Tests** : QA P4 (trois états).
- **Autorisation** : **redéploiement manuel des deux scripts par Anthony**.
- **Fin** : les trois états observés réellement.

#### B22 — Dépenses réelles : transition COST€
- **Priorité** : basse (organisationnelle).
- **Corrige** : périmètre limité à The Locos ; pas de contrôle de reprise (Q8, Q9).
- **Fichiers** : à définir (rapport de comparaison COST€ ↔ Matrice par artiste ; import éventuel).
- **Supabase** : lecture ; import seulement après validation.
- **Dépendances** : B5, F1.
- **Risques** : double saisie pendant la transition.
- **Autorisation** : **méthode de reprise et calendrier artiste par artiste** (Anthony fournit les fichiers COST€).
- **Fin** : pour chaque artiste en Production, rapport d'écarts validé ; COST€ conservé tant qu'Anthony ne décide pas la fin de transition.

### Phase 4 — Design

#### D1 — Jetons manquants
- **Corrige** : `--ok-tint`, `--warn-tint`, `--danger-tint`, `--today` absents ; utilitaires d'espacement hors jetons (Q30, Q31).
- **Fichiers** : `css/styles.css` §1. **Supabase** : aucune. **Dépendances** : F1. **Risques** : nuls (sans effet visuel). **Fin** : jetons présents.

#### D2 — Couleurs selon leur sens
- **Corrige** : 14 fonds sémantiques différents, couleurs recopiées en JS (`booking.js`, `selectors.js`, `actions.js`, `mail.js`), violet conservé pour l'échéance du jour (Q31).
- **Fichiers** : `css/styles.css`, `css/fiche.css`, JS cités. **Dépendances** : D1. **Risques** : contraste des lignes payées / pièce reçue. **Tests** : captures avant/après de Budget, Production, To Do. **Autorisation** : captures validées. **Fin** : QA D7.

#### D3 — Titres des sections
- **Corrige** : blocs Contacts, Tâches, Journal aujourd'hui affichés en petit gris, à passer en titres de section principale (Q32) ; variantes de titres.
- **Fichiers** : `js/views/suivi.js`, `js/views/projects.js`, `js/views/structures.js`, `css/styles.css`. **Dépendances** : F1. **Risques** : hauteur des pages. **Tests** : captures. **Autorisation** : captures validées. **Fin** : QA D4.

#### D4 — Sélections
- **Corrige** : bleu plein / bleu pâle sans règle (Q33).
- **Fichiers** : `css/styles.css` (`.tag-chip`, `.pills`, `.ac-item`, `.pm-item`, `.btn.on`). **Dépendances** : D1. **Fin** : QA D8.

#### D5 — Champs, boutons et fenêtres
- **Corrige** : ~15 définitions de champ, hauteurs en dur, bordure d'erreur invisible sur les pages publiques, `.fp-btn`, `.af-copy` invalide (Q30).
- **Fichiers** : `css/styles.css`, `css/fiche.css`, `js/artist-form.js`. **Dépendances** : B11. **Risques** : pages publiques (formulaires des organisateurs). **Tests** : captures app + pages publiques. **Fin** : QA D2–D3, F8.

#### D6 — Tableaux et responsive
- Découpage : **D6-a** défauts confirmés (Suivi en deux colonnes sur téléphone, journal projet, recherche trop large, `dialog.mail`, panneau latéral) — peut être fait tôt ; **D6-b** seuils officiels et tablette 1 024–1 100 px en tableaux avec défilement horizontal (Q35) ; **D6-c** fiches empilées (libellés après cellule fusionnée, totaux, tableaux des fenêtres).
- **Fichiers** : `css/styles.css` §17, `js/app.js` (conversion en fiches). **Dépendances** : F1. **Risques** : toutes les listes sur tablette et téléphone. **Tests** : QA R1–R5 à 390, 820, 1024, 1100, 1440 px. **Fin** : QA R validé.

#### D7 — Styles inline vers classes
- **Corrige** : 82 `style=` (≈ 60 à convertir), découpé par fichier (projects, suivi, settings, budget, production, autres).
- **Dépendances** : D1. **Risques** : écarts de quelques pixels. **Tests** : captures par écran. **Fin** : QA D1 sur les fichiers traités.

#### D8 — Proportions de colonnes
- **Corrige** : 5 proportions différentes → 50/50 et 66/33 (Q34). **Fichiers** : `css/styles.css`, `js/views/settings.js`, `js/views/projects.js`. **Dépendances** : D7. **Fin** : QA D9.

#### D9 — Pages publiques et export artiste
- **Corrige** : titres 30/18, libellés 13 px, seuil 640, palette propre de l'export (`js/artist-export.js`). **Dépendances** : D5. **Risques** : documents envoyés aux artistes. **Autorisation** : captures validées. **Fin** : pages publiques et export aux jetons.

#### D10 — Nettoyage CSS
- **Corrige** : sélecteurs définis plusieurs fois (`.side` ×4, `.prod-body` ×4…), classes sans usage trouvé (**vérifiées une par une avant retrait**, une classe pouvant être construite dynamiquement). **Dépendances** : D1–D9. **Risques** : classe utilisée dynamiquement retirée. **Fin** : aucune règle qui en écrase une autre ; retraits listés.

---

## 5. Opérations sensibles nécessitant l'autorisation d'Anthony

| Lot | Opération | Type |
|---|---|---|
| S0 | Appliquer les migrations manquantes au projet de **test** | autorisation |
| S2 | Retirer la clé Brevo de `settings` en production ; rotation de la clé dans Brevo si exposition | autorisation + **manuel Anthony (Brevo)** |
| S3 | Architecture du relais ; nouveau secret des scripts | autorisation + **manuel Anthony (redéploiement des 2 scripts)** |
| S4 | Protection des mots de passe compromis | **manuel Anthony (tableau de bord Supabase)** |
| S7 | Toute suppression d'objet (tables `_…`, fonctions, `pl-probe`) | autorisation **objet par objet** |
| F3 | Modèles de mail dont la date ouvre la phrase | validation |
| F7 | Écriture de l'historique des migrations en production | autorisation |
| F8 | Comportement de suppression de chaque nouveau lien (`CASCADE` / `SET NULL`) | autorisation |
| F9 | Notifications créées au premier passage (anciens impayés) | validation de la liste |
| B1 | Dates dont la commission affichée change | validation de la liste |
| B3 | Garde-fou serveur sur les soldes envoyés | autorisation |
| B5 | Soldes des comptes dédiés avant/après | validation |
| B6 | Attribution des 225 encaissements | **manuel Anthony** (ligne par ligne) |
| B9 | Migration des pôles des 896 tâches | autorisation (export avant) |
| B13 | Nouvelle table, tâche planifiée toutes les 5 s, fonction edge | autorisation de l'architecture |
| B15 | Format des adresses | validation |
| B19 | Comportement des imports face à un mail invalide | validation |
| B21 | Numéro de version des scripts | **manuel Anthony (redéploiement)** |
| B22 | Méthode de reprise COST€, fichiers par artiste, fin de transition | **manuel Anthony** |
| Tous | Fusion de chaque branche dans `main` | autorisation |

---

## 6. Critères de validation avant mise en production (chaque lot)

1. Branche dédiée au lot, à jour avec `main`.
2. Suite de tests (`tests/`) verte, avec les nouveaux tests du lot ; `pageerror` vide.
3. `QA_CHECKLIST.md` remplie : aucun **É** non accepté par Anthony ; chaque **NV** expliqué.
4. Modifications Supabase appliquées et vérifiées **d'abord sur le projet de test**, sauvegarde de production vérifiée (S1) et lignes concernées exportées avant toute opération sensible.
5. Relecture indépendante : **aucun bloquant** (ou réfutation écrite) — `CLAUDE.md` §6.
6. Captures avant/après pour tout changement visible (ordinateur, tablette, téléphone).
7. Compte rendu remis à Anthony (changements, interventions manuelles, É/NV).
8. `bump_version.py` lancé **sur la branche** avant le compte rendu ; **accord explicite d'Anthony**, puis fusion de la demande de fusion (mise en ligne) — jamais de commit direct sur `main` (`CLAUDE.md` §5) ; vérification en production des points sans risque ; documents du référentiel mis à jour (passage des éléments « à créer » / [CORRECTION] en [EN PLACE]).
