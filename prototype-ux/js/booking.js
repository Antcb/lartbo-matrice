// MATRICE — prototype V7 : écran Booking (données fictives, aucune connexion).
// Référence fonctionnelle lue en lecture seule sur main : js/views/booking.js (liste, carte, trajets, enchaînements, archives),
// js/forms.js (fenêtre de la date, suppression / archivage), js/exports.js (export des dates), js/actions.js (statut, restauration).
// S'enregistre dans window.MX_EXT ; utilise les outils de js/app.js par window.MX au moment du rendu.
(() => {
  'use strict';
  const X = () => window.MX;

  // ───────────────────────── Données fictives
  const PROJECTS = [
    { id: 'lune', name: 'Lune Ardente', active: true }, { id: 'cobalt', name: 'Frères Cobalt', active: true },
    { id: 'nadia', name: 'Nadia Ferrant Trio', active: true }, { id: 'minuit', name: 'Orchestre de Minuit', active: true },
    { id: 'voix', name: 'Les Voix Basses', active: false },
  ];
  const SPECTACLES = [
    { id: 'sp1', p: 'lune', name: 'Tournée Écume', active: true }, { id: 'sp2', p: 'lune', name: 'Jeune public', active: true },
    { id: 'sp3', p: 'cobalt', name: 'Cobalt Live', active: true }, { id: 'sp4', p: 'nadia', name: 'Trio acoustique', active: true },
    { id: 'sp5', p: 'nadia', name: 'Quartet', active: false }, { id: 'sp6', p: 'voix', name: 'Polyphonies', active: true },
  ];
  const CITY = {
    Nantes: [47.218, -1.554, '44', '44000'], Brest: [48.39, -4.486, '29', '29200'], Dijon: [47.322, 5.041, '21', '21000'], Lyon: [45.764, 4.835, '69', '69001'],
    Tours: [47.394, .684, '37', '37000'], Lille: [50.629, 3.057, '59', '59000'], Auch: [43.646, .586, '32', '32000'], Sète: [43.403, 3.693, '34', '34200'],
    Rennes: [48.117, -1.678, '35', '35000'], Niort: [46.323, -.459, '79', '79000'], 'La Rochelle': [46.16, -1.15, '17', '17000'], Angers: [47.478, -.563, '49', '49000'],
    Besançon: [47.238, 6.024, '25', '25000'], Poitiers: [46.58, .34, '86', '86000'], Annecy: [45.899, 6.129, '74', '74000'], Amiens: [49.894, 2.295, '80', '80000'],
    'Clermont-Ferrand': [45.777, 3.087, '63', '63000'], Strasbourg: [48.573, 7.752, '67', '67000'], Bruxelles: [50.85, 4.35, 'BE', '1000'], Rouen: [49.443, 1.099, '76', '76000'],
    Marseille: [43.296, 5.37, '13', '13001'], Limoges: [45.833, 1.261, '87', '87000'], Quimper: [47.996, -4.102, '29', '29000'], Toulouse: [43.604, 1.444, '31', '31000'],
    Paris: [48.857, 2.352, '75', '75011'], Lorient: [47.748, -3.37, '56', '56100'],
  };
  const STRUCTS = [
    ['st1', 'Le Hangar Bleu', 'Nantes'], ['st2', 'La Cale Sèche', 'Brest'], ['st3', 'Théâtre du Rempart', 'Dijon'], ['st4', 'Salle Paul-Verdier', 'Lyon'],
    ['st5', 'Le Préau', 'Tours'], ['st6', 'La Fabrique Sonore', 'Lille'], ['st7', 'Festival des Tilleuls', 'Auch'], ['st8', 'Rencontres du Littoral', 'Sète'],
    ['st9', 'Le Grand Kiosque', 'Rennes'], ['st10', 'Festival des Marais', 'Niort'], ['st11', 'Association Ondes Vives', 'Annecy'], ['st12', 'La Vapeur', 'Dijon'],
    ['st13', 'Le Moulin', 'Besançon'], ['st14', 'Ville de Poitiers — service culture', 'Poitiers'], ['st15', 'Le Rocher', 'Marseille'], ['st16', 'Opéra de Limoges', 'Limoges'],
  ].map(([id, name, city]) => ({ id, name, city }));
  const CONTRACTS = ['Cession', 'Co-Réalisation', 'Production', 'Co-Production', 'N.C'];
  const TICKETING = ['Payant/Prix Libre', 'Gratuit'];
  const STATUSES = () => X().D.STATUSES.map(x => x.s);
  const isOff = s => s === 'Annulée' || s === 'Sans Suite';                 // règle de main (constants.js)
  const CONFIRMED_PROD = ['Confirmée Salle', 'Confirmée Festival'];
  const viaArtbo = s => !['Option Artiste', 'Confirmée Artiste'].includes(s.status);   // cachets confirmés : hors dates de l'artiste seul
  const TODAY = '2026-11-27';

  const show = (id, date, p, sp, venue, st, city, status, contract, fee, o = {}) => {
    const c = CITY[city] || [];
    return { id, date, date_end: null, project_id: p, spectacle_id: sp, venue, structure_id: st, address: '', postal_code: c[3] || '', city, department: c[2] || '',
      venue_is_structure: !!st, lat: c[0] ?? null, lng: c[1] ?? null, status, contract_type: contract, fee_ht: fee, ticketing_type: 'Payant/Prix Libre',
      capacity: null, request_date: null, ticketing_enabled: CONFIRMED_PROD.includes(status), communication_enabled: true, notes: '', ...o };
  };
  const SEED = [
    show('b01', '2026-02-13', 'lune', 'sp1', 'La Vapeur', 'st12', 'Dijon', 'Confirmée Salle', 'Cession', 2600, { capacity: 500, request_date: '2025-10-02', invoiced: true }),
    show('b02', '2026-02-14', 'lune', 'sp1', 'Le Moulin', 'st13', 'Besançon', 'Confirmée Salle', 'Cession', 2400, { capacity: 350, request_date: '2025-10-06', invoiced: true }),
    show('b03', '2026-03-20', 'cobalt', 'sp3', 'Le Grand Kiosque', 'st9', 'Rennes', 'Confirmée Salle', 'Co-Réalisation', 1800, { capacity: 280 }),
    show('b04', '2026-04-11', 'nadia', 'sp4', 'Théâtre Molière', 'st14', 'Poitiers', 'Annulée', 'Cession', 3100, { notes: 'Annulée par la ville (travaux).' }),
    show('b05', '2026-05-29', 'minuit', null, 'Festival Les Ondes', 'st11', 'Annecy', 'Confirmée Festival', 'Cession', 6200, { date_end: '2026-05-31', ticketing_type: 'Gratuit', capacity: 3000, invoiced: true }),
    show('b06', '2026-06-20', 'lune', 'sp2', 'Médiathèque Jean-Moulin', null, 'Amiens', 'Confirmée Salle', 'Cession', 1500, { venue_is_structure: false, remindersSuspended: true }),
    show('b07', '2026-07-18', 'cobalt', 'sp3', 'Festival des Marais', 'st10', 'Niort', 'Confirmée Festival', 'Cession', 3500, { ticketing_type: 'Gratuit', invoiced: true }),
    show('b08', '2026-07-19', 'cobalt', 'sp3', 'Les Nuits de l’Estuaire', null, 'La Rochelle', 'Confirmée Festival', 'Cession', 3800, { ticketing_type: 'Gratuit' }),
    show('b09', '2026-09-26', 'nadia', 'sp4', 'Le Café des Rives', null, 'Angers', 'Sans Suite', 'N.C', null),
    show('d1', '2026-11-28', 'lune', 'sp1', 'Le Hangar Bleu', 'st1', 'Nantes', 'Confirmée Salle', 'Cession', 3200, { capacity: 450, request_date: '2026-06-12', invoiced: true }),
    show('d2', '2026-12-03', 'cobalt', 'sp3', 'La Cale Sèche', 'st2', 'Brest', 'Option Salle', 'Co-Réalisation', 2400, { capacity: 300, request_date: '2026-09-01' }),
    show('d3', '2026-12-05', 'nadia', 'sp4', 'Théâtre du Rempart', 'st3', 'Dijon', 'Confirmée Salle', 'Cession', 4100, { capacity: 620 }),
    show('d4', '2026-12-12', 'lune', 'sp1', 'Salle Paul-Verdier', 'st4', 'Lyon', 'Intérêt Salle', 'N.C', 2800, { request_date: '2026-10-21' }),
    show('b12', '2026-12-18', 'minuit', null, 'Soirée privée — Domaine des Cèdres', null, '', 'Option Artiste', 'Production', null, { venue_is_structure: false }),
    show('b13', '2026-12-19', 'voix', 'sp6', 'Église Saint-Paul', null, 'Strasbourg', 'Option Salle', 'Cession', 1200),
    show('d5', '2027-01-16', 'minuit', null, 'Le Préau', 'st5', 'Tours', 'Confirmée Artiste', 'N.C', null),
    show('b14', '2027-01-29', 'nadia', 'sp4', 'La Péniche', null, 'Lille', 'Option Salle', 'Cession', 2700, { request_date: '2026-10-30' }),
    show('b15', '2027-01-30', 'nadia', 'sp4', 'L’Ancienne Belgique', null, 'Bruxelles', 'Intérêt Salle', 'Cession', 3000, { department: 'BE' }),
    show('d6', '2027-02-06', 'cobalt', 'sp3', 'La Fabrique Sonore', 'st6', 'Lille', 'Confirmée Salle', 'Cession', 2900, { capacity: 380 }),
    show('b16', '2027-02-07', 'cobalt', 'sp3', 'Le 106', null, 'Rouen', 'Option Salle', 'Co-Réalisation', 2200),
    show('b17', '2027-03-12', 'lune', 'sp1', 'Le Rocher', 'st15', 'Marseille', 'Option Salle', 'Cession', 3000),
    show('b18', '2027-03-13', 'lune', 'sp1', 'Le Vauban', null, 'Brest', 'Intérêt Salle', 'Cession', 2600),
    show('b19', '2027-04-02', 'minuit', null, 'Opéra de Limoges', 'st16', 'Limoges', 'Intérêt Salle', 'Cession', 7500),
    show('d7', '2027-07-10', 'nadia', 'sp4', 'Festival des Tilleuls', 'st7', 'Auch', 'Option Festival', 'Cession', 5500, { ticketing_type: 'Gratuit' }),
    show('d8', '2027-07-24', 'lune', 'sp1', 'Rencontres du Littoral', 'st8', 'Sète', 'Intérêt Festival', 'N.C', 4800),
    show('b20', '2027-08-07', 'cobalt', 'sp3', 'Festival des Grèves', null, 'Quimper', 'Option Festival', 'Cession', 4200),
    show('b21', '2027-08-21', 'minuit', null, 'Les Estivales', null, 'Toulouse', 'Sans statut', 'N.C', null),
    // dates archivées (v1.60.3 de main) : hors listes de travail, carte et calendriers ; montants toujours comptés
    show('a1', '2026-10-09', 'lune', 'sp1', 'La Coopérative de Mai', null, 'Clermont-Ferrand', 'Confirmée Salle', 'Cession', 2900,
      { archived_at: '2026-10-20', archived_by: 'Anthony', archived_reason: 'Date reportée en 2027 ; acompte déjà facturé', invoiceAfterArchive: true }),
    show('a2', '2026-03-07', 'cobalt', 'sp3', 'Le Petit Bain', null, 'Paris', 'Option Salle', 'Cession', 1600,
      { archived_at: '2026-02-01', archived_by: 'Chloé', archived_reason: 'Doublon d’une date saisie deux fois' }),
  ];
  // Agendas Google des artistes (lecture seule) : indisponibilités intercalées, « Show » localisés ou à préciser
  const CAL = [
    { id: 'g1', p: 'lune', from: '2026-12-10', to: '2026-12-13', title: 'Résidence de création', show: false },
    { id: 'g2', p: 'cobalt', from: '2027-02-20', to: '2027-02-20', title: 'Show — Café-concert', show: true, city: 'Lorient' },
    { id: 'g3', p: 'nadia', from: '2027-01-05', to: '2027-01-05', title: 'Show — concert privé', show: true, city: '' },
  ];
  const STALE = [{ p: 'minuit', days: 9 }];

  // ───────────────────────── État (le temps de la visite)
  const DB = { shows: SEED.map(x => ({ ...x })) };
  const B = { year: 2026, projects: [], showInactive: false, showCancelled: false, showArchived: false, q: '', pane: 'list', pick: { a: null, b: null },
    mapHidden: new Set(), collapsed: new Set(), open: null, linger: {}, mapPop: null, draft: null, dirty: false, isNew: false };
  const byId = id => DB.shows.find(s => s.id === id);
  const proj = id => PROJECTS.find(p => p.id === id);
  const projName = id => proj(id)?.name || '';
  const struct = id => STRUCTS.find(s => s.id === id);
  const fmtD = iso => iso ? X().day(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const fmtMed = iso => X().day(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const cityLine = s => s.city ? `${s.city}${s.department ? ` (${s.department})` : ''}` : '';
  const locMissing = s => s.lat == null;
  const lingering = id => (B.linger[id] || 0) > Date.now();

  // Filtres de main : année, artistes (inactifs exclus sauf choix), annulées / sans suite masquées sauf choix ou pendant 5 s
  const projOk = id => B.projects.length ? B.projects.includes(id) : (B.showInactive || proj(id)?.active);
  const searchOk = s => { const w = X().norm(B.q).split(/\s+/).filter(Boolean); if (!w.length) return true;
    const hay = X().norm([s.venue, s.city, s.department, projName(s.project_id), struct(s.structure_id)?.name, s.status].join(' ')); return w.every(x => hay.includes(x)); };
  const filtered = ({ archived = false, year = true } = {}) => DB.shows.filter(s => (archived ? true : !s.archived_at) && projOk(s.project_id) && (!year || Number(s.date.slice(0, 4)) === B.year))
    .sort((a, b) => a.date.localeCompare(b.date));
  const visible = () => filtered().filter(s => (B.showCancelled || !isOff(s.status) || lingering(s.id)) && searchOk(s));
  const calRows = () => CAL.filter(c => projOk(c.p) && Number(c.from.slice(0, 4)) === B.year && (!B.q || X().norm(`${c.title} ${projName(c.p)}`).includes(X().norm(B.q))));

  // ───────────────────────── Colonnes du tableau (réorganisables, redimensionnables, masquables, épinglables)
  const COLS = [
    { k: 'date', l: 'Date', w: 138 }, { k: 'venue', l: 'Lieu / festival', w: 262 }, { k: 'city', l: 'Ville', w: 178 }, { k: 'artist', l: 'Artiste', w: 158 },
    { k: 'status', l: 'Statut', w: 188 }, { k: 'fee', l: 'Cachet HT', w: 104, num: true }, { k: 'contract', l: 'Contrat', w: 120 }, { k: 'route', l: 'Trajet', w: 84 },
    { k: 'structure', l: 'Structure', w: 190, hidden: true }, { k: 'spectacle', l: 'Spectacle', w: 150, hidden: true }, { k: 'ticketing', l: 'Billetterie', w: 136, hidden: true },
    { k: 'capacity', l: 'Jauge', w: 84, num: true, hidden: true }, { k: 'request', l: 'Date de la demande', w: 128, hidden: true },
    { k: 'flags', l: 'Ticketing · Communication', w: 176, hidden: true },
  ];
  const colDef = k => COLS.find(c => c.k === k);
  const defLayout = () => ({ order: COLS.map(c => c.k), w: {}, hidden: COLS.filter(c => c.hidden).map(c => c.k), pin: ['date'] });
  const lay = () => { const P = X().P; const L = P.bk && Array.isArray(P.bk.order) ? P.bk : defLayout();
    const order = [...L.order.filter(colDef), ...COLS.map(c => c.k).filter(k => !L.order.includes(k))];
    return { order, w: L.w || {}, hidden: (L.hidden || []).filter(colDef), pin: (L.pin || []).filter(colDef) }; };
  const setLay = L => { X().P.bk = L; X().save(); };
  const layIsDefault = () => X().same(lay(), defLayout());
  const shownCols = () => { const L = lay(); const vis = L.order.filter(k => !L.hidden.includes(k)); return [...vis.filter(k => L.pin.includes(k)), ...vis.filter(k => !L.pin.includes(k))]; };
  const widthOf = k => lay().w[k] || colDef(k).w;

  // ───────────────────────── Rendu
  function stats(){
    const sh = visible().filter(s => !lingering(s.id) || !isOff(s.status));
    const n = k => sh.filter(s => s.status.startsWith(k)).length;
    const conf = l => l.filter(s => s.status.startsWith('Confirmée') && viaArtbo(s)).reduce((a, s) => a + (Number(s.fee_ht) || 0), 0);
    const arch = conf(filtered({ archived: true }).filter(s => s.archived_at)), total = conf(sh) + arch;
    const { esc, NUM } = X();
    return `<dl class="bk-stats" aria-label="Indicateurs ${B.year}">
      <div class="bks"><dt>Intérêts</dt><dd class="bks-v">${n('Intérêt')}</dd></div><div class="bks"><dt>Options</dt><dd class="bks-v">${n('Option')}</dd></div><div class="bks"><dt>Confirmées</dt><dd class="bks-v">${n('Confirmée')}</dd></div>
      <div class="bks bks-fee"><dt>Cachets confirmés</dt><dd class="bks-v">${esc(NUM.format(total))}<span class="u">€</span></dd>${arch ? `<dd class="bk-sub">dont ${esc(NUM.format(arch))} € de dates archivées</dd>` : ''}</div></dl>`;
  }
  const counts = () => ({ off: filtered().filter(s => isOff(s.status)).length, arch: DB.shows.filter(s => s.archived_at && projOk(s.project_id)).length });
  const activeFilters = () => {
    const a = [];
    if (B.q) a.push(['q', `Recherche : « ${B.q} »`]);
    if (B.year !== 2026) a.push(['year', `Année ${B.year}`]);
    B.projects.forEach(id => a.push(['proj:' + id, projName(id)]));
    if (B.showInactive) a.push(['showInactive', 'Artistes inactifs affichés']);
    if (B.showCancelled) a.push(['showCancelled', 'Annulées / sans suite affichées']);
    if (B.showArchived) a.push(['showArchived', 'Dates archivées affichées']);
    if (B.pane === 'map') [...B.mapHidden].forEach(st => a.push(['map:' + st, `Masqué sur la carte : ${st}`]));
    return a;
  };
  // Regroupement du tableau (préférence personnelle) : indépendant des filtres, des colonnes et des indicateurs
  const GROUPS = [['month', 'Mois'], ['artist', 'Artiste'], ['artist-month', 'Artiste puis mois'], ['month-artist', 'Mois puis artiste']];
  const grouping = () => GROUPS.some(([v]) => v === X().P.bkGroup) ? X().P.bkGroup : 'month';
  const groupSel = id => `<label class="bk-grp-l" for="${id}"><span>Regrouper par</span><select class="input bk-sel" id="${id}" data-bk="group">${GROUPS.map(([v, l]) => `<option value="${v}" ${grouping() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const secondary = () => [B.showInactive, B.showCancelled, B.showArchived].filter(Boolean).length;
  function toolbar(){
    const { esc, icon, device } = X(), phone = device() === 'phone', af = activeFilters().filter(([k]) => k !== 'q').length;
    const years = [2025, 2026, 2027, 2028];
    const pane = `<div class="seg bk-pane" role="radiogroup" aria-label="Affichage">${[['list', phone ? 'Liste' : 'Tableau'], ['map', phone ? 'Carte' : 'Carte et trajets']].map(([v, l]) =>
      `<label><input type="radio" name="bkpane" value="${v}" data-bk="pane" ${B.pane === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
    const search = `<label class="bk-search">${icon('search', 'sm')}<input type="search" id="bk-q" value="${esc(B.q)}" placeholder="Lieu, ville, artiste, structure…" aria-label="Rechercher dans les dates" autocomplete="off"></label>`;
    const all = allCollapsed();
    const fold = B.pane === 'list' ? `<button class="btn sm icon ghost bk-foldall" type="button" data-act="bkFoldAll" aria-label="${all ? 'Tout déplier' : 'Tout replier'}" title="${all ? 'Tout déplier' : 'Tout replier'}">${icon(all ? 'chevrons-up-down' : 'chevrons-down-up', 'sm')}</button>` : '';
    if (phone) return `<div class="bk-bar">${search}<div class="bk-bar2">
        <button class="btn sm bk-fbtn" type="button" data-act="bkFilters">${icon('sliders-horizontal', 'sm')}Filtres${af ? `<span class="count">${af}</span>` : ''}</button>${fold}${pane}
        <button class="btn sm icon" type="button" data-act="bkMore" aria-label="Plus d’actions : exporter">${icon('ellipsis', 'sm')}</button>
        <button class="btn sm primary icon" type="button" data-act="bkNew" aria-label="Nouvelle date">${icon('plus', 'sm')}</button></div></div>`;
    const na = B.projects.length, ns = secondary();
    return `<div class="bk-bar"><div class="bk-f">${search}
      <select class="input bk-sel" id="bk-year" data-bk="year" aria-label="Année">${years.map(y => `<option ${y === B.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <button class="chipbtn ${na ? 'on' : ''}" type="button" data-act="bkArtists" aria-haspopup="dialog">Artistes${na ? `<span class="n">${na}</span>` : ''}${icon('chevron-down', 'sm')}</button>
      <button class="chipbtn ${ns ? 'on' : ''}" type="button" data-act="bkMoreFilters" aria-haspopup="dialog">${icon('sliders-horizontal', 'sm')}Affichage${ns ? `<span class="n">${ns}</span>` : ''}${icon('chevron-down', 'sm')}</button></div>
      <div class="bk-v">${B.pane === 'list' ? groupSel('bk-group') + fold : ''}${pane}
      ${B.pane === 'list' ? `<button class="btn sm" type="button" data-act="bkCols" aria-haspopup="dialog">${icon('table-2', 'sm')}Colonnes${layIsDefault() ? '' : '<span class="dot" aria-label="personnalisées"></span>'}</button>` : ''}</div></div>`;
  }
  function moreFiltersPop(btn){
    const c = counts(), sw = (k, label, n) => `<label class="switch" for="bkp-${k}"><span class="txt">${label}${n != null ? ` <span class="hint">${n}</span>` : ''}</span><input type="checkbox" role="switch" id="bkp-${k}" data-bkf="${k}" ${B[k] ? 'checked' : ''}></label>`;
    X().openPop(btn, `<p class="eyebrow">Affichage</p><div class="pop-sw">${sw('showInactive', 'Artistes inactifs')}${sw('showCancelled', 'Annulées / sans suite', c.off)}${sw('showArchived', 'Dates archivées', c.arch)}</div>`, { label: 'Affichage', cls: 'bk-pop bk-mfpop' });
  }
  const activeRow = () => { const a = activeFilters(); if (!a.length) return '';
    const { esc, icon } = X();
    return `<div class="bk-active" aria-label="Filtres actifs">${a.map(([k, l]) => `<button class="fchip" type="button" data-act="bkUnset" data-k="${esc(k)}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)}${icon('x', 'sm')}</button>`).join('')}
      <button class="btn ghost sm" type="button" data-act="bkReset">Réinitialiser les filtres</button></div>`; };
  const staleNotice = () => { const l = STALE.filter(x => projOk(x.p)); if (!l.length) return '';
    return `<p class="bk-notice">${X().icon('calendar-clock', 'sm')}<span>Agenda Google de ${l.map(x => `<b>${X().esc(projName(x.p))}</b> (dernière synchronisation il y a ${x.days} jours)`).join(', ')} : ses indisponibilités récentes peuvent manquer ; une date n’y est jamais considérée comme libre.</span></p>`; };

  function archivedPanel(){
    const { esc, icon } = X();
    const rows = DB.shows.filter(s => s.archived_at && projOk(s.project_id)).sort((a, b) => b.date.localeCompare(a.date));
    if (!B.showArchived || !rows.length) return '';
    return `<section class="bk-arch" aria-labelledby="bk-arch-h"><div class="bk-arch-h"><h2 id="bk-arch-h">${icon('archive', 'sm')}Dates archivées <span class="count">${rows.length}</span></h2>
      <p class="hint">Hors des listes de travail, des relances, de la carte et des calendriers ; fiche publique fermée. Factures, paiements, créances et dettes restent dans les vues financières et les comptes. Ni une annulation (statut inchangé) ni une suppression.</p></div>
      <ul>${rows.map(s => `<li><div class="ar-b"><b>${esc([fmtD(s.date), s.venue, projName(s.project_id)].join(' · '))}</b> <span class="muted">— ${esc(s.status)}</span>
        <span class="hint">Archivée le ${esc(fmtD(s.archived_at))} par ${esc(s.archived_by)} : ${esc(s.archived_reason)}</span>
        ${s.invoiceAfterArchive ? `<span class="warn-l">${icon('triangle-alert', 'sm')}Une facture est arrivée pour cette date (comptée dans les montants) : restaure-la pour la suivre et la relancer.</span>` : ''}</div>
        <button class="btn sm" type="button" data-act="bkRestore" data-id="${s.id}">${icon('rotate-ccw', 'sm')}Restaurer</button></li>`).join('')}</ul></section>`;
  }

  // Groupes (mois, artiste, ou l'un dans l'autre) ; dates toujours chronologiques ; indisponibilités Google comptées à part
  const items = () => [...visible().map(s => ({ d: s.date, p: s.project_id, s })), ...calRows().map(c => ({ d: c.from, p: c.p, c }))]
    .sort((x, y) => x.d.localeCompare(y.d) || (x.s ? 1 : 0) - (y.s ? 1 : 0));
  const monthLabel = m => X().day(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const partsOf = list => { const nd = list.filter(x => x.s).length, nu = list.filter(x => x.c).length;
    return { nd, text: [nd ? `${nd} date${nd > 1 ? 's' : ''}` : 'aucune date', nu ? `${nu} indisponibilité${nu > 1 ? 's' : ''} Google` : ''].filter(Boolean).join(' · ') }; };
  function split(list, by, prefix){
    const map = new Map();
    list.forEach(it => { const k = by === 'month' ? it.d.slice(0, 7) : it.p; if (!map.has(k)) map.set(k, []); map.get(k).push(it); });
    const keys = [...map.keys()].sort((a, b) => by === 'month' ? a.localeCompare(b) : projName(a).localeCompare(projName(b), 'fr'));
    return keys.map(k => ({ key: `${prefix}${by === 'month' ? 'm' : 'a'}:${k}`, kind: by, label: by === 'month' ? monthLabel(k) : projName(k), list: map.get(k), ...partsOf(map.get(k)) }));
  }
  function tree(mode = grouping()){
    const [l1, l2] = mode.split('-');
    return split(items(), l1, '').map(g => ({ ...g, children: l2 ? split(g.list, l2, g.key + '|') : null }));
  }
  const allKeys = () => tree().flatMap(g => [g.key, ...(g.children || []).map(c => c.key)]);
  const allCollapsed = () => { const k = tree().map(g => g.key); return k.length > 0 && k.every(x => B.collapsed.has(x)); };
  const toggleBtn = (g, lvl) => `<button class="grp-t" type="button" data-act="bkGrp" data-k="${X().esc(g.key)}" aria-expanded="${!B.collapsed.has(g.key)}">${X().icon('chevron-down', 'sm grp-chev')}<span class="grp-m ${g.kind === 'artist' ? 'is-a' : ''}">${X().esc(g.label)}</span></button><span class="grp-c">${X().esc(g.text)}</span>`;

  const dayCell = s => { const { esc, day, dWeek } = X();
    return `<span class="bk-day"><b>${String(day(s.date).getDate()).padStart(2, '0')}</b><span>${esc(dWeek(s.date))}.</span></span>${s.date_end && s.date_end !== s.date ? `<span class="bk-end">→ ${esc(fmtMed(s.date_end))}</span>` : ''}`; };
  const statusSel = s => { const { esc, marker } = X();
    return `<span class="bk-stc">${marker(s.status)}<select class="bk-st" data-bkst="${s.id}" aria-label="Statut de la date ${esc(s.venue)}">${STATUSES().map(x => `<option ${x === s.status ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></span>`; };
  const pickBtns = s => `<span class="bk-pick" role="group" aria-label="Calcul de trajet"><button class="pk ${B.pick.a === s.id ? 'on' : ''}" type="button" data-act="bkPick" data-p="a" data-id="${s.id}" aria-pressed="${B.pick.a === s.id}" aria-label="Départ du trajet : ${X().esc(s.venue)}">A</button><button class="pk ${B.pick.b === s.id ? 'on' : ''}" type="button" data-act="bkPick" data-p="b" data-id="${s.id}" aria-pressed="${B.pick.b === s.id}" aria-label="Arrivée du trajet : ${X().esc(s.venue)}">B</button></span>`;
  function cell(k, s){
    const { esc, eur, icon, NUM } = X(), p = proj(s.project_id), sp = SPECTACLES.find(x => x.id === s.spectacle_id);
    switch (k){
      case 'date': return dayCell(s);
      case 'venue': return `<span class="bk-venue">${esc(s.venue)}</span>`;
      case 'city': return locMissing(s) ? `<span class="warn-l">${icon('map-pin', 'sm')}${s.city ? esc(cityLine(s)) + ' · ' : ''}Localisation manquante</span>` : esc(cityLine(s)) || '<span class="muted">—</span>';
      case 'artist': return `${esc(p?.name)}${p && !p.active ? ' <span class="tag">inactif</span>' : ''}`;
      case 'status': return statusSel(s);
      case 'fee': return s.fee_ht ? esc(eur(s.fee_ht)) : '<span class="muted">—</span>';
      case 'contract': return esc(s.contract_type || '—');
      case 'route': return pickBtns(s);
      case 'structure': return esc(struct(s.structure_id)?.name || '') || '<span class="muted">—</span>';
      case 'spectacle': return esc(sp?.name || '') || '<span class="muted">Non précisé</span>';
      case 'ticketing': return esc(s.ticketing_type || '—');
      case 'capacity': return s.capacity ? esc(NUM.format(s.capacity)) : '<span class="muted">—</span>';
      case 'request': return s.request_date ? esc(fmtD(s.request_date)) : '<span class="muted">—</span>';
      case 'flags': return `${s.ticketing_enabled ? 'Ticketing' : '<span class="muted">Ticketing non</span>'} · ${s.communication_enabled ? 'Communication' : '<span class="muted">Communication non</span>'}`;
    }
    return '';
  }
  function rowsHTML(list, cols, L){
    const { esc } = X(); let i = 0;
    return list.map(it => it.s ? `<tr class="bk-row ${i++ % 2 ? 'alt' : ''} ${B.open === it.s.id ? 'sel' : ''} ${isOff(it.s.status) ? 'is-off' : ''} ${lingering(it.s.id) && isOff(it.s.status) ? 'leaving' : ''}" data-id="${it.s.id}" tabindex="0"
        aria-label="${esc(`${X().dLong(it.s.date)}, ${it.s.venue}, ${cityLine(it.s)}, ${projName(it.s.project_id)}, ${it.s.status}`)}">${cols.map(k => `<td class="c-${k} ${colDef(k).num ? 'num' : ''} ${L.pin.includes(k) ? 'pin' : ''}">${cell(k, it.s)}</td>`).join('')}</tr>`
      : calRow(it.c, cols.length)).join('');
  }
  function table(){
    const { esc, icon } = X(), cols = shownCols(), L = lay(), G = tree();
    if (!G.length) return `<div class="bk-empty"><p>Aucune date en ${B.year}${B.q ? ' pour cette recherche' : ''}.</p><button class="btn sm primary" type="button" data-act="bkNew">${icon('plus', 'sm')}Nouvelle date</button></div>`;
    const head = cols.map(k => { const c = colDef(k), pin = L.pin.includes(k);
      return `<th scope="col" class="c-${k} ${c.num ? 'num' : ''} ${pin ? 'pin' : ''}" data-col="${k}" draggable="true" aria-label="${esc(c.l)}${pin ? ' (épinglée)' : ''}">
        <span class="th-in"><span class="th-l">${pin ? icon('pin', 'sm') : ''}${esc(c.l)}</span><button class="th-m" type="button" data-act="bkColMenu" data-col="${k}" aria-label="Options de la colonne ${esc(c.l)}">${icon('ellipsis', 'sm')}</button></span>
        <span class="rs" role="separator" aria-orientation="vertical" tabindex="0" data-rs="${k}" aria-label="Largeur de la colonne ${esc(c.l)}" aria-valuenow="${widthOf(k)}" aria-valuemin="64" aria-valuemax="480"></span></th>`; }).join('');
    const body = G.map(g => { const open = !B.collapsed.has(g.key);
      return `<tbody class="g1 ${open ? '' : 'closed'}"><tr class="grp grp1"><th colspan="${cols.length}" scope="rowgroup"><span class="grp-in">${toggleBtn(g, 1)}</span></th></tr>
        ${!open ? '' : g.children ? g.children.map(c => { const o2 = !B.collapsed.has(c.key);
          return `<tr class="grp grp2"><th colspan="${cols.length}" scope="rowgroup"><span class="grp-in">${toggleBtn(c, 2)}</span></th></tr>${o2 ? rowsHTML(c.list, cols, L) : ''}`; }).join('') : rowsHTML(g.list, cols, L)}</tbody>`; }).join('');
    return `<div class="bk-tw" tabindex="-1"><table class="bkt" aria-label="Dates ${B.year}, regroupées par ${GROUPS.find(([v]) => v === grouping())[1].toLowerCase()}"><colgroup>${cols.map(k => `<col data-col="${k}">`).join('')}</colgroup><thead><tr>${head}</tr></thead>${body}</table></div>`;
  }
  function calRow(c, span){
    const { esc, icon, dWeek } = X();
    const inner = `<span class="bk-day"><b>${c.from.slice(8)}</b><span>${esc(dWeek(c.from))}.</span></span><span class="cal-b"><b>${esc(c.title)}</b>
      <span class="hint">${c.show ? 'Date artiste — calendrier Google' : 'Indisponibilité — agenda Google'} · ${esc(projName(c.p))}${c.to !== c.from ? ` · jusqu’au ${esc(fmtMed(c.to))}` : ''} · lecture seule</span></span>
      ${c.show ? `<button class="btn ghost sm" type="button" data-act="bkCalAssoc" data-id="${c.id}">Associer à une date</button>` : ''}<span class="tag">${icon('calendar-days', 'sm')}Google</span>`;
    return span ? `<tr class="bk-cal"><td colspan="${span}"><span class="cal-in">${inner}</span></td></tr>` : `<div class="bkm-cal">${inner}</div>`;
  }

  // iPhone : liste compacte regroupée comme le tableau (groupes et sous-groupes repliables)
  function phoneRows(list){
    const { esc, icon, eur, marker } = X();
    return list.map(it => { if (it.c) return calRow(it.c, 0); const s = it.s;
      return `<div class="bkm-row ${B.open === s.id ? 'sel' : ''} ${isOff(s.status) ? 'is-off' : ''} ${lingering(s.id) && isOff(s.status) ? 'leaving' : ''}">
        <button class="bkm-main" type="button" data-act="bkOpen" data-id="${s.id}" aria-label="${esc(`${X().dLong(s.date)}, ${s.venue}, ${cityLine(s)}, ${projName(s.project_id)}, ${s.status}. Ouvrir la date`)}">
          ${dayCell(s)}<span class="bkm-b" aria-hidden="true"><span class="bkm-l1"><b>${esc(s.venue)}</b></span>
          <span class="bkm-l2">${esc([cityLine(s) || 'Localisation manquante', projName(s.project_id)].join(' · '))}</span>
          <span class="bkm-l3"><span class="st">${marker(s.status)}<span>${esc(s.status)}</span></span><span class="mono">${esc([s.fee_ht ? eur(s.fee_ht) : '', s.contract_type].filter(Boolean).join(' · '))}</span></span></span></button>
        <button class="bkm-more" type="button" data-act="bkRowMenu" data-id="${s.id}" aria-label="Actions rapides : ${esc(s.venue)}">${icon('ellipsis', 'sm')}</button></div>`; }).join('');
  }
  function phoneList(){
    const G = tree();
    if (!G.length) return `<div class="bk-empty"><p>Aucune date en ${B.year}.</p></div>`;
    return `<div class="bkm">${G.map(g => { const open = !B.collapsed.has(g.key);
      return `<section class="bkm-g ${open ? '' : 'closed'}"><div class="bkm-gh">${toggleBtn(g, 1)}</div>
        ${!open ? '' : g.children ? g.children.map(c => { const o2 = !B.collapsed.has(c.key); return `<div class="bkm-sh">${toggleBtn(c, 2)}</div>${o2 ? phoneRows(c.list) : ''}`; }).join('') : phoneRows(g.list)}</section>`; }).join('')}</div>`;
  }

  // ───────────────────────── Carte et trajets (simulés : fond de carte schématique, distances estimées)
  const OUTLINE = [[51.05, 2.37], [50.35, 4.1], [49.99, 4.8], [49.5, 5.9], [49.45, 6.6], [48.97, 8.2], [48.5, 7.8], [47.6, 7.6], [47.4, 7], [46.55, 6.1], [46.2, 6.1], [45.9, 6.9], [45.15, 6.9],
    [44.4, 6.9], [43.8, 7.5], [43.55, 7.05], [43.1, 6.2], [43.3, 5.35], [43.45, 4.7], [43.4, 3.6], [42.95, 3.05], [42.45, 3.17], [42.45, 2.4], [42.75, 1.7], [42.8, .7], [42.95, -.5],
    [43.3, -1.75], [43.65, -1.45], [44.6, -1.25], [45.6, -1.2], [46.15, -1.25], [46.65, -1.8], [47.25, -2.2], [47.5, -2.6], [47.7, -3.4], [47.8, -4.3], [48.05, -4.7], [48.4, -4.8],
    [48.65, -4.3], [48.75, -3.2], [48.55, -2.4], [48.65, -1.8], [48.65, -1.55], [49, -1.6], [49.65, -1.85], [49.6, -1.3], [49.35, -1.1], [49.35, -.25], [49.45, .1], [49.95, 1.1],
    [50.2, 1.6], [50.7, 1.6], [51.05, 2.37]];
  const PRJ = { lat0: 51.4, lat1: 42.2, lng0: -5.2, lng1: 8.6, k: Math.cos(46.5 * Math.PI / 180) };
  const MW = (PRJ.lng1 - PRJ.lng0) * PRJ.k, MH = PRJ.lat0 - PRJ.lat1;
  const px = (lat, lng) => [((lng - PRJ.lng0) * PRJ.k) / MW * 100, (PRJ.lat0 - lat) / MH * 100];
  const hav = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dg = r(b.lng - a.lng);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const route = (a, b) => { if (locMissing(a) || locMissing(b)) return { error: 'Localisation manquante' };
    const km = Math.round(hav(a, b) * 1.25), m = Math.round(km / 85 * 60); return { km, time: `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` }; };
  const daysBetween = (a, b) => Math.round((X().day(b) - X().day(a)) / 864e5);
  function chains(list){
    const out = [], by = {};
    list.filter(s => !isOff(s.status) && !locMissing(s)).forEach(s => (by[s.project_id] ||= []).push(s));
    Object.values(by).forEach(l => { l.sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < l.length; i++){ const a = l[i - 1], b = l[i], gap = daysBetween(a.date_end || a.date, b.date); if (gap >= 0 && gap <= 2) out.push({ a, b, gap }); } });
    return out.sort((x, y) => x.a.date.localeCompare(y.a.date));
  }
  function mapView(){
    const { esc, icon, marker, device, eur } = X(), sh = visible(), phone = device() === 'phone';
    const pts = sh.filter(s => !B.mapHidden.has(s.status) && !locMissing(s));
    const a = byId(B.pick.a), b = byId(B.pick.b);
    const line = a && b && !locMissing(a) && !locMissing(b) ? `<line class="rt" data-a="${a.lat},${a.lng}" data-b="${b.lat},${b.lng}"/>` : '';
    const gcal = calRows().filter(c => c.show && c.city && CITY[c.city]), toLocate = calRows().filter(c => c.show && !(c.city && CITY[c.city]));
    const pop = B.mapPop && byId(B.mapPop);
    const map = `<div class="bk-map" role="region" aria-label="Carte des dates (fond schématique du prototype)">
      <svg class="bk-land" aria-hidden="true"><polygon/>${line}</svg>
      ${pts.map((s, i) => { const same = pts.slice(0, i).filter(o => o.lat === s.lat && o.lng === s.lng).length;   // dates au même lieu : repères décalés pour rester cliquables
        const big = s.status.startsWith('Confirmée');
        return `<button class="mpt ${big ? 'big' : ''} ${B.pick.a === s.id || B.pick.b === s.id ? 'picked' : ''} ${B.mapPop === s.id ? 'on' : ''}" type="button" data-act="bkMapPt" data-id="${s.id}" data-ll="${s.lat},${s.lng}" data-dx="${same * 22}"
          aria-label="${esc(`${fmtMed(s.date)}, ${s.venue}, ${s.city}, ${s.status}`)}">${marker(s.status, big ? 18 : 14)}${B.pick.a === s.id ? '<i class="pk-l">A</i>' : B.pick.b === s.id ? '<i class="pk-l">B</i>' : ''}</button>`; }).join('')}
      ${gcal.map(c => { const [la, ln] = CITY[c.city]; return `<span class="mpt gcal" data-ll="${la},${ln}" title="${esc(`${c.title} · ${projName(c.p)} · calendrier Google`)}" role="img" aria-label="${esc(`Date artiste — calendrier Google : ${c.title}, ${c.city}`)}"></span>`; }).join('')}
      ${pop ? `<div class="mpop" role="dialog" aria-label="${esc(pop.venue)}" data-ll="${pop.lat},${pop.lng}">
        <button class="btn ghost sm icon mpop-x" type="button" data-act="bkMapClose" aria-label="Fermer">${icon('x', 'sm')}</button>
        <b>${esc(pop.venue)}</b><span>${esc(X().dLong(pop.date))} — ${esc(pop.city)}</span><span class="st">${marker(pop.status)}<span>${esc(pop.status)}</span></span>
        <span class="hint">${esc(projName(pop.project_id))}${pop.fee_ht ? ' · ' + esc(eur(pop.fee_ht)) : ''}</span>
        <span class="mpop-a"><button class="btn sm ${B.pick.a === pop.id ? 'on' : ''}" type="button" data-act="bkPick" data-p="a" data-id="${pop.id}" aria-pressed="${B.pick.a === pop.id}">Départ (A)</button><button class="btn sm ${B.pick.b === pop.id ? 'on' : ''}" type="button" data-act="bkPick" data-p="b" data-id="${pop.id}" aria-pressed="${B.pick.b === pop.id}">Arrivée (B)</button>
        <button class="btn sm" type="button" data-act="bkOpen" data-id="${pop.id}">Ouvrir</button></span></div>` : ''}
      <span class="bk-map-note">Fond schématique du prototype · carte OpenStreetMap dans MATRICE</span></div>`;
    const st = STATUSES().filter(x => sh.some(s => s.status === x));
    const legend = `<div class="bk-legend" role="group" aria-label="Statuts affichés sur la carte">${st.map(x => { const off = B.mapHidden.has(x), n = sh.filter(s => s.status === x).length;
      return `<button class="lg-chip ${off ? 'off' : ''}" type="button" data-act="bkMapSt" data-st="${esc(x)}" aria-pressed="${!off}" title="${off ? 'Afficher' : 'Masquer'} sur la carte">${marker(x)}<span>${esc(x)}</span><span class="n">${n}</span></button>`; }).join('')}
      ${B.mapHidden.size ? '<button class="btn ghost sm" type="button" data-act="bkMapAll">Tout afficher</button>' : ''}</div>
      ${gcal.length || toLocate.length ? `<p class="bk-cal-l"><span class="gdot" aria-hidden="true"></span>Date artiste — calendrier Google (${gcal.length})${toLocate.length ? ` · <span class="warn-l">Localisation à préciser : ${toLocate.map(c => esc(`${fmtMed(c.from)} ${c.title}`)).join(' · ')}</span>` : ''}</p>` : ''}`;
    const r = a && b ? route(a, b) : null, ch = chains(sh), multi = new Set(sh.map(s => s.project_id)).size > 1;
    const routeBox = `<section class="bk-route" aria-labelledby="bk-rt-h"><h3 id="bk-rt-h">${icon('route', 'sm')}Trajet</h3>
      ${a || b ? `<dl class="rt-ab"><dt>A</dt><dd>${a ? `${esc(a.venue)} <span class="muted">${esc(a.city)}</span>` : '—'}</dd><dt>B</dt><dd>${b ? `${esc(b.venue)} <span class="muted">${esc(b.city)}</span>` : '—'}</dd></dl>
        ${r ? `<p class="rt-res">${r.error ? `<span class="muted">${esc(r.error)}</span>` : `<b class="mono">${X().NUM.format(r.km)} km</b> · ${esc(r.time)} de route <span class="hint">(estimation simulée)</span>`}</p>` : ''}
        <button class="btn ghost sm" type="button" data-act="bkPickClear">Effacer</button>`
      : '<p class="hint">Choisis un départ (A) puis une arrivée (B) sur deux dates pour la distance et le temps de route.</p>'}
      <details class="rt-ch"><summary>Enchaînements <span class="count">${ch.length}</span></summary>${ch.length ? `<ul>${ch.map(({ a: x, b: y, gap }) => { const rr = route(x, y);
        return `<li><span>${esc(`${fmtMed(x.date)} ${x.city} → ${fmtMed(y.date)} ${y.city}`)}</span><span class="km ${!rr.error && gap <= 1 && rr.km > 600 ? 'long' : ''}">${rr.error ? '—' : `${X().NUM.format(rr.km)} km · ${rr.time}`}${gap === 2 ? ' · 1 jour off' : gap === 0 ? ' · même jour' : ''}${!rr.error && gap <= 1 && rr.km > 600 ? ` ${icon('triangle-alert', 'sm')}<span class="sr">trajet long</span>` : ''}</span>${multi ? `<span class="hint">${esc(projName(x.project_id))}</span>` : ''}</li>`; }).join('')}</ul>`
        : '<p class="hint">Aucune date qui se suit (au plus un jour off) sur cette période.</p>'}</details></section>`;
    const list = `<div class="bk-mlist" aria-label="Dates">${tree('month').map(g => `<p class="eyebrow">${esc(g.label)}</p>${g.list.filter(x => x.s).map(({ s }) =>
      `<div class="bk-mrow ${B.open === s.id ? 'sel' : ''}" data-id="${s.id}"><button class="bk-mrow-b" type="button" data-act="bkOpen" data-id="${s.id}">${dayCell(s)}<span class="bkm-b"><b>${esc(s.venue)}</b><span class="hint">${esc([cityLine(s) || 'Localisation manquante', projName(s.project_id)].join(' · '))}</span><span class="st">${marker(s.status)}<span>${esc(s.status)}</span></span></span></button>${pickBtns(s)}</div>`).join('')}`).join('')}</div>`;
    return phone ? `<div class="bk-mapv">${map}${legend}${routeBox}</div>` : `<div class="bk-mapv">${list}<div class="bk-mapc">${map}${legend}${routeBox}</div></div>`;
  }

  function placeMap(el){
    const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
    const pad = 24, sc = Math.min((W - pad * 2) / MW, (H - pad * 2) / MH), ox = (W - MW * sc) / 2, oy = (H - MH * sc) / 2;
    const P2 = (lat, lng) => [ox + (lng - PRJ.lng0) * PRJ.k * sc, oy + (PRJ.lat0 - lat) * sc];
    const svg = X().$('.bk-land', el); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    X().$('polygon', svg).setAttribute('points', OUTLINE.map(([la, ln]) => P2(la, ln).map(v => v.toFixed(1)).join(',')).join(' '));
    const rt = X().$('.rt', svg); if (rt){ const [a1, a2] = rt.dataset.a.split(',').map(Number), [b1, b2] = rt.dataset.b.split(',').map(Number), A = P2(a1, a2), Bp = P2(b1, b2);
      rt.setAttribute('x1', A[0]); rt.setAttribute('y1', A[1]); rt.setAttribute('x2', Bp[0]); rt.setAttribute('y2', Bp[1]); }
    X().$$('[data-ll]', el).forEach(m => { const [la, ln] = m.dataset.ll.split(',').map(Number), [x, y] = P2(la, ln); m.style.left = (x + Number(m.dataset.dx || 0)) + 'px'; m.style.top = y + 'px'; });
  }
  let mapRO = null;
  // ───────────────────────── Page
  function page(){
    const { pageHead, D, esc, device } = X(), t = { ...D.MODULES.flatMap(m => m.tabs.map(x => ({ ...x, module: m }))).find(x => x.id === 'booking') };
    const acts = device() === 'phone' ? '' : `<button class="btn sm" type="button" data-act="bkExport">${X().icon('download', 'sm')}Exporter</button><button class="btn sm primary" type="button" data-act="bkNew">${X().icon('plus', 'sm')}Nouvelle date</button>`;
    return pageHead(t, { acts })
      + stats() + toolbar() + activeRow() + staleNotice() + archivedPanel()
      + (B.pane === 'map' ? mapView() : device() === 'phone' ? phoneList() : table());
  }
  function after(main){
    // largeurs des colonnes et décalage des colonnes épinglées (JS : aucune valeur de style dans le HTML)
    const L = lay(), cols = shownCols();
    X().$$('col[data-col]', main).forEach(c => { c.style.width = widthOf(c.dataset.col) + 'px'; });
    const tbl = X().$('.bkt', main); if (tbl) tbl.style.width = cols.reduce((a, k) => a + widthOf(k), 0) + 'px';
    let left = 0; cols.filter(k => L.pin.includes(k)).forEach((k, i, arr) => { X().$$(`.bkt .c-${k}.pin`, main).forEach(el => { el.style.left = left + 'px'; el.classList.toggle('pin-last', i === arr.length - 1); }); left += widthOf(k); });
    X().$$('.bk-map', main).forEach(placeMap);
    if (mapRO) mapRO.disconnect(); const mp = X().$('.bk-map', main); if (mp){ mapRO = new ResizeObserver(() => placeMap(mp)); mapRO.observe(mp); }
    const tw = X().$('.bk-tw', main); if (tw){ const upd = () => tw.classList.toggle('scrolled', tw.scrollLeft > 0); tw.addEventListener('scroll', upd, { passive: true }); upd(); }
  }

  // ───────────────────────── Fiche : consultation et modification d'une date (panneau sur Mac, plein écran sur iPhone)
  const spectacleOpts = (pid, cur) => { const list = SPECTACLES.filter(x => x.p === pid && (x.active || x.id === cur));
    return [['', list.length ? '— choisir le spectacle —' : 'Non précisé (aucun spectacle pour cet artiste)'], ...list.map(x => [x.id, x.name + (x.active ? '' : ' (inactif)')])]; };
  const defaultSpectacle = pid => { const l = SPECTACLES.filter(x => x.p === pid && x.active); return l.length === 1 ? l[0].id : (l[0]?.id || ''); };
  function form(s){
    const { esc, icon } = X(), id = s.id && !B.isNew;
    const f = (k, label, input, cls = '') => `<label class="field ${cls}" for="bf-${k}"><span>${label}</span>${input}</label>`;
    const txt = (k, o = {}) => `<input class="input ${o.num ? 'num' : ''}" id="bf-${k}" name="${k}" type="${o.type || 'text'}" value="${esc(s[k] ?? '')}" ${o.list ? `list="${o.list}"` : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.req ? 'required aria-required="true"' : ''} ${o.num ? 'inputmode="decimal"' : ''} autocomplete="off">`;
    const sel = (k, opts, cur) => `<select class="input" id="bf-${k}" name="${k}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    const chk = (k, label) => `<label class="chk" for="bf-${k}"><input type="checkbox" id="bf-${k}" name="${k}" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`;
    const projOpts = [['', '— choisir l’artiste —'], ...PROJECTS.filter(p => p.active || p.id === s.project_id).map(p => [p.id, p.name + (p.active ? '' : ' (inactif)')])];
    const stName = struct(s.structure_id)?.name || '';
    return `<form class="bk-form" id="bk-form" novalidate>
      <datalist id="dl-struct">${STRUCTS.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist><datalist id="dl-venue">${[...new Set(DB.shows.map(x => x.venue))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <fieldset><legend>Lieu</legend>
        ${f('structure', 'Structure (salle, festival, organisateur)', `<input class="input" id="bf-structure" name="structure" value="${esc(stName)}" list="dl-struct" autocomplete="off" placeholder="Choisir ou créer une structure">`, 'full')}
        ${id && s.structure_id ? `<button class="btn ghost sm full" type="button" data-act="bkStruct">${icon('building-2', 'sm')}Ouvrir la fiche structure et son suivi</button>` : ''}
        ${f('venue', 'Nom du lieu / festival', txt('venue', { list: 'dl-venue', req: true }), 'full')}
      </fieldset>
      <fieldset><legend>Artiste et statut</legend>
        ${f('project_id', 'Artiste', sel('project_id', projOpts, s.project_id))}
        ${f('spectacle_id', 'Spectacle', sel('spectacle_id', spectacleOpts(s.project_id, s.spectacle_id), s.spectacle_id || ''))}
        ${f('status', 'Statut', sel('status', STATUSES(), s.status), 'full')}
        ${f('date', 'Date', txt('date', { type: 'date' }))}${f('date_end', 'Fin (si plusieurs jours)', txt('date_end', { type: 'date' }))}
      </fieldset>
      <fieldset><legend>Adresse du lieu</legend>
        ${f('address', 'Adresse', txt('address', { ph: 'Taper l’adresse du lieu (facultatif)' }), 'full')}
        ${f('postal_code', 'Code postal', txt('postal_code'))}${f('city', 'Ville', txt('city'))}
        ${f('department', 'Département (ou pays)', txt('department', { ph: 'ex. 69, CH, BE' }))}
        ${chk('venue_is_structure', 'Utiliser l’adresse de la structure comme lieu de représentation')}
        <p class="hint full">${locMissing(s) && id ? '<b>Localisation manquante.</b> ' : ''}Sans lieu choisi, adresse propre ou cette case, l’adresse, le code postal et la ville du lieu restent à compléter dans la fiche, le contrat et les mails.</p>
      </fieldset>
      <fieldset><legend>Contrat et billetterie</legend>
        ${f('contract_type', 'Type de contrat', sel('contract_type', [['', '—'], ...CONTRACTS], s.contract_type))}
        ${f('fee_ht', 'Cachet HT (€)', txt('fee_ht', { num: true }))}
        ${f('ticketing_type', 'Billetterie', sel('ticketing_type', [['', '—'], ...TICKETING], s.ticketing_type))}
        ${f('capacity', 'Jauge', txt('capacity', { num: true }))}
        ${f('request_date', 'Date de la demande', txt('request_date', { type: 'date' }))}
        ${chk('ticketing_enabled', 'Concernée par le ticketing')}${chk('communication_enabled', 'Concernée par la communication')}
      </fieldset>
      <fieldset><legend>Notes</legend>${f('notes', 'Notes', `<textarea class="input" id="bf-notes" name="notes" rows="3">${esc(s.notes || '')}</textarea>`, 'full')}</fieldset>
      ${id && s.status.startsWith('Confirmée') ? `<div class="bk-drive">${icon('folder', 'sm')}<span>Dossier Drive de la date</span><button class="btn ghost sm" type="button" data-act="bkSim" data-m="Dossier Drive : ouverture non simulée">Ouvrir</button></div>` : ''}
      ${id && s.remindersSuspended ? `<p class="bk-susp">${icon('bell-off', 'sm')}<span>Relances suspendues depuis la restauration de la date ; échéances d’origine intactes.</span><button class="btn sm" type="button" data-act="bkSim" data-m="Réactivation des relances : fenêtre non simulée">Réactiver les relances…</button></p>` : ''}
    </form>`;
  }
  function openShow(id, { isNew = false, prefill = null } = {}){
    const go = () => {
      const s = isNew ? { id: 'n' + Date.now(), status: 'Intérêt Salle', contract_type: 'Cession', project_id: B.projects.length === 1 ? B.projects[0] : '', communication_enabled: true, ticketing_type: '',
        date: '', venue: '', city: '', department: '', postal_code: '', address: '', notes: '', lat: null, lng: null, ...(prefill || {}) } : byId(id);   // prefill : « Poser une date » depuis un suivi
      if (!s) return;
      if (isNew && s.project_id) s.spectacle_id = defaultSpectacle(s.project_id);
      B.open = isNew ? null : id; B.isNew = isNew; B.dirty = false; B.draft = s;
      X().EXT.guard = () => B.dirty;
      const { esc, statusPill, panelShell, openPanel, device, icon } = X();
      const conf = !isNew && CONFIRMED_PROD.includes(s.status) && !s.archived_at;
      const meta = isNew ? '' : `${statusPill(s.status)}<span>${esc([X().dLong(s.date), projName(s.project_id), cityLine(s)].filter(Boolean).join(' · '))}</span>`;
      const foot = `${isNew ? '' : `<button class="btn ghost danger" type="button" data-act="bkDelete">${icon('trash-2', 'sm')}Supprimer…</button>`}<span class="grow"></span>
        <button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="bk-form" data-act="bkSave">${isNew ? 'Créer la date' : 'Enregistrer'}</button>`;
      const links = conf ? `<div class="pnl-links"><a class="btn sm" href="#production" data-go="production">${icon('clapperboard', 'sm')}Ouvrir dans Production</a></div>` : '';
      openPanel('bkdate', panelShell(isNew ? 'Nouvelle date' : s.venue, isNew ? 'Booking' : 'Date', links + form(s), foot, meta), { full: device() === 'phone' });
      X().$$('.bk-row,.bkm-row,.bk-mrow').forEach(r => r.classList.toggle('sel', r.dataset.id === id || r.querySelector?.(`[data-id="${id}"]`) != null));
    };
    if (B.dirty && X().EXT.guard?.()) X().guarded(go); else go();
  }
  const readForm = () => { const f = X().$('#bk-form'); if (!f) return null; const v = {};
    [...f.elements].forEach(el => { if (!el.name) return; v[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); }); return v; };
  async function saveShow(){
    const { toast, askConfirm, $ } = X(), v = readForm(), s = B.draft; if (!v || !s) return;
    const bad = (sel, msg) => { toast(msg, 'triangle-alert'); $(sel)?.focus(); return; };
    if (!v.venue) return bad('#bf-venue', 'Indique le nom du lieu ou du festival');
    if (!v.project_id) return bad('#bf-project_id', 'Choisis l’artiste');
    if (v.spectacle_id && SPECTACLES.find(x => x.id === v.spectacle_id)?.p !== v.project_id) return bad('#bf-spectacle_id', 'Ce spectacle n’est pas celui de cet artiste : choisis-en un autre');
    if (B.isNew && !v.spectacle_id && SPECTACLES.some(x => x.p === v.project_id && x.active)) return bad('#bf-spectacle_id', 'Choisis le spectacle de cette date');
    if (v.date_end && v.date && v.date_end < v.date) return bad('#bf-date_end', 'La fin ne peut pas précéder la date');
    if (!(await calCheck({ ...s, ...v }))) return;
    const before = s.status, oldFee = s.fee_ht, st = STRUCTS.find(x => X().norm(x.name) === X().norm(v.structure || ''));
    const row = { ...s, ...v, structure_id: st?.id || (v.structure ? 'new' : null), fee_ht: v.fee_ht ? Number(String(v.fee_ht).replace(/\s/g, '').replace(',', '.')) : null,
      capacity: v.capacity ? Number(v.capacity) : null, date_end: v.date_end || null };
    delete row.structure;
    const c = CITY[row.city]; if (c && (row.city !== s.city || row.lat == null)){ row.lat = c[0]; row.lng = c[1]; if (!row.department) row.department = c[2]; }
    if (!row.city){ row.lat = row.lng = null; }
    if (B.isNew){ DB.shows.push(row); } else Object.assign(byId(s.id), row);
    if (v.structure && !st) toast(`Structure « ${v.structure} » créée (simulé)`, 'info');
    if (isOff(row.status) && !isOff(before)) linger(row.id);
    B.dirty = false; X().EXT.guard = null;
    const wasNew = B.isNew; X().closePanel({ force: true }); B.open = null; X().renderMain();
    toast(wasNew ? 'Date créée' : isOff(row.status) && !isOff(before) ? `Date passée en « ${row.status} »` : 'Date enregistrée');
    if (!wasNew && Number(row.fee_ht || 0) !== Number(oldFee || 0)) setTimeout(() => toast('Cachet modifié : acompte et solde suivent la règle existante (non simulé)', 'info'), 400);
    if (CONFIRMED_PROD.includes(row.status) && !CONFIRMED_PROD.includes(before)) setTimeout(() => askConfirmation(row), 120);
  }
  function linger(id){ B.linger[id] = Date.now() + 5000; setTimeout(() => { if (X().S.tab === 'booking') X().renderMain(); }, 5100); }
  async function askConfirmation(s){
    const ok = await X().askConfirm('Date confirmée', `${s.venue}${s.city ? ' · ' + s.city : ''} · ${fmtD(s.date)}. Tu veux envoyer la confirmation à l’organisateur maintenant ? Tu valideras d’abord les conditions (cachet, acomptes…), puis le mail. Sinon, le bouton « Envoyer la confirmation » t’attend en haut de la date, dans Production.`, 'Oui, envoyer la confirmation', 'Plus tard');
    if (ok) X().toast('Confirmation : parcours dans Production (non simulé)', 'info');
  }
  // Agenda Google de l'artiste : une date engagée sur un jour indisponible demande confirmation (règle de main, calCheckBeforeSave)
  async function calCheck(v){
    if (!v.date || isOff(v.status)) return true;
    const end = v.date_end || v.date, hit = CAL.find(c => !c.show && c.p === v.project_id && c.from <= end && c.to >= v.date);
    if (!hit) return true;
    return X().askConfirm('Indisponibilité dans l’agenda Google', `${projName(v.project_id)} est indiqué indisponible du ${fmtD(hit.from)} au ${fmtD(hit.to)} (« ${hit.title} »). Enregistrer quand même ?`, 'Enregistrer quand même', 'Revenir à la date');
  }
  // Fenêtre centrale à plusieurs choix (suppression, archivage, restauration)
  function askChoice(title, text, actions, { reason = false } = {}){
    return new Promise(resolve => {
      const { $, esc } = X(), dlg = $('#confirm'), from = document.activeElement;
      dlg.innerHTML = `<div class="box solid"><div class="dlg-head"><h2>${esc(title)}</h2></div><div class="dlg-body">${text.split('\n').map(p => `<p>${esc(p)}</p>`).join('')}
        ${reason ? '<label class="field"><span>Motif (gardé avec la date)</span><textarea class="input" id="ask-reason" rows="2" required aria-required="true"></textarea></label>' : ''}</div>
        <div class="dlg-foot"><button class="btn" type="button" value="">Annuler</button>${actions.map(a => `<button class="btn ${a.danger ? 'danger-solid' : a.plain ? '' : 'primary'}" type="button" value="${esc(a.value)}">${esc(a.label)}</button>`).join('')}</div></div>`;
      const done = v => { dlg.removeEventListener('click', on); X().animatedClose(dlg); if (from?.isConnected) from.focus(); resolve(v); };
      const on = e => { const b = e.target.closest('button[value]'); if (!b) return; if (b.value && reason){ const r = $('#ask-reason').value.trim(); if (!r){ X().toast('Indique le motif', 'triangle-alert'); $('#ask-reason').focus(); return; } done({ v: b.value, reason: r }); return; } done(b.value || null); };
      dlg.addEventListener('click', on); dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); }, { once: true });
      dlg.showModal(); (reason ? $('#ask-reason') : dlg.querySelector('.dlg-foot .btn:last-child')).focus();
    });
  }
  async function deleteShow(){
    const s = B.draft; if (!s || B.isNew) return;
    const name = [fmtD(s.date), s.venue].join(' · ');
    if (s.invoiced){
      const c = await askChoice('Supprimer la date ?', `La date « ${name} » ne peut pas être supprimée : une facture a été émise pour elle.\nTu peux l’archiver à la place : elle sort des listes de travail, des relances, de la carte et des calendriers, et sa fiche publique se ferme. Ses montants restent dans les vues financières et les comptes. Elle reste consultable dans Booking › « Dates archivées ».\nCe n’est ni une annulation (son statut ne change pas) ni une suppression. Rien n’est modifié ni supprimé dans Pennylane.`,
        [{ value: 'archive', label: 'Archiver la date' }]);
      if (c === 'archive') return archive(s);
      return;
    }
    const c = await askChoice('Supprimer la date ?', `Supprimer la date « ${name} » ?\nSupprimées avec elle : 2 lignes de facturation (aucune émise) et 3 lignes de budget (valeurs fictives).\nConservée : 1 tâche liée, détachée de la date, avec la mention « Date supprimée le … » en tête de sa note.\nUne copie complète de la date est gardée dans le journal des suppressions. Rien n’est supprimé dans Pennylane ; le dossier Google Drive n’est pas touché.`,
      [{ value: 'del', label: 'Supprimer la date', danger: true }]);
    if (c !== 'del') return;
    DB.shows = DB.shows.filter(x => x.id !== s.id); B.dirty = false; X().EXT.guard = null; X().closePanel({ force: true }); B.open = null; X().renderMain();
    X().toast('Date supprimée ; 1 tâche gardée, avec la mention « Date supprimée » dans la note');
  }
  async function archive(s){
    const r = await askChoice('Archiver la date ?', 'La date sort des listes de travail, des relances, de la carte et des calendriers ; sa fiche publique se ferme ; ses montants restent comptés. Son statut ne change pas. Le motif est gardé avec la date.',
      [{ value: 'ok', label: 'Archiver la date' }], { reason: true });
    if (!r) return;
    Object.assign(byId(s.id), { archived_at: TODAY, archived_by: 'Anthony', archived_reason: r.reason });
    B.dirty = false; X().EXT.guard = null; X().closePanel({ force: true }); B.open = null; X().renderMain();
    X().toast('Date archivée : elle reste consultable dans Booking › « Dates archivées »');
  }
  async function restore(id){
    const s = byId(id); if (!s) return;
    const c = await askChoice('Restaurer la date ?', `La date « ${[fmtD(s.date), s.venue].join(' · ')} » revient dans les listes de travail, la carte et les calendriers ; sa fiche publique se rouvre. Ses relances restent suspendues (échéances d’origine intactes) tant qu’elles ne sont pas réactivées.`,
      [{ value: 'keep', label: 'Restaurer, relances suspendues', plain: true }, { value: 'reactivate', label: 'Restaurer et réactiver les relances…' }]);
    if (!c || !(await calCheck({ ...s }))) return;
    Object.assign(s, { archived_at: null, archived_by: null, archived_reason: null, remindersSuspended: c === 'keep' });
    X().renderMain(); X().toast('Date restaurée');
    if (c === 'reactivate') setTimeout(() => X().toast('Réactivation des relances : fenêtre non simulée', 'info'), 400);
  }
  // Changement de statut sur la ligne (tableau, liste iPhone) : mêmes effets que dans la fiche
  async function setStatus(id, v, el){
    const s = byId(id); if (!s || s.status === v) return;
    const before = s.status;
    if (!isOff(v) && !(await calCheck({ ...s, status: v }))){ if (el) el.value = before; return; }
    s.status = v;
    if (isOff(v)){ linger(id); X().renderMain(); X().toast(`Date passée en « ${v} »`); return; }
    X().renderMain(); X().$(`[data-bkst="${id}"]`)?.focus();
    X().toast('Statut enregistré');
    if (CONFIRMED_PROD.includes(v) && !CONFIRMED_PROD.includes(before)) setTimeout(() => askConfirmation(s), 120);
  }

  // ───────────────────────── Filtres (popover artistes sur Mac, plein écran sur iPhone), colonnes, export
  function artistsPop(btn){
    const { esc, openPop } = X();
    openPop(btn, `<p class="eyebrow">Artistes</p><div class="pop-checks">${PROJECTS.filter(p => p.active || B.showInactive || B.projects.includes(p.id)).map(p => `<label class="chk"><input type="checkbox" data-bkproj="${p.id}" ${B.projects.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}${p.active ? '' : ' <span class="tag">inactif</span>'}</span></label>`).join('')}</div>
      <div class="pop-foot"><button class="btn ghost sm" type="button" data-act="bkProjAll">Tous les artistes</button></div>`, { label: 'Artistes', cls: 'bk-pop' });
  }
  function filtersSheet(){
    const { esc, panelShell, openPanel, icon } = X(), c = counts();
    const sw = (k, label, n) => `<label class="switch" for="bkf-${k}"><span class="txt">${label}${n != null ? ` <span class="hint">(${n})</span>` : ''}</span><input type="checkbox" role="switch" id="bkf-${k}" data-bkf="${k}" ${B[k] ? 'checked' : ''}></label>`;
    const body = `<div class="pnl-sec"><h3>Année</h3><div class="seg" role="radiogroup" aria-label="Année">${[2025, 2026, 2027, 2028].map(y => `<label><input type="radio" name="bkfy" value="${y}" data-bkf="year" ${B.year === y ? 'checked' : ''}><span>${y}</span></label>`).join('')}</div></div>
      <div class="pnl-sec"><h3>Artistes</h3><div class="pop-checks">${PROJECTS.filter(p => p.active || B.showInactive || B.projects.includes(p.id)).map(p => `<label class="chk"><input type="checkbox" data-bkproj="${p.id}" ${B.projects.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div></div>
      <div class="pnl-sec"><h3>Regroupement</h3>${groupSel('bkf-group')}</div>
      <div class="pnl-sec"><h3>Affichage</h3>${sw('showInactive', 'Artistes inactifs')}${sw('showCancelled', 'Annulées / sans suite', c.off)}${sw('showArchived', 'Dates archivées', c.arch)}</div>`;
    openPanel('bkfilters', panelShell('Filtres', 'Booking', body, `<button class="btn" type="button" data-act="bkReset">${icon('rotate-ccw', 'sm')}Réinitialiser</button><button class="btn primary" type="button" data-act="closePanel">Afficher ${visible().length} dates</button>`), { full: true });
  }
  const refreshFilters = () => { if (X().S.panel === 'bkfilters'){ const foc = document.activeElement?.id || document.activeElement?.dataset?.bkproj; filtersSheet(); if (foc) (document.getElementById(foc) || X().$(`[data-bkproj="${foc}"]`))?.focus(); } };
  function colsPop(btn){
    const { esc, icon, openPop, defTag } = X(), L = lay();
    openPop(btn, `<div class="pop-head"><b>Colonnes</b>${defTag(layIsDefault())}</div><ul class="col-list">${L.order.map((k, i) => { const c = colDef(k), on = !L.hidden.includes(k), pin = L.pin.includes(k);
      return `<li><label class="chk"><input type="checkbox" data-bkcol="${k}" ${on ? 'checked' : ''}><span>${esc(c.l)}</span></label>
        <button class="btn ghost sm icon" type="button" data-act="bkColMove" data-col="${k}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Déplacer ${esc(c.l)} vers la gauche">${icon('arrow-up', 'sm')}</button>
        <button class="btn ghost sm icon" type="button" data-act="bkColMove" data-col="${k}" data-d="1" ${i === L.order.length - 1 ? 'disabled' : ''} aria-label="Déplacer ${esc(c.l)} vers la droite">${icon('arrow-down', 'sm')}</button>
        <button class="btn ghost sm icon ${pin ? 'on' : ''}" type="button" data-act="bkColPin" data-col="${k}" aria-pressed="${pin}" aria-label="${pin ? 'Désépingler' : 'Épingler'} ${esc(c.l)}">${icon('pin', 'sm')}</button></li>`; }).join('')}</ul>
      <p class="hint">Glisser un en-tête pour le déplacer, tirer son bord pour la largeur (flèches au clavier).</p>
      <div class="pop-foot"><button class="btn sm" type="button" data-act="bkColReset" ${layIsDefault() ? 'disabled' : ''}>${icon('rotate-ccw', 'sm')}Colonnes par défaut</button></div>`, { label: 'Colonnes', cls: 'bk-pop bk-colpop' });
  }
  function colMenu(btn, k){
    const { esc, icon, openPop } = X(), L = lay(), i = shownCols().indexOf(k), c = colDef(k), pin = L.pin.includes(k);
    openPop(btn, `<p class="eyebrow">${esc(c.l)}</p><div class="menu">
      <button type="button" data-act="bkColPin" data-col="${k}">${icon('pin', 'sm')}${pin ? 'Désépingler' : 'Épingler à gauche'}</button>
      <button type="button" data-act="bkColShift" data-col="${k}" data-d="-1" ${i <= 0 ? 'disabled' : ''}>${icon('arrow-left', 'sm')}Déplacer à gauche</button>
      <button type="button" data-act="bkColShift" data-col="${k}" data-d="1" ${i >= shownCols().length - 1 ? 'disabled' : ''}>${icon('arrow-right', 'sm')}Déplacer à droite</button>
      <button type="button" data-act="bkColWidth" data-col="${k}">${icon('rotate-ccw', 'sm')}Largeur par défaut</button>
      ${['date', 'venue'].includes(k) ? '' : `<button type="button" data-act="bkColHide" data-col="${k}">${icon('eye-off', 'sm')}Masquer la colonne</button>`}</div>`, { label: `Colonne ${c.l}`, cls: 'bk-pop' });
  }
  const moveCol = (k, d, list) => { const L = lay(); const vis = list || shownCols(); const j = vis.indexOf(k) + d; if (j < 0 || j >= vis.length) return;
    const other = vis[j], o = L.order.filter(x => x !== k); o.splice(o.indexOf(other) + (d > 0 ? 1 : 0), 0, k); L.order = o; setLay(L); };
  function exportPanel(){
    const { esc, panelShell, openPanel, device } = X();
    const body = `<form class="bk-form" id="bk-exp" novalidate><fieldset><legend>Export des dates</legend>
      <label class="field full" for="ex-p"><span>Artiste</span><select class="input" id="ex-p" name="project"><option value="">— choisir l’artiste —</option>${PROJECTS.map(p => `<option value="${p.id}" ${B.projects.length === 1 && B.projects[0] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field" for="ex-m"><span>Période</span><select class="input" id="ex-m" name="mode"><option value="year">Une année complète</option><option value="range">Des dates précises</option></select></label>
      <label class="field ex-y" for="ex-y"><span>Année</span><select class="input" id="ex-y" name="year">${[2027, 2026, 2025].map(y => `<option ${y === B.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="field ex-r" for="ex-f" hidden><span>Du</span><input class="input" type="date" id="ex-f" name="from"></label><label class="field ex-r" for="ex-t" hidden><span>Au</span><input class="input" type="date" id="ex-t" name="to"></label>
      <div class="field full"><span>Statuts</span><div class="ex-st">${STATUSES().map(x => `<label class="chk"><input type="checkbox" name="st" value="${esc(x)}" ${isOff(x) ? '' : 'checked'}><span>${esc(x)}</span></label>`).join('')}</div></div>
      <label class="chk full"><input type="checkbox" name="price"><span>Inclure les cachets</span></label><label class="chk full"><input type="checkbox" name="structure"><span>Inclure la structure</span></label>
      <label class="field full" for="ex-fmt"><span>Format</span><select class="input" id="ex-fmt" name="format"><option value="xlsx">Excel avec logo L’ArtBoristerie (.xlsx)</option><option value="csv">CSV brut (sans mise en forme)</option></select></label>
      <p class="hint full">Export de la liste de travail : sans les dates archivées.</p></fieldset></form>`;
    openPanel('bkexport', panelShell('Exporter les dates', 'Booking', body, `<button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="button" data-act="bkExportGo">Télécharger</button>`), { full: device() === 'phone' });
  }
  function exportGo(){
    const f = X().$('#bk-exp'); if (!f) return; const g = n => f.elements[n];
    if (!g('project').value){ X().toast('Choisis un artiste', 'triangle-alert'); g('project').focus(); return; }
    const sts = [...f.querySelectorAll('[name="st"]:checked')].map(x => x.value); if (!sts.length){ X().toast('Coche au moins un statut', 'triangle-alert'); return; }
    const range = g('mode').value === 'range', from = range ? g('from').value : `${g('year').value}-01-01`, to = range ? g('to').value : `${g('year').value}-12-31`;
    if (range && (!from || !to)){ X().toast('Indique le début et la fin de la période', 'triangle-alert'); (from ? g('to') : g('from')).focus(); return; }
    const n = DB.shows.filter(s => !s.archived_at && s.project_id === g('project').value && sts.includes(s.status) && s.date >= from && s.date <= to).length;
    X().closePanel({ force: true }); X().toast(`${n} date(s) exportée(s) — fichier non généré dans le prototype`, 'info');
  }
  // iPhone : feuille d'actions rapides (opaque)
  function sheet(html, label){
    let d = X().$('#bk-sheet'); if (!d){ d = document.createElement('dialog'); d.id = 'bk-sheet'; d.className = 'bk-sheet'; document.body.appendChild(d);
      d.addEventListener('click', e => { if (e.target === d) X().animatedClose(d); }); }
    d.setAttribute('aria-label', label); d.innerHTML = `<div class="box solid"><div class="grabber" aria-hidden="true"></div>${html}<button class="btn bk-sh-x" type="button" data-act="bkSheetClose">Fermer</button></div>`;
    if (!d.open) d.showModal(); d.querySelector('button')?.focus();
  }
  function rowMenu(id, level = 0){
    const s = byId(id); if (!s) return; const { esc, icon, marker } = X();
    if (level === 1) return sheet(`<p class="eyebrow">${esc(s.venue)} · statut</p><div class="menu">${STATUSES().map(x => `<button type="button" data-act="bkSetSt" data-id="${id}" data-v="${esc(x)}" aria-pressed="${x === s.status}">${marker(x)}${esc(x)}${x === s.status ? icon('check', 'sm ck') : ''}</button>`).join('')}</div>`, 'Changer le statut');
    sheet(`<p class="eyebrow">${esc(s.venue)} · ${esc(fmtMed(s.date))}</p><div class="menu">
      <button type="button" data-act="bkOpenFromSheet" data-id="${id}">${icon('pencil', 'sm')}Ouvrir et modifier la date</button>
      <button type="button" data-act="bkStMenu" data-id="${id}">${marker(s.status)}Changer le statut<span class="hint">${esc(s.status)}</span></button>
      <button type="button" data-act="bkPick" data-p="a" data-id="${id}" aria-pressed="${B.pick.a === id}">${icon('map-pin', 'sm')}Départ du trajet (A)</button>
      <button type="button" data-act="bkPick" data-p="b" data-id="${id}" aria-pressed="${B.pick.b === id}">${icon('flag', 'sm')}Arrivée du trajet (B)</button>
      ${CONFIRMED_PROD.includes(s.status) ? `<a href="#production" data-go="production">${icon('clapperboard', 'sm')}Ouvrir dans Production</a>` : ''}</div>`, 'Actions rapides');
  }
  const closeSheet = () => { const d = X().$('#bk-sheet'); if (d?.open) X().animatedClose(d); };

  // ───────────────────────── Actions et événements
  const rr = (focusSel) => { X().renderMain(); if (focusSel) X().$(focusSel)?.focus(); };
  const ACTS = {
    bkOpen: b => { closeSheet(); openShow(b.dataset.id); },
    bkOpenFromSheet: b => { closeSheet(); openShow(b.dataset.id); },
    bkNew: () => openShow(null, { isNew: true }),
    bkSave: () => saveShow(),
    bkDelete: () => deleteShow(),
    bkStruct: () => X().toast('Fiche structure et suivi : écran non prototypé', 'info'),
    bkSim: b => X().toast(b.dataset.m, 'info'),
    bkRestore: b => restore(b.dataset.id),
    bkCalAssoc: () => X().toast('Association de l’événement Google à une date : non simulée', 'info'),
    bkGrp: b => { const k = b.dataset.k; B.collapsed.has(k) ? B.collapsed.delete(k) : B.collapsed.add(k); rr(`[data-act="bkGrp"][data-k="${CSS.escape(k)}"]`); },
    bkFoldAll: () => { if (allCollapsed()) B.collapsed.clear(); else allKeys().forEach(k => B.collapsed.add(k)); rr('[data-act="bkFoldAll"]'); },
    bkMoreFilters: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } moreFiltersPop(b); },
    bkToggle: b => { B[b.dataset.k] = !B[b.dataset.k]; rr(`[data-act="bkToggle"][data-k="${b.dataset.k}"]`); },
    bkArtists: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } artistsPop(b); },
    bkProjAll: () => { B.projects = []; X().closePop(); rr('[data-act="bkArtists"]'); refreshFilters(); },
    bkFilters: () => filtersSheet(),
    bkMore: b => { if (X().device() === 'phone') sheet(`<p class="eyebrow">Booking</p><div class="menu"><button type="button" data-act="bkExportSheet">${X().icon('download', 'sm')}Exporter les dates…</button></div>`, 'Plus d’actions'); },
    bkExportSheet: () => { closeSheet(); exportPanel(); },
    bkExport: () => exportPanel(),
    bkExportGo: () => exportGo(),
    bkUnset: b => { const k = b.dataset.k;
      if (k === 'q') B.q = ''; else if (k === 'year') B.year = 2026; else if (k.startsWith('proj:')) B.projects = B.projects.filter(x => x !== k.slice(5));
      else if (k.startsWith('map:')) B.mapHidden.delete(k.slice(4)); else B[k] = false;
      rr('.bk-active .fchip, #bk-q'); },
    bkReset: () => { Object.assign(B, { q: '', year: 2026, projects: [], showInactive: false, showCancelled: false, showArchived: false }); B.mapHidden.clear(); rr('#bk-q'); refreshFilters(); X().toast('Filtres réinitialisés'); },
    bkPick: b => { const p = b.dataset.p, id = b.dataset.id; B.pick[p] = B.pick[p] === id ? null : id; if (B.pick.a && B.pick.a === B.pick.b) B.pick[p === 'a' ? 'b' : 'a'] = null;
      closeSheet(); rr(`[data-act="bkPick"][data-p="${p}"][data-id="${id}"]`);
      const a = byId(B.pick.a), bb = byId(B.pick.b); if (a && bb){ const r = route(a, bb); X().toast(r.error ? `Trajet : ${r.error}` : `Trajet A → B : ${X().NUM.format(r.km)} km · ${r.time} (estimation simulée)`, 'route'); } },
    bkPickClear: () => { B.pick = { a: null, b: null }; rr('#bk-rt-h'); },
    bkMapPt: b => { B.mapPop = B.mapPop === b.dataset.id ? null : b.dataset.id; rr(B.mapPop ? '.mpop .btn' : `[data-act="bkMapPt"][data-id="${b.dataset.id}"]`); },
    bkMapClose: () => { const id = B.mapPop; B.mapPop = null; rr(`[data-act="bkMapPt"][data-id="${id}"]`); },
    bkMapSt: b => { const st = b.dataset.st; B.mapHidden.has(st) ? B.mapHidden.delete(st) : B.mapHidden.add(st); rr(`[data-act="bkMapSt"][data-st="${CSS.escape(st)}"]`); },
    bkMapAll: () => { B.mapHidden.clear(); rr('.lg-chip'); },
    bkRowMenu: b => rowMenu(b.dataset.id),
    bkStMenu: b => rowMenu(b.dataset.id, 1),
    bkSetSt: b => { closeSheet(); setStatus(b.dataset.id, b.dataset.v); },
    bkSheetClose: () => closeSheet(),
    bkCols: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } colsPop(b); },
    bkColMenu: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } colMenu(b, b.dataset.col); },
    bkColPin: b => { const k = b.dataset.col, L = lay(); L.pin = L.pin.includes(k) ? L.pin.filter(x => x !== k) : [...L.pin, k]; setLay(L); reopen(b, k); },
    bkColMove: b => { const L = lay(), k = b.dataset.col, i = L.order.indexOf(k), j = i + Number(b.dataset.d); if (j < 0 || j >= L.order.length) return; [L.order[i], L.order[j]] = [L.order[j], L.order[i]]; setLay(L); reopen(b, k); },
    bkColShift: b => { moveCol(b.dataset.col, Number(b.dataset.d)); X().closePop(); rr(`.bkt th[data-col="${b.dataset.col}"] .th-m`); },
    bkColHide: b => { const L = lay(); L.hidden = [...L.hidden, b.dataset.col]; setLay(L); X().closePop(); rr('[data-act="bkCols"]'); X().toast(`Colonne « ${colDef(b.dataset.col).l} » masquée — Colonnes pour la réafficher`); },
    bkColWidth: b => { const L = lay(); delete L.w[b.dataset.col]; setLay(L); X().closePop(); rr(`.bkt th[data-col="${b.dataset.col}"] .th-m`); },
    bkColReset: () => { X().P.bk = null; X().save(); X().closePop(); rr('[data-act="bkCols"]'); X().toast('Colonnes par défaut rétablies'); },
  };
  // la fenêtre « Colonnes » reste ouverte après un réglage (focus conservé sur la commande utilisée)
  function reopen(b, k){
    const inCols = !!b.closest('.bk-colpop'); X().closePop(); X().renderMain();
    if (inCols){ const btn = X().$('[data-act="bkCols"]'); colsPop(btn); X().$(`.bk-colpop [data-act="${b.dataset.act}"][data-col="${k}"]${b.dataset.d ? `[data-d="${b.dataset.d}"]` : ''}`)?.focus(); }
    else X().$(`.bkt th[data-col="${k}"] .th-m`)?.focus();
  }

  function change(t){
    if (t.dataset.bkst){ setStatus(t.dataset.bkst, t.value, t); return true; }
    if (t.dataset.bk === 'year'){ B.year = Number(t.value); rr('#bk-year'); return true; }
    if (t.dataset.bk === 'group'){ X().P.bkGroup = t.value; X().save(); B.collapsed.clear(); rr(`#${t.id}`); refreshFilters(); return true; }
    if (t.dataset.bk === 'pane'){ B.pane = t.value; B.mapPop = null; rr(`input[name="bkpane"][value="${t.value}"]`); return true; }
    if (t.dataset.bkproj){ const id = t.dataset.bkproj; B.projects = t.checked ? [...B.projects, id] : B.projects.filter(x => x !== id);
      const inPop = !!t.closest('.pop'); X().renderMain(); if (inPop){ artistsPop(X().$('[data-act="bkArtists"]')); X().$(`.pop [data-bkproj="${id}"]`)?.focus(); } refreshFilters(); return true; }
    if (t.dataset.bkf){ const k = t.dataset.bkf, inPop = !!t.closest('.pop'); if (k === 'year') B.year = Number(t.value); else B[k] = t.checked; X().renderMain(); refreshFilters();
      if (inPop){ moreFiltersPop(X().$('[data-act="bkMoreFilters"]')); X().$(`#bkp-${k}`)?.focus(); } return true; }
    if (t.dataset.bkcol){ const L = lay(), k = t.dataset.bkcol; L.hidden = t.checked ? L.hidden.filter(x => x !== k) : [...L.hidden, k]; setLay(L); reopen({ closest: () => true, dataset: { act: 'x' } }, k); X().$(`.bk-colpop [data-bkcol="${k}"]`)?.focus(); return true; }
    if (t.closest?.('#bk-form')){ B.dirty = true;
      if (t.name === 'project_id'){ const sel = X().$('#bf-spectacle_id'), cur = sel.value; sel.innerHTML = spectacleOpts(t.value, null).map(([v, l]) => `<option value="${X().esc(v)}">${X().esc(l)}</option>`).join('');
        if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur; else if (B.isNew) sel.value = defaultSpectacle(t.value); }
      if (t.name === 'structure' && !X().$('#bf-venue').value){ const st = STRUCTS.find(x => x.name === t.value); if (st) X().$('#bf-venue').value = st.name; }
      return true; }
    if (t.closest?.('#bk-exp') && t.name === 'mode'){ const r = t.value === 'range'; X().$$('.ex-r').forEach(e => { e.hidden = !r; }); X().$('.ex-y').hidden = r; return true; }
    return false;
  }
  let qTimer = null;
  function input(t){
    if (t.id === 'bk-q'){ clearTimeout(qTimer); qTimer = setTimeout(() => { B.q = t.value.trim(); const pos = t.selectionStart; X().renderMain(); const q = X().$('#bk-q'); if (q){ q.focus(); q.setSelectionRange(pos, pos); } }, 180); return true; }
    if (t.closest?.('#bk-form')){ B.dirty = true; return true; }
    return false;
  }
  function keydown(e){
    if (X().S.tab !== 'booking') return false;
    const t = e.target;
    if (t.dataset?.rs && ['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)){ e.preventDefault(); const k = t.dataset.rs, L = lay();
      L.w[k] = e.key === 'Home' ? colDef(k).w : Math.max(64, Math.min(480, widthOf(k) + (e.key === 'ArrowRight' ? 16 : -16))); if (e.key === 'Home') delete L.w[k]; setLay(L); rr(`[data-rs="${k}"]`); return true; }
    const row = t.closest?.('.bk-row');
    if (row && t === row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); openShow(row.dataset.id); return true; }
    if (row && t === row && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){ e.preventDefault(); const rows = X().$$('.bk-row'), i = rows.indexOf(row); rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); return true; }
    if (e.key === 'Escape' && X().$('#bk-sheet')?.open){ e.preventDefault(); closeSheet(); return true; }
    if (e.key === 'Escape' && B.mapPop){ ACTS.bkMapClose(); return true; }
    return false;
  }
  // clic sur une ligne du tableau (hors commandes) → fiche dans le panneau ; survol d'une date (carte) → repère grossi
  document.addEventListener('click', e => {
    const row = e.target.closest?.('.bk-row'); if (!row || e.target.closest('select,button,a,input,.rs')) return;
    openShow(row.dataset.id);
  });
  document.addEventListener('submit', e => { if (e.target.id === 'bk-form'){ e.preventDefault(); saveShow(); } });
  document.addEventListener('pointerover', e => { const r = e.target.closest?.('.bk-mrow'); X()?.$$?.('.mpt.hot').forEach(m => m.classList.remove('hot'));
    if (r) X().$(`.mpt[data-id="${r.dataset.id}"]`)?.classList.add('hot'); });
  // redimensionnement à la souris / au doigt
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest?.('.bkt .rs'); if (!h) return; e.preventDefault();
    const k = h.dataset.rs, x0 = e.clientX, w0 = widthOf(k), col = X().$(`.bkt col[data-col="${k}"]`), tbl = X().$('.bkt'), tw0 = tbl.offsetWidth;
    h.setPointerCapture(e.pointerId); h.classList.add('drag');
    const mv = ev => { const w = Math.max(64, Math.min(480, w0 + ev.clientX - x0)); col.style.width = w + 'px'; tbl.style.width = (tw0 + w - w0) + 'px'; h.setAttribute('aria-valuenow', w); };
    const up = ev => { h.removeEventListener('pointermove', mv); h.classList.remove('drag'); const L = lay(); L.w[k] = Math.max(64, Math.min(480, w0 + ev.clientX - x0)); setLay(L); rr(`[data-rs="${k}"]`); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up, { once: true });
  });
  // réorganisation par glisser-déposer des en-têtes (même groupe : épinglées / non épinglées)
  let dragK = null;
  document.addEventListener('dragstart', e => { const th = e.target.closest?.('.bkt th[data-col]'); if (!th) return; dragK = th.dataset.col; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragK); th.classList.add('dragging'); });
  document.addEventListener('dragover', e => { const th = e.target.closest?.('.bkt th[data-col]'); if (!th || !dragK) return; e.preventDefault();
    X().$$('.bkt th.drop-l,.bkt th.drop-r').forEach(x => x.classList.remove('drop-l', 'drop-r')); const r = th.getBoundingClientRect(); th.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-l' : 'drop-r'); });
  document.addEventListener('drop', e => { const th = e.target.closest?.('.bkt th[data-col]'); if (!th || !dragK) return; e.preventDefault();
    const k = th.dataset.col, L = lay(); if (k !== dragK && L.pin.includes(k) === L.pin.includes(dragK)){ const after = th.classList.contains('drop-r'); const o = L.order.filter(x => x !== dragK); o.splice(o.indexOf(k) + (after ? 1 : 0), 0, dragK); L.order = o; setLay(L); }
    dragK = null; X().renderMain(); });
  document.addEventListener('dragend', () => { dragK = null; X()?.$$?.('.bkt th').forEach(x => x.classList.remove('dragging', 'drop-l', 'drop-r')); });

  window.MX_EXT = Object.assign(window.MX_EXT || {}, {
    pages: { ...(window.MX_EXT?.pages || {}), booking: page }, after: { ...(window.MX_EXT?.after || {}), booking: after },
    acts: { ...(window.MX_EXT?.acts || {}), ...ACTS }, change, input, keydown,
    discard: () => { B.dirty = false; B.draft = null; B.isNew = false; if (B.open){ B.open = null; X().$$('.bk-row.sel,.bkm-row.sel,.bk-mrow.sel').forEach(r => r.classList.remove('sel')); } },
  });
  // Partagé avec Suivi (js/suivi.js) et lu par les tests automatisés : mêmes données, mêmes règles, mêmes fenêtres
  window.MATRICE_BOOKING = { DB, B, COLS, CAL, chains, route, hav, PROJECTS, STRUCTS, CITY, SPECTACLES, isOff, byId, proj, projName, struct, fmtD, fmtMed, cityLine, locMissing,
    statusSel, openShow, OUTLINE, PRJ, MW, MH, TODAY };
})();
