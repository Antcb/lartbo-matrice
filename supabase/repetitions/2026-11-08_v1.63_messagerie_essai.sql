-- v1.63 — essais de la migration messagerie sur la BASE LOCALE JETABLE (voir 2026-11-08_v1.63_messagerie_base_locale.sql).
-- Données FICTIVES (domaines example.*). Tout se passe dans une transaction annulée à la fin : la base reste vide.
-- Chaque essai lève une erreur s'il échoue ; dernière ligne attendue : « BILAN : tous les essais messagerie réussis ».
\set ON_ERROR_STOP on
begin;
create temp table bilan (n serial, essai text);
grant all on bilan, bilan_n_seq to authenticated;
create or replace function pg_temp.ok(cond boolean, essai text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ÉCHEC : %', essai; end if; insert into bilan (essai) values (essai); end $$;

-- ── Données fictives ───────────────────────────────────────────────────────────────────────────────────────────────
insert into app_users values ('equipe@example.com'), ('collegue@example.com');
-- registre vide après la migration (aucune adresse écrite) : boîte fermée à tous
do $$ begin
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  perform pg_temp.ok((select count(*) from private.mailbox_owners) = 0 and not public.is_mailbox_owner('anthony'), 'titulaire non inscrit : aucune adresse écrite par la migration, boîte fermée à tous');
  perform set_config('request.jwt.claims', '', true);
end $$;
-- titulaire fictif inscrit comme dans la séance (une ligne, sur autorisation) ; transaction annulée à la fin
insert into private.mailbox_owners (mailbox, email) values ('anthony', 'Equipe@Example.com');
do $$ begin
  perform pg_temp.ok(public.mailbox_owner_email('anthony') = 'equipe@example.com', 'adresse du titulaire lue par le serveur (minuscules)');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.mailbox_owner_email(text)', 'execute') and not has_function_privilege('anon', 'public.mailbox_owner_email(text)', 'execute'),
    'adresse du titulaire : lisible par le rôle serveur seulement');
