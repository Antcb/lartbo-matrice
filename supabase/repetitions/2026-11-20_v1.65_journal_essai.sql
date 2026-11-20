-- v1.65 — essai sur la BASE LOCALE JETABLE (2026-11-20_v1.65_journal_base_locale.sql + migration v1.65). Données FICTIVES.
-- Chaque contrôle lève une erreur s'il échoue (\set ON_ERROR_STOP conseillé : psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Suivi fictif (forme Ressins)');
insert into public.mail_threads (id, mailbox, gmail_thread_id, prospect_id, snippet)
  values ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'thr1', '00000000-0000-0000-0000-0000000000a1', 'C&#39;est noté');
-- 1) trois messages du 17/11 (envoyé 11:08:56, reçu 11:16:18, envoyé 11:21:47, heure de Paris) traités par la MÊME synchronisation
insert into public.mail_messages (thread_id, mailbox, gmail_message_id, rfc_message_id, direction, from_addr, to_addrs, subject, snippet, sent_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'g01', '<a1@exemple.test>', 'out', 'moi@exemple.test', '{prog@exemple.test}', 'Re: Proposition', 'Bonjour, l&#39;offre', '2026-11-17 10:08:56+00'),
  ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'g02', '<a2@exemple.test>', 'in', 'prog@exemple.test', '{moi@exemple.test}', 'RE: Proposition', 'Merci &amp;#39; &lt;b&gt;', '2026-11-17 10:16:18+00'),
  ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'g03', '<a3@exemple.test>', 'out', 'moi@exemple.test', '{prog@exemple.test}', 'Re: Proposition', '&quot;Hello&quot;', '2026-11-17 10:21:47+00');
select public.mail_journal('00000000-0000-0000-0000-0000000000b1');
do $$ declare n int; begin
  select count(*) into n from public.prospect_logs where author = 'Messagerie' and occurred_at is not null;
  if n <> 3 then raise exception 'attendu 3 lignes avec heure réelle, obtenu %', n; end if;
  if (select string_agg(to_char(occurred_at at time zone 'Europe/Paris', 'HH24:MI:SS'), ',' order by occurred_at desc) from public.prospect_logs)
     <> '11:21:47,11:16:18,11:08:56' then raise exception 'ordre réel inattendu'; end if;
  if exists (select 1 from public.prospect_logs where date <> '2026-11-17') then raise exception 'date simple modifiée'; end if;
end $$;
-- 2) mail déjà déposé (.eml, clé msgid) SANS heure : relié, texte jamais réécrit, heure complétée
insert into public.prospect_logs (prospect_id, date, kind, body, author, import_key)
  values ('00000000-0000-0000-0000-0000000000a1', '2026-11-18', 'Mail', 'Reçu — texte déposé', 'equipe@exemple.test', 'msgid:<a4@exemple.test>');
insert into public.mail_messages (thread_id, mailbox, gmail_message_id, rfc_message_id, direction, from_addr, subject, snippet, sent_at)
  values ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'g04', '<a4@exemple.test>', 'in', 'prog@exemple.test', 'RE: Proposition', 'x', '2026-11-18 08:00:00+00');
-- 3) mail envoyé depuis MATRICE (ligne « **… » sans identifiant) : relié, heure complétée
insert into public.prospect_logs (prospect_id, date, kind, body, author, created_at)
  values ('00000000-0000-0000-0000-0000000000a1', '2026-11-19', 'Mail', '**Relance n°1 envoyée**', 'equipe@exemple.test', '2026-11-19 09:00:00+00');
insert into public.mail_messages (thread_id, mailbox, gmail_message_id, rfc_message_id, direction, from_addr, subject, snippet, sent_at)
  values ('00000000-0000-0000-0000-0000000000b1', 'anthony', 'g05', '<a5@exemple.test>', 'out', 'moi@exemple.test', 'Re: Proposition', 'y', '2026-11-19 09:00:30+00');
