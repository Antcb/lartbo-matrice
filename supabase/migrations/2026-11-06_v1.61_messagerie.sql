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
-- Rejouable (v1.63) : chaque objet est créé « s'il n'existe pas » ou remplacé à l'identique ; aucune donnée existante n'est réécrite.
-- Garde : s'arrête AVANT toute création si un prérequis manque (base d'une autre application, migration antérieure absente).
-- Une seule transaction (v1.63, relecture) : une erreur en cours de route n'en laisse aucune partie appliquée.
-- =====================================================================================================
begin;
do $$
declare manque text[] := '{}';
begin
  if to_regclass('public.prospects') is null then manque := manque || 'table prospects'::text; end if;
  if to_regclass('public.prospect_logs') is null then manque := manque || 'table prospect_logs'::text; end if;
  if to_regclass('public.contacts') is null or to_regclass('public.contact_structures') is null then manque := manque || 'tables contacts / contact_structures'::text; end if;
  if to_regclass('public.shows') is null or to_regclass('public.app_users') is null then manque := manque || 'tables shows / app_users'::text; end if;
  if to_regclass('public.tasks') is null or to_regclass('public.notifications') is null then manque := manque || 'tables tasks / notifications'::text; end if;
  if to_regclass('private.import_secrets') is null then manque := manque || 'private.import_secrets (migration v1.22)'::text; end if;
  if to_regprocedure('public.is_team()') is null then manque := manque || 'fonction is_team()'::text; end if;
  if to_regprocedure('public.touch_updated_at()') is null then manque := manque || 'fonction touch_updated_at()'::text; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospects' and column_name = 'mail_thread_id')
    then manque := manque || 'prospects.mail_thread_id (migration v1.18)'::text; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_logs' and column_name = 'import_key')
    then manque := manque || 'prospect_logs.import_key'::text; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'auto_kind')
    then manque := manque || 'tasks.auto_kind (migration v1.20)'::text; end if;
  if array_length(manque, 1) > 0 then
    raise exception 'Migration messagerie arrêtée, rien n''est créé : prérequis absents (%)', array_to_string(manque, ', ');
  end if;
