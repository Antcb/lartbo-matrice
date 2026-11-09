#!/usr/bin/env bash
# Essais de la migration 2026-11-09_v1.60.7_sauvegarde_declenchement.sql sur une BASE LOCALE JETABLE (PostgreSQL 16 nu, données fictives).
# Jamais la production ni le projet de test : le script refuse toute adresse qui n'est pas 127.0.0.1 / localhost.
# Usage : PGHOST=127.0.0.1 PGPORT=<port> PGUSER=postgres BACKUP_REPO=<clone de lartbo-matrice-backup> bash ce_fichier
#   (BACKUP_REPO : branche dev/sauvegarde-declenchement, pour outils/fenetre_connexion.sql, manifeste.sql, fenetre_etat.sql)
# Dernière ligne attendue : « BILAN : N essais réussis, 0 échec ».
set -uo pipefail
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "REFUS : base locale uniquement (PGHOST=127.0.0.1)"; exit 2;; esac
: "${BACKUP_REPO:?BACKUP_REPO manquant}"
ICI="$(cd "$(dirname "$0")" && pwd)"; RACINE="$(cd "$ICI/../.." && pwd)"
MIG="$RACINE/supabase/migrations/2026-11-09_v1.60.7_sauvegarde_declenchement.sql"
BASE=essai_sauvegarde_declenchement
export PGUSER="${PGUSER:-postgres}"
dropdb --if-exists "$BASE"; createdb "$BASE"
Q(){ psql -d "$BASE" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
F(){ psql -d "$BASE" -X -q -v ON_ERROR_STOP=1 -f "$1" > /dev/null; }
SV(){ psql "host=$PGHOST port=$PGPORT dbname=$BASE user=sauvegarde" -X -q -At -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
ok=0; ko=0
verifie(){ if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "ok : $1"; else ko=$((ko+1)); echo "ÉCHEC : $1 (attendu « $3 », obtenu « $2 »)"; fi; }
appel(){ Q "set role service_role; select public.sauvegarde_declenchement('$1', '$2'::jsonb)"; }
champ(){ python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get(sys.argv[2], ""))' "$1" "$2"; }

F "$ICI/2026-11-09_sauvegarde_declenchement_base_locale.sql"
F "$BACKUP_REPO/outils/fenetre_connexion.sql"
# fenêtre fixe placée HORS de l'heure courante (l'essai ne dépend pas de l'heure à laquelle il tourne)
Q "update private.sauvegarde_fenetre set debut = ((now() at time zone 'UTC') + interval '6 hours')::time, fin = ((now() at time zone 'UTC') + interval '7 hours')::time"

# 0. Constat du 09/11 : avant la migration, la copie du schéma privé échoue sur mailbox_owners (comme la relance de 07:49 UTC)
Q "select private.sauvegarde_ouvrir(interval '10 minutes')" > /dev/null
r=$(pg_dump "host=$PGHOST port=$PGPORT dbname=$BASE user=sauvegarde" --schema=private --exclude-table=private.import_secrets -f /dev/null 2>&1 | grep -c 'permission denied for table mailbox_owners')
verifie "avant migration : copie du schéma privé refusée sur mailbox_owners" "$r" "1"
Q "update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = now() - interval '1 second'"; Q "select private.sauvegarde_interrompre()" > /dev/null

# 1. Migration jouée deux fois (rejouable), secret tiré une seule fois
F "$MIG"; s1=$(Q "select md5(value) from private.import_secrets where key = 'sauvegarde_declenchement_secret'")
F "$MIG"; s2=$(Q "select md5(value) from private.import_secrets where key = 'sauvegarde_declenchement_secret'")
verifie "migration rejouable : secret dédié présent et jamais régénéré" "$([ -n "$s1" ] && [ "$s1" = "$s2" ] && echo oui)" "oui"
verifie "longueur du secret dédié (64)" "$(Q "select length(value) from private.import_secrets where key = 'sauvegarde_declenchement_secret'")" "64"
verifie "tâche de contrôle planifiée une seule fois" "$(Q "select count(*) || ' ' || max(schedule) from cron.job where jobname = 'sauvegarde-controle'")" "1 7 13 * * *"
verifie "tâches de la fenêtre fixe inchangées avant l'activation" "$(Q "select count(*) from cron.job where jobname in ('sauvegarde-ouverture','sauvegarde-fermeture','sauvegarde-interruption')")" "3"

# 2. Droits
verifie "navigateur (authenticated) : aucun accès" "$(Q "select has_function_privilege('authenticated', 'public.sauvegarde_declenchement(text,jsonb)', 'EXECUTE')")" "f"
verifie "anon : aucun accès" "$(Q "select has_function_privilege('anon', 'public.sauvegarde_declenchement(text,jsonb)', 'EXECUTE')")" "f"
verifie "rôle sauvegarde : ne peut pas s'ouvrir lui-même" "$(Q "select has_function_privilege('sauvegarde', 'private.sauvegarde_demarrer(text,text,integer,text,boolean,interval)', 'EXECUTE') or has_function_privilege('sauvegarde', 'public.sauvegarde_declenchement(text,jsonb)', 'EXECUTE')")" "f"
verifie "rôle sauvegarde : coffre des secrets illisible" "$(Q "select has_any_column_privilege('sauvegarde', 'private.import_secrets', 'SELECT')")" "f"
verifie "rôle sauvegarde : toutes les tables et séquences privées classées (lisibles sauf le coffre)" "$(Q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relkind in ('r', 'S') and c.relname <> 'import_secrets' and not has_table_privilege('sauvegarde', c.oid, 'SELECT')")" "0"
verifie "connexion fermée au départ" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"

# 3. Démarrage réel d'une copie complète : connexion ouverte 45 min
r=$(appel demarrer '{"type":"complete","run_id":"1001","tentative":1,"origine":"schedule","forcer":false,"duree_minutes":45}')
verifie "démarrage : état" "$(champ "$r" etat)" "demarree"; ID=$(champ "$r" id)
verifie "démarrage : connexion ouverte" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "t"
verifie "démarrage : échéance entre 44 et 46 min" "$(Q "select exceptionnelle_jusqu_a between now() + interval '44 min' and now() + interval '46 min' from private.sauvegarde_fenetre")" "t"
verifie "le rôle sauvegarde se connecte" "$(SV 'select 1')" "1"
verifie "interruption pendant la fenêtre : rien à faire" "$(Q "select private.sauvegarde_interrompre()")" "fenêtre ouverte : rien à faire"
# copie du schéma privé APRÈS la migration : mailbox_owners lisible, coffre exclu
pg_dump "host=$PGHOST port=$PGPORT dbname=$BASE user=sauvegarde" --schema=public --schema=private --exclude-table=private.import_secrets -f /tmp/essai-sauvdecl.sql 2>/tmp/essai-sauvdecl.err
verifie "après migration : copie public + private réussie" "$(wc -c < /tmp/essai-sauvdecl.err | tr -d ' ')" "0"
verifie "copie : registre des titulaires présent" "$(grep -c 'titulaire@example.com' /tmp/essai-sauvdecl.sql)" "1"
verifie "copie : aucune valeur du coffre" "$(grep -c -E 'valeur-fictive|sauvegarde_declenchement_secret.*[0-9a-f]{64}' /tmp/essai-sauvdecl.sql)" "0"
rm -f /tmp/essai-sauvdecl.sql /tmp/essai-sauvdecl.err
# présence des secrets : nom et empreinte seulement
p=$(SV "select private.sauvegarde_secrets_presence()")
verifie "présence des secrets : 3 clés listées" "$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$p")" "3"
verifie "présence des secrets : aucune valeur" "$(echo "$p" | grep -c -E 'valeur-fictive|\"value\"')" "0"
verifie "présence des secrets : empreinte de 16 caractères" "$(python3 -c 'import json,sys; print({len(x["empreinte"]) for x in json.loads(sys.argv[1])})' "$p")" "{16}"

