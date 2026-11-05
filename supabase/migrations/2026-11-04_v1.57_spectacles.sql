-- =====================================================================================================
-- v1.57 — Spectacles d'un artiste (décisions d'Anthony du 04/11/2026)
-- Un artiste (table projects, inchangée) peut porter plusieurs spectacles (ex. « Classique », « Jeune public »), chacun avec son
-- budget type (effectifs, coûts employeur selon la jauge ouverte, brut indicatif). Une date peut être rattachée à un spectacle.
--   - nouvelle table spectacles ; nouvelle colonne shows.spectacle_id, VIDE pour toutes les dates existantes (aucune attribution
--     automatique) ; aucune donnée existante n'est modifiée ;
--   - Movinmotion : la ligne créée par ensure_movinmotion garde désormais le coût par bulletin du moment (unit_cost) : un changement
--     du réglage ne modifie plus les nouveaux budgets ; les lignes existantes (unit_cost vide) ne sont pas touchées.
-- Retour arrière : la table et la colonne peuvent rester (vides = comportement d'avant) ; les retirer seulement sur décision d'Anthony.
-- À appliquer AVANT la publication de la v1.57 (l'application lit la table spectacles au chargement).
-- =====================================================================================================
create table if not exists public.spectacles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,   -- l'artiste ; un artiste avec des spectacles ne se supprime pas sans eux
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  budget_template jsonb not null default '{}'::jsonb,   -- effectifs, coûts employeur, brut indicatif (saisis, jamais inventés)
  notes text,
  sort integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.spectacles is 'Spectacles d''un artiste (projects) : chacun son budget type (v1.57)';
create index if not exists spectacles_project_idx on public.spectacles (project_id);

alter table public.spectacles enable row level security;
drop policy if exists team_all on public.spectacles;
create policy team_all on public.spectacles for all to authenticated using (public.is_team()) with check (public.is_team());
revoke all on public.spectacles from anon;

drop trigger if exists spectacles_touch on public.spectacles;
create trigger spectacles_touch before update on public.spectacles for each row execute function public.touch_updated_at();

-- mises à jour en direct (autres postes) comme les autres tables de l'application, si la publication existe
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'spectacles') then
    execute 'alter publication supabase_realtime add table public.spectacles';
  end if;
end $$;

-- un spectacle déjà utilisé par une date ne peut pas être supprimé (historique protégé) : il s'archive (actif = non)
alter table public.shows add column if not exists spectacle_id uuid references public.spectacles(id) on delete restrict;
comment on column public.shows.spectacle_id is 'Spectacle de la date (vide = non précisé ; jamais attribué automatiquement) (v1.57)';
create index if not exists shows_spectacle_idx on public.shows (spectacle_id);

-- Movinmotion : coût par bulletin figé à la création de la ligne (le réglage du moment, 20,30 € par défaut)
create or replace function public.ensure_movinmotion(p_show uuid) returns void language plpgsql as $$
begin
  insert into public.budget_lines (project_id, show_id, category, label, supplier, auto, payer, sort, unit_cost)
  select s.project_id, s.id, 'Movinmotion', 'Commission bulletins de paie', 'Movinmotion', 'movinmotion', 'compte',
         coalesce((select max(sort) from public.budget_lines b where b.show_id = s.id), 0) + 1,
         coalesce((select (st.value #>> '{}')::numeric from public.settings st where st.key = 'movinmotion_payslip_cost'), 20.3)
    from public.shows s
   where s.id = p_show and coalesce(s.prod_mode, 'production') <> 'booking'
     and exists (select 1 from public.budget_lines b where b.show_id = s.id and b.category = 'Staff')
  on conflict (show_id, auto) where auto in ('movinmotion', 'cnm') and show_id is not null do nothing;
end $$;