end $$;
insert into projects (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Artiste Alpha');
insert into structures (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Salle Une'), ('00000000-0000-0000-0000-000000000002', 'Festival Deux'),
  ('00000000-0000-0000-0000-000000000003', 'Salle Trois (deux suivis)'), ('00000000-0000-0000-0000-000000000004', 'Salle Quatre');
insert into contacts (id, display_name, email, email_2) values
  ('00000000-0000-0000-0000-0000000000c1', 'Camille', 'camille@example.com', null),
  ('00000000-0000-0000-0000-0000000000c2', 'Dominique', 'dom@example.com', 'Dom.Perso@Example.org'),
  ('00000000-0000-0000-0000-0000000000c3', 'Multi', 'multi@example.com', null),
  ('00000000-0000-0000-0000-0000000000c4', 'Trois', 'trois@example.com', null),
  ('00000000-0000-0000-0000-0000000000c5', 'Sans structure', 'seul@example.com', null);
insert into contact_structures values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000003');
insert into prospects (id, name, structure_id, project_id, status, mail_thread_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'Suivi Une', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Interest', null),
  ('00000000-0000-0000-0000-0000000000f0', 'Suivi Une ancien (clos)', '00000000-0000-0000-0000-000000000001', null, 'Closed', null),
  ('00000000-0000-0000-0000-0000000000f3', 'Suivi Trois A', '00000000-0000-0000-0000-000000000003', null, 'Mailed', null),
  ('00000000-0000-0000-0000-0000000000f4', 'Suivi Trois B', '00000000-0000-0000-0000-000000000003', null, 'Option', null),
  ('00000000-0000-0000-0000-0000000000f5', 'Prospection Quatre', '00000000-0000-0000-0000-000000000004', null, 'Mailed', 'prosp01'),
  ('00000000-0000-0000-0000-0000000000f6', 'Prospection partagée A', '00000000-0000-0000-0000-000000000004', null, 'Mailed', 'partage01'),
  ('00000000-0000-0000-0000-0000000000f7', 'Prospection partagée B', '00000000-0000-0000-0000-000000000004', null, 'Mailed', 'partage01');

-- conversation + messages (comme les écrit la fonction serveur mail-sync)
create or replace function pg_temp.conv(gid text, parts text[]) returns uuid language sql as $$
  insert into mail_threads (gmail_thread_id, participants, labels) values (gid, parts, '{INBOX}')
  on conflict (mailbox, gmail_thread_id) do update set participants = excluded.participants returning id $$;
create or replace function pg_temp.msg(th uuid, gid text, dir text, frm text, rfc text, refs text[], at timestamptz) returns void language sql as $$
  insert into mail_messages (thread_id, gmail_message_id, direction, from_addr, to_addrs, subject, snippet, sent_at, rfc_message_id, ref_ids)
  values (th, gid, dir, frm, case when dir = 'out' then '{camille@example.com}'::text[] else '{anthony@example.com}'::text[] end, 'Objet ' || gid, 'Texte', at, rfc, coalesce(refs, '{}'))
  on conflict (mailbox, gmail_message_id) do nothing $$;
create or replace function pg_temp.sync(th uuid) returns int language sql as $$ select public.mail_process(array[th]) $$;
create or replace function pg_temp.logs(p uuid) returns int language sql as $$ select count(*)::int from prospect_logs where prospect_id = p and author = 'Messagerie' $$;

-- ── Rattachement ───────────────────────────────────────────────────────────────────────────────────────────────────
do $$ declare t uuid; r mail_threads%rowtype; begin
  -- contact connu, une structure, un seul suivi OUVERT (le suivi clos ne compte pas) → automatique, avec sa raison
  t := pg_temp.conv('t01', '{camille@example.com}');
  perform pg_temp.msg(t, 'g01', 'in', 'camille@example.com', '<m01@example.com>', null, now() - interval '1 hour');
  perform pg_temp.sync(t);
  select * into r from mail_threads where id = t;
  perform pg_temp.ok(r.link_status = 'auto' and r.prospect_id = '00000000-0000-0000-0000-0000000000f1' and r.link_reason like 'Contact connu%', 'correspondance unique : rattachement automatique visible (raison)');
  perform pg_temp.ok(pg_temp.logs(r.prospect_id) = 1, 'message reçu au journal du suivi, une fois');
  -- synchronisations répétées (Actualiser ×3) : aucun doublon
  perform pg_temp.msg(t, 'g01', 'in', 'camille@example.com', '<m01@example.com>', null, now() - interval '1 hour');
  perform pg_temp.sync(t); perform pg_temp.sync(t); perform pg_temp.sync(t);
  perform pg_temp.ok(pg_temp.logs(r.prospect_id) = 1 and (select count(*) from mail_messages where thread_id = t) = 1, 'synchronisations répétées : aucun doublon (messages ni journal)');

  -- plusieurs contacts d'une même structure (dont une adresse 2 en casse différente) → la structure est identifiée
  t := pg_temp.conv('t02', '{camille@example.com,dom.perso@example.org}');
  perform pg_temp.sync(t);
  select * into r from mail_threads where id = t;
  perform pg_temp.ok(r.link_status = 'auto' and r.structure_id = '00000000-0000-0000-0000-000000000001' and r.link_reason like 'Contacts connus%', 'plusieurs contacts d''une même structure : structure identifiée');

  -- contact présent dans deux structures → « À rattacher », raison, rien au journal, aucun premier choix
  t := pg_temp.conv('t03', '{multi@example.com}');
  perform pg_temp.msg(t, 'g03', 'in', 'multi@example.com', '<m03@example.com>', null, now());
  perform pg_temp.sync(t);
  select * into r from mail_threads where id = t;
  perform pg_temp.ok(r.link_status = 'a_rattacher' and r.structure_id is null and r.prospect_id is null and r.link_reason like 'Plusieurs structures%', 'plusieurs structures possibles : choix demandé, aucun choix arbitraire');
  perform pg_temp.ok((select count(*) from prospect_logs where author = 'Messagerie' and body like '%multi@%') = 0, 'non rattachée : rien au journal');
  -- une réponse envoyée depuis la conversation non rattachée la laisse « À rattacher »
  perform pg_temp.msg(t, 'g03b', 'out', 'anthony@example.com', '<m03b@example.com>', '{<m03@example.com>}', now());
  perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status from mail_threads where id = t) = 'a_rattacher', 'réponse depuis une conversation non rattachée : reste « À rattacher »');

  -- deux suivis ouverts pour la structure → choix demandé
  t := pg_temp.conv('t04', '{trois@example.com}');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status = 'a_rattacher' and link_reason like 'Plusieurs suivis ouverts%' from mail_threads where id = t), 'plusieurs suivis possibles : choix demandé');
  -- inconnu / contact sans structure
  t := pg_temp.conv('t05', '{personne@example.net}'); perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status = 'a_rattacher' and link_reason like 'Contact inconnu%' from mail_threads where id = t), 'adresse inconnue : « À rattacher »');
  t := pg_temp.conv('t06', '{seul@example.com}'); perform pg_temp.sync(t);
  perform pg_temp.ok((select link_reason like 'Contact connu, rattaché à aucune structure%' from mail_threads where id = t), 'contact sans structure : « À rattacher » avec la raison');
  -- jamais le seul domaine : autre@example.com (même domaine que camille@) n'est pas reconnu
  t := pg_temp.conv('t07', '{autre@example.com}'); perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status from mail_threads where id = t) = 'a_rattacher', 'même domaine seulement : pas de rattachement');
