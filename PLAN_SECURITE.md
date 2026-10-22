# PLAN_SECURITE.md — Préalables (S0, F1) et lots de sécurité (S1 à S7)

Annexe de `PLAN_EXECUTION.md`, établie le 22/10/2026 à la demande d'Anthony. **Elle remplace les fiches S0, F1 et S1 à S7 de `PLAN_EXECUTION.md`.**
Statut : **proposition, aucun lot autorisé.** Toutes les vérifications ci-dessous ont été faites **en lecture seule** : aucune modification de l'application, de Supabase ni des scripts Google.

> **État au 22/10/2026** : **S1** terminé (vérifications manuelles d'Anthony comprises), **F1-a** et **S5-a** terminés et en production (v1.40.1), tests aussi exécutés à chaque push sur `main`. Principes validés, non développés : **F11** (fenêtre « Modifier » d'un échange : seuls les champs réellement modifiés sont enregistrés, le contenu d'un mail n'est jamais réécrit s'il n'a pas été modifié) et **S1-b** (seconde copie mensuelle chiffrée, indépendante de GitHub ; architecture à valider : restauration complète, fichiers modifiés ou supprimés, limites de Google Apps Script, conservation de la clé privée, restauration sans compte GitHub). Secret du script de prospection : migration et rotation dans S3-b / S3-c.
Aucune valeur de secret n'apparaît dans ce document. Les comparaisons avec l'historique Git ont été faites par empreinte (hachage), sans afficher les valeurs.

---

## 1. Constat sur les secrets (vérifié le 22/10/2026)

### 1.1 Secrets concernés
| Secret | Où il est | Qui le lit aujourd'hui | Ce qu'il permet |
|---|---|---|---|
| Clé API Brevo | table `settings` | navigateur de l'équipe, fonction `brevo-sync` | lire et modifier les contacts Brevo, **envoyer des mails depuis le compte Brevo** |
| Code secret des scripts Google | table `settings` + propriétés de `Code.gs` + texte de `Prospection.gs` | navigateur de l'équipe (envoyé à chaque appel), fonctions SQL `artist_submit`, `on_show_confirmed`, `request_drive_folder`, fonction `pennylane` | déclencher **toutes** les actions des scripts (créer dossiers et brouillons Gmail, ranger des fichiers, contrats, prospection) avec le compte Google d'Anthony |
| Code du webhook Brevo | table `settings` | navigateur de l'équipe, déclencheur `brevo_queue`, fonction `brevo-sync` | lancer une synchronisation Brevo (faible) |
| Autres (Pennylane, Notion, Gemini, sauvegarde, import) | coffre `private.import_secrets` | fonctions serveur uniquement | — |

### 1.2 Accès par une personne non autorisée : vérifications
| Chemin d'accès | Résultat | Comment c'est vérifié |
|---|---|---|
| Visiteur non connecté (clé publique du site) | **bloqué** : 0 ligne de `settings` lue, `setting_text()` renvoie vide | requête exécutée sous le rôle `anon`, annulée ensuite |
| Compte connecté hors équipe | **bloqué** : `is_team()` faux, 0 ligne lue | requête simulée avec un mail inconnu |
| Fonctions publiques (fiche, artiste, salarié) | **pas de fuite** : `artist_submit` utilise le secret côté serveur sans le renvoyer | lecture du code SQL |
| Coffre `private.import_secrets` | **bloqué** : schéma inaccessible à `anon` et aux utilisateurs connectés, `import_secret()` réservée au serveur | droits vérifiés |
| Dépôt GitHub (**public**) et page GitHub Pages | **aucun des 8 secrets** dans les 161 commits de toutes les branches | comparaison par empreinte |
| Temps réel Supabase | soumis aux mêmes règles (RLS) | règle `team_all` |

**Conclusion : aucun accès possible pour une personne non autorisée par les voies normales.** Le risque est réel mais **indirect**.

