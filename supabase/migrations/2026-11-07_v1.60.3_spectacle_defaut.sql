-- =====================================================================================================
-- v1.60.3 — Spectacle par défaut d'un artiste (demande d'Anthony, retours de tests du 07/11/2026)
--   « Nouvelle date : sélectionner automatiquement le seul spectacle actif. Plusieurs spectacles actifs : permettre d'en définir un
--     par défaut, présélectionné mais toujours modifiable. Ne modifier aucun rattachement historique automatiquement. »
--   - nouvelle colonne projects.default_spectacle_id, VIDE pour tous les artistes (= comportement d'avant : choix demandé) ;
--   - elle ne sert qu'à PRÉSÉLECTIONNER le spectacle dans la fenêtre d'une nouvelle date (js/selectors.js defaultSpectacleId) ;
--     aucune date existante n'est rattachée, aucun trigger ni aucune fonction ne la lit ;
--   - spectacle supprimé : la colonne se vide (on delete set null) ; un spectacle archivé ou d'un autre artiste est ignoré par
--     l'application.
-- Aucune donnée existante modifiée. Rejouable. Pas de nouvelle table : sauvegarde (backup-export, select *) et temps réel
-- (projects déjà publiée) inchangés.
-- Retour arrière : vider la colonne suffit ; la colonne ne se retire que sur décision d'Anthony.
-- À appliquer AVANT la publication de la v1.60.3 (sinon le choix du spectacle par défaut est refusé à l'enregistrement ; la
-- présélection du seul spectacle actif fonctionne sans elle).
-- =====================================================================================================
alter table public.projects add column if not exists default_spectacle_id uuid references public.spectacles(id) on delete set null;
comment on column public.projects.default_spectacle_id is 'Spectacle présélectionné pour les nouvelles dates de l''artiste quand il en a plusieurs actifs ; vide = choix demandé ; jamais appliqué aux dates existantes (v1.60.3)';
create index if not exists projects_default_spectacle_idx on public.projects (default_spectacle_id);