end $$;

do $$ declare t uuid; begin
  -- fil de prospection (prospects.mail_thread_id) : ce suivi ; deux suivis sur le même fil : choix demandé
  t := pg_temp.conv('prosp01', '{inconnu.prospect@example.net}'); perform pg_temp.sync(t);
  perform pg_temp.ok((select prospect_id = '00000000-0000-0000-0000-0000000000f5' and link_status = 'auto' from mail_threads where id = t), 'fil de prospection : rattaché à son suivi');
  t := pg_temp.conv('partage01', '{inconnu.prospect@example.net}'); perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status = 'a_rattacher' and prospect_id is null from mail_threads where id = t), 'fil partagé par deux suivis : choix demandé');
end $$;

-- ── Conversation déjà rattachée : garde son suivi ; correction manuelle ────────────────────────────────────────────────
do $$ declare t uuid; begin
  t := (select id from mail_threads where gmail_thread_id = 't01');
  update mail_threads set participants = '{multi@example.com}' where id = t;   -- nouveaux participants
  perform pg_temp.sync(t);
  perform pg_temp.ok((select prospect_id = '00000000-0000-0000-0000-0000000000f1' and link_status = 'auto' from mail_threads where id = t), 'conversation déjà rattachée : garde son suivi');
end $$;

-- ── Conversation connue (In-Reply-To / References), réponse Apple Mail ───────────────────────────────────────────────────
do $$ declare t uuid; p uuid := '00000000-0000-0000-0000-0000000000f1'; n0 int; begin
  -- réponse envoyée depuis Apple Mail dans le fil connu (message « out » apparu à la synchronisation) : reprise au journal, une fois
  t := (select id from mail_threads where gmail_thread_id = 't01'); n0 := pg_temp.logs(p);
  perform pg_temp.msg(t, 'g01-apple', 'out', 'anthony@example.com', '<apple01@example.com>', '{<m01@example.com>}', now());
  perform pg_temp.sync(t); perform pg_temp.sync(t);
  perform pg_temp.ok(pg_temp.logs(p) = n0 + 1, 'réponse faite depuis Apple Mail dans une conversation connue : au journal une fois');
  -- réponse Apple Mail qui ouvre un NOUVEAU fil Gmail (objet changé), adressée à un inconnu : reconnue par References
  t := pg_temp.conv('t08', '{nouvelle.adresse@example.net}');
  perform pg_temp.msg(t, 'g08', 'out', 'anthony@example.com', '<apple02@example.com>', '{<m01@example.com>,<apple01@example.com>}', now());
  perform pg_temp.sync(t);
  perform pg_temp.ok((select prospect_id = p and link_status = 'auto' and link_reason like 'Réponse à une conversation déjà rattachée%' from mail_threads where id = t), 'nouveau fil qui répond à une conversation rattachée : même suivi');
  -- références vers deux suivis différents : choix demandé
  update mail_threads set link_status = 'manuel', prospect_id = '00000000-0000-0000-0000-0000000000f3', structure_id = '00000000-0000-0000-0000-000000000003'
    where gmail_thread_id = 't04';
  perform pg_temp.msg((select id from mail_threads where gmail_thread_id = 't04'), 'g04', 'in', 'trois@example.com', '<m04@example.com>', null, now() - interval '5 days');
  t := pg_temp.conv('t09', '{x@example.net}');
  perform pg_temp.msg(t, 'g09', 'in', 'x@example.net', '<m09@example.com>', '{<m01@example.com>,<m04@example.com>}', now());
  perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status = 'a_rattacher' and link_reason like 'Répond à des conversations de plusieurs suivis%' from mail_threads where id = t), 'références vers deux suivis : choix demandé');
end $$;

