-- =====================================================================
-- Import Notion → Supabase, exécuté directement dans la base.
-- 1) notion_pull(source)  : lit l'API Notion page par page → private.notion_raw
-- 2) notion_transform()   : convertit les pages brutes vers les tables de l'app
-- La clé Notion est stockée dans private.import_secrets (schéma non exposé),
-- et supprimée à la fin de l'import.
-- =====================================================================
create extension if not exists http with schema extensions;
create schema if not exists private;

create table if not exists private.import_secrets (key text primary key, value text not null);
create table if not exists private.notion_raw (
  source text not null,
  page_id text primary key,
  props jsonb not null,
  last_edited timestamptz
);
create table if not exists private.notion_cursor (source text primary key, cursor text, done boolean default false);

-- Sources Notion (data sources)
create or replace function private.notion_source_id(src text) returns text language sql immutable as $$
  select case src
    when 'projects'   then 'cd62db2b-8fd1-4441-bc10-53ce0c58899d'
    when 'structures' then '27590285-6b86-8178-9708-000b8d88e579'
    when 'contacts'   then '7d0431a5-563c-402a-9ca1-be975b937ebf'
    when 'shows'      then '27590285-6b86-806e-a6d7-000b988c784d'
    when 'prospects'  then '30690285-6b86-80ef-8633-000b6053243a'
    when 'tasks'      then '25190285-6b86-8069-8bdc-000bddff9583'
  end
$$;

-- Lit jusqu'à max_pages pages de 100 fiches ; à rappeler tant que done = false
create or replace function private.notion_pull(src text, max_pages int default 15)
returns text language plpgsql security definer set search_path = public, extensions, private as $$
declare
  token text := (select value from private.import_secrets where key = 'notion_token');
  cur text; resp extensions.http_response; body jsonb; n int := 0; total int := 0; req jsonb;
begin
  if token is null then raise exception 'Clé Notion absente'; end if;
  insert into private.notion_cursor(source) values (src) on conflict do nothing;
  select cursor into cur from private.notion_cursor where source = src;
  if (select done from private.notion_cursor where source = src) then return src || ' : déjà terminé'; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  loop
    req := jsonb_build_object('page_size', 100);
    if cur is not null then req := req || jsonb_build_object('start_cursor', cur); end if;
    resp := extensions.http((
      'POST',
      'https://api.notion.com/v1/data_sources/' || private.notion_source_id(src) || '/query',
      array[extensions.http_header('Authorization', 'Bearer ' || token),
            extensions.http_header('Notion-Version', '2025-09-03')],
      'application/json', req::text)::extensions.http_request);
    if resp.status <> 200 then
      raise exception 'Notion % : %', resp.status, left(resp.content, 400);
    end if;
    body := resp.content::jsonb;
    insert into private.notion_raw(source, page_id, props, last_edited)
      select src, r->>'id', r->'properties', (r->>'last_edited_time')::timestamptz
      from jsonb_array_elements(body->'results') r
    on conflict (page_id) do update set props = excluded.props, last_edited = excluded.last_edited;
    total := total + jsonb_array_length(body->'results');
    n := n + 1;
    cur := case when (body->>'has_more')::boolean then body->>'next_cursor' end;
    update private.notion_cursor set cursor = cur, done = (cur is null) where source = src;
    exit when cur is null or n >= max_pages;
  end loop;
  return src || ' : +' || total || case when cur is null then ' (terminé)' else ' (à suivre)' end;
end $$;

-- ───────── Lecteurs de propriétés Notion ─────────
create or replace function private.n_text(p jsonb, k text) returns text language sql immutable as $$
  select nullif(trim(coalesce(
    (select string_agg(x->>'plain_text', '') from jsonb_array_elements(coalesce(p->k->'title', p->k->'rich_text')) x),
    p->k->>'email', p->k->>'phone_number', p->k->>'url')), '')
$$;
create or replace function private.n_num(p jsonb, k text) returns numeric language sql immutable as $$
  select case when jsonb_typeof(p->k->'number') = 'number' then (p->k->>'number')::numeric
              when jsonb_typeof(p->k->'formula'->'number') = 'number' then (p->k->'formula'->>'number')::numeric end
