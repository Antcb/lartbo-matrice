# Journal des versions — Matrice Booking L'ArtBoristerie

Numérotation : **majeur.mineur.correctif**. Un correctif répare quelque chose, une version mineure ajoute une fonctionnalité, une version majeure change profondément l'outil.
Pour publier une nouvelle version : `python3 tools/bump_version.py minor "Ce qui change"` (voir README).

<!-- nouvelles versions ci-dessous -->

## 1.17.1 — 13/10/2026
- Correctif fenêtre des modèles de mail


## 1.17.0 — 13/10/2026
- Bandeau réordonné ; tâches Booking à J+10 ; filtre Pour qui dans To Do ; artistes d'un suivi en cases à cocher ; pincement pour zoomer la carte ; {{cp}} = 2 chiffres ; pièces jointes Gmail dans les brouillons ; abréviations retirées ; même fiche structure partout ; recherche de ville plus rapide


## 1.16.5 — 13/10/2026
- IA : clés Google au nouveau format AQ.


## 1.16.4 — 13/10/2026
- IA : demandes envoyées depuis Paris (règles européennes de Google)


## 1.16.3 — 13/10/2026
- Réglages › IA : clé Google AI Studio (Gemini) pour les résumés de suivi


## 1.16.2 — 13/10/2026
- Brevo : vérification de la clé API et du n° de liste


## 1.16.1 — 13/10/2026
- Brevo : n'ajoute que les nouveaux mails, ne modifie jamais un contact déjà dans Brevo (désabonnés compris)


