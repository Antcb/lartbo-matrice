#!/bin/bash
# Brise Glace — ESSAI de l'opération supabase/operations/2026-11-09_brise_glace_rattachement.sql et de son retour arrière, sur une
# base PostgreSQL JETABLE (jamais Supabase, jamais la production), données FICTIVES (seuls les préfixes d'identifiants, les numéros
# et montants relevés sont repris pour que les gardes de l'opération soient exercées telles quelles).
# Prérequis : base modèle « MODELE » (défaut tpl) construite par 2026-11-09_base_locale_complete.sh (toutes les migrations du dépôt).
# Usage (depuis la racine du dépôt) : PGHOST=/tmp PGPORT=55531 PGUSER=postgres supabase/repetitions/2026-11-09_brise_glace_rattachement_essai.sh
# Chaque cas part d'une copie neuve du modèle ; « rien modifié » = instantané identique de show_payments, finance_log,
# pennylane_rattachements, pennylane_a_rattacher et notifications. Sortie 1 au moindre écart.
set -u
R=$(cd "$(dirname "$0")/../.." && pwd); MODELE=${MODELE:-tpl}; DB=essai_brise
OP="$R/supabase/operations/2026-11-09_brise_glace_rattachement.sql"
RB="$R/supabase/retours-arriere/2026-11-09_brise_glace_rattachement_retour_arriere.sql"
P="psql -X -q -v ON_ERROR_STOP=1"; Q="psql -X -q -At -d $DB"
SH=b021e7d4-0000-4000-a000-000000000001; AC=d83eda31-0000-4000-a000-000000000001; SO=7ac2937a-0000-4000-a000-000000000001
OK_SET="set operation.confirmation = '107-est-l-acompte'; set operation.operateur = 'anthony@lartboristerie.com';"
RB_SET="set operation.confirmation = 'retour-brise-glace'; set operation.operateur = 'anthony@lartboristerie.com';"
ECHECS=0
snap(){ $Q -c "select md5(coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from show_payments x), '')
  || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from finance_log x), '')
  || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from pennylane_rattachements x), '')
  || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from pennylane_a_rattacher x), '')
  || coalesce((select string_agg((to_jsonb(x) - 'read_by')::text, '|' order by x.id) from notifications x), ''))"; }
