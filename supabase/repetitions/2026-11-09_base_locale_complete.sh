#!/bin/bash
# Base modèle JETABLE « MODELE » (défaut tpl) : socle Supabase simulé + supabase/schema.sql + toutes les migrations du dépôt dans l'ordre
# des noms (jusqu'à la dernière, v1.60.6 au 09/11/2026). Jamais Supabase, jamais la production ; aucune donnée réelle.
# Usage (PostgreSQL 16 local) : PGHOST=/tmp PGPORT=55531 PGUSER=postgres supabase/repetitions/2026-11-09_base_locale_complete.sh
# pg_net / pg_cron : non installés, simulés par le socle. Une garde d'empreinte de PRODUCTION qui ne peut pas être reconstituée depuis
# le dépôt (texte en ligne différent du dépôt) est neutralisée sur cette base seulement, et signalée (« garde d'empreinte neutralisée »).
set -u
R=$(cd "$(dirname "$0")/../.." && pwd); MODELE=${MODELE:-tpl}; P="psql -X -q"
# garde « base locale » (relecture de 3dd83dd) : serveur local seulement, jamais un projet Supabase (ce script EFFACE la base MODELE)
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo "refusé : PGHOST doit désigner un serveur LOCAL (socket /…, localhost, 127.0.0.1)"; exit 1 ;; esac
case "${PGPORT:-5432}" in 5432|6543) echo "refusé : port $PGPORT (port d'un serveur ordinaire ou de Supabase) — utiliser un port jetable dédié"; exit 1 ;; esac
if [ "$($P -At -d postgres -c "select count(*) from pg_namespace where nspname in ('graphql','realtime','supabase_functions','supabase_migrations','pgbouncer')")" != 0 ]; then
  echo "refusé : ce serveur ressemble à une base Supabase"; exit 1
fi
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
