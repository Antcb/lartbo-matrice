/**
 * 🎤 Questions de la fiche artiste (artiste.html?t=<jeton>), dans l'ordre affiché.
 * Pour ajouter une question : une ligne dans la bonne section. Pour un fichier : une ligne dans ARTIST_DOCS
 * (le chemin dit dans quel sous-dossier du dossier Drive de l'artiste il est rangé).
 * Types : text (par défaut), date, number, email, tel, url, textarea (words = mots max), choice (boutons), select,
 * list (lignes répétables : cols = colonnes, max = nombre de lignes, wrap = colonnes sur plusieurs lignes), roles (une ligne par rôle : roles = rôles, cols = colonnes).
 */
const YN = ['Oui', 'Non'];

const NB = {type: 'number'};
export const ARTIST_SECTIONS = [
  {title: '1. Informations générales', fields: [
    {k: 'group_name', label: 'Nom du groupe / de l’artiste', req: true},
    {k: 'created_on', label: 'Date de création', placeholder: 'ex. 14/01/2022'},
    {k: 'lineup', label: 'Formation principale', type: 'select', options: ['Solo', 'Duo', 'Trio', 'Quatuor', 'Quintette', 'Sextette', '7 et plus']},
    {k: 'language', label: 'Langue de communication', placeholder: 'ex. Français'},
    {k: 'country', label: 'Pays représenté', placeholder: 'ex. France'},
    {k: 'region', label: 'Région', placeholder: 'ex. Auvergne-Rhône-Alpes'},
    {k: 'department', label: 'Département', placeholder: 'ex. Isère (38)'},
    {k: 'departure_country', label: 'Pays de départ', placeholder: 'ex. France'},
    {k: 'departure_city', label: 'Ville de départ', placeholder: 'ex. Grenoble'},
    {k: 'music_family', label: 'Grande famille musicale', type: 'select',
      options: ['Musiques Actuelles (Pop, rock, électro, rap, reggae…)', 'Jazz / Blues', 'Musiques du monde / Traditionnelles', 'Chanson', 'Musique classique / contemporaine', 'Jeune public', 'Autre']},
    {k: 'style_1', label: 'Style musical — choix 1', placeholder: 'ex. Électro Pop'},
    {k: 'style_2', label: 'Style musical — choix 2', placeholder: 'ex. Pop alternative / Indie Pop'},
    {k: 'formulas', label: 'Formules proposées (jusqu’à 3)', type: 'list', max: 3, full: true, add: 'Ajouter une formule',
      cols: [{k: 'name', label: 'Formule', placeholder: 'ex. Solo, Trio, Full band', w: '1.3fr'}, {k: 'musicians', label: 'Musiciens', placeholder: 'nb', w: '90px'},
        {k: 'techs', label: 'Techniciens', placeholder: 'nb', w: '100px'}, {k: 'note', label: 'Précision', placeholder: 'ex. version acoustique', w: '1.5fr'}]},
  ]},
  {title: '2. Présentation', fields: [
    {k: 'bio', label: 'Présentation', type: 'textarea', words: 250, full: true, rows: 3, req: true},
  ]},
  {title: '3. Actualités du projet', help: 'Signatures, sorties, accompagnements, temps forts…', fields: [
    {k: 'news', type: 'list', full: true, add: 'Ajouter une actualité', cols: [{k: 'when', label: 'Quand', placeholder: 'ex. Mars 2026', w: '160px'}, {k: 'what', label: 'Quoi', placeholder: 'ex. Sortie du 1er album'}]},
  ]},
  {title: '4. Dernières sorties', help: 'EP, albums, singles : les plus récents d’abord.', fields: [
    {k: 'releases', type: 'list', full: true, add: 'Ajouter une sortie', cols: [{k: 'title', label: 'Titre', w: '1.2fr'}, {k: 'type', label: 'Type', placeholder: 'EP, Album, Single', w: '110px'},
      {k: 'date', label: 'Date de sortie', placeholder: 'ex. 31/10/2025', w: '130px'}, {k: 'url', label: 'Lien', placeholder: 'https://…', w: '1.5fr'}]},
  ]},
  {title: '5. Dates / tournée', help: 'Concerts passés marquants et à venir.', fields: [
    {k: 'gigs', type: 'list', full: true, add: 'Ajouter une date', cols: [{k: 'date', label: 'Date', placeholder: 'JJ/MM/AAAA', w: '130px'}, {k: 'venue', label: 'Lieu'}, {k: 'city', label: 'Ville'}, {k: 'note', label: 'Précision', placeholder: 'ex. 1ère partie de…'}]},
  ]},
  {title: '6. Répétitions et accompagnement', fields: [
    {k: 'rehearsal_place', label: 'Lieu de répétition', placeholder: 'ex. La Belle Électrique, Grenoble'},
    {k: 'current_support', label: 'Accompagnement en cours', placeholder: 'ex. Haute Fréquence, La Belle Électrique (2026-2027)'},
    {k: 'past_support', label: 'Dispositifs d’accompagnement déjà suivis', type: 'list', full: true, add: 'Ajouter un dispositif',
      cols: [{k: 'name', label: 'Dispositif', placeholder: 'ex. Contrat de filière CNM'}, {k: 'org', label: 'Structure', placeholder: 'ex. Le Ciel'}, {k: 'year', label: 'Année', placeholder: 'ex. 2025', w: '100px'}]},
  ]},
  {title: '7. Stratégie et motivation', fields: [
    {k: 'strategy', label: 'Où en est le projet, ce qui arrive, ce que vous cherchez', type: 'textarea', full: true, rows: 3},
  ]},
  {title: '8. Composition de l’équipe', cols: 4, fields: [
    {k: 'musicians', label: 'Nombre de musiciens', ...NB}, {k: 'musicians_w', label: 'dont femmes', ...NB}, {k: 'musicians_m', label: 'dont hommes', ...NB}, {k: 'musicians_x', label: 'dont personnes non-genrées', ...NB},
    {k: 'techs', label: 'Nombre de techniciens', ...NB}, {k: 'techs_w', label: 'dont femmes', ...NB}, {k: 'techs_m', label: 'dont hommes', ...NB}, {k: 'techs_x', label: 'dont personnes non-genrées', ...NB},
    {k: 'lead', label: 'Lead', type: 'choice', options: ['Féminin', 'Masculin', 'Mixte', 'Non-genré'], full: true},
    {k: 'members', label: 'Musiciens et techniciens', type: 'list', wrap: true, full: true, add: 'Ajouter une personne',
      cols: [{k: 'role', label: 'Poste', placeholder: 'ex. Chant, guitare, son…'}, {k: 'first_name', label: 'Prénom'}, {k: 'last_name', label: 'Nom'},
        {k: 'birth_date', label: 'Date de naissance', placeholder: 'JJ/MM/AAAA'}, {k: 'email', label: 'Mail'}, {k: 'phone', label: 'Téléphone'}, {k: 'city', label: 'Ville de résidence'}, {k: 'country', label: 'Pays de résidence'}]},
  ]},
  {title: '9. Musicien référent', help: 'La personne du groupe à contacter.', fields: [
    {k: 'ref_name', label: 'Prénom et nom', req: true},
    {k: 'ref_role', label: 'Fonction', placeholder: 'ex. Chanteur, guitariste'},
    {k: 'ref_email', label: 'Mail', type: 'email', req: true},
    {k: 'ref_phone', label: 'Mobile', type: 'tel', req: true},
  ]},
  {title: '10. Équipe professionnelle', help: 'Remplis seulement les lignes qui vous concernent.', fields: [
    {k: 'pros', type: 'roles', full: true, roles: ['Manager', 'Booker', 'Label', 'Attaché·e de presse (RP)', 'Éditeur', 'Community manager (CM)'],
      cols: [{k: 'org', label: 'Structure'}, {k: 'name', label: 'Prénom et nom'}, {k: 'email', label: 'Mail'}, {k: 'phone', label: 'Téléphone', w: '140px'}]},
  ]},
  {title: '11. Structure administrative de l’artiste', help: 'La structure qui porte le projet (association, société, label…) : elle sert pour les contrats et la facturation.', fields: [
    {k: 'adm_legal_name', label: 'Raison sociale'},
    {k: 'adm_legal_form', label: 'Forme juridique', placeholder: 'ex. Association loi 1901, SARL…'},
    {k: 'adm_siret', label: 'SIRET', placeholder: '14 chiffres'},
    {k: 'adm_ape', label: 'Code APE / NAF', placeholder: 'ex. 9001Z'},
    {k: 'adm_vat', label: 'N° TVA intracommunautaire'},
    {k: 'adm_licence', label: 'Licence(s) d’entrepreneur de spectacles', placeholder: 'ex. PLATESV-R-…'},
    {k: 'adm_address', label: 'Adresse du siège', full: true},
    {k: 'adm_postal_code', label: 'Code postal'},
    {k: 'adm_city', label: 'Ville'},
    {k: 'adm_country', label: 'Pays', placeholder: 'ex. France'},
    {k: 'adm_vat_subject', label: 'Soumise à la TVA', type: 'choice', options: YN},
    {k: 'adm_signatory', label: 'Représentée par (prénom et nom)'},
    {k: 'adm_signatory_role', label: 'Qualité', placeholder: 'ex. Président·e, gérant·e'},
    {k: 'adm_email', label: 'Mail administratif', type: 'email'},
    {k: 'adm_phone', label: 'Téléphone', type: 'tel'},
    {k: 'adm_billing_email', label: 'Mail de facturation', type: 'email'},
  ]},
  {title: '12. Liens', fields: [
    {k: 'tracks', label: 'Titres / vidéos', type: 'list', full: true, add: 'Ajouter un titre ou une vidéo', cols: [{k: 'title', label: 'Titre', w: '220px'}, {k: 'url', label: 'Lien', placeholder: 'https://…'}]},
    {k: 'youtube', label: 'Chaîne YouTube', type: 'url'},
    {k: 'spotify', label: 'Spotify', type: 'url'},
    {k: 'apple_music', label: 'Apple Music', type: 'url'},
    {k: 'deezer', label: 'Deezer', type: 'url'},
    {k: 'soundcloud', label: 'SoundCloud', type: 'url'},
    {k: 'bandcamp', label: 'Bandcamp', type: 'url'},
    {k: 'instagram', label: 'Instagram', type: 'url'},
    {k: 'facebook', label: 'Facebook', type: 'url'},
    {k: 'tiktok', label: 'TikTok', type: 'url'},
    {k: 'website', label: 'Site internet', type: 'url'},
    {k: 'linktree', label: 'Linktree', type: 'url', full: true},
  ]},
  {title: '13. Prestation live', fields: [
    {k: 'set_max', label: 'Durée maximum du set', placeholder: 'ex. 45 minutes'},
    {k: 'set_min', label: 'Durée minimum du set', placeholder: 'ex. 30 minutes'},
    {k: 'multi_shows', label: 'Plusieurs concerts possibles sur un même événement', type: 'choice', options: ['Oui, le même jour et/ou sur plusieurs jours', 'Oui, sur plusieurs jours seulement', 'Non'], full: true},
    {k: 'young_audience', label: 'Concert jeune public', type: 'choice', options: YN},
    {k: 'mediation', label: 'Concert de médiation (hôpital, maison d’arrêt, maison pour personnes âgées…)', type: 'choice', options: YN},
    {k: 'outdoor', label: 'Concert en plein air', type: 'choice', options: YN},
    {k: 'acoustic', label: 'Concert acoustique sans amplification', type: 'choice', options: YN},
  ]},
];

