-- =====================================================================================================
-- OPÉRATION DE DONNÉES (production) — PRÉPARÉE, NON EXÉCUTÉE. À lancer seulement sur autorisation d'Anthony, APRÈS la publication de la v1.60.
-- Décision d'Anthony du 06/11/2026 : fiche DISTINCTE « POGO TANGO », rattachée à La Pigñata comme structure administrative.
-- Préservés intégralement : la structure « La Pignata » (nom, 4 contacts, 27 dates), les documents déjà envoyés, l'historique.
-- Sources : fiche entreprise https://app.dataprospects.fr/entreprises/POGO-TANGO/902629054 (POGO TANGO, 123 rue des Platières 01290 Grièges,
--   SIREN 902629054, SIRET 90262905400013, association déclarée, APE 9329Z, active) ; page de la mairie
--   https://grieges.fr/sports-loisirs/loisirs/pogo-tango/ (collectif de 11 projets musicaux dont La Pigñata).
-- Non soumise à la TVA : information d'Anthony. AUCUN numéro de TVA (celui des annuaires est calculé à partir du SIREN).
-- RNA : « W012014779 » NON retrouvé dans une source identifiable → laissé vide, « à compléter ».
-- Représentant légal / signataire et qualité : NON renseignés (un contact cité par la mairie ne vaut pas habilitation) → à confirmer.
-- Effet Pennylane : les PROCHAINES factures de commission booking de La Pigñata auront POGO TANGO pour client ; aucune facture ni brouillon
--   existant pour La Pigñata (relevé du 06/11 : 0 ligne avec numéro ou lien Pennylane) ; rien n'est modifié dans Pennylane par cette opération.
-- =====================================================================================================
begin;
do $p$
declare st uuid;
begin
  -- garde-fous : pas de doublon (même SIRET ou même nom), artiste sans structure administrative, projet attendu
  if exists (select 1 from public.structures where regexp_replace(coalesce(admin->>'siret', ''), '\D', '', 'g') = '90262905400013' or upper(btrim(name)) = 'POGO TANGO') then
    raise exception 'ARRÊT : une structure Pogo Tango existe déjà (aucun doublon créé)'; end if;
  if (select name from public.projects where id = 'f6d4fe38-ee67-4cc7-a83a-5adfc4f8d722') is distinct from 'La Pigñata'
     or (select admin_structure_id from public.projects where id = 'f6d4fe38-ee67-4cc7-a83a-5adfc4f8d722') is not null then
    raise exception 'ARRÊT : état de La Pigñata différent de celui relevé le 06/11 (aucune modification)'; end if;
  insert into public.structures (name, address, postal_code, city, country, tags, admin)
  values ('POGO TANGO', '123 rue des Platières', '01290', 'Grièges', 'France', array['Structure artiste', 'Association'],
    jsonb_build_object('legal_name', 'POGO TANGO', 'legal_form', 'Association déclarée', 'siret', '90262905400013', 'ape', '9329Z',
      'address', '123 rue des Platières', 'postal_code', '01290', 'city', 'Grièges', 'country', 'France', 'vat_subject', 'Non',
      'notes', 'RNA : à compléter (non retrouvé dans une source identifiable). Représentant légal et qualité : à confirmer. Non soumise à la TVA (information d''Anthony, 06/11/2026) : aucun numéro de TVA.'))
  returning id into st;
  update public.projects set admin_structure_id = st where id = 'f6d4fe38-ee67-4cc7-a83a-5adfc4f8d722';
  -- contrôles : rien d'autre n'a bougé
  if (select count(*) from public.shows where structure_id = '7fb25ae4-6cdd-474a-b6da-cad9d0f3646f') <> 27
     or (select count(*) from public.contact_structures where structure_id = '7fb25ae4-6cdd-474a-b6da-cad9d0f3646f') <> 4
     or (select name from public.structures where id = '7fb25ae4-6cdd-474a-b6da-cad9d0f3646f') <> 'La Pignata' then
    raise exception 'ARRÊT : « La Pignata » a changé entre-temps (tout est annulé)'; end if;
  raise notice 'POGO TANGO créée (%) et rattachée à La Pigñata ; « La Pignata », ses 4 contacts et ses 27 dates inchangés', st;
end $p$;
commit;
