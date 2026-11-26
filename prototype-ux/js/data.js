// MATRICE — prototype UX/UI : structure de navigation et DONNÉES FICTIVES.
// Aucun nom d'artiste, de lieu, de personne ni aucun montant ne vient de la base réelle.
// Navigation : architecture modulaire validée le 26/11/2026 (aucun module futur, aucun écran fictif d'un module non autorisé).
window.MATRICE_DATA = (() => {
  const MODULES = [
    { id: 'accueil', label: 'Accueil', icon: 'house', fixed: true, tabs: [
      { id: 'tableau-de-bord', label: 'Tableau de bord', icon: 'layout-grid', from: 'Nouveau. Dans MATRICE 1.68, To Do sert d’écran d’accueil.' } ] },
    { id: 'diffusion', label: 'Diffusion', icon: 'radio-tower', tabs: [
      { id: 'booking', label: 'Booking', icon: 'calendar-days', from: 'Onglet Booking : Liste, Carte et trajets, dates archivées, export.', cross: 'Structure › Dates, Projet › Dates, Suivi › Dates de ce suivi' },
      { id: 'suivi', label: 'Suivi', icon: 'target', from: 'Onglet Suivi et fiche suivi (journal, planning, rayon, relances) ; prospection lancée depuis les structures.', cross: 'Structure › Suivi, Projet › Suivis, To Do' } ] },
    { id: 'production', label: 'Production', icon: 'clapperboard', tabs: [
      { id: 'production', label: 'Production', icon: 'clipboard-check', from: 'Onglet Production : dates confirmées et options ; Conditions, Suivi admin, Factures, Budget, Notes.', cross: 'Booking (date confirmée ouverte ici), Finances' },
      { id: 'budgets', label: 'Budgets', icon: 'calculator', from: 'Budget intégré à chaque date dans Production. Arbitrage A7 : accès rapide conservé depuis la date + page dédiée complète.', cross: 'Production › date › Budget, Projet › Budget type, Spectacles' },
      { id: 'ticketing', label: 'Ticketing', icon: 'ticket', from: 'Onglet Ticketing : jauge, seuil, billets vendus, remplissage, lien billetterie.', cross: 'Promotion & Marketing (lien billetterie)' } ] },
    { id: 'administration', label: 'Administration', icon: 'landmark', tabs: [
      { id: 'finances', label: 'Finances', icon: 'wallet', from: 'Nouvelle vue (arbitrage A3), alimentée par les données existantes : indicateurs et factures aujourd’hui dans Production. Aucun calcul modifié.', cross: 'Production › Factures (accès conservé)' },
      { id: 'salaries', label: 'Salariés', icon: 'id-card', from: 'Onglet Salariés : fiches, questionnaire, pièces, import Movinmotion.', cross: 'Projet › Membres' } ] },
    { id: 'repertoire', label: 'Répertoire', icon: 'library', tabs: [
      { id: 'projets', label: 'Projets', icon: 'mic-vocal', from: 'Onglet Projets et fiche projet (11 sous-onglets).', cross: 'Filtre Artistes de tous les écrans' },
      { id: 'structures', label: 'Structures', icon: 'building-2', from: 'Onglet Structures et fiche structure (6 sous-onglets).', cross: 'Tous les champs « structure »' },
      { id: 'contacts', label: 'Contacts', icon: 'contact', from: 'Onglet Contacts.', cross: 'Fiche structure › Contacts, destinataires des mails' } ] },
    { id: 'communication', label: 'Communication', icon: 'message-circle', tabs: [
      { id: 'mails', label: 'Mails', icon: 'mail', owner: true, from: 'Onglet Mails (boîte du titulaire). Arbitrage A8 : masqué pour les autres comptes ; contrôle serveur inchangé.', cross: 'Journal des suivis, Production' },
      { id: 'promotion', label: 'Promotion & Marketing', icon: 'megaphone', from: 'Ancien onglet Communication, renommé (arbitrage A5) : affiches, boucle com, liens.', cross: 'Production › Suivi admin (boucle com)' },
      { id: 'modeles', label: 'Modèles de mails', icon: 'file-text', from: 'Réglages › Modèles de mail et Projet › Modèles de mail.', cross: 'Prospection, Production' } ] },
    { id: 'organisation', label: 'Organisation', icon: 'list-todo', tabs: [
      { id: 'todo', label: 'To Do', icon: 'list-checks', from: 'Onglet To Do (ancien écran d’accueil).', cross: 'Structure, Projet, Suivi, Notifications' } ] },
    { id: 'reglages', label: 'Réglages', icon: 'settings', fixed: true, tabs: [
      { id: 'preferences', label: 'Préférences personnelles', icon: 'sliders-horizontal', from: 'Nouveau (prototype : stockage local de ce navigateur, arbitrage A12).' },
      { id: 'parametres', label: 'Paramètres de l’entreprise', icon: 'settings-2', from: 'Les 14 panneaux actuels de Réglages (pourcentages, budget type, pôles, modèles, contrats, Google, agendas, prospection, Brevo, IA, Pennylane, délais, version).' } ] },
  ];

  // Configuration initiale proposée par métier (cahier §13 et §18) — ce ne sont PAS des droits d'accès
  const PROFILES = {
    booking: { label: 'Booking / Diffusion', order: ['accueil', 'diffusion', 'repertoire', 'communication', 'organisation', 'production', 'administration', 'reglages'],
      shortcuts: ['booking', 'suivi', 'structures', 'mails'], kpis: ['options', 'confirmees', 'suivis', 'cachets'] },
    production: { label: 'Production', order: ['accueil', 'production', 'organisation', 'diffusion', 'repertoire', 'communication', 'administration', 'reglages'],
      shortcuts: ['production', 'budgets', 'todo', 'ticketing'], kpis: ['confirmees', 'reste', 'relances', 'taches'] },
    administration: { label: 'Administration', order: ['accueil', 'administration', 'production', 'repertoire', 'organisation', 'diffusion', 'communication', 'reglages'],
      shortcuts: ['finances', 'production', 'salaries', 'todo'], kpis: ['reste', 'impayes', 'commissions', 'relances'] },
    direction: { label: 'Direction', order: ['accueil', 'administration', 'production', 'diffusion', 'repertoire', 'communication', 'organisation', 'reglages'],
      shortcuts: ['finances', 'booking', 'production', 'todo'], kpis: ['cachets', 'commissions', 'confirmees', 'reste'] },
  };

  // Indicateurs proposés (libellés repris de MATRICE quand ils existent) — valeurs fictives
  // m : libellé court pour la ligne de 4 indicateurs sur téléphone (le libellé complet reste lu par les lecteurs d'écran)
  const KPIS = {
    confirmees: { m: 'Confirmées', label: 'Dates confirmées', value: '18', note: 'saison 2026-2027' },
    options: { m: 'Options', label: 'Options en cours', value: '7', note: 'dont 2 à relancer' },
    cachets: { m: 'Cachets', label: 'Cachets confirmés', value: 64350, eur: true, note: 'HT, saison en cours' },
    commissions: { m: 'Commissions', label: 'Commissions nettes', value: 8912, eur: true, note: 'après part partenaires' },
    reste: { m: 'À encaisser', label: 'Reste à encaisser', value: 21480, eur: true, note: 'production' },
    impayes: { m: 'Impayés', label: 'Factures impayées', value: 6240, eur: true, note: '3 factures émises' },
    relances: { m: 'Retards', label: 'Relances en retard', value: '4', note: 'à traiter', warn: true },
    suivis: { m: 'À relancer', label: 'Suivis à relancer', value: '9', note: 'sans réponse > 10 j' },
    taches: { m: 'Urgentes', label: 'Tâches urgentes', value: '5', note: 'échéance ≤ 7 j' },
    remplissage: { m: 'Remplissage', label: 'Remplissage moyen', value: '72 %', note: 'dates en billetterie' },
  };

  const BLOCKS = {
    dates: 'Prochaines dates', taches: 'Tâches', suivis: 'Suivis à relancer', messages: 'Messages',
    cachets: 'Cachets par mois', billetterie: 'Billetterie',
  };

  // Les 10 statuts de MATRICE + « sans statut » (11 représentations distinctes, arbitrage A4)
  // type → forme (Festival : carré, Salle : rond, Artiste : losange) ; étape → remplissage ; libellé toujours affiché
  const STATUSES = [
    { s: 'Intérêt Festival', type: 'fest', stage: 'int' }, { s: 'Option Festival', type: 'fest', stage: 'opt' }, { s: 'Confirmée Festival', type: 'fest', stage: 'conf' },
    { s: 'Intérêt Salle', type: 'salle', stage: 'int' }, { s: 'Option Salle', type: 'salle', stage: 'opt' }, { s: 'Confirmée Salle', type: 'salle', stage: 'conf' },
    { s: 'Option Artiste', type: 'art', stage: 'opt' }, { s: 'Confirmée Artiste', type: 'art', stage: 'conf' },
    { s: 'Annulée', type: 'ann', stage: 'off' }, { s: 'Sans Suite', type: 'ss', stage: 'off' }, { s: 'Sans statut', type: 'none', stage: 'off' },
  ];

  const ARTISTS = ['Lune Ardente', 'Frères Cobalt', 'Nadia Ferrant Trio', 'Orchestre de Minuit'];

  const DATES = [
    { id: 'd1', date: '2026-11-28', artist: 'Lune Ardente', venue: 'Le Hangar Bleu', city: 'Nantes (44)', status: 'Confirmée Salle', fee: 3200, contract: 'Cession', capacity: 450, sold: 318, seuil: 260 },
    { id: 'd2', date: '2026-12-03', artist: 'Frères Cobalt', venue: 'La Cale Sèche', city: 'Brest (29)', status: 'Option Salle', fee: 2400, contract: 'Co-Réalisation', capacity: 300, sold: 0, seuil: 210 },
    { id: 'd3', date: '2026-12-05', artist: 'Nadia Ferrant Trio', venue: 'Théâtre du Rempart', city: 'Dijon (21)', status: 'Confirmée Salle', fee: 4100, contract: 'Cession', capacity: 620, sold: 401, seuil: 450 },
    { id: 'd4', date: '2026-12-12', artist: 'Lune Ardente', venue: 'Salle Paul-Verdier', city: 'Lyon (69)', status: 'Intérêt Salle', fee: 2800, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd5', date: '2027-01-16', artist: 'Orchestre de Minuit', venue: 'Le Préau', city: 'Tours (37)', status: 'Confirmée Artiste', fee: 0, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd6', date: '2027-02-06', artist: 'Frères Cobalt', venue: 'La Fabrique Sonore', city: 'Lille (59)', status: 'Confirmée Salle', fee: 2900, contract: 'Cession', capacity: 380, sold: 122, seuil: 240 },
    { id: 'd7', date: '2027-07-10', artist: 'Nadia Ferrant Trio', venue: 'Festival des Tilleuls', city: 'Auch (32)', status: 'Option Festival', fee: 5500, contract: 'Cession', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd8', date: '2027-07-24', artist: 'Lune Ardente', venue: 'Rencontres du Littoral', city: 'Sète (34)', status: 'Intérêt Festival', fee: 4800, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
  ];

  const TASKS = [
    { t: 'Relancer le contrat signé — Théâtre du Rempart', due: '2026-11-25', prio: 'late', pole: 'Production' },
    { t: 'Envoyer la fiche technique à La Cale Sèche', due: '2026-11-27', prio: 'high', pole: 'Production' },
    { t: 'Commande d’affiches A3 — Le Hangar Bleu', due: '2026-11-28', prio: 'high', pole: 'Communication' },
    { t: 'Facture de solde — Le Hangar Bleu', due: '2026-12-01', prio: 'normal', pole: 'Comptabilité' },
    { t: 'Préparer le planning de janvier', due: '2026-12-04', prio: 'normal', pole: 'Booking' },
  ];

  const SUIVIS = [
    { s: 'Le Grand Kiosque', city: 'Rennes', artist: 'Frères Cobalt', last: '2026-11-12', st: 'Mail envoyé' },
    { s: 'Festival des Marais', city: 'Niort', artist: 'Lune Ardente', last: '2026-11-08', st: 'Intérêt' },
    { s: 'Scène des Remparts', city: 'Vannes', artist: 'Nadia Ferrant Trio', last: '2026-11-05', st: 'Option' },
    { s: 'Café des Rives', city: 'Angers', artist: 'Orchestre de Minuit', last: '2026-10-30', st: 'Mail envoyé' },
  ];

  const MESSAGES = [
    { from: 'Programmation — Le Grand Kiosque', subj: 'Re : proposition de date en mars', at: '09:42', unread: true },
    { from: 'Régie — Théâtre du Rempart', subj: 'Fiche technique et plan de feu', at: '08:15', unread: true },
    { from: 'Festival des Marais', subj: 'Dossier de candidature 2027', at: 'Hier', unread: false },
    { from: 'Administration — Le Hangar Bleu', subj: 'Acompte réglé', at: 'Hier', unread: false },
  ];

  // Cachets par mois, exercice 01/10/2026 → 30/09/2027 : réalisé (jusqu'à novembre) et prévisionnel
  const MONTHS = ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.'];
  const CACHETS = [
    { m: 0, real: 7400, plan: 8000 }, { m: 1, real: 9800, plan: 9000 }, { m: 2, real: null, plan: 11500 }, { m: 3, real: null, plan: 4200 },
    { m: 4, real: null, plan: 6300 }, { m: 5, real: null, plan: 7800 }, { m: 6, real: null, plan: 5600 }, { m: 7, real: null, plan: 8200 },
    { m: 8, real: null, plan: 12400 }, { m: 9, real: null, plan: 16900 }, { m: 10, real: null, plan: 9100 }, { m: 11, real: null, plan: 3500 },
  ];

  const NOTIFS = [
    { icon: 'triangle-alert', t: 'Contrat signé non reçu', b: 'Théâtre du Rempart · Nadia Ferrant Trio · échéance dépassée', when: 'Aujourd’hui, 6 h' },
    { icon: 'clock', t: 'Facture de solde à préparer', b: 'Le Hangar Bleu · concert le 28/11', when: 'Aujourd’hui, 6 h' },
    { icon: 'mail', t: 'Boucle communication à envoyer', b: 'La Fabrique Sonore · J-70', when: 'Hier' },
  ];

  const CONTACTS = ['Camille Rouet — Le Grand Kiosque', 'Hugo Ménard — Théâtre du Rempart', 'Inès Carrel — Festival des Marais', 'Paul Ternier — Le Hangar Bleu'];
  const STRUCTURES = ['Le Hangar Bleu', 'La Cale Sèche', 'Théâtre du Rempart', 'Le Grand Kiosque', 'Festival des Marais', 'La Fabrique Sonore', 'Festival des Tilleuls'];

  return { MODULES, PROFILES, KPIS, BLOCKS, STATUSES, ARTISTS, DATES, TASKS, SUIVIS, MESSAGES, MONTHS, CACHETS, NOTIFS, CONTACTS, STRUCTURES, TODAY: '2026-11-26' };
})();