/** Crédits photo : demandés avec les fichiers (section 13) */
export const PHOTO_CREDITS = {k: 'photo_credits', label: 'Crédits photo', placeholder: 'ex. Camille Legrand', full: true};

/** Fichiers : [clé, libellé, aide, chemin dans le dossier Drive de l'artiste, types acceptés, nombre minimum (une case par fichier), nom d'une case, cases à ajouter (+ Ajouter)] */
export const ARTIST_DOCS = [
  ['photo_square', 'Photo récente — format carré', 'ex. 1080 × 1080', ['033_Promotion', 'Visuals'], 'image/*'],
  ['photo_portrait', 'Photo récente — 300 × 400 (portrait)', 'ou même proportion en plus grand', ['033_Promotion', 'Visuals'], 'image/*'],
  ['photo_landscape', 'Photo récente — 400 × 300 (paysage)', 'ou même proportion en plus grand', ['033_Promotion', 'Visuals'], 'image/*'],
  ['photos', 'Photos / visuels supplémentaires', 'Facultatif : « + Ajouter une photo » pour en mettre autant que tu veux', ['033_Promotion', 'Visuals'], 'image/*', 0, 'Photo', true],
  ['logos', 'Logos', 'PNG fond transparent de préférence ; « + Ajouter un logo » pour en mettre plusieurs', ['033_Promotion', 'Logos'], 'image/*,application/pdf', 0, 'Logo', true],
  ['tech_rider', 'Fiche technique (avec le plan de scène)', 'PDF', ['030_Reference', 'Technical'], 'application/pdf,image/*'],
  ['hosp_rider', 'Fiche accueil (hospitality rider)', 'PDF', ['030_Reference', 'Technical'], 'application/pdf'],
  ['press_kit', 'Dossier de presse / EPK', 'PDF', ['033_Promotion', 'Content Text'], 'application/pdf'],
  ['audio', 'Titres audio en MP3 ou WAV (3 minimum)', 'Un titre par case, en MP3 ou en WAV', ['033_Promotion', 'Audio'], 'audio/mpeg,audio/wav,audio/x-wav,audio/wave,.mp3,.wav', 3, 'Titre'],
];
