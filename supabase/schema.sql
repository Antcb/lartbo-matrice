-- =====================================================================
-- L'ArtBoristerie — Matrice Booking / Production
-- Schéma Supabase (Postgres). À exécuter une fois dans le SQL editor
-- (ou via apply_migration) sur le projet dédié L'ArtBoristerie.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Accès : 2 utilisateurs, tous les droits
-- ---------------------------------------------------------------------
create table if not exists app_users (
  email text primary key,
  display_name text
);
insert into app_users (email, display_name) values
  ('anthony@lartboristerie.com', 'Anthony'),
  ('production@lartboristerie.com', 'Production')
on conflict do nothing;

create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where email = lower(auth.jwt() ->> 'email'));
$$;

-- ---------------------------------------------------------------------
-- Paramètres (pourcentages par défaut, URL du script Drive…)
-- ---------------------------------------------------------------------
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values
  ('default_acompte_pct', '20'),
  ('default_solde_pct', '80'),
  ('default_artbo_pct', '15'),
  ('default_cnm_pct', '3.5'),
  ('drive_webhook_url', '""'),
  ('drive_webhook_secret', '""'),
  ('import_mode', '"false"')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Structures (salles, festivals, tourneurs, médias…)
-- ---------------------------------------------------------------------
create table if not exists structures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tags text[] not null default '{}',
  address text,
  postal_code text,
  city text,
  region text,
  country text default 'France',
  lat double precision,
  lng double precision,
  capacity_1 int,
  capacity_2 int,
  pricing text,                -- Payant / Gratuit / Prix Libre
  website text,
  notes text,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists structures_name_idx on structures (lower(name));

-- ---------------------------------------------------------------------
-- Contacts (personnes) — relation n-n avec les structures
-- ---------------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  display_name text not null,
  email text,
  email_2 text,
  phone text,
  phone_2 text,
  roles text[] not null default '{}',
  notes text,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists contact_structures (
  contact_id uuid references contacts(id) on delete cascade,
  structure_id uuid references structures(id) on delete cascade,
  role text,
  primary key (contact_id, structure_id)
);

-- ---------------------------------------------------------------------
-- Projets (un par artiste / projet)
-- ---------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  status text default 'In progress',
  drive_artist_folder_id text,   -- dossier racine de l'artiste dans Drive
  default_partner_id uuid,       -- co-producteur par défaut (ex. Pyrprod)
  default_artbo_pct numeric,
  default_partner_pct numeric,
  color text,
  notes text,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Co-producteurs / partenaires qui touchent une commission
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_pct numeric default 0,
  notes text
);
insert into partners (name, default_pct, notes) values ('Pyrprod', 30, '% de la commission L''ArtBo') on conflict do nothing;

alter table projects add constraint projects_partner_fk
  foreign key (default_partner_id) references partners(id) on delete set null;

-- ---------------------------------------------------------------------
-- Dates (shows) : booking + production + ticketing + communication
-- ---------------------------------------------------------------------
create table if not exists shows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  venue text not null,                 -- Festival / Salle (libellé de la date)
  date date,
  date_end date,
  city text,
  department text,                     -- "75", "CH", "DE"…
  lat double precision,
  lng double precision,
  status text not null default 'Intérêt Salle'
    check (status in ('Booking','Intérêt Salle','Intérêt Festival','Option Salle','Option Festival',
                      'Option Artiste','Confirmée Salle','Confirmée Festival','Confirmée Artiste',
                      'Annulée','Sans Suite')),
  request_date date,
  contract_type text,                  -- Cession / Co-Réalisation / Production / Co-Production / N.C
  ticketing_type text,                 -- Payant/Prix Libre / Gratuit
  fee_ht numeric,                      -- Cachet HT

  -- Commissions (pourcentage modifiable par date)
  partner_id uuid references partners(id) on delete set null,
  artbo_pct numeric,
  partner_pct numeric,                 -- % de la commission L'ArtBo reversé au partenaire

  -- Suivi admin production
  conf_kit_sent date,                  -- Conf + FT + kit promo
  contract_sent date,
  contract_signed date,
  contract_cosigned_sent date,
  boucle_tech date,

  -- Ticketing
  ticketing_enabled boolean not null default false,
  capacity int,
  comps int,                           -- "break" / invitations
  tickets_sold int,
  ticketing_url text,

  -- Communication
  communication_enabled boolean not null default true,
  boucle_com date,
  poster_request_date date,
  poster_status text default 'Quantité à demander',
  poster_a3 int default 0,
  poster_a2 int default 0,
  poster_b1 int default 0,
  poster_contact_id uuid references contacts(id) on delete set null,
  poster_delivery text,
  instagram_url text,
  facebook_url text,

  -- Drive
  drive_folder_id text,
  drive_folder_requested_at timestamptz,
  drive_folder_error text,

  notes text,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists shows_date_idx on shows (date);
create index if not exists shows_project_idx on shows (project_id);

