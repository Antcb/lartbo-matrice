-- v1.28 : fiche artiste à remplir par l'artiste (lien propre à chaque artiste), pièces rangées dans son dossier Drive
alter table public.projects add column if not exists artist_token text unique;
alter table public.projects add column if not exists artist_info jsonb not null default '{}';
alter table public.projects add column if not exists artist_docs jsonb not null default '[]';
alter table public.projects add column if not exists artist_submitted_at timestamptz;
update public.projects set artist_token = encode(extensions.gen_random_bytes(16), 'hex') where artist_token is null;
alter table public.projects alter column artist_token set default encode(extensions.gen_random_bytes(16), 'hex');

-- stockage temporaire des fichiers envoyés (rangés ensuite dans le Drive de l'artiste par le script, puis supprimés)
insert into storage.buckets (id, name, public) values ('artiste', 'artiste', false) on conflict (id) do nothing;

create or replace function public.artist_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_token is not null and length(p_token) >= 16 and exists (select 1 from projects where artist_token = p_token)
$$;
grant execute on function public.artist_token_ok(text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='artiste_upload_with_token') then
    create policy artiste_upload_with_token on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'artiste' and public.artist_token_ok((storage.foldername(name))[1]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='artiste_team_all') then
    create policy artiste_team_all on storage.objects for all to authenticated
      using (bucket_id = 'artiste' and public.is_team()) with check (bucket_id = 'artiste' and public.is_team());
  end if;
end $$;

-- page publique : nom de l'artiste et réponses déjà données (pour compléter ou corriger)
create or replace function public.artist_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p projects%rowtype;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into p from projects where artist_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object('name', trim(regexp_replace(p.name, '\s*•.*$', '')), 'info', p.artist_info,
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('kind', d->>'kind', 'name', d->>'name')), '[]') from jsonb_array_elements(p.artist_docs) d),
    'submitted_at', p.artist_submitted_at);
end $$;