-- ── Doublons avec la dépose Apple Mail (clé « msgid:<Message-ID> ») et les envois de L'ArtBotrice ───────────────────────
do $$ declare t uuid; p uuid := '00000000-0000-0000-0000-0000000000f1'; n0 int; k text; begin
  -- mail déjà déposé dans le suivi (Apple Mail) : la synchronisation le relie, sans nouvelle ligne
  insert into prospect_logs (prospect_id, date, kind, body, author, import_key) values (p, current_date, 'Mail', 'Mail déposé', 'equipe@example.com', 'msgid:<depose01@example.com>');
  t := (select id from mail_threads where gmail_thread_id = 't01'); n0 := (select count(*) from prospect_logs where prospect_id = p);
  perform pg_temp.msg(t, 'g01-depose', 'in', 'camille@example.com', '<depose01@example.com>', null, now() - interval '30 minutes');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select count(*) from prospect_logs where prospect_id = p) = n0
    and (select prospect_log_id from mail_messages where gmail_message_id = 'g01-depose') = (select id from prospect_logs where import_key = 'msgid:<depose01@example.com>'),
    'mail déjà déposé depuis Apple Mail : relié, aucune seconde ligne');
  -- l'inverse : la ligne écrite par la synchronisation porte la clé (une dépose ultérieure la reconnaît)
  select import_key into k from prospect_logs where id = (select prospect_log_id from mail_messages where gmail_message_id = 'g01');
  perform pg_temp.ok(k = 'msgid:<m01@example.com>', 'ligne du journal de la messagerie : clé msgid posée');
  -- envoi depuis L'ArtBotrice (ligne écrite à l'envoi avec l'identifiant Gmail) : reconnu, pas de seconde ligne
  insert into prospect_logs (prospect_id, date, kind, body, author, gmail_message_id) values (p, current_date, 'Mail', '**Relance n°1** …', 'equipe@example.com', 'g01-envoi');
  n0 := (select count(*) from prospect_logs where prospect_id = p);
  perform pg_temp.msg(t, 'g01-envoi', 'out', 'anthony@example.com', '<envoi01@example.com>', null, now());
  perform pg_temp.sync(t);
  perform pg_temp.ok((select count(*) from prospect_logs where prospect_id = p) = n0, 'envoi depuis L''ArtBotrice : reconnu par son identifiant Gmail, aucun doublon');
end $$;

-- ── Relances suspendues à la réponse ─────────────────────────────────────────────────────────────────────────────────
do $$ declare t uuid; p uuid := '00000000-0000-0000-0000-0000000000f1'; avant uuid; apres uuid; begin
  insert into tasks (title, prospect_id, auto_kind, created_at) values ('Relance — Salle Une', p, 'relance_mail', now() - interval '2 days') returning id into avant;
  t := (select id from mail_threads where gmail_thread_id = 't01');
  -- avis de non-remise : ce n'est pas une réponse
  perform pg_temp.msg(t, 'g01-bounce', 'in', 'mailer-daemon@example.com', '<b01@example.com>', null, now() - interval '1 day');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select status from tasks where id = avant) = 'To Do', 'avis de non-remise : relance gardée');
  perform pg_temp.msg(t, 'g01-rep', 'in', 'camille@example.com', '<rep01@example.com>', null, now() - interval '1 hour');
  insert into tasks (title, prospect_id, auto_kind, created_at) values ('Relance programmée après', p, 'relance_mail', now()) returning id into apres;
  perform pg_temp.sync(t);
  perform pg_temp.ok((select status = 'Cancelled' and done_at is not null and notes like '%Suspendue automatiquement : réponse reçue le%' from tasks where id = avant), 'réponse reçue : relance suspendue, raison et date de réalisation');
  perform pg_temp.ok((select status from tasks where id = apres) = 'To Do', 'relance programmée après la réponse : gardée');
  perform pg_temp.ok((select count(*) from notifications where dedupe_key = 'mail-reponse:' || (select id from mail_messages where gmail_message_id = 'g01-rep')) = 1, 'réponse signalée une fois');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select count(*) from notifications where dedupe_key like 'mail-reponse:%') = (select count(*) from notifications), 'pas de notification en double');
end $$;