lignes(){ $Q -c "select string_agg(array_to_string(array[kind, amount::text, invoice_number, invoiced_on::text, sent_at::text, paid_at::text, pennylane_id, pennylane_url, reminded_at::text, drive_file_id], ',', ''), ' / ' order by sort) from show_payments where show_id = '$SH' and kind in ('acompte','solde')"; }
base(){   # état relevé en production le 09/11, reconstitué par les déclencheurs (journal compris) ; $1 = variante
  $P -d postgres -c "drop database if exists $DB" -c "create database $DB template $MODELE" >/dev/null 2>&1
  $P -d $DB >/dev/null <<SQL
insert into projects(id, name) values ('e0000000-0000-4000-a000-000000000001', 'ESSAI Brise Glace (fictif)');
insert into shows(id, project_id, venue, city, date, status, prod_mode, fee_ht, pennylane_quote_id, contract_sent)
  values ('$SH', 'e0000000-0000-4000-a000-000000000001', 'Salle fictive', 'Ville fictive', '2026-12-02', 'Confirmée Salle', 'production', 457.98, '9001', '2026-10-20');
update show_payments set id = '$AC', label = 'Acompte' where show_id = '$SH' and kind = 'acompte';   -- lignes créées par shows_defaults
update show_payments set id = '$SO', label = 'Solde' where show_id = '$SH' and kind = 'solde';
-- 05/11, production@ : acompte envoyé (montant figé 228,99 par show_payments_freeze), n° 33 noté à la main
select set_config('request.jwt.claims', '{"email":"production@lartboristerie.com","role":"authenticated"}', false);
update show_payments set sent_at = '2026-11-05' where id = '$AC';
update show_payments set invoice_number = 'F-AB-2026-11-33', invoiced_on = '2026-11-05' where id = '$AC';
-- 06/11 13:59, ancienne synchronisation (service_role) : facture 107 reliée au solde, montant figé
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
update show_payments set pennylane_id = '34170228875264', invoice_number = 'F-AB-2026-11-107', invoiced_on = '2026-11-05', amount = 228.99,
  pennylane_url = 'https://app.pennylane.com/companies/22190862/clients/customer_invoices?invoice_id=34170228875264&subtab=all' where id = '$SO';
-- 06/11 14:03, production@ : n° de l'acompte 33 → 107
select set_config('request.jwt.claims', '{"email":"production@lartboristerie.com","role":"authenticated"}', false);
update show_payments set invoice_number = 'F-AB-2026-11-107' where id = '$AC';
select set_config('request.jwt.claims', '', false);
-- 09/11, opération v1.60.6 : rappel « Facture à envoyer : Solde » retiré (clé suffixée)
insert into notifications(kind, title, show_id, dedupe_key, emailed_at, withdrawn_at, withdrawn_reason)
  values ('facture_envoi', 'Facture à envoyer : Solde (F-AB-2026-11-107) — Salle fictive', '$SH', 'facture_envoi:$SH:$SO:2026-11-08:retire-v1.60.6', now(), now(),
          'v1.60.6 : rappel créé trop tôt — la facture de solde s''envoie à J-7 ; il reviendra le 25/11/2026');
SQL
  [ -n "${1:-}" ] && $P -d $DB -c "$1" >/dev/null
  return 0
}
lancer(){ (echo "$1"; cat "$2") | psql -X -q -d $DB 2>&1 | grep -E "ERROR|NOTICE" | grep -v "^psql.*NOTICE:  database" | tail -1; }
cas(){   # $1 nom ; $2 attendu (arret | ok | deja) ; $3 réglages ; $4 script ; $5 contrôle SQL qui doit rendre t
  av=$(snap); out=$(lancer "$3" "$4"); ap=$(snap); ok=1
  case "$2" in
    arret) [ "$av" = "$ap" ] && grep -q "ERROR" <<<"$out" && grep -q "rien n'est modifié" <<<"$out" || ok=0 ;;
    ok)    [ "$av" != "$ap" ] && ! grep -q "ERROR" <<<"$out" || ok=0 ;;
    deja)  [ "$av" = "$ap" ] && grep -q "rien n'est modifié" <<<"$out" && ! grep -q "ERROR" <<<"$out" || ok=0 ;;
  esac
  if [ -n "${5:-}" ] && [ "$($Q -c "$5")" != t ]; then ok=0; fi
  [ $ok = 1 ] && echo "OK     $1 — ${out:0:170}" || { echo "ÉCHEC  $1 — $out"; ECHECS=$((ECHECS+1)); }
}

# 0. l'état reconstitué est bien celui relevé (et la synchronisation actuelle ne peut pas relier la facture au solde ici : voir rejeu.mjs)
base; AVANT=$(lignes)
[ "$AVANT" = "acompte,228.99,F-AB-2026-11-107,2026-11-05,2026-11-05,,,,, / solde,228.99,F-AB-2026-11-107,2026-11-05,,,34170228875264,https://app.pennylane.com/companies/22190862/clients/customer_invoices?invoice_id=34170228875264&subtab=all,," ] \
  && echo "OK     état de départ conforme aux faits relevés" || { echo "ÉCHEC  état de départ : $AVANT"; ECHECS=$((ECHECS+1)); }
# 1. sans confirmation / opérateur hors équipe : arrêt, rien modifié
cas "sans confirmation" arret "" "$OP"
cas "opérateur hors équipe" arret "set operation.confirmation = '107-est-l-acompte'; set operation.operateur = 'inconnu@exemple.invalid';" "$OP"
# 2. nominal
cas "opération nominale" ok "$OK_SET" "$OP" "select
  (select pennylane_id = '34170228875264' and invoice_number = 'F-AB-2026-11-107' and sent_at = '2026-11-05' and invoiced_on = '2026-11-05' and amount = 228.99 and paid_at is null from show_payments where id = '$AC')
  and (select pennylane_id is null and invoice_number is null and invoiced_on is null and sent_at is null and amount is null and pct = 50 and public.payment_amount_now(p) = 228.99 from show_payments p where id = '$SO')
  and (select count(*) = 1 from pennylane_rattachements where pennylane_id = '34170228875264' and from_payment_id = '$SO' and to_payment_id = '$AC' and actor = 'anthony@lartboristerie.com')"
