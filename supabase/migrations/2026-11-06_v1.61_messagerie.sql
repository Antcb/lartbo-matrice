-- =====================================================================================================
-- v1.61 — Messagerie intégrée, boîte anthony@ (demande d'Anthony du 06/11/2026). Développée et essayée HORS production.
-- Gmail reste la référence (messages, libellés, lu / non lu, archive, corbeille) ; ces tables en gardent une copie de travail pour
-- l'espace Mails, le rattachement et le journal des suivis. Aucune donnée existante modifiée.
--   - mail_threads : une ligne par conversation Gmail (boîte + identifiant Gmail uniques) et son rattachement ;
--   - mail_messages : une ligne par message Gmail (boîte + identifiant uniques → aucun doublon aux synchronisations et reprises) ;
--   - mail_sync_state : dernier passage, point de reprise Gmail (historyId), dernière erreur — affichés dans l'espace Mails ;
--   - mail_link_thread : rattachement (règles d'Anthony) ; mail_journal : journal du suivi + relances suspendues à la réponse ;
--   - mail_sync_tick : appelée toutes les 5 min par la tâche planifiée « mail-sync » ; ne fait RIEN tant que l'adresse de la fonction
--     n'est pas inscrite dans private.sync_urls (schéma privé : ni l'application ni un compte de l'équipe ne peuvent l'écrire, donc le
--     code des scripts Google ne peut pas être envoyé ailleurs — relecture v1.61, B2). Activation en production seulement sur autorisation.
-- Retour arrière : désactiver la tâche planifiée (ou retirer la ligne de private.sync_urls) ; les tables peuvent rester (vides = aucun effet).
-- =====================================================================================================
create table if not exists public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  mailbox text not null default 'anthony',
  gmail_thread_id text not null,
  subject text,
  snippet text,
  participants text[] not null default '{}',          -- adresses (minuscules), sans la boîte elle-même
  last_message_at timestamptz,
  message_count integer not null default 0,
  unread boolean not null default false,
  labels text[] not null default '{}',                 -- identifiants Gmail (INBOX, UNREAD, Label_…)
  structure_id uuid references public.structures(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  show_id uuid references public.shows(id) on delete set null,
  link_status text not null default 'a_rattacher' check (link_status in ('auto', 'manuel', 'a_rattacher')),
  link_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox, gmail_thread_id)
);
comment on table public.mail_threads is 'Conversations Gmail (copie de travail ; Gmail fait référence) et leur rattachement (v1.61)';
create index if not exists mail_threads_last_idx on public.mail_threads (mailbox, last_message_at desc);
create index if not exists mail_threads_structure_idx on public.mail_threads (structure_id);
create index if not exists mail_threads_prospect_idx on public.mail_threads (prospect_id);

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  mailbox text not null default 'anthony',
  gmail_message_id text not null,
  rfc_message_id text,
  direction text not null check (direction in ('in', 'out')),
  from_addr text,
  from_name text,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text,
  snippet text,
  sent_at timestamptz,
  attachments jsonb not null default '[]',             -- [{name, size, mime}] (le contenu reste dans Gmail)
  prospect_log_id uuid references public.prospect_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mailbox, gmail_message_id)
);
comment on table public.mail_messages is 'Messages Gmail (copie de travail, sans le corps) ; une seule ligne par message (v1.61)';
create index if not exists mail_messages_thread_idx on public.mail_messages (thread_id, sent_at);

create table if not exists public.mail_sync_state (
  mailbox text primary key,
  history_id text,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  pending text[] not null default '{}',                 -- conversations changées restant à lire (plus de 30 à la fois : lues aux passages suivants)
  updated_at timestamptz not null default now()
);
alter table public.mail_sync_state add column if not exists pending text[] not null default '{}';
comment on table public.mail_sync_state is 'Synchronisation de la messagerie : point de reprise Gmail, dernier passage, dernière erreur (v1.61)';

-- message Gmail d'une ligne du journal écrite par L'ArtBotrice (prospection, relance, réponse) : la synchronisation la reconnaît (aucun doublon)
alter table public.prospect_logs add column if not exists gmail_message_id text;
create index if not exists prospect_logs_gmail_message on public.prospect_logs (gmail_message_id) where gmail_message_id is not null;

do $$ declare t text; begin
  foreach t in array array['mail_threads', 'mail_messages', 'mail_sync_state'] loop
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
drop trigger if exists mail_threads_touch on public.mail_threads;
create trigger mail_threads_touch before update on public.mail_threads for each row execute function public.touch_updated_at();

