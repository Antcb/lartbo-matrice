#!/usr/bin/env python3
"""Nouvelle version de l'application : à lancer avant chaque mise en ligne.

    python3 tools/bump_version.py patch "Correction de l'affichage des tâches"
    python3 tools/bump_version.py minor "Nouvel onglet Facturation" "Export CSV des dates"
    python3 tools/bump_version.py major "Refonte complète"

- patch : correction (1.6.0 → 1.6.1) · minor : nouveauté (1.6.0 → 1.7.0) · major : refonte (1.6.0 → 2.0.0)
- met à jour APP_VERSION dans js/config.js (affiché dans l'app, onglet Réglages)
- ajoute une entrée datée en haut de CHANGELOG.md avec les lignes données
- met le numéro de version sur la feuille de style et sur chaque fichier JavaScript (dans index.html)
  pour que les navigateurs rechargent tout au lieu de garder l'ancienne version en mémoire.

Sans argument (`python3 tools/bump_version.py`), seul le rafraîchissement des fichiers est refait
avec la version actuelle.
"""
import datetime, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
config = root / "js" / "config.js"
changelog = root / "CHANGELOG.md"
index = root / "index.html"

cfg = config.read_text(encoding="utf-8")
cur = re.search(r"APP_VERSION = '(\d+)\.(\d+)\.(\d+)'", cfg)
major, minor, patch = map(int, cur.groups())
kind = sys.argv[1] if len(sys.argv) > 1 else None
notes = sys.argv[2:]

if kind:
    if kind not in ("patch", "minor", "major"):
        sys.exit("Premier argument : patch, minor ou major")
    if not notes:
        sys.exit('Ajoute au moins une ligne de description : bump_version.py minor "Ce qui change"')
    if kind == "major": major, minor, patch = major + 1, 0, 0
    elif kind == "minor": minor, patch = minor + 1, 0
    else: patch += 1
version = f"{major}.{minor}.{patch}"

if kind:
    config.write_text(re.sub(r"APP_VERSION = '[\d.]+'", f"APP_VERSION = '{version}'", cfg), encoding="utf-8")
    today = datetime.date.today().strftime("%d/%m/%Y")
    entry = f"## {version} — {today}\n" + "".join(f"- {n}\n" for n in notes) + "\n"
    log = changelog.read_text(encoding="utf-8")
    marker = "<!-- nouvelles versions ci-dessous -->\n"
    log = log.replace(marker, marker + "\n" + entry, 1) if marker in log else log + "\n" + entry
    changelog.write_text(log, encoding="utf-8")

# Import map : chaque module JS chargé avec ?v=<version>
mods = sorted(p.relative_to(root).as_posix() for p in (root / "js").rglob("*.js"))
imap = ",\n".join(f'      "./{m}": "./{m}?v={version}"' for m in mods)
block = f'''<!-- import-map:début (généré par tools/bump_version.py) -->
  <script type="importmap">
  {{
    "imports": {{
{imap}
    }}
  }}
  </script>
  <!-- import-map:fin -->'''
for page in (index, root / "fiche.html", root / "rh.html"):   # pages publiques : fiche de renseignements, fiche salarié
    if not page.exists(): continue
    s = page.read_text(encoding="utf-8")
    s = re.sub(r"<!-- import-map:début.*?import-map:fin -->", block, s, flags=re.S)
    s = re.sub(r'(css/styles\.css|css/fiche\.css|js/app\.js|js/fiche\.js|js/rh\.js)\?v=[\w.-]+', lambda m: f"{m.group(1)}?v={version}", s)
    page.write_text(s, encoding="utf-8")
print(f"version {version} — {len(mods)} modules")