create or replace function public.artist_submit(p_token text, p_info jsonb, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p projects%rowtype; d jsonb; v_docs jsonb;
begin
  select * into p from projects where artist_token = p_token for update;   -- verrou : le rangement Drive ne peut pas écrire en même temps
  if not found then raise exception 'Lien invalide'; end if;
  if length(coalesce(p_info::text,'')) + length(coalesce(p_docs::text,'')) > 60000 then raise exception 'Fiche trop longue'; end if;
  v_docs := coalesce(p.artist_docs, '[]');
  for d in select * from jsonb_array_elements(coalesce(p_docs, '[]')) loop
    if (d->>'path') like p_token || '/%' then
      v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', d->>'kind', 'label', d->>'label', 'path', d->>'path', 'name', left(d->>'name', 200), 'at', now()));
    end if;
  end loop;
  update projects set artist_info = coalesce(p_info, '{}'), artist_docs = v_docs, artist_submitted_at = now() where id = p.id;
  insert into notifications (kind, title, body, dedupe_key)
    values ('artiste', 'Fiche artiste remplie — ' || trim(regexp_replace(p.name, '\s*•.*$', '')),
            case when jsonb_array_length(coalesce(p_docs, '[]')) > 0 then jsonb_array_length(p_docs) || ' fichier(s) rangé(s) dans son dossier Drive' else 'Sans fichier' end,
            'artiste:' || p.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  -- rangement immédiat des fichiers dans le Drive de l'artiste (script Google de production@)
  if jsonb_array_length(coalesce(p_docs, '[]')) > 0 and coalesce(setting_text('drive_webhook_url'), '') <> '' then
    perform net.http_post(url := setting_text('drive_webhook_url'),
      body := jsonb_build_object('secret', setting_text('drive_webhook_secret'), 'action', 'artist_file_docs', 'project_id', p.id),
      timeout_milliseconds := 120000);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.artist_get(text) from public;
revoke execute on function public.artist_submit(text, jsonb, jsonb) from public;
grant execute on function public.artist_get(text) to anon, authenticated;
grant execute on function public.artist_submit(text, jsonb, jsonb) to anon, authenticated;

-- Rangement dans le Drive (script Google) : chaque fichier est réservé puis marqué rangé, un par un,
-- sans réécrire toute la liste (un envoi de l'artiste pendant le rangement n'est jamais perdu)
create or replace function public.artist_doc_claim(p_project uuid, p_path text) returns boolean
language plpgsql security definer set search_path = public as $$
declare docs jsonb; ok boolean := false;
begin
  select artist_docs into docs from projects where id = p_project for update;
  if docs is null then return false; end if;
  select jsonb_agg(case when d->>'path' = p_path and d->>'file_id' is null
      and (d->>'claimed_at' is null or (d->>'claimed_at')::timestamptz < now() - interval '15 minutes')
    then d || jsonb_build_object('claimed_at', now()) else d end order by i),
    bool_or(d->>'path' = p_path and d->>'file_id' is null and (d->>'claimed_at' is null or (d->>'claimed_at')::timestamptz < now() - interval '15 minutes'))
    into docs, ok from jsonb_array_elements(docs) with ordinality as t(d, i);
  if ok then update projects set artist_docs = docs where id = p_project; end if;
  return coalesce(ok, false);
end $$;
create or replace function public.artist_doc_filed(p_project uuid, p_path text, p_file_id text, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare docs jsonb;
begin
  select artist_docs into docs from projects where id = p_project for update;
  if docs is null then return false; end if;
  select jsonb_agg(case when d->>'path' = p_path then (d - 'claimed_at') || jsonb_build_object('path', null, 'file_id', p_file_id, 'drive_name', p_name) else d end order by i)
    into docs from jsonb_array_elements(docs) with ordinality as t(d, i);
  update projects set artist_docs = docs where id = p_project;
  return true;
end $$;
revoke execute on function public.artist_doc_claim(uuid, text) from public, anon, authenticated;
revoke execute on function public.artist_doc_filed(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.artist_doc_claim(uuid, text) to service_role;
grant execute on function public.artist_doc_filed(uuid, text, text, text) to service_role;
-- v1.30 : la fiche artiste crée / complète la structure administrative de l'artiste (reliée au projet)
-- et les membres de l'équipe (onglet Membres du projet)
create or replace function public.artist_submit(p_token text, p_info jsonb, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p projects%rowtype; d jsonb; v_docs jsonb; m jsonb; adm jsonb := '{}'; k text; st_id uuid; dup_id uuid; mem_id uuid; bd date;
begin
  select * into p from projects where artist_token = p_token for update;   -- verrou : le rangement Drive ne peut pas écrire en même temps
  if not found then raise exception 'Lien invalide'; end if;
  if length(coalesce(p_info::text,'')) + length(coalesce(p_docs::text,'')) > 60000 then raise exception 'Fiche trop longue'; end if;
  v_docs := coalesce(p.artist_docs, '[]');
  for d in select * from jsonb_array_elements(coalesce(p_docs, '[]')) loop
    if (d->>'path') like p_token || '/%' then
      v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', d->>'kind', 'label', d->>'label', 'path', d->>'path', 'name', left(d->>'name', 200), 'at', now()));
    end if;
  end loop;
  update projects set artist_info = coalesce(p_info, '{}'), artist_docs = v_docs, artist_submitted_at = now() where id = p.id;

  -- structure administrative : champs « adm_… » de la fiche → fiche structure (coordonnées administratives), reliée au projet
  for k in select jsonb_object_keys(coalesce(p_info, '{}')) loop
    if k like 'adm\_%' and coalesce(p_info->>k, '') <> '' then adm := adm || jsonb_build_object(substr(k, 5), left(p_info->>k, 300)); end if;
  end loop;
  if adm ? 'legal_name' or adm ? 'siret' then
    st_id := p.admin_structure_id;
    if st_id is null then
      -- une structure déjà en base (même SIRET) n'est jamais modifiée ni reliée sans l'équipe : on la signale seulement
      select id into dup_id from structures where adm ? 'siret' and regexp_replace(coalesce(admin->>'siret',''), '\D', '', 'g') = regexp_replace(adm->>'siret', '\D', '', 'g') and regexp_replace(adm->>'siret', '\D', '', 'g') <> '' limit 1;
      if dup_id is null then
        insert into structures (name, address, postal_code, city, country, admin, tags)
          values (coalesce(adm->>'legal_name', 'Structure de ' || p.name), adm->>'address', adm->>'postal_code', adm->>'city', coalesce(adm->>'country', 'France'), adm, array['Structure artiste'])
          returning id into st_id;
        update projects set admin_structure_id = st_id where id = p.id;
      else
        insert into notifications (kind, title, body, dedupe_key)
          values ('artiste', 'Structure à relier — ' || trim(regexp_replace(p.name, '\s*•.*$', '')),
            'Le SIRET donné dans la fiche artiste correspond à « ' || (select name from structures where id = dup_id) || ' ». À relier dans l''onglet Administratif du projet si c''est bien elle.',
            'artiste-structure:' || p.id || ':' || dup_id)
          on conflict (dedupe_key) do nothing;
      end if;
    else
      -- sa propre structure : on complète seulement ce qui manque (une info déjà connue n'est jamais remplacée par l'artiste)
      update structures set admin = adm || (select coalesce(jsonb_object_agg(e.key, e.value), '{}') from jsonb_each(coalesce(admin, '{}')) e where coalesce(e.value #>> '{}', '') <> ''),
        address = coalesce(nullif(address, ''), adm->>'address'), postal_code = coalesce(nullif(postal_code, ''), adm->>'postal_code'),
        city = coalesce(nullif(city, ''), adm->>'city'), country = coalesce(nullif(country, ''), adm->>'country'), updated_at = now()
        where id = st_id;
    end if;
  end if;

  -- membres (musiciens et techniciens) : ajoutés ou complétés dans l'onglet Membres du projet (même mail, ou même prénom + nom)
  for m in select * from jsonb_array_elements(case when jsonb_typeof(p_info->'members') = 'array' then p_info->'members' else '[]' end) loop
    if coalesce(m->>'first_name', '') = '' and coalesce(m->>'last_name', '') = '' then continue; end if;
    bd := null; mem_id := null;
    if coalesce(m->>'birth_date', '') ~ '^\d{1,2}/\d{1,2}/\d{4}$' then begin bd := to_date(m->>'birth_date', 'DD/MM/YYYY'); exception when others then bd := null; end;
    elsif coalesce(m->>'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then begin bd := (m->>'birth_date')::date; exception when others then bd := null; end; end if;
    select id into mem_id from project_members where project_id = p.id and (
      (coalesce(m->>'email', '') <> '' and lower(email) = lower(m->>'email'))
      or (lower(coalesce(first_name, '')) = lower(coalesce(m->>'first_name', '')) and lower(coalesce(last_name, '')) = lower(coalesce(m->>'last_name', '')))) limit 1;
    if mem_id is null then
      insert into project_members (project_id, first_name, last_name, role, email, phone, birth_date, address, data)
        values (p.id, nullif(m->>'first_name', ''), nullif(m->>'last_name', ''), nullif(m->>'role', ''), nullif(m->>'email', ''), nullif(m->>'phone', ''), bd,
          nullif(concat_ws(', ', nullif(m->>'city', ''), nullif(m->>'country', '')), ''),
          jsonb_strip_nulls(jsonb_build_object('city', nullif(m->>'city', ''), 'country', nullif(m->>'country', ''))));
    else
      update project_members set first_name = coalesce(nullif(m->>'first_name', ''), first_name), last_name = coalesce(nullif(m->>'last_name', ''), last_name),
        role = coalesce(nullif(m->>'role', ''), role), email = coalesce(nullif(m->>'email', ''), email), phone = coalesce(nullif(m->>'phone', ''), phone), birth_date = coalesce(bd, birth_date),
        address = coalesce(nullif(address, ''), nullif(concat_ws(', ', nullif(m->>'city', ''), nullif(m->>'country', '')), '')),
        data = coalesce(data, '{}') || jsonb_strip_nulls(jsonb_build_object('city', nullif(m->>'city', ''), 'country', nullif(m->>'country', '')))
        where id = mem_id;
    end if;
  end loop;

  insert into notifications (kind, title, body, dedupe_key)
    values ('artiste', 'Fiche artiste remplie — ' || trim(regexp_replace(p.name, '\s*•.*$', '')),
            case when jsonb_array_length(coalesce(p_docs, '[]')) > 0 then jsonb_array_length(p_docs) || ' fichier(s) rangé(s) dans son dossier Drive' else 'Sans fichier' end,
            'artiste:' || p.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  if jsonb_array_length(coalesce(p_docs, '[]')) > 0 and coalesce(setting_text('drive_webhook_url'), '') <> '' then
    perform net.http_post(url := setting_text('drive_webhook_url'),
      body := jsonb_build_object('secret', setting_text('drive_webhook_secret'), 'action', 'artist_file_docs', 'project_id', p.id),
      timeout_milliseconds := 120000);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.artist_submit(text, jsonb, jsonb) from public;
grant execute on function public.artist_submit(text, jsonb, jsonb) to anon, authenticated;
