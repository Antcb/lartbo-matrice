-- =====================================================================================================
-- ESSAIS DE DROITS RÉELS — projet de TEST uniquement (dthfocplfzzmkgaxhmwk), après installation durable du lot D1 et v1.45.
-- Chaque profil est joué avec le vrai rôle de l'API (anon / authenticated / service_role) et le jeton simulé
-- (request.jwt.claims) : mêmes politiques RLS, mêmes droits, mêmes déclencheurs que les appels de l'application.
-- Données FICTIVES créées dans la transaction ; TOUT est annulé à la fin (erreur voulue « BILAN DROITS … »).
-- =====================================================================================================
do $t$
declare pj uuid; sid uuid; lid uuid; cid uuid; tid uuid; k int; v text; ok boolean; acpt text; nlig int;
  res text[] := '{}';
begin
  if not exists (select 1 from public.settings where key = 'functions_base_url' and value::text like '%dthfocplfzzmkgaxhmwk%') then
    raise exception 'ARRET : ce n''est pas le projet de TEST'; end if;
  create temp table _r (n serial, profil text, essai text, attendu text, obtenu text) on commit drop;
  grant all on _r to anon, authenticated, service_role; grant usage, select on sequence _r_n_seq to anon, authenticated, service_role;
  select id into pj from public.projects order by name limit 1;
  insert into public.shows (project_id, venue, date, fee_ht, artbo_pct, partner_pct, prod_mode, prod_mode_manual, contract_type, status)
    values (pj, 'Salle Essai droits', current_date + 60, 4000, 15, 30, 'production', true, 'Cession', 'Confirmée Salle') returning id into sid;
  -- lignes créées par la confirmation de la date (on_show_confirmed), comme dans l'application
  select id into lid from public.show_payments where show_id = sid and kind = 'acompte' order by sort limit 1;
  select id into cid from public.show_payments where show_id = sid and kind = 'artbo' limit 1;
  if lid is null or cid is null then raise exception 'ARRET : lignes de la date d''essai non créées'; end if;
  select (round(4000 * pct) / 100)::numeric(12,2)::text into acpt from public.show_payments where id = lid;
  select count(*) into nlig from public.show_payments where show_id = sid;

  -- ───── visiteur non connecté (clé publique seule)
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  select count(*) into k from public.show_payments; insert into _r (profil, essai, attendu, obtenu) values ('anon', 'lire les factures', '0 ligne', k || ' ligne');
  begin insert into public.shows (venue) values ('x'); insert into _r (profil, essai, attendu, obtenu) values ('anon', 'créer une date', 'refusé', 'ACCEPTÉ');
  exception when others then insert into _r (profil, essai, attendu, obtenu) values ('anon', 'créer une date', 'refusé', 'refusé'); end;
  begin select count(*) into k from public.finance_log; insert into _r (profil, essai, attendu, obtenu) values ('anon', 'lire le journal financier', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('anon', 'lire le journal financier', 'refusé', 'refusé'); end;
  begin select count(*) into k from public.commission_transfers; insert into _r (profil, essai, attendu, obtenu) values ('anon', 'lire les versements', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('anon', 'lire les versements', 'refusé', 'refusé'); end;
  begin truncate public.show_payments; insert into _r (profil, essai, attendu, obtenu) values ('anon', 'vider les factures (TRUNCATE)', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('anon', 'vider les factures (TRUNCATE)', 'refusé', 'refusé'); end;
  reset role;

  -- ───── connecté mais hors équipe
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"inconnu@exemple.test"}', true); set local role authenticated;
  select count(*) into k from public.show_payments; insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'lire les factures', '0 ligne', k || ' ligne');
  select count(*) into k from public.finance_log; insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'lire le journal', '0 ligne', k || ' ligne');
  update public.show_payments set amount = 1 where id = lid; get diagnostics k = row_count;
  insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'modifier une facture (invisible)', '0 ligne', k || ' ligne');
  begin insert into public.commission_transfers (payment_id, amount, transferred_at) values (cid, 10, current_date);
    insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'noter un versement', 'refusé', 'ACCEPTÉ');
  exception when others then insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'noter un versement', 'refusé', 'refusé'); end;
  begin truncate public.shows; insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'vider les dates (TRUNCATE)', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('hors équipe', 'vider les dates (TRUNCATE)', 'refusé', 'refusé'); end;
  reset role;

  -- ───── membre de l'équipe (compte présent dans app_users du test)
  select email into v from public.app_users order by email limit 1;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v)::text, true); set local role authenticated;
  select count(*) into k from public.show_payments where show_id = sid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'lire les factures de la date', nlig || ' ligne', k || ' ligne');
  update public.show_payments set sent_at = current_date, invoice_number = 'ESSAI-1' where id = lid;
  select amount::text into v from public.show_payments where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'acompte émis : montant figé à l''émission', acpt, v);
  begin update public.show_payments set amount = 1500 where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'modifier un montant figé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'modifier un montant figé', 'refusé', 'refusé'); end;
  begin update public.show_payments set invoice_number = 'AUTRE' where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'changer le numéro d''une facture émise', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'changer le numéro d''une facture émise', 'refusé', 'refusé'); end;
  update public.shows set fee_ht = 5000 where id = sid;
  select amount::text into v from public.show_payments where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'cachet changé : montant émis inchangé', acpt, v);
  begin update public.shows set prod_mode = 'booking' where id = sid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'mode changé sur une date engagée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'mode changé sur une date engagée', 'refusé', 'refusé'); end;
  begin update public.shows set vat_rate = 20 where id = sid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'TVA changée sur une date engagée', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'TVA changée sur une date engagée', 'refusé', 'refusé'); end;
  -- commission de production : versement partiel, historique, reste
  insert into public.commission_transfers (payment_id, amount, transferred_at, reference) values (cid, 300, current_date, 'VIR ESSAI 1') returning id into tid;
  insert into public.commission_transfers (payment_id, amount, transferred_at, reference) values (cid, 200, current_date, 'VIR ESSAI 2');
  select public.commission_transferred(cid)::text || ' / ' || (select public.commission_total(p) from public.show_payments p where p.id = cid)::text into v;
  insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'deux versements partiels : transféré / total', '500.00 / 750.00', v);
  begin insert into public.commission_transfers (payment_id, amount, transferred_at) values (cid, 1000, current_date);
    insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'verser plus que le reste', 'refusé', 'ACCEPTÉ');
  exception when others then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'verser plus que le reste', 'refusé', 'refusé'); end;
  begin update public.commission_transfers set amount = 1 where id = tid; get diagnostics k = row_count;
    insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'modifier un versement', 'refusé', 'ACCEPTÉ (' || k || ')');
  exception when insufficient_privilege or sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'modifier un versement', 'refusé', 'refusé'); end;
  begin delete from public.commission_transfers where id = tid; get diagnostics k = row_count;
    insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'supprimer un versement', 'refusé', 'ACCEPTÉ (' || k || ')');
  exception when insufficient_privilege or sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'supprimer un versement', 'refusé', 'refusé'); end;
  select count(*) into k from public.finance_log where row_id in (lid, cid, sid) or table_name = 'commission_transfers';
  insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'journal : écritures lisibles', 'oui', case when k >= 4 then 'oui' else 'non (' || k || ')' end);
  begin insert into public.finance_log (table_name, row_id, op, field) values ('x', sid, 'x', 'x'); insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'écrire dans le journal', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'écrire dans le journal', 'refusé', 'refusé'); end;
  begin delete from public.finance_log; get diagnostics k = row_count;
    insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'effacer le journal', 'refusé', 'ACCEPTÉ (' || k || ')');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'effacer le journal', 'refusé', 'refusé'); end;
  begin update public.show_payments set hors_calcul = 'essai' where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'classer « hors calcul » depuis l''application', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'classer « hors calcul » depuis l''application', 'refusé', 'refusé'); end;
  begin truncate public.commission_transfers; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'vider les versements (TRUNCATE)', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'vider les versements (TRUNCATE)', 'refusé', 'refusé'); end;
  begin delete from public.show_payments where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'supprimer une facture émise', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('équipe', 'supprimer une facture émise', 'refusé', 'refusé'); end;
  reset role;

  -- ───── rôle serveur (fonctions edge, sauvegarde)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;
  begin truncate public.show_payments; insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'vider les factures (TRUNCATE)', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'vider les factures (TRUNCATE)', 'refusé', 'refusé'); end;
  begin insert into public.finance_log (table_name, row_id, op, field) values ('x', sid, 'x', 'x'); insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'écrire dans le journal', 'refusé', 'ACCEPTÉ');
  exception when insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'écrire dans le journal', 'refusé', 'refusé'); end;
  begin update public.commission_transfers set amount = 1 where payment_id = cid; insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'modifier un versement', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' or insufficient_privilege then insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'modifier un versement', 'refusé', 'refusé'); end;
  begin update public.show_payments set amount = 1 where id = lid; insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'modifier un montant figé', 'refusé', 'ACCEPTÉ');
  exception when sqlstate 'P0001' then insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'modifier un montant figé', 'refusé', 'refusé'); end;
  select count(*) into k from public.show_payments; insert into _r (profil, essai, attendu, obtenu) values ('serveur', 'lire les factures (sauvegarde)', 'oui', case when k > 0 then 'oui' else 'non' end);
  reset role;

  select string_agg(profil || ' · ' || essai || ' → attendu « ' || attendu || ' », obtenu « ' || obtenu || ' »', ' | ' order by n) into v from _r where obtenu is distinct from attendu;
  if v is not null then raise exception 'ECHEC DROITS : % — TOUT EST ANNULÉ', v; end if;
  raise exception using errcode = 'P0001', message = 'BILAN DROITS : CONFORME (' || (select count(*) from _r) || ' essais, 4 profils). TOUT EST ANNULÉ. ' || (select string_agg(profil || ' · ' || essai || ' : ' || obtenu, ' ; ' order by n) from _r);
end $t$;
