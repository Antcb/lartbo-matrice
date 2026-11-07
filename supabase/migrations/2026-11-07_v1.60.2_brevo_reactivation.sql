-- =====================================================================================================
-- v1.60.2 — Structures inactives : contacts hors prospection Brevo, rétablis à la réactivation (demande d'Anthony)
-- La fonction serveur brevo-sync n'ajoute plus à Brevo un contact lié UNIQUEMENT à des structures inactives (rien n'est supprimé
-- ni désabonné dans Brevo ; un mail déjà présent n'est jamais touché). Quand une structure est RÉACTIVÉE, ses contacts sont
-- renvoyés à brevo-sync (même file que les autres déclencheurs : brevo_queue), qui ajoute ceux qui ne sont plus « uniquement
-- inactifs » et pas encore dans Brevo. Sans clé Brevo ou sans adresse des fonctions serveur, brevo_queue ne fait rien.
-- Aucune donnée n'est modifiée. Rejouable (create or replace).
-- Retour arrière : « drop trigger brevo_structure_reactivated on public.structures; drop function public.brevo_structure_trg(); »
-- (objets créés par cette migration seulement).
-- =====================================================================================================

create or replace function public.brevo_structure_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  -- seulement le passage inactive → active (une désactivation n'ajoute ni ne retire rien dans Brevo)
  if old.inactive_at is not null and new.inactive_at is null then
    for c in select l.contact_id from contact_structures l join contacts k on k.id = l.contact_id
             where l.structure_id = new.id and (k.email is not null or k.email_2 is not null) loop
      perform brevo_queue(c);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.brevo_structure_trg() from public, anon, authenticated;

create or replace trigger brevo_structure_reactivated after update of inactive_at on public.structures
  for each row execute function public.brevo_structure_trg();
