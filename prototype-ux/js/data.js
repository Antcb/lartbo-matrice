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
    reste: { m: 'À encaisser', label: 'Reste à encaisser', value: 42850, eur: true, note: 'production' },
    impayes: { m: 'Impayés', label: 'Factures impayées', value: 8240, eur: true, note: '5 factures émises' },
    relances: { m: 'Retards', label: 'Relances en retard', value: '4', note: 'à traiter', warn: true },
    suivis: { m: 'À relancer', label: 'Suivis à relancer', value: '9', note: 'sans réponse > 10 j' },
    taches: { m: 'Urgentes', label: 'Tâches urgentes', value: '5', note: 'échéance ≤ 7 j' },
    remplissage: { m: 'Remplissage', label: 'Remplissage moyen', value: '72 %', note: 'dates en billetterie' },
  };

  // Sections du tableau de bord (V5) : chacune sa composition
  const BLOCKS = {
    dates: 'Prochaines dates', finances: 'Finances', taches: 'Tâches', billetterie: 'Billetterie',
    pipeline: 'Suivis actifs', relances: 'Relances prioritaires', messages: 'Messagerie', modules: 'Modules',
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
    { id: 'd1', date: '2026-11-28', artist: 'Lune Ardente', venue: 'Le Hangar Bleu', city: 'Nantes (44)', status: 'Confirmée Salle', fee: 3200, contract: 'Cession', capacity: 450, sold: 318, seuil: 250 },
    { id: 'd2', date: '2026-12-03', artist: 'Frères Cobalt', venue: 'La Cale Sèche', city: 'Brest (29)', status: 'Option Salle', fee: 2400, contract: 'Co-Réalisation', capacity: 300, sold: 0, seuil: 210 },
    { id: 'd3', date: '2026-12-05', artist: 'Nadia Ferrant Trio', venue: 'Théâtre du Rempart', city: 'Dijon (21)', status: 'Confirmée Salle', fee: 4100, contract: 'Cession', capacity: 620, sold: 401, seuil: 450 },
    { id: 'd4', date: '2026-12-12', artist: 'Lune Ardente', venue: 'Salle Paul-Verdier', city: 'Lyon (69)', status: 'Intérêt Salle', fee: 2800, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd5', date: '2027-01-16', artist: 'Orchestre de Minuit', venue: 'Le Préau', city: 'Tours (37)', status: 'Confirmée Artiste', fee: 0, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd6', date: '2027-02-06', artist: 'Frères Cobalt', venue: 'La Fabrique Sonore', city: 'Lille (59)', status: 'Confirmée Salle', fee: 2900, contract: 'Cession', capacity: 380, sold: 122, seuil: 240 },
    { id: 'd7', date: '2027-07-10', artist: 'Nadia Ferrant Trio', venue: 'Festival des Tilleuls', city: 'Auch (32)', status: 'Option Festival', fee: 5500, contract: 'Cession', capacity: 0, sold: 0, seuil: 0 },
    { id: 'd8', date: '2027-07-24', artist: 'Lune Ardente', venue: 'Rencontres du Littoral', city: 'Sète (34)', status: 'Intérêt Festival', fee: 4800, contract: 'N.C', capacity: 0, sold: 0, seuil: 0 },
  ];

  // Tâches : échéance (due) ; done = date à laquelle la tâche a été faite. « Terminées » = 30 derniers jours, comme le filtre
  // « Terminées (30 j) » de l'onglet To Do de MATRICE (done_at ≥ aujourd'hui − 30 j).
  const TASKS = [
    { t: 'Relancer le contrat signé — Théâtre du Rempart', proj: 'Nadia Ferrant Trio', pole: 'Production', due: '2026-11-24' },
    { t: 'Envoyer la fiche technique à La Cale Sèche', proj: 'Frères Cobalt', pole: 'Production', due: '2026-11-26' },
    { t: 'Commande d’affiches A3 — Le Hangar Bleu', proj: 'Lune Ardente', pole: 'Communication', due: '2026-11-27' },
    { t: 'Valider la feuille de route — Le Hangar Bleu', proj: 'Lune Ardente', pole: 'Production', due: '2026-11-27' },
    { t: 'Facture de solde — Le Hangar Bleu', proj: 'Lune Ardente', pole: 'Comptabilité', due: '2026-12-01' },
    { t: 'Préparer le planning de janvier', proj: 'Orchestre de Minuit', pole: 'Booking', due: '2026-12-04' },
    { t: 'Boucle communication — La Fabrique Sonore', proj: 'Frères Cobalt', pole: 'Communication', due: '2026-12-08' },
    { t: 'Relancer le Festival des Tilleuls', proj: 'Nadia Ferrant Trio', pole: 'Booking', due: '2026-12-10' },
    { t: 'Acompte reçu — Théâtre du Rempart', proj: 'Nadia Ferrant Trio', pole: 'Comptabilité', due: '2026-11-20', done: '2026-11-25' },
    { t: 'Envoyer le contrat — Le Préau', proj: 'Orchestre de Minuit', pole: 'Booking', due: '2026-11-18', done: '2026-11-19' },
    { t: 'Plan de feu — Le Hangar Bleu', proj: 'Lune Ardente', pole: 'Production', due: '2026-11-15', done: '2026-11-14' },
    { t: 'Visuels réseaux — La Cale Sèche', proj: 'Frères Cobalt', pole: 'Communication', due: '2026-11-10', done: '2026-11-09' },
    { t: 'Déclaration Movinmotion — octobre', proj: 'Lune Ardente', pole: 'Comptabilité', due: '2026-11-05', done: '2026-11-04' },
    { t: 'Fiche technique validée — Théâtre du Rempart', proj: 'Nadia Ferrant Trio', pole: 'Production', due: '2026-11-02', done: '2026-11-02' },
    { t: 'Devis transport — tournée d’automne', proj: 'Frères Cobalt', pole: 'Production', due: '2026-10-15', done: '2026-10-14' },
  ];

  // Prospection : suivis actifs par statut de MATRICE (PROSPECT_LABEL). « Confirmé » et « Clos » sont des suivis clos (suiviClosed) : hors décompte.
  const SUIVIS_ACTIFS = [
    { k: 'Mailed', l: 'Mail envoyé', n: 23 }, { k: 'Interest', l: 'Intérêt', n: 12 }, { k: 'Option', l: 'Option', n: 6 },
  ];
  // Relances prioritaires : échéance de la tâche de relance du suivi
  const RELANCES = [
    { s: 'Le Grand Kiosque', city: 'Rennes', proj: 'Frères Cobalt', st: 'Mail envoyé', due: '2026-11-23' },
    { s: 'Festival des Marais', city: 'Niort', proj: 'Lune Ardente', st: 'Intérêt', due: '2026-11-26' },
    { s: 'Scène des Remparts', city: 'Vannes', proj: 'Nadia Ferrant Trio', st: 'Option', due: '2026-11-30' },
    { s: 'Café des Rives', city: 'Angers', proj: 'Orchestre de Minuit', st: 'Mail envoyé', due: '2026-12-03' },
  ];

  // Messagerie (boîte du titulaire) : compteurs existants de l'onglet Mails (« Non lus », « À rattacher ») ; « à répondre » n'existe pas
  const MAIL_COUNTS = { unread: 8, link: 3 };
  const MESSAGES = [
    { from: 'Camille Rouet', org: 'Le Grand Kiosque', subj: 'Re : proposition de date en mars', proj: 'Frères Cobalt', at: '09:42', unread: true },
    { from: 'Hugo Ménard', org: 'Théâtre du Rempart', subj: 'Fiche technique et plan de feu', proj: 'Nadia Ferrant Trio', at: '08:15', unread: true },
    { from: 'Inès Carrel', org: 'Festival des Marais', subj: 'Dossier de candidature 2027', proj: 'Lune Ardente', at: 'Hier', unread: false },
    { from: 'Paul Ternier', org: 'Le Hangar Bleu', subj: 'Acompte réglé', proj: 'Lune Ardente', at: 'Hier', unread: false },
    { from: 'Léa Fournel', org: 'La Fabrique Sonore', subj: 'Boucle communication : visuels reçus', proj: 'Frères Cobalt', at: 'mer.', unread: false },
  ];

  // Finances : chiffre d'affaires HT par mois (réalisé, prévisionnel) depuis la création (oct. 2024), exercices du 1er octobre au 30 septembre.
  // Novembre 2026 : réalisé à date (27/11). Montants entièrement fictifs ; la règle de calcul réelle reste à arbitrer.
  const FIN_REAL = [3200, 4100, 6800, 2100, 3900, 5200, 4400, 6100, 8800, 11200, 6900, 2600,   // 2024-2025
    5400, 6900, 9200, 3100, 5600, 6800, 5900, 8400, 10900, 14600, 8100, 3300,                   // 2025-2026
    7400, 8350];                                                                               // 2026-2027 à date
  const FIN_PLAN = [8000, 9600, 11500, 4200, 6300, 7800, 5600, 8200, 12400, 16900, 9100, 3500];   // prévisionnel 2026-2027
  const FIN = {
    start: '2024-10',
    months: FIN_REAL.map((r, i) => ({ real: r, plan: null })).concat(Array(10).fill(0).map(() => ({ real: null, plan: null }))).map((x, i) => i >= 24 ? { ...x, plan: FIN_PLAN[i - 24] } : x),
    // mois en cours par semaine (semaines commençant le lundi) : réalisé à date, prévisionnel
    weeks: [{ d: '2026-11-02', real: 2300, plan: 2400 }, { d: '2026-11-09', real: 1650, plan: 2200 }, { d: '2026-11-16', real: 3100, plan: 2600 },
      { d: '2026-11-23', real: 1300, plan: 1800 }, { d: '2026-11-30', real: null, plan: 600 }],
    n1ToDate: 6100,   // novembre 2025, du 1er au 27
    // encaissements au 27/11, TTC ; l'échu non soldé est COMPRIS dans le reste à encaisser (jamais additionné)
    encaisse: 24180, aEncaisser: 42850, echu: 8240, echuN: 5,
  };

  const MONTHS = ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.'];

  const NOTIFS = [
    { icon: 'triangle-alert', t: 'Contrat signé non reçu', b: 'Théâtre du Rempart · Nadia Ferrant Trio · échéance dépassée', when: 'Aujourd’hui, 6 h' },
    { icon: 'clock', t: 'Facture de solde à préparer', b: 'Le Hangar Bleu · concert le 28/11', when: 'Aujourd’hui, 6 h' },
    { icon: 'mail', t: 'Boucle communication à envoyer', b: 'La Fabrique Sonore · J-70', when: 'Hier' },
  ];

  const CONTACTS = ['Camille Rouet — Le Grand Kiosque', 'Hugo Ménard — Théâtre du Rempart', 'Inès Carrel — Festival des Marais', 'Paul Ternier — Le Hangar Bleu'];
  const STRUCTURES = ['Le Hangar Bleu', 'La Cale Sèche', 'Théâtre du Rempart', 'Le Grand Kiosque', 'Festival des Marais', 'La Fabrique Sonore', 'Festival des Tilleuls'];

  return { MODULES, PROFILES, KPIS, BLOCKS, STATUSES, ARTISTS, DATES, TASKS, SUIVIS_ACTIFS, RELANCES, MAIL_COUNTS, MESSAGES, MONTHS, FIN, NOTIFS, CONTACTS, STRUCTURES, TODAY: '2026-11-27' };
})();
