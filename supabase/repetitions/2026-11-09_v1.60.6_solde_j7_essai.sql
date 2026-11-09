-- v1.60.6 — ESSAI sur BASE LOCALE JETABLE (PostgreSQL 16 nu, jamais Supabase, jamais la production), données fictives.
-- Usage : createdb essai ; rôles authenticated, anon, service_role ;
--   psql -d essai -f supabase/repetitions/2026-11-07_v1.60.3_suppression_date_base_locale.sql
--   psql -d essai -f supabase/migrations/2026-11-07_v1.60.3_suppression_date.sql
--   psql -d essai -f supabase/migrations/2026-11-09_v1.60.6_solde_j7.sql   (deux fois : rejouable)
--   psql -v ON_ERROR_STOP=1 -d essai -f ce_fichier   → « ESSAI v1.60.6 : tout est conforme » ; tout est annulé (rollback).
-- Cas : solde fait tôt (plancher J-7), solde fait après J-7 (3 j après), J-7 un samedi (vendredi), acompte inchangé, date sans
-- jour de concert inchangée, plancher combiné avec une prochaine échéance de réactivation, opération de retrait des rappels
-- prématurés (retrait, pas de rattrapage, retour unique au jour J-7, rejouable).
begin;
do $e$
declare
  t date := (now() at time zone 'Europe/Paris')::date;
  j7 date; n int; c record; d_we date; k text;
  p uuid := gen_random_uuid();
  s_tot uuid := gen_random_uuid(); s_tard uuid := gen_random_uuid(); s_we uuid := gen_random_uuid(); s_nul uuid := gen_random_uuid(); s_rea uuid := gen_random_uuid();
  so_tot uuid := gen_random_uuid(); ac_tot uuid := gen_random_uuid(); so_tard uuid := gen_random_uuid(); so_we uuid := gen_random_uuid();
  so_nul uuid := gen_random_uuid(); so_rea uuid := gen_random_uuid();
  fn_j7 text := 'select (d - 7) - (case extract(isodow from d - 7) when 6 then 1 when 7 then 2 else 0 end)::int';
begin
  insert into projects (id, name) values (p, 'ESSAI solde');
  -- J-7 un samedi : premier jour D ≥ t+30 tel que D-7 soit un samedi
  d_we := t + 30; while extract(isodow from d_we - 7) <> 6 loop d_we := d_we + 1; end loop;
  insert into shows (id, project_id, venue, date, status, prod_mode, contract_sent) values
    (s_tot,  p, 'Salle tôt',  t + 23, 'Confirmée Salle', 'production', t - 20),
    (s_tard, p, 'Salle tard', t + 5,  'Confirmée Salle', 'production', null),
    (s_we,   p, 'Salle WE',   d_we,   'Confirmée Salle', 'production', null),
    (s_nul,  p, 'Salle sans jour', null, 'Confirmée Salle', 'production', null),
    (s_rea,  p, 'Salle réactivée', t + 23, 'Confirmée Salle', 'production', null);
  insert into show_payments (id, show_id, kind, label, pct, invoice_number, invoiced_on, sort) values
    (ac_tot,  s_tot,  'acompte', 'Acompte', 30, 'F-E-1', t - 4, 1),
    (so_tot,  s_tot,  'solde',   'Solde',   70, 'F-E-2', t - 4, 2),
    (so_tard, s_tard, 'solde',   'Solde',  100, 'F-E-3', t - 4, 1),
    (so_we,   s_we,   'solde',   'Solde',  100, 'F-E-4', t - 4, 1),
    (so_nul,  s_nul,  'solde',   'Solde',  100, 'F-E-5', t - 4, 1),
    (so_rea,  s_rea,  'solde',   'Solde',  100, 'F-E-6', t - 4, 1);
  -- plancher de réactivation plus tardif que J-7 : il l'emporte (greatest)
  perform set_config('matrice.archive_rpc', 'on', true);   -- comme reactivate_reminders (garde shows_archive_guard)
  update shows set reminders_next = jsonb_build_object('facture_envoi', (t + 20)::text) where id = s_rea;
  perform set_config('matrice.archive_rpc', '', true);

  -- 1. solde fait tôt : échéance = J-7 (jour ouvré), clé brute inchangée (facture faite + 3)
  j7 := (t + 23 - 7) - (case extract(isodow from t + 23 - 7) when 6 then 1 when 7 then 2 else 0 end)::int;
  select * into c from reminder_candidates(s_tot, false) x where x.r = 'facture_envoi' and x.k = s_tot || ':' || so_tot;
  if c.raw <> t - 1 or (c.nxt ->> 'facture_envoi')::date <> j7 then raise exception 'cas 1 : raw % plancher % (attendu % / %)', c.raw, c.nxt, t - 1, j7; end if;
  -- acompte de la même date : inchangé (pas de plancher)
  select * into c from reminder_candidates(s_tot, false) x where x.r = 'facture_envoi' and x.k = s_tot || ':' || ac_tot;
  if c.raw <> t - 1 or c.nxt is not null then raise exception 'cas acompte : raw % nxt %', c.raw, c.nxt; end if;
  -- 2. solde fait après J-7 : J-7 passé, la règle des 3 jours s'applique
  select * into c from reminder_candidates(s_tard, false) x where x.r = 'facture_envoi';
  if greatest(workday(c.raw), (c.nxt ->> 'facture_envoi')::date) <> workday(t - 1) then raise exception 'cas 2 : %', c; end if;
  -- 3. J-7 un samedi : vendredi précédent
  select * into c from reminder_candidates(s_we, false) x where x.r = 'facture_envoi';
  if (c.nxt ->> 'facture_envoi')::date <> d_we - 8 or extract(isodow from d_we - 8) <> 5 then raise exception 'cas 3 : % (attendu %)', c.nxt, d_we - 8; end if;
  -- 4. date sans jour de concert : règle actuelle
  select * into c from reminder_candidates(s_nul, false) x where x.r = 'facture_envoi';
  if c.nxt is not null or c.raw <> t - 1 then raise exception 'cas 4 : %', c; end if;
  -- 5. plancher de réactivation plus tardif : gardé
  select * into c from reminder_candidates(s_rea, false) x where x.r = 'facture_envoi';
  if (c.nxt ->> 'facture_envoi')::date <> t + 20 then raise exception 'cas 5 : %', c.nxt; end if;

  -- generate_reminders : acompte, solde tardif, sans jour → créés ; solde tôt, samedi, réactivé → pas encore
  perform generate_reminders();
  select count(*) into n from notifications where kind = 'facture_envoi' and show_id in (s_tot, s_tard, s_we, s_nul, s_rea);
  if n <> 3 then raise exception 'generate_reminders : % rappels (attendu 3)', n; end if;
  if exists (select 1 from notifications where dedupe_key like 'facture_envoi:' || s_tot || ':' || so_tot || '%') then raise exception 'solde tôt notifié avant J-7'; end if;

  -- 6. rappel prématuré déjà créé par l'ancienne règle (cas Brise Glace) → opération de retrait
  k := 'facture_envoi:' || s_tot || ':' || so_tot || ':' || (t - 1);
  insert into notifications (kind, title, show_id, dedupe_key, emailed_at) values ('facture_envoi', 'Facture à envoyer : Solde (F-E-2) — Salle tôt', s_tot, k, now());