-- ── Rattachement manuel : équipe seulement, suivi de la bonne structure, journal qui suit ─────────────────────────────────
do $$ declare t uuid; begin
  t := (select id from mail_threads where gmail_thread_id = 't03');
  perform set_config('request.jwt.claims', '{"email":"intrus@example.net"}', true);
  begin perform public.mail_link_manual(t, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', null, null);
    perform pg_temp.ok(false, 'hors équipe refusé'); exception when others then perform pg_temp.ok(sqlerrm like 'Boîte réservée%', 'rattachement manuel : compte hors équipe refusé'); end;
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  begin perform public.mail_link_manual(t, '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', null, null);
    perform pg_temp.ok(false, 'suivi d''une autre structure'); exception when others then perform pg_temp.ok(sqlerrm like 'Ce suivi n''appartient pas%', 'suivi d''une autre structure refusé'); end;
  perform pg_temp.ok(public.mail_link_manual(t, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', null, null) = 2, 'rattachement manuel : messages de la conversation au journal');
  perform pg_temp.ok((select link_status = 'manuel' from mail_threads where id = t), 'rattachement manuel visible');
  -- correction vers un autre suivi : les lignes de la messagerie suivent
  perform public.mail_link_manual(t, '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f4', null, null);
  perform pg_temp.ok((select count(*) from prospect_logs l join mail_messages m on m.prospect_log_id = l.id where m.thread_id = t and l.prospect_id = '00000000-0000-0000-0000-0000000000f4') = 2, 'correction du suivi : journal déplacé, sans doublon');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── Relecture v1.63 : retrait manuel conservé (B3) ────────────────────────────────────────────────────────────────────────
do $$ declare t uuid; begin
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  t := pg_temp.conv('r01', '{camille@example.com}');
  perform pg_temp.msg(t, 'r01-1', 'in', 'camille@example.com', '<r01@example.com>', null, now() - interval '2 hours');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status from mail_threads where id = t) = 'auto', 'B3 préalable : rattachement automatique');
  perform public.mail_link_manual(t, null, null, null, null);
  perform pg_temp.sync(t); perform pg_temp.sync(t);
  perform pg_temp.ok((select link_status = 'manuel' and prospect_id is null and structure_id is null and link_reason like 'Aucun suivi%' from mail_threads where id = t),
    'B3 : « aucun suivi » choisi à la main, jamais refait par la synchronisation');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── Relecture v1.63 : correction du suivi A → B (B4) ─────────────────────────────────────────────────────────────────────
insert into structures (id, name) values ('00000000-0000-0000-0000-00000000000a', 'Salle A'), ('00000000-0000-0000-0000-00000000000b', 'Salle B');
insert into contacts (id, display_name, email) values ('00000000-0000-0000-0000-0000000000ca', 'Prog A', 'prog@a.example');
insert into contact_structures values ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000000a');
insert into prospects (id, name, structure_id, status) values ('00000000-0000-0000-0000-0000000000aa', 'Suivi A', '00000000-0000-0000-0000-00000000000a', 'Mailed'),
  ('00000000-0000-0000-0000-0000000000bb', 'Suivi B', '00000000-0000-0000-0000-00000000000b', 'Mailed');
insert into tasks (id, title, prospect_id, auto_kind, created_at, deadline) values
  ('00000000-0000-0000-0000-0000000000e1', 'Relance A', '00000000-0000-0000-0000-0000000000aa', 'relance_mail', now() - interval '5 days', current_date - 1),
  ('00000000-0000-0000-0000-0000000000e4', 'Relance A2', '00000000-0000-0000-0000-0000000000aa', 'relance_tel', now() - interval '5 days', current_date + 20);
insert into tasks (id, title, prospect_id, auto_kind, created_at) values
  ('00000000-0000-0000-0000-0000000000e2', 'Relance B', '00000000-0000-0000-0000-0000000000bb', 'relance_mail', now() - interval '5 days');
insert into shows (id, structure_id) values ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-00000000000a');
do $$ declare t uuid; a uuid := '00000000-0000-0000-0000-0000000000aa'; b uuid := '00000000-0000-0000-0000-0000000000bb'; m uuid; k text; begin
  t := pg_temp.conv('ab01', '{prog@a.example}');
  perform pg_temp.msg(t, 'ab01-1', 'in', 'prog@a.example', '<ab01@a.example>', null, now() - interval '1 day');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select prospect_id from mail_threads where id = t) = a and (select status from tasks where title = 'Relance A') = 'Cancelled', 'B4 préalable : réponse rattachée à A, relance A suspendue');
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  begin perform public.mail_link_manual(t, '00000000-0000-0000-0000-00000000000b', b, null, '00000000-0000-0000-0000-0000000000d5');
    perform pg_temp.ok(false, 'date d''une autre structure'); exception when others then perform pg_temp.ok(sqlerrm like 'Cette date n''appartient pas%', 'date d''une autre structure refusée'); end;
  perform public.mail_link_manual(t, '00000000-0000-0000-0000-00000000000b', b, null, null);
  perform pg_temp.ok((select status from tasks where title = 'Relance B') = 'Cancelled', 'B4 : correction vers B, relance B suspendue (même règle)');
  perform pg_temp.ok((select status from tasks where title = 'Relance A') = 'Cancelled', 'B4 : relance A non rétablie d''office');
  m := (select id from mail_messages where gmail_message_id = 'ab01-1');
  select dedupe_key into k from notifications where dedupe_key = 'mail-relances:' || m || ':' || a;
  perform pg_temp.ok(k is not null and (select body like 'Relances de « Suivi A » annulées par un message désormais rattaché à « Suivi B » : à vérifier%' from notifications where dedupe_key = k),
    'B4 : notification « Relances de A annulées … rattaché à B : à vérifier »');
  perform set_config('request.jwt.claims', '{"email":"intrus@example.net"}', true);
  begin perform public.mail_restore_relances(m, a); perform pg_temp.ok(false, 'rétablissement hors équipe');
    exception when others then perform pg_temp.ok(sqlerrm like 'Réservé à l''équipe%', 'B4 : rétablissement refusé hors équipe'); end;
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  begin perform public.mail_restore_relances(m, a); perform pg_temp.ok(false, 'échéance passée sans date');
    exception when others then perform pg_temp.ok(sqlerrm = 'ECHEANCE_REQUISE:1', 'rétablissement : échéance passée → échéance future demandée, rien rétabli'); end;
  perform pg_temp.ok((select status from tasks where title = 'Relance A') = 'Cancelled', 'rétablissement refusé : relances toujours annulées');
  begin perform public.mail_restore_relances(m, a, current_date); perform pg_temp.ok(false, 'échéance du jour');
    exception when others then perform pg_temp.ok(sqlerrm like 'Échéance à choisir après aujourd''hui%', 'rétablissement : échéance passée ou du jour refusée'); end;
  -- rétablissement par un autre membre de l'équipe (droits du suivi, pas de la boîte)
  perform set_config('request.jwt.claims', '{"email":"collegue@example.com"}', true);
  perform pg_temp.ok(public.mail_restore_relances(m, a, current_date + 7) = 2, 'B4 : relances de A rétablies sur demande (équipe)');
  perform pg_temp.ok((select status = 'To Do' and done_at is null and deadline = current_date + 7 and notes like '%Rétablie à la main%' from tasks where title = 'Relance A')
    and (select deadline from tasks where title = 'Relance A2') = current_date + 20, 'rétablissement : échéance future appliquée seulement à la relance échue');
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  perform pg_temp.ok(public.mail_restore_relances(m, a, current_date + 3) = 0, 'B4 : rétablissement unique (rien la seconde fois)');
  perform pg_temp.ok(public.mail_restore_relances(m, b) = 0 and (select status from tasks where title = 'Relance B') = 'Cancelled', 'B4 : jamais pour le suivi actuel de la conversation');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── Relecture v1.63 : avis de non-remise, réponse automatique, message de l'équipe (B5) ─────────────────────────────────────
