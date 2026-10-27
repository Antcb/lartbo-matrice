-- =====================================================================================================
-- v1.50 — Lot Contacts (CONVENTIONS §3.4, décision Q23 ; décision d'Anthony du 27/10/2026 sur les doublons)
-- Une adresse mail n'est JAMAIS déplacée automatiquement (notes, téléphone) : contacts_clean ne fait plus que le nettoyage
-- autorisé (espaces et caractères invisibles, majuscules) ; une adresse au mauvais format reste dans sa case, seulement
-- nettoyée comme les autres par clean_email (minuscules, espaces et invisibles retirés, fin « (…) » retirée), jamais déplacée
-- (l'application et les pages publiques la refusent avant l'envoi, avec un message sous le champ).
-- Inchangé : nettoyage des téléphones (clean_phone), mail 2 remonté en mail 1 quand le mail 1 est vide, mail 2 identique retiré.
-- Aucune donnée existante n'est modifiée (la fonction ne s'applique qu'aux prochaines saisies).
-- Retour arrière : recréer contacts_clean dans sa version v1.36 (supabase/migrations/2026-10-20_v1.36_contacts_propres.sql).
-- =====================================================================================================
create or replace function public.contacts_clean() returns trigger
language plpgsql as $$
begin
  new.phone := clean_phone(new.phone); new.phone_2 := clean_phone(new.phone_2);
  -- nettoyage seulement : jamais de mail déplacé vers les notes ou le téléphone (Q23)
  new.email := clean_email(new.email); new.email_2 := clean_email(new.email_2);
  if new.email is null and new.email_2 is not null then new.email := new.email_2; new.email_2 := null; end if;
  if new.email_2 = new.email then new.email_2 := null; end if;
  return new;
end $$;
-- droits inchangés (create or replace les conserve ; relevés en production le 27/10/2026 : propriétaire postgres, sans security definer).
