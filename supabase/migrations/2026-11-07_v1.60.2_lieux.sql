-- v1.60.2 — Lieu réel d'une date et d'un suivi (adresse, code postal, localisation sur la carte)
-- Colonnes AJOUTÉES seulement : aucune donnée existante modifiée, aucune attribution automatique, rien de supprimé. Rejouable.
-- À appliquer AVANT de publier l'interface v1.60.2 (la fenêtre d'une date et le lieu d'un suivi enregistrent ces colonnes).
-- Droits : inchangés (RLS is_team() des tables shows / prospects, sans droits par colonne).

-- Date : adresse et code postal du lieu (le nom du lieu reste shows.venue, la ville shows.city, le code à 2 chiffres shows.department)
alter table public.shows add column if not exists address text;
alter table public.shows add column if not exists postal_code text;
-- Choix explicite « Utiliser l'adresse de la structure comme lieu de représentation » (décision d'Anthony du 07/11/2026) :
-- faux par défaut ; toutes les dates existantes restent à faux (aucune attribution automatique)
alter table public.shows add column if not exists venue_is_structure boolean not null default false;

-- Suivi : lieu du concert quand il n'a pas lieu à la structure suivie (vide = la structure sert de repère, comme avant)
alter table public.prospects add column if not exists venue text;
alter table public.prospects add column if not exists address text;
alter table public.prospects add column if not exists postal_code text;
alter table public.prospects add column if not exists city text;
alter table public.prospects add column if not exists department text;
alter table public.prospects add column if not exists lat double precision;
alter table public.prospects add column if not exists lng double precision;

comment on column public.shows.address is 'Adresse du lieu de la date (v1.60.2) ; vide = non renseignée';
comment on column public.shows.postal_code is 'Code postal du lieu de la date (v1.60.2) ; le département (2 chiffres) reste dans department';
comment on column public.prospects.venue is 'Lieu du concert du suivi, si différent de la structure (v1.60.2)';
comment on column public.shows.venue_is_structure is 'Adresse de la structure confirmée comme lieu de représentation de la date (v1.60.2, décision du 07/11/2026) ; faux = adresse du lieu à compléter si la date n''en a pas';

-- Département du lieu (règle {{cp}}, même règle que deptOf dans js/fiche-fields.js et cpDept_ du script Google) : le département
-- donné (1 chiffre → 0X, sinon en majuscules) ; à défaut tiré d'un code postal à 5 chiffres (971…, 2A / 2B, sinon 2 premiers chiffres)
create or replace function public.lieu_departement(p_department text, p_postal text) returns text
language sql immutable set search_path = public as $f$
  select coalesce(
    nullif(case when btrim(coalesce(p_department, '')) ~ '^\d$' then '0' || btrim(p_department) else upper(btrim(coalesce(p_department, ''))) end, ''),
    case when regexp_replace(coalesce(p_postal, ''), '\s', '', 'g') ~ '^\d{5}$' then
      (select case when c ~ '^9[78]' then left(c, 3) when c ~ '^20' then (case when c::int < 20200 then '2A' else '2B' end) else left(c, 2) end
         from (select regexp_replace(p_postal, '\s', '', 'g') as c) x) end)
$f$;
revoke all on function public.lieu_departement(text, text) from public, anon;
grant execute on function public.lieu_departement(text, text) to authenticated, service_role;

