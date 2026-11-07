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

-- Fiche de renseignements publique (fiche_get) et variables des mails (mail_vars) — décision d'Anthony du 07/11/2026, même règle que
-- l'application (js/fiche-fields.js venueAddressOf / ficheDefaults) : adresse et code postal du LIEU DE LA DATE ; sinon ceux de la
-- structure SEULEMENT si venue_is_structure ; sinon vide (à compléter). fiche_get garde l'objet « structure » (coordonnées de
-- l'organisateur, pour l'administratif) et renvoie en plus address / postal_code / venue_is_structure de la date.
-- Remplacement EXACT dans le texte en production (empreinte vérifiée, chaque texte trouvé une seule fois) ; version inattendue = arrêt,
-- rien n'est appliqué. Rejouable : une fonction déjà à jour (texte contenant « venue_is_structure ») est laissée telle quelle.
-- Une fonction passée par la première version de cette migration (commit 8198aac, repli sur la structure sans condition) est mise
-- à niveau par remplacement exact de ses textes de 8198aac (chaque texte trouvé une seule fois, sinon arrêt).
do $m$
declare d text; n text; st text; r record; k int;
begin
  create temporary table if not exists _v1602(ord int generated always as identity, sig text, expected text, state text, old text, new text) on commit drop;
  truncate _v1602;
  insert into _v1602 (sig, expected, state, old, new) values
    -- version en production (v1.60.1)
    ('public.fiche_get(text)', '5ad948247fd5a70ebb4877ec4302df11', 'prod',
     $x$'city', s.city, 'cp', coalesce(st.postal_code, s.department),$x$,
     $x$'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'venue_is_structure', coalesce(s.venue_is_structure, false),
    'cp', coalesce(nullif(btrim(s.postal_code), ''), case when s.venue_is_structure then nullif(btrim(st.postal_code), '') end, s.department),$x$),
    ('public.mail_vars(uuid,uuid)', 'ede0e727e33142e4a2d28c0ea5f7ef2b', 'prod',
     $x$'code_postal', coalesce(st.postal_code, ''),$x$,
     $x$'code_postal', coalesce(nullif(btrim(s.postal_code), ''), case when s.venue_is_structure then nullif(btrim(st.postal_code), '') end, ''),$x$),
    ('public.mail_vars(uuid,uuid)', null, 'prod',
     $x$'adresse', coalesce(nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),$x$,
     $x$'adresse', coalesce(nullif(btrim(s.address), ''), case when s.venue_is_structure then nullif(btrim(st.address), '') end, ''),$x$),
    -- version de la première migration v1.60.2 (8198aac)
    ('public.fiche_get(text)', null, '8198aac',
     $x$'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'cp', coalesce(st.postal_code, s.department),$x$,
     $x$'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'venue_is_structure', coalesce(s.venue_is_structure, false),
    'cp', coalesce(nullif(btrim(s.postal_code), ''), case when s.venue_is_structure then nullif(btrim(st.postal_code), '') end, s.department),$x$),
    ('public.mail_vars(uuid,uuid)', null, '8198aac',
     $x$'code_postal', coalesce(nullif(btrim(s.postal_code), ''), st.postal_code, ''),$x$,
     $x$'code_postal', coalesce(nullif(btrim(s.postal_code), ''), case when s.venue_is_structure then nullif(btrim(st.postal_code), '') end, ''),$x$),
    ('public.mail_vars(uuid,uuid)', null, '8198aac',
     $x$'adresse', coalesce(nullif(btrim(s.address), ''), nullif(st.address, ''), concat_ws(' ', st.postal_code, st.city), s.city, ''),$x$,
     $x$'adresse', coalesce(nullif(btrim(s.address), ''), case when s.venue_is_structure then nullif(btrim(st.address), '') end, ''),$x$);
  for d in select distinct sig from _v1602 loop
    n := pg_get_functiondef(d::regprocedure);
    if position('venue_is_structure' in n) > 0 then continue; end if;   -- déjà à jour (rejeu)
    if md5(n) = (select expected from _v1602 where sig = d and expected is not null) then st := 'prod';
    elsif position('s.postal_code' in n) > 0 then st := '8198aac';
    else
      raise exception 'v1.60.2 : % n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', d, md5(n);
    end if;
    for r in select old, new from _v1602 where sig = d and state = st order by ord loop
      k := (length(n) - length(replace(n, r.old, ''))) / length(r.old);
      if k <> 1 then
        raise exception 'v1.60.2 : % (version %) : texte à remplacer trouvé % fois (attendu : 1) : migration arrêtée, rien n''est appliqué', d, st, k;
      end if;
      n := replace(n, r.old, r.new);
    end loop;
    execute n;
  end loop;
end $m$;
