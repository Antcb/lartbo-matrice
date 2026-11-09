#!/usr/bin/env bash
# Essai des déclencheurs Brevo des rattachements, des fonctions et du marqueur « hors prospection » (migration 2026-11-08_brevo_rattachements.sql) sur une base PostgreSQL JETABLE :
# créée dans un dossier temporaire, sur un port propre (BREVO_PG_PORT, 55741 par défaut), arrêtée et effacée à la fin.
# Aucune connexion à Supabase ni à Brevo : brevo_queue est remplacée par une fonction qui note les appels dans une table.
# Hors de « npm test » (il faut les programmes PostgreSQL 14 ou plus : initdb, pg_ctl, psql). Lancement : bash tests/outils/brevo-declencheurs-pg.sh
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
MIG="${BREVO_MIG:-$ICI/../../supabase/migrations/2026-11-08_brevo_rattachements.sql}"
PORT="${BREVO_PG_PORT:-55741}"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$BIN/initdb" ] || { echo "PostgreSQL introuvable (PG_BIN) : essai non lancé"; exit 2; }
D="$(mktemp -d)"; chmod 755 "$D"
QUI=(); if [ "$(id -u)" = 0 ]; then chown postgres "$D"; QUI=(runuser -u postgres --); fi
fin() { "${QUI[@]}" "$BIN/pg_ctl" -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"; }
trap fin EXIT
"${QUI[@]}" "$BIN/initdb" -D "$D/data" -A trust >/dev/null
"${QUI[@]}" "$BIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
P=("${QUI[@]}" "$BIN/psql" -h "$D" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

# État de la production avant la migration (v1.16 / v1.32) : déclencheur ligne par ligne, à l'ajout seulement
"${P[@]}" <<'SQL'
create role anon; create role authenticated; create role service_role bypassrls;   -- comme Supabase : le rôle serveur ignore la RLS
create table contacts(id uuid primary key, email text, email_2 text, first_name text, last_name text);
create table structures(id uuid primary key, name text, inactive_at timestamptz);
create table contact_structures(contact_id uuid references contacts(id) on delete cascade,
  structure_id uuid references structures(id) on delete cascade, role text, primary key(contact_id, structure_id));
create table appels(n serial, contact uuid);
-- fonctions existantes en production (is_team : RLS ; finance_actor : v1.42, auteur d'après la session)
create function is_team() returns boolean language sql as $$ select true $$;
create table settings(key text primary key, value jsonb);
create function setting_text(k text) returns text language sql stable as $$ select value #>> '{}' from settings where key = k $$;
create or replace function public.brevo_key_status() returns boolean language sql stable security definer set search_path = public as $$
  select case when not public.is_team() then null else coalesce(btrim(public.setting_text('brevo_api_key')), '') <> '' end $$;
create or replace function public.finance_actor() returns text language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text) $$;
create function brevo_queue(p_contact uuid) returns void language sql as $$ insert into appels(contact) values (p_contact) $$;
create or replace function public.brevo_contact_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'contacts' then
    if (new.email is not null or new.email_2 is not null) and (tg_op = 'INSERT'
       or new.email is distinct from old.email or new.email_2 is distinct from old.email_2
       or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name) then
      perform brevo_queue(new.id);
    end if;
  else
    perform brevo_queue(new.contact_id);
  end if;
  return new;
end $$;
create trigger brevo_contacts after insert or update of email, email_2, first_name, last_name on contacts for each row execute function brevo_contact_trg();
create trigger brevo_contact_structures after insert on contact_structures for each row execute function brevo_contact_trg();
-- v1.60.2 : réactivation d'une structure
create or replace function public.brevo_structure_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if old.inactive_at is not null and new.inactive_at is null then
    for c in select l.contact_id from contact_structures l join contacts k on k.id = l.contact_id
             where l.structure_id = new.id and (k.email is not null or k.email_2 is not null) loop
      perform brevo_queue(c);
    end loop;
  end if;
  return new;
end $$;
create trigger brevo_structure_reactivated after update of inactive_at on structures for each row execute function brevo_structure_trg();
SQL
"${P[@]}" < "$MIG"
"${P[@]}" < "$MIG"   # rejouable

"${P[@]}" -o /dev/null <<'SQL'
create function u(i int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid $$;
create function verifie(cas text, attendu text) returns void language plpgsql as $$
declare obtenu text;
begin
  select coalesce(string_agg(right(contact::text, 4) || '×' || nb, ',' order by right(contact::text, 4)), '') into obtenu
    from (select contact, count(*) nb from appels group by contact) a;
  if obtenu is distinct from attendu then raise exception 'ÉCHEC « % » : attendu [%], obtenu [%]', cas, attendu, obtenu; end if;
  raise notice 'ok : %', cas;
  truncate appels;
end $$;
-- contacts 1 à 40 avec mail, 41 sans mail ; structures 101 à 150
insert into contacts(id, email) select u(i), 'c' || i || '@x.invalid' from generate_series(1, 40) i;
insert into contacts(id) values (u(41));
insert into structures(id, name) select u(i), 'S' || i from generate_series(101, 150) i;
truncate appels;

insert into contact_structures(contact_id, structure_id) select u(1), u(i) from generate_series(101, 150) i;
select verifie('ajout de 50 rattachements d’un contact en une requête : 1 appel', '0001×1');
insert into contact_structures(contact_id, structure_id) select u(i), u(101) from generate_series(2, 41) i;
select verifie('rattachement de 40 contacts (dont 1 sans mail) : 1 appel par contact avec mail', (select string_agg(right(u(i)::text, 4) || '×1', ',' order by right(u(i)::text, 4)) from generate_series(2, 40) i));
update contact_structures set role = 'Programmatrice' where contact_id = u(1);
select verifie('fonction modifiée sur 50 rattachements : 1 appel (FONCTIONS, décision du 08/11)', '0001×1');
update contact_structures set role = role, structure_id = structure_id where contact_id = u(1);
select verifie('fonction et structure réécrites à l’identique : aucun appel', '');
update contact_structures set structure_id = u(150) where contact_id = u(2) and structure_id = u(101);
select verifie('rattachement déplacé vers une autre structure : 1 appel', '0002×1');
update contact_structures set contact_id = u(3) where contact_id = u(2) and structure_id = u(150);
select verifie('rattachement déplacé vers un autre contact : les deux contacts, 1 fois chacun', '0002×1,0003×1');
delete from contact_structures where contact_id = u(1) and structure_id <> u(101);
select verifie('retrait de 49 rattachements d’un contact en une requête : 1 appel', '0001×1');
delete from structures where id = u(101);
select verifie('suppression d’une structure rattachée à 40 contacts (dont 1 sans mail) : 1 appel par contact avec mail', (select string_agg(right(u(i)::text, 4) || '×1', ',' order by right(u(i)::text, 4)) from generate_series(1, 40) i where i <> 2));
insert into contact_structures(contact_id, structure_id) values (u(5), u(102)), (u(5), u(103));
truncate appels;
delete from contacts where id = u(5);
select verifie('contact supprimé (rattachements en cascade) : aucun appel', '');
-- ───── Option B (08/11) : marqueur hors_prospection_at ─────
-- structures 201 (inactive), 202 (inactive), 203 (active), 204 (inactive) ; contacts 61 à 66 avec mail
insert into structures(id, name, inactive_at) values (u(201), 'Fermée A', now()), (u(202), 'Fermée B', now()), (u(203), 'Ouverte', null), (u(204), 'Fermée C', now());
insert into contacts(id, email) select u(i), 'm' || i || '@x.invalid' from generate_series(61, 67) i;
insert into contact_structures(contact_id, structure_id) values
  (u(61), u(201)),                      -- seulement une structure inactive : retrait → marqué
  (u(62), u(201)), (u(62), u(203)),     -- inactive + active : retrait de l'active → pas marqué (v1.60.2 le tient déjà) ; puis de l'inactive → marqué
  (u(63), u(202)),                      -- structure inactive supprimée → marqué
  (u(64), u(203)),                      -- structure active : retrait → pas marqué
  (u(65), u(201)), (u(65), u(202)),     -- deux inactives retirées en une requête → marqué
  (u(66), u(204));                      -- structure inactive réactivée : relancé, jamais marqué
truncate appels;
create function marques() returns text language sql as $$
  select coalesce(string_agg(right(id::text, 4), ',' order by id), '') from contacts where hors_prospection_at is not null $$;
create function verifie_marques(cas text, attendu text) returns void language plpgsql as $$
begin
  if marques() is distinct from attendu then raise exception 'ÉCHEC « % » : marqués attendus [%], obtenus [%]', cas, attendu, marques(); end if;
  raise notice 'ok : %', cas;
end $$;
select verifie_marques('aucun contact marqué au départ (rien n’est rempli pour l’historique)', '');
delete from contact_structures where contact_id = u(61);
select verifie_marques('retrait de la seule structure inactive : marqué', '0061');
select verifie('… et relancé une fois', '0061×1');
delete from contact_structures where contact_id = u(62) and structure_id = u(203);
select verifie_marques('retrait de la structure active (reste une inactive) : pas marqué', '0061');
delete from contact_structures where contact_id = u(62);
select verifie_marques('puis retrait de la dernière, inactive : marqué', '0061,0062');
delete from structures where id = u(202);
select verifie_marques('suppression d’une structure inactive : ses contacts uniquement inactifs marqués', '0061,0062,0063,0065');
truncate appels;
delete from contact_structures where contact_id = u(64);
select verifie_marques('retrait d’une structure active : pas marqué', '0061,0062,0063,0065');
insert into contacts(id, email) values (u(68), 'n68@x.invalid');
select verifie_marques('contact créé sans structure : pas marqué', '0061,0062,0063,0065');
insert into contact_structures(contact_id, structure_id) values (u(61), u(204));
select verifie_marques('rattaché à une structure INACTIVE : reste marqué', '0061,0062,0063,0065');
insert into contact_structures(contact_id, structure_id) values (u(62), u(203));
select verifie_marques('rattaché à une structure active : marqueur effacé', '0061,0063,0065');
truncate appels;
update structures set inactive_at = null where id = u(204);
select verifie_marques('réactivation d’une structure : marqueur de ses contacts effacé (61, rattaché à elle)', '0063,0065');
select verifie('… et ses contacts relancés (61, 66)', '0061×1,0066×1');
update contact_structures set role = 'Régie' where contact_id = u(65);
select verifie_marques('fonction changée : marqueur inchangé', '0063,0065');
truncate appels;
-- ───── Décisions du 09/11 : exclusion MANUELLE, journal, garde ─────
grant usage on schema public to authenticated; grant select, insert, update on contacts to authenticated;
create function hist(i int) returns text language sql as $$
  select coalesce(string_agg(e->>'action' || '/' || (e->>'origine') || '/' || (e->>'par'), ',' order by ord), '')
    from contacts, jsonb_array_elements(prospection_history) with ordinality as h(e, ord) where id = u(i) $$;
create function exclus() returns text language sql as $$
  select coalesce(string_agg(right(id::text, 4), ',' order by id), '') from contacts where prospection_exclue_at is not null $$;
create function attendu(cas text, obtenu text, voulu text) returns void language plpgsql as $$
begin
  if obtenu is distinct from voulu then raise exception 'ÉCHEC « % » : attendu [%], obtenu [%]', cas, voulu, obtenu; end if;
  raise notice 'ok : %', cas;
end $$;
select attendu('journal automatique du contact 63 (structure inactive supprimée)', hist(63), 'exclusion/structure/automatique');
select attendu('journal automatique du contact 62 (exclu puis rattaché à une structure active)', hist(62), 'exclusion/structure/automatique,remise/structure/automatique');
-- l'équipe, connectée (rôle authenticated, adresse dans la session)
select set_config('request.jwt.claims', '{"email":"equipe@exemple.invalid","role":"authenticated"}', false);
set role authenticated;
select set_prospection(u(64), true, '  A demandé à ne plus être sollicité  ');
reset role;
select attendu('exclusion manuelle par set_prospection (équipe)', exclus(), '0064');
select attendu('… tracée : action, origine, auteur', hist(64), 'exclusion/manuelle/equipe@exemple.invalid');
select attendu('… motif nettoyé', (select prospection_history->-1->>'motif' from contacts where id = u(64)), 'A demandé à ne plus être sollicité');
select verifie('… exclure ne relance pas Brevo', '');
insert into contact_structures(contact_id, structure_id) values (u(64), u(203));
select attendu('rattachement à une structure active : l’exclusion MANUELLE reste', exclus(), '0064');
set role authenticated;
select set_prospection(u(63), true, 'Exclu aussi à la main');   -- 63 : exclusion automatique ET manuelle
reset role;
insert into contact_structures(contact_id, structure_id) values (u(63), u(203));
select attendu('… alors que l’exclusion automatique est levée', (select (hors_prospection_at is null)::text from contacts where id = u(63)), 'true');
select attendu('contact exclu des deux façons rattaché à une structure active : seule l’automatique est levée', exclus(), '0063,0064');
update structures set inactive_at = now() where id = u(203);
update structures set inactive_at = null where id = u(203);
select attendu('réactivation d’une structure : l’exclusion MANUELLE reste', exclus(), '0063,0064');
truncate appels;
set role authenticated;
do $$ begin
  begin update contacts set prospection_exclue_at = null where id = u(64); raise exception 'ÉCHEC : écriture directe acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin update contacts set hors_prospection_at = now() where id = u(68); raise exception 'ÉCHEC : écriture directe acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin update contacts set prospection_history = '[]' where id = u(64); raise exception 'ÉCHEC : écriture directe acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin insert into contacts(id, email, prospection_exclue_at) values (u(90), 'z@x.invalid', now()); raise exception 'ÉCHEC : écriture directe acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  update contacts set first_name = 'Autorisé' where id = u(64);   -- les autres colonnes restent modifiables
  begin perform set_prospection(u(64), true, 'encore'); raise exception 'ÉCHEC : double exclusion acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin perform set_prospection(u(64), false, '   '); raise exception 'ÉCHEC : motif vide accepté';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin perform set_prospection(u(67), false, 'rien à lever'); raise exception 'ÉCHEC : remise d’un contact non exclu acceptée';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  raise notice 'ok : écritures directes de l’API refusées (3 colonnes, insertion), autres colonnes libres ; double exclusion, motif vide, remise sans exclusion refusés';
end $$;
reset role; truncate appels; set role authenticated;   -- le prénom modifié a relancé Brevo (déclencheur brevo_contacts, normal)
select set_prospection(u(64), false, 'Erreur de saisie');
select set_prospection(u(65), false, 'Contact repris en direct');   -- 65 : exclusion automatique seulement
reset role;
-- ───── Mode essai (relecture B2) : liste blanche intouchable par l'équipe tant qu'une clé Brevo est enregistrée ─────
grant select, insert, update, delete on settings to authenticated;
insert into settings values ('brevo_api_key', to_jsonb('xkeysib-essai-fictive'::text)), ('brevo_essai_emails', to_jsonb('lea+essai@x.invalid'::text)), ('autre', to_jsonb('1'::text));
set role authenticated;
do $$ begin
  begin update settings set value = to_jsonb(''::text) where key = 'brevo_essai_emails'; raise exception 'ÉCHEC : liste blanche vidée avec une clé présente';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin delete from settings where key = 'brevo_essai_emails'; raise exception 'ÉCHEC : liste blanche supprimée avec une clé présente';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  begin update settings set value = to_jsonb('vrai.contact@x.invalid'::text) where key = 'brevo_essai_emails'; raise exception 'ÉCHEC : liste blanche élargie avec une clé présente';
  exception when raise_exception then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
  update settings set value = to_jsonb('2'::text) where key = 'autre';   -- les autres réglages restent libres
  raise notice 'ok : liste blanche ni vidée, ni supprimée, ni élargie par l’équipe tant que la clé est là ; autres réglages libres';
end $$;
reset role;
update settings set value = to_jsonb(''::text) where key = 'brevo_api_key';   -- clé vidée (set_brevo_key(''))
set role authenticated;
update settings set value = to_jsonb(''::text) where key = 'brevo_essai_emails';
reset role;
select attendu('clé vidée : la liste blanche peut être retirée', (select value #>> '{}' from settings where key = 'brevo_essai_emails'), '');
select attendu('remise en prospection : exclusion manuelle levée (63 reste exclu, non remis)', exclus(), '0063');
select attendu('… exclusion automatique levée aussi (action explicite)', (select (hors_prospection_at is null)::text from contacts where id = u(65)), 'true');
select attendu('… tracée', hist(64), 'exclusion/manuelle/equipe@exemple.invalid,remise/manuelle/equipe@exemple.invalid');
select verifie('… et Brevo relancé pour les contacts remis', '0064×1,0065×1');
select attendu('nom modifié par l’équipe', (select first_name from contacts where id = u(64)), 'Autorisé');
truncate appels;
do $$ begin
  if (select count(*) from contacts) <> 48 then raise exception 'ÉCHEC : un contact a disparu'; end if;
  if exists (select 1 from pg_trigger where tgname = 'brevo_contact_structures' and tgtype & 1 = 1) then
    raise exception 'ÉCHEC : brevo_contact_structures est encore ligne par ligne'; end if;
  raise notice 'ok : aucun autre contact supprimé ; déclencheurs par requête';
end $$;
-- ───── Décision du 09/11 : exclusion gardée par adresse après la suppression du contact ─────
grant delete on contacts to authenticated;
create function exclu(i int) returns text language sql as $$
  select concat_ws('+', case when prospection_exclue_at is not null then 'manuelle' end, case when hors_prospection_at is not null then 'auto' end) from contacts where id = u(i) $$;
create function memoire() returns text language sql as $$
  select coalesce(string_agg(email || ':' || concat_ws('+', case when exclue_manuelle_at is not null then 'manuelle' end, case when hors_auto_at is not null then 'auto' end), ',' order by email), '') from prospection_memoire $$;
insert into contacts(id, email, email_2) values (u(81), 'Mem1@Exemple.invalid', 'mem1b@exemple.invalid'), (u(82), 'mem2@exemple.invalid', null), (u(87), 'neuf@exemple.invalid', null);
insert into structures(id, name, inactive_at) values (u(301), 'Fermée M', now()), (u(302), 'Ouverte M', null);
insert into contact_structures(contact_id, structure_id) values (u(82), u(301));
delete from contact_structures where contact_id = u(82);                      -- 82 : exclusion automatique
set role authenticated;
select set_prospection(u(81), true, 'Ne plus solliciter');                      -- 81 : exclusion manuelle (2 adresses)
delete from contacts where id in (u(81), u(82));                                -- suppression par l'équipe
reset role;
select attendu('suppression de contacts exclus : adresses gardées en minuscules, avec l’origine', memoire(), 'mem1@exemple.invalid:manuelle,mem1b@exemple.invalid:manuelle,mem2@exemple.invalid:auto');
set role authenticated;
do $$ begin
  begin perform 1 from prospection_memoire; raise exception 'ÉCHEC : mémoire lisible par l’équipe';
  exception when insufficient_privilege then null; end;
  begin delete from prospection_memoire; raise exception 'ÉCHEC : mémoire modifiable par l’équipe';
  exception when insufficient_privilege then null; end;
  raise notice 'ok : mémoire ni lisible ni modifiable par l’équipe';
end $$;
insert into contacts(id, email) values (u(83), 'MEM1@exemple.INVALID');          -- même adresse, casse différente
insert into contacts(id, email, email_2) values (u(84), 'autre@exemple.invalid', 'mem1b@exemple.invalid');   -- 2e adresse mémorisée
insert into contacts(id, email) values (u(85), 'mem2@exemple.invalid');
update contacts set email = 'Mem1@exemple.invalid' where id = u(87);             -- adresse mémorisée donnée à un contact existant
reset role;
select attendu('recréé avec la même adresse (casse différente) : exclusion manuelle reprise', exclu(83), 'manuelle');
select attendu('… trace « reprise » avec la date et le dernier motif', (select prospection_history->-1->>'motif' from contacts where id = u(83)), 'Exclusion reprise d’un contact supprimé le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' : « Ne plus solliciter »');
select attendu('… une seule entrée (journal du contact supprimé non recopié)', (select jsonb_array_length(prospection_history)::text from contacts where id = u(83)), '1');
select attendu('recréé avec la 2e adresse mémorisée : exclu', exclu(84), 'manuelle');
select attendu('recréé, exclusion automatique reprise', exclu(85), 'auto');
select attendu('adresse mémorisée donnée à un contact existant : exclu', exclu(87), 'manuelle');
select attendu('contact créé avec une autre adresse : pas exclu', coalesce(exclu(68), ''), '');
insert into contact_structures(contact_id, structure_id) values (u(85), u(302));
select attendu('rattachement actif : part automatique levée (contact et mémoire), manuelle gardée', exclu(85) || ' | ' || memoire(), ' | mem1@exemple.invalid:manuelle,mem1b@exemple.invalid:manuelle');
delete from contacts where id = u(85);
insert into contacts(id, email) values (u(86), 'mem2@exemple.invalid');
select attendu('… recréé ensuite : prospectable', coalesce(exclu(86), ''), '');
set role authenticated;
select set_prospection(u(83), false, 'Revenu vers nous');
reset role;
select attendu('« Remettre en prospection » : mémoire de ses adresses effacée, tracé', (select prospection_history->-1->>'motif' from contacts where id = u(83)) || ' | ' || memoire(),
  'Revenu vers nous (mémoire d’exclusion de 1 adresse effacée) | mem1b@exemple.invalid:manuelle');
delete from contacts where id = u(83);
insert into contacts(id, email) values (u(88), 'mem1@exemple.invalid');
select attendu('… recréé ensuite : prospectable', coalesce(exclu(88), ''), '');
select attendu('87 (exclusion reprise) reste exclu tant qu’on ne le remet pas', exclu(87), 'manuelle');
-- relecture : mémoire minimale (adresse, origine, date, raison, dernier motif), lecture seule pour la sauvegarde
select attendu('mémoire minimale : colonnes', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'prospection_memoire'),
  'email,exclue_manuelle_at,hors_auto_at,memorise_at,raison,motif');
grant usage on schema public to service_role;
set role service_role;
select attendu('sauvegarde (service_role) : lecture de la mémoire', (select count(*)::text from prospection_memoire), '1');
do $$ begin
  begin insert into prospection_memoire(email, exclue_manuelle_at, raison) values ('x@y.fr', now(), 'suppression'); raise exception 'ÉCHEC : mémoire modifiable par le rôle serveur';
  exception when insufficient_privilege then null; end;
  raise notice 'ok : rôle serveur en lecture seule sur la mémoire';
end $$;
reset role;
-- relecture, facultatif 1 : l'exclusion suit l'adresse — un contact existant qui porte la même adresse la reçoit
insert into contacts(id, email) values (u(89), 'dup@exemple.invalid'), (u(90), 'DUP@Exemple.invalid'), (u(93), 'deux1@exemple.invalid');
set role authenticated;
select set_prospection(u(89), true, 'Doublon à ne plus solliciter');
delete from contacts where id = u(89);
reset role;
select attendu('doublon existant : exclusion reçue à la suppression, tracée', exclu(90) || ' | ' || (select prospection_history->-1->>'motif' from contacts where id = u(90)),
  'manuelle | Exclusion reprise d’un contact supprimé le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' : « Doublon à ne plus solliciter »');
-- facultatif 3 : adresse retirée d'un contact exclu → mémorisée ; un contact créé ensuite avec elle reste exclu
insert into contacts(id, email) values (u(91), 'ancienne@exemple.invalid');
set role authenticated;
select set_prospection(u(91), true, 'Changement d’adresse');
update contacts set email = 'nouvelle@exemple.invalid' where id = u(91);
insert into contacts(id, email) values (u(92), 'Ancienne@exemple.invalid');
reset role;
select attendu('adresse retirée d’un contact exclu : mémorisée, contact recréé avec elle exclu',
  exclu(91) || ' | ' || exclu(92) || ' | ' || (select raison from prospection_memoire where email = 'ancienne@exemple.invalid') || ' | ' || (select prospection_history->-1->>'motif' from contacts where id = u(92)),
  'manuelle | manuelle | adresse retirée | Exclusion reprise d’une adresse retirée d’un contact exclu le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' : « Changement d’adresse »');
-- facultatif 2 : plusieurs adresses mémorisées sur le même contact recréé → une seule trace par origine
update contacts set email = 'ancienne@exemple.invalid', email_2 = 'dup@exemple.invalid' where id = u(93);
select attendu('deux adresses mémorisées : une seule trace', exclu(93) || ' | ' || (select jsonb_array_length(prospection_history)::text from contacts where id = u(93)), 'manuelle | 1');
SQL
# migration rejouée sur une base remplie : rien de perdu
"${P[@]}" < "$MIG"
"${P[@]}" -o /dev/null <<'SQL'
select attendu('migration rejouée : mémoire et exclusions intactes', memoire() || ' | ' || exclu(84) || ' | ' || exclu(87) || ' | ' || exclu(92),
  'ancienne@exemple.invalid:manuelle,dup@exemple.invalid:manuelle,mem1b@exemple.invalid:manuelle | manuelle | manuelle | manuelle');
SQL
echo "Déclencheurs Brevo (base jetable, port $PORT) : tous les cas vérifiés."
