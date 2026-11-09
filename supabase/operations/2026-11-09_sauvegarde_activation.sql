-- ACTIVATION du déclenchement au démarrage réel (après la migration 2026-11-09_v1.60.7_sauvegarde_declenchement.sql, la fonction serveur
-- « sauvegarde-fenetre » déployée, le secret GitHub créé, les workflows fusionnés ET une première nuit réussie dans le nouveau mode :
-- private.sauvegarde_executions contient une copie complète « succes »).
-- Production, sur autorisation d'Anthony. Effet : la fenêtre FIXE 01:30–04:30 UTC disparaît ; la connexion du rôle « sauvegarde »
-- n'est plus ouverte que par le démarrage réel d'une copie complète (45 min au plus ; 1 h au plus avec la fermeture de secours), refermée à sa fin ou au plus tard par
-- la tâche « sauvegarde-interruption » (toutes les 15 min, inchangée).
-- Conditions (décision d'Anthony : « ne retire l'ancienne fenêtre fixe qu'après réussite réelle du nouveau circuit et vérification
-- de sa fermeture ») — sinon refus, rien n'est changé :
--   1. une copie complète « succes » dont la fenêtre a été refermée PAR ELLE-MÊME, titulaire de la fenêtre, au plus tard à sa fin
--      (fermeture_titulaire <= fin) — une fermeture par le secours ou par une autre exécution ne compte pas ;
--   2. aucune copie complète en cours ;
--   3. lancée HORS de la fenêtre fixe, et la connexion du rôle « sauvegarde » est effectivement FERMÉE (rolcanlogin = false) :
--      preuve que la fermeture fonctionne sans l'aide de la fenêtre fixe.
-- UNE SEULE TRANSACTION : un refus annule tout, même lancé par « psql -f » sans arrêt sur erreur ou envoyé en une requête.
begin;
do $$ declare f record; t time := (now() at time zone 'UTC')::time; begin
  if not exists (select 1 from private.sauvegarde_executions where type = 'complete' and statut = 'succes'
                   and fermeture_titulaire is not null and fin is not null and fermeture_titulaire <= fin) then
    raise exception 'Activation refusée : aucune copie complète réussie dont la fermeture a été enregistrée par la copie elle-même (private.sauvegarde_executions)';
  end if;
  if exists (select 1 from private.sauvegarde_executions where type = 'complete' and statut = 'en_cours') then
    raise exception 'Activation refusée : une copie complète est en cours';
  end if;
  select * into f from private.sauvegarde_fenetre;
  if (f.debut <= f.fin and t >= f.debut and t < f.fin) or (f.debut > f.fin and (t >= f.debut or t < f.fin)) then
    raise exception 'Activation refusée : à lancer HORS de la fenêtre fixe (% – % UTC), pour vérifier la fermeture réelle', f.debut, f.fin;
  end if;
  if (select rolcanlogin from pg_roles where rolname = 'sauvegarde') then
    raise exception 'Activation refusée : la connexion du rôle sauvegarde est encore ouverte hors fenêtre fixe (fermeture non vérifiée ; fenêtre manuelle ? attendre son échéance)';
  end if;
end $$;
-- fenêtre fixe vide (début = fin) : sauvegarde_interrompre (ancienne et nouvelle version) ne la considère plus jamais ouverte
update private.sauvegarde_fenetre set debut = '00:00', fin = '00:00';
do $$ begin
  if exists (select 1 from cron.job where jobname = 'sauvegarde-ouverture') then perform cron.unschedule('sauvegarde-ouverture'); end if;
  if exists (select 1 from cron.job where jobname = 'sauvegarde-fermeture') then perform cron.unschedule('sauvegarde-fermeture'); end if;
end $$;
select private.sauvegarde_interrompre() as interruption;   -- referme tout de suite si aucune copie n'est en cours
commit;
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
