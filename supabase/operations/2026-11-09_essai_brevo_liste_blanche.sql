-- =====================================================================================================
-- Essai Brevo réel — MODE ESSAI par liste blanche (marche : supabase/operations/2026-11-09_essai_brevo_contact_test.md)
-- PROJET DE TEST SEULEMENT. Jamais en production.
-- Réglage brevo_essai_emails : tant qu'il est rempli, brevo-sync (version du lot dev/brevo-rattachements) ne touche QUE ces
-- adresses ; tout autre contact du projet est ignoré avant le moindre appel à Brevo, et « tout envoyer » est refusé.
-- Ordre : (0) contrôles, (1) liste blanche AVANT que la clé Brevo soit collée, … essai …, (3) clé vidée par Anthony, (4) contrôle,
-- (5) liste blanche retirée APRÈS la clé.
-- =====================================================================================================

-- (0) Contrôles en lecture seule, avant tout (rien n'est modifié ; aucune adresse affichée en entier)
--   clé Brevo absente du projet de test (attendu : false)
select coalesce(btrim(value #>> '{}'), '') <> '' as cle_brevo_presente from public.settings where key = 'brevo_api_key';
--   adresses du projet de test, par domaine (nombre seulement)
select lower(split_part(e, '@', 2)) as domaine, count(*) as adresses
  from public.contacts, lateral unnest(array[email, email_2]) e where e is not null group by 1 order by 2 desc;
--   contacts marqués « créés par la Matrice » dans Brevo (nombre seulement)
select count(*) filter (where brevo_created) as crees_par_la_matrice, count(*) filter (where cardinality(brevo_emails) > 0) as avec_brevo_emails
  from public.contacts;
--   version de brevo-sync déployée sur le projet de test : à comparer au dépôt (outil Supabase « get_edge_function »), elle doit
--   contenir « brevo_essai_emails » ; sinon NE PAS continuer.

-- (1) Liste blanche : remplacer l'adresse par celle du contact d'essai donnée par Anthony (avec « +essai »)
insert into public.settings (key, value) values ('brevo_essai_emails', to_jsonb('ADRESSE+essai@DOMAINE'::text))
  on conflict (key) do update set value = excluded.value;
--   contrôle : exactement une adresse, celle de l'essai
select value #>> '{}' as liste_blanche from public.settings where key = 'brevo_essai_emails';

-- (4) Après « clé vidée » par Anthony : contrôle (attendu : false)
select coalesce(btrim(value #>> '{}'), '') <> '' as cle_brevo_presente from public.settings where key = 'brevo_api_key';

-- (5) Seulement si (4) donne false : retrait de la liste blanche
update public.settings set value = to_jsonb(''::text) where key = 'brevo_essai_emails';
select coalesce(value #>> '{}', '') = '' as liste_blanche_vide from public.settings where key = 'brevo_essai_emails';
