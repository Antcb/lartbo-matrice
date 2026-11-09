-- COUPURE DE L'ALERTE d'absence de sauvegarde (v1.60.7) — première étape de TOUT retour arrière, quel que soit l'état atteint
-- (sur décision d'Anthony). Sans elle, la tâche pg_cron « sauvegarde-controle » enverrait chaque jour une fausse alerte une fois les
-- workflows revenus au fonctionnement d'avant (qui n'enregistre plus rien dans private.sauvegarde_executions).
-- Une seule transaction ; aucune donnée métier touchée ; le journal des exécutions est gardé.
-- Réarmement : rejouer la migration 2026-11-09_v1.60.7_sauvegarde_declenchement.sql (nouvelle date de mise en place, délai de 24 h).
begin;
update private.sauvegarde_surveillance set active = false;
do $$ begin
  if to_regclass('cron.job') is not null and exists (select 1 from cron.job where jobname = 'sauvegarde-controle') then
    perform cron.unschedule('sauvegarde-controle');
  end if;
end $$;
commit;
-- contrôle : attendu « false | 0 »
select (select active from private.sauvegarde_surveillance) as surveillance_active,
       (select count(*) from cron.job where jobname = 'sauvegarde-controle') as tache_controle;
