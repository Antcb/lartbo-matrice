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
-- GROUPE B — 8 dates sans cachet ni TVA (aucun montant inventé, aucun document) : TVA 0 % posée dès maintenant pour que les futures
-- conditions et confirmations affichent HT = TTC, comme pour Pogo Tango.
begin;
do $b$
declare r record; n int := 0;
begin
  for r in select * from (values
      ('ff3fe5a9-bdd5-4d77-be18-1c1327e076ff'::uuid, date '2026-11-28', 'Cave à Musique'),
      ('7db9e1d3-37e7-4fdd-812e-ec8919a49322'::uuid, date '2026-12-11', 'Release Frasque'),
      ('fe6d7541-342c-49af-8177-ae71a30a742f'::uuid, date '2026-12-12', 'Paye ton Noël'),
      ('52d8d64c-3479-4591-8dfa-4b6c3257a6bd'::uuid, date '2026-12-19', 'Les Toqués de la Bauche'),
      ('a3232b01-fd72-4642-bf98-ed937c190303'::uuid, date '2027-04-17', 'Le Radiant'),
      ('22ee454e-8d64-4a23-a05c-2312d59a65f2'::uuid, date '2027-05-14', 'Punk Day'),
      ('557aef2c-5860-4e37-b61e-9c0fc620a44b'::uuid, date '2027-05-29', '648 Café'),
      ('9d567ac7-b6c7-47ad-b565-0eb6fa35ccaf'::uuid, date '2027-08-28', 'Solex')) v(id, d, venue) loop
    if not exists (select 1 from public.shows s where s.id = r.id and s.date = r.d and s.venue = r.venue and s.fee_ht is null and s.vat_rate is null
                     and s.prod_mode = 'booking' and s.contract_sent is null and s.project_id = 'f6d4fe38-ee67-4cc7-a83a-5adfc4f8d722') then
      raise exception 'ARRÊT : % (%) a changé depuis le relevé du 06/11 (tout le bloc est annulé)', r.venue, r.d; end if;
    update public.shows set vat_rate = 0 where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'Groupe B : TVA 0 %% sur % dates sans cachet', n;
end $b$;
commit;
