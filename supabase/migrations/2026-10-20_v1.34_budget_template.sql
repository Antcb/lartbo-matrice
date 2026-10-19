-- v1.34 : budget type par artiste (valeurs vides = celles de Réglages › Budget type)
alter table public.projects add column if not exists budget_template jsonb;
-- budget type général (Réglages), créé s'il n'existe pas
insert into public.settings(key, value)
values ('budget_template', '{"artists":0,"techs":2,"payslip":287,"peage":0,"essence":0,"t1max":500,"t1":220,"t2max":2000,"t2":270,"t3":315}'::jsonb)
on conflict (key) do nothing;
