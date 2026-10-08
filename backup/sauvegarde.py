#!/usr/bin/env python3
"""Sauvegarde quotidienne de la Matrice Booking L'ArtBoristerie.

Récupère l'export complet (fonction Supabase « backup-export ») et l'écrit dans ce dépôt :
  donnees/<table>.json     une ligne par enregistrement (les différences d'un jour à l'autre restent lisibles)
  fichiers/<chemin>        pièces jointes des suivis (seules les nouvelles sont téléchargées)
  derniere-sauvegarde.txt  date et volumes de la dernière sauvegarde
Le secret est lu dans la variable BACKUP_SECRET (secret GitHub Actions du dépôt).
"""
import json, os, pathlib, sys, urllib.request

URL = "https://ypvvjoqhzddzbmerypdc.supabase.co/functions/v1/backup-export"
root = pathlib.Path.cwd()   # lancé depuis la racine du dépôt de sauvegarde
secret = os.environ["BACKUP_SECRET"]

req = urllib.request.Request(URL, data=json.dumps({"secret": secret}).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=300) as r:
    export = json.load(r)
if "tables" not in export:
    sys.exit("Export refusé : " + json.dumps(export)[:300])

data_dir = root / "donnees"
data_dir.mkdir(exist_ok=True)
counts = {}
for table, rows in export["tables"].items():
    counts[table] = len(rows)
    lines = ",\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows)
    (data_dir / f"{table}.json").write_text("[\n" + lines + "\n]\n", encoding="utf-8")

new = 0
for f in export["files"]:
    dest = root / "fichiers" / f["path"]
    if dest.exists() and (not f["size"] or dest.stat().st_size == f["size"]):
        continue
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f["url"], timeout=300) as r:
        dest.write_bytes(r.read())
    new += 1

summary = [f"Sauvegarde du {export['exported_at']}", ""] + [f"{t}: {n}" for t, n in counts.items()] + \
          ["", f"pièces jointes : {len(export['files'])} (dont {new} nouvelles)"]
(root / "derniere-sauvegarde.txt").write_text("\n".join(summary) + "\n", encoding="utf-8")
print("\n".join(summary))