# 4. Concurrence : une relance manuelle pendant la copie planifiée est refusée ; la même exécution qui rappelle retrouve sa ligne
r=$(appel demarrer '{"type":"complete","run_id":"1002","tentative":1,"origine":"workflow_dispatch","forcer":true}')
verifie "concurrence : relance manuelle pendant une copie en cours" "$(champ "$r" etat)" "occupee"
r=$(appel demarrer '{"type":"complete","run_id":"1001","tentative":1,"origine":"schedule","forcer":false}')
verifie "même exécution rappelée : même ligne" "$(champ "$r" id)" "$ID"
verifie "une seule exécution en cours" "$(Q "select count(*) from private.sauvegarde_executions where statut = 'en_cours'")" "1"
r=$(appel demarrer '{"type":"json","run_id":"2001","tentative":1,"origine":"schedule"}')
verifie "export JSON indépendant de la copie complète" "$(champ "$r" etat)" "demarree"; IDJ=$(champ "$r" id)
verifie "export JSON : aucune fenêtre" "$(champ "$r" fenetre_jusqu_a)" "None"

# 5. Fin (succès) : connexion refermée et session interrompue
psql "host=$PGHOST port=$PGPORT dbname=$BASE user=sauvegarde" -X -q -c 'select pg_sleep(30)' > /dev/null 2>&1 &
BG=$!; sleep 1
r=$(appel terminer "{\"id\":$ID,\"statut\":\"succes\",\"detail\":\"copie, vérification et enregistrement réussis\"}")
verifie "fin : statut enregistré" "$(champ "$r" statut)" "succes"
verifie "fin : connexion refermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
sleep 1; verifie "fin : session du rôle interrompue" "$(kill -0 $BG 2>/dev/null && echo vivante || echo interrompue)" "interrompue"
verifie "fin : le rôle ne se connecte plus" "$(SV 'select 1' | grep -c 'not permitted to log in')" "1"
r=$(appel terminer "{\"id\":$ID,\"statut\":\"echec\"}")
verifie "fin rappelée : statut définitif inchangé" "$(champ "$r" statut)" "succes"
appel terminer "{\"id\":$IDJ,\"statut\":\"succes\"}" > /dev/null

