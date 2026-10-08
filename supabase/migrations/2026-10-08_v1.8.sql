-- v1.8 — break (Notion) récupéré, dates rattachées aux suivis, pôles et chemin Drive dans les réglages
update shows set break_even = comps, comps = null where comps is not null and break_even is null;   -- l'ancien champ « Invit. » était le break
update shows set ticketing_enabled = true where (capacity is not null or tickets_sold is not null or break_even is not null) and not ticketing_enabled;
alter table shows add column if not exists prospect_id uuid;            -- date posée depuis un suivi
create index if not exists shows_prospect on shows(prospect_id);
insert into settings(key, value) values ('departments', '[{"name":"Booking","color":"#4A86D4"},{"name":"Production","color":"#1D6B3A"},{"name":"Communication","color":"#B4539A"},{"name":"Admin","color":"#7A5AC8"},{"name":"Accounting","color":"#C98A12"},{"name":"Projects","color":"#283C63"}]'::jsonb) on conflict (key) do nothing;
insert into settings(key, value) values ('drive_mac_root', '""'::jsonb) on conflict (key) do nothing;
