#!/bin/bash
# v1.60.4 — VÉRIFICATION du nettoyage « ESSAI promo » sur une base PostgreSQL JETABLE (jamais Supabase, jamais la production).
# Prérequis : un serveur PostgreSQL local jetable et une base modèle construite depuis les migrations du dépôt (voir README.md),
# nommée par MODELE (défaut promo_tpl). Chaque cas part d'une copie neuve de ce modèle (base « essai_verif », effacée à chaque cas).
# Usage : PGHOST=127.0.0.1 PGPORT=55493 PGUSER=postgres ./2026-11-08_v1.60.4_essai_promo_verification.sh
# Chaque cas compare un instantané complet de toutes les tables du schéma public avant / après le nettoyage. Sortie 1 au moindre écart.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); MODELE=${MODELE:-promo_tpl}; DB=essai_verif
CREE="$DIR/2026-11-08_v1.60.4_essai_promo_coproduction.sql"; NET="$DIR/2026-11-08_v1.60.4_essai_promo_nettoyage.sql"
P0="psql -X -q -v ON_ERROR_STOP=1"; E=e55a1000-0000-4000-a000-0000000000; T=11111111-1111-4111-a111-111111111111
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; ECHECS=0
snap(){ for t in $($P0 -d $DB -At -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"); do
  $P0 -d $DB -At -c "select '$t|'||(to_jsonb(x)-'updated_at')::text from public.$t x order by 1"; done; }
base(){   # $1 = avec_essai | sans_essai ; $2 = données ajoutées avant le nettoyage
  $P0 -d postgres -c "drop database if exists $DB" -c "create database $DB template $MODELE" >/dev/null 2>&1
  $P0 -d $DB -c "insert into settings(key,value) values ('drive_webhook_url','\"https://exemple.invalid/hook\"') on conflict do nothing" >/dev/null
  # données témoins (fictives) : un artiste, une structure, un coproducteur et deux dates « réels » qui ne doivent jamais bouger
  $P0 -d $DB >/dev/null <<SQL
insert into projects(id,name,active,mode) values ('$T','Artiste témoin',true,'production');
insert into partners(id,name,default_pct) values ('22222222-2222-4222-a222-222222222222','Coprod témoin',0);
insert into structures(id,name,city) values ('33333333-3333-4333-a333-333333333333','Salle témoin','Paris');
insert into shows(id,project_id,structure_id,venue,city,date,status,contract_type,fee_ht,partner_id,drive_folder_requested_at)
 values ('44444444-4444-4444-a444-444444444444','$T','33333333-3333-4333-a333-333333333333','Salle témoin','Paris','2026-12-01','Confirmée Salle','Cession',2000,null,now());
SQL
  [ "$1" = avec_essai ] && (echo "set essai.cible = 'jetable';"; cat "$CREE") | $P0 -d $DB >/dev/null 2>&1
  [ -n "${2:-}" ] && $P0 -d $DB -c "$2" >/dev/null
  return 0
}
cas(){   # $1 nom ; $2 attendu (arret | ok | rien) ; $3 options avant le script (set …) ; $4 vérification SQL qui doit renvoyer t
  snap > "$TMP/avant"; out=$( (echo "${3:-}"; cat "$NET") | psql -X -q -d $DB 2>&1 | grep -E "ERROR|NOTICE" | head -1)
  snap > "$TMP/apres"
  hors_traces=$(diff "$TMP/avant" "$TMP/apres" | grep '^[<>]' | grep -v '^. \(finance_log\|show_deletions\)|' | grep -vc "$E" )
  essai_retire=$(diff "$TMP/avant" "$TMP/apres" | grep '^<' | grep -v '^< \(finance_log\|show_deletions\|client_errors\)|' | grep -c "$E")
  traces_modifiees=$(diff "$TMP/avant" "$TMP/apres" | grep '^<' | grep -c '^< \(finance_log\|show_deletions\|client_errors\)|')
  ok=1
  case "$2" in
    arret) [ "$(diff "$TMP/avant" "$TMP/apres" | grep -c '^[<>]')" = 0 ] && grep -q "Nettoyage arrêté" <<<"$out" || ok=0 ;;
    ok)    grep -q "retiré des tables actives" <<<"$out" && [ "$hors_traces" = 0 ] && [ "$traces_modifiees" = 0 ] && [ "$essai_retire" -ge 12 ] || ok=0 ;;
    rien)  grep -q "rien à retirer" <<<"$out" && [ "$(diff "$TMP/avant" "$TMP/apres" | grep -c '^[<>]')" = 0 ] || ok=0 ;;
  esac
  if [ -n "${4:-}" ] && [ "$($P0 -d $DB -At -c "$4")" != t ]; then ok=0; fi
  [ $ok = 1 ] && echo "OK     $1" || { echo "ÉCHEC  $1 — $out"; ECHECS=$((ECHECS+1)); }
}