$$;
create or replace function private.n_sel(p jsonb, k text) returns text language sql immutable as $$
  select coalesce(p->k->'select'->>'name', p->k->'status'->>'name')
$$;
create or replace function private.n_multi(p jsonb, k text) returns text[] language sql immutable as $$
  select coalesce(array(select x->>'name' from jsonb_array_elements(coalesce(p->k->'multi_select','[]'::jsonb)) x), '{}')
$$;
create or replace function private.n_rel(p jsonb, k text) returns text[] language sql immutable as $$
  select coalesce(array(select x->>'id' from jsonb_array_elements(coalesce(p->k->'relation','[]'::jsonb)) x), '{}')
$$;
create or replace function private.n_date(p jsonb, k text) returns date language sql immutable as $$
  select left(p->k->'date'->>'start', 10)::date
$$;
create or replace function private.n_date_end(p jsonb, k text) returns date language sql immutable as $$
  select left(p->k->'date'->>'end', 10)::date
$$;
create or replace function private.n_place(p jsonb, k text) returns jsonb language sql immutable as $$
  select case when p->k->>'type' is null then null else coalesce(p->k->'place', p->k->(p->k->>'type')) end
$$;
create or replace function private.n_people(p jsonb, k text) returns text[] language sql immutable as $$
  select coalesce(array(select lower(x->'person'->>'email') from jsonb_array_elements(coalesce(p->k->'people','[]'::jsonb)) x where x->'person'->>'email' is not null), '{}')
$$;

-- ───────── Transformation vers les tables de l'app ─────────
create or replace function private.notion_transform() returns text
language plpgsql security definer set search_path = public, private as $$
declare n_proj int; n_str int; n_con int; n_lnk int; n_sh int; n_pay int; n_pr int; n_ta int;
        pyr uuid := (select id from partners where name = 'Pyrprod');
