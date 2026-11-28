#!/bin/sh
# Copie le prototype (fichiers servis uniquement) vers le dépôt public du site indépendant (Antcb/matrice-prototype, GitHub Pages).
# Usage : sh outils/publier-site.sh <dossier du clone matrice-prototype> <version> <commit>
# Le site n'affiche que des données fictives ; aucune connexion à un service.
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd); DST="$1"; VER="$2"; SHA="$3"
[ -d "$DST/.git" ] || { echo "Clone introuvable : $DST"; exit 1; }
find "$DST" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$SRC/index.html" "$SRC/css" "$SRC/js" "$SRC/assets" "$SRC/apercu" "$DST/"
touch "$DST/.nojekyll"
cat > "$DST/README.md" <<TXT
# MATRICE — prototype UX/UI (données fictives)

Site : https://antcb.github.io/matrice-prototype/
Version : ${VER} — source : branche \`ux/refonte-uxui\` du dépôt lartbo-matrice, commit \`${SHA}\`.
Aperçu statique (captures et texte, lisible sans JavaScript) : [apercu/README.md](apercu/README.md)

Prototype de démonstration : aucune donnée réelle, aucune connexion à un service. Ce dépôt est généré, ne pas le modifier à la main.
TXT
echo "Copié vers $DST ($VER, $SHA)"
