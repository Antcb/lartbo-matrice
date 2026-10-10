/**
 * 📝 Champs de la fiche de renseignements (page publique fiche.html et fiche dans l'app).
 * src 'admin' : coordonnées administratives de la structure (réutilisées pour toutes ses dates).
 * src 'fiche' : infos propres à cette date.
 * Sans dépendance : chargé aussi par la page publique.
 */
const CONTACT_ROLES = [['admin','Administration / contrat'], ['prod','Production / accueil'], ['tech','Régie technique'], ['com','Communication'], ['billet','Billetterie']];

export const FICHE_SECTIONS = [
  {title: 'Organisateur', help: 'Coordonnées qui figureront sur le contrat.', fields: [
    {k:'legal_name', src:'admin', label:'Raison sociale', req:true},
    {k:'legal_form', src:'admin', label:'Forme juridique (association, SARL…)'},
    {k:'siret', src:'admin', label:'SIRET', req:true},
    {k:'ape', src:'admin', label:'Code APE / NAF'},
    {k:'vat', src:'admin', label:'N° TVA intracommunautaire'},
    {k:'licence', src:'admin', label:'Licence(s) d’entrepreneur de spectacles', req:true},
    {k:'address', src:'admin', label:'Adresse du siège', req:true, full:true},
    {k:'postal_code', src:'admin', label:'Code postal', req:true},
    {k:'city', src:'admin', label:'Ville', req:true},
    {k:'country', src:'admin', label:'Pays'},
    {k:'signatory', src:'admin', label:'Signataire du contrat (prénom, nom)', req:true},
    {k:'signatory_role', src:'admin', label:'Qualité du signataire (président·e, directeur·rice…)', req:true},
    {k:'email', src:'admin', label:'Mail administratif', type:'email'},
    {k:'phone', src:'admin', label:'Téléphone administratif', type:'tel'},
    {k:'billing_email', src:'admin', label:'Mail pour les factures', type:'email', req:true},
  ]},
  {title: 'Contacts pour cette date', cols: 3, help: 'Laisse vide si c’est la même personne qu’au-dessus.', fields:
    CONTACT_ROLES.flatMap(([r, l]) => [
      {k:`c_${r}_name`, src:'fiche', label:`${l} : nom`},
      {k:`c_${r}_email`, src:'fiche', label:'Mail', type:'email'},
      {k:`c_${r}_phone`, src:'fiche', label:'Téléphone', type:'tel'},
    ])},
  {title: 'L’événement', fields: [
    {k:'event_name', src:'fiche', label:'Nom de l’événement / du festival', full:true},
    {k:'venue_address', src:'fiche', label:'Adresse du lieu de représentation', req:true, full:true},
    {k:'capacity', src:'fiche', label:'Jauge', type:'number'},
    {k:'doors', src:'fiche', label:'Ouverture des portes', placeholder:'ex. 20h00'},
    {k:'show_time', src:'fiche', label:'Heure de passage', placeholder:'ex. 22h30'},
    {k:'set_length', src:'fiche', label:'Durée du set', placeholder:'ex. 1h15'},
    {k:'ticket_price', src:'fiche', label:'Prix des billets', placeholder:'ex. 15 € / 18 € sur place'},
    {k:'announce_date', src:'fiche', label:'Date d’annonce souhaitée', type:'date'},
    {k:'sale_date', src:'fiche', label:'Date de mise en vente', type:'date'},
    {k:'other_artists', src:'fiche', label:'Autres artistes à l’affiche', full:true},
    {k:'hotel', src:'fiche', label:'Hébergement prévu (nom, adresse)', full:true},
    {k:'remarks', src:'fiche', label:'Remarques', type:'textarea', full:true},
  ]},
];

export const FICHE_FIELDS = FICHE_SECTIONS.flatMap(s => s.fields);
