# Essai Brevo réel — contact d'essai anthony@lartboristerie.com

Lot `dev/brevo-rattachements` : rattachements, champ FONCTIONS, exclusions de la prospection, mode essai.
Contact d'essai désigné par Anthony le 09/11/2026 : **anthony@lartboristerie.com**. C'est sa **vraie adresse de production**.
- Sa fiche Brevo éventuelle, ses préférences et son désabonnement sont préservés.
- **Aucun envoi de campagne.**
- Toute modification durable de sa fiche est présentée avant d'être faite.

Toutes les étapes d'Anthony se font sur le **web**, une à la fois, avec confirmation avant la suivante.
L'essai a lieu dans l'**espace de test** de la Matrice. Le compte Brevo est le vrai, mais **sans liste** : « Liste Brevo » reste vide dans l'espace de test.

## Pourquoi un « mode essai »
Le projet de test contient 24 autres contacts avec une adresse (au 09/11). On ne sait pas lesquels sont fictifs.
Avec la vraie clé Brevo dans l'espace de test, toute modification de l'un d'eux appellerait le vrai compte.

Le réglage `brevo_essai_emails` (liste blanche) contient **seulement** anthony@lartboristerie.com :
- `brevo-sync` ignore tous les autres contacts **avant le moindre appel à Brevo** ;
- « Envoyer tous les contacts existants à Brevo » est refusé ;
- rempli sans adresse valide, il **bloque tout** ; une lecture des réglages en échec arrête l'appel ;
- tant qu'une clé est enregistrée, l'équipe ne peut ni le modifier ni l'effacer (la base refuse) ;
- Réglages › Brevo affiche « Mode essai Brevo actif » et l'adresse réellement retenue.

## Ce que l'essai ferait à la fiche Brevo d'Anthony (à lire avant de choisir)
La Matrice ne met à jour une fiche Brevo **que si c'est elle qui l'a créée** (règle en place depuis la v1.16).
Dans l'espace de test, le contact d'essai n'est marqué « créé par la Matrice » que si la Matrice crée la fiche pendant l'essai.

- **Cas 1 — aucune fiche Brevo pour cette adresse.** L'essai la **crée** :
  - prénom, nom, STRUCTURE, FONCTIONS remplis ;
  - **aucune liste**, aucun envoi.

  Toutes les vérifications sont alors possibles. À la fin, la fiche reste : Anthony peut la supprimer à la main dans Brevo. La Matrice ne supprime jamais rien.
- **Cas 2 — une fiche existe déjà** (contact, client…). Sans action particulière, l'essai **ne la modifie pas**. On ne peut donc pas vérifier STRUCTURE et FONCTIONS sur elle. Deux variantes :
  - **Variante A (recommandée, aucune modification)**
    - On vérifie le mode essai, le blocage des autres contacts, les rattachements et toutes les exclusions dans la Matrice.
    - On vérifie aussi que **rien** ne change sur sa fiche : champs, listes, désabonnement, date de dernière modification.
    - STRUCTURE et FONCTIONS restent vérifiés seulement par les tests automatiques (faux Brevo).
  - **Variante B (écriture temporaire, accord explicite d'Anthony nécessaire)**
    - Claude marque le contact d'essai comme « créé par la Matrice » dans le **projet de test seulement**. Les mises à jour suivantes écrivent alors PRÉNOM, NOM, STRUCTURE et FONCTIONS sur sa vraie fiche.
    - Avant l'essai, Anthony note (capture) les valeurs de ces quatre champs. Le contact d'essai porte **exactement** ses prénom et nom Brevo, pour qu'ils ne changent pas.
    - Restauration à la fin, par Anthony dans Brevo : STRUCTURE remise à sa valeur d'avant, FONCTIONS vidé (le champ n'existait pas avant).
    - **Ne peut pas être restauré :** la date de dernière modification de la fiche et les lignes ajoutées à son historique d'activité dans Brevo.
    - Une **automatisation** Brevo déclenchée par la modification d'un champ pourrait partir. À vérifier avant (étape 0).
    - Les listes et le désabonnement ne sont jamais touchés.
- **Désabonnement** : l'essai ne met **jamais** sa vraie adresse en liste de blocage, ni ne l'en retire. On vérifie seulement que son statut d'avant est inchangé.

## Avant l'essai (Claude, pas Anthony)
Requêtes : `supabase/operations/2026-11-09_essai_brevo_liste_blanche.sql`.
1. Contrôles en lecture seule sur le projet de test :
   - clé Brevo absente ;
   - adresses par domaine (nombres seulement) ;
   - contacts marqués « créés par la Matrice ».
   - S'il y a une clé, ou si anthony@lartboristerie.com est déjà un contact du projet de test marqué « créé par la Matrice », Claude s'arrête et prévient Anthony.
2. Migration `2026-11-08_brevo_rattachements.sql` appliquée sur le **projet de test** seulement.
3. Fonction `brevo-sync` (index.ts et regles.ts) déployée sur le **projet de test**, puis comparée au dépôt. Elle doit contenir `brevo_essai_emails` et `lireReglages`, sinon on arrête.
4. Liste blanche : anthony@lartboristerie.com, seule. Le bloc SQL refuse toute autre adresse sans « +essai ». Claude vérifie qu'elle est la seule.
5. Espace de test, Réglages › Brevo : « Liste Brevo » **vide**.
6. **Aucun autre essai** (autre agent, autre session) sur le projet de test pendant la séance.