begin
  update settings set value = '"true"' where key = 'import_mode';

  -- Projets
  insert into projects (notion_id, name, status, active)
  select page_id, coalesce(n_text(props,'Nom du projet'),'Sans nom'), n_sel(props,'Status'),
         coalesce(n_sel(props,'Status'),'') <> 'Done'
  from notion_raw where source = 'projects'
  on conflict (notion_id) do update set name = excluded.name, status = excluded.status, active = excluded.active;
  get diagnostics n_proj = row_count;
  -- Pyrprod par défaut sur The Locos
  update projects set default_partner_id = pyr, default_partner_pct = coalesce(default_partner_pct, 30)
   where name ilike '%locos%' and default_partner_id is null;

  -- Structures
  insert into structures (notion_id, name, tags, address, lat, lng, postal_code, city, region, country,
                          capacity_1, capacity_2, pricing, website)
  select page_id, coalesce(n_text(props,'Structure'),'Sans nom'), n_multi(props,'Tag'),
         coalesce(n_place(props,'Adresse')->>'address', n_place(props,'Adresse')->>'name'),
         coalesce(n_place(props,'Adresse')->>'lat', n_place(props,'Adresse')->>'latitude')::float8,
         coalesce(n_place(props,'Adresse')->>'lon', n_place(props,'Adresse')->>'lng', n_place(props,'Adresse')->>'longitude')::float8,
         (n_num(props,'Code Postal'))::bigint::text, n_text(props,'Ville'), n_sel(props,'Région'), n_sel(props,'Pays'),
         n_num(props,'Jauge 1')::int, n_num(props,'Jauge 2')::int, n_sel(props,'Payant'), n_text(props,'Website')
  from notion_raw where source = 'structures'
  on conflict (notion_id) do update set name = excluded.name, tags = excluded.tags, address = excluded.address,
    lat = excluded.lat, lng = excluded.lng, postal_code = excluded.postal_code, city = excluded.city,
    region = excluded.region, country = excluded.country, capacity_1 = excluded.capacity_1,
    capacity_2 = excluded.capacity_2, pricing = excluded.pricing, website = excluded.website;
  get diagnostics n_str = row_count;

  -- Contacts
  insert into contacts (notion_id, display_name, first_name, last_name, email, email_2, phone, phone_2, roles)
  select page_id,
         coalesce(n_text(props,'Nom du client'), nullif(concat_ws(' ', n_text(props,'Prénom'), n_text(props,'Nom')),''), n_text(props,'Mail'), 'Sans nom'),
         n_text(props,'Prénom'), n_text(props,'Nom'), n_text(props,'Mail'), n_text(props,'Mail 2'),
         n_text(props,'Téléphone'), n_text(props,'Téléphone 2'), n_multi(props,'Poste')
  from notion_raw where source = 'contacts'
  on conflict (notion_id) do update set display_name = excluded.display_name, first_name = excluded.first_name,
    last_name = excluded.last_name, email = excluded.email, email_2 = excluded.email_2, phone = excluded.phone,
    phone_2 = excluded.phone_2, roles = excluded.roles;
  get diagnostics n_con = row_count;

  -- Liens contacts ↔ structures (les deux côtés de la relation Notion)
  insert into contact_structures (contact_id, structure_id)
  select distinct c.id, s.id from (
      select r.page_id as cn, unnest(n_rel(r.props,'Structures')) as sn from notion_raw r where r.source = 'contacts'
      union
      select unnest(n_rel(r.props,'L’ArtBoristerie Clients')), r.page_id from notion_raw r where r.source = 'structures'
    ) l
  join contacts c on c.notion_id = l.cn join structures s on s.notion_id = l.sn
  on conflict do nothing;
  get diagnostics n_lnk = row_count;

  -- Dates
  insert into shows (notion_id, venue, project_id, structure_id, date, date_end, city, lat, lng, department, status,
    contract_type, ticketing_type, fee_ht, artbo_pct, partner_id, partner_pct,
    conf_kit_sent, contract_sent, contract_signed, contract_cosigned_sent, boucle_tech, boucle_com,
    poster_request_date, poster_status, poster_a3, poster_a2, poster_b1, poster_contact_id, poster_delivery,
    capacity, comps, tickets_sold, ticketing_url, instagram_url, facebook_url, ticketing_enabled, communication_enabled)
  select r.page_id,
    coalesce(replace(n_text(r.props,'Festival/Salle'),'**',''),'Sans nom'),
    (select id from projects where notion_id = (n_rel(r.props,'Projects'))[1]),
    (select id from structures where notion_id = (n_rel(r.props,'Structures'))[1]),
    n_date(r.props,'Date'), n_date_end(r.props,'Date'),
    nullif(trim(split_part(coalesce(n_place(r.props,'Ville')->>'name', n_place(r.props,'Ville')->>'address',''), ',', 1)),''),
    coalesce(n_place(r.props,'Ville')->>'lat', n_place(r.props,'Ville')->>'latitude')::float8,
    coalesce(n_place(r.props,'Ville')->>'lon', n_place(r.props,'Ville')->>'lng', n_place(r.props,'Ville')->>'longitude')::float8,
    n_text(r.props,'Département'),
    case when n_sel(r.props,'Status') in ('Booking','Intérêt Salle','Intérêt Festival','Option Salle','Option Festival','Option Artiste',
              'Confirmée Salle','Confirmée Festival','Confirmée Artiste','Annulée','Sans Suite') then n_sel(r.props,'Status') else 'Booking' end,
    n_sel(r.props,'Type de Contrat'), n_sel(r.props,'Billetterie'), n_num(r.props,'Cachet HT'),
    -- % L'ArtBo : 20 % si la facture ArtBo correspond à 20 %, sinon 15 %
    case when n_num(r.props,'Facture L''ArtBo 20%') is not null and n_num(r.props,'Facture L''ArtBo 15%') is null then 20 else 15 end,
    case when n_text(r.props,'N° Facture Pyrprod') is not null or n_date(r.props,'Facture Pyrprod Envoyée') is not null
           or exists (select 1 from projects p where p.notion_id = (n_rel(r.props,'Projects'))[1] and p.default_partner_id is not null)
         then pyr end,
    case when n_text(r.props,'N° Facture Pyrprod') is not null or n_date(r.props,'Facture Pyrprod Envoyée') is not null
           or exists (select 1 from projects p where p.notion_id = (n_rel(r.props,'Projects'))[1] and p.default_partner_id is not null)
         then 30 end,
    n_date(r.props,'Conf + FT + kit promo'), n_date(r.props,'Contrat envoyé'), n_date(r.props,'Contrat Signé'),
    n_date(r.props,'Contrat Co-Signé Envoyé'), n_date(r.props,'Boucle Technique'), n_date(r.props,'Boucle Communication'),
    n_date(r.props,'Date de la demande'), n_sel(r.props,'Suivi Affiche'),
    coalesce(n_num(r.props,'A3'),0)::int, coalesce(n_num(r.props,'A2'),0)::int, coalesce(n_num(r.props,'B1'),0)::int,
    (select id from contacts where notion_id = (n_rel(r.props,'Référent Affiche'))[1]),
    n_text(r.props,'Livraison affiche'),
    n_num(r.props,'Capacity')::int, n_num(r.props,'break')::int, n_num(r.props,'Tickets Sold')::int,
    n_text(r.props,'Lien Billetterie'), n_text(r.props,'Liens Insta'), n_text(r.props,'Liens Facebook'),
    n_sel(r.props,'Type de Contrat') in ('Production','Co-Production','Co-Réalisation')
      and n_sel(r.props,'Status') like 'Confirmée%',
    coalesce(n_sel(r.props,'Suivi Affiche'),'') <> 'Non concerné'
  from notion_raw r where r.source = 'shows'
  on conflict (notion_id) do update set venue = excluded.venue, project_id = excluded.project_id,
    structure_id = excluded.structure_id, date = excluded.date, date_end = excluded.date_end, city = excluded.city,
    lat = excluded.lat, lng = excluded.lng, department = excluded.department, status = excluded.status,
    contract_type = excluded.contract_type, ticketing_type = excluded.ticketing_type, fee_ht = excluded.fee_ht,
    conf_kit_sent = excluded.conf_kit_sent, contract_sent = excluded.contract_sent, contract_signed = excluded.contract_signed,
    contract_cosigned_sent = excluded.contract_cosigned_sent, boucle_tech = excluded.boucle_tech, boucle_com = excluded.boucle_com,
    poster_request_date = excluded.poster_request_date, poster_status = excluded.poster_status,
    poster_a3 = excluded.poster_a3, poster_a2 = excluded.poster_a2, poster_b1 = excluded.poster_b1,
    poster_contact_id = excluded.poster_contact_id, poster_delivery = excluded.poster_delivery,
    capacity = excluded.capacity, comps = excluded.comps, tickets_sold = excluded.tickets_sold,
    ticketing_url = excluded.ticketing_url, instagram_url = excluded.instagram_url, facebook_url = excluded.facebook_url;
  get diagnostics n_sh = row_count;

  -- Lignes financières des dates confirmées (une par type, identifiées par import_key)
  insert into show_payments (import_key, show_id, kind, label, sort, pct, amount, invoice_number, sent_at, paid_at, declared_at)
  select x.k, s.id, x.kind, x.label, x.sort, x.pct, x.amount, x.num, x.sent, x.paid, x.decl
  from notion_raw r
  join shows s on s.notion_id = r.page_id
  cross join lateral (values
    (r.page_id||':acompte', 'acompte', 'Acompte', 10, 20::numeric, n_num(r.props,'Facture Acompte réelle'), n_text(r.props,'N° Acompte'),
       n_date(r.props,'Acompte Envoyé'), n_date(r.props,'Acompte Payé'), null::date, true),
    (r.page_id||':solde', 'solde', 'Solde', 20, 80, n_num(r.props,'Montant Solde réel'), n_text(r.props,'N° Facture de Solde'),
       n_date(r.props,'Facture de Solde Envoyée'), n_date(r.props,'Facture de Solde Payée'), null, true),
    (r.page_id||':artbo', 'artbo', 'Commission L''ArtBo', 30, null, null, n_text(r.props,'N° Facture L''ArtBo'),
       n_date(r.props,'Facture L''ArtBo Envoyée'), n_date(r.props,'Facture L''ArtBo Payée'), null, true),
    (r.page_id||':partner', 'partner', 'Commission Pyrprod', 40, null, null, n_text(r.props,'N° Facture Pyrprod'),
       n_date(r.props,'Facture Pyrprod Envoyée'), n_date(r.props,'Facture Pyrprod Payée'), null, s.partner_id is not null),
    (r.page_id||':cnm', 'cnm', 'Taxe CNM', 50, null, n_num(r.props,'Montant Taxe'), null, null, null, n_date(r.props,'Date Déclaration'),
       n_num(r.props,'Montant Taxe') is not null or n_date(r.props,'Date Déclaration') is not null
       or s.contract_type in ('Production','Co-Production','Co-Réalisation'))
  ) as x(k, kind, label, sort, pct, amount, num, sent, paid, decl, keep)
  where r.source = 'shows' and s.status like 'Confirmée%' and x.keep
  on conflict (import_key) do update set amount = excluded.amount, invoice_number = excluded.invoice_number,
    sent_at = excluded.sent_at, paid_at = excluded.paid_at, declared_at = excluded.declared_at;
  get diagnostics n_pay = row_count;

  -- Prospection
  insert into prospects (notion_id, name, status, structure_id, contact_id, project_id, last_contact)
  select r.page_id, coalesce(n_text(r.props,'Nom'),'Sans nom'),
    case when n_sel(r.props,'Status') in ('Mailed','Interest','Option','Confirmed','Closed') then n_sel(r.props,'Status') else 'Mailed' end,
    (select id from structures where notion_id = (n_rel(r.props,'Structure'))[1]),
    (select id from contacts where notion_id = (n_rel(r.props,'Clients'))[1]),
    (select id from projects where notion_id = (n_rel(r.props,'Projects'))[1]),
    r.last_edited::date
  from notion_raw r where r.source = 'prospects'
  on conflict (notion_id) do update set name = excluded.name, status = excluded.status, structure_id = excluded.structure_id,
    contact_id = excluded.contact_id, project_id = excluded.project_id, last_contact = excluded.last_contact;
  get diagnostics n_pr = row_count;

  -- Tâches
  insert into tasks (notion_id, title, status, priority, deadline, department, tags, assigned_to, project_id, structure_id, notes, done_at)
  select r.page_id, coalesce(n_text(r.props,'Title'),'Sans titre'),
    case when n_sel(r.props,'Status') in ('To Do','In Progress','Done','Cancelled') then n_sel(r.props,'Status') else 'To Do' end,
    n_sel(r.props,'Priority'), n_date(r.props,'Deadline'), n_sel(r.props,'Department'), n_multi(r.props,'Tags'),
    (select u.email from app_users u where u.email = any(n_people(r.props,'Assigned to')) limit 1),
    (select id from projects where notion_id = (n_rel(r.props,'Projects'))[1]),
    (select id from structures where notion_id = (n_rel(r.props,'Structures'))[1]),
    n_text(r.props,'Files'), n_date(r.props,'Done Time')
  from notion_raw r where r.source = 'tasks'
  on conflict (notion_id) do update set title = excluded.title, status = excluded.status, priority = excluded.priority,
    deadline = excluded.deadline, department = excluded.department, tags = excluded.tags, assigned_to = excluded.assigned_to,
    project_id = excluded.project_id, structure_id = excluded.structure_id, notes = excluded.notes, done_at = excluded.done_at;
  get diagnostics n_ta = row_count;

  update settings set value = '"false"' where key = 'import_mode';
  return format('projets %s · structures %s · contacts %s · liens %s · dates %s · lignes financières %s · prospection %s · tâches %s',
                n_proj, n_str, n_con, n_lnk, n_sh, n_pay, n_pr, n_ta);
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
