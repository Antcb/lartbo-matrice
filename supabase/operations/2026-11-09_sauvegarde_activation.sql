-- ACTIVATION du déclenchement au démarrage réel (après la migration 2026-11-09_sauvegarde_declenchement.sql, la fonction serveur
-- « sauvegarde-fenetre » déployée, le secret GitHub créé, les workflows fusionnés ET une première nuit réussie dans le nouveau mode :
-- private.sauvegarde_executions contient une copie complète « succes »).
-- Production, sur autorisation d'Anthony. Effet : la fenêtre FIXE 01:30–04:30 UTC disparaît ; la connexion du rôle « sauvegarde »
-- n'est plus ouverte que par le démarrage réel d'une copie complète (45 min, 1 h au plus), refermée à sa fin ou au plus tard par
-- la tâche « sauvegarde-interruption » (toutes les 15 min, inchangée).
do $$ begin
  if not exists (select 1 from private.sauvegarde_executions where type = 'complete' and statut = 'succes') then
    raise exception 'Activation refusée : aucune copie complète réussie dans le nouveau mode (private.sauvegarde_executions)';
  end if;
end $$;
-- fenêtre fixe vide (début = fin) : sauvegarde_interrompre (ancienne et nouvelle version) ne la considère plus jamais ouverte
update private.sauvegarde_fenetre set debut = '00:00', fin = '00:00';
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sauvegarde-ouverture') then perform cron.unschedule('sauvegarde-ouverture'); end if;
  if exists (select 1 from cron.job where jobname = 'sauvegarde-fermeture') then perform cron.unschedule('sauvegarde-fermeture'); end if;
end $$;
select private.sauvegarde_interrompre() as interruption;   -- referme tout de suite si aucune copie n'est en cours
-- contrôle
select (select debut = fin from private.sauvegarde_fenetre) as fenetre_fixe_retiree,                          -- attendu : true
       (select string_agg(jobname, ', ' order by jobname) from cron.job where jobname like 'sauvegarde-%') as taches,  -- attendu : sauvegarde-controle, sauvegarde-interruption
       (select rolcanlogin from pg_roles where rolname = 'sauvegarde') as connexion_ouverte;                   -- attendu : false (hors copie)

-- RETOUR (sur décision) : remettre la fenêtre fixe d'origine
--   update private.sauvegarde_fenetre set debut = '01:30', fin = '04:30';
--   select cron.schedule('sauvegarde-ouverture', '30 1 * * *', 'select private.sauvegarde_ouvrir()');
--   select cron.schedule('sauvegarde-fermeture', '30 4 * * *', 'alter role sauvegarde nologin');
-- ATTENTION : outils/fenetre_etat.sql (dépôt de sauvegarde, version de la branche dev/sauvegarde-declenchement) attend 2 tâches
-- (interruption, contrôle) après l'activation et 4 avant ; il lit l'état réel, aucune modification à faire ici.
