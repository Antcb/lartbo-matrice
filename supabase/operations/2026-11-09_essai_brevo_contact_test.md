# Essai Brevo réel sur un contact de test — avant la demande de publication

Lot `dev/brevo-rattachements` : rattachements, champ FONCTIONS, exclusion de la prospection.
Toutes les étapes se font sur le **web**. Une étape à la fois, avec confirmation avant la suivante.
L'essai a lieu dans l'**espace de test** de la Matrice. Le compte Brevo est le vrai compte, mais **sans liste** : aucun contact de campagne n'est touché.

## Avant l'essai (Claude, pas Anthony)
- Migration `2026-11-08_brevo_rattachements.sql` appliquée sur le **projet de test** seulement.
- Fonction `brevo-sync` (index.ts et regles.ts) déployée sur le **projet de test**, puis comparée au dépôt.
- Dans l'espace de test, Réglages › Brevo : « Liste Brevo » **vide**, pour que le contact d'essai n'entre dans aucune liste.
- Clé API Brevo présente dans l'espace de test. Si elle manque, Anthony la colle à l'étape 2.

## Étapes pour Anthony

1. **Créer le champ FONCTIONS dans Brevo**
   - Ouvre app.brevo.com, puis ton nom en haut à droite › Paramètres › Contacts › Attributs de contact.
   - Onglet « Attributs normaux » › « Ajouter un nouvel attribut ».
   - Nom : `FONCTIONS`. Type : Texte. Puis « Créer l'attribut ».
   - Le nom et le type ne pourront plus être changés ensuite.
   - Les libellés sont traduits de l'aide Brevo en anglais : ils peuvent différer légèrement.

2. **Clé Brevo de l'espace de test** (seulement si Claude l'indique)
   - Espace de test de la Matrice › Réglages › Brevo › « Clé API Brevo » : colle la clé.
   - Laisse « Liste Brevo » vide.

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

10. **Rangement**
    - Dans l'espace de test : supprime le contact et les deux structures d'essai.
    - Dans Brevo : la Matrice ne supprime jamais rien. Tu peux supprimer le contact d'essai à la main ou le laisser bloqué.
    - Garde l'attribut FONCTIONS : il sert ensuite en production.

## Résultat attendu à rapporter
Pour chaque étape de 5 à 9 : « conforme » ou ce que tu as vu, avec une capture si possible.
La demande de publication n'est ouverte qu'après cet essai conforme.
