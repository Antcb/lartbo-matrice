-- =====================================================================================================
-- v1.60 — Structure administrative de l'artiste = référence (décision d'Anthony du 05/11/2026)
--   - fiche artiste (lien public) : artist_get renvoie les coordonnées administratives de la structure liée à l'artiste ; la fiche les
--     reprend sans ressaisie (remarques internes exclues) ;
--   - artist_sync (envoi par l'artiste ET enregistrement par l'équipe) : la structure n'est plus jamais écrasée par la fiche ; seules les
--     informations manquantes sont complétées ; une valeur différente est signalée à l'équipe (notification), jamais appliquée.
--     Avant : l'enregistrement par l'équipe remplaçait les valeurs de la structure par celles de la fiche.
-- Fonctions modifiées par REMPLACEMENT EXACT dans leur texte de production (empreinte vérifiée, chaque texte trouvé une seule fois) :
-- version inattendue = migration arrêtée, rien n'est appliqué. Aucune donnée existante modifiée.
-- Retour arrière : recréer les deux fonctions à partir de leur texte de production (relevé de structure de la sauvegarde).
-- =====================================================================================================
do $m$
declare d text; n text;   -- chaque texte à remplacer doit figurer exactement une fois, sinon arrêt
begin
  create temporary table if not exists _v160(ord int generated always as identity, fn text, expected text, old text, new text) on commit drop;
  insert into _v160 (fn, expected, old, new) values
    ('artist_get', 'c7b58127a7703658238b92470faa2d6a',
     $x$    'submitted_at', p.artist_submitted_at);$x$,
     $x$    'submitted_at', p.artist_submitted_at,
    -- structure administrative de l'artiste = référence (décision du 05/11/2026) : reprise dans la fiche, sans ressaisie (seulement les champs de la fiche)
    'admin', (select coalesce(jsonb_object_agg(e.key, e.value), '{}') from structures st cross join jsonb_each(coalesce(st.admin, '{}')) e
               where st.id = p.admin_structure_id and e.key in ('legal_name', 'legal_form', 'siret', 'ape', 'vat', 'licence', 'address', 'postal_code',
                 'city', 'country', 'vat_subject', 'signatory', 'signatory_role', 'email', 'phone', 'billing_email')));   -- seulement les champs de la fiche$x$),
    ('artist_sync', '29ab064e3fb965d0e13c58ba7a8b8668',
     $x$declare p projects%rowtype; m jsonb; adm jsonb := '{}'; k text; st_id uuid; dup_id uuid; mem_id uuid; bd date;$x$,
     $x$declare p projects%rowtype; m jsonb; adm jsonb := '{}'; k text; st_id uuid; dup_id uuid; mem_id uuid; bd date; diffs jsonb;$x$),
    ('artist_sync', null,
     $x$    elsif p_team then
      update structures set admin = coalesce(admin, '{}') || adm,
        address = coalesce(adm->>'address', address), postal_code = coalesce(adm->>'postal_code', postal_code),
        city = coalesce(adm->>'city', city), country = coalesce(adm->>'country', country), updated_at = now()
        where id = st_id;
    else
$x$,
     $x$    else   -- équipe comme artiste : on complète seulement ce qui manque ; la structure administrative fait référence (05/11/2026)
$x$),
    ('artist_sync', null,
     $x$  for m in select * from jsonb_array_elements(case when jsonb_typeof(p_info->'members') = 'array' then p_info->'members' else '[]' end) loop$x$,
     $x$  -- structure administrative = référence (décision du 05/11/2026) : une valeur de la fiche différente de celle de la structure n'est
  -- jamais appliquée ; elle est signalée à l'équipe (SIRET, TVA, APE comparés sans espaces ni ponctuation)
  if p.admin_structure_id is not null and adm <> '{}' then
    select jsonb_agg(e.key || ' : fiche « ' || (e.value #>> '{}') || ' », structure « ' || (st.admin->>e.key) || ' »' order by e.key) into diffs
      from jsonb_each(adm) e cross join structures st
     where st.id = p.admin_structure_id and coalesce(st.admin->>e.key, '') <> ''
       and case when e.key in ('siret', 'vat', 'ape') then regexp_replace(upper(st.admin->>e.key), '[^0-9A-Z]', '', 'g')
                else lower(regexp_replace(btrim(st.admin->>e.key), '\s+', ' ', 'g')) end
        <> case when e.key in ('siret', 'vat', 'ape') then regexp_replace(upper(e.value #>> '{}'), '[^0-9A-Z]', '', 'g')
                else lower(regexp_replace(btrim(e.value #>> '{}'), '\s+', ' ', 'g')) end;
    if diffs is not null then
      insert into notifications (kind, title, body, dedupe_key)
        values ('artiste', 'Fiche artiste différente de la structure administrative — ' || trim(regexp_replace(p.name, '\s*•.*$', '')),
          'Non appliqué, la structure administrative fait référence : ' || (select string_agg(x, ' ; ') from jsonb_array_elements_text(diffs) x)
            || '. À vérifier dans l''onglet Administratif de l''artiste.',
          'artiste-diff:' || p.id || ':' || md5(diffs::text))
        on conflict (dedupe_key) do nothing;
    end if;
  end if;
  for m in select * from jsonb_array_elements(case when jsonb_typeof(p_info->'members') = 'array' then p_info->'members' else '[]' end) loop$x$);
  for d in select distinct fn from _v160 loop
    n := pg_get_functiondef(('public.' || d)::regproc);
    if md5(n) is distinct from (select expected from _v160 where fn = d and expected is not null) then
      raise exception 'v1.60 : % n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', d, md5(n);
    end if;
    declare r record; begin
      for r in select old, new from _v160 where fn = d order by ord loop
        if (length(n) - length(replace(n, r.old, ''))) / length(r.old) <> 1 then
          raise exception 'v1.60 : % : texte à remplacer trouvé % fois (attendu : 1) : migration arrêtée', d, (length(n) - length(replace(n, r.old, ''))) / length(r.old);
        end if;
        n := replace(n, r.old, r.new);
      end loop;
    end;
    execute n;
  end loop;
end $m$;
