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
-- 3. Exclusion MANUELLE (décisions d'Anthony du 09/11/2026) : contacts.prospection_exclue_at, posée et levée seulement par
--    l'équipe, par la fonction set_prospection (« Exclure de la prospection » / « Remettre en prospection », fiche contact, motif
--    obligatoire). Un rattachement actif ou une réactivation n'efface que le marqueur AUTOMATIQUE (hors_prospection_at), jamais
--    l'exclusion manuelle ni un désabonnement Brevo. « Remettre en prospection » lève les deux marqueurs (action explicite), ne touche
--    jamais au désabonnement Brevo et relance brevo-sync. Traçabilité : contacts.prospection_history (même principe que
--    shows.archive_history : liste de {at, action, origine, par, motif}), complétée par la base à chaque pose ou levée, automatique
--    (par « automatique ») ou manuelle (auteur = finance_actor(), l'adresse du compte connecté). Garde contacts_prospection_guard :
--    une écriture directe de l'équipe par l'API (rôles anon / authenticated) sur ces trois colonnes est refusée.
--
-- 4. Mode essai Brevo (réglage brevo_essai_emails, marche supabase/operations/2026-11-09_essai_brevo_contact_test.md) : garde
--    brevo_essai_guard : tant qu'une clé Brevo est enregistrée, l'équipe (API, rôles anon / authenticated) ne peut ni modifier ni
--    effacer ce réglage (on vide d'abord la clé, puis la liste blanche). Sans le réglage (cas normal), aucun effet.
--
-- 5. Mémoire des exclusions par adresse (décision d'Anthony du 09/11/2026 ; relecture du 09/11) : l'exclusion suit l'ADRESSE.
--    Suppression d'un contact exclu (manuellement ou automatiquement), ou adresse retirée d'un contact exclu : l'adresse en
--    minuscules, l'origine, la date, la raison et le dernier motif sont gardés dans public.prospection_memoire (liste d'opposition,
--    sans purge ; RLS sans règle ; aucun droit pour anon / authenticated ; service_role : lecture seule pour la sauvegarde JSON).
--    Les autres contacts existants qui portent cette adresse reçoivent l'exclusion. À la création d'un contact, ou quand une
--    adresse mémorisée est donnée à un contact, le même marqueur revient. Trace « Exclusion reprise d'un contact supprimé le … :
--    « motif » » (ou « … d'une adresse retirée d'un contact exclu le … »). Seule « Remettre en prospection » (set_prospection)
--    efface la mémoire de ses adresses, tracé ; un rattachement actif ou une réactivation n'en efface que la part automatique.
--    Brevo (désabonnements, préférences) : inchangé. Sauvegarde : table dans public, ajoutée à l'export JSON (backup-export).
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
--   drop trigger contacts_prospection_guard on public.contacts;
--   drop function public.brevo_links_trg(); drop function public.brevo_link_queue(uuid); drop function public.brevo_structure_del_trg();
--   drop function public.set_prospection(uuid, boolean, text, uuid[]); drop function public.prospection_partages(uuid);
--   drop function public.contacts_prospection_guard();
--   drop function public.prospection_entree(text, text, text, text);
--   drop trigger brevo_essai_guard on public.settings; drop function public.brevo_essai_guard();
--   drop trigger contacts_prospection_memoire on public.contacts; drop trigger contacts_prospection_oubli on public.contacts;
--   drop function public.prospection_memoire_reprise(); drop function public.prospection_memoire_garde();
--   drop function public.prospection_memoire_lever_auto(uuid); drop function public.prospection_mails(text, text);
--   drop function public.prospection_dernier_motif(jsonb); drop function public.prospection_trace(text, timestamptz, text);
--   la table public.prospection_memoire peut rester ; la supprimer = perdre les exclusions mémorisées (accord d'Anthony).
--   brevo_structure_trg : version de supabase/migrations/2026-11-07_v1.60.2_brevo_reactivation.sql ;
--   les colonnes contacts.hors_prospection_at, prospection_exclue_at, prospection_history peuvent rester (inutilisées) ; les retirer
--   = suppression de colonnes et de l'historique (accord d'Anthony).
-- =====================================================================================================

-- Garde (relecture B4) : une table prospection_memoire d'une version antérieure de ce lot (sans memorise_at) arrête la migration ;
-- aucune mise à niveau automatique. Constat du 09/11 : la table n'existe ni sur le projet de test ni en production.
do $$ begin
  if to_regclass('public.prospection_memoire') is not null and not exists (
       select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospection_memoire' and column_name = 'memorise_at') then
    raise exception 'Migration Brevo arrêtée : la table public.prospection_memoire existe dans une version antérieure (sans memorise_at). Aucune mise à niveau automatique : la reprendre à la main avec Anthony.';
  end if;
end $$;

alter table public.contacts add column if not exists hors_prospection_at timestamptz;
comment on column public.contacts.hors_prospection_at is
  'Exclusion AUTOMATIQUE (structure) de la prospection et de Brevo depuis (option B, 08/11/2026) : contact lié uniquement à des structures inactives quand il a perdu un rattachement. Effacée par un rattachement à une structure active, une réactivation ou « Remettre en prospection ». Jamais écrite directement par l’API (contacts_prospection_guard).';
alter table public.contacts add column if not exists prospection_exclue_at timestamptz;
comment on column public.contacts.prospection_exclue_at is
  'Exclusion MANUELLE de la prospection et de Brevo depuis (décision du 09/11/2026) : posée et levée seulement par set_prospection (équipe, motif). Jamais levée par un rattachement ni une réactivation.';
alter table public.contacts add column if not exists prospection_history jsonb not null default '[]'::jsonb;
comment on column public.contacts.prospection_history is
  'Journal des exclusions / remises en prospection : [{at, action (exclusion | remise), origine (structure | manuelle), par, motif}]. Complété par la base seulement.';

-- Entrée du journal de prospection d'un contact
create or replace function public.prospection_entree(p_action text, p_origine text, p_par text, p_motif text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_array(jsonb_build_object('at', now(), 'action', p_action, 'origine', p_origine, 'par', p_par, 'motif', p_motif))
$$;
revoke all on function public.prospection_entree(text, text, text, text) from public, anon, authenticated;

-- Garde : les trois colonnes de prospection ne s'écrivent jamais directement par l'API de l'équipe (rôles anon / authenticated) ;
-- seuls les déclencheurs Brevo et set_prospection (SECURITY DEFINER : rôle propriétaire) les modifient. Pas SECURITY DEFINER.
create or replace function public.contacts_prospection_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user::text in ('anon', 'authenticated') and (
       (tg_op = 'INSERT' and (new.hors_prospection_at is not null or new.prospection_exclue_at is not null or new.prospection_history <> '[]'::jsonb))
    or (tg_op = 'UPDATE' and (new.hors_prospection_at is distinct from old.hors_prospection_at or new.prospection_exclue_at is distinct from old.prospection_exclue_at
                              or new.prospection_history is distinct from old.prospection_history))) then
    raise exception 'L’exclusion de la prospection se change seulement par « Exclure de la prospection » ou « Remettre en prospection » (fiche du contact), avec un motif.';
  end if;
  return new;
end $$;
create or replace trigger contacts_prospection_guard before insert or update on public.contacts
  for each row execute function public.contacts_prospection_guard();

-- « Exclure de la prospection » (p_exclure = true) / « Remettre en prospection » (false), fiche contact — équipe seulement, motif
-- obligatoire, tracé. Remettre lève l'exclusion manuelle ET l'exclusion automatique (structure), jamais un désabonnement Brevo ;
-- un contact lié uniquement à des structures inactives reste hors prospection (règle v1.60.2, calculée) : refusé avec explication.
-- Adresses d'un contact, en minuscules, sans doublon ni vide
create or replace function public.prospection_mails(p_email text, p_email_2 text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct e), '{}') from (select lower(btrim(x)) e from unnest(array[p_email, p_email_2]) x) t where coalesce(e, '') <> ''
$$;

-- Contacts EXCLUS reliés à un contact par une adresse commune, de proche en proche (l'exclusion suit l'adresse ; décision du
-- 09/11/2026) : la remise en prospection d'une adresse vaut pour tous ces contacts, après confirmation explicite
create or replace function public.prospection_partages(p_contact uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  with recursive comp(id, mails) as (
    select k.id, prospection_mails(k.email, k.email_2) from contacts k where k.id = p_contact
    union
    select k.id, prospection_mails(k.email, k.email_2) from contacts k join comp c on prospection_mails(k.email, k.email_2) && c.mails
     where k.prospection_exclue_at is not null or k.hors_prospection_at is not null
  )
  select coalesce(array_agg(distinct id order by id) filter (where id <> p_contact), '{}') from comp
$$;
revoke all on function public.prospection_partages(uuid) from public, anon, authenticated;

-- « Exclure de la prospection » (p_exclure = true) / « Remettre en prospection » (false), fiche contact — équipe seulement, motif
-- obligatoire, tracé. Remettre lève l'exclusion manuelle ET l'exclusion automatique (structure), jamais un désabonnement Brevo ;
-- un contact lié uniquement à des structures inactives reste hors prospection (règle v1.60.2, calculée) : refusé avec explication.
-- Adresse aussi portée par d'autres contacts exclus (prospection_partages) : la remise est REFUSÉE sauf confirmation explicite, où
-- l'interface renvoie exactement ces contacts (p_avec) ; elle s'applique alors à tous, même motif, une trace chacun, et efface la
-- mémoire de toutes leurs adresses. Liste différente (changée entre-temps) : refus, rien ne change.
create or replace function public.set_prospection(p_contact uuid, p_exclure boolean, p_motif text, p_avec uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k contacts%rowtype; m text := btrim(coalesce(p_motif, '')); par text := finance_actor(); n int := 0;
        autres uuid[]; tous uuid[]; noms text; mails text[];
begin
  if not is_team() then raise exception 'Accès réservé à l’équipe'; end if;
  if m = '' then raise exception 'Indique le motif'; end if;
  if length(m) > 500 then raise exception 'Motif trop long (500 caractères au plus)'; end if;
  select * into k from contacts where id = p_contact for update;
  if not found then raise exception 'Contact introuvable'; end if;
  if p_exclure then
    if k.prospection_exclue_at is not null then raise exception 'Ce contact est déjà exclu de la prospection'; end if;
    update contacts set prospection_exclue_at = now(), prospection_history = prospection_history || prospection_entree('exclusion', 'manuelle', par, m)
     where id = p_contact;
  else
    if k.prospection_exclue_at is null and k.hors_prospection_at is null then
      if exists (select 1 from contact_structures l where l.contact_id = p_contact)
         and not exists (select 1 from contact_structures l join structures s on s.id = l.structure_id where l.contact_id = p_contact and s.inactive_at is null) then
        raise exception 'Ce contact est lié uniquement à des structures inactives : rattache-le à une structure active, ou réactive l’une de ses structures';
      end if;
      raise exception 'Ce contact n’est pas exclu de la prospection';
    end if;
    autres := prospection_partages(p_contact);
    if cardinality(autres) > 0 and (p_avec is null or array(select unnest(p_avec) except select unnest(autres)) <> '{}'
                                    or array(select unnest(autres) except select unnest(p_avec)) <> '{}') then
      select string_agg(coalesce(nullif(display_name, ''), coalesce(email, email_2, 'sans nom')), ', ' order by display_name) into noms from contacts where id = any(autres);
      raise exception 'Adresse aussi portée par % autre% contact% exclu% (%) : confirme la remise en prospection pour tous, ou rien ne change',
        cardinality(autres), case when cardinality(autres) > 1 then 's' else '' end, case when cardinality(autres) > 1 then 's' else '' end,
        case when cardinality(autres) > 1 then 's' else '' end, noms;
    end if;
    tous := array_prepend(p_contact, autres);
    perform 1 from contacts where id = any(tous) for update;
    -- mémoire de toutes leurs adresses (contact supprimé puis recréé) : effacée seulement ici, et tracé
    select coalesce(array_agg(distinct e), '{}') into mails from contacts c, unnest(prospection_mails(c.email, c.email_2)) e where c.id = any(tous);
    delete from prospection_memoire where email = any(mails);
    get diagnostics n = row_count;
    update contacts c set prospection_exclue_at = null, hors_prospection_at = null,
           prospection_history = c.prospection_history || prospection_entree('remise', 'manuelle', par,
             m || case when c.id <> p_contact then ' (adresse partagée, remise depuis la fiche de « ' || coalesce(nullif(k.display_name, ''), k.email, '') || ' »)' else '' end
               || case when n > 0 and c.id = p_contact then ' (mémoire d’exclusion de ' || n || ' adresse' || case when n > 1 then 's' else '' end || ' effacée)' else '' end)
     where c.id = any(tous);
    perform brevo_link_queue(x) from unnest(tous) x;   -- de nouveau ajoutables à Brevo s'ils n'y sont pas ; un désabonné y reste désabonné
  end if;
  select * into k from contacts where id = p_contact;
  return jsonb_build_object('hors_prospection_at', k.hors_prospection_at, 'prospection_exclue_at', k.prospection_exclue_at, 'prospection_history', k.prospection_history,
    'remis', coalesce(to_jsonb(tous), '[]'::jsonb));
end $$;
revoke all on function public.set_prospection(uuid, boolean, text, uuid[]) from public, anon;
grant execute on function public.set_prospection(uuid, boolean, text, uuid[]) to authenticated;

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
    update contacts k set hors_prospection_at = now(),
           prospection_history = k.prospection_history || prospection_entree('exclusion', 'structure', 'automatique', 'Rattachement retiré : plus lié qu’à des structures inactives')
     where k.hors_prospection_at is null and k.id = any(perdus)
       and exists (select 1 from brevo_anc o join structures s on s.id = o.structure_id where o.contact_id = k.id and s.inactive_at is not null)
       and not exists (select 1 from brevo_anc o join structures s on s.id = o.structure_id where o.contact_id = k.id and s.inactive_at is null)
       and not exists (select 1 from contact_structures l join structures s on s.id = l.structure_id where l.contact_id = k.id and s.inactive_at is null);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    -- marqueur AUTOMATIQUE seulement : l'exclusion manuelle (prospection_exclue_at) n'est jamais levée ici ; mémoire des adresses :
    -- part automatique levée aussi (prospection_memoire_lever_auto), part manuelle gardée
    perform prospection_memoire_lever_auto(x.contact_id) from (select distinct n.contact_id from brevo_nouv n join structures s on s.id = n.structure_id where s.inactive_at is null) x;
    update contacts k set hors_prospection_at = null,
           prospection_history = k.prospection_history || prospection_entree('remise', 'structure', 'automatique', 'Rattaché à une structure active')
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
    update contacts k set hors_prospection_at = now(),
           prospection_history = k.prospection_history || prospection_entree('exclusion', 'structure', 'automatique', 'Structure inactive supprimée : ' || coalesce(old.name, ''))
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
    -- marqueur AUTOMATIQUE seulement (jamais l'exclusion manuelle) ; mémoire des adresses : part automatique seulement
    perform prospection_memoire_lever_auto(l.contact_id) from contact_structures l where l.structure_id = new.id;
    update contacts k set hors_prospection_at = null,
           prospection_history = k.prospection_history || prospection_entree('remise', 'structure', 'automatique', 'Structure réactivée : ' || coalesce(new.name, ''))
     where k.hors_prospection_at is not null and k.id in (select l.contact_id from contact_structures l where l.structure_id = new.id);
    for c in select l.contact_id from contact_structures l join contacts k on k.id = l.contact_id
             where l.structure_id = new.id and (k.email is not null or k.email_2 is not null) loop
      perform brevo_queue(c);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.brevo_structure_trg() from public, anon, authenticated;

-- Mode essai : la liste blanche ne se modifie ni ne s'efface par l'API de l'équipe tant qu'une clé Brevo est enregistrée (relecture
-- B2 du 09/11). La présence de la clé est lue par brevo_key_status (v1.47, SECURITY DEFINER : la clé reste illisible) ; réponse
-- inconnue = clé supposée présente. Pas SECURITY DEFINER : current_user est le rôle de l'appel.
create or replace function public.brevo_essai_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.key = 'brevo_essai_emails' and current_user::text in ('anon', 'authenticated')
     and (tg_op = 'DELETE' or new.key is distinct from old.key or new.value is distinct from old.value)
     and coalesce(public.brevo_key_status(), true) then
    raise exception 'Mode essai Brevo : vide d’abord la clé Brevo (Réglages › Brevo), puis la liste blanche peut être retirée.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create or replace trigger brevo_essai_guard before update or delete on public.settings
  for each row execute function public.brevo_essai_guard();

-- ─────────────── 5. Mémoire des exclusions par adresse (décision du 09/11/2026 ; relecture du 09/11) ───────────────
-- Liste d'opposition : adresse en minuscules, origine (manuelle / automatique), date, raison et DERNIER motif seulement (pas le
-- journal du contact). Aucune purge : une adresse exclue le reste tant que l'équipe ne la remet pas en prospection.
create table if not exists public.prospection_memoire (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  exclue_manuelle_at timestamptz,   -- exclusion manuelle (équipe)
  hors_auto_at timestamptz,         -- exclusion automatique (structure)
  memorise_at timestamptz not null default now(),
  raison text not null check (raison in ('suppression', 'adresse retirée')),
  motif text,                       -- dernier motif d'exclusion du contact
  check (exclue_manuelle_at is not null or hors_auto_at is not null)
);
comment on table public.prospection_memoire is
  'Liste d’opposition : exclusions de la prospection gardées par adresse (minuscules) après la suppression du contact ou le retrait de l’adresse (décision du 09/11/2026). Écrite par la base seulement ; lue par la base et par la sauvegarde (service_role, lecture) ; effacée par « Remettre en prospection » (set_prospection), part automatique par un rattachement actif ou une réactivation. Aucune purge.';
alter table public.prospection_memoire enable row level security;   -- aucune règle : illisible par l'API de l'équipe
revoke all on public.prospection_memoire from public, anon, authenticated, service_role;
grant select on public.prospection_memoire to service_role;          -- sauvegarde JSON (backup-export) : lecture seule

-- Dernier motif d'exclusion d'un journal de prospection
create or replace function public.prospection_dernier_motif(p_hist jsonb) returns text
language sql immutable set search_path = public as $$
  select h->>'motif' from jsonb_array_elements(coalesce(p_hist, '[]'::jsonb)) with ordinality t(h, n)
   where h->>'action' = 'exclusion' and coalesce(h->>'motif', '') <> '' order by n desc limit 1
$$;

-- Texte de la trace « Exclusion reprise … » (journal du contact qui reçoit l'exclusion)
create or replace function public.prospection_trace(p_raison text, p_at timestamptz, p_motif text) returns text
language sql immutable set search_path = public as $$
  select case when p_raison = 'adresse retirée' then 'Exclusion reprise d’une adresse retirée d’un contact exclu le '
              else 'Exclusion reprise d’un contact supprimé le ' end
         || to_char(p_at at time zone 'Europe/Paris', 'DD/MM/YYYY') || coalesce(' : « ' || nullif(p_motif, '') || ' »', '')
$$;

-- Suppression d'un contact exclu, ou adresse retirée d'un contact exclu : l'adresse est gardée (fusion avec une mémoire existante),
-- et l'exclusion suit l'adresse : les AUTRES contacts existants qui la portent la reçoivent, tracée.
create or replace function public.prospection_memoire_garde() returns trigger
language plpgsql security definer set search_path = public as $$
declare mails text[]; raison text; motif text := prospection_dernier_motif(old.prospection_history); trace text;
begin
  if old.prospection_exclue_at is null and old.hors_prospection_at is null then return null; end if;
  if tg_op = 'DELETE' then
    mails := prospection_mails(old.email, old.email_2); raison := 'suppression';
  else
    mails := array(select unnest(prospection_mails(old.email, old.email_2)) except select unnest(prospection_mails(new.email, new.email_2)));
    raison := 'adresse retirée';
  end if;
  if cardinality(mails) = 0 then return null; end if;
  insert into prospection_memoire (email, exclue_manuelle_at, hors_auto_at, memorise_at, raison, motif)
    select e, old.prospection_exclue_at, old.hors_prospection_at, now(), raison, motif from unnest(mails) e
  on conflict (email) do update set
    exclue_manuelle_at = coalesce(prospection_memoire.exclue_manuelle_at, excluded.exclue_manuelle_at),
    hors_auto_at = coalesce(prospection_memoire.hors_auto_at, excluded.hors_auto_at),
    memorise_at = excluded.memorise_at, raison = excluded.raison, motif = coalesce(excluded.motif, prospection_memoire.motif);
  trace := prospection_trace(raison, now(), motif);
  update contacts k set prospection_exclue_at = old.prospection_exclue_at,
         prospection_history = k.prospection_history || prospection_entree('exclusion', 'manuelle', 'automatique', trace)
   where old.prospection_exclue_at is not null and k.prospection_exclue_at is null and k.id <> old.id
     and prospection_mails(k.email, k.email_2) && mails;
  update contacts k set hors_prospection_at = old.hors_prospection_at,
         prospection_history = k.prospection_history || prospection_entree('exclusion', 'structure', 'automatique', trace)
   where old.hors_prospection_at is not null and k.hors_prospection_at is null and k.id <> old.id
     and prospection_mails(k.email, k.email_2) && mails;
  return null;
end $$;
revoke all on function public.prospection_memoire_garde() from public, anon, authenticated;
create or replace trigger contacts_prospection_oubli after delete or update of email, email_2 on public.contacts
  for each row execute function public.prospection_memoire_garde();

-- Création d'un contact (ou nouvelle adresse) avec une adresse mémorisée : le marqueur revient, une trace par origine (date et
-- dernier motif de la mémoire la plus récente). Nom choisi pour passer APRÈS contacts_clean et contacts_prospection_guard
-- (déclencheurs BEFORE exécutés par ordre alphabétique) : la garde voit la saisie de l'équipe, la reprise est faite par la base.
create or replace function public.prospection_memoire_reprise() returns trigger
language plpgsql security definer set search_path = public as $$
declare man timestamptz; aut timestamptz; r record; trace text; mails text[] := prospection_mails(new.email, new.email_2);
begin
  if tg_op = 'UPDATE' then
    mails := array(select unnest(mails) except select unnest(prospection_mails(old.email, old.email_2)));   -- adresses nouvelles seulement
  end if;
  if cardinality(mails) = 0 then return new; end if;
  select min(exclue_manuelle_at), min(hors_auto_at) into man, aut from prospection_memoire where email = any(mails);
  if man is null and aut is null then return new; end if;
  select raison, memorise_at, motif into r from prospection_memoire where email = any(mails) order by memorise_at desc limit 1;
  trace := prospection_trace(r.raison, r.memorise_at, r.motif);
  new.prospection_history := coalesce(new.prospection_history, '[]'::jsonb);
  if man is not null and new.prospection_exclue_at is null then
    new.prospection_exclue_at := man;
    new.prospection_history := new.prospection_history || prospection_entree('exclusion', 'manuelle', 'automatique', trace);
  end if;
  if aut is not null and new.hors_prospection_at is null then
    new.hors_prospection_at := aut;
    new.prospection_history := new.prospection_history || prospection_entree('exclusion', 'structure', 'automatique', trace);
  end if;
  return new;
end $$;
revoke all on function public.prospection_memoire_reprise() from public, anon, authenticated;
create or replace trigger contacts_prospection_memoire before insert or update of email, email_2 on public.contacts
  for each row execute function public.prospection_memoire_reprise();

-- Part automatique de la mémoire levée pour les adresses d'un contact (rattachement actif, réactivation) ; part manuelle gardée
create or replace function public.prospection_memoire_lever_auto(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mails text[];
begin
  select prospection_mails(email, email_2) into mails from contacts where id = p_contact;
  if mails is null or cardinality(mails) = 0 then return; end if;
  update prospection_memoire set hors_auto_at = null where email = any(mails) and hors_auto_at is not null and exclue_manuelle_at is not null;
  delete from prospection_memoire where email = any(mails) and exclue_manuelle_at is null;
end $$;
revoke all on function public.prospection_memoire_lever_auto(uuid) from public, anon, authenticated;
