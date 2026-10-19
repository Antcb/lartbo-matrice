/**
 * 🎤 Questions de la fiche artiste (artiste.html?t=<jeton>), dans l'ordre affiché.
 * Pour ajouter une question : une ligne dans la bonne section. Pour un fichier : une ligne dans ARTIST_DOCS
 * (le chemin dit dans quel sous-dossier du dossier Drive de l'artiste il est rangé).
 * Types : text (par défaut), date, number, email, tel, url, textarea (words = mots max), choice (boutons), select,
 * list (lignes répétables : cols = colonnes).
 */
const YN = ['Oui', 'Non'];

export const ARTIST_SECTIONS = [
  {title: '1. Informations générales', fields: [
    {k: 'group_name', label: 'Nom du groupe / de l’artiste', req: true},
    {k: 'created_on', label: 'Date de création', placeholder: 'ex. 14/01/2022'},
    {k: 'lineup', label: 'Formation', type: 'select', options: ['Solo', 'Duo', 'Trio', 'Quatuor', 'Quintette', 'Sextette', '7 et plus']},
    {k: 'language', label: 'Langue de communication', placeholder: 'ex. Français'},
    {k: 'country', label: 'Pays représenté', placeholder: 'ex. France'},
    {k: 'region', label: 'Région', placeholder: 'ex. Auvergne-Rhône-Alpes'},
    {k: 'departure_country', label: 'Pays de départ', placeholder: 'ex. France'},
    {k: 'departure_city', label: 'Ville de départ', placeholder: 'ex. Grenoble'},
    {k: 'music_family', label: 'Grande famille musicale', type: 'select', full: true,
      options: ['Musiques Actuelles (Pop, rock, électro, rap, reggae…)', 'Jazz / Blues', 'Musiques du monde / Traditionnelles', 'Chanson', 'Musique classique / contemporaine', 'Jeune public', 'Autre']},
    {k: 'style_1', label: 'Style musical — choix 1', placeholder: 'ex. Électro Pop'},
    {k: 'style_2', label: 'Style musical — choix 2', placeholder: 'ex. Pop alternative / Indie Pop'},
  ]},
  {title: '2. Présentation', fields: [
    {k: 'bio', label: 'Présentation', type: 'textarea', words: 250, full: true, rows: 9, req: true},
  ]},
  {title: '3. Actualités du projet', help: 'Signatures, sorties, accompagnements, temps forts…', fields: [
    {k: 'news', type: 'list', full: true, add: 'Ajouter une actualité', cols: [{k: 'when', label: 'Quand', placeholder: 'ex. Mars 2026', w: '160px'}, {k: 'what', label: 'Quoi', placeholder: 'ex. Sortie du 1er album'}]},
  ]},
  {title: '4. Dates / tournée', help: 'Concerts passés marquants et à venir.', fields: [
    {k: 'gigs', type: 'list', full: true, add: 'Ajouter une date', cols: [{k: 'date', label: 'Date', placeholder: 'JJ/MM/AAAA', w: '130px'}, {k: 'venue', label: 'Lieu'}, {k: 'city', label: 'Ville'}, {k: 'note', label: 'Précision', placeholder: 'ex. 1ère partie de…'}]},
  ]},
  {title: '5. Stratégie et motivation', fields: [
    {k: 'strategy', label: 'Où en est le projet, ce qui arrive, ce que vous cherchez', type: 'textarea', full: true, rows: 8},
  ]},
  {title: '6. Composition de l’équipe', cols: 3, fields: [
    {k: 'musicians', label: 'Nombre de musiciens', type: 'number'},
    {k: 'musicians_w', label: 'dont femmes', type: 'number'},
    {k: 'musicians_m', label: 'dont hommes', type: 'number'},
    {k: 'techs', label: 'Nombre de techniciens', type: 'number'},
    {k: 'techs_w', label: 'dont femmes', type: 'number'},
    {k: 'techs_m', label: 'dont hommes', type: 'number'},
    {k: 'lead', label: 'Lead', type: 'choice', options: ['Féminin', 'Masculin', 'Mixte'], full: true},
  ]},
  {title: '7. Musicien référent', help: 'La personne du groupe à contacter.', fields: [
    {k: 'ref_name', label: 'Prénom et nom', req: true},
    {k: 'ref_role', label: 'Fonction', placeholder: 'ex. Chanteur, guitariste'},
    {k: 'ref_email', label: 'Mail', type: 'email', req: true},
    {k: 'ref_phone', label: 'Mobile', type: 'tel', req: true},
  ]},
  {title: '8. Liens', fields: [
    {k: 'tracks', label: 'Titres / vidéos', type: 'list', full: true, add: 'Ajouter un titre ou une vidéo', cols: [{k: 'title', label: 'Titre', w: '220px'}, {k: 'url', label: 'Lien', placeholder: 'https://…'}]},
    {k: 'youtube', label: 'Chaîne YouTube', type: 'url'},
    {k: 'spotify', label: 'Spotify', type: 'url'},
    {k: 'deezer', label: 'Deezer', type: 'url'},
    {k: 'apple_music', label: 'Apple Music', type: 'url'},
    {k: 'soundcloud', label: 'SoundCloud', type: 'url'},
    {k: 'bandcamp', label: 'Bandcamp', type: 'url'},
    {k: 'instagram', label: 'Instagram', type: 'url'},
    {k: 'facebook', label: 'Facebook', type: 'url'},
    {k: 'tiktok', label: 'TikTok', type: 'url'},
    {k: 'website', label: 'Site internet', type: 'url'},
    {k: 'linktree', label: 'Linktree', type: 'url'},
    {k: 'photo_credits', label: 'Crédits photo', placeholder: 'ex. Camille Legrand', full: true},
  ]},
  {title: '9. Prestation live', fields: [
    {k: 'set_max', label: 'Durée maximum du set', placeholder: 'ex. 45 minutes'},
    {k: 'set_min', label: 'Durée minimum du set', placeholder: 'ex. 30 minutes'},
    {k: 'multi_shows', label: 'Plusieurs concerts possibles sur un même événement', type: 'choice', options: ['Oui, le même jour et/ou sur plusieurs jours', 'Oui, sur plusieurs jours seulement', 'Non'], full: true},
    {k: 'young_audience', label: 'Concert jeune public', type: 'choice', options: YN},
    {k: 'mediation', label: 'Concert de médiation (hôpital, maison d’arrêt, maison pour personnes âgées…)', type: 'choice', options: YN},
    {k: 'outdoor', label: 'Concert en plein air', type: 'choice', options: YN},
    {k: 'acoustic', label: 'Concert acoustique sans amplification', type: 'choice', options: YN},
  ]},
];

/** Fichiers : [clé, libellé, aide, chemin dans le dossier Drive de l'artiste, types acceptés] */
export const ARTIST_DOCS = [
  ['photos', 'Photos du groupe (HD)', 'Plusieurs photos possibles', ['033_Promotion', 'Visuals'], 'image/*'],
  ['logos', 'Logos', 'PNG fond transparent de préférence', ['033_Promotion', 'Logos'], 'image/*,application/pdf'],
  ['tech_rider', 'Fiche technique', 'PDF', ['030_Reference', 'Technical'], 'application/pdf,image/*'],
  ['stage_plot', 'Plan de scène / patch', 'PDF ou image', ['030_Reference', 'Technical'], 'application/pdf,image/*'],
  ['hosp_rider', 'Fiche accueil (hospitality rider)', 'PDF', ['030_Reference', 'Technical'], 'application/pdf'],
  ['press_kit', 'Dossier de presse / EPK', 'PDF', ['033_Promotion', 'Content Text'], 'application/pdf'],
  ['audio', 'Titres audio (MP3 / WAV)', 'Les titres à faire écouter', ['033_Promotion', 'Audio'], 'audio/*'],
];