insert into tasks (id, title, prospect_id, auto_kind, created_at) values
  ('00000000-0000-0000-0000-0000000000e3', 'Relance B2', '00000000-0000-0000-0000-0000000000bb', 'relance_mail', now() - interval '1 hour');
do $$ declare t uuid := (select id from mail_threads where gmail_thread_id = 'ab01'); begin
  insert into mail_messages (thread_id, gmail_message_id, direction, from_addr, subject, sent_at, auto_kind)
    values (t, 'ab01-ndr', 'in', 'relais@b.example', 'Undeliverable', now(), 'ndr');
  insert into mail_messages (thread_id, gmail_message_id, direction, from_addr, subject, sent_at)
    values (t, 'ab01-exch', 'in', 'microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@b.example', 'Non remis : Hello', now());
  insert into mail_messages (thread_id, gmail_message_id, direction, from_addr, subject, sent_at, auto_kind)
    values (t, 'ab01-oof', 'in', 'prog@a.example', 'Réponse automatique : absent', now(), 'auto');
  insert into mail_messages (thread_id, gmail_message_id, direction, from_addr, subject, sent_at)
    values (t, 'ab01-team', 'in', 'EQUIPE@example.com', 'Re: depuis production@', now());
  perform public.mail_journal(t);
  perform pg_temp.ok((select status from tasks where title = 'Relance B2') = 'To Do', 'B5 : avis de non-remise (en-têtes, Exchange), réponse automatique et message de l''équipe ne suspendent pas');
  perform pg_temp.ok((select body like 'Avis de non-remise — %' from prospect_logs where gmail_message_id = 'ab01-ndr')
    and (select body like 'Réponse automatique — %' from prospect_logs where gmail_message_id = 'ab01-oof'), 'B5 : non-remise et réponse automatique marquées au journal');
  perform pg_temp.ok((select count(*) from notifications where dedupe_key in (select 'mail-reponse:' || id from mail_messages where gmail_message_id like 'ab01-%' and gmail_message_id <> 'ab01-1')) = 0,
    'B5 : aucune notification « Réponse reçue » pour ces messages');
  perform pg_temp.ok((select count(*) from notifications where dedupe_key = 'mail-auto:' || (select id from mail_messages where gmail_message_id = 'ab01-oof') and title like 'Réponse automatique — %' and body like '%relances maintenues%') = 1
    and (select count(*) from notifications where dedupe_key like 'mail-auto:%') = 1, 'décision 08/11 : absence automatique signalée (une notification), relances maintenues');
  begin insert into mail_messages (thread_id, gmail_message_id, direction, sent_at, auto_kind) values (t, 'ab01-x', 'in', now(), 'pirate');
    perform pg_temp.ok(false, 'type inconnu'); exception when check_violation then perform pg_temp.ok(true, 'B5 : type de message automatique contrôlé'); end;
