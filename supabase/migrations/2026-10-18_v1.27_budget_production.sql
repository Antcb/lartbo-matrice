-- v1.27 : budget de production (contrat Production / Co-Production) : billetterie, droits et taxes, partage avec le coproducteur.
-- Les coûts (salle, promoteur) restent des lignes de budget_lines.
alter table public.shows add column if not exists production jsonb;
