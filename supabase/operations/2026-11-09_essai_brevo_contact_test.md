# Essai Brevo réel sur un contact de test — avant la demande de publication

Lot `dev/brevo-rattachements` : rattachements, champ FONCTIONS, exclusion de la prospection.
Toutes les étapes se font sur le **web**. Une étape à la fois, avec confirmation avant la suivante.
L'essai a lieu dans l'**espace de test** de la Matrice. Le compte Brevo est le vrai compte, mais **sans liste** : aucun contact de campagne n'est touché.

## Pourquoi un « mode essai »
Le projet de test contient d'autres contacts avec une adresse mail (25 contacts, dont 24 avec adresse au 09/11). On ne sait pas lesquels sont fictifs.
Dès que la vraie clé Brevo est dans l'espace de test, **toute** modification de l'un d'eux appellerait le vrai compte Brevo.

Solution retenue, la plus simple et la plus sûre : une **liste blanche**, le réglage `brevo_essai_emails`.
- Tant qu'il contient l'adresse du contact d'essai, `brevo-sync` ignore tous les autres contacts **avant le moindre appel à Brevo**.
- « Envoyer tous les contacts existants à Brevo » est refusé.
- Le réglage est posé **avant** que la clé soit collée et retiré **après** que la clé est vidée.
- S'il était oublié, il ne pourrait que bloquer la synchronisation, jamais l'étendre.
- Réglages › Brevo affiche « Mode essai Brevo actif » avec l'adresse, tant qu'il est posé.

Le seul contrôle en lecture des adresses ne suffirait pas : il dépendrait d'une vérification à la main de 24 adresses.

## Avant l'essai (Claude, pas Anthony)
Requêtes : `supabase/operations/2026-11-09_essai_brevo_liste_blanche.sql`.
1. Contrôles en lecture seule sur le projet de test :
   - clé Brevo absente ;
   - adresses par domaine (nombres seulement) ;
   - nombre de contacts marqués « créés par la Matrice » (`brevo_created`, `brevo_emails`).
   - S'il y a une clé, Claude s'arrête et prévient Anthony.
2. Migration `2026-11-08_brevo_rattachements.sql` appliquée sur le **projet de test** seulement.
3. Fonction `brevo-sync` (index.ts et regles.ts) déployée sur le **projet de test**, puis comparée au dépôt. Elle doit contenir `brevo_essai_emails`, sinon on arrête.
4. Anthony donne l'adresse du contact d'essai (avec `+essai`). Claude pose la liste blanche avec cette seule adresse et vérifie qu'elle est la seule.
5. Dans l'espace de test, Réglages › Brevo : « Liste Brevo » **vide**, pour que le contact d'essai n'entre dans aucune liste.
6. **Aucun autre essai** (autre agent, autre session) ne tourne sur le projet de test pendant la séance.

## Étapes pour Anthony

1. **Créer le champ FONCTIONS dans Brevo**
   - Ouvre app.brevo.com, puis ton nom en haut à droite › Paramètres › Contacts › Attributs de contact.
   - Onglet « Attributs normaux » › « Ajouter un nouvel attribut ».
   - Nom : `FONCTIONS`. Type : Texte. Puis « Créer l'attribut ».
   - Le nom et le type ne pourront plus être changés ensuite.
   - Les libellés sont traduits de l'aide Brevo en anglais : ils peuvent différer légèrement.

2. **Clé Brevo de l'espace de test**, seulement quand Claude confirme que la liste blanche est en place
   - Espace de test de la Matrice › Réglages › Brevo.
   - Vérifie la mention « Mode essai Brevo actif » avec ton adresse `+essai`. Sinon, arrête-toi.
   - « Clé API Brevo » : colle la clé. Laisse « Liste Brevo » vide.

3. **Deux structures d'essai** (espace de test › Structures › Nouvelle structure)
   - « ESSAI Structure A » et « ESSAI Structure B », toutes les deux actives.

4. **Le contact d'essai** (espace de test › Contacts › Nouveau contact)
   - Prénom « Essai », nom « Matrice ».
   - Mail : une adresse à toi, avec `+essai` avant le @ (exemple : `prenom+essai-matrice@tondomaine`).
   - Structures : ESSAI Structure A et ESSAI Structure B. Enregistre.
   - Sur chaque fiche structure, « Fonction ici » : « Programmatrice » pour A, « Directrice » pour B.

5. **Vérifier dans Brevo**, environ 1 minute plus tard (Contacts, chercher l'adresse)
   - Le contact existe, dans **aucune liste**.
   - STRUCTURE = « ESSAI Structure A, ESSAI Structure B ».
   - FONCTIONS = « ESSAI Structure A : Programmatrice ; ESSAI Structure B : Directrice ».

6. **Changer une fonction** : dans la Matrice, fonction de B → « Régisseuse ».
   - Dans Brevo : FONCTIONS = « ESSAI Structure A : Programmatrice ; ESSAI Structure B : Régisseuse ».

7. **Champ vidé** : dans la Matrice, retire les deux structures du contact. Le contact reste.
   - Dans Brevo : le contact existe toujours.
   - STRUCTURE et FONCTIONS sont **vides**.
   - Point jamais vérifié jusqu'ici : la documentation Brevo ne dit pas si une valeur vide efface un champ. Note ce que tu vois. Si les champs ne sont pas vidés, la fiche du contact dans la Matrice peut aussi afficher une erreur Brevo.

8. **Désabonné intact**
   - Dans Brevo : sur la fiche du contact d'essai, mets-le en **liste de blocage** (désinscription des e-mails).
   - Dans la Matrice : rattache-le de nouveau à ESSAI Structure A.
   - Dans Brevo : il est **toujours bloqué / désinscrit**, et STRUCTURE = « ESSAI Structure A ».

9. **Exclusion de la prospection** (fiche du contact dans la Matrice)
   - « Exclure de la prospection », motif « Essai ».
   - Dans Brevo : rien ne change. Le contact est toujours là, toujours bloqué, sans liste.
   - Puis « Remettre en prospection », motif « Fin de l'essai ».
   - Dans Brevo : toujours bloqué. La fiche Matrice affiche l'auteur, la date et le motif.

10. **Vider la clé** (tout de suite après l'étape 9)
    - Espace de test › Réglages › Brevo › « Clé API Brevo » : efface le champ (laisse-le vide) et valide.
    - Le message « Clé Brevo retirée » apparaît, puis l'état affiche « pas encore de clé ».
    - Claude vérifie en lecture que la clé est vide, puis retire la liste blanche. Jamais dans l'autre ordre.

11. **Rangement**
    - Dans l'espace de test : supprime le contact et les deux structures d'essai.
    - Dans Brevo : la Matrice ne supprime jamais rien. Tu peux supprimer le contact d'essai à la main ou le laisser bloqué.
    - Garde l'attribut FONCTIONS : il sert ensuite en production.

## Résultat attendu à rapporter
Pour chaque étape de 5 à 10 : « conforme » ou ce que tu as vu, avec une capture si possible.
La demande de publication n'est ouverte qu'après cet essai conforme.
