-- v1.66 — Texte intégral des mails dans le journal des suivis (demande d'Anthony du 20/11/2026), sans l'historique cité.
-- Aucune donnée existante n'est modifiée ; rien n'est supprimé.
--  1. prospect_logs.mail_text (colonne NOUVELLE, vide) : texte d'un mail IMPORTÉ dans un suivi (.eml / Apple Mail), lu dans le .eml
--     joint au suivi — même accès que ce fichier et que le journal (RLS is_team, inchangée).
--  2. private.mail_textes (table NOUVELLE, vide) : texte d'un message de la boîte PRIVÉE anthony@, lu dans Gmail par le compte titulaire.
--     Décision d'Anthony du 20/11/2026 : jamais dans la sauvegarde GitHub ni dans un export partagé. D'où le schéma « private » :
--       - aucun droit pour anon / authenticated (ni lecture ni écriture directe, même avec un jeton valide de l'équipe) ;
--       - aucun droit pour le rôle « sauvegarde » : exclue de la copie complète chiffrée (exclusion décidée : tests/static/
--         sauvegarde-declenchement.mjs ET outils/prive_classement.sql du dépôt lartbo-matrice-backup) ; absente de la sauvegarde JSON
--         (backup-export ne lit que des tables public) ; hors temps réel (schéma private non publié) ;
--       - accès SEULEMENT par les deux fonctions ci-dessous, qui vérifient le titulaire de la boîte (is_mailbox_owner, comme la RLS
--         de mail_messages) : lecture des textes des messages dont on est titulaire ; écriture d'un texte absent (jamais d'écrasement).
--     Gmail reste la source : une base restaurée sans ces textes les relit à l'affichage.
-- Remplissage : par l'application (js/textes-journal.js) à l'affichage d'un suivi ou par « Compléter les textes du journal » ; mails
-- importés après la v1.66 : au dépôt (js/data.js).
-- Retour arrière : update public.prospect_logs set mail_text = null ; delete from private.mail_textes (le texte actuel, body, n'est
-- jamais touché) ; la colonne, la table et les fonctions vides peuvent rester.
-- Rejouable (if not exists / create or replace). Ordre : cette migration, PUIS l'application v1.66.
begin;

alter table public.prospect_logs add column if not exists mail_text text;
comment on column public.prospect_logs.mail_text is
  'v1.66 : texte intégral d''un mail importé (.eml joint au suivi), sans l''historique cité ; vide = non lu (le journal affiche body, signalé « Extrait »)';

create table if not exists private.mail_textes (
  message_id uuid primary key references public.mail_messages(id) on delete cascade,
  body_text text not null,
  created_at timestamptz not null default now()
);
comment on table private.mail_textes is
  'v1.66 : texte intégral des messages de la boîte privée (anthony@), sans l''historique cité ; lu/écrit seulement par mail_texte_lire / mail_texte_ecrire (titulaire) ; jamais sauvegardé ni exporté';
alter table private.mail_textes enable row level security;   -- aucune politique : aucun accès direct, même si un droit était accordé par erreur
revoke all on private.mail_textes from public, anon, authenticated;

/** Textes des messages demandés dont l'appelant est titulaire de la boîte ; les autres sont ignorés (aucune erreur, aucune fuite) */
create or replace function public.mail_texte_lire(p_ids uuid[]) returns table (message_id uuid, body_text text)
language sql stable security definer set search_path = public, private as $$
  select t.message_id, t.body_text
    from private.mail_textes t join public.mail_messages m on m.id = t.message_id
   where t.message_id = any(coalesce(p_ids, '{}')) and public.is_mailbox_owner(m.mailbox)
$$;
revoke all on function public.mail_texte_lire(uuid[]) from public, anon;
grant execute on function public.mail_texte_lire(uuid[]) to authenticated;

/** Enregistre le texte d'un message dont l'appelant est titulaire, s'il n'en a pas encore (jamais d'écrasement) ; true = enregistré */
create or replace function public.mail_texte_ecrire(p_id uuid, p_text text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if coalesce(btrim(p_text), '') = '' then return false; end if;
  if not exists (select 1 from public.mail_messages m where m.id = p_id and public.is_mailbox_owner(m.mailbox)) then
    raise exception 'réservé au titulaire de la boîte' using errcode = '42501';
  end if;
  insert into private.mail_textes (message_id, body_text) values (p_id, p_text) on conflict (message_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.mail_texte_ecrire(uuid, text) from public, anon;
grant execute on function public.mail_texte_ecrire(uuid, text) to authenticated;

commit;
