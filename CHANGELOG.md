# Journal des versions — Matrice Booking L'ArtBoristerie

Numérotation : **majeur.mineur.correctif**. Un correctif répare quelque chose, une version mineure ajoute une fonctionnalité, une version majeure change profondément l'outil.
Pour publier une nouvelle version : `python3 tools/bump_version.py minor "Ce qui change"` (voir README).

<!-- nouvelles versions ci-dessous -->

## 1.34.2 — 20/10/2026
- Relecture : tags et budget type fiables


## 1.34.1 — 20/10/2026
- Relecture : tags gardés au brouillon et à l'enregistrement, budget type sans écrasement, migration budget_template


## 1.34.0 — 20/10/2026
- Budget type prérempli, tags des structures, nouvelle structure ouverte, acompte 50 % par défaut, budget et To Do allégés, mobile sans débordement


## 1.33.6 — 20/10/2026
- Rappel « commission à te verser » dès le premier encaissement, même sans acompte


## 1.33.5 — 19/10/2026
- Production : pas de TVA sur la commission L'ArtBo (elle n'est pas facturée)


## 1.33.4 — 19/10/2026
- Corrections relecture (rappel de commission, affichage mobile)


## 1.33.3 — 19/10/2026
- Production : plus de « facture de commission » — la commission L'ArtBo est « à te verser » (date de versement seulement), rappels et notifications compris
- Commission : les commissions déjà versées ou facturées ne changent pas quand on change le % de l'artiste


## 1.33.2 — 19/10/2026
- Commission : le % se modifie aussi depuis le budget de la date ; quand on change la commission d'un artiste, ses dates suivent (après confirmation)


## 1.33.1 — 19/10/2026
- Budget : un montant sans date de versement compte comme « encore à verser » ; facture de l'artiste visible sur le versement


## 1.33.0 — 19/10/2026
- Budget d'une date : le solde artiste sort du tableau des dépenses ; un bloc « Reste pour l'artiste » (calculé) + versements + écart pour toi (négatif = tu perds, positif = tu gagnes)
- Export du budget d'une date pour l'artiste (page à imprimer / PDF)
- Compte dédié : détail de tous les mouvements comptés, avec le solde après chacun, pour pointer avec la banque


## 1.32.1 — 19/10/2026
- Corrections relecture : fiche salarié (dates des questions masquées), Brevo (liste des mails créés jamais écrasée)


## 1.32.0 — 19/10/2026
- Dates début / fin cohérentes partout (calendrier de fin ouvert sur le début, fin avant début refusée, la fin suit le début)
- Production : plus d'alerte « conditions pas encore validées » sur une date passée ou déjà confirmée par mail
- Contacts : 2 mails et 2 téléphones partout (création rapide comprise), les 2 mails partent dans Brevo et dans les mails


## 1.31.8 — 19/10/2026
- IA (résumé de suivi, lecture des pièces) : si les modèles Gemini les plus récents sont saturés, on passe automatiquement aux suivants


## 1.31.7 — 19/10/2026
- Fiches organisateur, salarié et artiste : les grandes cases de texte s'adaptent à la longueur du texte


## 1.31.6 — 19/10/2026
- Fiche artiste : cases de fichier plus petites ; la présentation et la stratégie s'agrandissent avec le texte


## 1.31.5 — 19/10/2026
- Fiche artiste : une case = un fichier, bouton court dans les petites cases ; l'onglet Fiche artiste n'écrase plus une correction faite dans Administratif ou Membres


## 1.31.4 — 19/10/2026
- Pages publiques : choix de fichier en français, bouton et nom du fichier bien alignés


## 1.31.3 — 19/10/2026
- Onglet « Fiche artiste » : une correction met aussi à jour la structure administrative et l'onglet Membres ; une modification non enregistrée reste affichée avec « Réessayer » ; anciennes réponses reprises ; commission par défaut aussi appliquée par la base aux dates confirmées


## 1.31.2 — 19/10/2026
- Fiche artiste : « + Ajouter un logo » et « + Ajouter une photo » pour en déposer autant que nécessaire


## 1.31.1 — 19/10/2026
- Projet : bloc « Accueil » (personnes, montage, chambres, commission) modifiable directement dans l'Aperçu


## 1.31.0 — 19/10/2026
- Onglet « Fiche artiste » : toutes les réponses modifiables (enregistrées toutes seules), « Copier » sur chaque champ et « Copier toute la fiche » ; équipe pro : structure + prénom et nom + mail + téléphone ; téléphone des membres ; une case par titre audio ; commission par défaut selon le type de suivi (booking 15 %, production 20 %), réglable dans Réglages


