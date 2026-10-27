-- =====================================================================================================
-- v1.45 — Droits : TRUNCATE retiré aux rôles de l'API (relecture finale D1, 27/10/2026)
-- Constat (production, lecture seule, 27/10) : les 26 tables du schéma public accordent TRUNCATE à anon, authenticated et
-- service_role (droits par défaut). TRUNCATE ne passe ni par les politiques RLS ni par les déclencheurs ligne à ligne :
-- vider une table contournerait les protections financières (A1, C1, montants figés, journal, versements).
-- Aucun usage dans l'application, les fonctions serveur, la sauvegarde ni les scripts Google (recherche dans le dépôt).
-- Correctif minimal : seul TRUNCATE est retiré (lecture, ajout, modification et suppression ligne à ligne inchangés,
-- toujours soumis aux politiques RLS et aux déclencheurs), sur les tables existantes et sur celles créées plus tard.
-- À appliquer APRÈS les migrations v1.42 / v1.43 / v1.44 du lot D1 (pour couvrir aussi leurs nouvelles tables).
-- Retour arrière : supabase/retours-arriere/2026-10-27_v1.45_droits_truncate_retour_arriere.sql (rend exactement les droits d'avant).
-- =====================================================================================================
begin;
-- droits d'avant (hors TRUNCATE), pour vérifier ensuite que RIEN d'autre n'a changé (quel que soit l'état, même écritures suspendues)
create temp table _v145_avant on commit drop as
  select c.oid, r.rol, pr.p, has_table_privilege(r.rol, c.oid, pr.p) ok
    from pg_class c join pg_namespace s on s.oid = c.relnamespace,
         (values ('anon'), ('authenticated'), ('service_role')) r(rol), unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER']) pr(p)
   where s.nspname = 'public' and c.relkind in ('r', 'p');
revoke truncate on all tables in schema public from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated, service_role;
do $k$ declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          or has_table_privilege('service_role', c.oid, 'TRUNCATE'));
  if n > 0 then raise exception 'ECHEC : % table(s) encore vidables par un rôle de l''API — TOUT EST ANNULÉ', n; end if;
  -- seul TRUNCATE a changé : lecture, ajout, modification, suppression ligne à ligne exactement comme avant
  select count(*) into n from _v145_avant a where has_table_privilege(a.rol, a.oid, a.p) is distinct from a.ok;
  if n > 0 then raise exception 'ECHEC : % autre(s) droit(s) modifié(s) — TOUT EST ANNULÉ', n; end if;
end $k$;
-- historique des migrations Supabase (CONVENTIONS §7.5) quand le fichier est lancé dans l'éditeur SQL
do $hist$ begin if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute 'insert into supabase_migrations.schema_migrations (version, name, created_by) values ($1, $2, $3) on conflict (version) do nothing'
    using '20261027000145', 'v1_45_droits_truncate', 'lot D1 · 2026-10-27_v1.45_droits_truncate.sql';
end if; end $hist$;
commit;