# 6. Créneaux de rattrapage : déjà faite aujourd'hui → rien ; relance manuelle forcée → nouvelle copie
r=$(appel demarrer '{"type":"complete","run_id":"1003","tentative":1,"origine":"schedule"}')
verifie "créneau suivant le même jour : déjà faite" "$(champ "$r" etat)" "deja_faite"
verifie "déjà faite : connexion toujours fermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
r=$(appel demarrer '{"type":"complete","run_id":"1004","tentative":1,"origine":"workflow_dispatch","forcer":true,"duree_minutes":60}')
verifie "relance manuelle forcée : nouvelle copie" "$(champ "$r" etat)" "demarree"; ID2=$(champ "$r" id)

# 7. Fin en ÉCHEC : connexion refermée aussi
r=$(appel terminer "{\"id\":$ID2,\"statut\":\"echec\",\"detail\":\"copie échouée\"}")
verifie "échec : statut" "$(champ "$r" statut)" "echec"
verifie "échec : connexion refermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"

# 8. Durée plafonnée à 45 min (appel direct et par la fonction publique, au-delà de ce que la fonction serveur accepte)
Q "select private.sauvegarde_demarrer('complete', '1005', 1, 'workflow_dispatch', true, interval '5 hours')" > /dev/null
verifie "durée plafonnée à 45 min (+ 15 min de secours = 1 h)" "$(Q "select exceptionnelle_jusqu_a <= now() + interval '45 minutes' from private.sauvegarde_fenetre")" "t"
# 9. Fermeture de secours : le workflow ne rappelle jamais ; l'échéance passe ; l'interruption (15 min) referme
Q "update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = now() - interval '1 second'"
verifie "secours : interruption après l'échéance" "$(Q "select private.sauvegarde_interrompre() like 'connexion fermée%'")" "t"
verifie "secours : connexion fermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
# 10. Verrou périmé (exécuteur perdu) : libéré après 3 h
Q "update private.sauvegarde_executions set debut = now() - interval '4 hours' where run_id = '1005'"
Q "select private.sauvegarde_interrompre()" > /dev/null
verifie "verrou périmé : abandon" "$(Q "select statut from private.sauvegarde_executions where run_id = '1005'")" "abandon"