# 2 bis : détail du journal financier et des rappels après l'opération (même base)
J=$($Q -c "select string_agg(concat_ws(':', case row_id when '$AC' then 'acompte' else 'solde' end, field, coalesce(old_value,'∅'), coalesce(new_value,'∅'), actor), ' ; ' order by id) from finance_log where at > now() - interval '1 minute' and source = 'application / fonction serveur' and actor = 'anthony@lartboristerie.com'")
echo "       journal ajouté : $J"
[ "$J" = "solde:amount:228.99:∅:anthony@lartboristerie.com ; solde:invoice_number:F-AB-2026-11-107:∅:anthony@lartboristerie.com ; solde:pennylane_id:34170228875264:∅:anthony@lartboristerie.com ; acompte:pennylane_id:∅:34170228875264:anthony@lartboristerie.com" ] \
  && echo "OK     journal financier : 4 écritures attendues" || { echo "ÉCHEC  journal financier"; ECHECS=$((ECHECS+1)); }
RC=$($Q -c "select string_agg(r || ':' || raw || coalesce(':' || (nxt ->> r), ''), ' ; ' order by r) from reminder_candidates('$SH', true) where r in ('facture_envoi','solde_envoi','acompte_paye','solde_paye','facture_acompte')")
echo "       rappels candidats : $RC"
[ "$RC" = "acompte_paye:2026-11-15 ; solde_envoi:2026-11-25" ] && echo "OK     rappels : solde à faire le 25/11, aucun « Facture à envoyer »" || { echo "ÉCHEC  rappels"; ECHECS=$((ECHECS+1)); }
avn=$($Q -c "select count(*) from notifications"); $Q -c "select generate_reminders()" >/dev/null 2>&1; apn=$($Q -c "select count(*) from notifications where kind = 'facture_envoi' and withdrawn_at is null")
RET=$($Q -c "select count(*) = 1 from notifications where dedupe_key = 'facture_envoi:$SH:$SO:2026-11-08:retire-v1.60.6' and withdrawn_at is not null")
[ "$apn" = 0 ] && [ "$RET" = t ] && echo "OK     generate_reminders (aujourd'hui) : aucune « Facture à envoyer », notification retirée intacte" || { echo "ÉCHEC  generate_reminders : $apn / $RET"; ECHECS=$((ECHECS+1)); }
# 3. rejouée : reconnue, rien modifié
cas "opération rejouée" deja "$OK_SET" "$OP"
# 4. retour arrière : état d'origine exact, puis rejeu du retour
cas "retour arrière" ok "$RB_SET" "$RB"
APRES=$(lignes); [ "$APRES" = "$AVANT" ] && echo "OK     retour arrière : lignes identiques à l'état de départ" || { echo "ÉCHEC  retour arrière : $APRES"; ECHECS=$((ECHECS+1)); }
cas "retour arrière rejoué" deja "$RB_SET" "$RB"
# 5. jour J-7 atteint (date du concert ramenée à aujourd'hui + 7, jour ouvré) : « Facture de solde à faire » créée, pas « Facture à envoyer »
base; lancer "$OK_SET" "$OP" >/dev/null
J7=$($Q -c "select d::date from generate_series((current_date + 7)::timestamp, (current_date + 14)::timestamp, interval '1 day') d where extract(isodow from d::date - 7) < 6 limit 1")
$Q -c "update shows set date = '$J7' where id = '$SH'" >/dev/null; $Q -c "select generate_reminders()" >/dev/null 2>&1
N5=$($Q -c "select string_agg(kind || ':' || title, ' ; ' order by kind) from notifications where show_id = '$SH' and withdrawn_at is null and kind in ('solde_envoi','facture_envoi')")
[[ "$N5" == "solde_envoi:Facture de solde à faire"* ]] && [[ "$N5" != *";"* ]] && echo "OK     au jour ouvré de J-7 : « $N5 » seulement" || { echo "ÉCHEC  J-7 : $N5"; ECHECS=$((ECHECS+1)); }
# 6. états différents : arrêt, rien modifié
base "update show_payments set sent_at = '2026-11-20' where id = '$SO'"; cas "solde envoyé entre-temps" arret "$OK_SET" "$OP"
base "update show_payments set paid_at = '2026-11-20' where id = '$SO'"; cas "solde payé entre-temps (Pennylane)" arret "$OK_SET" "$OP"
base "select set_config('request.jwt.claims','{\"email\":\"production@lartboristerie.com\"}',false); update show_payments set invoice_number = 'F-AB-2026-11-33' where id = '$AC'"
cas "acompte encore au n° 33" arret "$OK_SET" "$OP"
base "insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('34170228875264', '$SH', 'F-AB-2026-11-107', 228.99, 'essai')"
cas "facture déjà signalée « à rattacher »" arret "$OK_SET" "$OP"
base "update shows set fee_ht = 457.98, date = '2026-12-03' where id = '$SH'"; cas "date du concert différente" arret "$OK_SET" "$OP"
base "insert into show_payments(show_id, kind, label, pct, sort) values ('$SH', 'acompte', 'Acompte 2', 10, 3)"; cas "un deuxième acompte" arret "$OK_SET" "$OP"
base "select set_config('request.jwt.claims','{\"email\":\"production@lartboristerie.com\"}',false); update show_payments set paid_at = '2026-11-08' where id = '$AC'"
cas "acompte payé entre-temps" arret "$OK_SET" "$OP"
# 6 bis (relecture de 3dd83dd, B1) : n° 33 ou autre facture Pennylane connue → arrêt
OTH=c0000000-0000-4000-a000-000000000009
AUTRE="insert into shows(id, project_id, venue, city, date, status, prod_mode, fee_ht) values ('$OTH', 'e0000000-0000-4000-a000-000000000001', 'Autre', 'X', '2026-12-20', 'Confirmée Salle', 'production', 1000);"
base "$AUTRE update show_payments set invoice_number = 'F-AB-2026-11-33' where show_id = '$OTH' and kind = 'acompte';"; cas "n° 33 sur une ligne d'une autre date" arret "$OK_SET" "$OP"
base "$AUTRE update show_payments set invoice_number = 'f ab 2026 11 33' where show_id = '$OTH' and kind = 'acompte';"; cas "n° 33 ailleurs (espaces, casse)" arret "$OK_SET" "$OP"
base "insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('99990033', '$SH', 'F-AB-2026-11-33', 228.99, 'essai')"; cas "facture 33 signalée « à rattacher »" arret "$OK_SET" "$OP"
base "insert into pennylane_rattachements(pennylane_id, show_id, invoice_number) values ('99990033', null, 'F-AB-2026-11-33')"; cas "facture 33 dans l'historique des rattachements" arret "$OK_SET" "$OP"
base "insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('99990107', null, 'F-AB-2026-11-107', 228.99, 'essai')"; cas "autre facture n° 107 signalée" arret "$OK_SET" "$OP"
base "insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('99990250', '$SH', 'F-AB-2026-11-250', 228.99, 'essai')"; cas "autre facture Pennylane de la date signalée" arret "$OK_SET" "$OP"
base "insert into show_payments(show_id, kind, label, amount, pennylane_id, invoice_number, sort) values ('$SH', 'autre', 'Frais', 50, '99990051', 'F-AB-2026-11-51', 5)"; cas "autre facture Pennylane reliée sur la date" arret "$OK_SET" "$OP"
base "$AUTRE update show_payments set invoice_number = 'f ab 2026 11 107' where show_id = '$OTH' and kind = 'acompte';"; cas "n° 107 ailleurs (normalisé)" arret "$OK_SET" "$OP"
base "update show_payments set pennylane_url = 'https://autre' where id = '$AC'"; cas "acompte avec un lien Pennylane" arret "$OK_SET" "$OP"
base "insert into finance_log(table_name,row_id,show_id,op,field,old_value,new_value,actor,source) values ('show_payments','$SO','$SH','UPDATE','amount','228.99','228.99','production@lartboristerie.com','application / fonction serveur')"
cas "montant du solde retouché par l'équipe (journal)" arret "$OK_SET" "$OP"
base; cas "opérateur en majuscules et espaces" ok "set operation.confirmation = '107-est-l-acompte'; set operation.operateur = '  Anthony@LartBoristerie.com ';" "$OP" "select (select actor from pennylane_rattachements limit 1) = 'anthony@lartboristerie.com'"
base; cas "confirmation presque juste" arret "set operation.confirmation = '107-est-l-acompte '; set operation.operateur = 'anthony@lartboristerie.com';" "$OP"
# 6 ter (relecture de 3dd83dd, B2) : retour arrière refusé dès qu'une colonne suivie a changé depuis l'opération
for m in "update show_payments set reminded_at = '2026-11-16' where id = '$AC'" \
         "update show_payments set drive_file_id = 'DRIVE-ACOMPTE-107' where id = '$AC'" \
         "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); update show_payments set pennylane_url = 'https://nouveau' where id = '$AC'" \
         "update show_payments set vat_rate = 5.5 where id = '$SO'" \
         "update show_payments set reminded_at = '2026-11-20' where id = '$SO'" \
         "update shows set fee_ht = 600 where id = '$SH'"; do
  base; lancer "$OK_SET" "$OP" >/dev/null; $Q -c "$m" >/dev/null
  cas "retour arrière refusé après : ${m:0:70}" arret "$RB_SET" "$RB"
