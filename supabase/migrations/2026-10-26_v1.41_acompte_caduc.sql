-- v1.41.4 (lot C1, décisions d'Anthony du 26/10/2026 : point 3, puis verrou contre la facturation simultanée) — PRÉPARÉE, NON APPLIQUÉE : répétition sur le projet de test,
-- puis application seulement sur autorisation explicite d'Anthony.
-- Acompte CADUC protégé CÔTÉ BASE : sur une date de PRODUCTION dont le solde est déjà facturé (envoyé, payé, numéroté ou lié à
-- Pennylane), un acompte jamais facturé ne peut plus le devenir — ni numéro, ni date d'envoi, ni date de paiement, ni lien Pennylane
-- (sinon la date serait facturée au-delà de sa cession). Une ligne d'acompte DÉJÀ émise n'est pas concernée (protégée par A1).
-- Une ligne d'acompte insérée déjà émise sur une telle date est refusée de la même façon.
-- Facturation SIMULTANÉE (décision d'Anthony du 26/10/2026) : chaque émission d'un acompte ou d'un solde prend un verrou
-- transactionnel propre à la date (pg_advisory_xact_lock) ; deux émissions de la même date se suivent au lieu de se croiser.
-- Garanti en READ COMMITTED (réglage de Supabase : application, synchronisation Pennylane, éditeur SQL) ; une transaction ouverte
-- à la main en REPEATABLE READ / SERIALIZABLE n'est pas couverte. Attente limitée par lock_timeout (8 s pour l'application).
-- Règle écrite deux fois (§8.4) : côté application js/calc.js (changeBlocked, acompteState) ; synchronisation Pennylane :
-- supabase/functions/pennylane/regles.ts (caduc : jamais relié).
-- À appliquer AVEC la migration A1 (2026-10-24_v1.40_factures_emises.sql), avant ou après elle : A1 empêche de contourner ce
-- déclencheur en déplaçant l'acompte vers une autre date (show_id) le temps de l'émettre.
-- Booking : non concerné (acomptes / soldes = factures de l'artiste, hors suivi de L'ArtBo).
-- Libellé, échéance, relance, compte, pièce, % et montant d'un acompte caduc : inchangés par ce déclencheur (historique conservé).
-- Aucune donnée existante n'est lue pour être modifiée ; aucune donnée modifiée. Au 26/10/2026 (lecture seule) : 0 acompte caduc
-- en production. Retour arrière : voir la fin du fichier.

create or replace function public.show_payments_caduc_guard() returns trigger
language plpgsql set search_path = public as $$   -- §7.3
begin
  if new.kind not in ('acompte', 'solde')
     or not (new.sent_at is not null or new.paid_at is not null
             or nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null) then
    return new;                                                     -- ni acompte ni solde émis : rien à contrôler
  end if;
  -- FACTURATION SIMULTANÉE : acompte et solde d'une même date émis dans deux transactions en même temps. Chaque émission
  -- d'acompte ou de solde prend un verrou propre à la date, gardé jusqu'à la fin de sa transaction : la seconde attend la
  -- première, puis (READ COMMITTED, réglage de Supabase) relit les lignes validées entre-temps et refuse l'acompte caduc.
  -- Verrou « conseil » : ne bloque ni la lecture, ni les autres dates, ni les autres colonnes / lignes de la date.
  perform pg_advisory_xact_lock(hashtext('show_payments_emission'), hashtext(new.show_id::text));
  if new.kind = 'solde' then
    return new;                                                     -- solde : seulement le verrou
  end if;
  if tg_op = 'UPDATE' and old.kind = 'acompte'
     and (old.sent_at is not null or old.paid_at is not null
          or nullif(btrim(old.invoice_number), '') is not null or nullif(btrim(old.pennylane_id), '') is not null) then
    return new;                                                     -- déjà émis avant : pas un acompte caduc (A1 le protège)
  end if;
  if exists (select 1 from public.shows s where s.id = new.show_id and coalesce(s.prod_mode, 'production') <> 'booking')
     and exists (select 1 from public.show_payments so where so.show_id = new.show_id and so.kind = 'solde' and so.id <> new.id
                 and (so.sent_at is not null or so.paid_at is not null
                      or nullif(btrim(so.invoice_number), '') is not null or nullif(btrim(so.pennylane_id), '') is not null)) then
    raise exception 'Acompte caduc : le solde de cette date est déjà facturé, cet acompte ne se facture plus (il dépasserait la cession). Une régularisation se décide à part.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists show_payments_caduc_guard on public.show_payments;
create trigger show_payments_caduc_guard before insert or update on public.show_payments
  for each row execute function public.show_payments_caduc_guard();
revoke execute on function public.show_payments_caduc_guard() from public, anon, authenticated;   -- §7.3 (un déclencheur ne vérifie pas ce droit)

-- Retour arrière (aucune donnée concernée) :
--   drop trigger show_payments_caduc_guard on public.show_payments; drop function public.show_payments_caduc_guard();