# 10 bis. Fin rejouée d'une ANCIENNE exécution pendant une autre copie : la fenêtre de la copie en cours reste ouverte
Q "update private.sauvegarde_executions set statut = 'echec', fin = now() where statut = 'en_cours'"
r=$(appel demarrer '{"type":"complete","run_id":"1100","tentative":1,"origine":"workflow_dispatch","forcer":true}'); IA=$(champ "$r" id)
appel terminer "{\"id\":$IA,\"statut\":\"echec\"}" > /dev/null
r=$(appel demarrer '{"type":"complete","run_id":"1101","tentative":1,"origine":"workflow_dispatch","forcer":true}'); IB=$(champ "$r" id)
r=$(appel terminer "{\"id\":$IA,\"statut\":\"echec\"}")
verifie "fin rejouée d'une ancienne exécution : non titulaire" "$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["fermeture"]["etat"])' "$r")" "non_titulaire"
verifie "fin rejouée : connexion de la copie en cours gardée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "t"
# même exécution rappelée APRÈS sa fermeture : aucune réouverture
appel fermer "{\"id\":$IB}" > /dev/null
r=$(appel demarrer '{"type":"complete","run_id":"1101","tentative":1,"origine":"workflow_dispatch","forcer":true}')
verifie "même exécution rappelée après fermeture : même ligne" "$(champ "$r" id)" "$IB"
verifie "même exécution rappelée après fermeture : connexion toujours fermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
appel terminer "{\"id\":$IB,\"statut\":\"echec\"}" > /dev/null
# ouverture MANUELLE pendant une copie : la fin de la copie ne referme pas la fenêtre ouverte à la main
r=$(appel demarrer '{"type":"complete","run_id":"1102","tentative":1,"origine":"workflow_dispatch","forcer":true}'); IM=$(champ "$r" id)
Q "select private.sauvegarde_ouvrir(interval '20 minutes')" > /dev/null
r=$(appel terminer "{\"id\":$IM,\"statut\":\"succes\"}")
verifie "ouverture manuelle pendant une copie : fin de copie non titulaire" "$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["fermeture"]["etat"])' "$r")" "non_titulaire"
verifie "ouverture manuelle : connexion gardée jusqu'à son échéance" "$(Q "select rolcanlogin and exceptionnelle_jusqu_a > now() + interval '15 minutes' from pg_roles, private.sauvegarde_fenetre where rolname = 'sauvegarde'")" "t"
Q "update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = now() - interval '1 second'"; Q "select private.sauvegarde_interrompre()" > /dev/null
verifie "ouverture manuelle : refermée par l'interruption à l'échéance" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
# limite : 6 démarrages par type et par jour
n=$(Q "select count(*) from private.sauvegarde_executions where type = 'complete' and jour = (now() at time zone 'UTC')::date")
for i in $(seq "$n" 5); do r=$(appel demarrer "{\"type\":\"complete\",\"run_id\":\"12$i\",\"tentative\":1,\"origine\":\"workflow_dispatch\",\"forcer\":true}"); appel terminer "{\"id\":$(champ "$r" id),\"statut\":\"echec\"}" > /dev/null; done
r=$(appel demarrer '{"type":"complete","run_id":"1199","tentative":1,"origine":"workflow_dispatch","forcer":true}')
verifie "7e démarrage du jour : limite" "$(champ "$r" etat)" "limite"
verifie "limite : connexion fermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
# les essais suivants reprennent sur des exécutions d'un autre jour (la limite est quotidienne)
Q "update private.sauvegarde_executions set jour = jour - 2, debut = debut - interval '2 days', fin = fin - interval '2 days'"

# 11. Avant l'activation : la fenêtre FIXE reste maîtresse (fin d'une copie pendant la fenêtre fixe = connexion gardée)
Q "update private.sauvegarde_fenetre set debut = ((now() at time zone 'UTC') - interval '1 hour')::time, fin = ((now() at time zone 'UTC') + interval '1 hour')::time"
Q "alter role sauvegarde login"
r=$(appel demarrer '{"type":"complete","run_id":"1006","tentative":1,"origine":"workflow_dispatch","forcer":true}'); ID3=$(champ "$r" id)
appel terminer "{\"id\":$ID3,\"statut\":\"succes\"}" > /dev/null
verifie "transition : fenêtre fixe en cours, connexion gardée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "t"

