/**
 * 📝 Champs de la fiche de renseignements — reprend les formulaires « Contrat de Cession »
 * et « Contrat de Coréalisation » (page publique fiche.html et validation dans l'app).
 *
 * src 'admin' : coordonnées de l'organisateur (recopiées sur la structure après validation).
 * src 'fiche' : infos propres à cette date.
 * tag : balise <<…>> du modèle de contrat Word remplie par ce champ.
 * only : 'cc' (cession) ou 'cr' (co-réalisation) ; if : champ affiché selon une autre réponse.
 * Sans dépendance : chargé aussi par la page publique.
 */
const CONTACT_ROLES = [['prod','Production / accueil'], ['tech','Régie technique'], ['com','Communication']];

export const FICHE_SECTIONS = [
  {title: 'L’organisateur', help: 'Ces informations figureront sur le contrat.', fields: [
    {k:'email', src:'admin', label:'Email', type:'email', req:true},
    {k:'legal_name', src:'admin', label:'Raison sociale de la structure (nom)', req:true, full:true, tag:'Raison Sociale de la Structure (Nom)'},
    {k:'address', src:'admin', label:'Adresse du siège social', req:true, full:true, tag:'Adresse du Siège Sociale'},
    {k:'postal_code', src:'admin', label:'Code postal', req:true, tag:'Code Postal'},
    {k:'city', src:'admin', label:'Ville', req:true, tag:'Ville'},
    {k:'country', src:'admin', label:'Pays', req:true, tag:'Pays', def:'France'},
    {k:'siret', src:'admin', label:'N° SIRET', req:true, tag:'N° Siret'},
    {k:'vat_subject', src:'admin', label:'Structure soumise à la TVA ?', type:'choice', options:['Oui','Non'], req:true},
    {k:'vat', src:'admin', label:'N° TVA intracommunautaire', req:true, if:['vat_subject','Oui'], tag:'N° TVA Intracommunautaire'},
    {k:'ape', src:'admin', label:'Code APE', req:true, tag:'Code APE'},
    {k:'signatory', src:'admin', label:'Nom et prénom de la personne signataire du contrat', req:true, tag:'Nom et Prénom de la Personne Signataire du Contrat'},
    {k:'signatory_role', src:'admin', label:'Qualité de la personne signataire', req:true, placeholder:'président·e, directeur·rice…', tag:'Qualité de la Personne Signataire du Contrat'},
    {k:'licence', src:'admin', label:'N° licence entrepreneur du spectacle', tag:'N° Licence Entrepreneur du Spectacle'},
    {k:'signatory_phone', src:'admin', label:'Téléphone de la personne signataire', type:'tel', req:true, placeholder:'+33 6 07 08 09 10', tag:'N° de Téléphone de la Personne Signataire du Contrat'},
    {k:'signatory_email', src:'admin', label:'Mail de la personne signataire', type:'email', req:true, tag:'Mail de la Personne Signataire du Contrat'},
    {k:'billing_email', src:'admin', label:'Mail pour les factures (si différent)', type:'email'},
  ]},
  {title: 'Le concert', fields: [
    {k:'venue_name', src:'fiche', label:'Nom du festival / de la salle', req:true, full:true, tag:'Nom du Festival / Salle'},
    {k:'venue_address', src:'fiche', label:'Adresse du festival / de la salle', req:true, full:true, tag:'Adresse du Festival / Salle'},
    {k:'venue_postal_code', src:'fiche', label:'Code postal', req:true, tag:'Code Postal du Festival / Salle'},
    {k:'venue_city', src:'fiche', label:'Ville', req:true, tag:'Ville du Festival / Salle'},
    {k:'venue_country', src:'fiche', label:'Pays', req:true, tag:'Pays du Festival / Salle', def:'France'},
    {k:'show_time', src:'fiche', label:'Heure de passage', req:true, placeholder:'ex. 22h30', tag:'Heure de Passage'},
    {k:'set_length', src:'fiche', label:'Durée du set', req:true, placeholder:'ex. 1h15', tag:'Durée du Set'},
    {k:'capacity', src:'fiche', label:'Jauge public', type:'number', tag:'Jauge Public'},
    {k:'ticketing', src:'fiche', label:'Billetterie', type:'choice', options:['Payant (prix libre compris)','Gratuit'], req:true, only:'cc', tag:'Billetterie'},
  ]},
  {title: 'Contacts pour cette date', cols: 3, help: 'Facultatif : les personnes à joindre pour l’accueil, la technique et la communication.', fields:
    CONTACT_ROLES.flatMap(([r, l]) => [
      {k:`c_${r}_name`, src:'fiche', label:`${l} : nom`},
      {k:`c_${r}_email`, src:'fiche', label:'Mail', type:'email'},
      {k:`c_${r}_phone`, src:'fiche', label:'Téléphone', type:'tel'},
    ])},
  {title: 'Remarques', fields: [
    {k:'remarks', src:'fiche', label:'Quelque chose à nous signaler ?', type:'textarea', full:true},
  ]},
];

export const FICHE_FIELDS = FICHE_SECTIONS.flatMap(s => s.fields);

/** 'cr' pour une co-réalisation, 'cc' sinon */
export const ficheKind = contractType => contractType === 'Co-Réalisation' ? 'cr' : 'cc';

/** Le champ s'applique-t-il à ce type de contrat et à ces réponses ? */
export const fieldOn = (f, kind, values) => (!f.only || f.only === kind) && (!f.if || values?.[f.if[0]] === f.if[1]);

/** Valeurs par défaut tirées de la date et de la structure (fiche_get ou données de l'app) */
export function ficheDefaults(d){
  const st = d.structure || {};
  return {
    legal_name: st.name, country: 'France',
    venue_name: d.venue, venue_address: st.address, venue_postal_code: st.postal_code || d.cp, venue_city: d.city || st.city, venue_country: st.country || 'France',
    capacity: d.capacity,
    ticketing: d.ticketing_type === 'Gratuit' ? 'Gratuit' : d.ticketing_type ? 'Payant (prix libre compris)' : '',
  };
}