## 1.30.3 — 19/10/2026
- Fiche artiste : équipe professionnelle avec structure + prénom et nom + mail + téléphone ; téléphone des membres ; une case par titre audio


## 1.30.2 — 19/10/2026
- Fiche artiste : titres audio en MP3 ou WAV (3 minimum)


## 1.30.1 — 19/10/2026
- Fiche artiste : une structure déjà en base (même SIRET) n'est jamais modifiée par l'artiste, elle est signalée « à relier » ; l'artiste complète seulement ce qui manque sur sa structure ; noms des membres corrigés ; seuls les MP3 comptent ; reprise des anciennes réponses « structure administrative »


## 1.30.0 — 19/10/2026
- Fiche artiste : jusqu'à 3 formules, membres de l'équipe (poste, nom, prénom, naissance, mail, ville et pays de résidence) ajoutés dans l'onglet Membres, structure administrative créée / complétée dans la base et reliée au projet, 3 MP3 minimum, plan de scène avec la fiche technique ; nouveau projet : case « Créer son dossier Drive à son nom » et bouton « Créer son dossier Drive » en haut de la fiche projet


## 1.29.0 — 19/10/2026
- Fiche artiste : département, dernières sorties (EP / album / single), répétitions et accompagnement (lieu, accompagnement en cours, dispositifs déjà suivis), personnes non-genrées dans l'équipe, équipe professionnelle (manager, booker, label, RP, éditeur, CM, structure administrative), photos récentes en carré / 300×400 / 400×300 ; vérification des mails et liens ; sauvegarde des fichiers en attente ; rangement Drive fichier par fichier


## 1.28.1 — 19/10/2026
- Fiche artiste : mise en page des choix (boutons ronds) corrigée, équipe sur 3 colonnes


## 1.28.0 — 19/10/2026
- Fiche artiste : un lien propre à chaque artiste (fiche projet › « Copier le lien de la fiche artiste ») ; l'artiste remplit infos, présentation, actualités, dates, équipe, référent, liens, prestation live et dépose ses fichiers, rangés automatiquement dans son dossier Drive ; ses réponses s'affichent dans l'onglet « Fiche artiste »


## 1.27.4 — 19/10/2026
- Diagnostic : une erreur du site est affichée et notée pour correction (table client_errors)


## 1.27.3 — 19/10/2026
- Suivis « Confirmed » rangés avec les suivis clos partout (Suivi, fiche structure, fiche artiste, To Do, relances)


## 1.27.2 — 19/10/2026
- Correctif : pages longues (To Do, tâches terminées…) 8 fois plus rapides, plus de blocage de Safari ; échéance d'un acompte déjà facturé enregistrée ; la fiche de renseignements affiche les acomptes avec leurs échéances


## 1.27.1 — 19/10/2026
- To Do : filtres en cours rappelés au-dessus de la liste avec « Tout afficher » ; bandeau « Nouvelle version — Recharger » quand le site est mis à jour


## 1.27.0 — 19/10/2026
- Plusieurs acomptes : chaque acompte a son échéance (le 1er : à la signature du contrat) et sa ligne dans le mail de confirmation.
- Réglages › Google : « Copier le code à jour » (Code.gs) et « Tester le script » ; message clair quand le script de production@ n'est pas à jour.


## 1.26.2 — 19/10/2026
- Mise à jour automatique : rien n'est perdu pendant un rechargement après une coupure


## 1.26.1 — 19/10/2026
- Corrections de la relecture Greptile : limite des acomptes avec les factures déjà envoyées, « 0 acompte » respecté dans le mail et la fiche, pop-up de confirmation depuis la fiche de la date, mise à jour automatique plus fiable (réglages, liens contacts, reconnexion, sans doublon), contrat regénérable, envoi bloqué s'il manque une pièce jointe, solde artiste prévu / réel, Communication suit le filtre des inactifs, double envoi impossible


