# Sauvegarde — Matrice Booking L'ArtBoristerie

Dépôt **privé**. Chaque nuit (vers 4 h), GitHub lance `sauvegarde.py`, qui récupère toute la base de la Matrice et les pièces jointes des suivis, puis enregistre un commit « Sauvegarde du AAAA-MM-JJ ».

- `donnees/` : une copie de chaque table (dates, structures, contacts, suivis, tâches, paiements…)
- `fichiers/` : les pièces jointes (PDF, photos)
- `derniere-sauvegarde.txt` : date et nombre d'éléments de la dernière sauvegarde

Revenir à un jour donné : onglet **Commits** → choisir la date → *Browse files*.
Lancer une sauvegarde tout de suite : onglet **Actions** → *Sauvegarde quotidienne* → *Run workflow*.

La clé qui autorise l'export est le secret GitHub `BACKUP_SECRET` (Settings → Secrets and variables → Actions). Pour la changer, modifier `backup_secret` dans `private.import_secrets` (Supabase) et ce secret.
Tout le fonctionnement tient dans un seul fichier : `.github/workflows/sauvegarde.yml`.

Le modèle de ce dépôt est dans le dossier `backup/` de `lartbo-matrice`.
