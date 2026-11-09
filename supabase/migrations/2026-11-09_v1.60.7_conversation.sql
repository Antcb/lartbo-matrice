-- v1.60.7 — import de la CONVERSATION entière d'un mail glissé depuis Apple Mail (décision d'Anthony du 09/11/2026).
-- Chaque message importé garde son identifiant Gmail sur son entrée du journal : MÊMES colonne et index que la messagerie intégrée
-- (dev/v1.63-messagerie, migration 2026-11-06_v1.61_messagerie.sql, lignes reprises à l'identique) — la messagerie reconnaîtra ces
-- entrées (gmail_message_id, et la clé « msgid:<Message-ID> » déjà en place) sans doublon, et se rebasera sans conflit.
-- Additif, rejouable (if not exists) ; aucune donnée existante lue ni modifiée.
-- message Gmail d'une ligne du journal écrite par L'ArtBotrice (prospection, relance, réponse) : la synchronisation la reconnaît (aucun doublon)
alter table public.prospect_logs add column if not exists gmail_message_id text;
create index if not exists prospect_logs_gmail_message on public.prospect_logs (gmail_message_id) where gmail_message_id is not null;