-- Fiche de renseignements publique (fiche_get) et variables des mails (mail_vars) — décisions d'Anthony du 07/11/2026, même règle
-- que l'application (js/fiche-fields.js venueSource / ficheDefaults) : chaque valeur du lieu (adresse, code postal, ville,
-- département) vient de la date ; sinon de la structure SEULEMENT si venue_is_structure ; sinon vide (à compléter). Valeurs déjà
-- enregistrées sur la date : prioritaires, jamais modifiées. fiche_get garde l'objet « structure » (coordonnées de l'organisateur,
-- pour l'administratif) et renvoie en plus address / postal_code / department / venue_is_structure de la date ; son « cp » est le
-- département (plus jamais un code postal à sa place).
-- Remplacement EXACT dans le texte de PRODUCTION (seul état de départ accepté : empreinte vérifiée, chaque texte trouvé une seule
-- fois) ; version inattendue = arrêt, rien n'est appliqué. Rejouable : une fonction contenant déjà le marqueur « v1.60.2 source du
-- lieu » est laissée telle quelle.
do $m$
declare d text; n text; r record; k int;
begin
  create temporary table if not exists _v1602(ord int generated always as identity, sig text, expected text, old text, new text) on commit drop;
  truncate _v1602;
  insert into _v1602 (sig, expected, old, new) values
    ('public.fiche_get(text)', '5ad948247fd5a70ebb4877ec4302df11',
     $x$    'city', s.city, 'cp', coalesce(st.postal_code, s.department),$x$,
     $x$    'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'department', s.department,
    'venue_is_structure', coalesce(s.venue_is_structure, false),   -- v1.60.2 source du lieu (décisions d'Anthony du 07/11/2026)
    'cp', coalesce(public.lieu_departement(s.department, s.postal_code), case when s.venue_is_structure then public.lieu_departement(st.department_code, st.postal_code) end),$x$),
    ('public.mail_vars(uuid,uuid)', 'ede0e727e33142e4a2d28c0ea5f7ef2b',
     $x$    'ville', coalesce(s.city, st.city, ''),
    'cp', coalesce(nullif(case when s.department ~ '^\d$' then '0' || s.department else upper(s.department) end, ''),
                 case when lower(trim(st.city)) = lower(trim(s.city)) and st.postal_code ~ '^\d{5}$' then
                   case when st.postal_code ~ '^9[78]' then left(st.postal_code, 3) when st.postal_code ~ '^20' then (case when st.postal_code::int < 20200 then '2A' else '2B' end) else left(st.postal_code, 2) end end, ''),
    'code_postal', coalesce(st.postal_code, ''),$x$,
     $x$    -- v1.60.2 source du lieu (décisions d'Anthony du 07/11/2026) : valeurs de la date d'abord ; la structure SEULEMENT si elle est
    -- confirmée comme lieu (venue_is_structure) ; sinon vide. {{cp}} = département, {{code_postal}} = code postal complet (jamais l'un pour l'autre)
    'ville', coalesce(nullif(btrim(s.city), ''), case when s.venue_is_structure then nullif(btrim(st.city), '') end, ''),
    'cp', coalesce(public.lieu_departement(s.department, s.postal_code),
                   case when s.venue_is_structure then public.lieu_departement(st.department_code, st.postal_code) end, ''),
    'code_postal', coalesce(nullif(btrim(s.postal_code), ''), case when s.venue_is_structure then nullif(btrim(st.postal_code), '') end, ''),$x$),
    ('public.mail_vars(uuid,uuid)', null,
     $x$    'adresse', coalesce(nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),$x$,
     $x$    'adresse', coalesce(nullif(btrim(s.address), ''), case when s.venue_is_structure then nullif(btrim(st.address), '') end, ''),$x$);
  for d in select distinct sig from _v1602 loop
    n := pg_get_functiondef(d::regprocedure);
    if position('v1.60.2 source du lieu' in n) > 0 then continue; end if;   -- déjà à jour (rejeu)
    if md5(n) is distinct from (select expected from _v1602 where sig = d and expected is not null) then
      raise exception 'v1.60.2 : % n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', d, md5(n);
    end if;
    for r in select old, new from _v1602 where sig = d order by ord loop
      k := (length(n) - length(replace(n, r.old, ''))) / length(r.old);
      if k <> 1 then
        raise exception 'v1.60.2 : % : texte à remplacer trouvé % fois (attendu : 1) : migration arrêtée, rien n''est appliqué', d, k;
      end if;
      n := replace(n, r.old, r.new);
    end loop;
    execute n;
  end loop;
end $m$;
