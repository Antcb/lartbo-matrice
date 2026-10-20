-- v1.36 : une date suit toujours le mode (booking / production) de son artiste, sauf si on l'a changé à la main sur la date
alter table public.shows add column if not exists prod_mode_manual boolean not null default false;

-- dates déjà réglées à la main (mode différent de celui de l'artiste) : on les garde telles quelles
update public.shows s set prod_mode_manual = true
  from public.projects p
 where p.id = s.project_id and s.prod_mode is distinct from p.mode
   and p.mode = 'production' and s.prod_mode = 'booking';

-- artistes en booking : toutes leurs dates en booking (La Pigñata, Telegraph, VioleTT Pi, Natalia M. King…)
update public.shows s set prod_mode = 'booking'
  from public.projects p
 where p.id = s.project_id and p.mode = 'booking' and s.prod_mode is distinct from 'booking' and not s.prod_mode_manual;

-- l'artiste change de mode : ses dates suivent (sauf celles réglées à la main)
create or replace function public.project_mode_to_shows() returns trigger language plpgsql as $$
begin
  if new.mode is distinct from old.mode then
    update public.shows set prod_mode = new.mode where project_id = new.id and not prod_mode_manual;
  end if;
  return new;
end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname = 'project_mode_to_shows') then
  create trigger project_mode_to_shows after update of mode on public.projects for each row execute function public.project_mode_to_shows(); end if; end $$;

-- une date qui change d'artiste prend le mode du nouvel artiste (sauf réglage à la main)
create or replace function public.show_follow_project_mode() returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname = 'show_follow_project_mode') then
  create trigger show_follow_project_mode before update of project_id on public.shows for each row execute function public.show_follow_project_mode(); end if; end $$;

-- pôles en français (les tâches suivent)
update public.tasks set department = 'Comptabilité' where department = 'Accounting';
update public.tasks set department = 'Projets' where department = 'Projects';
update public.settings set value = replace(replace(value::text, '"Accounting"', '"Comptabilité"'), '"Projects"', '"Projets"')::jsonb where key = 'departments';

-- FAV : pas de technicien dans le budget type
update public.projects set budget_template = coalesce(budget_template, '{}'::jsonb) || '{"techs": 0}'::jsonb where name = 'FAV';

-- frais Movinmotion : chaque date de production avec au moins un salarié a sa ligne (calculée : 1 bulletin par cachet)
insert into public.budget_lines (project_id, show_id, category, label, supplier, auto, payer, sort)
select s.project_id, s.id, 'Movinmotion', 'Commission bulletins de paie', 'Movinmotion', 'movinmotion', 'compte', coalesce((select max(sort) from public.budget_lines b where b.show_id = s.id), 0) + 1
  from public.shows s
 where coalesce(s.prod_mode, 'production') <> 'booking'
   and exists (select 1 from public.budget_lines b where b.show_id = s.id and b.category = 'Staff')
   and not exists (select 1 from public.budget_lines b where b.show_id = s.id and b.auto = 'movinmotion');
