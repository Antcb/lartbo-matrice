-- =====================================================================================================
-- RETOUR ARRIÈRE de supabase/migrations/2026-10-27_v1.45_droits_truncate.sql — UNIQUEMENT SUR DEMANDE ÉCRITE D'ANTHONY
-- Rend exactement les droits d'avant (relevés en production le 27/10/2026) : TRUNCATE à anon, authenticated, service_role
-- sur toutes les tables du schéma public, et dans les droits par défaut du rôle postgres. Aucune donnée touchée.
-- Exceptions conservées, posées par le lot D1 lui-même : le journal financier (finance_log) et les versements
-- (commission_transfers) restent non vidables (v1.42 / v1.43).
-- =====================================================================================================
begin;
do $r$ declare t record;
begin
  for t in select c.oid::regclass r from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not in ('finance_log', 'commission_transfers') loop
    execute format('grant truncate on %s to anon, authenticated, service_role', t.r);
  end loop;
end $r$;
alter default privileges for role postgres in schema public grant truncate on tables to anon, authenticated, service_role;
commit;
