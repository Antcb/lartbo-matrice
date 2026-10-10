-- v1.10 — modèles de mail, préparation de la confirmation, fiche de renseignements en ligne

-- 1. Modèles de mail (par artiste ; project_id vide = modèle générique)
create table if not exists public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on update cascade on delete cascade,
  kind text not null,              -- confirmation | boucle_tech | boucle_com | autre
  variant text,                    -- cc | cc_club | cc_festival | ccr_club | …
  name text,
  subject text not null default '',
  cc text,                         -- adresses en copie, séparées par des virgules
  html text not null default '',
  attachments jsonb not null default '[]',   -- [{id, name}] fichiers Drive joints au brouillon
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.mail_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='mail_templates' and policyname='team_all') then
    create policy team_all on public.mail_templates for all to authenticated using (is_team()) with check (is_team());
  end if;
end $$;

-- 2. Date : fiche de renseignements + historique des mails préparés
alter table public.shows add column if not exists fiche_token text unique default replace(gen_random_uuid()::text, '-', '');
update public.shows set fiche_token = replace(gen_random_uuid()::text, '-', '') where fiche_token is null;
alter table public.shows add column if not exists fiche jsonb not null default '{}';
alter table public.shows add column if not exists fiche_submitted_at timestamptz;
alter table public.shows add column if not exists mail_log jsonb not null default '{}';   -- {confirmation:{at,to,draft}, boucle_tech:{…}}
alter table public.shows add column if not exists conf_contact_id uuid references public.contacts(id) on delete set null;

insert into public.settings(key, value) values ('site_url', '"https://antcb.github.io/lartbo-matrice/"') on conflict (key) do nothing;

-- 3. Balises des modèles, calculées au même endroit pour le site et pour Apps Script
create or replace function public.fr_date(d date, long boolean default false) returns text language sql immutable as $$
  select case when d is null then '' else
    (case when long then (array['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'])[extract(dow from d)::int+1]
          else (array['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'])[extract(dow from d)::int+1] end)
    || ' ' || case when extract(day from d) = 1 then '1er' else extract(day from d)::int::text end
    || ' ' || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from d)::int]
    || ' ' || extract(year from d)::int end $$;

create or replace function public.fr_eur(n numeric) returns text language sql immutable as $$
  select case when n is null then 'XXX €' else
    replace(to_char(trunc(n), 'FM999,999,990'), ',', ' ')
    || case when n <> trunc(n) then ',' || lpad(round((n - trunc(n)) * 100)::text, 2, '0') else '' end || ' €' end $$;

create or replace function public.mail_vars(p_show uuid, p_contact uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; c contacts%rowtype;
  acpt numeric; vat numeric; site text;
begin
  select * into s from shows where id = p_show;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  select * into c from contacts where id = coalesce(p_contact, s.conf_contact_id);
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  acpt := coalesce(acpt, nullif(setting_text('default_acompte_pct'), '')::numeric, 50);
  vat := coalesce(s.vat_rate, 5.5);
  site := coalesce(nullif(setting_text('site_url'), ''), 'https://antcb.github.io/lartbo-matrice/');
  return jsonb_build_object(
    'artiste', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', fr_date(s.date),
    'date_longue', fr_date(s.date, true),
    'ville', coalesce(s.city, st.city, ''),
    'cp', coalesce(nullif(st.postal_code, ''), s.department, ''),
    'lieu', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'adresse', coalesce(nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),
    'jauge', coalesce(s.capacity, st.capacity_1)::text,
    'cachet_ht', fr_eur(s.fee_ht),
    'cachet_ttc', fr_eur(round(s.fee_ht * (1 + vat / 100), 2)),
    'tva', replace(rtrim(rtrim(to_char(vat, 'FM990.99'), '0'), '.'), '.', ',') || ' %',
    'type_contrat', coalesce(s.contract_type, ''),
    'acompte_pct', replace(rtrim(rtrim(to_char(acpt, 'FM990.99'), '0'), '.'), '.', ',') || '%',
    'contact', coalesce(nullif(c.first_name, ''), c.display_name, ''),
    'contact_email', coalesce(c.email, ''),
    'structure', coalesce(st.name, ''),
    'lien_fiche', site || 'fiche.html?t=' || s.fiche_token
  );
end $$;


-- 4. Fiche de renseignements publique (lien unique par date, sans compte)
create or replace function public.fiche_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; pays jsonb; vat numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  vat := coalesce(s.vat_rate, 5.5);
  select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'kind', p.kind, 'pct', p.pct,
           'ht', coalesce(p.amount, round(s.fee_ht * p.pct) / 100)) order by p.sort), '[]')
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde');
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')), 'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type,
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'capacity', coalesce(s.capacity, st.capacity_1),
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at,
    'locked', s.contract_sent is not null);
end $$;

create or replace function public.fiche_submit(p_token text, p_admin jsonb, p_fiche jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; adm jsonb := '{}'; k text;
  allowed text[] := array['legal_name','legal_form','siret','ape','vat','licence','address','postal_code','city','country',
                          'signatory','signatory_role','email','phone','billing_email','notes'];
begin
  if p_token is null or length(p_token) < 16 then raise exception 'Lien invalide'; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then raise exception 'Lien invalide'; end if;
  if s.contract_sent is not null then raise exception 'Le contrat a déjà été envoyé : la fiche ne peut plus être modifiée. Écris-nous à production@lartboristerie.com.'; end if;
  if length(coalesce(p_admin::text,'')) + length(coalesce(p_fiche::text,'')) > 30000 then raise exception 'Fiche trop longue'; end if;
  foreach k in array allowed loop
    if p_admin ? k then adm := adm || jsonb_build_object(k, left(p_admin->>k, 2000)); end if;
  end loop;
  if s.structure_id is not null then
    update structures set admin = coalesce(admin, '{}') || adm, updated_at = now() where id = s.structure_id;
  end if;
  update shows set fiche = coalesce(p_fiche, '{}') || jsonb_build_object('admin', adm),
                   fiche_submitted_at = now(), precontract_done = coalesce(precontract_done, current_date)
    where id = s.id;
  insert into notifications (kind, title, body, show_id, project_id, dedupe_key)
    values ('fiche', 'Fiche de renseignements remplie — ' || coalesce(s.venue, ''),
            concat_ws(' · ', to_char(s.date, 'DD/MM/YYYY'), s.city, p_admin->>'legal_name'),
            s.id, s.project_id, 'fiche:' || s.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fiche_get(text) from public;
revoke execute on function public.fiche_submit(text, jsonb, jsonb) from public;
grant execute on function public.fiche_get(text) to anon, authenticated;
grant execute on function public.fiche_submit(text, jsonb, jsonb) to anon, authenticated;

-- 5. Les modèles de mail (9 modèles d'origine + 2 génériques) ont été importés directement
--    dans la table mail_templates (contenu non versionné ici : coordonnées de l'équipe et des artistes).
--    Le secret drive_webhook_secret a été généré dans settings (à coller dans le script Apps Script).
revoke execute on function public.mail_vars(uuid, uuid) from public, anon;
grant execute on function public.mail_vars(uuid, uuid) to authenticated, service_role;