# 12. Activation (opération) : refusée pendant la fenêtre fixe, sans fermeture enregistrée, connexion ouverte ; puis acceptée
ACT="$RACINE/supabase/operations/2026-11-09_sauvegarde_activation.sql"
refus(){ psql -d "$BASE" -X -q -v ON_ERROR_STOP=1 -f "$ACT" 2>&1 | grep -o 'Activation refusée : [^(]*' | head -1 | sed 's/ *$//'; }
verifie "activation refusée pendant la fenêtre fixe" "$(refus | grep -c 'à lancer HORS de la fenêtre fixe')" "1"
Q "update private.sauvegarde_fenetre set debut = ((now() at time zone 'UTC') + interval '6 hours')::time, fin = ((now() at time zone 'UTC') + interval '7 hours')::time"
Q "alter role sauvegarde login"
verifie "activation refusée si la connexion est encore ouverte hors fenêtre" "$(refus | grep -c 'connexion du rôle sauvegarde est encore ouverte')" "1"
Q "select private.sauvegarde_interrompre()" > /dev/null
Q "update private.sauvegarde_executions set fermeture_titulaire = null where type = 'complete' and statut = 'succes'"
verifie "activation refusée sans fermeture enregistrée" "$(refus | grep -c 'fermeture a été enregistrée')" "1"
Q "update private.sauvegarde_executions set fermeture_titulaire = fin where type = 'complete' and statut = 'succes'"
# opération lancée SANS arrêt sur erreur, pendant la fenêtre fixe (garde déclenchée) : une seule transaction → rien n'est changé
Q "update private.sauvegarde_fenetre set debut = ((now() at time zone 'UTC') - interval '1 hour')::time, fin = ((now() at time zone 'UTC') + interval '1 hour')::time"
psql -d "$BASE" -X -q -f "$RACINE/supabase/operations/2026-11-09_sauvegarde_activation.sql" > /dev/null 2>&1
verifie "opération sans arrêt sur erreur, garde déclenchée : rien n'est changé" "$(Q "select debut <> fin from private.sauvegarde_fenetre")|$(Q "select count(*) from cron.job where jobname in ('sauvegarde-ouverture','sauvegarde-fermeture')")" "t|2"
psql -d "$BASE" -X -q -c "$(cat "$RACINE/supabase/operations/2026-11-09_sauvegarde_activation.sql")" > /dev/null 2>&1
verifie "opération envoyée en une requête, garde déclenchée : rien n'est changé" "$(Q "select debut <> fin from private.sauvegarde_fenetre")|$(Q "select count(*) from cron.job where jobname in ('sauvegarde-ouverture','sauvegarde-fermeture')")" "t|2"
Q "update private.sauvegarde_fenetre set debut = ((now() at time zone 'UTC') + interval '6 hours')::time, fin = ((now() at time zone 'UTC') + interval '7 hours')::time"
verifie "fenêtre fixe intacte après les refus" "$(Q "select debut <> fin from private.sauvegarde_fenetre")|$(Q "select count(*) from cron.job where jobname in ('sauvegarde-ouverture','sauvegarde-fermeture')")" "t|2"
F "$ACT"
verifie "activation : tâches restantes" "$(Q "select string_agg(jobname, ',' order by jobname) from cron.job where jobname like 'sauvegarde-%'")" "sauvegarde-controle,sauvegarde-interruption"
verifie "activation : connexion fermée" "$(Q "select rolcanlogin from pg_roles where rolname = 'sauvegarde'")" "f"
etat=$(SV "select 1" >/dev/null; Q "select private.sauvegarde_ouvrir(interval '5 minutes')" >/dev/null; psql "host=$PGHOST port=$PGPORT dbname=$BASE user=sauvegarde" -X -At -F '|' -f "$BACKUP_REPO/outils/fenetre_etat.sql" 2>&1 | cut -d'|' -f1)
verifie "état de la fenêtre après activation (outils/fenetre_etat.sql)" "$etat" "OK"
Q "update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = now() - interval '1 second'"; Q "select private.sauvegarde_interrompre()" > /dev/null