## 1.26.0 — 19/10/2026
- Mise à jour automatique : ce que fait un collègue (date validée, échange, tâche…) apparaît tout seul, sans recharger.
- Artistes inactifs masqués partout (Booking, Production, carte, Ticketing, Communication, To Do, Suivi), bouton « Afficher les inactifs ».
- Filtre artistes en haut des pages : un ou plusieurs artistes, la liste reste ouverte entre deux choix.
- Date passée en « Confirmée » : proposition d'envoyer la confirmation tout de suite → conditions à valider (contrat, cachet, TVA, nombre et % des acomptes…) → mail.
- Mails des dates (confirmation, boucles) : « Envoyer maintenant » depuis production@ (date d'envoi notée dans le suivi), signature de Chloé, destinataire / copie / objet sur toute la largeur, pièces jointes par glisser-déposer ; boutons Gmail retirés.
- Date en production : actions (confirmation, boucles, fiche, contrat, Drive) en haut, puis onglets Conditions / Factures / Budget / Suivi admin ; budget en prévu / réel / écart.
- Correctif : la position de défilement est de nouveau gardée après un enregistrement.


## 1.25.2 — 18/10/2026
- Brouillons de mail rouverts : l'adresse, l'objet et le texte écrits restent ; déplier une section garde la position des tableaux ; invitation : le concert ne compte que pour un modèle d'invitation


## 1.25.1 — 18/10/2026
- Corrections de la 3e relecture Greptile : limite des acomptes avec solde envoyé, montant saisi prioritaire, taxe CNM selon le département du concert, défilement, suivi de la To do, artiste de l'invitation, brouillons, modèles partagés gardés à la suppression d'un artiste, script Drive plus sûr


## 1.25.0 — 18/10/2026
- Mise en forme des mails (police, taille, couleur, lien), Helvetica Neue 14 par défaut ; modèles pour plusieurs artistes, artistes cochés selon le modèle ; émojis gardés dans Gmail ; brouillons jamais perdus et échanges modifiables partout ; mail mis en forme dans le journal, « Marquer envoyé » ; résumé IA à chaque échange ou pièce ; dossier Drive d'un nouvel artiste ; booking : pas de fiche de renseignements ; fenêtre de prospection, To do et choix des artistes plus clairs ; budget de production (Production / Co-Production)


## 1.24.1 — 18/10/2026
- Relecture Greptile : relances en brouillon revérifiées, prochaine relance à J+10 de l'envoi réel, factures Pennylane reconnues par leur identifiant, remplacement d'une pièce sans risque, migrations sûres


## 1.24.0 — 18/10/2026
- Facturation : % ↔ HT ↔ TTC liés, solde automatique, 100 % max, total des factures face au cachet, montants au centime ; taxe CNM seulement si la date est concernée ; défilement gardé dans les tableaux ; To do : accès direct structure et suivi ; {{contact}} = prénom seul ; prospection depuis production@ avec la signature de Chloé ; invitation remplie depuis une date confirmée


## 1.23.0 — 18/10/2026
- Modèles de prospection (Nova Noir, Rosters 2027, Invitation, MaMA, Réponse Tryo) ; modèles de mail rangés par type dans des groupes dépliables


## 1.22.0 — 18/10/2026
- Relecture Greptile corrigée (formulaire salariés, réglages, sauvegarde complète, budget, relances, adresses tapées) ; pièces rangées dans le Drive de la date avec détection des doublons


## 1.21.1 — 18/10/2026
- Synchroniser Pennylane (factures payées → « Payée »), dépenses déduites du compte The Locos, solde Martigny reçu


## 1.21.0 — 18/10/2026
- Pennylane au format de tes factures (artiste, description date • ville • lieu, Projet et Date de réalisation, produits Cession / Coréalisation / Commission, acompte en quantité) ; avances de L'ArtBo remboursées par le compte dédié ; cachet Carcassonne corrigé


## 1.20.0 — 17/10/2026
- Tâches rattachées à un suivi (lien depuis To Do), relances : après 3 relances par mail la tâche devient une relance téléphone ; pas de réponse = suivi clos ; dates des relances notées dans le journal


## 1.19.0 — 17/10/2026
- Budget par date (prévu / réel, pièces lues par l'IA, qui paie), compte dédié de l'artiste en temps réel, case « booking uniquement » par date, devis et factures en brouillon dans Pennylane, import du budget Excel The Locos


## 1.18.1 — 17/10/2026
- Espace de test (?test) : copie séparée de la Matrice pour faire tester le site


## 1.18.0 — 17/10/2026
- Prospection depuis une structure (modèles, brouillon ou envoi depuis anthony@, suivi + journal + date en Intérêt + tâche de relance) et relance en réponse dans le même fil Gmail


## 1.17.2 — 13/10/2026
- Glisser une pièce jointe depuis Mail dans la fenêtre du mail ; retour arrière au glissement du doigt


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
