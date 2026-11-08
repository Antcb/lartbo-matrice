-- v1.60.4 — essais de la migration « titulaire » sur la BASE LOCALE JETABLE (2026-11-08_v1.60.4_titulaire_base_locale.sql).
-- Repris des essais du lot messagerie (commit 9c6d61c). Données FICTIVES. Transaction annulée à la fin : la base reste telle quelle.
-- Dernière ligne attendue : « BILAN : tous les essais titulaire réussis ».
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean, label text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', label; end if; raise notice 'ok : %', label; end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;

-- 0. Après migration : registre vide, aucune adresse inscrite
do $$ begin perform pg_temp.ok((select count(*) from private.mailbox_owners) = 0, 'registre des titulaires vide après la migration'); end $$;

-- 1. Registre vide : personne ne modifie l'adresse depuis l'application (même le futur titulaire) ; lecture et drive_webhook_url inchangés
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"titulaire@example.com"}', true) \gset ignore_
do $$ declare n int; begin
  perform pg_temp.ok((select value #>> '{}' from settings where key = 'prospect_script_url') like 'https://script.google.com/%', 'registre vide : adresse lisible');
  perform pg_temp.ok(not public.setting_write_ok('prospect_script_url', '"https://script.google.com/macros/s/AKfy_x/exec"'), 'registre vide : setting_write_ok refuse');
  update settings set value = '"https://script.google.com/macros/s/AKfy_x/exec"' where key = 'prospect_script_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'registre vide : modification sans effet');
  delete from settings where key = 'prospect_script_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'registre vide : effacement sans effet');
  update settings set value = '"https://script.google.com/macros/s/AKfy_principal/exec"' where key = 'drive_webhook_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'registre vide : drive_webhook_url modifiable par l''équipe (v1.47)');
end $$;
reset role;
insert into private.mailbox_owners values ('anthony', 'titulaire@example.com');   -- inscription (étape de séance séparée)

-- 2. Autre membre de l'équipe : lecture oui ; modification, effacement, insertion / upsert : refusés
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"collegue@example.com"}', true) \gset ignore_
do $$ declare n int; begin
  perform pg_temp.ok((select value #>> '{}' from settings where key = 'prospect_script_url') like 'https://script.google.com/%', 'autre membre de l''équipe : adresse lisible (la prospection continue)');
  perform pg_temp.ok(not public.is_mailbox_owner('anthony'), 'autre membre : pas titulaire');
  begin update settings set value = '"https://script.google.com/macros/s/AKfy_pirate/exec"' where key = 'prospect_script_url'; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'autre membre de l''équipe : modification de prospect_script_url sans effet');
  exception when others then perform pg_temp.ok(true, 'autre membre de l''équipe : modification de prospect_script_url refusée'); end;
  begin delete from settings where key = 'prospect_script_url'; get diagnostics n = row_count;
    perform pg_temp.ok(n = 0, 'autre membre de l''équipe : effacement de prospect_script_url sans effet');
  exception when others then perform pg_temp.ok(true, 'autre membre : effacement refusé'); end;
  begin insert into settings values ('prospect_script_url', '"https://script.google.com/macros/s/AKfy_pirate/exec"') on conflict (key) do update set value = excluded.value;
    perform pg_temp.ok(false, 'upsert par un autre membre');
  exception when others then perform pg_temp.ok(sqlerrm like '%row-level security%', 'autre membre de l''équipe : insertion / remplacement (upsert) refusés (RLS)'); end;
  perform pg_temp.ok((select value #>> '{}' from settings where key = 'prospect_script_url') like '%AKfy_titulaire%', 'autre membre : adresse intacte');
  update settings set value = '"https://script.google.com/macros/s/AKfy_principal2/exec"' where key = 'drive_webhook_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'drive_webhook_url : règles v1.47 inchangées (équipe)');
end $$;

-- 3. Titulaire : modification, upsert, effacement puis réinsertion acceptés ; adresse qui n'est pas un script publié refusée (v1.47)
select set_config('request.jwt.claims', '{"email":"Titulaire@Example.com"}', true) \gset ignore_
do $$ declare n int; begin
  perform pg_temp.ok(public.is_mailbox_owner('anthony'), 'titulaire reconnu (majuscules ignorées)');
  update settings set value = '"https://script.google.com/macros/s/AKfy_nouveau/exec"' where key = 'prospect_script_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 1 and (select value #>> '{}' from settings where key = 'prospect_script_url') like '%AKfy_nouveau%', 'titulaire : modification acceptée');
  insert into settings values ('prospect_script_url', '"https://script.google.com/a/macros/example.com/s/AKfy_upsert/exec"') on conflict (key) do update set value = excluded.value;
  perform pg_temp.ok((select value #>> '{}' from settings where key = 'prospect_script_url') like '%AKfy_upsert%', 'titulaire : upsert accepté');
  delete from settings where key = 'prospect_script_url'; get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'titulaire : effacement accepté');
  insert into settings values ('prospect_script_url', '"https://script.google.com/macros/s/AKfy_reinsere/exec"');
  perform pg_temp.ok((select value #>> '{}' from settings where key = 'prospect_script_url') like '%AKfy_reinsere%', 'titulaire : réinsertion acceptée');
  begin update settings set value = '"https://exemple.net/x"' where key = 'prospect_script_url'; perform pg_temp.ok(false, 'adresse non script');
  exception when others then perform pg_temp.ok(true, 'titulaire : adresse qui n''est pas un script publié refusée (v1.47)'); end;
end $$;

-- 4. Après effacement par le titulaire : un autre membre ne peut pas réinsérer l'adresse
select set_config('request.jwt.claims', '{"email":"titulaire@example.com"}', true) \gset ignore_
delete from settings where key = 'prospect_script_url';
select set_config('request.jwt.claims', '{"email":"collegue@example.com"}', true) \gset ignore_
do $$ begin
  begin insert into settings values ('prospect_script_url', '"https://script.google.com/macros/s/AKfy_pirate/exec"'); perform pg_temp.ok(false, 'réinsertion par un autre membre');
  exception when others then perform pg_temp.ok(sqlerrm like '%row-level security%', 'adresse effacée : réinsertion par un autre membre refusée (RLS)'); end;
end $$;

-- 5. Hors équipe : rien
select set_config('request.jwt.claims', '{"email":"inconnu@example.com"}', true) \gset ignore_
do $$ begin perform pg_temp.ok(not public.is_mailbox_owner('anthony') and (select count(*) from settings) = 0, 'compte hors équipe : ni titulaire ni lecture'); end $$;
reset role;

-- 6. Registre vidé de nouveau : l'adresse redevient non modifiable par tous
delete from private.mailbox_owners;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"titulaire@example.com"}', true) \gset ignore_
do $$ begin perform pg_temp.ok(not public.setting_write_ok('prospect_script_url', '"https://script.google.com/macros/s/AKfy_x/exec"'), 'registre vide : personne ne modifie l''adresse depuis l''application'); end $$;
reset role;

-- 7. Droits : le registre n'est pas lisible depuis l'application
set local role authenticated;
do $$ begin
  begin perform 1 from private.mailbox_owners; perform pg_temp.ok(false, 'registre lisible');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'registre des titulaires illisible pour un compte connecté'); end;
end $$;
reset role;

select 'BILAN : tous les essais titulaire réussis' as bilan;
rollback;
