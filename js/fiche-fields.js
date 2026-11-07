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
    {k:'cr_break', src:'fiche', label:'Break', req:true, only:'cr', full:true, placeholder:'ex. 450 entrées payantes / 6 500 € de recettes', tag:'Break'},
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

/** Département pour les noms de fichiers : 79200 → 79, Corse 2A / 2B, outre-mer 971… ; sinon le département de la date (CH, BE… à l'étranger) */
export function deptOf(postal, fallback){
  const cp = String(postal || '').replace(/\s/g, '');
  if (/^\d{5}$/.test(cp)) return /^9[78]/.test(cp) ? cp.slice(0, 3) : /^20/.test(cp) ? (Number(cp) < 20200 ? '2A' : '2B') : cp.slice(0, 2);
  const d = String(fallback || '').trim();
  return /^\d$/.test(d) ? '0' + d : d.toUpperCase();
}

/**
 * Source du lieu d'une date pour les documents (fiche, contrat, nom du fichier ; même règle que fiche_get / mail_vars côté serveur
 * et dept_ du script Google), décisions d'Anthony du 07/11/2026 : chaque valeur vient 1. de la date (valeurs enregistrées sur elle,
 * lieu choisi ou saisi : elles priment toujours), 2. de la structure SEULEMENT si elle est confirmée comme lieu (case « Utiliser
 * l'adresse de la structure comme lieu de représentation » = venue_is_structure, ou structure choisie comme lieu), 3. sinon rien
 * (à compléter). Code postal complet et département ne remplacent jamais l'un l'autre : department = département de la date, sinon
 * tiré du code postal de la source.
 */
export function venueSource(d, st){
  const t = x => (x == null ? '' : String(x).trim()) || null, conf = !!d?.venue_is_structure && !!st;
  const pick = k => t(d?.[k]) || (conf ? t(st[k]) : null);
  const department = deptOf('', d?.department) || deptOf(t(d?.postal_code), '')
    || (conf ? deptOf('', st.department_code) || deptOf(t(st.postal_code), '') : '') || null;
  // pays : celui de la structure confirmée ; sinon la France seulement si le département de la date est français (sinon à compléter)
  const country = conf ? (t(st.country) || 'France') : /^(\d{2,3}|2[AB])$/i.test(department || '') ? 'France' : null;
  return {address: pick('address'), postal_code: pick('postal_code'), city: pick('city'), department, country, confirmed: conf};
}

/** Valeurs par défaut tirées de la date et de la structure (fiche_get ou données de l'app) ; lieu : venueSource */
export function ficheDefaults(d){
  const st = d.structure || {}, src = venueSource(d, d.structure);
  return {
    legal_name: st.name, country: 'France',
    venue_name: d.venue, venue_address: src.address, venue_postal_code: src.postal_code, venue_city: src.city, venue_country: src.country,
    capacity: d.capacity, cr_break: d.cr_break, show_time: d.show_time, set_length: d.set_length,
    ticketing: d.ticketing_type === 'Gratuit' ? 'Gratuit' : d.ticketing_type ? 'Payant (prix libre compris)' : '',
  };
}
