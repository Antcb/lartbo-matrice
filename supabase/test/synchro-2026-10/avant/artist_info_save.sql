CREATE OR REPLACE FUNCTION public.artist_info_save(p_project uuid, p_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old jsonb; v_diff jsonb;
begin
  if not public.is_team() then raise exception 'Réservé à l''équipe'; end if;
  if length(coalesce(p_info::text, '')) > 60000 then raise exception 'Fiche trop longue'; end if;
  select coalesce(artist_info, '{}') into v_old from projects where id = p_project for update;
  update projects set artist_info = coalesce(p_info, '{}') where id = p_project;
  v_diff := coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_info, '{}')) e
      where e.key like 'adm\_%' and e.value is distinct from v_old->e.key), '{}')
    || jsonb_build_object('members', (select coalesce(jsonb_agg(m), '[]') from jsonb_array_elements(case when jsonb_typeof(p_info->'members') = 'array' then p_info->'members' else '[]' end) m
      where not (case when jsonb_typeof(v_old->'members') = 'array' then v_old->'members' else '[]' end) @> jsonb_build_array(m)));
  perform public.artist_sync(p_project, v_diff, true);
  return jsonb_build_object('ok', true);
end $function$
