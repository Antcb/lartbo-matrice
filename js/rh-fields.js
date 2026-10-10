/**
 * 👤 Champs de la fiche salarié (questionnaire public rh.html et fiche dans l'app) et pièces justificatives.
 * col : colonne de la table employees (sinon rangé dans employees.info).
 * mm  : en-tête de colonne de l'export Movinmotion (salaries.csv).
 * secret : jamais renvoyé au questionnaire public (seulement « déjà renseigné »).
 * Sans dépendance : chargé aussi par la page publique.
 */
export const RH_SECTIONS = [
  {title: 'Identité', fields: [
    {k:'civility', label:'Civilité', type:'choice', options:['Madame','Monsieur','Autre'], mm:/^civilit/i},
    {k:'first_name', col:true, label:'Prénom(s)', req:true, mm:/^pr[eé]nom$/i},
    {k:'last_name', col:true, label:'Nom de famille', req:true, mm:/^nom de famille$|^nom$/i},
    {k:'birth_name', label:'Nom de naissance (si différent)', mm:/^nom de naissance$/i},
    {k:'birth_date', label:'Date de naissance', type:'date', req:true, mm:/^date de naissance$/i},
    {k:'birth_city', label:'Ville de naissance', req:true, mm:/^ville de naissance$/i},
    {k:'birth_dept', label:'Département de naissance', placeholder:'ex. 49, ou 99 si né·e à l’étranger', mm:/d[eé]partement de naissance/i},
    {k:'birth_country', label:'Pays de naissance', req:true, def:'France', mm:/^pays de naissance$/i},
    {k:'nationality', label:'Nationalité', req:true, def:'Française', mm:/^nationalit/i},
  ]},
  {title: 'Coordonnées', fields: [
    {k:'email', col:true, label:'Mail (celui de ton espace Movinmotion)', type:'email', req:true, mm:/^e?-?mail$/i},
    {k:'phone', col:true, label:'Téléphone', type:'tel', req:true, mm:/^t[eé]l[eé]phone mobile$|^portable$|^mobile$/i},
    {k:'address', label:'Adresse', req:true, full:true, mm:/^adresse$/i},
    {k:'address2', label:'Complément d’adresse', full:true, mm:/^compl[eé]ment/i},
    {k:'postal_code', label:'Code postal', req:true, mm:/^code postal$/i},
    {k:'city', label:'Ville', req:true, mm:/^ville$/i},
    {k:'country', label:'Pays', def:'France', mm:/^pays$/i},
  ]},
  {title: 'Paie', fields: [
    {k:'ssn', label:'N° de sécurité sociale', req:true, secret:true, mm:/s[eé]curit[eé] sociale$/i},
    {k:'conges_spectacles', label:'N° Congés Spectacles', mm:/cong[eé]s spectacles/i},
    {k:'iban', label:'IBAN', req:true, secret:true, mm:/^iban$/i},
    {k:'bic', label:'BIC', req:true, secret:true, mm:/^bic$/i},
  ]},
  {title: 'Pièce d’identité', help: 'Carte d’identité ou passeport.', fields: [
    {k:'id_no', label:'N° de carte d’identité', secret:true},
    {k:'id_issued', label:'Délivrée le', type:'date'},
    {k:'id_expires', label:'Expire le', type:'date'},
    {k:'passport_no', label:'N° de passeport', secret:true},
    {k:'passport_issued', label:'Délivré le', type:'date'},
    {k:'passport_expires', label:'Expire le', type:'date'},
  ]},
  {title: 'Permis de conduire', fields: [
    {k:'licence', label:'Permis (catégories)', placeholder:'ex. B, A2'},
    {k:'licence_no', label:'N° de permis', secret:true},
    {k:'licence_expires', label:'Permis valable jusqu’au', type:'date'},
  ]},
  {title: 'Déplacements et tournée', part:'extra', fields: [
    {k:'vehicle', label:'Véhicule (marque, modèle, immatriculation)', full:true},
    {k:'sncf_card', label:'N° carte SNCF (Avantage, Grand Voyageur…)'},
    {k:'flying_blue', label:'N° Flying Blue'},
    {k:'diet', label:'Régime alimentaire / allergies', full:true, placeholder:'Pour les repas en tournée'},
  ]},
];

/** Champs remplis seulement par l'équipe (pas dans le questionnaire public) */
export const RH_TEAM_FIELDS = [
  {k:'role', col:true, label:'Poste', mm:/^poste( principal)?$|^emploi$|^fonction$/i},
  {k:'type', label:'Type de contrat', placeholder:'Intermittent, CDD…', mm:/^type$/i},
  {k:'medical_visit', label:'Dernière visite médicale', mm:/visite m[eé]dicale/i},
  {k:'payroll_id', label:'Matricule de paie', mm:/^matricule/i},
  {k:'notes', label:'Notes', type:'textarea', full:true, mm:/^notes$/i},
];

export const RH_FIELDS = RH_SECTIONS.flatMap(s => s.fields);

/** Pièces demandées [type, nom, obligatoire, questionnaire] — rangées dans le Drive sous « RIB - NOM Prénom.pdf » */
export const RH_DOCS = [
  ['rib', 'RIB', true, 'main'], ['carte_vitale', 'Carte vitale', true, 'main'], ['cni', 'CNI', false, 'main'], ['passeport', 'Passeport', false, 'main'],
  ['photo', 'Photo d’identité', false, 'main'], ['permis', 'Permis de conduire', false, 'main'], ['carte_grise', 'Carte grise', false, 'extra'],
];

/** Deux questionnaires : la fiche RH (identité, paie, pièces) et les infos complémentaires (véhicule, cartes de voyage…) */
export const RH_PARTS = {main: 'Fiche RH', extra: 'Infos complémentaires'};
export const partOf = sec => sec.part || 'main';

export const fullName = e => [String(e?.last_name || '').toUpperCase(), e?.first_name].filter(Boolean).join(' ');
