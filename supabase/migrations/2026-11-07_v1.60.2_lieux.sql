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
