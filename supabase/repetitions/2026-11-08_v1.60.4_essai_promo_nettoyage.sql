-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v1.60.4 — NETTOYAGE EXACT du cas d'essai « ESSAI promo » (créé par 2026-11-08_v1.60.4_essai_promo_coproduction.sql).
-- Sur la même base que le script de création (jamais la production). Exécuté et vérifié par l'agent sur base jetable locale.
-- Une seule transaction : TOUT ou RIEN. Corrigé après relecture indépendante (B1, 08/11/2026).
--
-- PÉRIMÈTRE DE L'ESSAI (seuls objets supprimés) — identifiants fixes e55a1000-0000-4000-a000-0000000000xx :
--   artiste …001 « ESSAI promo » · coproducteur …002 « ESSAI promo — coproducteur fictif » · structure …003 « ESSAI promo — salle
--   fictive » · dates …011, …012, …013 (lieu « ESSAI promo — … », artiste …001) · dépenses …021 à …026 (sur ces dates, artiste …001)
--   · historique de clôture result_closures de ces 3 dates (une clôture faite pendant l'essai est d'abord levée).
-- CLASSEMENT DES TABLES (décision d'Anthony du 08/11/2026 : distinguer la trace conservée des dépendances opérationnelles ; ne
-- jamais supprimer une ligne de journal technique parce qu'elle bloquerait le nettoyage) — corrigé après relecture de a7216a9 :
--   • TRACES CONSERVÉES — jamais modifiées ni vidées, JAMAIS bloquantes, même si leurs lignes citent un identifiant d'essai :
--       finance_log (journal financier, écrit par déclencheur) ; show_deletions (journal des suppressions de dates) ;
--       client_errors (journal des erreurs de l'application : ses messages peuvent citer un identifiant) ;
--       _probe, _koza_job, _lartbotrice_job (tables techniques, CONVENTIONS §7.8, jamais touchées).
--   • DÉPENDANCES OPÉRATIONNELLES — toute autre table (liste lue dans le catalogue à l'exécution, pas écrite à la main) ; une ligne
--     qui cite un identifiant d'essai hors du périmètre ARRÊTE le nettoyage. Dont, explicitement : pennylane_rattachements (facture
--     Pennylane RÉELLE reliée à une date d'essai ; sa clé vers la date est « set null » : la retirer modifierait ce journal) ;
--     pennylane_a_rattacher ; _folder_jobs (création de dossier Drive en attente) ; notifications (liste de travail de l'équipe —
--     voir l'option ci-dessous) ; prospect_logs / project_logs (échanges saisis) ; tâches, suivis, modèles, contacts, etc.
--   • OPTION notifications : les notifications d'une date ou de l'artiste d'essai (show_id d'une date d'essai ou project_id de
--     l'artiste d'essai sans autre date, y compris retirées) bloquent par défaut ; avec la ligne « set essai.notifications = 'conserver'; » placée
--     avant le script, elles sont COPIÉES dans la trace (show_deletions) puis retirées de la liste active, comme le reste du dossier.
-- TRACE DU DOSSIER : avant tout retrait, une copie complète de chaque date d'essai (lignes, historique de clôture, notifications
--   si l'option est donnée, artiste / coproducteur / structure d'essai) est écrite dans show_deletions.
--
-- VÉRIFICATIONS, dans l'ordre ; à la première qui échoue : ARRÊT, RIEN n'est supprimé ni modifié (message en clair) :
--   1. identité : chaque identifiant fixe encore présent porte bien l'objet d'essai (nom / lieu / artiste ci-dessus) ; les dépenses
--      …021 à …026 sont toujours sur une date d'essai et l'artiste d'essai ;
--   2. AUCUNE AUTRE LIGNE de la base (schéma public, TOUTES les tables, inventaire fait à l'exécution — catalogue de la base, pas une
--      liste écrite à la main) ne contient l'un de ces identifiants, dans quelque colonne que ce soit : clé étrangère (cascade,
--      set null, restrict…) ou colonne sans clé (project_id, project_ids, show_id, structure_id, admin_structure_id,
--      default_partner_id, spectacle_id…), tableau, texte ou JSON. Exemples arrêtés : modèle de mail de l'artiste d'essai
--      (project_id ou project_ids), facture Pennylane à rattacher ou rattachement, tâche (show_id, project_id, project_ids,
--      structure_id), journal ou membre d'artiste, événement ou contact de la structure, notification, spectacle, suivi, pièce
--      jointe, ligne de Factures, versement, autre date ou dépense, artiste RÉEL dont la structure administrative ou le
--      coproducteur par défaut serait un objet d'essai. Seules exceptions : les lignes du périmètre ci-dessus et les TRACES
--      CONSERVÉES (classement ci-dessus).
--   Puis trace, retrait du périmètre, contrôle final (plus aucune ligne hors traces ne contient un identifiant d'essai) et bilan du
--   nombre RÉEL de lignes retirées (0 au second lancement ou sur une base sans essai : « rien à retirer »).
-- Hors du schéma public (stockage de fichiers, tâches planifiées) : rien n'est créé par l'essai ; rien n'y est vérifié ni touché.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  proj constant uuid := 'e55a1000-0000-4000-a000-000000000001';
  part constant uuid := 'e55a1000-0000-4000-a000-000000000002';
  stru constant uuid := 'e55a1000-0000-4000-a000-000000000003';
  ids constant uuid[] := array['e55a1000-0000-4000-a000-000000000011', 'e55a1000-0000-4000-a000-000000000012', 'e55a1000-0000-4000-a000-000000000013']::uuid[];
  lines constant uuid[] := array['e55a1000-0000-4000-a000-000000000021', 'e55a1000-0000-4000-a000-000000000022', 'e55a1000-0000-4000-a000-000000000023',
                                 'e55a1000-0000-4000-a000-000000000024', 'e55a1000-0000-4000-a000-000000000025', 'e55a1000-0000-4000-a000-000000000026']::uuid[];
  pattern constant text := '%e55a1000-0000-4000-a000-0000000000%';
  -- traces conservées : jamais modifiées, jamais bloquantes (classement en tête du fichier)
  traces constant text[] := array['finance_log', 'show_deletions', 'client_errors', '_probe', '_koza_job', '_lartbotrice_job'];
  notif_ok constant boolean := coalesce(current_setting('essai.notifications', true), '') = 'conserver';
  t text; allowed text; n bigint; msg text := ''; notif_msg text := ''; nb jsonb := '{}'::jsonb;
begin
  -- 1. identité
  if exists (select 1 from projects where id = proj and name <> 'ESSAI promo')
     or exists (select 1 from partners where id = part and name <> 'ESSAI promo — coproducteur fictif')
     or exists (select 1 from structures where id = stru and name <> 'ESSAI promo — salle fictive')
     or exists (select 1 from shows where id = any(ids) and (project_id is distinct from proj or venue not like 'ESSAI promo — %'))
     or exists (select 1 from budget_lines where id = any(lines) and (not (show_id = any(ids)) or show_id is null or project_id is distinct from proj)) then
    raise exception 'Nettoyage refusé : un identifiant d''essai porte d''autres données que l''essai. Rien n''est supprimé.';
  end if;

  -- 2. inventaire complet, à l'exécution : toute ligne de toute table du schéma public qui contient un identifiant d'essai
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'p') order by 1 loop
    allowed := case t
      when 'projects' then format('x.id = %L::uuid', proj)
      when 'partners' then format('x.id = %L::uuid', part)
      when 'structures' then format('x.id = %L::uuid', stru)
      when 'shows' then format('x.id = any(%L::uuid[])', ids)
      when 'budget_lines' then format('x.id = any(%L::uuid[])', lines)
      when 'result_closures' then format('x.show_id = any(%L::uuid[])', ids)
      when 'notifications' then case when notif_ok then format('(x.show_id = any(%L::uuid[]) or (x.show_id is null and x.project_id = %L::uuid))', ids, proj) else 'false' end
      else case when t = any(traces) then 'true' else 'false' end end;
    execute format('select count(*) from public.%I x where to_jsonb(x)::text like %L and not (%s)', t, pattern, allowed) into n;
    if n > 0 then
      msg := msg || format(' %s : %s ligne(s) ;', t, n);
      if t = 'notifications' then
        execute format('select count(*) from public.notifications x where to_jsonb(x)::text like %L and (x.show_id = any(%L::uuid[]) or (x.show_id is null and x.project_id = %L::uuid))', pattern, ids, proj) into n;
        if n > 0 then notif_msg := format(' Dont %s notification(s) d''une date ou de l''artiste d''essai (retirées comprises) : pour les copier dans la trace puis les retirer avec le dossier, relance avec la ligne « set essai.notifications = ''conserver''; » avant le script.', n); end if;
      end if;
    end if;
  end loop;
  if msg <> '' then
    raise exception 'Nettoyage arrêté, rien n''est supprimé ni modifié — des données hors de l''essai sont liées aux objets d''essai :% (à retirer d''abord dans l''application, ou à signaler).%', msg, notif_msg;
  end if;

  -- 3. TRACE CONSERVÉE avant tout retrait (décision d'Anthony du 08/11/2026 : l'historique des dossiers fictifs peut quitter les
  --    tables actives après conservation dans le journal de suppression) : une ligne par date dans show_deletions, même forme que
  --    delete_show (date, lignes de facturation et de budget, historique de clôture / réouverture result_closures), plus l'artiste,
  --    le coproducteur et la structure d'essai. Aucune ligne de journal existante n'est modifiée ni supprimée.
  insert into show_deletions (actor, show_id, label, snapshot)
  select 'nettoyage essai v1.60.4 (données fictives)', s.id,
         concat_ws(' · ', coalesce(to_char(s.date, 'DD/MM/YYYY'), 'sans date'), s.venue, 'ESSAI promo'),
         jsonb_build_object(
           'show', to_jsonb(s),
           'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from show_payments p where p.show_id = s.id), '[]'::jsonb),
           'budget_lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from budget_lines l where l.show_id = s.id), '[]'::jsonb),
           'result_closures', coalesce((select jsonb_agg(to_jsonb(c) order by c.at, c.id) from result_closures c where c.show_id = s.id), '[]'::jsonb),
           'tasks_detached', '[]'::jsonb,
           'notifications', case when notif_ok then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id) from notifications x
                              where x.show_id = s.id or (x.show_id is null and x.project_id = proj
                                and s.id = (select min(y.id::text)::uuid from shows y where y.id = any(ids)))), '[]'::jsonb) else '[]'::jsonb end,
           'essai', jsonb_build_object('motif', 'Cas d''essai fictif « ESSAI promo » (v1.60.4) retiré par supabase/repetitions/2026-11-08_v1.60.4_essai_promo_nettoyage.sql',
             'project', (select to_jsonb(x) from projects x where x.id = proj), 'partner', (select to_jsonb(x) from partners x where x.id = part),
             'structure', (select to_jsonb(x) from structures x where x.id = stru)))
  from shows s where s.id = any(ids);

  -- 4. retrait des tables actives, seulement le périmètre (aucune cascade possible : l'inventaire n'a trouvé aucune ligne dépendante).
  --    Historique de clôture de ces 3 dates fictives : copié ci-dessus, puis retiré (clé RESTRICT vers la date) — comme delete_show ;
  --    une clôture faite pendant l'essai est d'abord levée par le seul chemin autorisé (drapeau des fonctions de clôture).
  -- nombre RÉEL de lignes traitées (bilan final ; 0 partout au second lancement ou sur une base sans essai)
  get diagnostics n = row_count; nb := nb || jsonb_build_object('copies dans show_deletions', n);
  perform set_config('matrice.result_rpc', 'on', true);
  update shows set result_closed_at = null, result_closed_by = null, result_closed = null where id = any(ids) and result_closed_at is not null;
  delete from result_closures where show_id = any(ids);           get diagnostics n = row_count; nb := nb || jsonb_build_object('historique de clôture', n);
  if notif_ok then
    -- notifications de l'artiste d'essai sans date d'essai : copiées ci-dessus seulement si une date d'essai existe encore ; sinon gardées
    delete from notifications where show_id = any(ids) or (show_id is null and project_id = proj and exists (select 1 from shows where id = any(ids))); get diagnostics n = row_count; nb := nb || jsonb_build_object('notifications', n);
  end if;
  delete from budget_lines where id = any(lines);                 get diagnostics n = row_count; nb := nb || jsonb_build_object('dépenses', n);
  delete from shows where id = any(ids);                          get diagnostics n = row_count; nb := nb || jsonb_build_object('dates', n);
  delete from structures where id = stru;                         get diagnostics n = row_count; nb := nb || jsonb_build_object('structure', n);
  delete from partners where id = part;                           get diagnostics n = row_count; nb := nb || jsonb_build_object('coproducteur', n);
  delete from projects where id = proj;                           get diagnostics n = row_count; nb := nb || jsonb_build_object('artiste', n);

  -- 5. contrôle final : plus aucune ligne hors traces conservées ne contient un identifiant d'essai
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relname = any(traces)) order by 1 loop
    execute format('select count(*) from public.%I x where to_jsonb(x)::text like %L', t, pattern) into n;
    if n > 0 then raise exception 'Nettoyage incomplet (% : % ligne(s)) : tout est annulé', t, n; end if;
  end loop;
  if (select sum(v::int) from jsonb_each_text(nb) e(k, v)) = 0 then
    raise notice 'ESSAI promo : rien à retirer (aucune donnée d''essai dans cette base) ; aucune ligne modifiée.';
  else
    raise notice 'ESSAI promo retiré des tables actives — lignes traitées : % ; traces conservées intactes (%).',
      (select string_agg(k || ' ' || v, ', ') from jsonb_each_text(nb) e(k, v)), array_to_string(traces, ', ');
  end if;
end $$;

commit;
