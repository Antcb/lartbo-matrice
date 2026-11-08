-- =====================================================================================================
-- Brevo : rattachements, fonctions par structure, contacts « hors prospection » (décisions d'Anthony du 08/11/2026)
--
-- 1. Ajout, retrait, déplacement d'un rattachement ET changement de la fonction propre à une structure (role) relancent brevo-sync,
--    UNE SEULE FOIS PAR CONTACT ET PAR REQUÊTE (déclencheurs par requête avec tables de transition : retirer 50 rattachements d'un
--    contact en une requête = 1 appel ; supprimer une structure de 40 contacts = 1 appel par contact), pour les seuls contacts qui
--    existent encore et ont un mail. Une modification qui ne change ni le contact, ni la structure, ni la fonction d'un rattachement
--    (valeur réécrite à l'identique) ne relance rien. brevo-sync (regles.ts, syncContact) met alors à jour les champs « structure »
--    et « FONCTIONS » des seuls mails créés par la Matrice ; jamais de suppression, de désabonnement, de retrait ni d'ajout de liste.
--
-- 2. Marqueur contacts.hors_prospection_at (option B d'Anthony) : un contact lié UNIQUEMENT à des structures inactives au moment
--    où il perd un rattachement (retrait, ou suppression d'une structure inactive) est marqué. Devenu « sans structure », il reste
--    alors hors prospection et hors Brevo (ni ajout, ni liste), contrairement à un contact créé sans structure. Le marqueur est
--    effacé quand le contact est rattaché à une structure ACTIVE, ou quand l'une de ses structures est réactivée. Même règle :
--    supabase/functions/brevo-sync/regles.ts (horsProspection) et js/selectors.js (horsProspection). Aucun désabonnement n'est
--    touché. Les contacts déjà passés par ce cas AVANT cette migration ne sont pas marqués (aucun historique des rattachements :
--    aucune valeur inventée).
--
-- brevo_contact_trg (déclencheur brevo_contacts sur contacts) n'est pas modifiée : sa branche « contact_structures » n'est plus
-- appelée (le déclencheur brevo_contact_structures est remplacé ci-dessous par la version « par requête »).
-- Aucune donnée existante n'est modifiée (colonne ajoutée vide). Rejouable. Sans clé Brevo ou sans adresse des fonctions serveur,
-- brevo_queue ne fait rien.
-- Ordre de livraison : cette migration AVANT le redéploiement de brevo-sync (qui lit hors_prospection_at ; sans la colonne, la
-- fonction se replie sur la règle v1.60.2 seule).
-- Retour arrière (remet l'état v1.16 / v1.32 / v1.60.2) :
--   create or replace trigger brevo_contact_structures after insert on public.contact_structures
--     for each row execute function public.brevo_contact_trg();
--   drop trigger brevo_contact_structures_retrait on public.contact_structures;
--   drop trigger brevo_contact_structures_modif on public.contact_structures;
--   drop trigger brevo_structure_deleted on public.structures;
--   drop function public.brevo_links_trg(); drop function public.brevo_link_queue(uuid); drop function public.brevo_structure_del_trg();
--   brevo_structure_trg : version de supabase/migrations/2026-11-07_v1.60.2_brevo_reactivation.sql ;
--   la colonne contacts.hors_prospection_at peut rester (inutilisée) ; la retirer = suppression de colonne (accord d'Anthony).
-- =====================================================================================================

alter table public.contacts add column if not exists hors_prospection_at timestamptz;
comment on column public.contacts.hors_prospection_at is
  'Hors prospection et hors Brevo depuis (option B, 08/11/2026) : contact lié uniquement à des structures inactives quand il a perdu un rattachement. Effacé par un rattachement à une structure active ou une réactivation. Posé et effacé par les déclencheurs Brevo seulement.';

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

-- Une fois par requête : chaque contact dont un rattachement (contact, structure, fonction) est apparu, a disparu ou a changé,
-- une seule fois. Avant la relance : marqueur « hors prospection » posé (perte d'un rattachement alors que toutes les structures
-- du contact, retirées comprises, sont inactives) ou effacé (rattachement à une structure active).
create or replace function public.brevo_links_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid; perdus uuid[];
begin
  -- contacts qui ont perdu au moins un rattachement (couple contact, structure disparu)
  if tg_op = 'DELETE' then
    select array_agg(distinct o.contact_id) into perdus from brevo_anc o;
  elsif tg_op = 'UPDATE' then
    select array_agg(distinct x.contact_id) into perdus from
      (select o.contact_id, o.structure_id from brevo_anc o except select n.contact_id, n.structure_id from brevo_nouv n) x;
  end if;
  if perdus is not null then
    -- marqués s'ils ne sont liés (structures restantes et retirées encore présentes) qu'à des structures inactives ; une structure
    -- supprimée est traitée avant la cascade par brevo_structure_del_trg
    update contacts k set hors_prospection_at = now()
     where k.hors_prospection_at is null and k.id = any(perdus)
       and exists (select 1 from brevo_anc o join structures s on s.id = o.structure_id where o.contact_id = k.id and s.inactive_at is not null)
       and not exists (select 1 from brevo_anc o join structures s on s.id = o.structure_id where o.contact_id = k.id and s.inactive_at is null)
       and not exists (select 1 from contact_structures l join structures s on s.id = l.structure_id where l.contact_id = k.id and s.inactive_at is null);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update contacts k set hors_prospection_at = null
     where k.hors_prospection_at is not null
       and k.id in (select n.contact_id from brevo_nouv n join structures s on s.id = n.structure_id where s.inactive_at is null);
  end if;
  if tg_op = 'INSERT' then
    for c in select distinct n.contact_id from brevo_nouv n loop perform brevo_link_queue(c); end loop;
  elsif tg_op = 'DELETE' then
    for c in select distinct o.contact_id from brevo_anc o loop perform brevo_link_queue(c); end loop;
  else
    for c in select distinct x.contact_id from (
        (select n.contact_id, n.structure_id, n.role from brevo_nouv n except select o.contact_id, o.structure_id, o.role from brevo_anc o)
        union
        (select o.contact_id, o.structure_id, o.role from brevo_anc o except select n.contact_id, n.structure_id, n.role from brevo_nouv n)
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

-- Suppression d'une structure INACTIVE : ses contacts liés uniquement à des structures inactives sont marqués AVANT que la
-- suppression en cascade n'efface leurs rattachements (ensuite, la structure n'est plus lisible). La relance brevo-sync vient du
-- déclencheur brevo_contact_structures_retrait (cascade).
create or replace function public.brevo_structure_del_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.inactive_at is not null then
    update contacts k set hors_prospection_at = now()
     where k.hors_prospection_at is null
       and k.id in (select l.contact_id from contact_structures l where l.structure_id = old.id)
       and not exists (select 1 from contact_structures l join structures s on s.id = l.structure_id where l.contact_id = k.id and s.inactive_at is null);
  end if;
  return old;
end $$;
revoke all on function public.brevo_structure_del_trg() from public, anon, authenticated;
create or replace trigger brevo_structure_deleted before delete on public.structures
  for each row execute function public.brevo_structure_del_trg();

-- Réactivation (v1.60.2, réécrite entière) : ses contacts sont renvoyés à brevo-sync, comme avant, et leur marqueur
-- « hors prospection » est effacé (réactivation explicite).
create or replace function public.brevo_structure_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  -- seulement le passage inactive → active (une désactivation n'ajoute ni ne retire rien dans Brevo)
  if old.inactive_at is not null and new.inactive_at is null then
    update contacts k set hors_prospection_at = null
     where k.hors_prospection_at is not null and k.id in (select l.contact_id from contact_structures l where l.structure_id = new.id);
    for c in select l.contact_id from contact_structures l join contacts k on k.id = l.contact_id
             where l.structure_id = new.id and (k.email is not null or k.email_2 is not null) loop
      perform brevo_queue(c);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.brevo_structure_trg() from public, anon, authenticated;