# 12 bis. Découpage quotidien en UTC, quel que soit le fuseau de la session (Paris, ou UTC+14)
Q "update private.sauvegarde_executions set jour = jour - 5, debut = debut - interval '5 days', fin = fin - interval '5 days'"
r=$(Q "set timezone = 'Pacific/Kiritimati'; set role service_role; select public.sauvegarde_declenchement('demarrer', '{\"type\":\"json\",\"run_id\":\"3001\",\"tentative\":1,\"origine\":\"workflow_dispatch\",\"forcer\":true}'::jsonb)")
verifie "jour de l'exécution = date UTC du démarrage réel (session UTC+14)" "$(Q "select jour = (now() at time zone 'UTC')::date from private.sauvegarde_executions where run_id = '3001'")" "t"
appel terminer "{\"id\":$(champ "$r" id),\"statut\":\"echec\"}" > /dev/null
# exécution démarrée la veille (UTC) et finie après minuit : compte pour la veille ; le premier créneau du jour refait une copie
Q "insert into private.sauvegarde_executions (type, jour, run_id, tentative, origine, debut, fin, statut) values ('complete', (now() at time zone 'UTC')::date - 1, '3002', 1, 'schedule', now() - interval '1 day', now() - interval '1 minute', 'succes')"
r=$(appel demarrer '{"type":"complete","run_id":"3003","tentative":1,"origine":"schedule"}')
verifie "réussite démarrée la veille : le créneau du jour copie quand même" "$(champ "$r" etat)" "demarree"
appel terminer "{\"id\":$(champ "$r" id),\"statut\":\"succes\"}" > /dev/null
r=$(appel demarrer '{"type":"complete","run_id":"3004","tentative":1,"origine":"schedule"}')
verifie "créneau suivant du même jour UTC : déjà faite (aucune copie en double)" "$(champ "$r" etat)" "deja_faite"

# 13. Contrôle d'absence : aucune réussite aujourd'hui → une notification par type (sans doublon) ; réussite → aucune
verifie "surveillance armée par la migration, délai de grâce de 24 h" "$(Q "select private.sauvegarde_controler() like 'délai de grâce jusqu''à %'")" "t"
Q "update private.sauvegarde_surveillance set depuis = now() - interval '2 days'"
Q "update private.sauvegarde_executions set jour = jour - 1, debut = debut - interval '1 day', fin = fin - interval '1 day'"
verifie "contrôle : 2 alertes (complète et JSON)" "$(Q "select private.sauvegarde_controler()")" "2 alerte(s)"
verifie "contrôle rejoué : aucun doublon" "$(Q "select private.sauvegarde_controler()")" "0 alerte(s)"
verifie "contrôle : notification lisible" "$(Q "select count(*) from public.notifications where kind = 'sauvegarde' and title = 'Sauvegarde complète : aucune réussite aujourd''hui' and body like 'dernière réussite : %'")" "1"
Q "delete from public.notifications where kind = 'sauvegarde'"
r=$(appel demarrer '{"type":"json","run_id":"2002","tentative":1,"origine":"schedule"}'); appel terminer "{\"id\":$(champ "$r" id),\"statut\":\"succes\"}" > /dev/null
verifie "contrôle : JSON réussi aujourd'hui, seule la complète alerte" "$(Q "select private.sauvegarde_controler()")|$(Q "select string_agg(dedupe_key, ',') from public.notifications where kind = 'sauvegarde'" | cut -d: -f2)" "1 alerte(s)|complete"
# 13 bis. Alerte INDÉPENDANTE de GitHub : aucune exécution depuis 3 jours (GitHub n'a rien lancé), seule la tâche pg_cron agit
Q "delete from public.notifications where kind = 'sauvegarde'"
Q "update private.sauvegarde_executions set jour = jour - 3, debut = debut - interval '3 days', fin = fin - interval '3 days'"
verifie "tâche pg_cron du contrôle : commande et horaire" "$(Q "select schedule || ' | ' || command || ' | ' || active from cron.job where jobname = 'sauvegarde-controle'")" "7 13 * * * | select private.sauvegarde_controler() | true"
verifie "aucun lancement GitHub depuis 3 jours : alerte complète ET JSON" "$(Q "select private.sauvegarde_controler()")" "2 alerte(s)"
verifie "le contrôle ne lit que la base (aucun appel extérieur)" "$(Q "select prosrc !~* '(https?://|net\.http|http_(get|post)|pg_net)' from pg_proc where proname = 'sauvegarde_controler'")" "t"