end $$;

-- ── Relecture v1.63 : dépose Apple Mail ↔ synchronisation, dans les deux sens (B1) ────────────────────────────────────────
-- forme exacte de la clé écrite par la dépose (js/data.js, v1.60.4) : « msgid:<Message-ID> », Message-ID entre chevrons
do $$ declare t uuid; p uuid := '00000000-0000-0000-0000-0000000000aa'; owner uuid; begin
  -- 1. synchronisation d'abord : la ligne du journal porte la clé ; la dépose du même mail la trouve (mailParts/keyOwner) → aucune 2e ligne
  t := pg_temp.conv('ap01', '{prog@a.example}');
  update mail_threads set link_status = 'manuel', prospect_id = p, structure_id = '00000000-0000-0000-0000-00000000000a' where id = t;
  perform pg_temp.msg(t, 'ap01-1', 'in', 'prog@a.example', '<9F1C2E3A-1B2C@exemple-fictif.fr>', null, now() - interval '3 hours');
  perform pg_temp.sync(t);
  select prospect_id into owner from prospect_logs where import_key = 'msgid:<9F1C2E3A-1B2C@exemple-fictif.fr>';
  perform pg_temp.ok(owner = p, 'B1 : synchronisation puis dépose — la clé de la dépose désigne déjà ce suivi (rien n''est rajouté au journal)');
  -- 2. dépose d'abord (ligne écrite comme mailToJournal), puis synchronisation : reliée, une seule ligne
  insert into prospect_logs (prospect_id, date, kind, body, author, import_key) values (p, current_date, 'Mail', 'Reçu — **Programmation**', 'equipe@example.com', 'msgid:<AA-depose@exemple-fictif.fr>');
  perform pg_temp.msg(t, 'ap01-2', 'in', 'prog@a.example', '<AA-depose@exemple-fictif.fr>', null, now() - interval '2 hours');
  perform pg_temp.sync(t);
  perform pg_temp.ok((select count(*) from prospect_logs where import_key = 'msgid:<AA-depose@exemple-fictif.fr>' or gmail_message_id = 'ap01-2') = 1, 'B1 : dépose puis synchronisation — une seule ligne au journal');
  -- 3. réponse écrite dans Apple Mail à ce mail déposé, arrivée dans un NOUVEAU fil : rattachée au suivi du mail déposé
  t := pg_temp.conv('ap02', '{autre.adresse@exemple-fictif.fr}');
  perform pg_temp.msg(t, 'ap02-1', 'out', 'anthony@example.com', '<rep-apple@example.org>', '{<AA-depose@exemple-fictif.fr>}', now());
  perform pg_temp.sync(t);
  perform pg_temp.ok((select prospect_id from mail_threads where id = t) = p, 'B1 : réponse depuis Apple Mail à un mail déposé : rattachée au même suivi');
end $$;