end $e$;
-- l'opération elle-même (inventaire, retrait gardé, attendu = 1)
\i supabase/operations/2026-11-09_v1.60.6_rappels_solde.sql
do $e$
declare n int; t date := (now() at time zone 'Europe/Paris')::date; s uuid; so uuid; k text;
begin
  select show_id, split_part(dedupe_key, ':', 3)::uuid, split_part(dedupe_key, ':retire', 1) into s, so, k
    from notifications where dedupe_key like '%:retire-v1.60.6';
  if s is null then raise exception 'cas 6 : notification non retirée'; end if;
  if not exists (select 1 from notifications where dedupe_key = k || ':retire-v1.60.6' and withdrawn_at is not null and withdrawn_reason like 'v1.60.6 : rappel créé trop tôt%') then raise exception 'cas 6 : motif'; end if;
  -- pas de rattrapage immédiat
  perform generate_reminders();
  if exists (select 1 from notifications where dedupe_key = k) then raise exception 'cas 6 : rattrapage immédiat'; end if;
  -- plus aucun rappel actif de cette facture avant J-7 (une 2e exécution de l'opération ne trouve rien : essai séparé)
  if exists (select 1 from notifications n where n.kind = 'facture_envoi' and n.withdrawn_at is null and n.show_id = s and n.dedupe_key like 'facture_envoi:' || s || ':' || so || '%') then raise exception 'cas 6 : actif restant'; end if;
  -- J-7 atteint (simulé : concert avancé à t+7, J-7 = aujourd'hui ou avant) → recréé UNE fois avec la clé d'origine
  update shows set date = t + 7 where id = s;
  perform generate_reminders(); perform generate_reminders();
  select count(*) into n from notifications where dedupe_key = k and withdrawn_at is null;
  if n <> 1 then raise exception 'cas 6 : % rappel(s) au jour J-7 (attendu 1)', n; end if;
  select count(*) into n from notifications where show_id = s and kind = 'facture_envoi' and dedupe_key like 'facture_envoi:' || s || ':' || so || '%';
  if n <> 2 then raise exception 'cas 6 : % lignes (attendu : la retirée + la nouvelle)', n; end if;
  raise notice 'ESSAI v1.60.6 : tout est conforme';
end $e$;
rollback;