# 13 ter. Coupure de l'alerte (première étape de tout retour arrière), puis réarmement par la migration
F "$RACINE/supabase/retours-arriere/2026-11-09_sauvegarde_alerte_coupure.sql"
verifie "coupure : surveillance inactive, tâche retirée" "$(Q "select active from private.sauvegarde_surveillance")|$(Q "select count(*) from cron.job where jobname = 'sauvegarde-controle'")" "f|0"
verifie "coupure : le contrôle ne notifie plus" "$(Q "select private.sauvegarde_controler()")" "surveillance coupée"
F "$MIG"
verifie "migration rejouée : surveillance réarmée, nouveau délai de grâce, tâche replanifiée" "$(Q "select active and depuis > now() - interval '1 minute' from private.sauvegarde_surveillance")|$(Q "select count(*) from cron.job where jobname = 'sauvegarde-controle'")" "t|1"
d1=$(Q "select depuis from private.sauvegarde_surveillance"); sleep 1; F "$MIG"
verifie "migration rejouée pendant que la surveillance est active : date de mise en place inchangée" "$(Q "select depuis from private.sauvegarde_surveillance")" "$d1"

# 13 quater. Après une restauration : nouvelles clés (dépôt de sauvegarde, outils/regenerer_cles.sql), jamais affichées
av=$(Q "select string_agg(key || ':' || md5(value), ',' order by key) from private.import_secrets where key in ('mailbox_sign_key','sauvegarde_declenchement_secret')")
psql -d "$BASE" -X -q -At -v ON_ERROR_STOP=1 -f "$BACKUP_REPO/outils/regenerer_cles.sql" > /tmp/essai-cles-refus.txt 2>&1
verifie "nouvelles clés SANS « set operation.restauration » : refus, rien de changé" "$(grep -c 'Refus : nouvelles clés seulement sur une base RESTAURÉE' /tmp/essai-cles-refus.txt)|$(Q "select string_agg(key || ':' || md5(value), ',' order by key) from private.import_secrets where key in ('mailbox_sign_key','sauvegarde_declenchement_secret')")" "1|$av"
psql -d "$BASE" -X -q -At -f "$BACKUP_REPO/outils/regenerer_cles.sql" > /dev/null 2>&1   # sans arrêt sur erreur : la transaction annule tout
verifie "nouvelles clés, refus sans arrêt sur erreur : rien de changé" "$(Q "select string_agg(key || ':' || md5(value), ',' order by key) from private.import_secrets where key in ('mailbox_sign_key','sauvegarde_declenchement_secret')")" "$av"
rm -f /tmp/essai-cles-refus.txt
sortie_cles=$(psql -d "$BASE" -X -q -At -F '|' -v ON_ERROR_STOP=1 -c "set operation.restauration = 'oui'" -f "$BACKUP_REPO/outils/regenerer_cles.sql")
ap=$(Q "select string_agg(key || ':' || md5(value), ',' order by key) from private.import_secrets where key in ('mailbox_sign_key','sauvegarde_declenchement_secret')")
verifie "nouvelles clés : les deux valeurs ont changé" "$(python3 -c 'import sys; a=dict(x.split(":") for x in sys.argv[1].split(",")); b=dict(x.split(":") for x in sys.argv[2].split(",")); print(len(b) == 2 and all(a[k] != b[k] for k in b))' "$av" "$ap")" "True"
verifie "nouvelles clés : sortie = nom | 64 | empreinte de 16 caractères, rien d'autre" "$(echo "$sortie_cles" | grep -cE '^(mailbox_sign_key|sauvegarde_declenchement_secret)\|64\|[0-9a-f]{16}$')|$(echo "$sortie_cles" | grep -c '')" "2|2"
verifie "nouvelles clés : aucune valeur affichée" "$(for k in mailbox_sign_key sauvegarde_declenchement_secret; do v=$(Q "select value from private.import_secrets where key = '$k'"); echo "$sortie_cles" | grep -c "$v"; done | paste -sd+ | bc)" "0"
verifie "nouvelles clés : mail_sync_hook non créée sans messagerie" "$(Q "select count(*) from private.import_secrets where key = 'mail_sync_hook'")" "0"

