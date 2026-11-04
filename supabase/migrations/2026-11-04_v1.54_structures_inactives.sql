-- =====================================================================================================
-- v1.54 — Structures inactives (demande d'Anthony du 04/11/2026)
-- Une structure fermée est marquée « inactive » (date) au lieu d'être supprimée : contacts, suivis, dates, documents et
-- historique restent liés et affichés ; elle n'est plus proposée par défaut (liste, prospection), on la retrouve par un filtre.
-- Ajout d'une colonne vide : aucune donnée existante n'est modifiée (toutes les structures restent actives).
-- Retour arrière : la colonne peut rester (vide = active) ; la retirer seulement sur décision d'Anthony.
-- =====================================================================================================
alter table public.structures add column if not exists inactive_at timestamptz;
comment on column public.structures.inactive_at is 'Structure fermée / inactive depuis cette date (vide = active) ; gardée avec tout son historique (v1.54)';