-- ---------------------------------------------------------------------
-- Lignes financières d'une date : acomptes (plusieurs possibles), solde,
-- commission L'ArtBo, commission partenaire, taxe CNM.
-- amount = montant forcé (exception) ; sinon pct × base.
-- ---------------------------------------------------------------------
create table if not exists show_payments (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  kind text not null check (kind in ('acompte','solde','artbo','partner','cnm','autre')),
  label text not null,
  pct numeric,                 -- % du cachet HT (ou de la billetterie pour CNM)
  amount numeric,              -- montant forcé (laisser vide = calcul auto)
  invoice_number text,
  sent_at date,
  paid_at date,
  declared_at date,            -- utile pour la CNM
  sort int default 0,
  import_key text unique,      -- utilisé uniquement par l'import Notion
  created_at timestamptz default now()
);
create index if not exists show_payments_show_idx on show_payments (show_id);

-- ---------------------------------------------------------------------
-- Prospection (ex-"Suivi")
-- ---------------------------------------------------------------------
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references projects(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  status text default 'Mailed' check (status in ('Mailed','Interest','Option','Confirmed','Closed')),
  last_contact date,
  notes text,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- To Do
-- ---------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'To Do' check (status in ('To Do','In Progress','Done','Cancelled')),
  priority text,                       -- manuel ; sinon calcul auto depuis la deadline
  deadline date,
  department text,
  tags text[] not null default '{}',
  assigned_to text references app_users(email) on delete set null,
  project_id uuid references projects(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  show_id uuid references shows(id) on delete set null,
  notes text,
  done_at timestamptz,
  notion_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['structures','contacts','projects','shows','prospects','tasks'] loop
    execute format('create or replace trigger %1$s_touch before update on %1$s for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Passage en "Confirmée Salle/Festival" :
--   1) crée les lignes financières par défaut si aucune n'existe
--   2) demande la création du dossier Drive (une seule fois)
-- ---------------------------------------------------------------------
create or replace function setting_num(k text) returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from settings where key = k;
$$;
create or replace function setting_text(k text) returns text language sql stable as $$
  select value #>> '{}' from settings where key = k;
$$;

create or replace function on_show_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
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

  -- % L'ArtBo : celui de la date, sinon celui du projet, sinon le réglage global
  if new.artbo_pct is null then
    update shows set artbo_pct = coalesce(p.default_artbo_pct, setting_num('default_artbo_pct')) where id = new.id;
  end if;
  -- Partenaire (ex. Pyrprod sur The Locos) : % de la commission L'ArtBo
  if new.partner_id is null and p.default_partner_id is not null then
    select default_pct into partner_default from partners where id = p.default_partner_id;
    update shows set partner_id = p.default_partner_id,
                     partner_pct = coalesce(new.partner_pct, p.default_partner_pct, partner_default)
     where id = new.id;
  end if;

  if not exists (select 1 from show_payments where show_id = new.id) then
    insert into show_payments (show_id, kind, label, pct, sort) values
      (new.id, 'acompte', 'Acompte', setting_num('default_acompte_pct'), 10),
      (new.id, 'solde', 'Solde', setting_num('default_solde_pct'), 20),
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

  if new.drive_folder_id is null and new.drive_folder_requested_at is null and coalesce(url,'') <> '' then
    update shows set drive_folder_requested_at = now() where id = new.id;
    perform net.http_post(
      url := url,
      body := jsonb_build_object('secret', secret, 'show_id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  end if;
  return new;
end $$;

create or replace trigger shows_confirmed after insert or update of status on shows
  for each row execute function on_show_confirmed();

-- Relance manuelle de la création du dossier (bouton dans l'app)
create or replace function request_drive_folder(p_show uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then raise exception 'forbidden'; end if;
  update shows set drive_folder_requested_at = now(), drive_folder_error = null where id = p_show;
  perform net.http_post(
    url := setting_text('drive_webhook_url'),
    body := jsonb_build_object('secret', setting_text('drive_webhook_secret'), 'show_id', p_show, 'force', true),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
end $$;

-- ---------------------------------------------------------------------
-- Vue : montants calculés des lignes financières
-- ---------------------------------------------------------------------
create or replace view show_payments_computed with (security_invoker = true) as
select sp.*,
  case
    when sp.amount is not null then sp.amount
    when sp.kind = 'artbo'   then round(coalesce(s.fee_ht,0) * coalesce(sp.pct, s.artbo_pct, 0) / 100, 2)
    when sp.kind = 'partner' then round(coalesce(s.fee_ht,0) * coalesce(s.artbo_pct,0) / 100 * coalesce(sp.pct, s.partner_pct, 0) / 100, 2)
    when sp.kind = 'cnm'     then null   -- base billetterie : saisir le montant
    else round(coalesce(s.fee_ht,0) * coalesce(sp.pct,0) / 100, 2)
  end as computed_amount,
  sp.amount is not null as is_override
from show_payments sp join shows s on s.id = sp.show_id;

-- ---------------------------------------------------------------------
-- Row Level Security : seuls les 2 comptes de l'équipe
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['app_users','settings','structures','contacts','contact_structures','projects',
                           'partners','shows','show_payments','prospects','tasks'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='team_all') then
      execute format('create policy team_all on %I for all to authenticated using (is_team()) with check (is_team())', t);
    end if;
  end loop;
end $$;
