-- v1.62 — essais de la migration des agendas des artistes sur la BASE LOCALE JETABLE (voir 2026-11-08_v1.62_agendas_base_locale.sql).
-- Données fictives uniquement. Chaque essai lève une erreur s'il échoue ; tout est annulé à la fin (rollback).
\set ON_ERROR_STOP 1
begin;
insert into public.app_users values ('equipe@essai.test');
insert into public.projects (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Artiste A'), ('00000000-0000-0000-0000-0000000000a2', 'Artiste B');
insert into public.shows (id, project_id, venue, date, status) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Salle', '2027-04-02', 'Confirmée Artiste');

-- 1. Équipe connectée : lecture / écriture (RLS is_team)
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"equipe@essai.test"}', true);
insert into public.artist_calendars (id, project_id, calendar_id, calendar_name) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'a@group.calendar.google.com', 'Agenda A');
insert into public.artist_calendar_events (calendar_ref, project_id, gcal_event_id, all_day, start_date, end_date, title)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'occ_1', true, '2027-03-10', '2027-03-13', 'Vacances');
do $$ begin if (select default_country from public.artist_calendars) <> 'FR' then raise exception 'ESSAI 1 : pays par défaut attendu FR'; end if; end $$;

-- 2. Une ligne par occurrence : doublon refusé, upsert = mise à jour
do $$ begin
  begin
    insert into public.artist_calendar_events (calendar_ref, project_id, gcal_event_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'occ_1');
    raise exception 'ESSAI 2 : doublon accepté';
  exception when unique_violation then null; end;
end $$;
insert into public.artist_calendar_events (calendar_ref, project_id, gcal_event_id, title) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'occ_1', 'Vacances (modifié)')
  on conflict (calendar_ref, gcal_event_id) do update set title = excluded.title;
do $$ begin if (select count(*) from public.artist_calendar_events) <> 1 or (select title from public.artist_calendar_events) <> 'Vacances (modifié)' then raise exception 'ESSAI 2 : upsert'; end if; end $$;

-- 3. Un agenda par artiste ; un agenda Google relié à un seul artiste (sauf déconnecté) ; statut contrôlé
do $$ begin
  begin insert into public.artist_calendars (project_id, calendar_id) values ('00000000-0000-0000-0000-0000000000a1', 'autre@group'); raise exception 'ESSAI 3a : deux agendas pour un artiste';
  exception when unique_violation then null; end;
  begin insert into public.artist_calendars (project_id, calendar_id) values ('00000000-0000-0000-0000-0000000000a2', 'a@group.calendar.google.com'); raise exception 'ESSAI 3b : même agenda pour deux artistes';
  exception when unique_violation then null; end;
  begin update public.artist_calendars set status = 'supprime'; raise exception 'ESSAI 3c : statut inconnu accepté';
  exception when check_violation then null; end;
end $$;
update public.artist_calendars set status = 'deconnecte';
insert into public.artist_calendars (project_id, calendar_id) values ('00000000-0000-0000-0000-0000000000a2', 'a@group.calendar.google.com');   -- permis : l'ancien lien est déconnecté
delete from public.artist_calendars where project_id = '00000000-0000-0000-0000-0000000000a2';
update public.artist_calendars set status = 'actif';
do $$ begin if (select updated_at from public.artist_calendars) is null then raise exception 'ESSAI 3d : updated_at'; end if; end $$;

-- 4. Association explicite : la date reste ; date supprimée → association retirée (set null), événement gardé
update public.artist_calendar_events set show_id = '00000000-0000-0000-0000-0000000000d1';
reset role;
delete from public.shows where id = '00000000-0000-0000-0000-0000000000d1';
do $$ begin if (select show_id from public.artist_calendar_events) is not null or (select count(*) from public.artist_calendar_events) <> 1 then raise exception 'ESSAI 4 : association'; end if; end $$;

