# Essai Brevo réel — anthony@lartboristerie.com, et aucune autre adresse

Lot `dev/brevo-rattachements` : rattachements, champ FONCTIONS, exclusions de la prospection, mode essai.
Décision définitive d'Anthony (09/11/2026) : l'essai se fait avec **anthony@lartboristerie.com**, sa vraie adresse de production, et **aucune autre adresse**.
- Aucun contact neuf, aucune adresse fictive.
- Sa fiche Brevo éventuelle, ses préférences et son désabonnement sont préservés.
- **Aucun envoi de campagne.**

Les étapes d'Anthony se font sur le **web**, une à la fois, avec confirmation avant la suivante. Claude ne fait que des lectures, sauf la liste blanche et la migration sur le **projet de test**.
L'essai a lieu dans l'**espace de test** de la Matrice. Le compte Brevo est le vrai, sans liste : « Liste Brevo » reste vide dans l'espace de test.

## Mode essai
Le réglage `brevo_essai_emails` (liste blanche) contient **seulement** anthony@lartboristerie.com. Le bloc SQL refuse toute autre valeur.
- `brevo-sync` ignore tous les autres contacts du projet de test (24 avec adresse au 09/11) **avant le moindre appel à Brevo**.
- « Envoyer tous les contacts existants à Brevo » est refusé.
- Rempli sans adresse valide, il **bloque tout**. Une lecture des réglages en échec arrête l'appel.
- Tant qu'une clé est enregistrée, l'équipe ne peut ni le modifier ni l'effacer : la base refuse.
- Réglages › Brevo affiche « Mode essai Brevo actif » et l'adresse réellement retenue.

## Deux cas, selon l'étape 0
- **Fiche Brevo existante.** La règle en place la protège : la Matrice n'écrit que sur les fiches qu'elle a créées. **Rien n'est écrit sur elle.**
  - L'essai vérifie : fiche non modifiée, désabonnement et préférences intacts, blocage complet en cas de mauvaise configuration, aucun autre contact envoyé, retrait de la clé.
  - STRUCTURE et FONCTIONS sont **« non vérifiables en réel sur cette fiche protégée »**. Ils restent couverts par les tests automatiques (faux Brevo, 25 cas).
- **Pas de fiche Brevo.** La Matrice la **crée**, sans liste, avec prénom, nom, STRUCTURE et FONCTIONS.
  - STRUCTURE et FONCTIONS sont vérifiés sur elle.
  - À la fin, Anthony décide s'il la garde ou la supprime à la main. La Matrice ne supprime jamais rien.

L'essai ne met **jamais** cette adresse en liste de blocage et ne l'en retire jamais.

## Avant l'essai (Claude)
Requêtes : `supabase/operations/2026-11-09_essai_brevo_liste_blanche.sql`.
1. Contrôles en lecture seule sur le projet de test :
   - clé Brevo absente ;
   - adresses par domaine (nombres seulement) ;
   - contacts marqués « créés par la Matrice ».
   - Arrêt s'il y a une clé.
2. Migration `2026-11-08_brevo_rattachements.sql` appliquée sur le **projet de test** seulement.
3. `brevo-sync` déployée sur le **projet de test**, puis comparée au dépôt. Elle doit contenir `brevo_essai_emails` et `lireReglages`, sinon arrêt.
4. Liste blanche posée : anthony@lartboristerie.com, seule. Vérification qu'elle est la seule.
5. Espace de test, Réglages › Brevo : « Liste Brevo » vide.
6. Aucun autre essai sur le projet de test pendant la séance.

Aucune requête à l'API Brevo n'a lieu avant l'étape 4.

## Étapes pour Anthony

