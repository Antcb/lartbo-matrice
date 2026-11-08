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
create role anon; create role authenticated;
create table contacts(id uuid primary key, email text, email_2 text, first_name text, last_name text);
create table structures(id uuid primary key, name text, inactive_at timestamptz);
create table contact_structures(contact_id uuid references contacts(id) on delete cascade,
  structure_id uuid references structures(id) on delete cascade, role text, primary key(contact_id, structure_id));
create table appels(n serial, contact uuid);
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
do $$ begin
  if (select count(*) from contacts) <> 48 then raise exception 'ÉCHEC : un contact a disparu'; end if;
  if exists (select 1 from pg_trigger where tgname = 'brevo_contact_structures' and tgtype & 1 = 1) then
    raise exception 'ÉCHEC : brevo_contact_structures est encore ligne par ligne'; end if;
  raise notice 'ok : aucun autre contact supprimé ; déclencheurs par requête';
end $$;
SQL
echo "Déclencheurs Brevo (base jetable, port $PORT) : tous les cas vérifiés."
