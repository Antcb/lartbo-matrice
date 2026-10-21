# QA_CHECKLIST.md — Contrôles obligatoires avant mise en ligne

À remplir pour **chaque** développement (dans le compte rendu à Anthony), avant le push sur `main`.
Règles de référence : [`CONVENTIONS.md`](CONVENTIONS.md) (§ notés « C ») et [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) (§ notés « DS »).

## Statuts possibles (un seul par contrôle)
| Code | Signification |
|---|---|
| **V** — Validé | contrôle **réellement effectué**, résultat conforme (dire comment : test automatisé, capture, requête SQL, lecture du code) |
| **É** — Échec | contrôle effectué, non conforme → corriger avant mise en ligne, ou signaler explicitement à Anthony |
| **NA** — Non applicable | le développement ne touche pas ce point (dire pourquoi en quelques mots si ce n'est pas évident) |
| **NV** — Non vérifié | contrôle applicable mais **pas effectué** (outil indisponible, script Google non redéployé, rendu non ouvert…) |

**Un contrôle non effectué est NV, jamais V.** Un rendu visuel n'est V que s'il a été réellement affiché (navigateur ou capture d'écran) ; une capture faite avec des données simulées le précise. Toute ligne **É** ou **NV** est recopiée dans le compte rendu final.

## Modèle de compte rendu
```
Version : vX.Y.Z — Sujet : …
Écrans / fichiers touchés : …
Contrôles : V n · É n · NA n · NV n
É / NV : <ID> — <raison>
À faire par Anthony : (ex. redéployer Code.gs)
```

---

## A. Analyse préalable
| ID | Contrôle |
|---|---|
| A1 | Les trois documents du référentiel ont été relus pour les sections concernées. |
| A2 | Toutes les occurrences de la logique modifiée ont été recherchées (vues, fenêtres, tableaux, pages publiques, SQL, fonctions edge, Apps Script) et traitées de la même façon. |
| A3 | Greptile a été interrogé sur l'impact si la modification touche plus d'un module (sinon NA). |
| A4 | Aucune règle **[À VALIDER]** n'a été appliquée sans accord d'Anthony. |
| A5 | Toute ambiguïté métier a été posée à Anthony avant de coder. |

## D. Design system (DS)
| ID | Contrôle |
|---|---|
| D1 | Aucun nouveau `style="…"` dans le JS hors exceptions DS §10 (vérifier : `git diff \| grep 'style="'`). |
| D2 | Aucune nouvelle couleur, taille de police, rayon, ombre ou hauteur hors jetons / échelle (DS §1, §3, §6, §7). |
| D3 | Composants officiels réutilisés (DS §9) ; aucun nouveau bouton, menu, champ, pastille ou fenêtre qui duplique l'existant. |
| D4 | Titres et textes secondaires avec la classe officielle de leur rôle (DS §3.2, §3.3). |
| D5 | Une seule action principale (`.btn.primary`) par zone ; ordre des classes `btn sm variante`. |
| D6 | Règles CSS modifiées dans leur section d'origine, pas ajoutées en fin de fichier pour en écraser une autre. |

## L. Alignements et espacements
| ID | Contrôle |
|---|---|
| L1 | Montants et nombres alignés à droite (`td.num`, `.num`). |
| L2 | Champs de tableau alignés sur le texte des cellules voisines et sur le titre de colonne (DS §5). |
| L3 | Espacements entre blocs avec les utilitaires (`.mt`, `.mb`…) ou les valeurs autorisées (DS §2). |
| L4 | En-tête de page : actions à droite du titre sur ordinateur, quelle que soit la longueur du titre. |

## F. Formulaires (C §3)
| ID | Contrôle |
|---|---|
| F1 | Fenêtres via `openModal` ; champs date via `dateInput` ; nombres via `input[type=number]` (numfield). |
| F2 | Champ obligatoire : `*` dans le libellé, message qui nomme le champ, pas de refus silencieux. |
| F3 | Valeurs par défaut lues dans Réglages ou `constants.js`, jamais écrites en dur (C §3.3, §6.2). |
| F4 | Enregistrement : la valeur reste affichée après rechargement ; en cas de refus de Supabase, l'ancienne valeur revient et un message s'affiche. |
| F5 | Brouillon : fermer sans enregistrer puis rouvrir restaure la saisie, sans écraser le pré-remplissage d'une autre fiche. |
| F6 | Pages publiques testées aussi (fiche, artiste, rh) si le formulaire ou le champ y existe. |

## H. Dates et heures (C §1)
| ID | Contrôle |
|---|---|
| H1 | Affichage en `JJ/MM/AAAA` via `fmtDate` / `fmtShort` ; aucun format ISO visible, aucun `split('-').reverse()` ajouté. |
| H2 | « Aujourd'hui » via `today()` (client) ou Europe/Paris (serveur) ; aucun `toISOString().slice(0,10)` ajouté. |
| H3 | Horodatage affiché via `fmtDate(horodatage complet)`, jamais `.slice(0,10)`. |
| H4 | **Cas minuit** : comportement vérifié pour une action faite entre 00 h et 02 h heure de Paris (horloge simulée dans le test : `page.clock` ou date injectée) — date du jour, échéance, date d'envoi, date de facture. |
| H5 | **Week-end** : une échéance J+10 qui tombe un samedi ou un dimanche passe au lundi (client et SQL). |
| H6 | Dates limites : 29 février, changement d'année, date de fin avant date de début refusée. |
| H7 | Saisie au clavier (`10/03`, `10/03/27`, `100327`) et au calendrier ; sur écran tactile, calendrier accessible. |

## M. Montants (C §2)
| ID | Contrôle |
|---|---|
| M1 | Affichage via `eur2` / `eur` selon la règle en vigueur ; espace des milliers, virgule, `€` après. |
| M2 | **Virgule décimale** : saisir `12,5`, `1 200,50`, `0,5` → enregistré `12.5`, `1200.5`, `0.5` ; saisie illisible refusée avec message. |
| M3 | Arrondi au centime ; totaux = somme des montants affichés (pas d'écart de 0,01 €). |
| M4 | Montants calculés uniquement par les fonctions officielles (C §2.5) ; HT partout sauf billetterie TTC. |
| M5 | Pourcentages en points (15 = 15 %), affichés `15 %`. |
| M6 | Le résumé « Prévu / à jour / écart » d'un budget tombe juste avec les lignes (reste = cachet − commission − dépenses). |

## I. Interactions et actions (C §4)
| ID | Contrôle |
|---|---|
| I1 | Le même champ modifié depuis le tableau, la fenêtre et la page détail produit **le même effet** (effets de bord compris). |
| I2 | Terminer / clore / annuler : élément visible 5 s avec **Annuler** ; Annuler remet exactement l'état précédent (y compris relances, `done_at`). |
| I3 | **Suppression avec fichiers** : supprimer une tâche, un suivi, une date, un projet supprime aussi ses fichiers stockés et ses lignes liées ; vérifier dans le stockage (`suivi`) qu'aucun fichier orphelin ne reste. |
| I4 | Aucun fichier Google Drive supprimé ni écrasé ; un remplacement ne se fait qu'après choix explicite (ancien → corbeille). |
| I5 | Confirmation : texte qui nomme l'élément ; « Annuler » annule toujours tout ; aucun `prompt()` ni `alert()` ajouté. |
| I6 | Nouvelle ligne : visible, rangée à sa place logique, mise en évidence, curseur dans le premier champ utile. |
| I7 | Double clic / double envoi : pas de doublon créé (bouton désactivé pendant l'action). |

## R. Responsive (DS §11)
| ID | Contrôle |
|---|---|
| R1 | Affichage ordinateur (1440 px) : rien ne déborde, pas de défilement horizontal de la page. |
| R2 | Tablette (≤ 1100 px) : grilles en une colonne, tableaux en fiches avec libellés corrects (y compris lignes avec cellules fusionnées). |
| R3 | Téléphone (390 px, iPhone 13) : menus accessibles (notifications, compte, Réglages), fenêtres plein écran, champs à 16 px, pas de zoom automatique. |
| R4 | Écran tactile : pas de clavier qui s'ouvre tout seul, listes de choix utilisables (feuille du bas), calendrier accessible, cibles ≥ 40 px pour les actions principales. |

## E. Erreurs (C §3.6, §7.7)
| ID | Contrôle |
|---|---|
| E1 | Chaque échec d'écriture affiche un message en français (tester en coupant le réseau ou avec un refus simulé). |
| E2 | Aucune erreur brute (anglais, code SQL) affichée, en particulier sur les pages publiques. |
| E3 | Console du navigateur : aucune erreur JavaScript sur les écrans touchés (test automatisé : liste `pageerror` vide). |
| E4 | Intégration externe saturée (IA, Brevo, Pennylane) : nouvel essai automatique ou message clair, jamais d'action perdue en silence. |

## N. Navigation (C §4.8)
| ID | Contrôle |
|---|---|
| N1 | Changement d'écran par `go()` ou une fonction d'ouverture dédiée ; pas de page détail « fantôme » en revenant sur un onglet. |
| N2 | Bouton « ← » de la page et retour du navigateur mènent au même endroit, avec le même nettoyage. |
| N3 | Filtres et recherche : comportement identique avant et après la modification (mémorisés ou non selon la règle en vigueur). |

## G. Cohérence des données et règles métier (C §6)
| ID | Contrôle |
|---|---|
| G1 | **Booking / Production** : tester une date d'un artiste en booking **et** une en production (mails, facturation, budget, rappels, compte dédié) ; une date sans `prod_mode` ne se comporte pas différemment selon l'écran. |
| G2 | Commission, acompte, solde, cachet : valeurs conformes à la priorité en vigueur (C §6.2–6.5) ; somme acomptes + solde = 100 %. |
| G3 | Réglages et COST€ respectés : aucune valeur codée qui contredit un réglage ; écart avec COST€ signalé. |
| G4 | **Pôle renommé** : renommer « Booking » dans Réglages (environnement de test) ne casse ni l'échéance J+10, ni les relances, ni le rattachement des tâches — sinon É tant que la correction n'est pas faite. |
| G5 | Statuts : codes stockés inchangés, libellés français affichés (écran **et** exports). |
| G6 | Après une action qui déclenche un trigger (confirmation d'une date, changement de mode), l'écran affiche l'état réel de la base (relecture). |
| G7 | Requête de contrôle en base : pas de ligne orpheline ni de doublon créé par le développement. |

## S. Sécurité
| ID | Contrôle |
|---|---|
| S1 | Toute valeur affichée dans du HTML passe par `esc` (ou `safeHtml` pour du HTML enrichi). |
| S2 | Nouvelle table : RLS activé avec `is_team()` ; nouvelle fonction : `search_path` fixé et droits `anon` retirés sauf page publique. |
| S3 | Aucun secret ajouté dans `settings`, dans le code ou dans un commentaire. |
| S4 | Pages publiques : accès uniquement par jeton ; aucune donnée d'une autre date / d'un autre artiste accessible. |
| S5 | Alertes de sécurité Supabase relancées : aucune nouvelle alerte causée par le développement. |

## B. Supabase (C §7)
| ID | Contrôle |
|---|---|
| B1 | Migration dans `supabase/migrations/AAAA-MM-JJ_vX.Y_sujet.sql`, rejouable, appliquée en base et enregistrée dans l'historique. |
| B2 | Fonction modifiée réécrite entièrement (pas de remplacement de texte) ; vérification après coup que la définition en base contient la modification. |
| B3 | Nouvelle colonne `*_id` : clé étrangère + index ; nouvelle table : ajoutée à `TABLES`, au temps réel et à la sauvegarde. |
| B4 | Règle écrite des deux côtés (C §8.4) modifiée des deux côtés dans la même version. |
| B5 | Fonction edge redéployée et contenu en ligne identique au dépôt. |
| B6 | Tâche planifiée (`rappels-quotidiens`) non perturbée : `generate_reminders` exécutable sans erreur. |

## P. Google Apps Script
| ID | Contrôle |
|---|---|
| P1 | Toute modification de `apps-script/*.gs` est signalée à Anthony avec la marche à suivre (Réglages › Google › « Copier le code à jour », coller, nouvelle version de déploiement). |
| P2 | L'application reste utilisable avec l'ancien script (message clair « script pas à jour »). |
| P3 | Après redéploiement par Anthony : action testée en réel (sinon **NV**). |
| P4 | Drive : nomenclature du `README.md` respectée ; aucun fichier existant supprimé ; doublons détectés avant création. |
| P5 | Opération longue (copie de dossier, rangement en lot) : reprise possible si Google coupe à 6 min, rien de copié deux fois. |

## T. Tests
| ID | Contrôle |
|---|---|
| T1 | Tests automatisés (Playwright, données simulées) des écrans touchés : lancés, résultats conformes, `pageerror` vide. |
| T2 | Tests de non-régression des écrans voisins / partageant le même composant ou la même fonction : lancés. |
| T3 | Nouveau comportement couvert par un nouveau test (ou NV justifié). |
| T4 | Vérification réelle en production quand c'est sans risque (lecture, synchronisation) ; sinon NV. |

## Z. Régressions
| ID | Contrôle |
|---|---|
| Z1 | Fonctions modifiées : tous leurs appelants listés (grep ou Greptile) et vérifiés. |
| Z2 | Composant partagé modifié : vérifié dans l'app **et** les pages publiques qui l'utilisent. |
| Z3 | Comportement des autres pôles / modes / artistes inchangé (au moins un cas booking, un cas production, un artiste inactif). |

## V. Versionnage et CHANGELOG
| ID | Contrôle |
|---|---|
| V1 | `python3 tools/bump_version.py patch\|minor "…"` lancé (pas de modification manuelle de la version, du CHANGELOG ou des `?v=`). |
| V2 | Entrée du CHANGELOG en français, compréhensible par Anthony (ce qui change pour lui). |
| V3 | Nouveau module JS : présent dans la carte d'import des 4 pages HTML (relancer le script). |
| V4 | Commit `vX.Y.Z : …` poussé sur `main` ; la version affichée dans l'app est la nouvelle (bandeau « Recharger » sur les sessions ouvertes). |

## Q. Revue Greptile
| ID | Contrôle |
|---|---|
| GR1 | Arbre de `main` poussé sur `review/full` et revue demandée sur la PR n°1. |
| GR2 | Toutes les remarques traitées : corrigées, ou réfutées avec justification écrite. |
| GR3 | Nouvelle revue jusqu'à **0 remarque** ; si Greptile ne répond pas : **NV** (« revue Greptile non obtenue »), jamais V. |
