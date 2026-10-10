/**
 * 👤 Champs de la fiche salarié et pièces justificatives.
 * Fonctionnement : l'export Movinmotion remplit la fiche (sections « main »), puis le salarié complète
 * les « Infos complémentaires » (sections « extra ») avec son lien rh.html, pièces comprises.
 * col : colonne de la table employees (sinon rangé dans employees.info).
 * mm  : en-tête de colonne de l'export Movinmotion (salaries.csv).
 * ph  : balise <<…>> du modèle Google Sheet « Fiche RH ».
 * secret : jamais renvoyé au questionnaire public (seulement « déjà renseigné »).
 * if  : champ affiché selon une autre réponse.
 * Sans dépendance : chargé aussi par la page publique.
 */
export const RH_SECTIONS = [
  {title: 'Identité', fields: [
    {k:'civility', ph:'Genre', label:'Civilité', type:'choice', options:['Madame','Monsieur','Autre'], mm:/^civilit/i},
    {k:'first_name', ph:'Prénom(s)', col:true, label:'Prénom(s)', req:true, mm:/^pr[eé]nom$/i},
    {k:'last_name', ph:'Nom de Famille', col:true, label:'Nom de famille', req:true, mm:/^nom de famille$|^nom$/i},
    {k:'birth_name', label:'Nom de naissance (si différent)', mm:/^nom de naissance$/i},
    {k:'birth_date', ph:'Date de Naissance', label:'Date de naissance', type:'date', req:true, mm:/^date de naissance$/i},
    {k:'birth_city', ph:'Ville de Naissance', label:'Ville de naissance', req:true, mm:/^ville de naissance$/i},
    {k:'birth_dept', label:'Département de naissance', placeholder:'ex. 49, ou 99 si né·e à l’étranger', mm:/d[eé]partement de naissance/i},
    {k:'birth_country', ph:'Pays de Naissance', label:'Pays de naissance', req:true, def:'France', mm:/^pays de naissance$/i},
    {k:'nationality', ph:'Nationalité', label:'Nationalité', req:true, def:'Française', mm:/^nationalit/i},
  ]},
  {title: 'Coordonnées', fields: [
    {k:'email', ph:'Adresse Email Espace Movinmotion', col:true, label:'Mail (celui de ton espace Movinmotion)', type:'email', req:true, mm:/^e?-?mail$/i},
    {k:'phone', ph:'N° de Téléphone', col:true, label:'Téléphone', type:'tel', req:true, mm:/^t[eé]l[eé]phone mobile$|^portable$|^mobile$/i},
    {k:'address', ph:'Adresse', label:'Adresse', req:true, full:true, mm:/^adresse$/i},
    {k:'address2', ph:'Adresse Bis', label:'Complément d’adresse', full:true, mm:/^compl[eé]ment/i},
    {k:'postal_code', ph:'Code Postal', label:'Code postal', req:true, mm:/^code postal$/i},
    {k:'city', ph:'Ville', label:'Ville', req:true, mm:/^ville$/i},
    {k:'country', ph:'Pays', label:'Pays', def:'France', mm:/^pays$/i},
  ]},
  {title: 'Paie', fields: [
    {k:'ssn', ph:'N° de Sécurité Sociale', label:'N° de sécurité sociale', req:true, secret:true, mm:/s[eé]curit[eé] sociale$/i},
    {k:'conges_spectacles', ph:'N° Congés Spectacles', label:'N° Congés Spectacles', mm:/cong[eé]s spectacles/i},
    {k:'iban', ph:"IBAN (Relevé d'Identité Bancaire)", label:'IBAN', req:true, secret:true, mm:/^iban$/i},
    {k:'bic', ph:'BIC (Bank Identifier Code)', label:'BIC', req:true, secret:true, mm:/^bic$/i},
  ]},
  {title: 'Pièce d’identité', help: 'Carte d’identité ou passeport.', fields: [
    {k:'id_no', ph:'N° de CNI', label:'N° de carte d’identité', secret:true},
    {k:'id_issued', ph:'Date de délivrance de la CNI', label:'Délivrée le', type:'date'},
    {k:'id_expires', ph:"Date d'expiration de la CNI", label:'Expire le', type:'date'},
    {k:'passport_no', ph:'N° de Passeport', label:'N° de passeport', secret:true},
    {k:'passport_issued', ph:'Date de délivrance du passeport', label:'Délivré le', type:'date'},
    {k:'passport_expires', ph:"Date d'expiration du passeport", label:'Expire le', type:'date'},
  ]},
  {title: 'Permis de conduire', part:'extra', fields: [
    {k:'has_licence', label:'Détiens-tu le permis de conduire ?', type:'choice', options:['Oui','Non'], req:true},
    {k:'licence', ph:'Permis', label:'Catégories', placeholder:'ex. AM, B1, B', req:true, if:['has_licence','Oui']},
    {k:'licence_no', ph:'N° de permis de conduire', label:'N° de permis de conduire', secret:true, req:true, if:['has_licence','Oui']},
    {k:'licence_issued', ph:'Date de délivrance du permis de conduire', label:'Date de délivrance (4a)', type:'date', if:['has_licence','Oui']},
    {k:'licence_expires', ph:"Date d'expiration du permis de conduire", label:'Date d’expiration (4b)', type:'date', if:['has_licence','Oui']},
    {k:'licence_b_date', label:'Date d’obtention du permis B', type:'date', if:['has_licence','Oui']},
  ]},
  {title: 'Déplacements', part:'extra', fields: [
    {k:'sncf_card', ph:'N° Carte SNCF', label:'N° carte(s) SNCF'},
    {k:'flying_blue', ph:'N° Flying Blue', label:'N° Flying Blue'},
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
  ['photo', 'Photo d’identité', false, 'main'], ['permis', 'Permis de conduire', false, 'extra', ['has_licence','Oui']],
];

/** « main » : rempli par l'export Movinmotion (et l'équipe) ; « extra » : le questionnaire envoyé au salarié */
export const RH_PARTS = {main: 'Fiche RH (Movinmotion)', extra: 'Infos complémentaires'};
export const partOf = sec => sec.part || 'main';

export const fullName = e => [String(e?.last_name || '').toUpperCase(), e?.first_name].filter(Boolean).join(' ');
