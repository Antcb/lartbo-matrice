-- Retour arrière de supabase/migrations/2026-11-09_sauvegarde_declenchement.sql (sur décision d'Anthony seulement).
-- Ordre : 1) remettre la fenêtre FIXE si l'activation a été faite (supabase/operations/2026-11-09_sauvegarde_activation.sql,
--            section « retour ») ; 2) workflows du dépôt de sauvegarde : supprimer le secret GitHub SAUVEGARDE_SIGNAL_SECRET
--            (ils repassent alors d'eux-mêmes en mode « fenêtre fixe ») ; 3) ce script.
-- Aucune donnée métier touchée. Le journal private.sauvegarde_executions est GARDÉ (historique), seules les fonctions sont retirées.
do $$ begin
  if to_regclass('cron.job') is not null and exists (select 1 from cron.job where jobname = 'sauvegarde-controle') then
    perform cron.unschedule('sauvegarde-controle');
  end if;
end $$;
drop function if exists public.sauvegarde_declenchement(text, jsonb);
drop function if exists private.sauvegarde_controler();
drop function if exists private.sauvegarde_terminer(bigint, text, text);
drop function if exists private.sauvegarde_fermer(bigint);
drop function if exists private.sauvegarde_demarrer(text, text, integer, text, boolean, interval);
-- private.sauvegarde_interrompre : version de la migration conservée (identique à l'origine + libération des verrous périmés,
-- sans effet si la table des exécutions n'existe plus) ; pour revenir au texte d'origine : rejouer la section « interruption » de
-- outils/fenetre_connexion.sql (dépôt lartbo-matrice-backup).
-- private.sauvegarde_secrets_presence et les droits de lecture accordés (mailbox_owners…) restent : la copie complète en dépend.
-- Le secret 'sauvegarde_declenchement_secret' reste dans le coffre (sans usage) ; l'effacer seulement sur décision.