### 1.3 Expositions résiduelles (à traiter)
1. **Nettoyage du HTML des mails (risque faible, corrigé par S5-a).** *Corrigé le 22/10/2026 après audit du code.* Le premier diagnostic présentait les mails importés comme la voie principale de fuite : **c'est inexact**. Un mail importé (`.eml`) est converti en **texte brut** avant d'être enregistré (`js/eml.js`) et s'affiche comme du texte échappé. Le HTML affiché dans le journal (`prospect_logs.body_html`) ne vient que des mails **rédigés dans la Matrice** (modèles de l'équipe, valeurs échappées par `fill`) et de ce qui est collé dans l'éditeur (nettoyé en partie par le navigateur). Le défaut de l'ancien `safeHtml` est réel (un lien piégé s'exécutait au clic, vérifié par test), mais il n'est **pas exploitable depuis l'extérieur** par un mail reçu. S5-a reste utile (défense en profondeur), sans être prioritaire. → **S5-a**.
2. **Navigateurs de l'équipe** : les secrets sont dans la mémoire de la page et affichés dans Réglages (code des scripts en clair, bouton « copier »). Une extension de navigateur malveillante ou un poste partagé peuvent les lire. → S2, S3.
3. **Dépôt de sauvegarde privé** : `backup-export` exporte la table `settings`, donc les trois secrets se trouvent dans `lartbo-matrice-backup`. **Non vérifié** : qui a accès à ce dépôt. → S1.
4. **Script de prospection** : le secret est écrit en clair dans le code de `Prospection.gs` (copié depuis Réglages), alors que `Code.gs` le range déjà dans les propriétés du script. → S3-b.
5. **Pas de rotation possible sans coupure** aujourd'hui : changer le code oblige à modifier en même temps Réglages et les deux scripts. → S3-c.

### 1.4 Mesures immédiates
- **Aucune urgence de coupure** : rien n'indique une fuite, donc **pas de rotation immédiate**. Changer les codes maintenant obligerait à refaire la manipulation après S3.
- **Gestes immédiats sans développement (Anthony)** :
  1. vérifier qui a accès au dépôt privé `lartbo-matrice-backup` (seul Anthony, idéalement) ;
  2. dans Brevo, vérifier l'historique d'activité de la clé API et la liste des IP autorisées, puis activer la restriction d'IP si l'offre le permet (**à vérifier**) ;
  3. ~~ne pas ouvrir les liens des mails importés~~ : consigne retirée le 22/10/2026, inutile (voir 1.3, point 1).
- **Premier lot de code** : S5-a reste proposé tôt parce qu'il est petit et sans risque, pas parce qu'il fermerait une voie d'exfiltration réaliste.

---

## 2. Ordre d'exécution recommandé

| Ordre | Lot | Nature | Coupure de service |
|---|---|---|---|
| 1 | **S1** Sauvegarde vérifiée | lecture | aucune |
| 2 | **F1-a** Tests minimum (en parallèle de S1) | ajout de `tests/`, rien dans l'app | aucune |
| 3 | **S5-a** Nettoyage HTML renforcé | application (1 fonction) | aucune |
| 4 | **S0** Recette à niveau | projet **de test** uniquement | aucune |
| 5 | **S2** Clé Brevo au coffre | edge + SQL + Réglages | aucune si l'ordre interne est suivi |
| 6 | **S3-a** Code du webhook Brevo hors navigateur | edge + Réglages | aucune |
| 7 | **S3-b** Relais des scripts Google | nouvelle edge + app + script de prospection | **risque** (voir fiche) |
| 8 | **S3-c** Rotation des codes | manuel | quelques minutes, à heure creuse |
| 9 | **S4** Durcissement des fonctions | SQL | risque sur les pages publiques |
| 10 | **S5-b** Revue complète des contenus HTML | application | aucune |
| 11 | **S6** Pages publiques : erreurs et jetons | application | faible |
| 12 | **S7** Inventaire des objets non versionnés | lecture | aucune |
| continu | **F1-b…** enrichissement des tests | `tests/` | aucune |

**Écarts par rapport au plan initial :**
- S5 est coupé en deux et S5-a passe en tête : petit lot sans risque, déjà prêt (le premier diagnostic le présentait à tort comme la voie principale d'exposition, voir 1.3).
- S0 vient après S5-a, car S5-a ne touche pas Supabase : il n'attend pas la recette.
- F1 est coupé en deux : un socle minimal tout de suite (F1-a), puis un enrichissement lot par lot. Les tests ne retardent donc pas les correctifs.

---

## 3. Fiches détaillées

### S1 — Sauvegarde vérifiée et point de restauration
- **Objectif** : s'assurer qu'on peut revenir en arrière avant toute opération sensible (Q38), et réduire l'exposition des secrets dans la sauvegarde.
- **Fichiers et services** : fonction `backup-export`, dépôt privé `lartbo-matrice-backup`, `backup/README.md`.
- **Modifications** :
  - aucune pendant la vérification ;
  - ensuite, avec accord, `backup-export` n'exporte plus les valeurs secrètes de `settings` (clés remplacées par « [secret] »). Ce changement touche une fonction edge, donc il fera partie de S2.
- **Ce qui est contrôlé** : sauvegarde de la nuit présente ; 26 tables ; fichiers des buckets `suivi` (241) et `artiste` (18) ; restauration d'essai d'une table **sur le projet de test**.
- **Risques** : aucun.
- **Dépendances** : aucune.
- **Tests** : comparer le nombre de lignes par table entre la sauvegarde et la production ; restauration d'essai.
- **Intervention d'Anthony** : donner accès au dépôt de sauvegarde à la session (ou faire la vérification lui-même) ; contrôler la liste des personnes qui y ont accès.
- **Validation** : rapport « sauvegarde complète et restaurable » ; procédure d'export ponctuel avant opération sensible écrite dans `backup/README.md`.

### F1-a — Socle minimal de tests automatiques
- **Objectif** : disposer dès le premier correctif d'une commande unique qui détecte les régressions graves, sans retarder les lots de sécurité (Q36).
- **Fichiers et services** :
  - nouveau dossier `tests/` : `package.json` avec une version figée de Playwright, déjà installé dans l'environnement ;
  - `mock-supabase.js` : faux serveur qui répond aux appels Supabase avec des données fictives ;
  - `unit/` pour les tests de fonctions isolées (testeur intégré à Node, gratuit) ;
  - `e2e/` pour les parcours dans le navigateur ;
  - mise à jour de `README.md`.
  - **Aucun fichier de l'application.**
- **Ce qui est testé au départ** :
  1. tous les modules JS se chargent, et la carte d'import (`?v=`) correspond aux fichiers ;
  2. l'app démarre avec le faux serveur, connexion simulée, chaque onglet principal s'affiche **sans erreur JavaScript** ;
  3. tests unitaires de `safeHtml`, `esc`, `md` (base de S5-a) et des calculs de `calc.js` / `budget.js` sur des cas connus ;
  4. compteur des fenêtres natives (`confirm`, `prompt`, `alert`) : le chiffre ne doit pas augmenter.
- **Risques** : aucun pour l'application. Le faux serveur peut diverger du vrai : c'est le rôle de S0 et des tests SQL en recette.
- **Dépendances** : aucune.
- **Tests** : la suite passe au vert sur `main` actuel.
- **Décision d'Anthony** : exécution automatique à chaque push via GitHub Actions (gratuit pour un dépôt public) — oui ou non.
- **Validation** : `npm test` dans `tests/` passe en moins de 3 minutes et la procédure est documentée.
- **F1-b et suivants (enrichissement)** : chaque lot ajoute ses tests. Ordre prévu :
  - parcours date → confirmation → factures ;
  - prospection → relance ;
  - tâches ;
  - budget et compte dédié ;
  - affichages téléphone et tablette ;
  - tests SQL sur la recette (déclencheurs, rappels).

### S5-a — Nettoyage HTML renforcé (premier correctif)
- **Objectif** : empêcher que le HTML d'un mail affiché dans le journal exécute du code (défense en profondeur ; les `.eml` importés sont stockés en texte brut, voir 1.3).
- **Fichiers et services** : `js/utils.js` (`safeHtml`), avec vérification de ses appelants (`js/views/suivi.js` journal, aperçus de mail).
- **Modifications** :
  - **DOMPurify 3.4.16** (décision d'Anthony du 22/10/2026), copié dans `assets/vendor/`, provenance vérifiée (npm et GitHub officiels) ;
  - HTML seulement (ni SVG ni MathML), formulaires, cadres et `<style>` retirés ;
  - adresses limitées à `https:`, `http:`, `mailto:`, `tel:`, `cid:` ou relatives, caractères invisibles ignorés ; images `data:image/` permises ;
  - attributs de mise en page conservés (largeur, alignement, couleurs, fusion de cellules) ;
  - liens ouverts dans un nouvel onglet (`noopener noreferrer`), positionnement fixe retiré, bloc du mail isolé.
- **Risques** : faibles. L'affichage ne modifie aucun mail stocké (vérifié par test) ; seule l'édition d'un échange réenregistre le mail, comportement antérieur à S5-a, traité dans un lot dédié.
- **Dépendances** : F1-a (tests unitaires de `safeHtml`).
- **Tests** : 34 entrées piégées (aucune ne s'exécute), 30 contournements essayés par la relecture indépendante, 5 mails représentatifs fictifs comparés à l'ancien nettoyage (texte, liens, images, mise en page), journal et fenêtre « Modifier » sans écriture en base. Les mails réels n'ont pas été utilisés (aucune donnée réelle dans les tests).
- **Intervention d'Anthony** : autoriser la fusion ; contrôler à l'écran quelques mails réels du journal après mise en ligne.
- **Validation** : aucune entrée piégée ne s'exécute ; les mails restent lisibles ; relecture indépendante sans bloquant (Greptile indisponible : crédits d'essai épuisés).

### S0 — Remettre l'environnement de recette à niveau
- **Objectif** : pouvoir tester toute modification Supabase **sans toucher la production**.
- **Fichiers et services** : projet Supabase `Lartbo-matrice-test` ; `supabase/migrations/*` (lecture) ; `js/config.js` (mode `?test` existant, inchangé) ; fonctions edge à déployer **sur le projet de test**.
- **Modifications** (projet de test uniquement) :
  - appliquer les migrations manquantes (dont `client_errors` et `_folder_jobs`) ;
  - déployer les fonctions edge ;
  - **neutraliser les appels extérieurs** : pas d'adresse de script Google, pas de clé Brevo, pas de jeton Pennylane, ou bien un script Google de test.
- **Risques** : nul pour la production. **Point d'attention** : si la recette gardait l'adresse du vrai script Google, un test créerait de vrais dossiers et brouillons. D'où la neutralisation.
- **Dépendances** : S1 (restauration d'essai sur ce projet).
- **Tests** : comparaison automatique des deux schémas (tables, colonnes, fonctions, déclencheurs, tâches planifiées) ; ouverture de l'app en `?test`.
- **Intervention d'Anthony** : autoriser les migrations sur le projet de test. Option : créer une copie de test des scripts Google (environ 10 min) pour tester S3-b en vrai.
- **Validation** : schémas identiques hors données ; app fonctionnelle en `?test` ; aucun appel extérieur possible depuis la recette.

### S2 — Clé API Brevo au coffre
- **Objectif** : la clé Brevo n'est plus jamais envoyée au navigateur.
- **Fichiers et services** :
  - `supabase/functions/brevo-sync/index.ts` ;
  - `supabase/functions/backup-export/index.ts` (masquage des secrets, voir S1) ;
  - `js/views/settings.js` (champ et bouton de test), `js/forms.js` (affichage de l'état Brevo sur un contact), `js/actions.js` ;
  - coffre `private.import_secrets`.
- **Modifications, dans cet ordre pour éviter toute coupure** :
  1. `brevo-sync` lit la clé dans le coffre et, à défaut, dans `settings` (période de transition) ;
  2. copie de la clé dans le coffre **par une requête serveur** : la valeur ne passe ni par le navigateur ni par ce compte rendu ;
  3. nouvelle fonction `set_brevo_key` (réservée à l'équipe, sur le modèle de `set_pennylane_key`), et un indicateur « clé enregistrée oui/non » à la place de la clé dans les réglages lisibles ;
  4. Réglages : champ « Remplacer la clé », la clé actuelle n'est jamais affichée ; `forms.js` lit l'indicateur ;
  5. vérification en production ;
  6. avec accord, la valeur dans `settings` est vidée (la ligne reste) et la lecture de secours est retirée de `brevo-sync`.
- **Risques** :
  - synchronisation Brevo interrompue si l'étape 1 ou 2 échoue (d'où la lecture de secours) ;
  - déclencheur `brevo_contacts` à vérifier ;
  - le bouton « Synchroniser tout » dépend aussi de S3-a.
- **Dépendances** : S0, S1, F1-a.
- **Tests** :
  - recette : enregistrer une clé de test, créer un contact, vérifier l'appel (journal de la fonction) ;
  - production : modifier un contact réel non sensible, puis vérifier dans Brevo ;
  - le navigateur ne reçoit plus la clé : contrôle de `S.settings` et des requêtes réseau.
- **Intervention d'Anthony** : autoriser le vidage de la valeur en production. Rotation éventuelle de la clé dans Brevo (S3-c), puis la coller une fois dans Réglages.
- **Validation** : aucune trace de la clé dans le navigateur ; synchronisation vérifiée en production ; sauvegarde sans clé.

### S3-a — Code du webhook Brevo hors du navigateur
- **Objectif** : le bouton « Synchroniser tout » n'utilise plus le code secret.
- **Fichiers et services** : `supabase/functions/brevo-sync/index.ts`, `js/actions.js` (`brevoSyncAll`), fonction SQL `brevo_queue`, coffre.
- **Modifications** :
  1. `brevo-sync` accepte **soit** le code (appel du déclencheur serveur), **soit** un utilisateur connecté de l'équipe (`is_team`) ;
  2. le navigateur appelle avec sa session, sans code ;
  3. le code passe au coffre, et `brevo_queue` le lit au coffre ;
  4. avec accord, la valeur dans `settings` est vidée.
- **Risques** : synchronisation automatique des contacts interrompue si `brevo_queue` ne trouve plus le code. Ordre : coffre d'abord, retrait ensuite.
- **Dépendances** : S2.
- **Tests** : synchronisation automatique (modification d'un contact) et manuelle (bouton), en recette puis en production ; appel sans session ni code refusé.
- **Intervention d'Anthony** : aucune (autorisation du vidage).
- **Validation** : plus de `brevo_hook_secret` dans le navigateur ; les deux synchronisations fonctionnent.

### S3-b — Relais serveur pour les scripts Google
- **Objectif** : le navigateur n'envoie et ne lit plus jamais le code des scripts Google.
- **Fichiers et services** :
  - nouvelle fonction edge `apps-script` (relais) ;
  - `js/mail.js` (`callScript`), `js/prospection.js` (`callProspect`), `js/actions.js` (copie du script, bouton « copier le code »), `js/views/settings.js` ;
  - `apps-script/Prospection.gs` ;
  - fonctions SQL `artist_submit`, `on_show_confirmed`, `request_drive_folder` ;
  - fonction edge `pennylane` (rangement des factures).
- **Modifications** :
  1. **Relais** : vérifie la session et `is_team()`, ajoute le code côté serveur, transmet au bon script (principal ou prospection) et renvoie la réponse.
  2. **Liste d'actions autorisées** : seules les actions utilisées par l'app passent.
  3. **App** : `callScript` et `callProspect` appellent le relais ; la signature des fonctions ne change pas, donc les appelants restent intacts.
  4. **`Prospection.gs`** lit le code dans les propriétés du script, comme `Code.gs`. Pendant la transition, le code écrit en dur reste accepté.
  5. **Réglages** : le code n'est plus affiché ; un bouton « Générer un nouveau code » prépare la rotation (S3-c) ; la copie du script ne contient plus de code.
  6. **SQL et `pennylane`** lisent le code au coffre.
  7. Avec accord, le code est vidé de `settings`.
- **Risques (production)** :
  - **toutes** les actions Google passent par le relais : dossiers de date et d'artiste, brouillons, contrats, prospection, pièces RH, rangement des factures ;
  - **durée** : une fonction edge coupe la connexion après environ 150 s, alors qu'un script Google peut tourner jusqu'à 6 min. Les actions longues (copie d'arborescence) sont déjà découpées en étapes, mais **leur durée réelle n'est pas mesurée**. À mesurer en recette avant de basculer : une action trop longue doit passer en traitement découpé ;
  - les messages d'erreur des scripts doivent rester identiques à l'écran.
- **Dépendances** : S0 (idéalement avec une copie de test des scripts), S2, F1-a. **Pas de dépendance à la fenêtre de dialogue (B11)** : le code n'a plus à être saisi par une fenêtre.
- **Tests** :
  - chaque action, une par une, en recette : `ping`, dossier de date, dossier d'artiste, brouillon, prospection, contrat, pièces RH, facture ;
  - mesure de la durée de chacune ;
  - refus d'un utilisateur non connecté et d'une action non autorisée ;
  - en production : `ping` puis une action sans effet de bord avant d'ouvrir le reste.
- **Interventions d'Anthony** :
  - **redéployer `Prospection.gs`** (lecture des propriétés), environ 5 min ;
  - créer la propriété `SECRET` dans le script de prospection, avec le même code qu'aujourd'hui, copié depuis Réglages **avant** le retrait de l'affichage.
- **Validation** :
  - `drive_webhook_secret` n'apparaît plus dans le navigateur (mémoire, réseau, Réglages) ;
  - toutes les actions sont vérifiées en production ;
  - aucun message « code secret incorrect » pendant 48 h.

### S3-c — Rotation des codes (recommandée, pas urgente)
- **Objectif** : rendre inutilisables d'éventuelles copies anciennes des codes (navigateurs, sauvegardes passées).
- **Services** : Brevo, propriétés des deux scripts Google, coffre Supabase.
- **Modifications** : nouveau code des scripts, généré par le serveur et affiché une seule fois à Anthony ; nouvelle clé Brevo.
- **Risques** : entre l'enregistrement du nouveau code dans le coffre et sa saisie dans les scripts, les actions Google échouent pendant quelques minutes. À faire à heure creuse, hors 5 h (rappels).
- **Dépendances** : S2, S3-a, S3-b.
- **Tests** : `ping` des deux scripts ; une synchronisation Brevo.
- **Interventions d'Anthony** :
  - créer une nouvelle clé dans Brevo et révoquer l'ancienne ;
  - coller le nouveau code dans les propriétés des **deux** scripts (sans redéploiement, puisque S3-b leur fait déjà lire les propriétés).
- **Validation** : anciens codes refusés ; toutes les actions fonctionnent.

### S4 — Durcissement des fonctions et de l'authentification
- **Objectif** : fermer les points relevés par les alertes de sécurité Supabase.
- **Fichiers et services** : nouvelle migration (aucun JS).
- **Modifications** :
  - `search_path` figé sur 14 fonctions, sans les réécrire ;
  - retrait du droit d'exécution `anon` sur les fonctions de déclencheur ;
  - `pg_net` laissé dans le schéma public (le déplacer est risqué, décision séparée).
- **Risques (production)** : une fonction utilisée par une page publique qui perdrait ses droits casserait cette page.
- **Dépendances** : S0, S1.
- **Tests** :
  - liste des fonctions appelées par les pages publiques, comparée aux droits retirés ;
  - fiche, artiste et salarié en recette (lecture et envoi) ;
  - alertes de sécurité relancées.
- **Intervention d'Anthony** : activer la protection contre les mots de passe compromis (tableau de bord Supabase › Authentication), environ 1 min. **À vérifier** : cette option peut dépendre de l'offre Supabase.
- **Validation** : alertes concernées à zéro ; pages publiques vérifiées en production.

### S5-b — Revue complète des contenus HTML
- **Objectif** : vérifier tous les endroits où du texte est inséré dans la page.
- **Fichiers** : tous les `innerHTML` de `js/` et des pages publiques (`fiche.js`, `artiste.js`, `rh.js`, `artist-export.js`), `js/ui/richtext.js`, `md()`.
- **Modifications** : échappement ajouté là où il manque, uniquement.
- **Risques** : texte affiché avec des caractères échappés en trop (`&amp;`).
- **Dépendances** : S5-a.
- **Tests** : données piégées dans chaque champ libre (noms, notes, lieux), sur l'app et les pages publiques.
- **Intervention d'Anthony** : aucune.
- **Validation** : chaque insertion est classée (sûre / corrigée) dans le compte rendu.

### S6 — Pages publiques : erreurs et jetons
- **Objectif** : un organisateur, un artiste ou un salarié ne voit que ses données et des messages en français.
- **Fichiers et services** : `js/fiche.js`, `js/artiste.js`, `js/rh.js` ; fonctions `fiche_*`, `artist_*`, `rh_*` (lecture).
- **Modifications** : messages techniques remplacés par des messages clairs. Aucune modification SQL sans constat préalable.
- **Risques** : faibles.
- **Dépendances** : F1-a.
- **Tests** : jeton invalide, jeton d'une autre date, réseau coupé, fichier trop lourd.
- **Intervention d'Anthony** : aucune.
- **Validation** : aucun message technique visible ; aucun accès croisé possible.

### S7 — Inventaire des objets non versionnés
- **Objectif** : documenter les objets dont l'utilité n'est pas établie, **sans rien supprimer** (Q38).
- **Services** :
  - fonction edge `pl-probe` (absente du dépôt) ;
  - fonctions techniques `_folder_tick`, `_koza_tick`, `_lartbotrice_tick` ;
  - tables de travail ;
  - **18 fichiers du bucket `artiste` et 14 du bucket `suivi` qui ne sont référencés par aucune ligne**. Ce constat a été fait en lecture et devra être confirmé.
- **Modifications** : aucune (rapport).
- **Risques** : aucun.
- **Dépendances** : aucune.
- **Intervention d'Anthony** : décision objet par objet. **Aucune suppression sans demande spécifique.**
- **Validation** : rapport remis (utilité, dépendances, recommandation).

---

## 4. Suppression différée (Q19) : vérifications avant de figer l'architecture

**Aucun développement prévu maintenant.** Points vérifiés en lecture seule le 22/10/2026 :

| Point | Constat | Conséquence pour l'architecture |
|---|---|---|
| **Fréquence** | `pg_cron` 1.6.4 accepte les fréquences en secondes (à partir de la version 1.5) ; 32 tâches simultanées maximum ; une seule tâche planifiée aujourd'hui. **Non testé en conditions réelles** (cela demanderait une modification). | Tâche toutes les **5 s**, donc suppression effective **5 à 10 s** après la confirmation. Variante possible : toutes les 2 s (5 à 7 s, charge plus élevée), à décider. |
| **Historique des exécutions** | `cron.job_run_details` garde chaque exécution (555 lignes aujourd'hui). Une tâche toutes les 5 s ajoute environ **17 000 lignes par jour**. | Ajouter une purge quotidienne de cet historique (7 jours conservés). Sinon la base grossit. |
| **Une seule exécution à la fois** | D'après la documentation de `pg_cron` (non testé), une tâche n'est pas relancée tant que l'exécution précédente n'est pas terminée. | Pas de double traitement par la tâche elle-même. |
| **Annulations concurrentes** | Raisonnement sur le verrouillage des lignes (pas encore testé). L'annulation ne supprime la demande que si l'heure limite n'est pas atteinte ; la purge ne traite que les demandes échues et saute les lignes verrouillées. Si l'annulation arrive en premier, la purge ne voit plus rien. Si la purge commence en premier, l'annulation attend, puis répond « trop tard ». | Un seul résultat possible par demande, jamais les deux. **À prouver par un test de concurrence en recette** (deux sessions simultanées). |
| **Double demande** (deux onglets, double clic) | — | Contrainte d'unicité sur (table, identifiant) : la deuxième demande est ignorée. |
| **Pièces jointes** | Le déclencheur `protect_objects_delete` **interdit** d'effacer un fichier par SQL (vérifié). Fichiers référencés à **8 endroits** : `attachments`, `prospect_files`, `budget_lines.file_path`, `show_payments.file_path`, `projects.photo_path`, `projects.artist_docs`, `employees.docs`, `mail_templates.attachments`. | Effacement par une fonction edge via l'API de stockage. La purge doit rassembler les chemins de **toutes** les lignes supprimées, y compris celles supprimées en cascade. Les fichiers Google Drive ne sont jamais concernés. |
| **Fichiers déjà orphelins** | 14 fichiers `suivi` et 18 fichiers `artiste` ne sont référencés par aucune ligne. | **Hors périmètre** : la suppression différée ne touche que les fichiers des éléments supprimés. Analyse dans S7. |
| **Reprise après erreur** | `pg_net` envoie ses appels sans attendre la réponse (réponses gardées 6 h). Le coffre Vault est vide ; le modèle existant est `private.import_secrets`. | Les lignes sont supprimées en une seule transaction (tout ou rien). Les fichiers à effacer vont dans une **file d'attente** dans la même transaction. La fonction edge traite la file : un fichier déjà absent compte comme effacé, et elle compte les tentatives. La tâche relance tant que la file n'est pas vide. Après 5 échecs, une notification est envoyée à l'équipe. Un fichier sans ligne est invisible et sans danger ; l'inverse (une ligne sans fichier) n'arrive jamais. |
| **Calculs pendant l'attente** | — | Les éléments en attente sont masqués **et exclus des totaux** (budget, compteurs) pendant les 5 s. Le masquage passe par le temps réel, donc il apparaît aussi dans les autres onglets. |

**Conclusion** : l'architecture de `CONVENTIONS.md` §4.4 est **faisable**, avec trois ajouts à intégrer au lot B13 :
1. la file d'attente des fichiers avec reprise ;
2. la purge de l'historique `pg_cron` ;
3. la contrainte d'unicité.

Restent **non vérifiés** avant B13 : le test de concurrence réel, la tenue de la tâche toutes les 5 s sur le projet de test pendant 24 h, et la durée d'effacement de gros fichiers.

---

## 5. Classement des opérations

### 5.1 Réalisables sans interruption de service
- S1 (vérification), F1-a et F1-b, S0 (projet de test), S7 (rapport) ;
- S5-a, S5-b, S6 (application uniquement, retour arrière par simple retour de version) ;
- S2 et S3-a, **si l'ordre interne est respecté** (lecture de secours, puis copie au coffre, puis retrait).

### 5.2 Nécessitant une intervention manuelle d'Anthony
| Lot | Geste | Durée estimée |
|---|---|---|
| Immédiat | Vérifier les accès au dépôt de sauvegarde ; consulter l'activité de la clé dans Brevo | 10 min |
| S0 | (Option) Créer une copie de test des scripts Google | 10 min |
| S1 | Donner accès au dépôt de sauvegarde ou faire la vérification | 5 min |
| S3-b | Créer la propriété `SECRET` dans le script de prospection et le redéployer | 5 min |
| S3-c | Nouvelle clé Brevo, révoquer l'ancienne ; nouveau code dans les deux scripts | 15 min |
| S4 | Activer la protection des mots de passe compromis | 1 min |
| Tous | Autoriser chaque fusion dans `main` | — |

### 5.3 Présentant un risque pour la production
| Lot | Risque | Mesure |
|---|---|---|
| **S3-b** | Toutes les actions Google en dépendent ; limite de durée de 150 s | durées mesurées en recette ; bascule `ping` d'abord ; retour arrière = remettre l'appel direct (code conservé jusqu'à validation) |
| **S3-c** | Quelques minutes d'actions Google en échec | heure creuse, en présence d'Anthony |
| **S4** | Page publique cassée si une fonction perd ses droits | liste croisée des fonctions publiques ; contrôle immédiat des 3 pages |
| **S2 / S3-a** (étape de retrait) | Synchronisation Brevo coupée | retrait seulement après 48 h de bon fonctionnement par le coffre |
| **S5-a** | Anciens mails moins bien affichés | mise en page comparée à l'ancien nettoyage par test ; contrôle visuel après mise en ligne |

---

## 6. Conditions de validation communes (avant chaque mise en ligne)
1. Tests de `tests/` au vert, avec les nouveaux tests du lot.
2. Lots touchant Supabase : appliqués **d'abord sur la recette (S0)** ; sauvegarde vérifiée (S1) ; export des lignes concernées.
3. `QA_CHECKLIST.md` (sections S, E et celles touchées) remplie : aucun **É** non accepté, chaque **NV** expliqué.
4. Relecture indépendante sans bloquant (`CLAUDE.md` §6), ou réfutation écrite.
5. Aucune valeur de secret dans le code, les commits, les journaux ni les comptes rendus. Contrôle par empreinte avant chaque push des lots S2 et S3.
6. Accord explicite d'Anthony, puis fusion, `bump_version.py`, mise en ligne, et vérification en production.
