-- v1.19 : budget prévisionnel / réel par date, compte bancaire dédié par artiste, Pennylane

-- Compte bancaire dédié d'un artiste (ex. « Compte The Locos L'ArtBo ») : les cachets y arrivent HT,
-- les dépenses de la tournée en partent HT (salaires : coût total)
alter table public.projects add column if not exists account_name text;
alter table public.projects add column if not exists account_opening numeric;      -- solde de départ (optionnel)
alter table public.projects add column if not exists artist_payee text;           -- qui reçoit le solde artiste (ex. Pipi)

-- Encaissements (acomptes / soldes / commission) : où arrive l'argent, pièce, Pennylane
alter table public.show_payments add column if not exists payee text;             -- compte | artbo | artiste | autre
alter table public.show_payments add column if not exists file_path text;
alter table public.show_payments add column if not exists file_name text;
alter table public.show_payments add column if not exists pennylane_id text;
alter table public.show_payments add column if not exists pennylane_url text;
alter table public.shows add column if not exists pennylane_quote_id text;
alter table public.shows add column if not exists pennylane_quote_url text;
alter table public.shows add column if not exists budget_note text;

-- Lignes de dépenses d'une date (ou hors date quand show_id est vide)
create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  show_id uuid references public.shows(id) on delete cascade,
  category text,                 -- Technique, VHR, Promo, Accueil, Taxes, Autres, Staff, Movinmotion, Solde artiste
  label text,
  supplier text,                 -- fournisseur / personne payée
  auto text,                     -- movinmotion | cnm | solde_artiste : montant prévu calculé
  qty numeric,                   -- Staff : nombre de bulletins
  unit_cost numeric,             -- Staff : coût employeur d'un bulletin
  forecast numeric,              -- prévu HT (vide = calcul automatique)
  amount numeric,                -- réel HT (salaires : coût total), lu sur la pièce
  amount_ttc numeric,
  vat_rate numeric,
  payer text default 'compte',   -- compte | artbo | artiste | organisateur | autre
  payer_name text,
  doc_number text,
  doc_date date,
  paid_at date,
  file_path text,
  file_name text,
  employee_id uuid references public.employees(id) on delete set null,
  notes text,
  sort integer default 0,
  import_key text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists budget_lines_show on public.budget_lines(show_id);
create index if not exists budget_lines_project on public.budget_lines(project_id);
alter table public.budget_lines enable row level security;
drop policy if exists budget_team on public.budget_lines;
create policy budget_team on public.budget_lines for all using (is_team()) with check (is_team());

-- Clé API Pennylane : gardée côté serveur, jamais renvoyée au navigateur
create or replace function public.set_pennylane_key(k text) returns text
language plpgsql security definer set search_path = public, private as $$
declare v text := trim(coalesce(k, ''));
begin
  if not is_team() then raise exception 'Accès refusé'; end if;
  if v = '' then delete from private.import_secrets where key = 'pennylane_token'; return 'removed'; end if;
  if length(v) < 20 or v ~ '\s' then raise exception 'Ce n’est pas un jeton API Pennylane (copie seulement le jeton, sans espace)'; end if;
  insert into private.import_secrets(key, value) values ('pennylane_token', v) on conflict (key) do update set value = excluded.value;
  return 'ok';
end $$;
create or replace function public.pennylane_status() returns boolean
language sql stable security definer set search_path = public, private as $$
  select case when not is_team() then null else exists(select 1 from private.import_secrets where key='pennylane_token') end
$$;
grant execute on function public.set_pennylane_key(text) to authenticated;
grant execute on function public.pennylane_status() to authenticated;

-- Pennylane : identifiant du client créé dans Pennylane
alter table public.structures add column if not exists pennylane_id text;
alter table public.projects add column if not exists pennylane_customer_id text;
insert into public.settings(key,value) values ('movinmotion_payslip_cost', to_jsonb(20.3)) on conflict (key) do nothing;
update public.projects set account_name = 'Compte ' || name || ' L''ArtBo' where name in ('The Locos','FAV','Montmartre') and account_name is null;
update public.projects set artist_payee = 'Pipi' where name = 'The Locos' and artist_payee is null;
