-- =====================================================================================================
-- Brevo : ajout ET retrait des rattachements (décision d'Anthony du 08/11/2026)
-- Avant : seul l'AJOUT d'un rattachement (insert dans contact_structures) relançait brevo-sync ; un retrait laissait dans Brevo
-- l'ancienne structure du contact. Désormais l'ajout, le retrait (y compris par suppression d'une structure, en cascade) et le
-- changement de contact ou de structure d'un rattachement relancent brevo-sync pour le ou les contacts concernés, s'ils existent
-- encore et ont un mail. brevo-sync (même règle côté fonction serveur, regles.ts) met alors à jour le champ « structure » des
-- seuls mails créés par la Matrice ; un retrait ne supprime jamais un contact Brevo, ne le retire d'aucune liste et ne touche ni à
-- son désabonnement ni à ses autres champs. La fonction propre à chaque structure (role) n'est pas transmise (représentation non
-- décidée) : modifier une fonction ne relance donc rien.
-- Partie « contacts » de brevo_contact_trg : identique à la v1.32 (réécrite entière, sans remplacement de texte).
-- Aucune donnée n'est modifiée. Rejouable (create or replace). Sans clé Brevo ou sans adresse des fonctions serveur, brevo_queue
-- ne fait rien.
-- Retour arrière (remet l'état v1.32 / v1.16) :
--   create or replace trigger brevo_contact_structures after insert on public.contact_structures
--     for each row execute function public.brevo_contact_trg();
--   puis brevo_contact_trg de supabase/migrations/2026-10-19_v1.32_brevo_mail2.sql (lignes 7 à 20) ; brevo_link_queue peut rester
--   (inutilisée) ou être retirée par « drop function public.brevo_link_queue(uuid); » (objet créé par cette migration seulement).
-- =====================================================================================================

-- Relance brevo-sync pour un contact s'il existe encore et a un mail (un contact supprimé emporte ses rattachements en cascade :
-- rien à envoyer pour lui)
create or replace function public.brevo_link_queue(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_contact is not null and exists (select 1 from contacts k where k.id = p_contact and (k.email is not null or k.email_2 is not null)) then
    perform brevo_queue(p_contact);
  end if;
end $$;
revoke all on function public.brevo_link_queue(uuid) from public, anon, authenticated;

create or replace function public.brevo_contact_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'contacts' then
    if (new.email is not null or new.email_2 is not null) and (tg_op = 'INSERT'
       or new.email is distinct from old.email or new.email_2 is distinct from old.email_2
       or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name) then
      perform brevo_queue(new.id);
    end if;
    return new;
  end if;
  -- contact_structures : ajout, retrait, ou rattachement déplacé (les deux contacts concernés)
  if tg_op in ('INSERT', 'UPDATE') then perform brevo_link_queue(new.contact_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.contact_id is distinct from new.contact_id) then
    perform brevo_link_queue(old.contact_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.brevo_contact_trg() from public, anon, authenticated;

create or replace trigger brevo_contact_structures after insert or delete or update of contact_id, structure_id on public.contact_structures
  for each row execute function public.brevo_contact_trg();
