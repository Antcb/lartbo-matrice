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
revoke truncate on all tables in schema public from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated, service_role;
do $k$ declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          or has_table_privilege('service_role', c.oid, 'TRUNCATE'));
  if n > 0 then raise exception 'ECHEC : % table(s) encore vidables par un rôle de l''API — TOUT EST ANNULÉ', n; end if;
  -- les droits utiles restent : l'équipe lit et écrit toujours (sous RLS et déclencheurs)
  if not has_table_privilege('authenticated', 'public.show_payments', 'SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('authenticated', 'public.shows', 'SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role', 'public.show_payments', 'SELECT,UPDATE') then
    raise exception 'ECHEC : un droit utile a disparu — TOUT EST ANNULÉ'; end if;
end $k$;
commit;
