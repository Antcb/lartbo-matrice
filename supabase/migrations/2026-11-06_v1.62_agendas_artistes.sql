-- =====================================================================================================
-- Calendriers Google des artistes (demande d'Anthony du 06/11/2026) — LECTURE SEULE, Google → L'ArtBotrice.
-- Développée et essayée HORS production. Aucune donnée existante modifiée ; aucune ligne financière.
--   - artist_calendars : un agenda par artiste, choisi explicitement ; actif / en pause / déconnecté ; dernier passage et erreur ;
--   - artist_calendar_events : occurrences lues dans Google (récurrences développées), une ligne par occurrence (aucun doublon) ;
--     un événement supprimé dans Google est marqué « supprimé » (jamais effacé en silence) ; « Show » + ville → repère de carte ;
--     association EXPLICITE possible avec une date « Option / Confirmée artiste » existante (jamais de conversion).
--   - temps réel : les deux tables sont publiées (les autres postes voient les changements) ; la synchronisation n'écrit que les lignes
--     réellement modifiées (cal-sync/regles.ts planSync) ; l'agenda deux fois par passage (début de lecture, résultat) ;
--   - cal_sync_tick : appelée par la tâche planifiée « cal-sync » ; ne fait RIEN tant que l'adresse de la fonction n'est pas inscrite dans
--     private.sync_urls (schéma privé : aucun compte connecté ne peut l'écrire, le code des scripts Google ne part jamais ailleurs).
-- Retour arrière : désactiver la tâche planifiée (ou retirer la ligne de private.sync_urls) ; tables vides = aucun effet.
-- =====================================================================================================
-- ── 0. Gardes (rejouable ; rien n'est appliqué si une garde échoue) ──
-- Dépendances : is_team() (RLS), touch_updated_at() (schema.sql), projects, shows, schéma privé + import_secrets / import_secret (v1.22).
-- Empreintes : si les tables, la table des adresses ou la fonction de la tâche existent déjà, elles doivent être CELLES de cette
-- migration (colonnes : nom, type, nullabilité) ; sinon arrêt — jamais de « create if not exists » silencieux sur une autre structure.
-- Empreintes relevées sur une base locale jetable (supabase/repetitions/2026-11-08_v1.62_agendas_*.sql).
do $m$
declare fp text; b text;
begin
  if to_regprocedure('public.is_team()') is null or to_regprocedure('public.touch_updated_at()') is null
     or to_regclass('public.projects') is null or to_regclass('public.shows') is null
     or to_regclass('private.import_secrets') is null or to_regprocedure('public.import_secret(text)') is null then
    raise exception 'v1.62 agendas : dépendance absente (is_team, touch_updated_at, projects, shows, private.import_secrets ou import_secret) : migration arrêtée, rien n''est appliqué';
  end if;
  select md5(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)) into fp
    from information_schema.columns where table_schema = 'public' and table_name = 'artist_calendars';
  if fp is not null and fp <> 'b0f1f2d53e56ab8a172fe001ab93ec24' then
    raise exception 'v1.62 agendas : artist_calendars existe avec une autre structure (empreinte %) : migration arrêtée, rien n''est appliqué', fp;
  end if;
  select md5(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)) into fp
    from information_schema.columns where table_schema = 'public' and table_name = 'artist_calendar_events';
  if fp is not null and fp <> 'bd0046c9affa7c4dbe438ef4d06cd7ef' then
    raise exception 'v1.62 agendas : artist_calendar_events existe avec une autre structure (empreinte %) : migration arrêtée, rien n''est appliqué', fp;
  end if;
  -- table des adresses des synchronisations, partagée avec la messagerie (mail-sync) : même structure exigée
  select md5(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)) into fp
    from information_schema.columns where table_schema = 'private' and table_name = 'sync_urls';
  if fp is not null and fp <> '5c2ff2b3259fdbaa9f00f41bed5f966e' then
    raise exception 'v1.62 agendas : private.sync_urls existe avec une autre structure (empreinte %) : migration arrêtée, rien n''est appliqué', fp;
  end if;
  if to_regprocedure('public.cal_sync_tick()') is not null then
    b := pg_get_functiondef('public.cal_sync_tick()'::regprocedure);
    if position('v1.62 cal_sync_tick' in b) = 0 then
      raise exception 'v1.62 agendas : cal_sync_tick existe déjà sous une autre version (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
    end if;
  end if;
end $m$;

create table if not exists public.artist_calendars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,   -- un agenda par artiste
  calendar_id text not null,
  calendar_name text,
  access text,                                   -- niveau d'accès donné par l'artiste (reader, freeBusyReader…)
  status text not null default 'actif' check (status in ('actif', 'pause', 'deconnecte')),
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  mode text,                                     -- 'details' ou 'disponibilites' (lu au dernier passage)
  default_country text not null default 'FR',    -- pays retenu quand le lieu d'un événement n'en écrit pas (France par défaut, réglable)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.artist_calendars is 'Agenda Google de chaque artiste, lu par production@ (lecture seule)';

