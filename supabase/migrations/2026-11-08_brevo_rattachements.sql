-- =====================================================================================================
-- Brevo : ajout ET retrait des rattachements (décision d'Anthony du 08/11/2026)
-- Avant : seul l'AJOUT d'un rattachement (insert dans contact_structures, déclencheur ligne par ligne brevo_contact_structures,
-- v1.16) relançait brevo-sync ; un retrait laissait dans Brevo l'ancienne structure du contact.
-- Désormais l'ajout, le retrait (y compris par suppression d'une structure ou d'un contact, en cascade) et le déplacement d'un
-- rattachement relancent brevo-sync, UNE SEULE FOIS PAR CONTACT ET PAR REQUÊTE (déclencheurs par requête avec tables de
-- transition : retirer 50 rattachements d'un contact en une requête = 1 appel ; supprimer une structure de 40 contacts = 1 appel
-- par contact), pour les seuls contacts qui existent encore et ont un mail. Une modification qui ne change ni le contact ni la
-- structure d'un rattachement (fonction « role », ou structure_id réécrit à l'identique) ne relance rien.
-- Même règle côté fonction serveur : supabase/functions/brevo-sync/regles.ts (syncContact) met alors à jour le champ « structure »
-- des seuls mails créés par la Matrice ; un retrait ne supprime jamais un contact Brevo, ne le retire d'aucune liste et ne touche ni
-- à son désabonnement ni à ses autres champs. La fonction propre à chaque structure (role) n'est pas transmise (représentation non
-- décidée).
-- brevo_contact_trg (déclencheur brevo_contacts sur contacts) n'est pas modifiée : sa branche « contact_structures » n'est plus
-- appelée (le déclencheur brevo_contact_structures est remplacé ci-dessous par la version « par requête »).
-- Aucune donnée n'est modifiée. Rejouable (create or replace). Sans clé Brevo ou sans adresse des fonctions serveur, brevo_queue
-- ne fait rien.
-- Retour arrière (remet l'état v1.16 / v1.32) :
--   create or replace trigger brevo_contact_structures after insert on public.contact_structures
--     for each row execute function public.brevo_contact_trg();
--   drop trigger brevo_contact_structures_retrait on public.contact_structures;
--   drop trigger brevo_contact_structures_modif on public.contact_structures;
--   drop function public.brevo_links_trg(); drop function public.brevo_link_queue(uuid);
--   (objets créés par cette migration seulement)
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

-- Une fois par requête : chaque contact dont un rattachement (contact, structure) est apparu ou a disparu, une seule fois.
-- En modification, on compare les couples avant / après : un couple inchangé (fonction modifiée, structure réécrite à
-- l'identique) ne relance rien ; un rattachement déplacé relance l'ancien et le nouveau contact.
create or replace function public.brevo_links_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if tg_op = 'INSERT' then
    for c in select distinct n.contact_id from brevo_nouv n loop perform brevo_link_queue(c); end loop;
  elsif tg_op = 'DELETE' then
    for c in select distinct o.contact_id from brevo_anc o loop perform brevo_link_queue(c); end loop;
  else
    for c in select distinct x.contact_id from (
        (select n.contact_id, n.structure_id from brevo_nouv n except select o.contact_id, o.structure_id from brevo_anc o)
        union
        (select o.contact_id, o.structure_id from brevo_anc o except select n.contact_id, n.structure_id from brevo_nouv n)
      ) x loop
      perform brevo_link_queue(c);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.brevo_links_trg() from public, anon, authenticated;

-- PostgreSQL : une table de transition impose un seul événement par déclencheur et aucune liste de colonnes → trois déclencheurs
create or replace trigger brevo_contact_structures after insert on public.contact_structures
  referencing new table as brevo_nouv for each statement execute function public.brevo_links_trg();
create or replace trigger brevo_contact_structures_retrait after delete on public.contact_structures
  referencing old table as brevo_anc for each statement execute function public.brevo_links_trg();
create or replace trigger brevo_contact_structures_modif after update on public.contact_structures
  referencing old table as brevo_anc new table as brevo_nouv for each statement execute function public.brevo_links_trg();
