-- =====================================================================================================
-- ESSAI v1.50 (Contacts) — PROJET DE TEST UNIQUEMENT, transaction ANNULÉE (exception finale) : rien n'est gardé.
-- La migration 2026-10-27_v1.50_contacts.sql est insérée à la place de la ligne repère ci-dessous, précédée de la v1.36
-- (contacts_clean, clean_email, clean_phone) si le projet de test ne l'a pas encore (ordre réel de mise en ligne).
-- Vérifie : nettoyage autorisé (espaces, invisibles, majuscules), mail 2 remonté / doublon retiré, téléphone nettoyé,
-- et surtout : une adresse au mauvais format n'est JAMAIS déplacée vers les notes ni le téléphone (Q23), la migration ne contient aucune modification de données (aucun update / delete / insert : contrôlé à la lecture).
-- =====================================================================================================
begin;
do $g$ begin
  if exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ceci est la PRODUCTION — essai réservé au projet de test'; end if;
end $g$;

--@@MIGRATION@@

do $e$
declare c1 uuid; c2 uuid; c3 uuid; r record;
begin
  insert into contacts (first_name, display_name, email, email_2, phone) values ('ESSAI 1', 'ESSAI 1', E'  Camille.Essai@Exemple.FR\u200B ', null, '06 12 34 56 78') returning id into c1;
  select * into r from contacts where id = c1;
  if r.email <> 'camille.essai@exemple.fr' then raise exception 'ECHEC 1 : mail non nettoyé (%)', r.email; end if;

  insert into contacts (first_name, display_name, email, email_2) values ('ESSAI 2', 'ESSAI 2', null, 'deux@exemple.fr') returning id into c2;
  select * into r from contacts where id = c2;
  if r.email is distinct from 'deux@exemple.fr' or r.email_2 is not null then raise exception 'ECHEC 2 : mail 2 non remonté (%, %)', r.email, r.email_2; end if;
  update contacts set email_2 = 'DEUX@exemple.fr' where id = c2;
  select * into r from contacts where id = c2;
  if r.email_2 is not null then raise exception 'ECHEC 2b : mail 2 identique gardé (%)', r.email_2; end if;

  -- Q23 : mauvais format gardé dans sa case (nettoyé par clean_email), jamais déplacé
  insert into contacts (first_name, display_name, email, notes, phone) values ('ESSAI 3', 'ESSAI 3', 'Voir avec la régie 06 11 22 33 44', 'note', null) returning id into c3;
  select * into r from contacts where id = c3;
  if r.email is null or r.notes is distinct from 'note' or r.phone is not null then
    raise exception 'ECHEC 3 : mail déplacé (email %, notes %, tel %)', r.email, r.notes, r.phone; end if;

  -- téléphone toujours nettoyé (inchangé)
  select * into r from contacts where id = c1;
  if r.phone is distinct from '06 12 34 56 78' then raise exception 'ECHEC 4 : téléphone (%)', r.phone; end if;

  raise exception 'ESSAI v1.50 RÉUSSI : nettoyage, mail 2 remonté, doublon retiré, mauvais format jamais déplacé (« % »), téléphone nettoyé — transaction annulée',
    (select email from contacts where id = c3);
end $e$;
rollback;
