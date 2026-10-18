-- v1.12 — module Salariés : fiches, questionnaire en ligne, pièces justificatives rangées dans le Drive

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  last_name text, first_name text, email text, phone text, role text,
  active boolean not null default true,
  info jsonb not null default '{}',          -- état civil, adresse, sécurité sociale, IBAN, pièces d'identité… (voir js/rh-fields.js)
  docs jsonb not null default '[]',          -- [{kind, label, path (stockage en attente), name, file_id (Drive), at}]
  drive_folder_id text,
  form_token text unique default replace(gen_random_uuid()::text, '-', ''),
  form_sent_at timestamptz, form_submitted_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.employees enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='employees' and policyname='team_all') then
    create policy team_all on public.employees for all to authenticated using (is_team()) with check (is_team());
  end if;
end $$;

alter table public.project_members add column if not exists employee_id uuid references public.employees(id) on delete set null;

-- Reprise des membres de projets existants (un salarié par personne, repérée par mail ou nom)
do $$ declare m record; e uuid; begin
  for m in select * from project_members where employee_id is null order by created_at loop
    select id into e from employees
      where (m.email is not null and lower(email) = lower(m.email))
         or (lower(coalesce(last_name,'')) = lower(coalesce(m.last_name,'')) and lower(coalesce(first_name,'')) = lower(coalesce(m.first_name,'')))
      limit 1;
    if e is null then
      insert into employees(last_name, first_name, email, phone, role, info)
        values (m.last_name, m.first_name, m.email, m.phone, m.role,
                jsonb_strip_nulls(jsonb_build_object('birth_date', m.birth_date, 'address', m.address)) || jsonb_build_object('movinmotion', coalesce(m.data, '{}')))
        returning id into e;
    end if;
    update project_members set employee_id = e where id = m.id;
  end loop;
end $$;

insert into public.settings(key, value) values ('employees_folder_id', '"1UWRtwlw46-yhh4OIkrz0Z0BMkV2mUYk2"') on conflict (key) do nothing;

-- Stockage temporaire des pièces envoyées par le questionnaire (rangées ensuite dans le Drive puis supprimées)
insert into storage.buckets (id, name, public) values ('rh', 'rh', false) on conflict (id) do nothing;

create or replace function public.rh_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_token is not null and length(p_token) >= 16 and exists (select 1 from employees where form_token = p_token and active)
$$;
grant execute on function public.rh_token_ok(text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rh_upload_with_token') then
    create policy rh_upload_with_token on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'rh' and public.rh_token_ok((storage.foldername(name))[1]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rh_team_all') then
    create policy rh_team_all on storage.objects for all to authenticated
      using (bucket_id = 'rh' and public.is_team()) with check (bucket_id = 'rh' and public.is_team());
  end if;
end $$;

-- Questionnaire public : les numéros sensibles ne sont jamais renvoyés, seulement « déjà renseigné »
create or replace function public.rh_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e employees%rowtype; info jsonb; k text;
  secret text[] := array['ssn','iban','bic','id_no','passport_no','licence_no'];
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into e from employees where form_token = p_token and active;
  if not found then return null; end if;
  info := e.info - 'movinmotion';
  foreach k in array secret loop
    if coalesce(info->>k, '') <> '' then info := info || jsonb_build_object(k, '__rempli__'); end if;
  end loop;
  return jsonb_build_object('first_name', e.first_name, 'last_name', e.last_name, 'email', e.email, 'phone', e.phone,
    'info', info, 'docs', (select coalesce(jsonb_agg(distinct d->>'kind'), '[]') from jsonb_array_elements(e.docs) d),
    'submitted_at', e.form_submitted_at);
end $$;

create or replace function public.rh_submit(p_token text, p_main jsonb, p_info jsonb, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e employees%rowtype; clean jsonb := '{}'; k text; d jsonb; docs jsonb;
begin
  select * into e from employees where form_token = p_token and active;
  if not found then raise exception 'Lien invalide'; end if;
  if length(coalesce(p_info::text,'')) + length(coalesce(p_docs::text,'')) > 30000 then raise exception 'Questionnaire trop long'; end if;
  for k in select jsonb_object_keys(coalesce(p_info, '{}')) loop
    if coalesce(p_info->>k, '') <> '' and p_info->>k <> '__rempli__' then clean := clean || jsonb_build_object(k, left(p_info->>k, 500)); end if;
  end loop;
  docs := e.docs;
  for d in select * from jsonb_array_elements(coalesce(p_docs, '[]')) loop
    if (d->>'path') like p_token || '/%' then
      docs := docs || jsonb_build_array(jsonb_build_object('kind', d->>'kind', 'label', d->>'label', 'path', d->>'path', 'name', d->>'name', 'at', now()));
    end if;
  end loop;
  update employees set
    first_name = coalesce(nullif(p_main->>'first_name', ''), first_name),
    last_name = coalesce(nullif(p_main->>'last_name', ''), last_name),
    email = coalesce(nullif(p_main->>'email', ''), email),
    phone = coalesce(nullif(p_main->>'phone', ''), phone),
    info = info || clean, docs = docs, form_submitted_at = now(), updated_at = now()
  where id = e.id;
  insert into notifications (kind, title, body, dedupe_key)
    values ('rh', 'Fiche salarié remplie — ' || concat_ws(' ', upper(coalesce(nullif(p_main->>'last_name',''), e.last_name)), coalesce(nullif(p_main->>'first_name',''), e.first_name)),
            'Pièces à ranger dans le Drive : ' || jsonb_array_length(coalesce(p_docs, '[]')),
            'rh:' || e.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.rh_get(text) from public;
revoke execute on function public.rh_submit(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.rh_get(text) to anon, authenticated;
grant execute on function public.rh_submit(text, jsonb, jsonb, jsonb) to anon, authenticated;