end $$;
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
  ref_ids text[] not null default '{}',                -- Message-ID auxquels il répond (In-Reply-To, References) : conversation connue (v1.63)
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
alter table public.mail_messages add column if not exists ref_ids text[] not null default '{}';
-- (v1.63, relecture) avis de non-remise / réponse automatique reconnus par leurs en-têtes (script) ; relances suspendues par ce message
alter table public.mail_messages add column if not exists auto_kind text;
alter table public.mail_messages add column if not exists suspended_tasks uuid[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mail_messages_auto_kind_check') then
    alter table public.mail_messages add constraint mail_messages_auto_kind_check check (auto_kind in ('ndr', 'auto'));
  end if;
end $$;
create index if not exists mail_messages_rfc_idx on public.mail_messages (rfc_message_id) where rfc_message_id is not null;

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

-- ── Boîte anthony@ réservée au compte d'Anthony (décision du 08/11/2026) ─────────────────────────────────────────────────
-- Propriétaire de chaque boîte : schéma privé (ni l'application ni un compte de l'équipe ne peuvent le modifier ; changement = SQL).
-- Les conversations ne sont visibles que de lui ; les messages rattachés à un suivi restent dans le journal du suivi (droits habituels).
create table if not exists private.mailbox_owners (mailbox text primary key, email text not null);
revoke all on private.mailbox_owners from public, anon, authenticated;
insert into private.mailbox_owners (mailbox, email) values ('anthony', 'anthony@lartboristerie.com') on conflict (mailbox) do nothing;
create or replace function public.is_mailbox_owner(p_mailbox text default 'anthony') returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.is_team() and exists (select 1 from private.mailbox_owners o
    where o.mailbox = coalesce(p_mailbox, 'anthony') and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_mailbox_owner(text) from public, anon;
grant execute on function public.is_mailbox_owner(text) to authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['mail_threads', 'mail_messages', 'mail_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);   -- (version de travail : toute l'équipe ; jamais publiée)
    execute format('drop policy if exists mailbox_owner on public.%I', t);
    execute format('create policy mailbox_owner on public.%I for all to authenticated using (public.is_mailbox_owner(mailbox)) with check (public.is_mailbox_owner(mailbox))', t);
    execute format('revoke all on public.%I from anon', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
drop trigger if exists mail_threads_touch on public.mail_threads;
create trigger mail_threads_touch before update on public.mail_threads for each row execute function public.touch_updated_at();

-- ── Rattachement d'une conversation (règles d'Anthony du 06/11 et du 08/11/2026) ─────────────────────────────────────
-- 1. déjà rattachée (auto ou manuel) : rien ne change, elle garde son suivi ;
-- 2. fil de prospection envoyé depuis L'ArtBotrice (prospects.mail_thread_id) : ce suivi s'il est seul (plusieurs : choix demandé) ;
-- 3. conversation connue : un message répond (In-Reply-To / References) à un message d'une conversation déjà rattachée ou d'un mail
--    joint à un suivi (clé « msgid:<Message-ID> », dépose Apple Mail) — réponse faite depuis Apple Mail qui ouvre un nouveau fil
--    Gmail comprise : ce suivi s'il est seul (plusieurs : choix demandé) ;
-- 4. sinon, adresses EXACTES des participants comparées aux adresses des contacts (jamais le seul domaine, jamais « le premier trouvé ») :
--    plusieurs contacts d'une même structure désignent cette structure ; une seule structure ET un seul suivi ouvert → rattachement
--    automatique, avec sa raison ; tout le reste → « À rattacher », avec la raison (choix demandé dans l'espace Mails).
create or replace function public.mail_link_thread(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t mail_threads%rowtype; n_contacts int; n_struct int; st uuid; n_suivis int; su uuid; reason text; n int; pid uuid; refs text[];
begin
  select * into t from mail_threads where id = p_thread for update;
  if not found or t.link_status in ('auto', 'manuel') then return; end if;
  -- 2. fil de prospection
  select count(*), min(id::text)::uuid into n, pid from prospects where mail_thread_id = t.gmail_thread_id;
  if n = 1 then
    update mail_threads m set prospect_id = p.id, structure_id = p.structure_id, project_id = coalesce(m.project_id, p.project_id, p.project_ids[1]),
      link_status = 'auto', link_reason = 'Fil de prospection envoyé depuis L''ArtBotrice'
      from prospects p where p.id = pid and m.id = p_thread;
    return;
  elsif n > 1 then
    update mail_threads set link_status = 'a_rattacher', link_reason = 'Plusieurs suivis partagent ce fil de prospection : à choisir' where id = p_thread;
    return;
  end if;
  -- 3. conversation connue par les identifiants de messages
  select coalesce(array_agg(distinct r), '{}') into refs from mail_messages mm, unnest(mm.ref_ids) r where mm.thread_id = p_thread;
  if cardinality(refs) > 0 then
    with known as (
      select y.prospect_id from mail_messages x join mail_threads y on y.id = x.thread_id
        where x.rfc_message_id = any(refs) and y.id <> p_thread and y.prospect_id is not null and y.link_status in ('auto', 'manuel')
      union
      select l.prospect_id from prospect_logs l where l.import_key = any(array(select 'msgid:' || r from unnest(refs) r))
    )
    select count(distinct prospect_id), min(prospect_id::text)::uuid into n, pid from known;
    if n = 1 then
      update mail_threads m set prospect_id = p.id, structure_id = p.structure_id, project_id = coalesce(m.project_id, p.project_id, p.project_ids[1]),
        link_status = 'auto', link_reason = 'Réponse à une conversation déjà rattachée à ce suivi'
        from prospects p where p.id = pid and m.id = p_thread;
      return;
    elsif n > 1 then
      update mail_threads set link_status = 'a_rattacher', link_reason = 'Répond à des conversations de plusieurs suivis : à choisir' where id = p_thread;
      return;
    end if;
  end if;
  -- 4. adresses exactes
  with addr as (select distinct lower(btrim(a)) a from unnest(t.participants) a where btrim(a) <> ''),
       ct as (select distinct c.id from contacts c join addr on addr.a in (lower(btrim(c.email)), lower(btrim(c.email_2))))
  select (select count(*) from ct),
         (select count(distinct cs.structure_id) from contact_structures cs where cs.contact_id in (select id from ct)),
         (select min(cs.structure_id::text)::uuid from contact_structures cs where cs.contact_id in (select id from ct))
    into n_contacts, n_struct, st;
  if n_contacts = 0 then reason := 'Contact inconnu : aucun contact n''a ces adresses';
  elsif n_struct = 0 then reason := 'Contact connu, rattaché à aucune structure';
  elsif n_struct > 1 then reason := 'Plusieurs structures possibles pour ces adresses : à choisir';
  else
    select count(*), min(id::text)::uuid into n_suivis, su from prospects where structure_id = st and coalesce(status, '') not in ('Closed', 'Confirmed');
    if n_suivis > 1 then reason := 'Plusieurs suivis ouverts pour cette structure : à choisir';
    elsif n_suivis = 0 then reason := 'Aucun suivi ouvert pour cette structure : à choisir ou à créer';
    else
      update mail_threads set structure_id = st, prospect_id = su, link_status = 'auto',
        link_reason = case when n_contacts > 1 then 'Contacts connus d''une seule structure et d''un seul suivi ouvert'
                           else 'Contact connu d''une seule structure et d''un seul suivi ouvert' end where id = p_thread;
      return;
    end if;
  end if;
  update mail_threads set link_status = 'a_rattacher', link_reason = reason where id = p_thread;
end $$;

-- ── Réponse reçue : relances suspendues (règle unique, appelée par le journal et par la correction du suivi) ────────────────
-- Seule une VRAIE réponse d'un correspondant suspend : jamais un avis de non-remise (« ndr », reconnu par ses en-têtes dans le
-- script, ou par l'expéditeur), jamais une réponse automatique (« auto » : absence… — décision d'Anthony en attente, v1.63), jamais un
-- message d'un membre de l'équipe (production@…). Les tâches suspendues sont notées sur le message (suspended_tasks) : une correction
-- de suivi peut ainsi les signaler, et les rétablir sur demande (mail_restore_relances).
create or replace function public.mail_is_reply(m mail_messages) returns boolean
language sql stable security definer set search_path = public as $$
  select m.direction = 'in' and m.auto_kind is null
    and coalesce(m.from_addr, '') !~* '^(mailer-daemon|mail-daemon|postmaster|microsoftexchange[0-9a-f]*)@'
    and not exists (select 1 from app_users u where lower(u.email) = lower(coalesce(m.from_addr, '')))
$$;

create or replace function public.mail_suspend(p_msg uuid, p_prospect uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare m mail_messages%rowtype; ids uuid[]; st_name text;
begin
  select * into m from mail_messages where id = p_msg;
  if not found or p_prospect is null then return 0; end if;
  -- réponse automatique (absence) : SIGNALÉE, relances maintenues, aucune reprogrammation tirée de son texte (décision du 08/11/2026)
  if m.direction = 'in' and m.auto_kind = 'auto' and coalesce(m.sent_at, now()) > now() - interval '3 days' then
    select s.name into st_name from prospects p left join structures s on s.id = p.structure_id where p.id = p_prospect;
    insert into notifications (kind, title, body, dedupe_key)
      values ('suivi', 'Réponse automatique — ' || coalesce(st_name, 'suivi'), coalesce(m.from_addr, '') || ' : « ' || coalesce(m.subject, '')
        || ' » (absence ou accusé automatique : relances maintenues)', 'mail-auto:' || m.id)
      on conflict (dedupe_key) do nothing;
  end if;
  if not public.mail_is_reply(m) then return 0; end if;
  with c as (
    update tasks set status = 'Cancelled', done_at = now(),
      notes = coalesce(notes || E'\n', '') || 'Suspendue automatiquement : réponse reçue le '
        || to_char(coalesce(m.sent_at, now()) at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' (' || coalesce(m.from_addr, '?') || ').'
      where prospect_id = p_prospect and auto_kind in ('relance_mail', 'relance_tel') and status not in ('Done', 'Cancelled')
        and created_at < coalesce(m.sent_at, now())
      returning id)
  select coalesce(array_agg(id), '{}') into ids from c;
  if cardinality(ids) > 0 then update mail_messages set suspended_tasks = suspended_tasks || ids where id = p_msg; end if;
  -- signalement : seulement pour une réponse récente (pas pour l'historique repris à la première synchronisation)
  if coalesce(m.sent_at, now()) > now() - interval '3 days' then
    select s.name into st_name from prospects p left join structures s on s.id = p.structure_id where p.id = p_prospect;
    insert into notifications (kind, title, body, dedupe_key)
      values ('suivi', 'Réponse reçue — ' || coalesce(st_name, 'suivi'), coalesce(m.from_addr, '') || ' : « ' || coalesce(m.subject, '') || ' »',
        'mail-reponse:' || m.id)
      on conflict (dedupe_key) do nothing;
  end if;
  return cardinality(ids);
end $$;

-- ── Journal du suivi (une seule ligne par message) ─────────────────────────────────────────────────────────────────────────
create or replace function public.mail_journal(p_thread uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t mail_threads%rowtype; m record; log_id uuid; n int := 0;
begin
  select * into t from mail_threads where id = p_thread;
  if not found or t.prospect_id is null then return 0; end if;
  for m in select * from mail_messages where thread_id = p_thread and prospect_log_id is null order by sent_at for update loop
    -- mail envoyé depuis L'ArtBotrice : déjà au journal. Reconnu par son identifiant Gmail ; pour les lignes d'avant la v1.61 (sans
    -- identifiant), par une ligne « Mail » du même suivi écrite par l'équipe le même jour (ou brouillon sans date), pas encore reliée.
    log_id := null;
    -- mail déjà joint au suivi par une dépose (Apple Mail, .eml : clé « msgid:<Message-ID> », v1.60.4) : relié, jamais réécrit
    if m.rfc_message_id is not null then
      select l.id into log_id from prospect_logs l where l.prospect_id = t.prospect_id and l.import_key = 'msgid:' || m.rfc_message_id limit 1;
      if log_id is not null then
        update mail_messages set prospect_log_id = log_id where id = m.id;
        perform public.mail_suspend(m.id, t.prospect_id);
        continue;
      end if;
    end if;
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
    -- clé « msgid:<Message-ID> » posée quand elle est libre : une dépose ultérieure du même mail la reconnaît (aucun doublon)
    insert into prospect_logs (prospect_id, date, kind, contact_name, body, author, gmail_message_id, import_key)
    values (t.prospect_id, (coalesce(m.sent_at, now()) at time zone 'Europe/Paris')::date, 'Mail',
      case when m.direction = 'in' then coalesce(nullif(m.from_name, ''), m.from_addr) end,
      (case m.auto_kind when 'ndr' then 'Avis de non-remise — ' when 'auto' then 'Réponse automatique — ' else '' end)
        || (case when m.direction = 'in' then 'Mail reçu de ' || coalesce(m.from_addr, '?') else 'Mail envoyé à ' || array_to_string(m.to_addrs || m.cc_addrs, ', ') end)
        || ' — « ' || coalesce(m.subject, '') || ' »'
        || coalesce(' — pièces jointes : ' || (select string_agg(a->>'name', ', ') from jsonb_array_elements(m.attachments) a
             where not coalesce((a->>'inline')::boolean, false)), '')   -- images intégrées au texte : pas des pièces jointes
        || case when coalesce(m.snippet, '') <> '' then E'\n' || m.snippet else '' end,
      'Messagerie', m.gmail_message_id,
      case when m.rfc_message_id is not null and not exists (select 1 from prospect_logs k where k.import_key = 'msgid:' || m.rfc_message_id)
           then 'msgid:' || m.rfc_message_id end)
    returning id into log_id;
    update mail_messages set prospect_log_id = log_id where id = m.id;
    n := n + 1;
    -- réponse reçue : relances automatiques ouvertes du suivi, créées AVANT ce message, suspendues (annulées avec la raison), signalée
    perform public.mail_suspend(m.id, t.prospect_id);
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

/**
 * Rattachement manuel (équipe) : structure, suivi, artiste, date ; le journal suit.
 * (v1.63, relecture) « Aucun suivi » choisi à la main = statut « manuel » sans suivi : jamais refait automatiquement.
 * Suivi corrigé A → B : les réponses déjà reçues suspendent les relances de B (même règle) ; les relances de A annulées par ces
 * messages ne sont PAS rétablies d'office (question à Anthony) : notification « à vérifier », rétablissement sur demande.
 */
create or replace function public.mail_link_manual(p_thread uuid, p_structure uuid, p_prospect uuid, p_project uuid, p_show uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare old uuid; m record; a_name text; b_name text; n int;
begin
  if not public.is_mailbox_owner((select mailbox from mail_threads where id = p_thread)) then raise exception 'Boîte réservée à son propriétaire (compte d''Anthony)'; end if;
  if p_prospect is not null and p_structure is not null and not exists (select 1 from prospects where id = p_prospect and structure_id = p_structure) then
    raise exception 'Ce suivi n''appartient pas à cette structure';
  end if;
  if p_show is not null and p_structure is not null and not exists (select 1 from shows where id = p_show and structure_id = p_structure) then
    raise exception 'Cette date n''appartient pas à cette structure';
  end if;
  select prospect_id into old from mail_threads where id = p_thread for update;
  if not found then raise exception 'Conversation introuvable'; end if;
  -- suivi corrigé : les lignes écrites par la messagerie suivent la conversation (les lignes écrites par l'équipe restent où elles sont)
  update prospect_logs l set prospect_id = p_prospect
    where p_prospect is not null and l.author = 'Messagerie' and l.prospect_id is distinct from p_prospect
      and l.id in (select prospect_log_id from mail_messages where thread_id = p_thread and prospect_log_id is not null);
  update mail_messages set prospect_log_id = null
    where thread_id = p_thread and prospect_log_id in (select id from prospect_logs where author is distinct from 'Messagerie')
      and p_prospect is distinct from old;
  update mail_threads set structure_id = p_structure, prospect_id = p_prospect, project_id = p_project, show_id = p_show,
    link_status = 'manuel',
    link_reason = case when p_structure is null and p_prospect is null then 'Aucun suivi (choisi à la main)' else 'Rattaché à la main' end
    where id = p_thread;
  if old is not null and old is distinct from p_prospect then
    select name into a_name from prospects where id = old;
    select name into b_name from prospects where id = p_prospect;
    for m in select x.id from mail_messages x where x.thread_id = p_thread
               and exists (select 1 from tasks k where k.id = any(x.suspended_tasks) and k.prospect_id = old and k.status = 'Cancelled') loop
      insert into notifications (kind, title, body, dedupe_key)
        values ('suivi', 'Relances à vérifier — ' || coalesce(a_name, 'suivi'),
          'Relances de « ' || coalesce(a_name, 'suivi') || ' » annulées par un message désormais rattaché à « ' || coalesce(b_name, 'aucun suivi')
            || ' » : à vérifier. Ouvrir pour les rétablir.', 'mail-relances:' || m.id || ':' || old)
        on conflict (dedupe_key) do nothing;
    end loop;
  end if;
  n := public.mail_journal(p_thread);
  if p_prospect is not null and p_prospect is distinct from old then
    for m in select id from mail_messages where thread_id = p_thread order by sent_at loop perform public.mail_suspend(m.id, p_prospect); end loop;
  end if;
  return n;
end $$;

/**
 * Rétablit, sur demande de l'équipe, les relances d'un suivi annulées par un message rattaché depuis à un autre suivi
 * (décision du 08/11/2026 : jamais automatiquement). Une relance dont l'échéance est passée (ou absente) demande une échéance
 * FUTURE choisie par l'équipe : sans elle, rien n'est rétabli (« ECHEANCE_REQUISE »).
 */
-- version de travail à deux paramètres (jamais publiée) remplacée par celle-ci
drop function if exists public.mail_restore_relances(uuid, uuid);
create or replace function public.mail_restore_relances(p_message uuid, p_prospect uuid, p_deadline date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; jour date := (now() at time zone 'Europe/Paris')::date; n_passees int;
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe'; end if;
  if p_deadline is not null and p_deadline <= jour then raise exception 'Échéance à choisir après aujourd''hui'; end if;
  select count(*) into n_passees from tasks k, mail_messages x
    where x.id = p_message and k.id = any(x.suspended_tasks) and k.prospect_id = p_prospect and k.status = 'Cancelled'
      and (k.deadline is null or k.deadline <= jour)
      and (select prospect_id from mail_threads where id = x.thread_id) is distinct from p_prospect;
  if n_passees > 0 and p_deadline is null then raise exception 'ECHEANCE_REQUISE:%', n_passees; end if;
  with r as (
    update tasks k set status = 'To Do', done_at = null,
      deadline = case when k.deadline is null or k.deadline <= jour then p_deadline else k.deadline end,
      notes = coalesce(k.notes || E'\n', '') || 'Rétablie à la main le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY')
        || ' (le message qui l''avait suspendue est rattaché à un autre suivi).'
      from mail_messages x
      where x.id = p_message and k.id = any(x.suspended_tasks) and k.prospect_id = p_prospect and k.status = 'Cancelled'
        and (select prospect_id from mail_threads where id = x.thread_id) is distinct from p_prospect
      returning k.id)
  select coalesce(array_agg(id), '{}') into ids from r;
  update mail_messages set suspended_tasks = array(select u from unnest(suspended_tasks) u where not u = any(ids)) where id = p_message;
  return cardinality(ids);
end $$;

revoke all on function public.mail_link_thread(uuid), public.mail_journal(uuid), public.mail_process(uuid[]),
  public.mail_suspend(uuid, uuid), public.mail_is_reply(mail_messages) from public, anon, authenticated;
grant execute on function public.mail_link_thread(uuid), public.mail_journal(uuid), public.mail_process(uuid[]),
  public.mail_suspend(uuid, uuid), public.mail_is_reply(mail_messages) to service_role;
revoke all on function public.mail_link_manual(uuid, uuid, uuid, uuid, uuid), public.mail_restore_relances(uuid, uuid, date) from public, anon;
grant execute on function public.mail_link_manual(uuid, uuid, uuid, uuid, uuid), public.mail_restore_relances(uuid, uuid, date) to authenticated, service_role;

-- ── Synchronisation toutes les 5 minutes : appel de la fonction serveur « mail-sync » ; inactive tant que private.sync_urls n'a pas son adresse ──
-- adresses des fonctions appelées par les tâches planifiées : schéma privé (inaccessible à l'application et aux comptes de l'équipe)
create table if not exists private.sync_urls (key text primary key, url text not null);
revoke all on private.sync_urls from public, anon, authenticated;
-- secret serveur DÉDIÉ des appels automatiques (« mail_sync_hook ») : tiré au hasard ici, rangé dans le schéma privé (comme le jeton
-- Pennylane), lu seulement par la tâche planifiée et par la fonction serveur (import_secret, réservé au rôle serveur).
-- Personne ne le saisit ni ne le voit ; il n'est jamais envoyé au navigateur, placé dans une adresse ou écrit dans un journal.
insert into private.import_secrets (key, value)
  values ('mail_sync_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

create or replace function public.mail_sync_tick() returns void
language plpgsql security definer set search_path = public as $$
declare u text := (select url from private.sync_urls where key = 'mail-sync'); sec text := (select value from private.import_secrets where key = 'mail_sync_hook');
begin
  if u is null or u !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/mail-sync$' or coalesce(sec, '') = '' then return; end if;
  perform net.http_post(url := u, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := jsonb_build_object('mailbox', 'anthony'), timeout_milliseconds := 120000);
end $$;
revoke all on function public.mail_sync_tick() from public, anon, authenticated;

-- (v1.63) sans pg_cron, rien n'est programmé et la migration va au bout ; cron.job n'est lu que si l'extension existe
do $$ declare deja boolean; begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select exists (select 1 from cron.job where jobname = ''mail-sync'')' into deja;
    if not deja then perform cron.schedule('mail-sync', '*/5 * * * *', 'select public.mail_sync_tick()'); end if;
  end if;
end $$;

commit;
