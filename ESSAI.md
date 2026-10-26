# Site d'essai C1 — NE PAS UTILISER POUR LE TRAVAIL RÉEL

https://antcb.github.io/lartbo-matrice-essai/ — copie du lot C1 de la Matrice (dépôt `Antcb/lartbo-matrice`, demande de fusion n°10,
commit `3fe2238`, version 1.41.4), **forcée sur le projet Supabase de test « Lartbo-matrice-test » (`dthfocplfzzmkgaxhmwk`)**.
La production n'est accessible d'aucune façon (ni `?prod`, ni lien).

Seules différences avec le commit `3fe2238` :
1. `js/config.js` : environnement fixé à « test » ; le choix gardé par le navigateur n'est ni lu ni modifié.
2. Bandeau (`js/ui/testbanner.js`, `js/app.js`, `js/views/auth.js`) : version et base de test affichées ; plus de lien « Revenir à la vraie Matrice ».
3. Outils : `.github/workflows/tests.yml` retiré ; vérification automatique du site après chaque publication
   (`.github/workflows/verif-lien-essai.yml`, `tools/essai/verifier-lien.mjs`).

À archiver ou supprimer après les tests d'interface C1.
