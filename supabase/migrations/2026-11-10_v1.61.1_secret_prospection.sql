-- v1.61.1 — code secret DÉDIÉ du script de prospection (boîte anthony@) — réserve de sécurité du 10/11/2026.
-- Jusqu'ici le script de prospection acceptait le même code secret que le script principal de production@ (settings ›
-- drive_webhook_secret, propriété WEBHOOK_SECRET) : quiconque détenait le code du script principal pouvait faire agir la boîte
-- anthony@. Décision d'Anthony : pas d'accès élargi, aucun envoi, aucune perte.
-- Tirée au hasard ICI, une seule fois, rangée dans le schéma privé (comme mailbox_sign_key, migration 2026-11-08_v1.60.4_cle_boite) ;
-- lue seulement par le relais script-google (import_secret, réservé au rôle serveur), envoyée seulement au script de prospection ;
-- jamais au navigateur ni au script principal. Anthony la recopie une fois dans la propriété SECRET_PROSPECTION du script de
-- prospection (Table Editor › schéma private › import_secrets › ligne prospect_script_secret › valeur).
-- Rejouable : un nouveau passage ne la régénère JAMAIS (on conflict do nothing) ; aucune suppression, aucune autre donnée touchée.
create schema if not exists private;
create table if not exists private.import_secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
revoke all on private.import_secrets from public, anon, authenticated;
insert into private.import_secrets (key, value)
  values ('prospect_script_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
