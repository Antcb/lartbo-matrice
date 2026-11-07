-- v1.60.2 — Lieu réel d'une date et d'un suivi (adresse, code postal, localisation sur la carte)
-- Colonnes AJOUTÉES seulement : aucune donnée existante modifiée, aucune attribution automatique, rien de supprimé. Rejouable.
-- À appliquer AVANT de publier l'interface v1.60.2 (la fenêtre d'une date et le lieu d'un suivi enregistrent ces colonnes).
-- Droits : inchangés (RLS is_team() des tables shows / prospects, sans droits par colonne).

-- Date : adresse et code postal du lieu (le nom du lieu reste shows.venue, la ville shows.city, le code à 2 chiffres shows.department)
alter table public.shows add column if not exists address text;
alter table public.shows add column if not exists postal_code text;

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

-- Fiche de renseignements publique (fiche_get) et variables des mails (mail_vars) : adresse et code postal du LIEU DE LA DATE d'abord,
-- sinon ceux de la structure (même règle que l'application, js/fiche-fields.js ficheDefaults — relecture v1.60.2, B2).
-- Remplacement EXACT dans le texte en production (empreinte vérifiée, chaque texte trouvé une seule fois) ; version inattendue = arrêt,
-- rien n'est appliqué. Rejouable : une fonction déjà à jour (texte contenant « s.postal_code ») est laissée telle quelle.
do $m$
declare d text; n text;
begin
  create temporary table if not exists _v1602(ord int generated always as identity, fn text, sig text, expected text, old text, new text) on commit drop;
  insert into _v1602 (fn, sig, expected, old, new) values
    ('fiche_get', 'public.fiche_get(text)', '5ad948247fd5a70ebb4877ec4302df11',
     $x$'city', s.city, 'cp', coalesce(st.postal_code, s.department),$x$,
     $x$'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'cp', coalesce(st.postal_code, s.department),$x$),
    ('mail_vars', 'public.mail_vars(uuid,uuid)', 'ede0e727e33142e4a2d28c0ea5f7ef2b',
     $x$'code_postal', coalesce(st.postal_code, ''),$x$,
     $x$'code_postal', coalesce(nullif(btrim(s.postal_code), ''), st.postal_code, ''),$x$),
    ('mail_vars', 'public.mail_vars(uuid,uuid)', null,
     $x$'adresse', coalesce(nullif(st.address, ''),$x$,
     $x$'adresse', coalesce(nullif(btrim(s.address), ''), nullif(st.address, ''),$x$);
  for d in select distinct sig from _v1602 loop
    n := pg_get_functiondef(d::regprocedure);
    if position('s.postal_code' in n) > 0 then continue; end if;   -- déjà à jour (rejeu)
    if md5(n) is distinct from (select expected from _v1602 where sig = d and expected is not null) then
      raise exception 'v1.60.2 : % n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', d, md5(n);
    end if;
    declare r record; begin
      for r in select old, new from _v1602 where sig = d order by ord loop
        if (length(n) - length(replace(n, r.old, ''))) / length(r.old) <> 1 then
          raise exception 'v1.60.2 : % : texte à remplacer trouvé % fois (attendu : 1)', d, (length(n) - length(replace(n, r.old, ''))) / length(r.old);
        end if;
        n := replace(n, r.old, r.new);
      end loop;
    end;
    execute n;
  end loop;
end $m$;
