-- =====================================================================================================
-- ESSAI v1.47 (lot Sécurité) — PROJET DE TEST UNIQUEMENT, dans une transaction ANNULÉE (exception finale) : rien n'est gardé.
-- La migration 2026-10-27_v1.47_secrets.sql est insérée à la place de la ligne repère ci-dessous.
-- Contrôles en se faisant passer pour : un compte de l'équipe, un compte connecté hors équipe, un visiteur (anon).
-- Aucune valeur de secret n'est lue ni affichée (seulement des comptages).
-- =====================================================================================================
begin;
do $g$ begin
  if exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%ypvvjoqhzddzbmerypdc%') then
    raise exception 'ARRET : ceci est la PRODUCTION — essai réservé au projet de test'; end if;
end $g$;

--@@MIGRATION@@

create temp table essai_bilan (n serial, quoi text);
grant all on essai_bilan to authenticated, anon;
grant usage, select on sequence essai_bilan_n_seq to authenticated, anon;
-- base, avant de changer de rôle : ce que lisent les fonctions du serveur (propriétaire de la table)
insert into essai_bilan (quoi) select '0 base (propriétaire) : ' || count(*) || ' secret(s) toujours lisibles côté serveur' from settings where public.is_secret_setting(key);

-- 1. compte de l'équipe
set local role authenticated;
set local request.jwt.claims = '{"email":"production@lartboristerie.com","role":"authenticated"}';
do $e$ declare c int; ok boolean;
begin
  if not public.is_team() then raise exception 'ECHEC 1 : le compte de test n''est pas de l''équipe'; end if;
  select count(*) into c from settings where key in ('brevo_api_key', 'brevo_hook_secret', 'drive_webhook_secret');
  if c <> 0 then raise exception 'ECHEC 1 : % secret(s) lisible(s) par un compte de l''équipe', c; end if;
  select count(*) into c from settings where key in ('site_url', 'default_acompte_pct', 'drive_webhook_url');
  if c = 0 then raise exception 'ECHEC 1 : réglages ordinaires illisibles'; end if;
  update settings set value = to_jsonb('essai'::text) where key = 'drive_webhook_secret';
  get diagnostics c = row_count;
  if c <> 0 then raise exception 'ECHEC 1 : secret modifiable par le navigateur'; end if;
  begin
    insert into settings (key, value) values ('brevo_hook_secret', to_jsonb('essai'::text));
    raise exception 'ECHEC 1 : secret insérable par le navigateur';
  exception when insufficient_privilege then null;   -- refus attendu (règle d'accès)
  end;
  delete from settings where key = 'drive_webhook_secret';
  get diagnostics c = row_count;
  if c <> 0 then raise exception 'ECHEC 1 : secret supprimable par le navigateur'; end if;
  -- un réglage ordinaire reste modifiable
  update settings set value = value where key = 'site_url';
  -- clé Brevo par la fonction dédiée
  perform public.set_brevo_key('xkeysib-essaiessaiessaiessaiessai01');
  if public.brevo_key_status() is distinct from true then raise exception 'ECHEC 1 : clé Brevo non enregistrée'; end if;
  begin perform public.set_brevo_key('pas-une-cle'); raise exception 'ECHEC 1 : clé Brevo invalide acceptée';
  exception when raise_exception then if sqlerrm like 'ECHEC%' then raise; end if; end;
  perform public.set_brevo_key('');
  if public.brevo_key_status() is distinct from false then raise exception 'ECHEC 1 : clé Brevo non retirée'; end if;
  insert into essai_bilan (quoi) values ('1 équipe : 0 secret lisible, ni modifiable, ni insérable, ni supprimable ; réglages ordinaires lisibles ; clé Brevo par set_brevo_key (format vérifié), état par brevo_key_status');
end $e$;

-- 2. compte connecté hors équipe
set local request.jwt.claims = '{"email":"inconnu@example.com","role":"authenticated"}';
do $e$ declare c int;
begin
  select count(*) into c from settings;
  if c <> 0 then raise exception 'ECHEC 2 : % réglage(s) lisible(s) hors équipe', c; end if;
  begin perform public.set_brevo_key('xkeysib-essaiessaiessaiessaiessai01'); raise exception 'ECHEC 2 : set_brevo_key permis hors équipe';
  exception when raise_exception then if sqlerrm like 'ECHEC%' then raise; end if; end;
  if public.brevo_key_status() is not null then raise exception 'ECHEC 2 : état de la clé révélé hors équipe'; end if;
  insert into essai_bilan (quoi) values ('2 hors équipe : aucun réglage lisible, set_brevo_key refusé, état non révélé');
end $e$;

-- 3. visiteur (pages publiques)
reset request.jwt.claims;
set local role anon;
do $e$ declare c int;
begin
  begin select count(*) into c from settings; exception when insufficient_privilege then c := 0; end;
  if c <> 0 then raise exception 'ECHEC 3 : réglages lisibles par un visiteur'; end if;
  begin perform public.set_brevo_key(''); raise exception 'ECHEC 3 : set_brevo_key exécutable par un visiteur';
  exception when insufficient_privilege then null; end;
  insert into essai_bilan (quoi) values ('3 visiteur : aucun réglage lisible, set_brevo_key non exécutable');
end $e$;
reset role;

-- 4. règles d'accès et droits en place
insert into essai_bilan (quoi) select '4 règle ' || policyname || ' (' || cmd || ')' from pg_policies where schemaname = 'public' and tablename = 'settings' order by policyname;
insert into essai_bilan (quoi)
select '4 droits ' || p.proname || ' ' || coalesce(array_to_string(p.proacl, ','), 'défaut') || case when p.prosecdef then ' definer' else '' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('set_brevo_key', 'brevo_key_status', 'is_secret_setting');

do $f$ begin raise exception 'ESSAI v1.47 RÉUSSI (tout est annulé, rien n''est gardé) :%', E'\n' || (select string_agg(n || '. ' || quoi, E'\n' order by n) from essai_bilan); end $f$;
rollback;
