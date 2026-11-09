-- =====================================================================================================
-- Essai Brevo réel — MODE ESSAI par liste blanche (marche : supabase/operations/2026-11-09_essai_brevo_contact_test.md)
-- PROJET DE TEST SEULEMENT. Jamais en production.
-- Réglage brevo_essai_emails : tant qu'il est rempli, brevo-sync (version du lot dev/brevo-rattachements) ne touche QUE les adresses
-- valides qu'il contient ; tout autre contact est ignoré avant le moindre appel à Brevo et « tout envoyer » est refusé. Rempli sans
-- adresse valide : TOUT est bloqué (relecture B2). Tant qu'une clé Brevo est enregistrée, l'équipe ne peut ni le modifier ni
-- l'effacer (garde brevo_essai_guard, migration 2026-11-08_brevo_rattachements.sql).
-- Ordre : (0) contrôles, (1) liste blanche AVANT que la clé Brevo soit collée, … essai …, (3) clé vidée par Anthony,
-- (4) contrôle, (5) liste blanche retirée APRÈS la clé — refusé par le bloc lui-même tant qu'une clé est présente.
-- =====================================================================================================

-- (0) Contrôles en lecture seule, avant tout (rien n'est modifié ; aucune adresse affichée en entier)
--   clé Brevo absente du projet de test (attendu : false ; sinon ARRÊT et message à Anthony)
select coalesce(btrim(value #>> '{}'), '') <> '' as cle_brevo_presente from public.settings where key = 'brevo_api_key';
--   adresses du projet de test, par domaine (nombre seulement)
select lower(split_part(e, '@', 2)) as domaine, count(*) as adresses
  from public.contacts, lateral unnest(array[email, email_2]) e where e is not null group by 1 order by 2 desc;
--   contacts marqués « créés par la Matrice » dans Brevo (nombre seulement)
select count(*) filter (where brevo_created) as crees_par_la_matrice, count(*) filter (where cardinality(brevo_emails) > 0) as avec_brevo_emails
  from public.contacts;
--   version de brevo-sync déployée sur le projet de test : à comparer au dépôt (outil Supabase « get_edge_function ») ; elle doit
--   contenir « brevo_essai_emails » et « ESSAI_BRUT » ; sinon NE PAS continuer.

-- (1) Liste blanche. Remplacer la valeur ENTRE CROCHETS par l'adresse donnée par Anthony (avec « +essai »). Laissée telle quelle,
--     elle n'est pas une adresse : le bloc refuse et n'écrit rien.
do $$
declare a text := lower(btrim('[ADRESSE D’ESSAI DONNÉE PAR ANTHONY]'));
begin
  if a !~ '^[^\s@<>"'',;()]+@[^\s@<>"'',;()]+\.[a-z]{2,}$' then
    raise exception 'Adresse d’essai invalide (« % ») : rien n’est écrit', a;
  end if;
  if a !~ '\+essai' then raise exception 'L’adresse d’essai doit contenir « +essai » : rien n’est écrit'; end if;
  insert into public.settings (key, value) values ('brevo_essai_emails', to_jsonb(a))
    on conflict (key) do update set value = excluded.value;
end $$;
--   contrôle : exactement une adresse, celle de l'essai
select value #>> '{}' as liste_blanche from public.settings where key = 'brevo_essai_emails';

-- (4) Après « clé vidée » par Anthony : contrôle (attendu : false)
select coalesce(btrim(value #>> '{}'), '') <> '' as cle_brevo_presente from public.settings where key = 'brevo_api_key';

-- (5) Retrait de la liste blanche : REFUSÉ par le bloc tant qu'une clé Brevo est présente
do $$
begin
  if exists (select 1 from public.settings where key = 'brevo_api_key' and coalesce(btrim(value #>> '{}'), '') <> '') then
    raise exception 'Une clé Brevo est encore enregistrée : la liste blanche reste en place. Faire vider la clé d’abord (Réglages › Brevo).';
  end if;
  update public.settings set value = to_jsonb(''::text) where key = 'brevo_essai_emails';
end $$;
select coalesce(value #>> '{}', '') = '' as liste_blanche_vide from public.settings where key = 'brevo_essai_emails';