create table if not exists public.artist_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_ref uuid not null references public.artist_calendars(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  gcal_event_id text not null,                   -- identifiant de l'OCCURRENCE (récurrence développée par Google)
  recurring_id text,
  start_at timestamptz,                          -- événement à l'heure (fuseau de l'événement converti)
  end_at timestamptz,
  all_day boolean not null default false,
  start_date date,                               -- journée(s) entière(s) : du start_date inclus au end_date EXCLU (règle Google)
  end_date date,
  busy boolean not null default true,            -- « Disponible » dans Google (transparent) : ne bloque pas
  private boolean not null default false,        -- privé ou disponibilités seules : affiché « Indisponible », sans détail
  title text,
  location text,
  is_show boolean not null default false,        -- titre contenant « show » (sans tenir compte de la casse)
  city text, lat double precision, lng double precision,
  geo_status text not null default 'sans_lieu' check (geo_status in ('ok', 'a_preciser', 'sans_lieu')),
  geo_key text,                                  -- pays par défaut | lieu ayant servi à la localisation (recalcul si l'un change)
  time_zone text,                                -- fuseau de l'événement à l'heure (jour local affiché ; conflits sur les instants)
  show_id uuid references public.shows(id) on delete set null,   -- association explicite avec une date existante
  deleted_at timestamptz,                        -- supprimé dans Google (ou hors agenda) : gardé, plus affiché
  updated_at timestamptz not null default now(),
  unique (calendar_ref, gcal_event_id)
);
comment on table public.artist_calendar_events is 'Occurrences des agendas des artistes (copie en lecture ; Google fait référence)';
-- un agenda Google n'est relié qu'à un seul artiste à la fois (même contrôle dans l'application, calConnect)
create unique index if not exists artist_calendars_un_artiste on public.artist_calendars (calendar_id) where status <> 'deconnecte';
create index if not exists ace_project_idx on public.artist_calendar_events (project_id, start_at, start_date) where deleted_at is null;

do $$ declare t text; begin
  foreach t in array array['artist_calendars', 'artist_calendar_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated using (public.is_team()) with check (public.is_team())', t);
    execute format('revoke all on public.%I from anon', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
drop trigger if exists artist_calendars_touch on public.artist_calendars;
create trigger artist_calendars_touch before update on public.artist_calendars for each row execute function public.touch_updated_at();

-- ── Synchronisation planifiée (toutes les 5 min) : appel de la fonction serveur « cal-sync » ; inactive tant que cal_sync_url est vide ──
create table if not exists private.sync_urls (key text primary key, url text not null);
revoke all on private.sync_urls from public, anon, authenticated;
-- secret serveur DÉDIÉ des appels automatiques (« cal_sync_hook ») : tiré au hasard ici, rangé dans le schéma privé (comme le jeton
-- Pennylane), lu seulement par la tâche planifiée et par la fonction serveur (import_secret, réservé au rôle serveur).
-- Personne ne le saisit ni ne le voit ; il n'est jamais envoyé au navigateur, placé dans une adresse ou écrit dans un journal.
insert into private.import_secrets (key, value)
  values ('cal_sync_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
-- secret DÉDIÉ du script Google des agendas (« cal_script_secret », relecture de 976ea64, F5) : la fonction cal-sync l'envoie au seul
-- projet « Matrice Agendas » (propriété SECRET_AGENDAS, recopiée une fois par Anthony depuis le Table Editor du projet) ; distinct du
-- code des autres scripts Google (drive_webhook_secret) et du secret de la tâche planifiée. Jamais régénéré par un nouveau passage.
insert into private.import_secrets (key, value)
  values ('cal_script_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

create or replace function public.cal_sync_tick() returns void
language plpgsql security definer set search_path = public as $$
-- v1.62 cal_sync_tick (marqueur lu par la garde §0)
declare u text := (select url from private.sync_urls where key = 'cal-sync'); sec text := (select value from private.import_secrets where key = 'cal_sync_hook');
begin
  if u is null or u !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/cal-sync$' or coalesce(sec, '') = '' then return; end if;
  if not exists (select 1 from artist_calendars where status = 'actif') then return; end if;
  perform net.http_post(url := u, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := jsonb_build_object('mode', 'sync'), timeout_milliseconds := 120000);
end $$;
revoke all on function public.cal_sync_tick() from public, anon, authenticated;

-- tâche planifiée : seulement si pg_cron est installé (cron.job n'existe pas sinon : requête dynamique, jamais analysée sans l'extension)
do $$ declare n int; begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select count(*) from cron.job where jobname = $1' into n using 'cal-sync';
    if n = 0 then execute 'select cron.schedule($1, $2, $3)' using 'cal-sync', '*/5 * * * *', 'select public.cal_sync_tick()'; end if;
  end if;
end $$;
