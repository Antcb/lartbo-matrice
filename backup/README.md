# Sauvegarde — Matrice Booking L'ArtBoristerie

Dépôt **privé**. Chaque nuit (vers 4 h), GitHub lance `sauvegarde.py`, qui récupère toute la base de la Matrice et les pièces jointes des suivis, puis enregistre un commit « Sauvegarde du AAAA-MM-JJ ».

- `donnees/` : une copie de chaque table (dates, structures, contacts, suivis, tâches, paiements…)
- `fichiers/` : les pièces jointes (PDF, photos)
- `derniere-sauvegarde.txt` : date et nombre d'éléments de la dernière sauvegarde

Revenir à un jour donné : onglet **Commits** → choisir la date → *Browse files*.
Lancer une sauvegarde tout de suite : onglet **Actions** → *Sauvegarde quotidienne* → *Run workflow*.

`secret.txt` contient la clé qui autorise l'export. Elle ne donne accès qu'à une copie des données déjà présentes ici : ce dépôt doit rester privé. Pour la changer, modifier `backup_secret` dans `private.import_secrets` (Supabase) et ce fichier.

Le modèle de ce dépôt est dans le dossier `backup/` de `lartbo-matrice`.
