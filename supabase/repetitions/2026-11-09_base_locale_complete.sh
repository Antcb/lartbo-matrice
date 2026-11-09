#!/bin/bash
# Base modèle JETABLE « MODELE » (défaut tpl) : socle Supabase simulé + supabase/schema.sql + toutes les migrations du dépôt dans l'ordre
# des noms (jusqu'à la dernière, v1.60.6 au 09/11/2026). Jamais Supabase, jamais la production ; aucune donnée réelle.
# Usage (PostgreSQL 16 local) : PGHOST=/tmp PGPORT=55531 PGUSER=postgres supabase/repetitions/2026-11-09_base_locale_complete.sh
# pg_net / pg_cron : non installés, simulés par le socle. Une garde d'empreinte de PRODUCTION qui ne peut pas être reconstituée depuis
# le dépôt (texte en ligne différent du dépôt) est neutralisée sur cette base seulement, et signalée (« garde d'empreinte neutralisée »).
set -u
R=$(cd "$(dirname "$0")/../.." && pwd); MODELE=${MODELE:-tpl}; P="psql -X -q"
$P -d postgres -c "drop database if exists $MODELE" -c "create database $MODELE" >/dev/null
$P -d $MODELE -v ON_ERROR_STOP=1 -f "$R/supabase/repetitions/2026-11-09_base_locale_socle.sql" >/dev/null 2>&1 || { echo "socle : échec"; exit 1; }
for f in "$R/supabase/schema.sql" $(ls "$R"/supabase/migrations/*.sql | sort); do
  out=$(sed -E 's/^create extension if not exists (pg_net|pg_cron);//I' "$f" | $P -d $MODELE -v ON_ERROR_STOP=1 2>&1 | grep -E "ERROR")
  if [ -n "$out" ] && grep -q "attendue\|attendu" <<<"$out"; then
    out=$(sed -E 's/^create extension if not exists (pg_net|pg_cron);//I; s/raise exception (.*attendue?)/raise notice \1/' "$f" | $P -d $MODELE -v ON_ERROR_STOP=1 2>&1 | grep -E "ERROR")
    echo "garde d'empreinte neutralisée : $(basename "$f")"
  fi
  if [ -n "$out" ]; then echo "ÉCHEC $(basename "$f") : $out"; exit 1; fi
done
echo "base modèle $MODELE construite"