## 1.16.0 — 13/10/2026
- Structures : festivals/salles avec dates, jauge, tarif et prix moyen (résumé sur l'accueil), dates annulées repliées, toujours ouvertes sur l'Accueil ; Brevo ; recherche avec apostrophes ; / automatiques dans les dates ; choix de l'artiste au clavier ; pièces jointes dans le fil du suivi ; export booking simplifié ; lien vers la structure depuis Production


## 1.15.6 — 12/10/2026
- Tableau de renommage rangé dans « - Temp » ; nouvel exercice comptable copié depuis le modèle


## 1.15.5 — 12/10/2026
- Noms Drive : département du lieu de la date (plus celui du siège de la structure), versions de contrats V1/V2, pré-contrats et locations ignorés, rattachement des dossiers à la date confirmée


## 1.15.4 — 12/10/2026
- Exports nommés « 2026-10-12 Tour The Locos 2026 » et « 2026-10-12 Suivis The Locos »
- Bulletins de paie rangés dans 01_Finance › exercice › E - Sociale › AAAA-MM ; notes de frais dans 01_Finance › exercice › B - Notes de Frais › AAAA-MM › NOM Prénom (dossier type copié, fichier modèle renommé)


## 1.15.3 — 12/10/2026
- Renommage des contrats : « • Signed » quand l’organisateur a signé, « • Co-signed » quand les deux parties ont signé ; nomenclatures récapitulées dans le README


## 1.15.2 — 12/10/2026
- Nomenclatures corrigées : dossier de date « MM-DD • Ville • Salle (79) » et contrat « Artiste • AAAA-MM-JJ • Ville (79) • Salle • CC/CR », avec les 2 premiers chiffres du code postal (2A/2B en Corse, 971… outre-mer, pays à l’étranger)
- Vérification des noms : seuls les fichiers contenant « contrat » sont considérés comme des contrats (hors avenants, contrats techniques, fiches)


## 1.15.1 — 12/10/2026
- Glisser-déposer partout : un fichier lâché près de n’importe quel bouton « Ajouter un fichier » (modèles de mail, préparation d’un mail, fiche salarié, questionnaire…) est pris en compte, avec la zone surlignée pendant le survol


## 1.15.0 — 12/10/2026
- Modèles de mail : balises {{horaire}} (heure de passage) et {{duree_set}} (durée du set), remplies depuis la date, la fiche validée ou la fiche de l’organisateur ; heure de passage et durée du set modifiables dans Production
- Raccourcis clavier partout : ⌘B gras, ⌘I italique, ⌘U souligné (mails), ⌘K lien, ⌘Entrée pour enregistrer (journal, formulaires) — Ctrl sur PC


## 1.14.0 — 12/10/2026
- Modèles de mail : pièces jointes déposées directement (sans passer par le Drive) ou liens Drive, et pièces jointes ajoutées au moment d’envoyer
- Modèles de mail : variante en nom libre, règle « Proposé en premier pour » (salle, festival, co-réalisation, cession, toutes) et bouton « Dupliquer » pour créer une variante


## 1.13.2 — 12/10/2026
- Vérifier les noms : le tableau s’ouvre sans être bloqué par le navigateur, il est partagé avec anthony@ et un bouton « Ouvrir le dernier tableau » le retrouve dans Réglages


## 1.13.1 — 10/10/2026
- Salariés : nouveau fonctionnement — l’export Movinmotion remplit la fiche, le lien envoyé au salarié ne demande que les infos complémentaires (permis 4a/4b, permis B, cartes SNCF, Flying Blue, scan du permis) et range tout
- Salariés : « Créer la fiche RH » génère le Google Sheet depuis le modèle Fiche RH 2026 dans son dossier
- Suivi : dates sans suite, annulées ou d’autres artistes repliées


## 1.13.0 — 10/10/2026
- Booking : un clic sur une pastille de statut sous la carte la masque / l’affiche ; enchaînements repliés par défaut ; export des dates (un artiste, année complète ou période, statuts, avec ou sans cachets)
- Exports en Excel aux couleurs de L’ArtBoristerie (logo, titre, en-têtes) pour les partenaires, ou CSV brut : dates et suivis
- Co-réalisation : l’organisateur peut proposer le break dans la fiche ; le break validé devient celui de la date
- Fiche projet : personnes sur la route (repas), chambres single / twin, mise à disposition (heures) reprises dans les contrats et les balises de mail ; modèles de contrat propres à chaque artiste
- Salariés : deux questionnaires (fiche RH avec CNI, carte vitale, RIB, permis… et infos complémentaires avec carte grise, cartes de voyage) ; bulletins de paie et notes de frais rangés dans leurs propres dossiers
- Suivis : seules les tâches du pôle Booking de la structure apparaissent ; une tâche créée depuis un suivi est en Booking
- Projet JACO créé ; dossiers Drive des artistes rattachés (FAV = dossier « FAV »)


## 1.12.0 — 10/10/2026
- Nouvel onglet Salariés : fiche complète (état civil, coordonnées, paie, pièces d’identité, déplacements), pièces reçues, dossier Drive « NOM Prénom » ; les 16 dossiers existants sont déjà rattachés
- Questionnaire salarié en ligne (rh.html) : le salarié complète sa fiche et envoie RIB, carte vitale, pièce d’identité… depuis son téléphone ; les numéros sensibles déjà connus ne sont jamais réaffichés
- Pièces rangées dans le Drive par le script Google avec les bons noms : « RIB - NOM Prénom », « BDS-NOM Prénom AAAA-MM-JJ », « NDF-AAAA-MM NOM Prénom »
- Import de l’export Movinmotion depuis l’onglet Salariés (ou un projet) : crée ou met à jour les fiches salariés et les relie au projet
- Réglages › Google : vérification des noms des dossiers de dates et des contrats dans un Google Sheet (rien n’est renommé sans validation), puis renommage des lignes cochées


## 1.11.0 — 10/10/2026
- Fiche de renseignements alignée sur les formulaires Contrat de Cession / Contrat de Coréalisation (TVA oui/non, signataire, lieu, horaire, durée, billetterie…) avec la mention d’engagement et le % d’acompte
- Validation par l’équipe : les réponses de l’organisateur restent « à valider » ; écran de comparaison (réponse / valeur retenue), recopie sur la structure et « Pré-contrat complété » seulement après validation
- Contrat : génération du Google Doc depuis le modèle CC ou CR dans le dossier de la date (01_Legal), balises remplies, montants TTC et en lettres, acompte / solde, date de solde, invitations ; export PDF au nom « Artiste • AAAA-MM-JJ • Ville (CP) • Salle • CC/CR »
- Production : invitations producteur, % après break et break pour les co-réalisations


## 1.10.0 — 10/10/2026
- Modèles de mail par artiste (confirmations CC / CC Club / CC Festival / CCR Club, boucles accueil & technique et communication) avec balises remplies automatiquement : Réglages et onglet « Modèles de mail » du projet
- Production : « Préparer la confirmation » et les boucles — vérification du cachet, de la TVA, du contrat et des acomptes, choix du destinataire, aperçu modifiable, brouillon Gmail (ou copie du mail)
- Fiche de renseignements en ligne (fiche.html) propre à chaque date : conditions à jour et verrouillées, l’organisateur remplit ses coordonnées (enregistrées sur la structure) ; pré-contrat coché et notification à l’envoi ; réponses consultables et modifiables
- Script Google : brouillons Gmail, dossiers nommés « MM_DD • Ville • Salle (CP) », rattachement des dossiers existants, chemin Finder, brouillons automatiques des boucles et récap quotidien par mail


## 1.9.0 — 10/10/2026
- Notes d'échange gardées en brouillon (même en cliquant ailleurs ou en quittant la page) ; un nouveau suivi n'est plus supprimé tant qu'il contient quelque chose
- Échanges du journal modifiables (sans changer leur date)
- Choix de l'artiste : les projets inactifs se déplient dans la même liste
- Pièces jointes d'une nouvelle tâche : retirer un fichier avant d'enregistrer
- Photo de projet réellement recadrée en carré à l'enregistrement
- Booking : tracé du trajet A → B, fiche du point au survol, carte fixe pendant le défilement des enchaînements, point mis en avant au survol d'une date
- Statut d'une date modifiable d'un clic partout (Booking, Production, Suivi, Structures, Projets)
- Production : HT et TTC, TVA par date et par ligne (5,5 % cachet, 20 % commissions), date de relance, le solde suit l'acompte (50 / 50 par défaut), facturation en pleine largeur
- Suivi : cachet HT et période complète des dates, tâches liées au suivi (cocher, changer l'échéance), suivis clos repliés dans les structures
- Structures : tâches sur l'accueil
- Communication : dates passées repliées, artistes inactifs masqués
- To Do : onglet « Terminées » (30 derniers jours)


## 1.8.0 — 08/10/2026
- Police Geist et bleu L'ArtBo #283C63
- Réglages : pôles des tâches modifiables ; bouton pour appliquer le nouvel acompte / solde aux factures pas encore envoyées
- Listes d'artistes : seulement les actifs, avec « Projets inactifs… » pour ouvrir les autres
- Adresses avec suggestions partout (coordonnées administratives, membres, livraison des affiches, villes des événements)
- Recherche de date : toutes les années (tape le lieu, l'artiste, la ville ou la date)
- Pièces jointes des tâches : suppression réparée
- Booking : départ / arrivée du trajet depuis la carte, enchaînements repliables, panneau de droite qui défile
- Ticketing : les données de break de Notion sont revenues (elles étaient dans l'ancienne colonne « Invit. »)
- Projets : photo avec zoom et recadrage, aperçu par exercice (01/10 → 30/09), commissions nettes, export CSV des suivis du projet
- Suivi : nouveau suivi ouvert directement dans l'espace de prospection, résumé IA au-dessus du journal (partout), dates du suivi modifiables et rattachables, carte : rayon réglable jusqu'à un an après la date + dates du monde entier à ±5 jours, distance et temps de route au clic
- Export CSV des suivis : filtre sur la période du dernier échange
- Membres : import Movinmotion réglé sur le vrai export, fiche complète par membre, réimport = mise à jour


## 1.7.0 — 08/10/2026
- Nouveau nom et logo : L'ArtBoristerie Productions
- Nouvelle charte : boutons harmonisés, textes lisibles en entier, couleurs de statut (festival en bleus, salle en verts, artiste gris/noir, annulée rouge, sans suite marron)
- App beaucoup plus rapide (index en mémoire, plus de listes de 8 000 contacts dans les tableaux)
- Réglages : le solde suit l'acompte (acompte + solde = 100 %)
- Dates : saisie au clavier avec tout le texte sélectionné ou calendrier, partout
- Recherche avec suggestions et création (structure, contact, date) dans les tâches, les suivis, les dates, la communication
- Annulée / sans suite, tâche faite, suivi clos : 5 s avec « Annuler » avant de disparaître
- Booking : deux colonnes, carte carrée, plus aucun trait, enchaînements réels (au plus un jour off), filtres hors du bandeau
- Suivi : espace de prospection (planning de l'artiste, carte et distances autour de la date négociée, poser une date ou une tâche), export CSV, nouveau suivi avec création de structure et de contact
- Structures : titres avec « • », adresse auto-complétée, onglets Accueil / Suivi / Dates / Tâches / Festivals-événements / Coordonnées administratives, glisser-déposer des fichiers
- To Do : pôle visible et filtrable, « Pour » Anthony / Chloé, pièces jointes
- Projets : photo carrée recadrable, inactifs repliés, onglets Aperçu (commissions par année) / Dates / Suivis / Tâches / Échanges / Liens / Drive / Administratif / Membres (import CSV Movinmotion), mode Production ou Booking seul
- Ticketing et Communication : par artiste et par date, seulement les dates concernées, break et taux de remplissage
- Production : par artiste et par date, recherche, pré-contrat, relances en rouge, mode booking seul, créer ou lier le dossier Drive
- Notifications : cloche dans l'en-tête, rappels créés chaque matin


## 1.6.0 — 08/10/2026
- Code réorganisé en fichiers séparés (un fichier par onglet, réglages, calculs, carte…), comme la Matrice Production AccessFac
- Numéro de version affiché dans l'app (en-tête et onglet Réglages) et rechargement automatique des fichiers à chaque version
- Journal des versions (ce fichier)
- Sauvegarde quotidienne de la base et des pièces jointes dans un dépôt privé

## 1.5.1 — 08/10/2026
- Tâches terminées et suivis clos masqués par défaut, avec un bouton pour les afficher

## 1.5.0 — 08/10/2026
- Tâches : nom modifiable directement dans la liste, plusieurs projets par tâche
- Reprise des tâches multi-projets de Notion (185 tâches)

## 1.4.0 — 08/10/2026
- Structures : recherche par nom, ville, code postal, département, région, type ; recherche « autour de » une ville avec rayon
- Localisation automatique des structures (1 157 avec coordonnées, 1 003 avec département)
- Suivi : plusieurs artistes par suivi (127 suivis Notion restaurés), pièces jointes dès la création
- Envoi de pièces jointes depuis l'iPhone
- Plus de suggestion de mot de passe dans les champs de recherche

## 1.3.0 — 08/10/2026
- Version téléphone : tableaux en fiches, bascule Liste / Carte en Booking, formulaires plein écran
- Fiche structure : boutons Nouvelle date et Nouvelle tâche

## 1.2.1 — 07/10/2026
- Carte : fond OpenStreetMap (CARTO exige désormais une clé)

## 1.2.0 — 07/10/2026
- Suivi : filtres artiste + statut combinés
- Résumé par IA (Gemini ou Claude, clé à configurer) et bouton « Copier pour ChatGPT »

## 1.1.0 — 07/10/2026
- Suivi complet importé de Notion : résumés, journal des échanges, 199 PDF de mails
- Page structure : contacts, suivi, dates, tâches

## 1.0.0 — 07/10/2026
- Lancement : Booking (carte, trajets), Production (suivi admin, facturation, commissions L'ArtBo / Pyrprod), Ticketing, Communication, Projets, To Do, Contacts, Structures, Réglages
- Import de l'espace Notion (dates, structures, contacts, projets, suivis, tâches)