-- ── Droits ──────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.mail_process(uuid[])', 'execute'), 'mail_process interdit aux comptes');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.mail_link_thread(uuid)', 'execute'), 'mail_link_thread interdit aux comptes');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.mail_sync_tick()', 'execute') and not has_function_privilege('anon', 'public.mail_sync_tick()', 'execute'), 'mail_sync_tick interdit aux comptes');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.mail_link_manual(uuid,uuid,uuid,uuid,uuid)', 'execute'), 'mail_link_manual interdit aux visiteurs');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'private.sync_urls', 'select') and not has_table_privilege('authenticated', 'private.sync_urls', 'insert'), 'adresse de la tâche hors d''atteinte des comptes');
  perform pg_temp.ok(not has_table_privilege('anon', 'public.mail_threads', 'select'), 'conversations invisibles aux visiteurs');
  perform pg_temp.ok((select length(value) >= 60 from private.import_secrets where key = 'mail_sync_hook'), 'secret dédié tiré au hasard (≥ 60 caractères hexadécimaux)');
end $$;
-- RLS : un compte hors équipe ne voit aucune conversation ; l'équipe les voit
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"intrus@example.net"}', true) \gset ignore_
do $$ begin perform pg_temp.ok((select count(*) from mail_threads) = 0 and (select count(*) from mail_messages) = 0, 'RLS : compte hors équipe, aucune conversation'); end $$;
select set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true) \gset ignore_
do $$ begin perform pg_temp.ok((select count(*) from mail_threads) > 0, 'RLS : propriétaire de la boîte, conversations visibles'); end $$;
reset role;

-- ── Boîte anthony@ réservée au compte d'Anthony (décision du 08/11/2026) ────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"collegue@example.com"}', true) \gset ignore_
do $$ begin
  perform pg_temp.ok(public.is_team() and not public.is_mailbox_owner('anthony'), 'autre membre de l''équipe : pas propriétaire de la boîte');
  perform pg_temp.ok((select count(*) from mail_threads) = 0 and (select count(*) from mail_messages) = 0 and (select count(*) from mail_sync_state) = 0,
    'autre membre de l''équipe : aucune conversation de la boîte visible (RLS)');
  perform pg_temp.ok((select count(*) from prospect_logs where author = 'Messagerie') > 0, 'messages rattachés : visibles dans le journal des suivis (droits habituels)');
  begin perform public.mail_link_manual((select id from mail_threads limit 1), null, null, null, null); perform pg_temp.ok(true, 'aucune ligne visible : rien à rattacher');
    exception when others then perform pg_temp.ok(sqlerrm like 'Boîte réservée%', 'autre membre : rattachement manuel refusé'); end;
end $$;
reset role;
do $$ declare t uuid := (select id from mail_threads where gmail_thread_id = 't07'); begin
  perform set_config('request.jwt.claims', '{"email":"collegue@example.com"}', true);
  begin perform public.mail_link_manual(t, null, null, null, null); perform pg_temp.ok(false, 'collègue rattache');
    exception when others then perform pg_temp.ok(sqlerrm like 'Boîte réservée à son propriétaire%', 'autre membre de l''équipe : rattachement manuel refusé côté serveur'); end;
  perform set_config('request.jwt.claims', '{"email":"equipe@example.com"}', true);
  perform pg_temp.ok(public.is_mailbox_owner('anthony') and not public.is_mailbox_owner('production'), 'propriétaire : sa boîte seulement');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'private.mailbox_owners', 'update') and not has_table_privilege('authenticated', 'private.mailbox_owners', 'select'),
    'propriétaire de la boîte inscrit hors d''atteinte des comptes');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ── Tâche planifiée : rien sans adresse inscrite, jamais vers un autre serveur, secret dans l'en-tête seulement ─────────────
do $$ begin
  perform public.mail_sync_tick();
  perform pg_temp.ok((select count(*) from net.appels) = 0, 'tâche planifiée inactive sans adresse inscrite');
  insert into private.sync_urls values ('mail-sync', 'https://pirate.example.net/functions/v1/mail-sync');
  perform public.mail_sync_tick();
  perform pg_temp.ok((select count(*) from net.appels) = 0, 'adresse hors Supabase : aucun appel (le secret ne part pas)');
  update private.sync_urls set url = 'https://abcdefghijklmnop.supabase.co/functions/v1/mail-sync' where key = 'mail-sync';
  perform public.mail_sync_tick();
  perform pg_temp.ok((select count(*) = 1 and bool_and(headers ->> 'x-hook-secret' = (select value from private.import_secrets where key = 'mail_sync_hook'))
    and bool_and(position((select value from private.import_secrets where key = 'mail_sync_hook') in url) = 0) from net.appels), 'appel planifié : secret dans l''en-tête, jamais dans l''adresse');
end $$;

select n, essai from bilan order by n;
do $$ begin raise notice 'BILAN : tous les essais messagerie réussis (% essais)', (select count(*) from bilan); end $$;
rollback;