# 14. Retour arrière (alerte coupée, fonctions retirées, journal gardé), puis migration rejouée
F "$RACINE/supabase/retours-arriere/2026-11-09_sauvegarde_declenchement_retour_arriere.sql"
verifie "retour arrière : fonctions retirées, journal gardé" "$(Q "select to_regprocedure('public.sauvegarde_declenchement(text,jsonb)') is null and to_regclass('private.sauvegarde_executions') is not null")" "t"
F "$MIG"
verifie "migration rejouée après retour arrière" "$(Q "select to_regprocedure('public.sauvegarde_declenchement(text,jsonb)') is not null")" "t"

# 15. Base NEUVE : surveillance armée dès la migration, sans AUCUNE exécution ; échec de la première sauvegarde signalé tout de suite
B2="${BASE}_neuve"; dropdb --if-exists "$B2"; createdb "$B2"
Q2(){ psql -d "$B2" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
for f in "$ICI/2026-11-09_sauvegarde_declenchement_base_locale.sql" "$BACKUP_REPO/outils/fenetre_connexion.sql" "$MIG"; do psql -d "$B2" -X -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null; done
verifie "base neuve : surveillance armée par la migration (active, tâche pg_cron)" "$(Q2 "select active from private.sauvegarde_surveillance")|$(Q2 "select count(*) from cron.job where jobname = 'sauvegarde-controle'")" "t|1"
Q2 "update private.sauvegarde_surveillance set depuis = now() - interval '25 hours'"
verifie "journal VIDE (aucune exécution jamais enregistrée) après le délai : alerte complète ET JSON" "$(Q2 "select private.sauvegarde_controler()")" "2 alerte(s)"
verifie "alerte : mise en place indiquée" "$(Q2 "select count(*) from public.notifications where body like '%aucune enregistrée depuis la mise en place%'")" "2"
r=$(Q2 "set role service_role; select public.sauvegarde_declenchement('demarrer', '{\"type\":\"complete\",\"run_id\":\"1\",\"tentative\":1,\"origine\":\"schedule\"}'::jsonb)")
Q2 "set role service_role; select public.sauvegarde_declenchement('terminer', '{\"id\":$(champ "$r" id),\"statut\":\"echec\",\"detail\":\"copie : failure\"}'::jsonb)" > /dev/null
verifie "première sauvegarde en échec : notifiée tout de suite" "$(Q2 "select title from public.notifications where dedupe_key = 'sauvegarde:echec:$(champ "$r" id)'")" "Sauvegarde complète : échec"
verifie "première sauvegarde en échec : alerte du jour toujours due (pas de réussite)" "$(Q2 "delete from public.notifications; select private.sauvegarde_controler()" | tail -1)" "2 alerte(s)"
# fermeture par le SECOURS seulement : ne compte pas comme fermeture de la copie (garde de l'activation)
r=$(Q2 "set role service_role; select public.sauvegarde_declenchement('demarrer', '{\"type\":\"complete\",\"run_id\":\"2\",\"tentative\":1,\"origine\":\"workflow_dispatch\",\"forcer\":true}'::jsonb)")
Q2 "update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = now() - interval '1 second'"; Q2 "select private.sauvegarde_interrompre()" > /dev/null
Q2 "set role service_role; select public.sauvegarde_declenchement('terminer', '{\"id\":$(champ "$r" id),\"statut\":\"succes\"}'::jsonb)" > /dev/null
verifie "fermée par le secours seulement : aucune fermeture titulaire enregistrée" "$(Q2 "select fermeture_titulaire is null from private.sauvegarde_executions where id = $(champ "$r" id)")" "t"
verifie "activation refusée (fermeture par le secours seulement)" "$(psql -d "$B2" -X -q -v ON_ERROR_STOP=1 -f "$RACINE/supabase/operations/2026-11-09_sauvegarde_activation.sql" 2>&1 | grep -c 'fermeture a été enregistrée par la copie elle-même')" "1"
dropdb "$B2"

kill $BG 2>/dev/null; dropdb "$BASE"
echo "BILAN : $ok essais réussis, $ko échec"
[ "$ko" = 0 ]