0. **Constat de départ, dans Brevo, en lecture seulement** (avant toute clé dans l'espace de test)
   - Brevo › Contacts › recherche : anthony@lartboristerie.com. La fiche existe-t-elle ?
   - Si oui, fais une capture de : ses champs, ses listes, son statut e-mail (abonné ou en liste de blocage), sa date de dernière modification.
   - Brevo › Automatisations : y en a-t-il une **active** qui démarre quand un contact est ajouté ou un champ modifié ? Si oui, on s'arrête et on en parle.
   - Dis à Claude : « fiche existante » ou « pas de fiche ».

1. **Créer le champ FONCTIONS dans Brevo**
   - Ton nom en haut à droite › Paramètres › Contacts › Attributs de contact.
   - Onglet « Attributs normaux » › « Ajouter un nouvel attribut ». Nom `FONCTIONS`, type Texte, « Créer l'attribut ».
   - Le nom et le type ne pourront plus être changés. Libellés traduits de l'aide Brevo en anglais : ils peuvent différer légèrement.

2. **Clé Brevo de l'espace de test**, seulement quand Claude confirme que la liste blanche est en place
   - Espace de test › Réglages › Brevo : la mention « Mode essai Brevo actif » doit indiquer **anthony@lartboristerie.com** et rien d'autre. Sinon, arrête-toi.
   - Colle la clé. Laisse « Liste Brevo » vide.

3. **Deux structures d'essai** (espace de test › Structures) : « ESSAI Structure A » et « ESSAI Structure B », actives.

4. **Le contact d'essai** (espace de test › Contacts › Nouveau contact)
   - Prénom et nom : les tiens, **tels qu'ils sont sur ta fiche Brevo** si elle existe.
   - Mail : anthony@lartboristerie.com. Structures : A et B.
   - Sur chaque fiche structure, « Fonction ici » : « Programmatrice » pour A, « Directrice » pour B.

5. **Vérifier dans Brevo** (environ 1 minute plus tard)
   - Fiche existante : **identique** à la capture de l'étape 0. STRUCTURE et FONCTIONS : non vérifiables en réel sur cette fiche protégée.
   - Pas de fiche : fiche créée, dans **aucune liste**. STRUCTURE = « ESSAI Structure A, ESSAI Structure B ». FONCTIONS = « ESSAI Structure A : Programmatrice ; ESSAI Structure B : Directrice ».
   - Dans les deux cas : aucun autre contact ajouté à Brevo (Contacts, tri par date d'ajout).

6. **Changer une fonction** (fonction de B → « Régisseuse »), puis **retirer les deux structures** du contact.
   - Fiche existante : toujours identique.
   - Pas de fiche : FONCTIONS suit le changement ; puis STRUCTURE et FONCTIONS sont **vides**. La documentation Brevo ne dit pas si une valeur vide efface un champ : note ce que tu vois.

7. **Désabonnement et préférences** : statut e-mail et listes **identiques** à l'étape 0, ou aucune liste si la fiche a été créée.

8. **Exclusions** (fiche du contact d'essai dans la Matrice)
   1. « Exclure de la prospection », motif « Essai ». La fiche affiche l'auteur, la date et le motif. Brevo : rien ne change.
   2. Supprime ce contact dans l'espace de test, puis recrée-le avec la **même adresse** écrite autrement : ANTHONY@LartBoristerie.com.
      - Il revient **exclu**, avec « Exclusion reprise d'un contact supprimé le … : « Essai » ». Brevo : rien ne change.
   3. « Remettre en prospection », motif « Fin de l'essai ». Brevo : désabonnement inchangé.

9. **Mode essai mal configuré** : Claude remplace la liste blanche par une valeur invalide.
   - Réglages affiche « aucune adresse valide : tout est bloqué ».
   - Change le nom du contact d'essai : **aucun** appel à Brevo (Claude le vérifie dans le journal de la fonction ; ta fiche Brevo est identique).
   - Claude remet ensuite l'adresse.

10. **Aucun autre contact envoyé** : Claude relit le journal de `brevo-sync` sur la séance. Chaque appel concerne anthony@lartboristerie.com, ou se termine par « mode essai » sans appel à Brevo.

11. **Vider la clé**
    - Espace de test › Réglages › Brevo › « Clé API Brevo » : efface le champ et valide.
    - « Clé Brevo retirée », puis l'état affiche « pas encore de clé ».
    - Claude vérifie en lecture que la clé est vide, puis retire la liste blanche. Jamais dans l'autre ordre : la base et le bloc SQL le refusent.

12. **Rangement**
    - Espace de test : supprime le contact et les deux structures d'essai.
    - Fiche créée par l'essai : tu décides de la garder ou de la supprimer à la main dans Brevo.
    - Garde l'attribut FONCTIONS : il sert ensuite en production.

## Résultat attendu à rapporter
Pour les étapes 5 à 11 : « conforme », « non vérifiable (fiche protégée) » ou ce que tu as vu, avec une capture si possible.
La demande de publication n'est ouverte qu'après cet essai conforme.
