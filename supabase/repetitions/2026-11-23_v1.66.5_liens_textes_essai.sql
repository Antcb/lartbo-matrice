-- v1.66.5 — essai de la mise à jour ciblée des liens des textes (migration 2026-11-23_v1.66.5_liens_textes.sql), sur la base locale
-- jetable de la v1.66 : 2026-11-20_v1.66_texte_mails_base_locale.sql, migration v1.66, migration v1.66.5 (deux fois : rejouable), puis
-- ce fichier (psql -v ON_ERROR_STOP=1). Chaque contrôle lève une exception en cas d'échec ; données FICTIVES uniquement.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.qui(e text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', e, 'role', 'authenticated')::text, false) $$;
-- préparation (propriétaire) : une entrée importée, un texte privé
insert into public.prospect_logs (id, body, mail_text) values ('00000000-0000-0000-0000-0000000000c1', 'Reçu — Fiche', E'Voici la fiche technique.\nFin');
insert into private.mail_textes (message_id, body_text) values ('00000000-0000-0000-0000-0000000000b1', E'Voici la fiche technique.\nFin');

-- 0. motif identique à js/texte-mail.js LINK_MARK
select pg_temp.ok(public.mail_texte_sans_liens(E'la [fiche technique](https://a.fr/x%20y%28z%29), [écris](mailto:m@x.fr), [tél](tel:+33600) [js](javascript:alert(1)) [a\nb](https://c.fr) [x](HTTPS://D.FR)')
  = E'la fiche technique, écris, tél [js](javascript:alert(1)) [a\nb](https://c.fr) x', 'motif : web, mail, téléphone (majuscules comprises) ; javascript: et label sur deux lignes laissés');

-- 1. collègue de l'équipe : texte importé mis à jour seulement si identique, liens en plus
set role authenticated; select pg_temp.qui('collegue@example.com');
do $$ begin perform public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', E'Voici la fiche technique.\nFin', E'Voici la [fiche](https://a.fr) technique modifiée.\nFin');
  raise exception 'ÉCHEC : contenu modifié accepté'; exception when sqlstate '22023' then raise notice 'ok : contenu différent refusé'; end $$;
select pg_temp.ok(not public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', 'ancien texte périmé', E'ancien texte [périmé](https://a.fr)'), 'texte changé entre-temps : rien');
select pg_temp.ok(public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', E'Voici la fiche technique.\nFin', E'Voici la [fiche technique](https://a.fr/fiche).\nFin'), 'importé : mis à jour');
select pg_temp.ok((select mail_text from public.prospect_logs where id = '00000000-0000-0000-0000-0000000000c1') = E'Voici la [fiche technique](https://a.fr/fiche).\nFin', 'importé : nouveau texte enregistré');
select pg_temp.ok((select body from public.prospect_logs where id = '00000000-0000-0000-0000-0000000000c1') = 'Reçu — Fiche', 'importé : texte et notes de l''entrée (body) intacts');
select pg_temp.ok(not public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', E'Voici la fiche technique.\nFin', E'Voici la [fiche technique](https://a.fr/fiche).\nFin'), 'second passage : rien (déjà fait)');
-- collègue : texte privé interdit
do $$ begin perform public.mail_texte_liens_prive('00000000-0000-0000-0000-0000000000b1', E'Voici la fiche technique.\nFin', E'Voici la [fiche technique](https://a.fr).\nFin');
  raise exception 'ÉCHEC : collègue a modifié un texte privé'; exception when insufficient_privilege then raise notice 'ok : collègue, texte privé refusé'; end $$;

-- 2. hors équipe et anon
select pg_temp.qui('inconnu@example.com');
select pg_temp.ok(not public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', E'Voici la [fiche technique](https://a.fr/fiche).\nFin', E'Voici la [fiche technique](https://a.fr/fiche).\nFin'), 'hors équipe : rien (identique)');
reset role; set role anon;
do $$ begin perform public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', 'a', '[a](https://a.fr)'); raise exception 'ÉCHEC : anon exécute mail_texte_liens';
  exception when insufficient_privilege then raise notice 'ok : anon, mail_texte_liens refusée'; end $$;
do $$ begin perform public.mail_texte_liens_prive('00000000-0000-0000-0000-0000000000b1', 'a', '[a](https://a.fr)'); raise exception 'ÉCHEC : anon exécute mail_texte_liens_prive';
  exception when insufficient_privilege then raise notice 'ok : anon, mail_texte_liens_prive refusée'; end $$;
reset role;
-- hors équipe (RLS) : la ligne n'est pas visible, donc jamais modifiée
update public.prospect_logs set mail_text = E'Voici la fiche technique.\nFin' where id = '00000000-0000-0000-0000-0000000000c1';
set role authenticated; select pg_temp.qui('inconnu@example.com');
select pg_temp.ok(not public.mail_texte_liens('00000000-0000-0000-0000-0000000000c1', E'Voici la fiche technique.\nFin', E'Voici la [fiche technique](https://a.fr).\nFin'), 'hors équipe : texte importé non modifiable (RLS)');

-- 3. titulaire : texte privé mis à jour seulement si identique, liens en plus ; jamais visible en direct
select pg_temp.qui('titulaire@example.com');
do $$ begin perform public.mail_texte_liens_prive('00000000-0000-0000-0000-0000000000b1', E'Voici la fiche technique.\nFin', E'Autre [texte](https://a.fr).\nFin');
  raise exception 'ÉCHEC : texte privé modifié accepté'; exception when sqlstate '22023' then raise notice 'ok : titulaire, contenu différent refusé'; end $$;
select pg_temp.ok(public.mail_texte_liens_prive('00000000-0000-0000-0000-0000000000b1', E'Voici la fiche technique.\nFin', E'Voici la [fiche technique](https://a.fr).\nFin'), 'titulaire : texte privé mis à jour');
select pg_temp.ok((select body_text from public.mail_texte_lire(array['00000000-0000-0000-0000-0000000000b1'::uuid])) = E'Voici la [fiche technique](https://a.fr).\nFin', 'titulaire : relecture');
do $$ begin perform 1 from private.mail_textes; raise exception 'ÉCHEC : lecture directe permise';
  exception when insufficient_privilege then raise notice 'ok : private.mail_textes toujours sans accès direct'; end $$;
reset role;
select pg_temp.ok((select count(*) from private.mail_textes) = 1 and (select count(*) from public.prospect_logs) = 1, 'aucune ligne créée ni supprimée');
\echo BILAN v1.66.5 : tous les contrôles sont passés
