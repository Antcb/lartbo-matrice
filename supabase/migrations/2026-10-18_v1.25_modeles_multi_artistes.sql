-- v1.25 : un modèle de mail peut servir à plusieurs artistes (vide = tous les artistes)
alter table public.mail_templates add column if not exists project_ids uuid[] not null default '{}';
update public.mail_templates set project_ids = array[project_id] where project_id is not null and project_ids = '{}';
