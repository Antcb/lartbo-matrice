-- v1.40.9 (V1-A lot A2) — PRÉPARÉE, NON APPLIQUÉE : à appliquer seulement sur autorisation explicite d'Anthony.
-- Fiche publique organisateur : le serveur transmet le mode de la date (« prod_mode » : booking | production).
-- Sur une date booking, la page (js/fiche.js) présente les conditions sous « Échéancier prévu au contrat »,
-- avec % et échéances, sans montant par ligne (décision d'Anthony du 25/10/2026, option A1). Production : inchangé.
-- La page reste compatible avec le serveur actuel : sans « prod_mode », elle s'affiche comme aujourd'hui.
-- Seul changement : une clé ajoutée au résultat de fiche_get. Aucune donnée modifiée, aucune suppression, droits inchangés
-- (create or replace garde les droits existants). Texte de départ relevé en production le 25/10/2026
-- (md5 de pg_get_functiondef = 7be275838458bffc9d9e326bcc839a8a) ; le script s'arrête si le texte attendu n'y est pas.
-- Retour arrière : réexécuter la même opération en retirant « 'prod_mode', coalesce(s.prod_mode, 'production'), ».

do $mig$
declare d text := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
  avant constant text := '''status'', s.status, ''contract_type'', s.contract_type,';
begin
  if position('''prod_mode''' in d) > 0 then raise notice 'fiche_get transmet déjà prod_mode : rien à faire'; return; end if;
  if position(avant in d) = 0 then raise exception 'fiche_get ne correspond pas au texte attendu : migration arrêtée, rien n''est modifié'; end if;
  execute replace(d, avant, avant || ' ''prod_mode'', coalesce(s.prod_mode, ''production''),');
end $mig$;

-- contrôle : doit renvoyer true
select position('''prod_mode''' in pg_get_functiondef('public.fiche_get(text)'::regprocedure)) > 0 as fiche_transmet_le_mode;