## Étapes pour Anthony

0. **État de départ, en lecture seulement**
   - Dans Brevo › Contacts, cherche anthony@lartboristerie.com. Note si la fiche existe.
   - Si elle existe, fais une capture de :
     - ses champs (PRENOM, NOM, STRUCTURE…) ;
     - ses listes ;
     - son statut e-mail (abonné ou en liste de blocage) ;
     - sa date de dernière modification.
   - Dans Brevo › Automatisations : note s'il en existe une **active** qui démarre quand un contact est ajouté ou quand un champ est modifié. Si oui, on s'arrête et on en parle avant de continuer.
   - Dis à Claude : cas 1 ou cas 2, et variante A ou B si cas 2.

1. **Créer le champ FONCTIONS dans Brevo**
   - Ton nom en haut à droite › Paramètres › Contacts › Attributs de contact.
   - Onglet « Attributs normaux » › « Ajouter un nouvel attribut ». Nom `FONCTIONS`, type Texte, « Créer l'attribut ».
   - Le nom et le type ne pourront plus être changés. Les libellés sont traduits de l'aide Brevo en anglais : ils peuvent différer légèrement.

2. **Clé Brevo de l'espace de test**, seulement quand Claude confirme que la liste blanche est en place
   - Espace de test › Réglages › Brevo : la mention « Mode essai Brevo actif » doit indiquer **anthony@lartboristerie.com** et rien d'autre.
   - Sinon, ou si elle indique « aucune adresse valide : tout est bloqué », arrête-toi.
   - Colle la clé. Laisse « Liste Brevo » vide.

3. **Deux structures d'essai** (espace de test › Structures) : « ESSAI Structure A » et « ESSAI Structure B », actives.

4. **Le contact d'essai** (espace de test › Contacts › Nouveau contact)
   - Prénom et nom : **les mêmes que sur ta fiche Brevo** (cas 2), sinon les tiens.
   - Mail : anthony@lartboristerie.com.
   - Structures : A et B. Sur chaque fiche structure, « Fonction ici » : « Programmatrice » pour A, « Directrice » pour B.
   - Variante B seulement : prévenir Claude ici, qui marque le contact « créé par la Matrice » dans le projet de test.

5. **Un autre contact, pour le blocage** (espace de test › Contacts › Nouveau contact)
   - Prénom « ESSAI », nom « Bloqué », mail `bloque@exemple.invalid` (adresse fictive). Rattache-le à ESSAI Structure A.
   - Dans Brevo : cette adresse n'apparaît pas. Claude vérifie aussi le journal de la fonction : « mode essai », aucun appel à Brevo.
   - Les 24 autres contacts du projet de test ne sont pas touchés.

6. **Vérifier dans Brevo** (environ 1 minute plus tard)
   - Cas 1 ou variante B : STRUCTURE = « ESSAI Structure A, ESSAI Structure B » ; FONCTIONS = « ESSAI Structure A : Programmatrice ; ESSAI Structure B : Directrice » ; aucune liste.
   - Variante A : fiche **identique** à la capture de l'étape 0.

7. **Changer une fonction** (fonction de B → « Régisseuse »), puis **retirer les deux structures** du contact.
   - Cas 1 ou variante B : FONCTIONS suit, puis STRUCTURE et FONCTIONS sont **vides**. Point jamais vérifié : la documentation Brevo ne dit pas si une valeur vide efface un champ. Note ce que tu vois.
   - Variante A : fiche toujours identique.

8. **Désabonnement préservé** : statut e-mail **identique** à l'étape 0. Aucune liste ajoutée.

9. **Exclusions** (fiche du contact d'essai dans la Matrice)
   1. « Exclure de la prospection », motif « Essai ». La fiche affiche l'auteur, la date et le motif. Dans Brevo, rien ne change.
   2. Supprime ce contact dans l'espace de test, puis recrée-le avec **ANTHONY@LartBoristerie.com**. Il revient **exclu**, avec « Exclusion reprise d'un contact supprimé le … : « Essai » ».
   3. « Remettre en prospection », motif « Fin de l'essai ». Dans Brevo, toujours rien de changé sur le désabonnement.

10. **Mode essai mal configuré** : Claude remplace la liste blanche par une valeur invalide.
    - Réglages affiche « aucune adresse valide : tout est bloqué ».
    - Une modification du contact d'essai ne produit **aucun** appel à Brevo.
    - Claude remet ensuite l'adresse.

11. **Vider la clé**
    - Espace de test › Réglages › Brevo › « Clé API Brevo » : efface le champ et valide.
    - « Clé Brevo retirée », puis l'état affiche « pas encore de clé ».
    - Claude vérifie en lecture que la clé est vide, puis retire la liste blanche. Jamais dans l'autre ordre : la base et le bloc SQL le refusent.

12. **Rangement**
    - Espace de test : supprime les deux contacts et les deux structures d'essai.
    - Variante B : remets STRUCTURE à sa valeur d'avant et vide FONCTIONS sur ta fiche Brevo (capture de l'étape 0).
    - Cas 1 : la fiche créée reste ; tu peux la supprimer à la main dans Brevo.
    - Garde l'attribut FONCTIONS : il sert ensuite en production.

## Résultat attendu à rapporter
Pour les étapes 5 à 11 : « conforme » ou ce que tu as vu, avec une capture si possible.
La demande de publication n'est ouverte qu'après cet essai conforme.
