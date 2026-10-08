-- v1.7 — structures (coordonnées administratives, événements), projets (photo, liens, échanges, membres),
-- dates (pré-contrat, break, mode booking seul), pièces jointes des tâches et projets, notifications.
-- Les tables « enfants » n'ont pas de clé étrangère en cascade : l'app supprime elle-même les lignes liées.

-- Réglages : le solde est toujours 100 % − acompte
update settings set value = to_jsonb(100 - (select (value#>>'{}')::numeric from settings where key='default_acompte_pct'))
 where key = 'default_solde_pct';

-- Structures
alter table structures add column if not exists admin jsonb not null default '{}'::jsonb;   -- raison sociale, SIRET, licences, signataire…
update structures set name = regexp_replace(name, '\s*/\s*', ' • ', 'g') where name like '%/%';

create table if not exists structure_events (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null,
  name text not null, date_start date, date_end date, period text,
  place text, city text, capacity integer, notes text,
  created_at timestamptz default now()
);
create index if not exists structure_events_structure on structure_events(structure_id);

-- Projets
alter table projects add column if not exists mode text not null default 'production';  -- 'production' ou 'booking'
alter table projects add column if not exists photo_path text;
alter table projects add column if not exists photo_pos text default '50% 50%';
alter table projects add column if not exists links jsonb not null default '[]'::jsonb;        -- [{label,url}]
alter table projects add column if not exists drive_links jsonb not null default '[]'::jsonb;  -- [{label,url}]
alter table projects add column if not exists admin_structure_id uuid;                          -- structure juridique de l'artiste
update projects set mode = 'booking' where name in ('Monty Picon • MP', 'Th/s /s Sh/t • T/S');

create table if not exists project_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null, date date, kind text default 'Note', title text, body text, url text,
  author text, created_at timestamptz default now()
);
create index if not exists project_logs_project on project_logs(project_id);

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null, first_name text, last_name text, role text, email text, phone text,
  address text, birth_date date, data jsonb not null default '{}'::jsonb, sort int default 0,
  created_at timestamptz default now()
);
create index if not exists project_members_project on project_members(project_id);

-- Pièces jointes des tâches et des projets (stockage « suivi », dossiers task/… et project/…)
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid, project_id uuid, project_log_id uuid,
  name text not null, path text not null unique, size bigint, mime text,
  created_at timestamptz default now()
);
create index if not exists attachments_task on attachments(task_id);
create index if not exists attachments_project on attachments(project_id);

-- Dates
alter table shows add column if not exists precontract_done date;    -- Pré-contrat complété
alter table shows add column if not exists break_even integer;        -- point d'équilibre (billets)
alter table shows add column if not exists prod_mode text;            -- copie du mode du projet à la création
update shows s set prod_mode = coalesce(p.mode, 'production') from projects p where p.id = s.project_id and s.prod_mode is null;
update shows set prod_mode = 'production' where prod_mode is null;

create or replace function public.shows_defaults() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.prod_mode is null then
    new.prod_mode := coalesce((select mode from projects where id = new.project_id), 'production');
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'shows_defaults') then
    create trigger shows_defaults before insert on shows for each row execute function shows_defaults();
  end if;
end $$;

-- Confirmation : en mode « booking seul », une seule ligne (facture de commission à l'artiste)
create or replace function public.on_show_confirmed()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  url text := setting_text('drive_webhook_url');
  secret text := setting_text('drive_webhook_secret');
  p projects%rowtype;
  partner_default numeric;
begin
  if setting_text('import_mode') = 'true' then return new; end if;
  if new.status not in ('Confirmée Salle','Confirmée Festival') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('Confirmée Salle','Confirmée Festival') then return new; end if;

  select * into p from projects where id = new.project_id;

  if new.artbo_pct is null then
    update shows set artbo_pct = coalesce(p.default_artbo_pct, setting_num('default_artbo_pct')) where id = new.id;
  end if;

  if coalesce(new.prod_mode, p.mode, 'production') = 'booking' then
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values (new.id, 'artbo', 'Facture commission (artiste)', null, 30);
    end if;
  else
    if new.partner_id is null and p.default_partner_id is not null then
      select default_pct into partner_default from partners where id = p.default_partner_id;
      update shows set partner_id = p.default_partner_id,
                       partner_pct = coalesce(new.partner_pct, p.default_partner_pct, partner_default)
       where id = new.id;
    end if;
    if not exists (select 1 from show_payments where show_id = new.id) then
      insert into show_payments (show_id, kind, label, pct, sort) values
        (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
        (new.id, 'solde', 'Solde', 100 - coalesce(setting_num('default_acompte_pct'), 20), 20),
        (new.id, 'artbo', 'Commission L''ArtBo', null, 30);
      if coalesce(new.partner_id, p.default_partner_id) is not null then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'partner', 'Commission ' || (select name from partners where id = coalesce(new.partner_id, p.default_partner_id)), null, 40);
      end if;
      if new.contract_type in ('Production','Co-Production','Co-Réalisation') then
        insert into show_payments (show_id, kind, label, pct, sort)
        values (new.id, 'cnm', 'Taxe CNM', setting_num('default_cnm_pct'), 50);
      end if;
    end if;
    if new.contract_type in ('Production','Co-Production','Co-Réalisation') and not new.ticketing_enabled then
      update shows set ticketing_enabled = true where id = new.id;
    end if;
  end if;

  if new.drive_folder_id is null and new.drive_folder_requested_at is null and coalesce(url,'') <> '' then
    update shows set drive_folder_requested_at = now() where id = new.id;
    perform net.http_post(url := url, body := jsonb_build_object('secret', secret, 'show_id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
  return new;
end $function$;

-- Notifications (rappels de production, alertes) pour Anthony et Chloé
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  kind text, title text not null, body text,
  show_id uuid, task_id uuid, project_id uuid,
  dedupe_key text unique,
  read_by text[] not null default '{}',
  emailed_at timestamptz
);

-- Accès réservé à l'équipe
do $$ declare t text; begin
  foreach t in array array['structure_events','project_logs','project_members','attachments','notifications'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='team_all') then
      execute format('create policy team_all on %I for all to authenticated using (is_team()) with check (is_team())', t);
    end if;
  end loop;
end $$;
