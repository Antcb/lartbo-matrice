-- v1.65 — Apostrophes illisibles (&#39;…) dans les extraits Gmail DÉJÀ enregistrés : décodage en une seule passe.
-- **À lancer seulement avec l'accord d'Anthony** (modification de données historiques, CONVENTIONS §7.6). Projet de TEST d'abord.
-- **UNE SEULE FOIS** (relecture v1.65, B1) : un texte décodé ne se distingue pas d'un texte d'origine (« &amp;amp;#39; » devient
-- « &amp;#39; », qu'un second passage décoderait encore). Garde-fou : marque « reprise_extraits_v165 » dans settings ; si elle existe,
-- l'opération s'arrête sans rien modifier.
-- ORDRE : cette opération JUSTE AVANT le déploiement de mail-sync v1.65 (supabase/functions/mail-sync/regles.ts, decodeEntities) —
-- jamais après : un extrait déjà décodé par la synchronisation et contenant réellement « &lt; » ou « &amp; » serait décodé deux fois.
-- Un extrait enregistré entre les deux (synchronisation de l'ancienne version) garde ses entités : affichage inchangé, jamais faux.
-- Même règle que decodeEntities, restreinte aux 5 entités présentes en base au 20/11/2026 (lecture seule : &#39; 1 817, &gt; 111,
-- &lt; 96, &amp; 72, &quot; 41 ; aucune autre) ; « &amp; » est décodé EN DERNIER : « &amp;#39; » donne « &#39; » (une seule passe).
-- Tables : mail_messages.snippet, mail_threads.snippet, et la DERNIÈRE ligne des entrées « Messagerie » du journal (l'extrait
-- ajouté par mail_journal), seulement si elle est encore identique à l'extrait du message (entrée jamais modifiée à la main).
-- Les entrées modifiées à la main ne sont pas touchées : elles sont listées (étape 1) pour décision.

-- Fonction temporaire (session seulement) : rien n'est créé dans la base
create or replace function pg_temp.dec(s text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(s, '&#39;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
$$;

-- 0. Avant : sauvegarde de la nuit vérifiée, puis export des lignes concernées (à conserver)
select 'mail_messages' t, id::text, snippet from public.mail_messages where snippet ~ '&(#39|quot|lt|gt|amp);'
union all select 'mail_threads', id::text, snippet from public.mail_threads where snippet ~ '&(#39|quot|lt|gt|amp);'
union all select 'prospect_logs', id::text, body from public.prospect_logs where author = 'Messagerie' and body ~ '&(#39|quot|lt|gt|amp);';

-- 1. Aperçu : entrées du journal traitées / laissées (modifiées à la main)
select count(*) filter (where right(l.body, length(m.snippet)) = m.snippet) as traitees,
       count(*) filter (where right(l.body, length(m.snippet)) <> m.snippet) as laissees
from public.prospect_logs l join public.mail_messages m on m.prospect_log_id = l.id
where l.author = 'Messagerie' and m.snippet ~ '&(#39|quot|lt|gt|amp);';

-- 2. Reprise (une transaction ; le journal d'abord, tant que mail_messages.snippet contient encore l'extrait d'origine)
begin;
do $$ begin
  if exists (select 1 from public.settings where key = 'reprise_extraits_v165') then
    raise exception 'Reprise des extraits déjà faite (%) : rien n''est modifié (une seule fois).', (select value from public.settings where key = 'reprise_extraits_v165');
  end if;
end $$;
update public.prospect_logs l set body = left(l.body, length(l.body) - length(m.snippet)) || pg_temp.dec(m.snippet)
from public.mail_messages m
where m.prospect_log_id = l.id and l.author = 'Messagerie' and m.snippet ~ '&(#39|quot|lt|gt|amp);'
  and right(l.body, length(m.snippet)) = m.snippet;
update public.mail_messages set snippet = pg_temp.dec(snippet) where snippet ~ '&(#39|quot|lt|gt|amp);';
update public.mail_threads set snippet = pg_temp.dec(snippet) where snippet ~ '&(#39|quot|lt|gt|amp);';
insert into public.settings (key, value) values ('reprise_extraits_v165', to_jsonb(now()));
commit;

-- 3. Après : contrôle. Attendu : 0, SAUF les entrées « laissées » de l'étape 1 et les extraits dont le texte d'origine contenait
--    réellement une entité écrite en toutes lettres (« &amp;#39; » d'origine → « &#39; », juste). NE PAS relancer l'étape 2.
select (select count(*) from public.mail_messages where snippet ~ '&(#39|quot|lt|gt|amp);') as messages,
       (select count(*) from public.mail_threads where snippet ~ '&(#39|quot|lt|gt|amp);') as conversations,
       (select count(*) from public.prospect_logs where author = 'Messagerie' and body ~ '&(#39|quot|lt|gt|amp);') as journal;
