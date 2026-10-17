-- v1.20 : tâche rattachée à un suivi, relances (mail puis téléphone)
alter table public.tasks add column if not exists prospect_id uuid references public.prospects(id) on delete set null;
alter table public.tasks add column if not exists auto_kind text;   -- relance_mail | relance_tel
create index if not exists tasks_prospect on public.tasks(prospect_id);
