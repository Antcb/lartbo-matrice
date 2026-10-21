# QA_CHECKLIST.md — Contrôles obligatoires après chaque développement

À remplir pour **chaque** développement, avant le push sur `main`, et à joindre au compte rendu à Anthony.
Règles de référence : [`CONVENTIONS.md`](CONVENTIONS.md) (« C § ») et [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (« DS § ») ; décisions Q0–Q38 (21/10/2026).

**Adapter les contrôles aux parties réellement modifiées** : une section entière peut être NA si le développement ne la touche pas — mais les contrôles de **régressions transversales** (section Z) et les tests (section T) ne sont jamais tous NA.

## Statuts possibles (un seul par contrôle)
| Code | Signification |
|---|---|
| **V** — Validé | contrôle **réellement effectué**, résultat conforme (dire comment : test automatique, capture, requête SQL, lecture du code) |
| **É** — Échec | contrôle effectué, non conforme → corriger avant mise en ligne, ou le signaler explicitement à Anthony |
| **NA** — Non applicable | le développement ne touche pas ce point (raison en quelques mots si ce n'est pas évident) |
| **NV** — Non vérifié | contrôle applicable mais **pas effectué** (outil indisponible, script Google non redéployé, rendu non ouvert…) |

**Un contrôle non effectué est NV, jamais V.** Un rendu visuel n'est V que s'il a été réellement affiché (navigateur ou capture) ; une capture avec données simulées le précise. Toute ligne **É** ou **NV** est recopiée dans le compte rendu final.

## Modèle de compte rendu
```
Version : vX.Y.Z — Sujet : …
Parties modifiées : …   Décisions concernées : Qn, Qm
Contrôles : V n · É n · NA n · NV n
É / NV : <ID> — <raison>
À faire par Anthony : (ex. redéployer Code.gs)
```

---

## A. Analyse préalable
| ID | Contrôle |
|---|---|
| A1 | Sections concernées des trois documents relues. |
| A2 | Toutes les occurrences de la logique modifiée recherchées (vues, fenêtres, tableaux, pages publiques, SQL, fonctions edge, Apps Script) et traitées de la même façon. |
| A3 | Greptile interrogé sur l'impact si la modification touche plus d'un module (sinon NA). |
| A4 | Les décisions Q0–Q38 concernées sont respectées ; aucune règle métier nouvelle n'a été inventée ; toute ambiguïté a été posée à Anthony avant de coder. |
| A5 | Correction faite au titre de Q0 (bug évident) : les 5 conditions de `CLAUDE.md` §8 sont remplies (règles métier, données historiques, pas de suppression/migration destructive, impacts vérifiés, tests). |

## D. Design system (DS)
| ID | Contrôle |
|---|---|
| D1 | Aucun nouveau `style="…"` dans le JS hors exceptions DS §10 (`git diff \| grep 'style="'`). |
| D2 | Aucune nouvelle couleur, taille de police, rayon, ombre ou hauteur hors jetons / échelle (DS §1, §3, §6, §7). |
| D3 | Composants officiels réutilisés (DS §9, §9.1) ; aucun nouveau bouton, menu, champ, pastille ou fenêtre qui duplique l'existant. |
| D4 | Titres : grands bleus pour les sections principales, petits gris pour les sous-sections (DS §3.2, Q32) ; textes secondaires avec la classe de leur rôle (DS §3.3). |
| D5 | Une seule action principale (`.btn.primary`) par zone ; ordre des classes `btn sm variante`. |
| D6 | Règles CSS modifiées dans leur section d'origine, pas ajoutées en fin de fichier pour en écraser une autre. |
| D7 | Couleurs selon leur sens (Q31) : vert/jaune/rouge/bleu par signification ; **échéance du jour en violet**, distincte d'un retard (rouge) et d'une erreur de saisie. |
| D8 | Sélection (Q33) : filtre actif en bleu plein, élément choisi dans une liste en bleu pâle. |
| D9 | Mise en page à deux colonnes : 50/50 ou 66/33 ; toute autre proportion justifiée en commentaire (Q34). |

## L. Alignements et espacements
| ID | Contrôle |
|---|---|
| L1 | Montants et nombres alignés à droite (`td.num`, `.num`). |
| L2 | Champs de tableau alignés sur le texte des cellules voisines et sur le titre de colonne (DS §5). |
| L3 | Espacements avec les utilitaires (`.mt`, `.mb`…) ou les valeurs autorisées (DS §2) ; bloc principal 18, sous-bloc 12. |
| L4 | En-tête de page : actions à droite du titre sur ordinateur, quelle que soit la longueur du titre. |

## F. Formulaires et saisies (C §3)
| ID | Contrôle |
|---|---|
| F1 | Fenêtres via `openModal` ; dates via `dateInput` ; nombres via `input[type=number]` (numfield). |
| F2 | Champ obligatoire : `*`, message qui nomme le champ, pas de refus silencieux ; même règle partout où le champ est saisi. |
| F3 | Valeurs par défaut lues dans Réglages ou `constants.js` ; une valeur modifiée par l'utilisateur n'est jamais rétablie automatiquement (Q3, Q5). |
| F4 | Enregistrement : la valeur reste après rechargement ; refus de Supabase → ancienne valeur + message. |
| F5 | Brouillon : fermer sans enregistrer puis rouvrir restaure la saisie, sans écraser le pré-remplissage d'une autre fiche. |
| F6 | **Mails** (Q23) : `abc`, `abc@`, `abc@domaine` sont refusés avec un message en français, dans la fenêtre, le tableau **et** les pages publiques ; une adresse n'est jamais déplacée dans les notes ou un autre champ (vérifier aussi le trigger `contacts_clean`). |
| F7 | **Téléphones** (Q24) : `+33 6 12 34 56 78`, `0612345678`, `+41 79 123 45 67`, `(212) 555-0100` acceptés ; seuls espaces superflus et caractères invisibles retirés ; chiffres et préfixe identiques avant/après enregistrement. |
| F8 | Pages publiques (fiche, artiste, rh) testées aussi si le champ ou le formulaire y existe. |

## H. Dates et heures (C §1)
| ID | Contrôle |
|---|---|
| H1 | Affichage `JJ/MM/AAAA` via `fmtDate` / `fmtShort` ; aucun format ISO visible, aucun `split('-').reverse()` ajouté. |
| H2 | « Aujourd'hui » via `today()` (client) ou Europe/Paris (serveur) ; aucun `toISOString().slice(0,10)` ajouté. |
| H3 | Horodatage affiché via `fmtDate(horodatage complet)`, jamais `.slice(0,10)`. |
| H4 | **Cas minuit** : action simulée entre 00 h et 02 h heure de Paris (horloge simulée : `page.clock` ou date injectée) — date du jour, échéance, date d'envoi, date de facture, date de réalisation d'une tâche = jour de Paris. |
| H5 | **Week-end** : échéance J+n un samedi/dimanche → lundi (client et SQL) ; boucle technique un samedi/dimanche → **vendredi précédent** (Q12). |
| H6 | Dates limites : 29 février (+1 an), 31 → mois de 30 jours (boucle J-4 mois), changement d'année, date de fin avant début refusée. |
| H7 | Saisie clavier (`10/03`, `10/03/27`, `100327`) et calendrier ; sur écran tactile, calendrier accessible. |
| H8 | **Date longue** (Q21) : `lundi 1er mars 2027` (minuscules, « 1er ») identique dans l'app, les mails, le contrat et le SQL ; majuscule seulement en début de phrase ; jour de la semaine vérifié contre la date réelle (ex. 01/03/2027 = lundi). |

## M. Montants et calculs financiers (C §2, §6)
| ID | Contrôle |
|---|---|
| M1 | **Centimes** (Q22) : contextes comptables (factures, paiements, budgets, comptes, exports, mails de facturation) en `eur2` (`1 200,00 €`) ; contextes indicatifs en `eur` (`1 200 €`, mais `1 200,50 €`). Valeur stockée exacte, jamais arrondie par l'affichage. |
| M2 | **Virgule** : saisir `12,5`, `1 200,50`, `0,5` → enregistré `12.5`, `1200.5`, `0.5` ; saisie illisible refusée avec message. |
| M3 | Arrondi au centime ; totaux = somme des montants affichés (pas d'écart de 0,01 €). |
| M4 | Montants calculés uniquement par les fonctions officielles (C §2.5) ; HT partout sauf billetterie TTC ; pourcentages affichés `15 %`. |
| M5 | **Commission** (Q1, Q2) : cas testés — ligne facture saisie ; % sur la date ; % sur l'artiste (y compris date Booking d'un artiste en Production → % de l'artiste) ; aucun % → réglage du mode. Une commission **facturée** (envoyée, numérotée ou payée) n'est jamais recalculée (changer cachet, %, mode, réglage). |
| M6 | **Acompte** (Q3) : réglage à 0 % → aucune ligne d'acompte créée / acompte 0 ; réglage vide → 50 % ; un % modifié à la main n'est jamais rétabli. |
| M7 | **Solde** (Q4) : avant envoi, recalculé quand un acompte change ; **après envoi** (`sent_at`, n° ou Pennylane) : montant figé, ajout ou modification d'acompte qui changerait le solde **bloqué avec message**, aucune modification silencieuse par l'écran, un trigger ou la synchronisation ; aucune procédure de régularisation développée sans validation. |
| M8 | **Cachet** (Q5) : changer le cachet depuis le tableau Production, la fiche de la date **et** « Valider les conditions » → lignes en % recalculées ; ligne saisie à la main non envoyée → **question** « conserver / recalculer » ; lignes envoyées/payées inchangées. |
| M9 | **Compte d'encaissement** (Q6) : ligne sans compte affichée « Non renseigné » ; exclue des soldes par compte (compte dédié, avance L'ArtBo) ; clairement identifiable dans les encaissements de la date et dans les totaux par artiste (« dont X € — compte non renseigné ») ; marquer une facture réglée sans compte (à la main et par la synchronisation Pennylane) → demande visible du compte. |
| M10 | Résumé de budget « Prévu / à jour / écart » cohérent avec ses lignes (reste = cachet − commission − dépenses). |

## I. Interactions et actions (C §4)
| ID | Contrôle |
|---|---|
| I1 | Le même champ modifié depuis le tableau, la fenêtre et la page détail produit **le même effet**. |
| I2 | Terminer / clore / annuler : visible 5 s avec **Annuler**, qui rétablit exactement l'état précédent (relances, `done_at`). |
| I3 | **Tâche terminée** (Q17) : depuis la case, la fenêtre et la fermeture automatique d'une relance → `done_at` = date et heure réelles (Paris) ; repasser « À faire » vide `done_at` ; les anciennes tâches sans date restent vides (aucune date inventée). |
| I4 | **Suppression** (Q18, Q19) — tester tâche, suivi, date, artiste, ligne : (1) fenêtre de confirmation qui nomme l'élément **et le nombre de pièces jointes** ; (2) disparition + « Annuler » 5 s ; (3) **Annuler** → ligne **et fichiers** toujours présents (vérifier le stockage `suivi`) ; (4) sans annulation → lignes puis fichiers supprimés après 5 s, aucun fichier orphelin ; (5) **page fermée ou rechargée pendant le délai → suppression quand même effectuée par le serveur** (vérifier en base et dans le stockage 10 s plus tard) ; (6) Annuler après 5 s → refusé avec message ; (7) un autre onglet ouvert voit l'élément disparaître (temps réel) ; (8) aucun fichier Google Drive touché. |
| I5 | **Fenêtres** (Q20) : aucun `alert`/`confirm`/`prompt` (`grep -n "confirm(\|alert(\|prompt(" js`) ; « Annuler », Échap et clic extérieur ne déclenchent jamais l'action ; question à deux issues = deux boutons nommés ; mot de passe masqué. |
| I6 | Nouvelle ligne : visible, rangée à sa place logique, mise en évidence, curseur dans le premier champ utile. |
| I7 | Double clic / double envoi : pas de doublon (bouton désactivé pendant l'action). |
| I8 | Aucun fichier Google Drive supprimé ni écrasé ; remplacement seulement après choix explicite (ancien → corbeille). |

## R. Responsive (DS §11)
| ID | Contrôle |
|---|---|
| R1 | Ordinateur (1440 px) : rien ne déborde, pas de défilement horizontal de la page. |
| R2 | **Tablette paysage 1 024 et 1 100 px** (Q35) : tableaux classiques conservés, aucune information coupée, défilement horizontal dans le cadre du tableau si nécessaire, jamais de la page. |
| R3 | Tablette portrait (≤ 1 023 px) : tableaux en fiches avec libellés corrects (y compris cellules fusionnées et totaux) ; grilles en une colonne à ≤ 1 100 px. |
| R4 | Téléphone (390 px) : menus accessibles (notifications, compte, Réglages), fenêtres plein écran (y compris les nouvelles fenêtres de dialogue), champs à 16 px, pas de zoom automatique. |
| R5 | Écran tactile : pas de clavier qui s'ouvre seul, listes de choix utilisables, calendrier accessible, cibles ≥ 40 px pour les actions principales. |

## E. Erreurs (C §3.6, §7.9)
| ID | Contrôle |
|---|---|
| E1 | Chaque échec d'écriture affiche un message en français (réseau coupé ou refus simulé). |
| E2 | Aucune erreur brute (anglais, code SQL) affichée, en particulier sur les pages publiques. |
| E3 | Console du navigateur : aucune erreur JavaScript sur les écrans touchés (liste `pageerror` vide). |
| E4 | Intégration externe saturée (IA, Brevo, Pennylane) : nouvel essai automatique ou message clair, jamais d'action perdue en silence. |

## N. Navigation, filtres, listes (C §4.8, §5)
| ID | Contrôle |
|---|---|
| N1 | Changement d'écran par `go()` ou une fonction d'ouverture dédiée ; pas de page détail « fantôme » en revenant sur un onglet. |
| N2 | Bouton « ← » et retour du navigateur : même destination, même nettoyage. |
| N3 | **Liens directs** (Q25) : adresse d'une fiche artiste, structure, suivi, date → rechargement = même fiche ; lien copié ouvert dans un autre onglet = même fiche ; sans session → connexion puis fiche ; fiche inexistante ou supprimée → message en français et retour à la liste. |
| N4 | **Filtres** (Q26, Q27) : filtre Artistes identique dans tous les onglets concernés ; tous les filtres de l'onglet conservés après rechargement ; bouton « Réinitialiser les filtres » visible quand un filtre est actif et efficace (onglet + filtre Artistes) ; les recherches tapées ne survivent pas au rechargement. |
| N5 | **Dates d'une fiche artiste / structure** (Q28) : futures d'abord (proche → lointaine), puis « Dates passées » repliées (récente → ancienne) ; une date du jour est rangée avec les futures. |
| N6 | **Recherche de structure** (Q29) : taper le nom d'un contact dans chaque sélecteur de structure (tâche, date, suivi, contact, liste) propose sa structure ; les noms qui commencent par la saisie restent en tête. |
| N7 | Liste de plus de 300 lignes : 300 affichées + message. |

## G. Règles métier et cohérence des données (C §6)
| ID | Contrôle |
|---|---|
| G1 | **Booking / Production** : une date en booking **et** une en production testées (mails, facturation, budget, rappels, compte dédié). |
| G2 | **Changement de mode d'un artiste** (Q10) : seules ses dates futures sans facture envoyée ni comptabilisée (aucune ligne avec envoi, numéro, Pennylane ou paiement) et non manuelles changent ; dates passées et dates facturées inchangées (requête avant/après). |
| G3 | **Co-Réalisation** (Q11) : budget de tournée (pas de budget de production), reste dans le compte dédié. Production / Co-Production : budget de production, hors compte dédié. |
| G4 | **Rappels** (Q12–Q15) : boucle technique J-4 mois (vendredi si week-end) identique app/serveur ; impayé ancien (> 120 jours) toujours en rouge **et** notifié, **une seule notification par échéance** (relancer `generate_reminders` deux fois : pas de doublon) ; commission à virer dès le premier encaissement partiel, toutes lignes, app et serveur ; délai commercial (prospection + tâches Booking) et délai administratif indépendants (modifier l'un ne change pas les échéances de l'autre) ; rappels administratifs toujours limités comme aujourd'hui. |
| G5 | **Pôles** (Q16) : renommer un pôle (environnement de test) → tâches rattachées, échéance par défaut, relances et rattachement au suivi intacts ; tant que la correction n'est pas faite : É si le développement touche les pôles. |
| G6 | Statuts : codes stockés inchangés, libellés français affichés (écran **et** exports). |
| G7 | Après une action qui déclenche un trigger (confirmation d'une date, changement de mode), l'écran affiche l'état réel de la base (relecture). |
| G8 | **Données historiques** (Q7, Q17) : aucune ligne historique modifiée sans validation (225 encaissements sans compte, 547 tâches sans date, dates passées) — requête de contrôle avant/après. |
| G9 | **Dépenses réelles / COST€** (Q8, Q9) : fonctionnalité de dépenses disponible pour tout artiste en Production ; rien ne supprime, n'arrête ni n'écrase COST€ ; un écart Matrice ↔ COST€ est signalé. |
| G10 | Requête de contrôle : pas de ligne orpheline ni de doublon créé par le développement. |

## S. Sécurité
| ID | Contrôle |
|---|---|
| S1 | Toute valeur affichée dans du HTML passe par `esc` (ou `safeHtml` pour du HTML enrichi). |
| S2 | Nouvelle table : RLS `is_team()` ; nouvelle fonction : `search_path` fixé, droits `anon` retirés sauf page publique. |
| S3 | Aucun secret ajouté dans `settings`, le code, un commentaire ou un message ; secret déplacé : retiré des paramètres lisibles par le navigateur ; si exposition confirmée : rotation faite (Q38). |
| S4 | Pages publiques et liens directs : accès uniquement par jeton ou session ; aucune donnée d'une autre date / d'un autre artiste accessible. |
| S5 | Alertes de sécurité Supabase relancées : aucune nouvelle alerte causée par le développement. |

## B. Supabase (C §7)
| ID | Contrôle |
|---|---|
| B1 | Migration dans `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql`, rejouable, appliquée par le mécanisme de migrations et enregistrée dans l'historique. |
| B2 | Fonction modifiée réécrite entièrement (pas de remplacement de texte) ; définition en base vérifiée après coup. |
| B3 | Nouvelle colonne `*_id` : clé étrangère + index (données existantes contrôlées avant) ; nouvelle table : `TABLES`, temps réel, sauvegarde. |
| B4 | Règle écrite des deux côtés (C §8.4) modifiée des deux côtés dans la même version. |
| B5 | Fonction edge redéployée, contenu en ligne identique au dépôt. |
| B6 | Tâche planifiée `rappels-quotidiens` : `generate_reminders` s'exécute sans erreur. |
| B7 | **Opération sensible** (Q38) : sauvegarde de la nuit vérifiée, lignes concernées exportées avant, requête de contrôle après. |
| B8 | **Aucune suppression** de table, fonction, colonne ou donnée (y compris les 4 tables et 6 fonctions techniques) sans recherche des dépendances **et** validation spécifique d'Anthony (Q38). |

## P. Google Apps Script
| ID | Contrôle |
|---|---|
| P1 | Toute modification de `apps-script/*.gs` signalée à Anthony avec la marche à suivre (Réglages › Google › « Copier le code à jour », coller, nouvelle version). |
| P2 | L'application reste utilisable avec l'ancien script (message « script pas à jour »). |
| P3 | Après redéploiement par Anthony : action testée en réel (sinon NV). |
| P4 | **Indicateur de version** (Q37) : « À jour » seulement si le script déployé renvoie la même version que le dépôt ; script ancien → « Mise à jour nécessaire » ; script injoignable ou sans numéro → « Impossible à vérifier » (tester les trois cas). Le numéro de version du script est mis à jour à chaque modification du `.gs`. |
| P5 | Drive : nomenclature du `README.md` ; aucun fichier existant supprimé ; doublons détectés avant création. |
| P6 | Opération longue (copie de dossier, rangement en lot) : reprise possible si Google coupe à 6 min, rien de copié deux fois. |

## T. Tests (C §9)
| ID | Contrôle |
|---|---|
| T1 | Tests automatiques du dossier `tests/` couvrant les parties modifiées : lancés, conformes, `pageerror` vide. |
| T2 | Tests des parcours critiques voisins (création → confirmation → factures → budget ; prospection → relance ; tâche → terminer ; suppression) : lancés. |
| T3 | Correction : un nouveau test qui aurait détecté le problème est ajouté au dépôt (ou NV justifié). |
| T4 | Vérification réelle en production quand c'est sans risque (lecture, synchronisation) ; sinon NV. |
| T5 | Tant que le dossier `tests/` n'existe pas : tests de session lancés et **NV** noté pour T1–T3 « tests non versionnés ». |

## Z. Régressions transversales
| ID | Contrôle |
|---|---|
| Z1 | Fonctions modifiées : tous leurs appelants listés (grep ou Greptile) et vérifiés. |
| Z2 | Composant partagé modifié : vérifié dans l'app **et** les pages publiques qui l'utilisent. |
| Z3 | Au moins un cas booking, un cas production, un artiste inactif et une date passée vérifiés. |
| Z4 | Écrans qui affichent les mêmes données (liste, fiche, fenêtre, export, mail) : résultat identique. |

## V. Versionnage et CHANGELOG
| ID | Contrôle |
|---|---|
| V1 | `python3 tools/bump_version.py patch\|minor "…"` lancé (aucune modification manuelle de la version, du CHANGELOG ou des `?v=`). |
| V2 | Entrée du CHANGELOG en français, compréhensible par Anthony. |
| V3 | Nouveau module JS : présent dans la carte d'import des 4 pages HTML. |
| V4 | Commit `vX.Y.Z : …` poussé sur `main` ; la nouvelle version s'affiche dans l'app. Documentation ou travail exploratoire : branche dédiée, pas de fusion sans accord. |

## Q. Revue Greptile
| ID | Contrôle |
|---|---|
| GR1 | Arbre de `main` poussé sur `review/full` et revue demandée sur la PR n°1. |
| GR2 | Toutes les remarques traitées : corrigées, ou réfutées avec justification écrite. |
| GR3 | Nouvelle revue jusqu'à **0 remarque** ; si Greptile ne répond pas : **NV** (« revue Greptile non obtenue »), jamais V. |
