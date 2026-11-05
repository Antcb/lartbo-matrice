-- =====================================================================================================
-- v1.59 — Acompte par défaut propre à un artiste (décision d'Anthony du 04/11/2026 : priorité date > artiste > Réglages)
--   - projects.default_acompte_pct : vide = le réglage (Réglages › Acompte), comme avant ; 0 = artiste sans acompte par défaut ;
--   - public.default_acompte_for(projet) : artiste, sinon réglage, sinon 50 (réglage vide) — même règle que l'application (§6.4) ;
--   - les 4 fonctions qui posaient le réglage seul (création des lignes à la confirmation, lignes de production, fiche publique,
--     variables des mails) prennent désormais l'acompte de l'artiste. Un acompte déjà posé sur une date (sa ligne) reste prioritaire.
-- Les fonctions sont modifiées PAR REMPLACEMENT EXACT dans leur texte de production (empreinte vérifiée avant, chaque remplacement
-- trouvé une et une seule fois) : aucune autre ligne ne change ; version inattendue = migration arrêtée, rien n'est appliqué.
-- Aucune donnée existante modifiée (colonne vide pour tous les artistes = comportement d'avant).
-- Retour arrière : vider la colonne suffit à retrouver l'ancien comportement ; la colonne et la fonction ne se retirent que sur décision.
-- =====================================================================================================
alter table public.projects add column if not exists default_acompte_pct numeric
  check (default_acompte_pct is null or (default_acompte_pct >= 0 and default_acompte_pct <= 100));
comment on column public.projects.default_acompte_pct is 'Acompte par défaut de l''artiste (% du cachet) ; vide = Réglages ; 0 = sans acompte (v1.59)';

create or replace function public.default_acompte_for(p_project uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce((select default_acompte_pct from public.projects where id = p_project),
                  nullif(btrim(public.setting_text('default_acompte_pct')), '')::numeric, 50)
$$;
revoke all on function public.default_acompte_for(uuid) from public, anon;
grant execute on function public.default_acompte_for(uuid) to authenticated, service_role;

do $m$
declare d text; n text;   -- chaque texte à remplacer doit figurer exactement une fois, sinon arrêt
begin
  create temporary table if not exists _v159(fn text, expected text, old text, new text) on commit drop;
  insert into _v159 values
    ('on_show_confirmed', '7fe3f87a836baa907ae69a2f8f7769e5',
     $x$ac numeric := coalesce(nullif(btrim(setting_text('default_acompte_pct')), '')::numeric, 50);$x$,
     $x$ac numeric;$x$),
    ('on_show_confirmed', null,
     $x$select * into p from projects where id = new.project_id;$x$,
     $x$select * into p from projects where id = new.project_id;
  ac := public.default_acompte_for(new.project_id);   -- date > artiste > Réglages (v1.59)$x$),
    ('ensure_production_payments', 'afeeee47db06ab8dbbb47f1783f9fc6d',
     $x$declare ac numeric := coalesce(nullif(btrim(setting_text('default_acompte_pct')), '')::numeric, 50); s record;$x$,
     $x$declare ac numeric; s record;$x$),
    ('ensure_production_payments', null,
     $x$  if s.contract_type = 'Co-Production' then return; end if;$x$,
     $x$  ac := public.default_acompte_for(s.project_id);   -- date > artiste > Réglages (v1.59)
  if s.contract_type = 'Co-Production' then return; end if;$x$),
    ('fiche_get', 'dbe5694ee5d554839476f6cc54cd045a',
     $x$nullif(setting_text('default_acompte_pct'), '')::numeric, 50)$x$,
     $x$public.default_acompte_for(s.project_id))$x$),
    ('mail_vars', 'f0fab3704cc01e678a132c4cebcf8cbd',
     $x$nullif(setting_text('default_acompte_pct'), '')::numeric, 50)$x$,
     $x$public.default_acompte_for(s.project_id))$x$);
  for d in select distinct fn from _v159 loop
    n := pg_get_functiondef(('public.' || d)::regproc);
    if md5(n) is distinct from (select expected from _v159 where fn = d and expected is not null) then
      raise exception 'v1.59 : % n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', d, md5(n);
    end if;
    declare r record; begin
      for r in select old, new from _v159 where fn = d loop
        if (length(n) - length(replace(n, r.old, ''))) / length(r.old) <> 1 then
          raise exception 'v1.59 : % : texte à remplacer trouvé % fois (attendu : 1) : migration arrêtée', d, (length(n) - length(replace(n, r.old, ''))) / length(r.old);
        end if;
        n := replace(n, r.old, r.new);
      end loop;
    end;
    execute n;
  end loop;
end $m$;
