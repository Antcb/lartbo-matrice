-- v1.60.4 — registre des titulaires de boîte : RLS active, AUCUNE règle (personne ne lit ni n'écrit la table par l'API ; seul son
-- propriétaire postgres la lit, au travers de is_mailbox_owner / mailbox_owner_email, SECURITY DEFINER).
-- Appliquée à la main en production le 08/11/2026 (SQL Editor, texte identique), après 2026-11-08_v1.60.4_titulaire.sql ; elle
-- n'apparaît donc pas dans l'historique des migrations. Rejouable : activer une RLS déjà active est sans effet ; aucune donnée touchée.
alter table private.mailbox_owners enable row level security;
