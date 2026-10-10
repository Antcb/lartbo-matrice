-- v1.13 — accueil par artiste (personnes sur la route, chambres, mise à disposition), modèles de contrat par artiste,
-- dossiers des bulletins de paie / notes de frais, projet JACO et dossiers Drive des artistes
alter table public.projects add column if not exists road_people integer;
alter table public.projects add column if not exists rooms_single integer;
alter table public.projects add column if not exists rooms_twin integer;
alter table public.projects add column if not exists setup_hours numeric;
alter table public.projects add column if not exists contract_template_cc text;
alter table public.projects add column if not exists contract_template_cr text;
insert into public.settings(key, value) values ('payslips_folder_id', '""'), ('expenses_folder_id', '""') on conflict (key) do nothing;
-- (données) modèles de contrat généraux, projet JACO, drive_artist_folder_id des artistes actifs : appliqués directement
-- mail_vars : balises {{personnes}}, {{chambres}}, {{invitations}}, {{montage}} ajoutées (patch de la fonction, voir v1.10)