-- ── Rattachement d'une conversation (règles d'Anthony du 06/11/2026) ───────────────────────────────────────────────
-- 1. déjà rattachée (auto ou manuel) : rien ne change ;
-- 2. fil de prospection envoyé depuis L'ArtBotrice (prospects.mail_thread_id) : ce suivi ;
-- 3. sinon, adresses EXACTES des participants comparées aux adresses des contacts (jamais le seul domaine, jamais « le premier trouvé ») :
--    une seule structure ET au plus un suivi ouvert → rattachement automatique, avec sa raison ; tout le reste → « À rattacher », avec la raison.
create or replace function public.mail_link_thread(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t mail_threads%rowtype; pr record; n_contacts int; n_struct int; st uuid; n_suivis int; su uuid; reason text;
begin
  select * into t from mail_threads where id = p_thread for update;
  if not found or t.link_status in ('auto', 'manuel') then return; end if;
  select id, structure_id, project_id, project_ids into pr from prospects where mail_thread_id = t.gmail_thread_id order by created_at limit 1;
  if pr.id is not null then
    update mail_threads set prospect_id = pr.id, structure_id = pr.structure_id, project_id = coalesce(project_id, pr.project_id, pr.project_ids[1]),
      link_status = 'auto', link_reason = 'Fil de prospection envoyé depuis L''ArtBotrice' where id = p_thread;
    return;
  end if;
  with addr as (select distinct lower(btrim(a)) a from unnest(t.participants) a where btrim(a) <> ''),
       ct as (select distinct c.id from contacts c join addr on addr.a in (lower(btrim(c.email)), lower(btrim(c.email_2))))
  select (select count(*) from ct),
         (select count(distinct cs.structure_id) from contact_structures cs where cs.contact_id in (select id from ct)),
         (select min(cs.structure_id::text)::uuid from contact_structures cs where cs.contact_id in (select id from ct))
    into n_contacts, n_struct, st;
  if n_contacts = 0 then reason := 'Contact inconnu : aucun contact n''a ces adresses';
  elsif n_struct = 0 then reason := 'Contact connu, rattaché à aucune structure';
  elsif n_struct > 1 then reason := 'Le contact appartient à plusieurs structures : à choisir';
  else
    select count(*), min(id::text)::uuid into n_suivis, su from prospects where structure_id = st and coalesce(status, '') not in ('Closed', 'Confirmed');
    if n_suivis > 1 then reason := 'Plusieurs suivis ouverts pour cette structure : à choisir';
    elsif n_suivis = 0 then reason := 'Aucun suivi ouvert pour cette structure : à choisir ou à créer';
    else
      update mail_threads set structure_id = st, prospect_id = su, link_status = 'auto',
        link_reason = 'Contact connu d''une seule structure et d''un seul suivi ouvert' where id = p_thread;
      return;
    end if;
  end if;
  update mail_threads set link_status = 'a_rattacher', link_reason = reason where id = p_thread;
end $$;

-- ── Journal du suivi (une seule ligne par message) et relances suspendues à la réponse ──────────────────────────────────
create or replace function public.mail_journal(p_thread uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t mail_threads%rowtype; m record; log_id uuid; n int := 0; st_name text; rt record;
begin
  select * into t from mail_threads where id = p_thread;
  if not found or t.prospect_id is null then return 0; end if;
  select s.name into st_name from structures s where s.id = t.structure_id;
  for m in select * from mail_messages where thread_id = p_thread and prospect_log_id is null order by sent_at for update loop
    -- mail envoyé depuis L'ArtBotrice : déjà au journal. Reconnu par son identifiant Gmail ; pour les lignes d'avant la v1.61 (sans
    -- identifiant), par une ligne « Mail » du même suivi écrite par l'équipe le même jour (ou brouillon sans date), pas encore reliée.
    log_id := null;
    if m.direction = 'out' then
      select l.id into log_id from prospect_logs l where l.prospect_id = t.prospect_id and l.gmail_message_id = m.gmail_message_id limit 1;
      if log_id is null then
        select l.id into log_id from prospect_logs l
          where l.prospect_id = t.prospect_id and l.kind = 'Mail' and coalesce(l.author, '') <> 'Messagerie' and l.gmail_message_id is null
            and l.body like '**%'   -- ligne écrite par un envoi de L'ArtBotrice (« **Prospection… », « **Relance… », « **… envoyée** »), jamais une note
            and (l.date is null or l.date = (coalesce(m.sent_at, now()) at time zone 'Europe/Paris')::date)
            and l.created_at <= coalesce(m.sent_at, now()) + interval '1 day'
            and not exists (select 1 from mail_messages x where x.prospect_log_id = l.id)
          order by l.created_at desc limit 1;
      end if;
      if log_id is not null then
        update mail_messages set prospect_log_id = log_id where id = m.id;
        update prospect_logs set gmail_message_id = m.gmail_message_id where id = log_id and gmail_message_id is null;
        continue;
      end if;
    end if;
    insert into prospect_logs (prospect_id, date, kind, contact_name, body, author, gmail_message_id)
    values (t.prospect_id, (coalesce(m.sent_at, now()) at time zone 'Europe/Paris')::date, 'Mail',
      case when m.direction = 'in' then coalesce(nullif(m.from_name, ''), m.from_addr) end,
      (case when m.direction = 'in' then 'Mail reçu de ' || coalesce(m.from_addr, '?') else 'Mail envoyé à ' || array_to_string(m.to_addrs || m.cc_addrs, ', ') end)
        || ' — « ' || coalesce(m.subject, '') || ' »'
        || case when jsonb_array_length(m.attachments) > 0 then ' — pièces jointes : ' || (select string_agg(a->>'name', ', ') from jsonb_array_elements(m.attachments) a) else '' end
        || case when coalesce(m.snippet, '') <> '' then E'\n' || m.snippet else '' end,
      'Messagerie', m.gmail_message_id)
    returning id into log_id;
    update mail_messages set prospect_log_id = log_id where id = m.id;
    n := n + 1;
    -- réponse reçue : les relances automatiques ouvertes du suivi, créées AVANT ce message, sont suspendues (annulées, avec la raison)
    -- et la réponse est signalée ; « Programmer une relance » en recrée une au besoin
    if m.direction = 'in' then
      for rt in select id from tasks where prospect_id = t.prospect_id and auto_kind in ('relance_mail', 'relance_tel')
                  and status not in ('Done', 'Cancelled') and created_at < coalesce(m.sent_at, now()) loop
        update tasks set status = 'Cancelled', done_at = now(),
          notes = coalesce(notes || E'\n', '') || 'Suspendue automatiquement : réponse reçue le '
            || to_char(coalesce(m.sent_at, now()) at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' (' || coalesce(m.from_addr, '?') || ').'
          where id = rt.id;
      end loop;
      -- signalement : seulement pour une réponse récente (pas pour l'historique repris à la première synchronisation)
      if coalesce(m.sent_at, now()) > now() - interval '3 days' then
      insert into notifications (kind, title, body, dedupe_key)
        values ('suivi', 'Réponse reçue — ' || coalesce(st_name, 'suivi'), coalesce(m.from_addr, '') || ' : « ' || coalesce(m.subject, '') || ' »',
          'mail-reponse:' || m.id)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  end loop;
  return n;
end $$;

/** Après chaque synchronisation : rattachement puis journal des conversations touchées */
create or replace function public.mail_process(p_threads uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare i uuid; n int := 0;
begin
  foreach i in array coalesce(p_threads, '{}') loop
    perform public.mail_link_thread(i);
    n := n + public.mail_journal(i);
  end loop;
  return n;
end $$;

/** Rattachement manuel (équipe) : structure, suivi, artiste, date ; le journal suit */
create or replace function public.mail_link_manual(p_thread uuid, p_structure uuid, p_prospect uuid, p_project uuid, p_show uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe'; end if;
  if p_prospect is not null and p_structure is not null and not exists (select 1 from prospects where id = p_prospect and structure_id = p_structure) then
    raise exception 'Ce suivi n''appartient pas à cette structure';
  end if;
  -- suivi corrigé : les lignes écrites par la messagerie suivent la conversation (les lignes écrites par l'équipe restent où elles sont)
  update prospect_logs l set prospect_id = p_prospect
    where p_prospect is not null and l.author = 'Messagerie' and l.prospect_id is distinct from p_prospect
      and l.id in (select prospect_log_id from mail_messages where thread_id = p_thread and prospect_log_id is not null);
  update mail_messages set prospect_log_id = null
    where thread_id = p_thread and prospect_log_id in (select id from prospect_logs where author is distinct from 'Messagerie')
      and p_prospect is distinct from (select prospect_id from mail_threads where id = p_thread);
  update mail_threads set structure_id = p_structure, prospect_id = p_prospect, project_id = p_project, show_id = p_show,
    link_status = case when p_structure is null and p_prospect is null then 'a_rattacher' else 'manuel' end,
    link_reason = case when p_structure is null and p_prospect is null then 'Rattachement retiré' else 'Rattaché à la main' end
    where id = p_thread;
  return public.mail_journal(p_thread);
end $$;

revoke all on function public.mail_link_thread(uuid), public.mail_journal(uuid), public.mail_process(uuid[]) from public, anon, authenticated;
grant execute on function public.mail_link_thread(uuid), public.mail_journal(uuid), public.mail_process(uuid[]) to service_role;
revoke all on function public.mail_link_manual(uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.mail_link_manual(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- ── Synchronisation toutes les 5 minutes : appel de la fonction serveur « mail-sync » ; inactive tant que private.sync_urls n'a pas son adresse ──
-- adresses des fonctions appelées par les tâches planifiées : schéma privé (inaccessible à l'application et aux comptes de l'équipe)
create table if not exists private.sync_urls (key text primary key, url text not null);
revoke all on private.sync_urls from public, anon, authenticated;
create or replace function public.mail_sync_tick() returns void
language plpgsql security definer set search_path = public as $$
declare u text := (select url from private.sync_urls where key = 'mail-sync'); sec text := public.setting_text('drive_webhook_secret');
begin
  if u is null or u !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/mail-sync$' or coalesce(sec, '') = '' then return; end if;
  perform net.http_post(url := u, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := jsonb_build_object('mailbox', 'anthony'), timeout_milliseconds := 120000);
end $$;
revoke all on function public.mail_sync_tick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and not exists (select 1 from cron.job where jobname = 'mail-sync') then
    perform cron.schedule('mail-sync', '*/5 * * * *', 'select public.mail_sync_tick()');
  end if;
end $$;
