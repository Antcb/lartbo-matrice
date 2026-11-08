-- v1.60.4 — clé DÉDIÉE de signature de l'identité transmise par le relais script-google au script de prospection (anthony@)
-- (décision d'Anthony du 08/11/2026 : recherche par Message-ID dans anthony@ réservée à son titulaire ; relecture de 3ca7f59, B1).
-- Tirée au hasard ICI, une seule fois : rangée dans le schéma privé (comme le jeton Pennylane), lue seulement par le relais
-- (import_secret, réservé au rôle serveur). Jamais envoyée dans une requête ni au navigateur ; Anthony la recopie une fois dans la
-- propriété CLE_BOITE du script de prospection (Table Editor › schéma private › import_secrets › ligne mailbox_sign_key).
-- Rejouable : un nouveau passage ne la régénère JAMAIS (on conflict do nothing) et ne touche à aucune autre donnée.
create schema if not exists private;
create table if not exists private.import_secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
revoke all on private.import_secrets from public, anon, authenticated;
insert into private.import_secrets (key, value)
  values ('mailbox_sign_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