done
# PDF Drive et relance rangés sur le solde avant l'opération : suivent la facture, retour exact
base "update show_payments set drive_file_id = 'DRIVE-SOLDE', reminded_at = '2026-11-07' where id = '$SO'"; AV12=$(lignes)
cas "PDF Drive rangé sur le solde : suit la facture" ok "$OK_SET" "$OP" "select drive_file_id = 'DRIVE-SOLDE' and reminded_at = '2026-11-07' from show_payments where id = '$AC'"
cas "retour arrière avec Drive et relance" ok "$RB_SET" "$RB"
[ "$(lignes)" = "$AV12" ] && echo "OK     retour exact avec Drive et relance" || { echo "ÉCHEC  retour exact avec Drive et relance : $(lignes)"; ECHECS=$((ECHECS+1)); }
# réglages de la transaction non conservés dans la séance (set_config local)
base; S15=$( (echo "$OK_SET"; cat "$OP"; echo "select 'claims=' || coalesce(current_setting('request.jwt.claims', true), '') || ';reg=' || coalesce(current_setting('matrice.regularisation', true), '');") | psql -X -q -At -d $DB 2>/dev/null | grep '^claims=')
[ "$S15" = "claims=;reg=" ] && echo "OK     aucun réglage de transaction laissé dans la séance" || { echo "ÉCHEC  réglages laissés : $S15"; ECHECS=$((ECHECS+1)); }
# 6 quater : le n° du DEVIS D-AB-2026-11-33 n'est pas confondu avec une facture F-AB-2026-11-33 (confirmation d'Anthony du 09/11)
base "$AUTRE update show_payments set invoice_number = 'D-AB-2026-11-33' where show_id = '$OTH' and kind = 'acompte'; insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('99990034', null, 'D-AB-2026-11-33', 1, 'essai')"
cas "devis D-AB-2026-11-33 connu ailleurs : pas confondu" ok "$OK_SET" "$OP"
# 6 quinquies : contrôle en lecture seule après une nouvelle synchronisation
CTL="$R/supabase/operations/2026-11-09_brise_glace_controle_apres_synchro.sql"
base; lancer "$OK_SET" "$OP" >/dev/null; av=$(snap)
C1=$(psql -X -q -At -F'|' -d $DB -f "$CTL" | awk -F'|' '$3 != "t" {print $1}' | tr '\n' ' '); ap=$(snap)
[ -z "$C1" ] && [ "$av" = "$ap" ] && echo "OK     contrôle après synchronisation : 9/9, lecture seule" || { echo "ÉCHEC  contrôle après synchronisation : $C1"; ECHECS=$((ECHECS+1)); }
$Q -c "insert into pennylane_a_rattacher(pennylane_id, show_id, invoice_number, amount_ht, reason) values ('34170228875264', '$SH', 'F-AB-2026-11-107', 228.99, 'essai')" >/dev/null
$Q -c "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); update show_payments set invoice_number = 'F-AB-2026-11-107' where id = '$SO'" >/dev/null
C2=$(psql -X -q -At -F'|' -d $DB -f "$CTL" | awk -F'|' '$3 != "t" {print $1}' | tr '\n' ' ')
[ "$C2" = "3 5 6 8 " ] && echo "OK     contrôle après synchronisation : écarts détectés (contrôles $C2)" || { echo "ÉCHEC  contrôle après synchronisation (écarts) : $C2"; ECHECS=$((ECHECS+1)); }
base; C3=$(psql -X -q -At -F'|' -d $DB -f "$CTL" | awk -F'|' '$3 != "t" {print $1}' | tr '\n' ' ')
[ "$C3" = "1 2 3 8 " ] && echo "OK     contrôle sans opération : non conforme ($C3)" || { echo "ÉCHEC  contrôle sans opération : $C3"; ECHECS=$((ECHECS+1)); }
# 7. retour arrière refusé si le solde a été facturé après l'opération
base; lancer "$OK_SET" "$OP" >/dev/null
$Q -c "update show_payments set invoice_number = 'F-AB-2026-11-250' where id = '$SO'" >/dev/null
cas "retour arrière après une vraie facture de solde" arret "$RB_SET" "$RB"
base; cas "retour arrière sur l'état d'origine (opération jamais faite)" arret "$RB_SET" "$RB"

$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
[ $ECHECS = 0 ] && echo "ESSAI Brise Glace : tout est conforme" || { echo "ESSAI Brise Glace : $ECHECS échec(s)"; exit 1; }
