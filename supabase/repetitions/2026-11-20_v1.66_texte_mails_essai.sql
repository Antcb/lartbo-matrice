-- v1.66 — essai des droits du texte intégral des mails privés, sur la base locale jetable (2026-11-20_v1.66_texte_mails_base_locale.sql
-- puis la migration v1.66). Chaque contrôle lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1) ; aucune donnée réelle.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.qui(e text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', e, 'role', 'authenticated')::text, false) $$;

-- 1. Titulaire : écrit, relit ; second envoi = aucun écrasement
set role authenticated; select pg_temp.qui('titulaire@example.com');
select pg_temp.ok(public.mail_texte_ecrire('00000000-0000-0000-0000-0000000000b1', 'TEXTE PRIVÉ DU MAIL'), 'titulaire : texte enregistré');
select pg_temp.ok(not public.mail_texte_ecrire('00000000-0000-0000-0000-0000000000b1', 'AUTRE'), 'titulaire : second envoi refusé (jamais d''écrasement)');
select pg_temp.ok((select body_text from public.mail_texte_lire(array['00000000-0000-0000-0000-0000000000b1'::uuid])) = 'TEXTE PRIVÉ DU MAIL', 'titulaire : relecture du texte');
select pg_temp.ok(not public.mail_texte_ecrire('00000000-0000-0000-0000-0000000000b2', '   '), 'titulaire : texte vide ignoré');
-- accès direct à la table, même pour le titulaire : refusé (seulement par les fonctions)
do $$ begin perform 1 from private.mail_textes; raise exception 'ÉCHEC : lecture directe permise au titulaire';
exception when insufficient_privilege then raise notice 'ok : titulaire, lecture directe de private.mail_textes refusée'; end $$;

-- 2. Autre compte de l'équipe : ne lit rien, n'écrit rien, aucun accès direct
select pg_temp.qui('collegue@example.com');
select pg_temp.ok((select count(*) from public.mail_texte_lire(array['00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid])) = 0, 'collègue : mail_texte_lire ne rend rien');
select pg_temp.ok((select count(*) from public.mail_messages) = 0, 'collègue : mail_messages invisible (RLS)');
do $$ begin perform public.mail_texte_ecrire('00000000-0000-0000-0000-0000000000b2', 'PIRATE'); raise exception 'ÉCHEC : écriture permise au collègue';
exception when insufficient_privilege then raise notice 'ok : collègue, écriture refusée'; end $$;
do $$ begin perform 1 from private.mail_textes; raise exception 'ÉCHEC : lecture directe permise au collègue';
exception when insufficient_privilege then raise notice 'ok : collègue, lecture directe refusée'; end $$;
do $$ begin insert into private.mail_textes values ('00000000-0000-0000-0000-0000000000b2', 'PIRATE'); raise exception 'ÉCHEC : insertion directe permise';
exception when insufficient_privilege then raise notice 'ok : collègue, insertion directe refusée'; end $$;
-- compte hors équipe, sans adresse
select pg_temp.qui('inconnu@example.com');
select pg_temp.ok((select count(*) from public.mail_texte_lire(array['00000000-0000-0000-0000-0000000000b1'::uuid])) = 0, 'hors équipe : rien');
reset role;

-- 3. anon : aucune exécution des fonctions
set role anon;
do $$ begin perform public.mail_texte_lire(array['00000000-0000-0000-0000-0000000000b1'::uuid]); raise exception 'ÉCHEC : anon exécute mail_texte_lire';
exception when insufficient_privilege then raise notice 'ok : anon, mail_texte_lire refusée'; end $$;
do $$ begin perform public.mail_texte_ecrire('00000000-0000-0000-0000-0000000000b2', 'x'); raise exception 'ÉCHEC : anon exécute mail_texte_ecrire';
exception when insufficient_privilege then raise notice 'ok : anon, mail_texte_ecrire refusée'; end $$;
reset role;

-- 4. Rôle de sauvegarde : table hors copie (aucun droit de lecture → pg_dump l'exclut, classement « exclue_decidee »)
select pg_temp.ok(not has_table_privilege('sauvegarde', 'private.mail_textes', 'SELECT'), 'sauvegarde : aucune lecture de private.mail_textes');
select pg_temp.ok(not has_table_privilege('authenticated', 'private.mail_textes', 'SELECT') and not has_table_privilege('anon', 'private.mail_textes', 'SELECT'), 'aucun droit anon / authenticated sur la table');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mail_messages' and column_name = 'body_text'), 'aucun texte dans mail_messages (sauvegardée et exportée)');
-- 5. Aucune autre fonction ni vue ne lit la table (seules les deux fonctions du lot)
select pg_temp.ok((select array_agg(p.proname order by p.proname) from pg_proc p where p.prosrc ilike '%mail_textes%') = array['mail_texte_ecrire', 'mail_texte_lire']::name[], 'seules mail_texte_lire / mail_texte_ecrire lisent la table');
select pg_temp.ok(not exists (select 1 from pg_views where definition ilike '%mail_textes%'), 'aucune vue sur la table');
-- 6. Suppression d'un message : son texte part avec lui
delete from public.mail_messages where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select count(*) from private.mail_textes) = 0, 'message supprimé : texte supprimé avec lui');
\echo 'v1.66 : tous les contrôles des droits sont passés'
