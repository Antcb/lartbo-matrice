-- v1.60.4 — inscription du TITULAIRE de la boîte anthony@ (étape de séance séparée, sur autorisation d'Anthony).
-- Après la migration 2026-11-08_v1.60.4_titulaire.sql. Un seul paramètre : l'adresse de connexion à la Matrice du titulaire,
-- à écrire UNE fois dans la ligne « params » ci-dessous (aucune adresse n'est écrite dans le dépôt).
-- Garde-fous : l'adresse doit être un compte de l'équipe (app_users) ; une ligne déjà inscrite n'est JAMAIS remplacée (on conflict do
-- nothing) — pour la changer : décision d'Anthony, puis delete de la ligne et nouvelle inscription.
-- Résultat attendu : une ligne « anthony | <adresse> » ; aucune ligne si l'adresse n'est pas un compte de l'équipe.
with params(titulaire) as (values (lower(btrim('ADRESSE_DU_TITULAIRE'))))
insert into private.mailbox_owners (mailbox, email)
select 'anthony', p.titulaire from params p
where exists (select 1 from public.app_users u where lower(u.email) = p.titulaire)
on conflict (mailbox) do nothing
returning mailbox, email;
-- Contrôle (lecture seule) : select mailbox, email from private.mailbox_owners;
