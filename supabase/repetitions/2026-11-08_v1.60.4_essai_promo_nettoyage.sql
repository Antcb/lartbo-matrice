-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v1.60.4 — NETTOYAGE EXACT du cas d'essai « ESSAI promo » (créé par 2026-11-08_v1.60.4_essai_promo_coproduction.sql).
-- Sur la même base que le script de création (jamais la production). Exécuté et vérifié par l'agent sur base jetable locale.
-- Une seule transaction : TOUT ou RIEN. Corrigé après relecture indépendante (B1, 08/11/2026).
--
-- PÉRIMÈTRE DE L'ESSAI (seuls objets supprimés) — identifiants fixes e55a1000-0000-4000-a000-0000000000xx :
--   artiste …001 « ESSAI promo » · coproducteur …002 « ESSAI promo — coproducteur fictif » · structure …003 « ESSAI promo — salle
--   fictive » · dates …011, …012, …013 (lieu « ESSAI promo — … », artiste …001) · dépenses …021 à …026 (sur ces dates, artiste …001)
--   · historique de clôture result_closures de ces 3 dates (une clôture faite pendant l'essai est d'abord levée).
-- TRACE CONSERVÉE (décision d'Anthony du 08/11/2026) : avant tout retrait, une copie complète de chaque date d'essai (lignes,
--   historique de clôture, artiste / coproducteur / structure d'essai) est écrite dans le journal des suppressions show_deletions ;
--   les journaux finance_log et show_deletions ne sont jamais modifiés ni vidés, et ne bloquent pas le nettoyage (trace, pas
--   dépendance). Toute autre ligne liée est une DÉPENDANCE OPÉRATIONNELLE : elle arrête le nettoyage (vérification 2).
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
--      coproducteur par défaut serait un objet d'essai. Seules exceptions : les lignes du périmètre ci-dessus, et les JOURNAUX
--      finance_log et show_deletions (jamais modifiés : ils gardent la trace de l'essai, identifiable par ses identifiants fixes).
--   Puis suppression du périmètre, et contrôle final : plus aucune ligne hors journaux ne contient un identifiant d'essai.
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
  t text; allowed text; n bigint; msg text := '';
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
      when 'finance_log' then 'true'      -- journal : conservé tel quel
      when 'show_deletions' then 'true'   -- journal : conservé tel quel
      else 'false' end;
    execute format('select count(*) from public.%I x where to_jsonb(x)::text like %L and not (%s)', t, pattern, allowed) into n;
    if n > 0 then msg := msg || format(' %s : %s ligne(s) ;', t, n); end if;
  end loop;
  if msg <> '' then
    raise exception 'Nettoyage arrêté, rien n''est supprimé ni modifié — des données hors de l''essai sont liées aux objets d''essai :% (à retirer d''abord dans l''application, ou à signaler)', msg;
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
           'essai', jsonb_build_object('motif', 'Cas d''essai fictif « ESSAI promo » (v1.60.4) retiré par supabase/repetitions/2026-11-08_v1.60.4_essai_promo_nettoyage.sql',
             'project', (select to_jsonb(x) from projects x where x.id = proj), 'partner', (select to_jsonb(x) from partners x where x.id = part),
             'structure', (select to_jsonb(x) from structures x where x.id = stru)))
  from shows s where s.id = any(ids);

  -- 4. retrait des tables actives, seulement le périmètre (aucune cascade possible : l'inventaire n'a trouvé aucune ligne dépendante).
  --    Historique de clôture de ces 3 dates fictives : copié ci-dessus, puis retiré (clé RESTRICT vers la date) — comme delete_show ;
  --    une clôture faite pendant l'essai est d'abord levée par le seul chemin autorisé (drapeau des fonctions de clôture).
  perform set_config('matrice.result_rpc', 'on', true);
  update shows set result_closed_at = null, result_closed_by = null, result_closed = null where id = any(ids) and result_closed_at is not null;
  delete from result_closures where show_id = any(ids);
  delete from budget_lines where id = any(lines);
  delete from shows where id = any(ids);
  delete from structures where id = stru;
  delete from partners where id = part;
  delete from projects where id = proj;

  -- 5. contrôle final : plus aucune ligne hors journaux ne contient un identifiant d'essai
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not in ('finance_log', 'show_deletions') order by 1 loop
    execute format('select count(*) from public.%I x where to_jsonb(x)::text like %L', t, pattern) into n;
    if n > 0 then raise exception 'Nettoyage incomplet (% : % ligne(s)) : tout est annulé', t, n; end if;
  end loop;
  raise notice 'ESSAI promo retiré des tables actives ; copie dans show_deletions (3 lignes) ; journaux conservés.';
end $$;

commit;
