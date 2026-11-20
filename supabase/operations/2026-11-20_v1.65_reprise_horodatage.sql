-- v1.65 — Reprise de l'heure réelle des entrées EXISTANTES du journal des suivis (prospect_logs.occurred_at).
-- **À lancer seulement avec l'accord d'Anthony** (modification de données historiques, CONVENTIONS §7.6), APRÈS la migration
-- 2026-11-20_v1.65_journal_horodatage.sql. Projet de TEST d'abord.
-- Source unique : mail_messages.sent_at (date Gmail du message), par le lien déjà établi (mail_messages.prospect_log_id),
-- sinon par l'identifiant Gmail (prospect_logs.gmail_message_id), sinon par le Message-ID (clé « msgid:<…> » d'un mail déposé).
-- Seules les lignes SANS heure sont complétées (occurred_at is null) ; aucune autre colonne n'est touchée ; rien n'est supprimé.
-- Lignes sans message correspondant : laissées vides (repli explicite du tri : heure d'enregistrement si même jour, sinon fin du jour).
-- État en production au 20/11/2026 (lecture seule) : 137 lignes « Messagerie » et 36 mails déposés, tous reliés à un message ;
-- 92 lignes d'envois depuis MATRICE avec identifiant Gmail (reliées si le message est synchronisé).

-- 0. Avant : sauvegarde de la nuit vérifiée (dépôt lartbo-matrice-backup), puis export des lignes concernées (à conserver)
select l.id, l.prospect_id, l.date, l.created_at, l.occurred_at, l.author, l.import_key, l.gmail_message_id
from public.prospect_logs l
where l.occurred_at is null and (l.author = 'Messagerie' or l.gmail_message_id is not null or l.import_key like 'msgid:%')
order by l.prospect_id, l.date;

-- 1. Aperçu (lecture seule) : nombre de lignes complétées par source
with src as (
  select l.id,
    coalesce((select m.sent_at from public.mail_messages m where m.prospect_log_id = l.id and m.sent_at is not null order by m.sent_at limit 1),
             (select m.sent_at from public.mail_messages m where l.gmail_message_id is not null and m.gmail_message_id = l.gmail_message_id and m.sent_at is not null limit 1),
             (select m.sent_at from public.mail_messages m where l.import_key like 'msgid:%' and 'msgid:' || m.rfc_message_id = l.import_key and m.sent_at is not null order by m.sent_at limit 1)) as at
  from public.prospect_logs l
  where l.occurred_at is null and (l.author = 'Messagerie' or l.gmail_message_id is not null or l.import_key like 'msgid:%'))
select count(*) filter (where at is not null) as completees, count(*) filter (where at is null) as sans_source from src;

-- 2. Reprise (une transaction)
begin;
with src as (
  select l.id,
    coalesce((select m.sent_at from public.mail_messages m where m.prospect_log_id = l.id and m.sent_at is not null order by m.sent_at limit 1),
             (select m.sent_at from public.mail_messages m where l.gmail_message_id is not null and m.gmail_message_id = l.gmail_message_id and m.sent_at is not null limit 1),
             (select m.sent_at from public.mail_messages m where l.import_key like 'msgid:%' and 'msgid:' || m.rfc_message_id = l.import_key and m.sent_at is not null order by m.sent_at limit 1)) as at
  from public.prospect_logs l
  where l.occurred_at is null and (l.author = 'Messagerie' or l.gmail_message_id is not null or l.import_key like 'msgid:%'))
update public.prospect_logs l set occurred_at = src.at from src where src.id = l.id and src.at is not null and l.occurred_at is null;
commit;

-- 3. Après : contrôle (cas de référence : suivi Ressins Folies f8f539d0-…, attendu 17/11 11:21:47, 11:16:18, 11:08:56 — heure de Paris)
select to_char(l.occurred_at at time zone 'Europe/Paris', 'DD/MM HH24:MI:SS') as heure, l.author, left(l.body, 60) as debut
from public.prospect_logs l where l.prospect_id = 'f8f539d0-f5ea-4d9e-b85e-5a6f32dfe4e4' and not l.hidden
order by l.date desc, l.occurred_at desc nulls first;

-- Retour arrière (si demandé) : remettre à vide les seules lignes complétées par cette reprise, à partir de l'export de l'étape 0
-- update public.prospect_logs set occurred_at = null where id in (<identifiants exportés à l'étape 0>);
