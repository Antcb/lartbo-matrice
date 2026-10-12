-- v1.15 — heure de passage et durée du set sur la date (balises {{horaire}} et {{duree_set}})
alter table public.shows add column if not exists show_time text;
alter table public.shows add column if not exists set_length text;
-- mail_vars : + 'horaire', 'duree_set' ; fiche_get : + 'show_time', 'set_length' (patch des fonctions)