-- 5. Compte hors équipe : rien de visible, rien d'écrit ; anon : aucun droit
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"inconnu@essai.test"}', true);
do $$ begin if (select count(*) from public.artist_calendars) + (select count(*) from public.artist_calendar_events) <> 0 then raise exception 'ESSAI 5a : visible hors équipe'; end if;
  begin insert into public.artist_calendars (project_id, calendar_id) values ('00000000-0000-0000-0000-0000000000a2', 'x@group'); raise exception 'ESSAI 5b : écriture hors équipe';
  exception when insufficient_privilege then null; end;
end $$;
-- secrets et adresses : schéma privé inaccessible ; tâche planifiée et secret interdits aux comptes connectés
do $$ begin
  begin perform 1 from private.import_secrets; raise exception 'ESSAI 5c : secrets lisibles'; exception when insufficient_privilege then null; end;
  begin perform 1 from private.sync_urls; raise exception 'ESSAI 5d : adresses lisibles'; exception when insufficient_privilege then null; end;
  begin perform public.cal_sync_tick(); raise exception 'ESSAI 5e : tâche appelable'; exception when insufficient_privilege then null; end;
  begin perform public.import_secret('cal_sync_hook'); raise exception 'ESSAI 5f : secret lisible'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin begin perform 1 from public.artist_calendars; raise exception 'ESSAI 5g : anon lit'; exception when insufficient_privilege then null; end; end $$;
reset role;

-- 6. Tâche planifiée : rien sans adresse, rien vers une adresse étrangère, un appel avec en-tête secret vers la fonction ; rien sans agenda actif
do $$ declare sec text := (select value from private.import_secrets where key = 'cal_sync_hook'); begin
  if sec is null or length(sec) <> 64 or sec !~ '^[0-9a-f]+$' then raise exception 'ESSAI 6a : secret dédié absent ou mal formé'; end if;
  if sec = coalesce((select value from private.import_secrets where key = 'drive_webhook_secret'), '') then raise exception 'ESSAI 6b : secret partagé'; end if;
  if coalesce(length((select value from private.import_secrets where key = 'cal_script_secret')), 0) <> 64
     or (select value from private.import_secrets where key = 'cal_script_secret') = sec then raise exception 'ESSAI 6b2 : secret dédié du script des agendas'; end if;
  perform public.cal_sync_tick();
  if (select count(*) from net._appels) <> 0 then raise exception 'ESSAI 6c : appel sans adresse'; end if;
  insert into private.sync_urls values ('cal-sync', 'https://pirate.example.com/functions/v1/cal-sync');
  perform public.cal_sync_tick();
  if (select count(*) from net._appels) <> 0 then raise exception 'ESSAI 6d : appel vers une adresse étrangère'; end if;
  update private.sync_urls set url = 'https://abcdefghijklmnop.supabase.co/functions/v1/cal-sync' where key = 'cal-sync';
  perform public.cal_sync_tick();
  if (select count(*) from net._appels) <> 1 or (select headers ->> 'x-hook-secret' from net._appels) <> sec or (select body ->> 'mode' from net._appels) <> 'sync'
     or position(sec in (select url from net._appels)) > 0 then raise exception 'ESSAI 6e : appel attendu (secret en en-tête seulement)'; end if;
  update public.artist_calendars set status = 'pause';
  perform public.cal_sync_tick();
  if (select count(*) from net._appels) <> 1 then raise exception 'ESSAI 6f : appel sans agenda actif'; end if;
end $$;

-- 7. Publication temps réel et RLS activée
do $$ begin
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('artist_calendars', 'artist_calendar_events')) <> 2 then raise exception 'ESSAI 7a : temps réel'; end if;
  if exists (select 1 from pg_class where relname in ('artist_calendars', 'artist_calendar_events') and not relrowsecurity) then raise exception 'ESSAI 7b : RLS'; end if;
end $$;
\echo 'BILAN v1.62 agendas : tous les essais réussis (annulés)'
rollback;
