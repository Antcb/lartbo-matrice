-- v1.66.5 — Liens des mails dans le journal des suivis (demande d'Anthony du 23/11/2026) : mise à jour CIBLÉE des textes déjà enregistrés.
-- Depuis la v1.66.5, l'extraction garde l'adresse de chaque lien du mail sous la forme « [mots](adresse) » (js/texte-mail.js).
-- Les textes enregistrés avant (prospect_logs.mail_text, private.mail_textes) ont perdu ces adresses : relus dans leur source (.eml joint
-- au suivi, ou Gmail par le titulaire de la boîte), ils sont remplacés SEULEMENT si le nouveau texte, sans ses adresses de liens, est
-- EXACTEMENT l'ancien (vérifié ici, dans la base, pas seulement dans le navigateur) et si le texte n'a pas changé entre-temps.
-- Rien d'autre n'est touché : body (texte et notes de l'entrée), pièces jointes, visibilité, droits ; aucune ligne créée ni supprimée.
--  - mail_texte_liens : textes des mails importés (prospect_logs.mail_text) — SECURITY INVOKER : mêmes droits que la mise à jour
--    directe de l'équipe (RLS is_team, inchangée) ;
--  - mail_texte_liens_prive : textes de la boîte privée (private.mail_textes) — SECURITY DEFINER, titulaire de la boîte vérifié
--    (is_mailbox_owner, comme mail_texte_lire / mail_texte_ecrire) ; la table reste sans accès direct et hors sauvegarde.
-- Lancement : bouton « Mettre à jour les liens des textes » (Mails, compte titulaire), essai à blanc d'abord. Aucune donnée n'est
-- modifiée par cette migration elle-même.
-- Retour arrière : drop function public.mail_texte_liens(uuid, text, text), public.mail_texte_liens_prive(uuid, text, text) ;
-- un texte mis à jour redevient l'ancien par regexp_replace(texte, <motif ci-dessous>, '\1', 'gi') (identité garantie par le contrôle).
-- Rejouable (create or replace). Ordre : cette migration, PUIS l'application v1.66.5.
begin;

/** Texte sans les adresses de liens « [mots](adresse) » (même motif que js/texte-mail.js LINK_MARK) */
create or replace function public.mail_texte_sans_liens(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(p, '\[([^][\n]+)\]\(((https?://|mailto:|tel:)[^()[:space:]<>]+)\)', '\1', 'gi')
$$;
revoke all on function public.mail_texte_sans_liens(text) from public, anon;
grant execute on function public.mail_texte_sans_liens(text) to authenticated;

/** Texte d'un mail importé : p_old → p_new si p_new sans liens = p_old et si le texte enregistré est encore p_old ; true = mis à jour */
create or replace function public.mail_texte_liens(p_log uuid, p_old text, p_new text) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if p_old is null or p_new is null or p_new = p_old then return false; end if;
  if public.mail_texte_sans_liens(p_new) is distinct from p_old then
    raise exception 'texte différent : seule l''adresse des liens peut être ajoutée' using errcode = '22023';
  end if;
  update public.prospect_logs set mail_text = p_new where id = p_log and mail_text = p_old;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.mail_texte_liens(uuid, text, text) from public, anon;
grant execute on function public.mail_texte_liens(uuid, text, text) to authenticated;

/** Même chose pour un message de la boîte privée, par son titulaire seulement */
create or replace function public.mail_texte_liens_prive(p_id uuid, p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if not exists (select 1 from public.mail_messages m where m.id = p_id and public.is_mailbox_owner(m.mailbox)) then
    raise exception 'réservé au titulaire de la boîte' using errcode = '42501';
  end if;
  if p_old is null or p_new is null or p_new = p_old then return false; end if;
  if public.mail_texte_sans_liens(p_new) is distinct from p_old then
    raise exception 'texte différent : seule l''adresse des liens peut être ajoutée' using errcode = '22023';
  end if;
  update private.mail_textes set body_text = p_new where message_id = p_id and body_text = p_old;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.mail_texte_liens_prive(uuid, text, text) from public, anon;
grant execute on function public.mail_texte_liens_prive(uuid, text, text) to authenticated;

commit;
