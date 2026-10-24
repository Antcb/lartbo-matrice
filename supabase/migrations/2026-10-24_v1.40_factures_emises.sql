-- v1.40.6 — Factures émises protégées CÔTÉ BASE (V1-A lot A1 ; CONVENTIONS §6.4 Q4, §6.7 Q10 ; décision d'Anthony du 24/10/2026).
-- Règle écrite deux fois (§8.4) : côté application js/calc.js (isInvoiced, EMITTED_FIELDS, changeBlocked).
-- Facture « émise » = date d'envoi, date de paiement, numéro ou identifiant Pennylane renseigné.
--
-- 1. Une facture émise ne se supprime pas (ni seule, ni avec sa date : la suppression en chaîne est refusée aussi),
--    ne change ni de montant, ni de %, ni de TVA, ni de date, ni de type, et aucun des champs qui la rendent émise
--    ne s'efface (pas de déverrouillage). Libellé, échéance, relance, compte d'encaissement, pièce, lien : modifiables.
-- 2. Le mode booking / production d'une date qui porte une facture émise ne change plus automatiquement
--    (changement de mode de l'artiste, changement d'artiste de la date). Le choix manuel reste contrôlé par l'application.
-- Aucune donnée existante n'est modifiée. Retour arrière : voir la fin du fichier.

create or replace function public.show_payments_emitted_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  emitted boolean := old.sent_at is not null or old.paid_at is not null
                     or nullif(btrim(old.invoice_number), '') is not null or nullif(btrim(old.pennylane_id), '') is not null;
begin
  if not emitted then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Facture déjà émise : elle ne se supprime pas (ni seule, ni avec sa date).' using errcode = 'P0001';
  end if;
  if (old.sent_at is not null and new.sent_at is null) or (old.paid_at is not null and new.paid_at is null)
     or (nullif(btrim(old.invoice_number), '') is not null and nullif(btrim(new.invoice_number), '') is null)
     or (nullif(btrim(old.pennylane_id), '') is not null and nullif(btrim(new.pennylane_id), '') is null) then
    raise exception 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas.' using errcode = 'P0001';
  end if;
  if new.amount is distinct from old.amount or new.pct is distinct from old.pct or new.vat_rate is distinct from old.vat_rate
     or new.show_id is distinct from old.show_id or new.kind is distinct from old.kind then
    raise exception 'Facture déjà émise : son montant, son %%, sa TVA, sa date et son type ne se modifient plus.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists show_payments_emitted_guard on public.show_payments;
create trigger show_payments_emitted_guard before update or delete on public.show_payments
  for each row execute function public.show_payments_emitted_guard();

-- Mode de l'artiste changé : seules les dates non manuelles SANS facture émise suivent (§6.7)
create or replace function public.project_mode_to_shows() returns trigger
language plpgsql as $function$
begin
  if new.mode is distinct from old.mode then
    update public.shows s set prod_mode = new.mode
     where s.project_id = new.id and not s.prod_mode_manual
       and not exists (select 1 from public.show_payments p where p.show_id = s.id
                        and (p.sent_at is not null or p.paid_at is not null
                             or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null));
  end if;
  return new;
end $function$;

-- Artiste de la date changé : le mode suit le nouvel artiste, sauf mode manuel ou facture émise sur la date (§6.7)
create or replace function public.show_follow_project_mode() returns trigger
language plpgsql as $function$
begin
  if new.project_id is distinct from old.project_id and not new.prod_mode_manual
     and not exists (select 1 from public.show_payments p where p.show_id = new.id
                      and (p.sent_at is not null or p.paid_at is not null
                           or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null)) then
    new.prod_mode := coalesce((select mode from public.projects where id = new.project_id), new.prod_mode);
  end if;
  return new;
end $function$;

-- Retour arrière (aucune donnée concernée) :
--   drop trigger show_payments_emitted_guard on public.show_payments; drop function public.show_payments_emitted_guard();
--   puis recréer project_mode_to_shows et show_follow_project_mode dans leur version précédente
--   (texte relevé en production le 24/10/2026 avant application, sans la condition « not exists … »).