select public.mail_journal('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (select body from public.prospect_logs where import_key = 'msgid:<a4@exemple.test>') <> 'Reçu — texte déposé' then raise exception 'texte déposé réécrit'; end if;
  if (select occurred_at from public.prospect_logs where import_key = 'msgid:<a4@exemple.test>') <> '2026-11-18 08:00:00+00' then raise exception 'heure du dépôt non complétée'; end if;
  if (select occurred_at from public.prospect_logs where body = '**Relance n°1 envoyée**') <> '2026-11-19 09:00:30+00' then raise exception 'heure de l''envoi non complétée'; end if;
  if (select count(*) from public.prospect_logs) <> 5 then raise exception 'doublon créé'; end if;
end $$;
-- 4) reprise des lignes existantes : heures effacées comme avant la migration, puis opération de reprise (étapes 1 à 3 du fichier)
update public.prospect_logs set occurred_at = null;
\i supabase/operations/2026-11-20_v1.65_reprise_horodatage.sql
do $$ begin
  if exists (select 1 from public.prospect_logs where occurred_at is null) then raise exception 'reprise incomplète'; end if;
end $$;
-- rejouée : aucun effet (seules les lignes sans heure sont touchées)
\i supabase/operations/2026-11-20_v1.65_reprise_horodatage.sql
-- 5) extraits : une seule passe ; journal modifié à la main laissé tel quel
update public.prospect_logs set body = body || ' (modifié à la main)' where occurred_at = '2026-11-17 10:21:47+00';
\i supabase/operations/2026-11-20_v1.65_extraits_entites.sql
do $$ begin
  if (select snippet from public.mail_messages where gmail_message_id = 'g02') <> 'Merci &#39; <b>' then raise exception 'extrait mal décodé (une seule passe attendue)'; end if;
  if (select snippet from public.mail_messages where gmail_message_id = 'g01') <> 'Bonjour, l''offre' then raise exception 'apostrophe non décodée'; end if;
  if (select snippet from public.mail_threads) <> 'C''est noté' then raise exception 'conversation non décodée'; end if;
  if right((select body from public.prospect_logs where occurred_at = '2026-11-17 10:16:18+00'), 15) <> 'Merci &#39; <b>' then raise exception 'journal non décodé'; end if;
  if (select body from public.prospect_logs where occurred_at = '2026-11-17 10:21:47+00') not like '%&quot;Hello&quot; (modifié à la main)' then raise exception 'ligne modifiée à la main touchée'; end if;
end $$;
-- 6) relancée (relecture v1.65, B1) : refusée par la marque, rien n'est décodé une deuxième fois
\set ON_ERROR_STOP 0
\i supabase/operations/2026-11-20_v1.65_extraits_entites.sql
\set ON_ERROR_STOP 1
do $$ begin
  if (select snippet from public.mail_messages where gmail_message_id = 'g02') <> 'Merci &#39; <b>' then raise exception 'second passage : décodé deux fois'; end if;
  if (select count(*) from public.settings where key = 'reprise_extraits_v165') <> 1 then raise exception 'marque absente'; end if;
end $$;
-- 7) ligne de réglage effacée (possible depuis l'application) : la sauvegarde privée refuse encore un second passage
delete from public.settings where key = 'reprise_extraits_v165';
\set ON_ERROR_STOP 0
\i supabase/operations/2026-11-20_v1.65_extraits_entites.sql
\set ON_ERROR_STOP 1
do $$ begin
  if (select snippet from public.mail_messages where gmail_message_id = 'g02') <> 'Merci &#39; <b>' then raise exception 'marque effacée : décodé deux fois'; end if;
  if (select valeur from private.v165_sauvegarde_extraits where tbl = 'mail_messages' and id = (select id from public.mail_messages where gmail_message_id = 'g02'))
     <> 'Merci &amp;#39; &lt;b&gt;' then raise exception 'sauvegarde des extraits incorrecte'; end if;
  if (select count(*) from private.v165_sauvegarde_horodatage) <> 5 then raise exception 'sauvegarde des heures incomplète'; end if;
  if has_table_privilege('authenticated', 'private.v165_sauvegarde_extraits', 'delete') then raise exception 'sauvegarde effaçable par l''équipe'; end if;
end $$;
-- 8) retour arrière des extraits depuis la sauvegarde
update public.mail_messages m set snippet = s.valeur from private.v165_sauvegarde_extraits s where s.tbl = 'mail_messages' and s.id = m.id;
do $$ begin
  if (select snippet from public.mail_messages where gmail_message_id = 'g02') <> 'Merci &amp;#39; &lt;b&gt;' then raise exception 'retour arrière impossible'; end if;
end $$;
select 'ESSAI v1.65 : tous les contrôles passent' as resultat;
