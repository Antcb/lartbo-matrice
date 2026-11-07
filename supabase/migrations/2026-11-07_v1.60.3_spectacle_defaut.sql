-- =====================================================================================================
-- v1.60.3 — Spectacle par défaut d'un artiste (demande d'Anthony, retours de tests du 07/11/2026)
--   « Nouvelle date : sélectionner automatiquement le seul spectacle actif. Plusieurs spectacles actifs : permettre d'en définir un
--     par défaut, présélectionné mais toujours modifiable. Ne modifier aucun rattachement historique automatiquement. »
--   « Le spectacle par défaut doit toujours être actif et appartenir à l'artiste. Son archivage ne doit pas laisser un défaut
--     inutilisable. »
--   - nouvelle colonne projects.default_spectacle_id, VIDE pour tous les artistes (= comportement d'avant : choix demandé) ;
--   - elle ne sert qu'à PRÉSÉLECTIONNER le spectacle dans la fenêtre d'une nouvelle date (js/selectors.js defaultSpectacleId) ;
--     aucune date existante n'est rattachée ni modifiée ;
--   - contrôle à l'écriture (projects_default_spectacle_guard) : le défaut doit être un spectacle ACTIF de CET artiste, sinon refus
--     avec un message en français ;
--   - spectacle par défaut archivé, rattaché à un autre artiste ou supprimé : le défaut de l'artiste est RETIRÉ (vide = choix demandé),
--     jamais laissé inutilisable (spectacles_default_cleanup ; suppression : on delete set null). Les dates ne sont pas touchées.
--     Même règle dans l'application : js/actions.js (« change:spectacles.active ») retire le défaut et le dit.
-- Rejouable. Aucune donnée existante modifiée (colonne neuve, vide). Pas de nouvelle table : sauvegarde (backup-export, select *)
-- et temps réel (projects déjà publiée) inchangés. Le seul déclencheur existant qui propage une mise à jour de projects
-- (project_mode_to_shows) ne réagit qu'à la colonne mode.
-- Retour arrière : vider la colonne suffit ; colonne, fonctions et déclencheurs ne se retirent que sur décision d'Anthony.
-- À appliquer AVANT la publication de la v1.60.3 (sinon le choix du spectacle par défaut est refusé à l'enregistrement ; la
-- présélection du seul spectacle actif fonctionne sans elle).
-- =====================================================================================================
alter table public.projects add column if not exists default_spectacle_id uuid references public.spectacles(id) on delete set null;
comment on column public.projects.default_spectacle_id is 'Spectacle présélectionné pour les nouvelles dates de l''artiste quand il en a plusieurs actifs ; toujours un spectacle actif de cet artiste ; vide = choix demandé ; jamais appliqué aux dates existantes (v1.60.3)';
create index if not exists projects_default_spectacle_idx on public.projects (default_spectacle_id);

-- le défaut doit être un spectacle actif de cet artiste
create or replace function public.projects_default_spectacle_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.default_spectacle_id is not null and not exists (
       select 1 from public.spectacles sp where sp.id = new.default_spectacle_id and sp.project_id = new.id and sp.active) then
    raise exception 'Spectacle par défaut refusé : il doit être un spectacle actif de cet artiste' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists projects_default_spectacle_guard on public.projects;
create trigger projects_default_spectacle_guard before insert or update of default_spectacle_id on public.projects
  for each row execute function public.projects_default_spectacle_guard();

-- spectacle archivé ou changé d'artiste : il cesse d'être le défaut (les dates qui le portent ne changent pas)
create or replace function public.spectacles_default_cleanup() returns trigger
language plpgsql set search_path = public as $$
begin
  if (old.active and not new.active) or new.project_id is distinct from old.project_id then
    update public.projects set default_spectacle_id = null where default_spectacle_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists spectacles_default_cleanup on public.spectacles;
create trigger spectacles_default_cleanup after update of active, project_id on public.spectacles
  for each row execute function public.spectacles_default_cleanup();

revoke all on function public.projects_default_spectacle_guard() from public, anon;
revoke all on function public.spectacles_default_cleanup() from public, anon;