# 1. journal technique client_errors qui cite un identifiant d'essai : trace conservée → nettoyage réussi, ligne intacte
base avec_essai "insert into client_errors(message,view) values ('Erreur fictive sur la date ${E}12 (essai)','production')"
cas client_errors_trace ok "" "select count(*) = 1 from client_errors where message = 'Erreur fictive sur la date ${E}12 (essai)' and view = 'production'"
# 2. second lancement sur la même base : rien à retirer, nombre réel annoncé, rien modifié
cas second_lancement rien ""
# 3. base sans essai : rien à retirer
base sans_essai ""; cas base_sans_essai rien ""
# 4. cas propre, avec une clôture faite pendant l'essai : copie dans show_deletions (historique de clôture compris), puis retrait
base avec_essai "begin; select set_config('matrice.result_rpc','on',true); update shows set result_closed_at=now(), result_closed='{}' where id='${E}12'; insert into result_closures(show_id,action,snapshot) values ('${E}12','close','{}'); commit;"
cas propre_cloture ok "" "select count(*) = 3 and sum(jsonb_array_length(snapshot->'result_closures')) = 1 from show_deletions where show_id::text like '${E}1_'"
# 5. notification retirée d'une date d'essai : arrêt avec la marche à suivre ; avec l'option, copiée dans la trace puis retirée
base avec_essai "insert into notifications(title,show_id,read_by,withdrawn_at,withdrawn_reason) values ('Rappel essai','${E}13','{}',now(),'Date archivée')"
cas notification_sans_option arret ""
cas notification_option ok "set essai.notifications = 'conserver';" "select count(*) = 1 from show_deletions, jsonb_array_elements(snapshot->'notifications') n where n->>'title' = 'Rappel essai'"
# 6. notification d'une date RÉELLE qui cite l'artiste d'essai : jamais retirée, arrêt même avec l'option
base avec_essai "insert into notifications(title,show_id,project_id,read_by) values ('Réelle','44444444-4444-4444-a444-444444444444','${E}01','{}')"
cas notification_date_reelle arret "set essai.notifications = 'conserver';"
# 7. dépendances opérationnelles : arrêt, rien touché
for d in \
  "insert into mail_templates(project_id,kind,subject,html,attachments,applies_to,project_ids) values ('${E}01','prospection','x','x','[]','all','{}')" \
  "insert into pennylane_rattachements(at,show_id,pennylane_id) values (now(),'${E}12','p2')" \
  "insert into tasks(title,status,show_id,tags,project_ids) values ('t','To Do','${E}11','{}','{}')" \
  "insert into project_logs(project_id,title) values ('${E}01','x')" \
  "update projects set admin_structure_id='${E}03' where id='$T'" \
  "insert into show_payments(show_id,kind,label) values ('${E}11','autre','Recette')"; do
  base avec_essai "$d"; cas "dépendance : ${d:0:60}…" arret ""
done
$P0 -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
echo; [ $ECHECS = 0 ] && echo "Aucun échec." || { echo "$ECHECS ÉCHEC(S)."; exit 1; }
