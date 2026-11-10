-- Correctif de la v1.60.7 (sauvegardes, démarrage réel) constaté à l'essai réel du 10/11/2026 : appelées par la fonction serveur
-- « sauvegarde-fenetre » (API Supabase), sauvegarde_demarrer et sauvegarde_fermer échouaient sur « UPDATE requires a WHERE clause »
-- (garde de Supabase contre les mises à jour sans condition). La table private.sauvegarde_fenetre n'a qu'une ligne (id = true) :
-- « where id » ajouté, rien d'autre ne change. Rejouable (create or replace), aucune donnée modifiée, aucun droit modifié
-- (create or replace garde les droits existants).
create or replace function private.sauvegarde_demarrer(p_type text, p_run_id text, p_tentative integer, p_origine text,
                                                       p_forcer boolean default false, p_duree interval default interval '45 minutes')
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare e record; v_id bigint; v_jusqu timestamptz; v_jour date := (now() at time zone 'UTC')::date;
begin
  if p_type is null or p_type not in ('complete', 'json') then raise exception 'type de sauvegarde inconnu'; end if;
  if p_origine is null or p_origine not in ('schedule', 'workflow_dispatch') then raise exception 'origine inconnue'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sauvegarde_demarrer:' || p_type));
  v_jusqu := now() + least(greatest(coalesce(p_duree, interval '45 minutes'), interval '5 minutes'), interval '45 minutes');

  select * into e from private.sauvegarde_executions x where x.type = p_type and x.run_id = p_run_id and x.tentative = p_tentative;
  if found then
    if e.statut <> 'en_cours' then
      return jsonb_build_object('etat', 'terminee', 'id', e.id, 'statut', e.statut);
    end if;
    v_id := e.id;   -- même exécution qui rappelle : la fenêtre n'est PAS prolongée au-delà de son échéance d'origine
    v_jusqu := e.fenetre_jusqu_a;
  else
    update private.sauvegarde_executions set statut = 'abandon', fin = now(), detail = 'verrou périmé (plus de 3 h)'
     where type = p_type and statut = 'en_cours' and debut < now() - interval '3 hours';
    select * into e from private.sauvegarde_executions x where x.type = p_type and x.statut = 'en_cours';
    if found then
      return jsonb_build_object('etat', 'occupee', 'id_en_cours', e.id, 'depuis', e.debut);
    end if;
    if not coalesce(p_forcer, false) and exists (select 1 from private.sauvegarde_executions x
         where x.type = p_type and x.statut = 'succes' and x.jour = v_jour) then
      return jsonb_build_object('etat', 'deja_faite', 'jour', v_jour);
    end if;
    if (select count(*) from private.sauvegarde_executions x where x.type = p_type and x.jour = v_jour) >= 6 then
      return jsonb_build_object('etat', 'limite', 'jour', v_jour, 'demarrages', 6);
    end if;
    insert into private.sauvegarde_executions (type, jour, run_id, tentative, origine, fenetre_jusqu_a)
      values (p_type, v_jour, p_run_id, p_tentative, p_origine, case when p_type = 'complete' then v_jusqu end)
      returning id into v_id;
  end if;

  if p_type = 'complete' and v_jusqu > now() then
    update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = v_jusqu, tenue_par = v_id where id;
    alter role sauvegarde login;
  end if;
  return jsonb_build_object('etat', 'demarree', 'id', v_id, 'fenetre_jusqu_a', case when p_type = 'complete' then v_jusqu end);
end $f$;

create or replace function private.sauvegarde_fermer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare e record; r text;
begin
  select * into e from private.sauvegarde_executions where id = p_id;
  if not found then raise exception 'exécution inconnue'; end if;
  if e.type <> 'complete' then return jsonb_build_object('etat', 'sans_fenetre'); end if;
  update private.sauvegarde_executions set fenetre_jusqu_a = least(fenetre_jusqu_a, now()) where id = p_id;
  if not exists (select 1 from private.sauvegarde_fenetre where tenue_par = p_id) then
    return jsonb_build_object('etat', 'non_titulaire');   -- fenêtre déjà refermée, ou tenue par une autre exécution
  end if;
  update private.sauvegarde_fenetre set exceptionnelle_jusqu_a = null, tenue_par = null where id;
  update private.sauvegarde_executions set fermeture_titulaire = now() where id = p_id;
  r := private.sauvegarde_interrompre();
  return jsonb_build_object('etat', 'fermee', 'detail', r);
end $f$;
