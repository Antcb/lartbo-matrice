-- =====================================================================================================
-- OPÉRATION DE DONNÉES (production) — PRÉPARÉE, NON EXÉCUTÉE. Chaque bloc s'approuve ou s'exclut séparément (autorisation d'Anthony).
-- Trois groupes, à approuver ou exclure séparément : A1, A2 (après accord sur les confirmations de juin), B.
-- La Pigñata (booking) : structure de contractualisation POGO TANGO, non soumise à la TVA → confirmations avec HT = TTC (TVA de la date 0 %).
-- Seule la TVA de la date change (vat_rate : vide → 0) ; le cachet HT validé, les % et les lignes ne changent pas ; aucun document émis,
-- aucun mail renvoyé. Garde serveur : la base refuse tout changement de TVA si une facture émise en dépend (shows_frozen_guard).
-- Relevé du 06/11/2026 : aucune ligne facturée, aucun lien Pennylane, aucun contrat envoyé sur les dates des blocs A et B.
-- EXCLUES : Warehouse 2027-02-27 (90cf6062-…) : contrat envoyé le 07/10, aucune modification automatique ;
--           Rock n Eat 2027-01-14 (db4d2cec-…) : déjà à 0 %.
-- =====================================================================================================
-- GROUPE A1 — La Rayonne, Cabaret Sauvage, Le Family (cachet HT inchangé) — approuvable séparément
--   Rien d'envoyé depuis la Matrice pour ces 3 dates (ni conditions validées, ni mail, ni contrat, ni facture).
begin;
do $a1$
declare r record; n int := 0;
begin
  for r in select * from (values
      ('68068dda-67fd-4e94-8b47-4ec71fef785b'::uuid, date '2026-11-18', 'La Rayonne', 200::numeric),
      ('ec786349-6779-4f04-92dd-17de5653f08f'::uuid, date '2026-11-20', 'Cabaret Sauvage', 0::numeric),
      ('8c092535-d3cb-4f1d-8252-ddd3ffce0e5a'::uuid, date '2027-02-26', 'Le Family', 400::numeric)) v(id, d, venue, fee) loop
    if not exists (select 1 from public.shows s where s.id = r.id and s.date = r.d and s.venue = r.venue and s.fee_ht = r.fee and s.vat_rate is null
                     and s.prod_mode = 'booking' and s.contract_sent is null and s.project_id = 'f6d4fe38-ee67-4cc7-a83a-5adfc4f8d722') then
      raise exception 'ARRÊT : % (%) a changé depuis le relevé du 06/11 (tout le bloc est annulé)', r.venue, r.d; end if;
    update public.shows set vat_rate = 0 where id = r.id;
    if (select fee_ht from public.shows where id = r.id) is distinct from r.fee then raise exception 'ARRÊT : cachet HT modifié (%)', r.venue; end if;
    n := n + 1;
  end loop;
  raise notice 'Groupe A1 : TVA 0 %% sur % dates, cachets HT inchangés', n;
end $a1$;
commit;


