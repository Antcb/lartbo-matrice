// MATRICE — prototype V8 : écran Suivi (données fictives, aucune connexion).
// Référence fonctionnelle lue en lecture seule sur main : js/views/suivi.js (liste, fiche du suivi, espace de prospection : dates, date en
// négociation, rayon, carte, planning), js/forms.js (editProspect, exportSuivis), js/actions.js (statut clos ou confirmé, tâches, détacher),
// js/prospection.js (relances, clôture sans réponse, suppression), js/constants.js (PROSPECT, PROSPECT_LABEL, LOG_KINDS), js/selectors.js (suiviClosed).
// Réutilise les données et la fiche de date de Booking (window.MATRICE_BOOKING) ; s'enregistre dans window.MX_EXT.
(() => {
  'use strict';
  const X = () => window.MX, BK = () => window.MATRICE_BOOKING;

  // ───────────────────────── Règles de main
  const PROSPECT = ['Mailed', 'Interest', 'Option', 'Confirmed', 'Closed'];
  const LABEL = { Mailed: 'Mail envoyé', Interest: 'Intérêt', Option: 'Option', Confirmed: 'Confirmé', Closed: 'Clos' };
  const LOG_KINDS = ['Appel', 'Mail', 'RDV', 'Note'];
  const LOG_ICON = { Appel: 'phone', Mail: 'mail', RDV: 'handshake', Note: 'notebook-pen' };
  const suiviClosed = p => p?.status === 'Closed' || p?.status === 'Confirmed';           // selectors.js
  const TODAY = '2026-11-27';

  // ───────────────────────── Données fictives (structures et dates : celles de Booking)
  const EXTRA_ST = [{ id: 'sx1', name: 'Scène des Remparts', city: 'Vannes', lat: 47.658, lng: -2.76, dep: '56', festival: false },
    { id: 'sx2', name: 'Le Café des Rives', city: 'Angers', lat: 47.478, lng: -.563, dep: '49', festival: false }];
  const CONTACTS = {
    st9: [['c1', 'Camille Rouet', 'Programmation', '06 12 34 56 78']], st10: [['c2', 'Julien Barre', 'Direction artistique', '']],
    sx1: [['c3', 'Inès Moreau', 'Programmation', '06 98 76 54 32']], sx2: [['c4', 'Paul Ledoux', 'Gérance', '02 41 00 00 00']],
    st2: [['c5', 'Morgane Le Gall', 'Programmation', '06 11 22 33 44'], ['c6', 'Yann Kerhervé', 'Régie', '']], st4: [['c7', 'Sophie Dariot', 'Programmation', '']],
    st7: [['c8', 'Lucie Fabre', 'Coordination', '06 55 44 33 22']], st8: [['c9', 'Nathan Esposito', 'Direction', '']], st16: [['c10', 'Claire Vigier', 'Administration', '']],
    st15: [['c11', 'Hugo Ménard', 'Programmation', '']], st1: [['c12', 'Léa Garnier', 'Programmation', '']],
  };
  const sp = (id, st, pids, status, o = {}) => ({ id, structure_id: st, project_ids: pids, status, last_contact: null, summary: '', content_md: '', relances: 0,
    mail_sent_at: null, mail_draft: false, place: null, updated_at: '2026-11-01', ...o });
  const SEED = [
    sp('p1', 'st9', ['cobalt'], 'Mailed', { last_contact: '2026-11-13', relances: 1, mail_sent_at: '2026-11-03', updated_at: '2026-11-13',
      summary: '- **Contexte** : Camille Rouet, programmation.\n- **Date visée** : mars 2027, week-end.\n- **Statut actuel** : relance n°1 envoyée le 13/11.\n- **Prochaine action** : relance le 23/11.' }),
    sp('p2', 'st10', ['lune'], 'Interest', { last_contact: '2026-11-16', mail_sent_at: '2026-10-20',
      summary: '- **Contexte** : Julien Barre, direction artistique.\n- **Date visée** : juillet 2027.\n- **Offre financière** : à préciser (cession).\n- **Prochaine action** : rappeler le 26/11.' }),
    sp('p3', 'sx1', ['nadia'], 'Option', { last_contact: '2026-11-20', summary: '- **Date visée** : 6 février 2027, option posée.\n- **Jauge** : 280 places, billetterie payante.\n- **Prochaine action** : retour budget avant le 30/11.' }),
    sp('p4', 'sx2', ['minuit'], 'Mailed', { last_contact: '2026-11-19', relances: 3, mail_sent_at: '2026-10-15', summary: '- **Statut actuel** : trois relances par mail sans réponse.\n- **Prochaine action** : appel le 03/12.' }),
    sp('p5', 'st2', ['cobalt'], 'Option', { last_contact: '2026-11-24', mail_sent_at: '2026-09-01',
      summary: '- **Contexte** : Morgane Le Gall.\n- **Date** : 3 décembre 2026 en option.\n- **Offre financière** : co-réalisation, minimum garanti 2 400 € HT.\n- **Accueil** : catering et hébergement pris en charge.\n- **Prochaine action** : confirmation attendue.' }),
    sp('p6', 'st4', ['lune'], 'Interest', { last_contact: '2026-10-21' }),
    sp('p7', 'st7', ['nadia'], 'Option', { last_contact: '2026-11-08', place: { venue: 'Jardin de l’Évêché', city: 'Auch', lat: 43.646, lng: .586 } }),
    sp('p8', 'st8', ['lune', 'cobalt'], 'Interest', { last_contact: '2026-11-05' }),
    sp('p9', 'st1', ['lune'], 'Confirmed', { last_contact: '2026-06-12' }),
    sp('p10', 'st16', ['minuit'], 'Interest', { last_contact: '2026-11-25', mail_draft: true }),
    sp('p11', 'st15', ['lune'], 'Option', { last_contact: '2026-11-18' }),
    sp('p12', 'st3', ['nadia'], 'Confirmed', { last_contact: '2026-09-30' }),
    sp('p13', 'st14', ['nadia'], 'Closed', { last_contact: '2026-03-02' }),
    sp('p14', 'st5', ['voix'], 'Mailed', { last_contact: '2026-10-02' }),
    sp('p15', 'st6', ['cobalt'], 'Confirmed', { last_contact: '2026-10-28' }),
  ];
  const lg = (id, p, date, kind, who, body, o = {}) => ({ id, prospect_id: p, date, time: o.time || null, kind, contact_name: who, body, mail: kind === 'Mail', draft: false, full: o.full || null, ...o });
  const LOGS = [
    lg('l1', 'p1', '2026-11-13', 'Mail', 'Camille Rouet', '**Relance n°1** (en réponse à « Frères Cobalt — mars 2027 »)', { time: '10:12', full: 'Bonjour Camille,\n\nJe me permets de revenir vers vous au sujet des Frères Cobalt pour mars 2027…\n\nBelle journée,\nAnthony' }),
    lg('l2', 'p1', '2026-11-03', 'Mail', 'Camille Rouet', '**Prospection** — Frères Cobalt, mars 2027', { time: '09:40', full: 'Bonjour Camille,\n\nJe vous propose les Frères Cobalt, en tournée en mars 2027…' }),
    lg('l3', 'p2', '2026-11-16', 'Appel', 'Julien Barre', 'Intéressé par Lune Ardente pour l’édition 2027. Attend la fiche technique et un ordre de prix.'),
    lg('l4', 'p2', '2026-10-20', 'Mail', 'Julien Barre', '**Prospection** — Lune Ardente, été 2027', { time: '16:02' }),
    lg('l5', 'p3', '2026-11-20', 'RDV', 'Inès Moreau', 'Rendez-vous au salon : option posée sur le 6 février ; budget à confirmer par la mairie.'),
    lg('l6', 'p4', '2026-11-19', 'Mail', 'Paul Ledoux', '**Relance n°3** — Orchestre de Minuit', { time: '11:30' }),
    lg('l7', 'p4', '2026-11-19', 'Note', null, '**3 relances par mail sans réponse** (prospection le 15/10, relances les 26/10, 05/11, 19/11) : la prochaine relance se fait par téléphone.'),
    lg('l8', 'p5', '2026-11-24', 'Appel', 'Morgane Le Gall', 'Confirmation attendue la semaine prochaine ; hébergement réservé de leur côté.'),
    lg('l9', 'p5', '2026-09-01', 'Mail', 'Morgane Le Gall', '**Prospection** — Frères Cobalt, décembre 2026', { time: '08:55' }),
    lg('l10', 'p10', '2026-11-25', 'Mail', 'Claire Vigier', '**Prospection** — Orchestre de Minuit, printemps 2027 (brouillon Gmail)', { draft: true, date: null }),
    lg('l11', 'p7', '2026-11-08', 'Mail', 'Lucie Fabre', 'Option posée pour le 10 juillet ; concert dans le jardin de l’Évêché.', { time: '14:20' }),
    lg('l12', 'p11', '2026-11-18', 'Appel', 'Hugo Ménard', 'Option sur le 12 mars ; souhaite une date de repli le 13.'),
  ];
  const FILES = [{ id: 'f1', prospect_id: 'p5', name: 'Contrat de co-réalisation — projet.pdf', date: '2026-11-24', size: '182 Ko' },
    { id: 'f2', prospect_id: 'p3', name: 'Fiche technique Nadia Ferrant Trio.pdf', date: '2026-11-20', size: '640 Ko' }];
  const tk = (id, p, title, deadline, auto, o = {}) => ({ id, prospect_id: p, title, deadline, status: 'To Do', auto_kind: auto, ...o });
  const TASKS = [
    tk('t1', 'p1', 'Relance — Le Grand Kiosque', '2026-11-23', 'relance_mail'), tk('t2', 'p2', 'Rappeler Julien Barre', '2026-11-26', null),
    tk('t3', 'p3', 'Retour budget mairie', '2026-11-30', null), tk('t4', 'p4', 'Relance téléphone — Le Café des Rives', '2026-12-03', 'relance_tel'),
    tk('t5', 'p5', 'Envoyer la fiche technique', '2026-11-28', null), tk('t6', 'p10', 'Relance — Opéra de Limoges', '2026-12-07', 'relance_mail'),
  ];

  // ───────────────────────── État (le temps de la visite)
  const DB = { prospects: SEED.map(x => ({ ...x, project_ids: [...x.project_ids] })), logs: LOGS.map(x => ({ ...x })), files: FILES.map(x => ({ ...x })), tasks: TASKS.map(x => ({ ...x })) };
  const SV = { q: '', status: '', projects: [], showInactive: false, showClosed: false, open: null, linger: {}, drafts: {}, target: undefined, targetFor: null, radius: 200,
    wsProject: null, pane: 'fiche', undo: null, draftSuivi: null, edit: null, dirty: false };
  const byId = id => DB.prospects.find(p => p.id === id);
  const stOf = id => { const s = BK().STRUCTS.find(x => x.id === id); if (s){ const c = BK().CITY[s.city] || []; return { ...s, lat: c[0], lng: c[1], dep: c[2], festival: /festival|rencontres/i.test(s.name) }; } return EXTRA_ST.find(x => x.id === id) || null; };
  const allStructs = () => [...BK().STRUCTS.map(s => stOf(s.id)), ...EXTRA_ST].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const projName = id => BK().projName(id);
  const projNames = p => p.project_ids.map(projName).filter(Boolean).join(', ');
  const logsOf = id => DB.logs.filter(l => l.prospect_id === id).sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999') || (b.time || '').localeCompare(a.time || ''));
  const filesOf = id => DB.files.filter(f => f.prospect_id === id);
  const lastExchange = p => [logsOf(p.id).find(l => l.date)?.date, p.last_contact].filter(Boolean).sort().pop() || null;   // selectors.js
  const lingering = id => (SV.linger[id] || 0) > Date.now();
  const isDone = t => t.status === 'Done' || t.status === 'Cancelled';
  const fmtD = iso => iso ? BK().fmtD(iso) : '';
  const addDays = (iso, n) => { const d = X().day(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const addYear = iso => { const [y, m, d] = iso.split('-').map(Number); const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate(); return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };   // 29/02 + 1 an → 28/02
  const daysBetween = (a, b) => Math.round((X().day(b) - X().day(a)) / 864e5);
  const linger = id => { SV.linger[id] = Date.now() + 5000; setTimeout(() => { if (X().S.tab === 'suivi') X().renderMain(); }, 5050); };
  const sim = m => X().toast(m, 'info');

  // Dates rattachées : liées explicitement, ou même structure et même artiste ; sans les archivées (views/suivi.js showsOfSuivi)
  const showsOfSuivi = p => BK().DB.shows.filter(s => !s.archived_at && (s.prospect_id === p.id || (p.structure_id && s.structure_id === p.structure_id && p.project_ids.includes(s.project_id))))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  // Tâches du suivi : liées ; terminées masquées sauf pendant 5 s ; par échéance
  const suiviTasks = p => DB.tasks.filter(t => t.prospect_id === p.id && (!isDone(t) || lingering(t.id))).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const here = p => p.place ? (p.place.lat != null ? [p.place.lat, p.place.lng] : null) : (st => st && st.lat != null ? [st.lat, st.lng] : null)(stOf(p.structure_id));

  // ───────────────────────── Statut d'un suivi : libellé de main et jauge d'avancement (quatre étapes ; « Clos » hors parcours)
  const stPill = st => { const i = ['Mailed', 'Interest', 'Option', 'Confirmed'].indexOf(st);
    return `<span class="svp ${st === 'Closed' ? 'off' : ''}"><span class="svp-g" aria-hidden="true">${[0, 1, 2, 3].map(k => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</span><span>${X().esc(LABEL[st])}</span></span>`; };
  const stSelect = (p, id = 'sv-status') => `<label class="sv-stsel"><span class="sr">Statut du suivi</span><select class="input" id="${id}" data-svst="${p.id}">${PROSPECT.map(x => `<option value="${x}" ${x === p.status ? 'selected' : ''}>${LABEL[x]}</option>`).join('')}</select></label>`;
  const urgency = t => { if (!t.deadline || isDone(t)) return null; const d = daysBetween(TODAY, t.deadline);
    return d < 0 ? { cls: 'late', l: `En retard de ${-d} j` } : d === 0 ? { cls: 'today', l: 'Aujourd’hui' } : d <= 3 ? { cls: 'soon', l: `Dans ${d} j` } : { cls: '', l: `Le ${BK().fmtMed(t.deadline)}` }; };

  // ───────────────────────── Liste
  const projOk = p => SV.projects.length ? p.project_ids.some(x => SV.projects.includes(x)) : (SV.showInactive || !p.project_ids.length || p.project_ids.some(x => BK().proj(x)?.active));
  function rows(){
    const { norm } = X();
    let l = DB.prospects.filter(p => projOk(p) && (!SV.status || p.status === SV.status));
    const nClosed = SV.status ? 0 : l.filter(p => suiviClosed(p) && !lingering(p.id)).length;
    if (!SV.status && !SV.showClosed) l = l.filter(p => !suiviClosed(p) || lingering(p.id));
    const w = norm(SV.q).split(/\s+/).filter(Boolean);
    if (w.length) l = l.filter(p => { const st = stOf(p.structure_id); const h = norm(`${st?.name || ''} ${st?.city || ''} ${projNames(p)} ${p.summary}`); return w.every(x => h.includes(x)); });
    l = l.map(p => ({ p, last: lastExchange(p) })).sort((a, b) => (b.last || '').localeCompare(a.last || '') || (b.p.updated_at || '').localeCompare(a.p.updated_at || ''));
    return { l, nClosed };
  }
  const plain = t => String(t || '').replace(/\*\*/g, '').replace(/^- /gm, '').replace(/\n/g, ' · ');
  function stats(){
    const act = DB.prospects.filter(p => projOk(p) && !suiviClosed(p));
    const late = DB.tasks.filter(t => !isDone(t) && t.auto_kind && t.deadline < TODAY && act.some(p => p.id === t.prospect_id)).length;
    return `<dl class="bk-stats" aria-label="Suivis actifs"><div class="bks"><dt>Actifs</dt><dd class="bks-v">${act.length}</dd></div>
      ${['Mailed', 'Interest', 'Option'].map(k => `<div class="bks"><dt>${LABEL[k]}</dt><dd class="bks-v">${act.filter(p => p.status === k).length}</dd></div>`).join('')}
      <div class="bks"><dt>Relances en retard</dt><dd class="bks-v ${late ? 'sv-late' : ''}">${late}</dd></div></dl>`;
  }
  function toolbar(nClosed){
    const { esc, icon, device } = X(), phone = device() === 'phone', na = SV.projects.length, ns = [SV.showInactive, SV.showClosed].filter(Boolean).length;
    const search = `<label class="bk-search">${icon('search', 'sm')}<input type="search" id="sv-q" value="${esc(SV.q)}" placeholder="Structure, ville, mot du résumé…" aria-label="Rechercher dans les suivis" autocomplete="off"></label>`;
    const status = `<select class="input bk-sel" id="sv-st" data-sv="status" aria-label="Statut"><option value="">Tous les statuts</option>${PROSPECT.map(x => `<option value="${x}" ${x === SV.status ? 'selected' : ''}>${LABEL[x]}</option>`).join('')}</select>`;
    if (phone) return `<div class="bk-bar">${search}<div class="bk-bar2"><button class="btn sm bk-fbtn" type="button" data-act="svFilters">${icon('sliders-horizontal', 'sm')}Filtres${na + ns + (SV.status ? 1 : 0) ? `<span class="count">${na + ns + (SV.status ? 1 : 0)}</span>` : ''}</button>
      <span class="grow"></span><button class="btn sm icon" type="button" data-act="svExport" aria-label="Exporter les suivis">${icon('download', 'sm')}</button>
      <button class="btn sm primary icon" type="button" data-act="svNew" aria-label="Nouveau suivi">${icon('plus', 'sm')}</button></div></div>`;
    return `<div class="bk-bar"><div class="bk-f">${search}${status}
      <button class="chipbtn ${na ? 'on' : ''}" type="button" data-act="svArtists" aria-haspopup="dialog">Artistes${na ? `<span class="n">${na}</span>` : ''}${icon('chevron-down', 'sm')}</button>
      <button class="chipbtn ${ns ? 'on' : ''}" type="button" data-act="svDisplay" aria-haspopup="dialog">${icon('sliders-horizontal', 'sm')}Affichage${ns ? `<span class="n">${ns}</span>` : ''}${icon('chevron-down', 'sm')}</button></div>
      <div class="bk-v"><span class="hint">${nClosed ? `${nClosed} suivi${nClosed > 1 ? 's' : ''} clos masqué${nClosed > 1 ? 's' : ''}` : ''}</span></div></div>`;
  }
  const activeRow = () => { const { esc, icon } = X(), a = [];
    if (SV.q) a.push(['q', `Recherche : « ${SV.q} »`]); if (SV.status) a.push(['status', `Statut : ${LABEL[SV.status]}`]);
    SV.projects.forEach(id => a.push(['proj:' + id, projName(id)])); if (SV.showInactive) a.push(['showInactive', 'Artistes inactifs affichés']); if (SV.showClosed) a.push(['showClosed', 'Suivis clos affichés']);
    return a.length ? `<div class="bk-active" aria-label="Filtres actifs">${a.map(([k, l]) => `<button class="fchip" type="button" data-act="svUnset" data-k="${esc(k)}" aria-label="Retirer le filtre ${esc(l)}">${esc(l)}${icon('x', 'sm')}</button>`).join('')}
      <button class="btn ghost sm" type="button" data-act="svReset">Réinitialiser les filtres</button></div>` : ''; };
  function listPage(){
    const { pageHead, D, esc, icon, device } = X(), t = { ...D.MODULES.flatMap(m => m.tabs.map(x => ({ ...x, module: m }))).find(x => x.id === 'suivi') };
    const { l, nClosed } = rows(), phone = device() === 'phone';
    const acts = phone ? '' : `<button class="btn sm" type="button" data-act="svExport">${icon('download', 'sm')}Exporter</button><button class="btn sm primary" type="button" data-act="svNew">${icon('plus', 'sm')}Nouveau suivi</button>`;
    const empty = `<div class="bk-empty"><p>Aucun suivi${SV.q || SV.status || SV.projects.length ? ' pour ces filtres' : ''}.</p></div>`;
    const tr = ({ p, last }, i) => { const st = stOf(p.structure_id), nl = logsOf(p.id).length, nf = filesOf(p.id).length;
      return `<tr class="bk-row sv-row ${i % 2 ? 'alt' : ''} ${lingering(p.id) ? 'leaving' : ''}" data-svid="${p.id}" tabindex="0" aria-label="${esc(`${st?.name || 'Suivi sans structure'}, ${projNames(p)}, ${LABEL[p.status]}. Ouvrir le suivi`)}">
        <td class="c-st"><b class="sv-name">${esc(st?.name || 'Sans structure')}</b><span class="sv-sub">${esc([st?.city, st?.dep && `(${st.dep})`].filter(Boolean).join(' '))}</span></td>
        <td>${esc(projNames(p)) || '<span class="muted">—</span>'}</td><td>${stPill(p.status)}</td>
        <td class="mono">${last ? esc(fmtD(last)) : '<span class="muted">—</span>'}</td><td class="num">${nl || ''}</td><td class="num">${nf || ''}</td>
        <td class="sv-sum">${esc(plain(p.summary || p.content_md).slice(0, 200)) || '<span class="muted">—</span>'}</td></tr>`; };
    const table = l.length ? `<div class="bk-tw"><table class="bkt svt" aria-label="Suivis, du dernier échange le plus récent au plus ancien"><colgroup><col class="w-st"><col class="w-a"><col class="w-s"><col class="w-d"><col class="w-n"><col class="w-n"><col></colgroup>
        <thead><tr><th scope="col">Structure</th><th scope="col">Artiste(s)</th><th scope="col">Statut</th><th scope="col">Dernier échange</th><th scope="col" class="num">Journal</th><th scope="col" class="num">Fichiers</th><th scope="col">Résumé</th></tr></thead>
        <tbody>${l.slice(0, 500).map(tr).join('')}</tbody></table></div>` : empty;
    const list = l.length ? `<div class="bkm svm">${l.map(({ p, last }) => { const st = stOf(p.structure_id);
      return `<div class="bkm-row ${lingering(p.id) ? 'leaving' : ''}"><button class="bkm-main" type="button" data-act="svOpen" data-id="${p.id}" aria-label="${esc(`${st?.name || 'Sans structure'}, ${projNames(p)}, ${LABEL[p.status]}. Ouvrir le suivi`)}">
        <span class="bkm-b" aria-hidden="true"><span class="bkm-l1"><b>${esc(st?.name || 'Sans structure')}</b></span><span class="bkm-l2">${esc([st?.city, projNames(p)].filter(Boolean).join(' · '))}</span>
        <span class="bkm-l3">${stPill(p.status)}<span class="mono">${last ? esc(BK().fmtMed(last)) : ''}</span></span></span></button></div>`; }).join('')}</div>` : empty;
    return pageHead(t, { acts }) + stats() + toolbar(nClosed) + activeRow() + undoBar() + (phone ? list : table);
  }
  const undoBar = () => { const u = SV.undo; if (!u || u.until < Date.now()) return '';
    return `<p class="sv-undo" role="status">${X().icon('circle-check', 'sm')}<span>${X().esc(u.msg)}</span><button class="btn sm" type="button" data-act="svUndo">Annuler</button></p>`; };

  // ───────────────────────── Espace de prospection (fiche + dates, carte, planning)
  function wsPage(p){
    const { esc, icon, device } = X(), st = stOf(p.structure_id), phone = device() === 'phone';
    const proj = p.project_ids.includes(SV.wsProject) ? SV.wsProject : p.project_ids[0] || null, linked = showsOfSuivi(p);
    // date en négociation : celle tapée, sinon la prochaine date déjà posée pour ce suivi (views/suivi.js)
    if (SV.target === undefined || SV.targetFor !== p.id){ SV.targetFor = p.id;
      SV.target = (linked.find(s => s.date >= TODAY && !BK().isOff(s.status) && (!proj || s.project_id === proj)) || linked.find(s => !BK().isOff(s.status)))?.date || null; }
    const head = `<div class="sv-top"><button class="btn ghost sm" type="button" data-act="svBack">${icon('arrow-left', 'sm')}Suivi</button></div>
      <div class="page-head"><div class="grow"><h1>${esc(st?.name || 'Nouveau suivi')}</h1><p class="sub"><span>${esc([st?.city, st?.dep && `(${st.dep})`].filter(Boolean).join(' '))}</span><span class="chip">Données fictives</span></p></div>
      <div class="acts">${[st ? ['', 'svSim', 'building-2', 'Fiche structure', 'data-m="Fiche structure : ouverture dans Répertoire (non simulée ici)"'] : null, ['', 'svTaskNew', 'list-checks', 'Nouvelle tâche', ''],
        ['primary', 'svShowNew', 'plus', 'Poser une date', st ? '' : 'disabled title="Choisis d’abord la structure"']].filter(Boolean).map(([c, a, ic, l, x]) =>   // iPhone : icônes seules, nom accessible conservé
          `<button class="btn sm ${c} ${phone ? 'icon' : ''}" type="button" data-act="${a}" ${x} ${phone ? `aria-label="${l}" title="${l}"` : ''}>${icon(ic, 'sm')}${phone ? '' : l}</button>`).join('')}</div></div>`;
    const tabs = phone ? `<div class="seg sv-pane" role="radiogroup" aria-label="Partie du suivi">${[['fiche', 'Échanges'], ['dates', 'Dates et carte']].map(([v, l]) =>
      `<label><input type="radio" name="svpane" value="${v}" data-sv="pane" ${SV.pane === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>` : '';
    const left = `<div class="sv-col">${who(p, st)}${card(p)}</div>`, right = `<div class="sv-col">${side(p, st, proj, linked)}</div>`;
    return head + undoBar() + tabs + `<div class="sv-ws ${phone ? 'is-phone' : ''}">${!phone || SV.pane === 'fiche' ? left : ''}${!phone || SV.pane === 'dates' ? right : ''}</div>`;
  }
  function who(p, st){
    const { esc, icon } = X(), contacts = CONTACTS[p.structure_id] || [];
    const pl = p.place, venues = BK().DB.shows.filter(s => s.lat != null).map(s => `${s.venue} — ${s.city}`);
    return `<section class="sv-card" aria-labelledby="sv-who-h"><h2 class="sv-h" id="sv-who-h">Structure et lieu</h2>
      <div class="sv-grid2"><label class="field"><span>Structure</span><select class="input" id="sv-struct" data-svf="structure"><option value="">Choisir la structure…</option>${allStructs().map(s => `<option value="${s.id}" ${s.id === p.structure_id ? 'selected' : ''}>${esc(s.name)} — ${esc(s.city)}</option>`).join('')}</select></label>
      <div class="field"><span>Contacts de la structure</span><div class="sv-chips">${contacts.map(([id, n, r]) => `<button class="chipbtn" type="button" data-act="svSim" data-m="Fiche contact : ${esc(n)} (non simulée)">${esc(n)}<span class="hint">${esc(r)}</span></button>`).join('')}
        ${st ? `<button class="btn ghost sm" type="button" data-act="svSim" data-m="Nouveau contact : fenêtre non simulée">${icon('plus', 'sm')}Contact</button>` : '<span class="hint">Choisis la structure</span>'}</div></div></div>
      <label class="field"><span>Lieu du concert (si différent de la structure)</span><input class="input" id="sv-place" data-svf="place" list="sv-venues" value="${esc(pl ? pl.venue : '')}" placeholder="Chercher une salle, un festival ou une adresse…" autocomplete="off">
        <datalist id="sv-venues">${[...new Set(venues)].map(v => `<option value="${esc(v)}">`).join('')}</datalist></label>
      ${pl ? `<p class="hint sv-pl">${esc([pl.venue, pl.city].filter(Boolean).join(' · '))}${pl.lat == null ? ` · <span class="warn-l">${icon('map-pin', 'sm')}non localisé : choisis le lieu dans la liste</span>` : ''}
        <button class="btn ghost sm" type="button" data-act="svPlaceClear">Retirer le lieu</button></p>` : '<p class="hint sv-pl">Sans lieu choisi, la carte part de la structure.</p>'}</section>`;
  }
  function mailState(p){
    const { esc } = X();
    const relH = logsOf(p.id).filter(l => /^\*\*Relance n°/.test(l.body) && l.date).map(l => fmtD(l.date)).reverse();
    if (!p.mail_sent_at && !p.mail_draft) return '';
    return `<p class="sv-mail">${X().icon('mail', 'sm')}<span>${p.mail_sent_at ? `Prospection envoyée le ${esc(fmtD(p.mail_sent_at))}` : 'Prospection en brouillon'}${p.relances ? ` · ${p.relances} relance${p.relances > 1 ? 's' : ''}${relH.length ? ` (${esc(relH.join(', '))})` : ''}` : ''}</span>
      ${p.mail_draft ? `<button class="btn sm" type="button" data-act="svSent" data-id="${logsOf(p.id).find(l => l.draft)?.id || ''}">Marquer envoyé</button>` : ''}
      ${suiviClosed(p) ? '' : `<button class="btn sm" type="button" data-act="svSim" data-m="Relance : fenêtre de mail (Gmail) non simulée">Relance</button>`}</p>`;
  }
  function card(p){
    const { esc, icon } = X(), logs = logsOf(p.id), files = filesOf(p.id), tasks = suiviTasks(p), d = SV.drafts[p.id] || {};
    const headRow = `<div class="sv-head"><div class="sv-chips">${p.project_ids.map(id => `<span class="tag">${esc(projName(id))}</span>`).join('')}
        <button class="btn ghost sm" type="button" data-act="svArtistsEdit">${icon('pencil', 'sm')}Artistes</button></div>
      ${stSelect(p)}<span class="hint">Dernier échange : ${lastExchange(p) ? esc(fmtD(lastExchange(p))) : '—'}</span></div>${mailState(p)}`;
    const summary = `<section class="sv-card" aria-labelledby="sv-sum-h"><div class="sv-hrow"><h2 class="sv-h" id="sv-sum-h">Résumé des échanges</h2>
        <button class="btn sm" type="button" data-act="svAi">${icon('sparkles', 'sm')}Mettre à jour avec l’IA</button>
        <button class="btn ghost sm" type="button" data-act="svText" data-f="summary">Modifier</button>
        <button class="btn ghost sm" type="button" data-act="svCopy" title="Copie le suivi pour le coller dans ChatGPT">Copier pour ChatGPT</button></div>
      <div class="sv-md">${md(p.summary) || '<p class="muted">Pas encore de résumé.</p>'}</div></section>`;
    const tasksH = `<section class="sv-card" aria-labelledby="sv-tk-h"><div class="sv-hrow"><h2 class="sv-h" id="sv-tk-h">Tâches <span class="count">${tasks.filter(t => !isDone(t)).length}</span></h2>
        <button class="btn sm" type="button" data-act="svTaskNew">${icon('plus', 'sm')}Nouvelle tâche</button></div>
      ${tasks.length ? `<ul class="sv-tasks">${tasks.map(t => { const u = urgency(t);
        return `<li class="${isDone(t) ? 'done' : ''} ${lingering(t.id) ? 'leaving' : ''}"><label class="sv-tchk"><input type="checkbox" data-svtask="${t.id}" ${isDone(t) ? 'checked' : ''}><span class="sr">Marquer « ${esc(t.title)} » comme faite</span></label>
          <span class="sv-tt"><b>${esc(t.title)}</b>${t.auto_kind ? `<span class="hint">${t.auto_kind === 'relance_tel' ? 'Relance téléphone automatique' : 'Relance automatique'}</span>` : ''}</span>
          ${u ? `<span class="sv-urg ${u.cls}">${esc(u.l)}</span>` : '<span></span>'}
          <span class="sv-ta"><button class="btn ghost sm" type="button" data-act="svTaskEdit" data-id="${t.id}">Détails</button>
          ${t.auto_kind === 'relance_tel' && !isDone(t) && !suiviClosed(p) ? `<button class="btn ghost sm danger" type="button" data-act="svNoAnswer" data-id="${t.id}">Pas de réponse : clore</button>` : ''}</span></li>`; }).join('')}</ul>`
        : '<p class="muted">Aucune tâche liée à ce suivi.</p>'}</section>`;
    const thread = [...logs.map(l => ({ l, at: l.date || '9999' })), ...files.map(f => ({ f, at: f.date }))].sort((a, b) => b.at.localeCompare(a.at));
    const journal = `<section class="sv-card" aria-labelledby="sv-j-h"><div class="sv-hrow"><h2 class="sv-h" id="sv-j-h">Journal des échanges <span class="count">${logs.length}</span>${files.length ? `<span class="hint">· ${files.length} pièce${files.length > 1 ? 's' : ''} jointe${files.length > 1 ? 's' : ''}</span>` : ''}</h2></div>
      <form class="sv-logf" id="sv-logf" data-svlog="${p.id}">
        <div class="sv-logr"><label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(d.date || TODAY)}"></label>
        <label class="field"><span>Type</span><select class="input" name="kind">${LOG_KINDS.map(k => `<option ${k === (d.kind || 'Appel') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field sv-who"><span>Interlocuteur</span><input class="input" name="who" list="sv-dlwho" value="${esc(d.who || '')}" autocomplete="off"><datalist id="sv-dlwho">${(CONTACTS[p.structure_id] || []).map(c => `<option value="${esc(c[1])}">`).join('')}</datalist></label></div>
        <label class="field"><span>Notes de l’échange</span><textarea class="input" name="body" rows="3" placeholder="Gardées en brouillon tant que tu ne les ajoutes pas">${esc(d.body || '')}</textarea></label>
        <div class="sv-loga"><button class="btn primary sm" type="submit">Ajouter au journal</button>${(d.body || d.who) ? `<span class="hint">Brouillon enregistré</span><button class="btn ghost sm" type="button" data-act="svDraftClear">Effacer le brouillon</button>` : ''}
          <span class="grow"></span><label class="btn ghost sm sv-drop">${icon('paperclip', 'sm')}Joindre un fichier<input type="file" id="sv-file" multiple class="sr"></label>
          <button class="btn ghost sm" type="button" data-act="svSim" data-m="Retrouver un mail dans la messagerie : recherche non simulée">Retrouver un mail</button></div></form>
      <ol class="sv-thread">${thread.map(x => x.f ? `<li class="sv-log is-file"><div class="sv-lh">${icon('paperclip', 'sm')}<b>${esc(fmtD(x.f.date))}</b><span>Pièce jointe</span></div><p class="sv-file">${esc(x.f.name)} <span class="hint">${esc(x.f.size)}</span></p></li>`
        : `<li class="sv-log ${x.l.draft ? 'is-draft' : ''}"><div class="sv-lh">${icon(LOG_ICON[x.l.kind] || 'notebook-pen', 'sm')}<b>${x.l.date ? esc(fmtD(x.l.date)) : 'Sans date'}</b>${x.l.time ? `<span class="mono">${esc(x.l.time)}</span>` : ''}${x.l.contact_name ? `<span>· ${esc(x.l.contact_name)}</span>` : ''}${x.l.draft ? '<span class="tag">Brouillon</span>' : ''}
          <span class="grow"></span>${x.l.full ? `<button class="btn ghost sm" type="button" data-act="svRead" data-id="${x.l.id}">Lire en entier</button>` : ''}${x.l.draft ? `<button class="btn sm" type="button" data-act="svSent" data-id="${x.l.id}">Marquer envoyé</button>` : ''}
          <button class="btn ghost sm" type="button" data-act="svLogEdit" data-id="${x.l.id}">Modifier</button><button class="btn ghost sm icon danger" type="button" data-act="svLogDel" data-id="${x.l.id}" aria-label="Supprimer l’entrée du ${esc(fmtD(x.l.date) || 'journal')}">${icon('trash-2', 'sm')}</button></div>
          <div class="sv-md">${md(x.l.body)}</div></li>`).join('') || '<li class="muted">Aucun échange enregistré.</li>'}</ol></section>`;
    const notes = `<section class="sv-card" aria-labelledby="sv-n-h"><div class="sv-hrow"><h2 class="sv-h" id="sv-n-h">Autres notes</h2><button class="btn ghost sm" type="button" data-act="svText" data-f="content_md">Modifier</button></div>
      <div class="sv-md">${md(p.content_md) || '<p class="muted">—</p>'}</div>
      <div class="sv-danger"><button class="btn ghost sm danger" type="button" data-act="svDelete">${icon('trash-2', 'sm')}Supprimer le suivi…</button></div></section>`;
    return `<section class="sv-card sv-headcard" aria-label="Statut du suivi">${headRow}</section>${summary}${tasksH}${journal}${notes}`;
  }
  // Markdown réduit (gras, italique, puces) : texte échappé d'abord
  const md = t => { if (!t) return ''; const e = X().esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>');
    const lines = e.split('\n'); let out = '', ul = false;
    lines.forEach(l => { if (/^- /.test(l)){ if (!ul){ out += '<ul>'; ul = true; } out += `<li>${l.slice(2)}</li>`; } else { if (ul){ out += '</ul>'; ul = false; } if (l.trim()) out += `<p>${l}</p>`; } });
    return out + (ul ? '</ul>' : ''); };

  function side(p, st, proj, linked){
    const { esc, icon, eur } = X(), B = BK(), ids = p.project_ids;
    const active = linked.filter(s => !B.isOff(s.status) && ids.includes(s.project_id)), others = linked.filter(s => !active.includes(s));
    const row = s => `<li class="sv-dr ${s.date === SV.target ? 'target' : ''}"><span class="sv-dd"><b>${esc(B.fmtMed(s.date))}</b><span class="hint">${s.date.slice(0, 4)}</span></span>
      <span class="sv-db"><b>${esc(projName(s.project_id))}</b> <span class="muted">${esc(s.venue)}</span><span class="sv-dst">${B.statusSel(s)}${s.fee_ht ? `<span class="mono">${esc(eur(s.fee_ht))} HT</span>` : ''}</span></span>
      <span class="sv-da"><button class="btn sm" type="button" data-act="svShowEdit" data-id="${s.id}">Modifier</button>${s.date !== SV.target ? `<button class="btn ghost sm" type="button" data-act="svCenter" data-d="${s.date}">Centrer</button>` : ''}
        ${s.prospect_id === p.id ? `<button class="btn ghost sm" type="button" data-act="svDetach" data-id="${s.id}" title="Retire seulement le lien avec ce suivi : rien n’est supprimé">Détacher</button>` : ''}</span></li>`;
    const candidates = B.DB.shows.filter(s => !s.archived_at && ids.includes(s.project_id) && !linked.includes(s));
    const dates = `<section class="sv-card" aria-labelledby="sv-d-h"><h2 class="sv-h" id="sv-d-h">Dates de ce suivi <span class="count">${active.length}</span></h2>
      ${active.length ? `<ul class="sv-dates">${active.map(row).join('')}</ul>` : '<p class="muted">Aucune date en cours pour ce suivi.</p>'}
      ${others.length ? `<details class="sv-fold"><summary>Sans suite, annulées ou autres artistes <span class="count">${others.length}</span></summary><ul class="sv-dates">${others.map(row).join('')}</ul></details>` : ''}
      ${ids.length ? `<label class="field"><span>Rattacher une date existante</span><select class="input" data-svf="link"><option value="">Choisir une date de ${esc(projNames(p))}…</option>${candidates.map(s => `<option value="${s.id}">${esc(`${B.fmtD(s.date)} · ${s.venue} · ${projName(s.project_id)} · ${s.status}`)}</option>`).join('')}</select></label>` : ''}</section>`;
    if (!ids.length) return dates + `<section class="sv-card"><p class="muted">Ajoute l’artiste concerné (bouton « Artistes ») pour voir son planning et ses dates autour.</p></section>`;
    const target = SV.target, R = SV.radius, h = here(p), pl = p.place;
    const shows = B.DB.shows.filter(s => s.project_id === proj && s.date && !B.isOff(s.status) && !s.archived_at).sort((a, b) => a.date.localeCompare(b.date));
    const around = target ? shows.filter(s => Math.abs(daysBetween(target, s.date)) <= 5) : [];
    const until = addYear(target || TODAY);
    const dist = s => h && !B.locMissing(s) ? B.hav({ lat: h[0], lng: h[1] }, s) : Infinity;
    const inRadius = h ? shows.filter(s => s.date >= TODAY && s.date <= until && !around.includes(s) && dist(s) <= R) : [];
    const busy = target ? shows.filter(s => s.date <= target && (s.date_end || s.date) >= target && s.structure_id !== p.structure_id) : [];
    const sw = ids.length > 1 ? `<div class="seg sv-proj" role="radiogroup" aria-label="Artiste affiché">${ids.map(id => `<label><input type="radio" name="svproj" value="${id}" data-sv="proj" ${id === proj ? 'checked' : ''}><span>${esc(projName(id))}</span></label>`).join('')}</div>` : '';
    const nego = `<section class="sv-card sv-nego" aria-labelledby="sv-ng-h"><h2 class="sv-h" id="sv-ng-h">Date en négociation</h2>${sw}
      <div class="sv-ngr"><label class="field"><span>Date demandée</span><input class="input" type="date" id="sv-target" data-sv="target" value="${esc(target || '')}"></label>
        ${target ? '<button class="btn ghost sm" type="button" data-act="svClear">Effacer</button>' : ''}
        <label class="field sv-rad"><span>Rayon <b class="mono" id="sv-rv">${R} km</b></span><input type="range" min="0" max="300" step="10" value="${R}" id="sv-radius" data-sv="radius" aria-valuetext="${R} kilomètres"></label></div>
      ${target ? (busy.length ? `<p class="sv-free busy">${icon('triangle-alert', 'sm')}${esc(projName(proj))} n’est pas libre le ${esc(fmtD(target))} : ${esc(busy.map(s => `${s.venue} (${s.status})`).join(', '))}</p>`
        : `<p class="sv-free ok">${icon('circle-check', 'sm')}${esc(projName(proj))} est libre le ${esc(fmtD(target))}.</p>`)
        : '<p class="hint">Indique la date demandée : la carte montre ses dates 5 jours avant / après, et celles dans le rayon jusqu’à un an après.</p>'}</section>`;
    const shown = target ? [...around, ...inRadius] : shows.filter(s => s.date >= TODAY && s.date <= until);
    const map = `<section class="sv-card sv-mapc" aria-label="Carte des dates de ${esc(projName(proj))}"><div class="sv-map" data-here="${h ? h.join(',') : ''}" data-r="${target && h ? R : 0}">
      <svg class="bk-land" aria-hidden="true"><polygon/><circle class="sv-circle"/></svg>
      ${shown.filter(s => !B.locMissing(s)).map(s => `<button class="mpt ${s.status.startsWith('Confirmée') ? 'big' : ''}" type="button" data-act="svShowEdit" data-id="${s.id}" data-ll="${s.lat},${s.lng}" title="${esc(`${B.fmtMed(s.date)} · ${s.venue} · ${s.city} · ${s.status}`)}" aria-label="${esc(`${B.fmtMed(s.date)}, ${s.venue}, ${s.city}, ${s.status}`)}">${X().marker(s.status, s.status.startsWith('Confirmée') ? 18 : 14)}</button>`).join('')}
      ${h ? `<span class="sv-here" data-ll="${h.join(',')}" role="img" aria-label="${esc(`${pl?.venue || st?.name || ''} : date en négociation${target ? ' le ' + fmtD(target) : ''}`)}"></span>` : ''}
      <span class="bk-map-note">Fond schématique du prototype · carte OpenStreetMap dans MATRICE</span></div>
      ${!h ? `<p class="warn-l">${icon('map-pin', 'sm')}${pl ? 'Le lieu de ce suivi n’est pas localisé : choisis-le dans la liste « Lieu du concert ».' : 'Cette structure n’a pas de ville localisée : ajoute son adresse dans la fiche structure.'}</p>` : ''}</section>`;
    const near = s => { const d = daysBetween(target, s.date), r = h && !B.locMissing(s) ? B.route({ lat: h[0], lng: h[1] }, s) : null;
      return `<li><span>${X().statusPill(s.status)}<span><b>${esc(s.venue)}</b> · ${esc(s.city || '')}</span><span class="hint">${esc(B.fmtMed(s.date))} ${s.date.slice(0, 4)} (${d === 0 ? 'même jour' : d > 0 ? 'J+' + d : 'J' + d})${s.fee_ht ? ' · ' + esc(eur(s.fee_ht)) + ' HT' : ''}</span></span>
        <span class="num">${B.locMissing(s) ? '<span class="warn-l">localisation manquante</span>' : r && !r.error ? `<b class="mono">${X().NUM.format(r.km)} km</b><span class="hint">${esc(r.time)}</span>` : ''}</span></li>`; };
    const lists = target ? `<section class="sv-card sv-near" aria-labelledby="sv-a-h"><h2 class="sv-h" id="sv-a-h">5 jours avant / après <span class="count">${around.length}</span></h2>
        ${around.length ? `<ul>${around.map(near).join('')}</ul>` : `<p class="muted">Aucune date entre le ${esc(fmtD(addDays(target, -5)))} et le ${esc(fmtD(addDays(target, 5)))}.</p>`}
        <h2 class="sv-h" id="sv-r-h">Dans un rayon de ${R} km jusqu’au ${esc(fmtD(until))} <span class="count">${inRadius.length}</span></h2>
        ${!h ? '<p class="muted">Lieu non localisé : distances indisponibles.</p>' : inRadius.length ? `<ul>${inRadius.map(near).join('')}</ul>` : '<p class="muted">Aucune date dans ce rayon sur la période.</p>'}
        <p class="hint">Distances et temps de route : estimation simulée du prototype.</p></section>` : '';
    const plan = (target ? shows.filter(s => Math.abs(daysBetween(target, s.date)) <= 45) : shows.filter(s => s.date >= TODAY && s.date <= until));
    const planning = `<section class="sv-card" aria-labelledby="sv-p-h"><h2 class="sv-h" id="sv-p-h">Planning de ${esc(projName(proj))} <span class="hint">${target ? '45 jours autour de la date' : '12 prochains mois'}</span></h2>
      ${plan.length ? `<ul class="sv-plan">${plan.map(s => `<li class="${target && Math.abs(daysBetween(target, s.date)) <= 2 ? 'target' : ''}"><button class="sv-pb" type="button" data-act="svShowEdit" data-id="${s.id}"><span class="mono">${esc(B.fmtMed(s.date))}</span><span><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city || '')}</span></span></button>${B.statusSel(s)}</li>`).join('')}</ul>` : '<p class="muted">Aucune date sur cette période.</p>'}</section>`;
    return dates + nego + map + lists + planning;
  }

  // Carte : France et repères mis à l'échelle de la zone utile (lieu du suivi, rayon et dates affichées), comme l'ajustement de main
  function placeMap(el){
    const B = BK(), W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
    const pts = X().$$('[data-ll]', el).map(m => m.dataset.ll.split(',').map(Number)), hr = el.dataset.here ? el.dataset.here.split(',').map(Number) : null, R = Number(el.dataset.r || 0);
    const k = B.PRJ.k, xs = [], ys = [];
    const add = (la, ln) => { xs.push((ln - B.PRJ.lng0) * k); ys.push(B.PRJ.lat0 - la); };
    pts.forEach(([la, ln]) => add(la, ln));
    if (hr && R){ const dl = R / 111, dg = R / (111 * Math.cos(hr[0] * Math.PI / 180)); add(hr[0] + dl, hr[1] - dg); add(hr[0] - dl, hr[1] + dg); }
    if (xs.length < 2){ add(B.PRJ.lat0, B.PRJ.lng0); add(B.PRJ.lat1, B.PRJ.lng1); }
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const minSpan = 5.5; if (x1 - x0 < minSpan){ const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; } if (y1 - y0 < minSpan){ const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; }
    const pad = 28, sc = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0)), ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = (H - (y1 - y0) * sc) / 2 - y0 * sc;
    const P2 = (la, ln) => [ox + (ln - B.PRJ.lng0) * k * sc, oy + (B.PRJ.lat0 - la) * sc];
    const svg = X().$('.bk-land', el); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    X().$('polygon', svg).setAttribute('points', B.OUTLINE.map(([la, ln]) => P2(la, ln).map(v => v.toFixed(1)).join(',')).join(' '));
    const c = X().$('.sv-circle', svg);
    if (hr && R){ const [cx, cy] = P2(hr[0], hr[1]); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', (R / 111) * sc); c.removeAttribute('hidden'); } else c.setAttribute('r', 0);
    X().$$('[data-ll]', el).forEach(m => { const [la, ln] = m.dataset.ll.split(',').map(Number), [x, y] = P2(la, ln); m.style.left = x + 'px'; m.style.top = y + 'px'; });
  }
  let mapRO = null;
  function after(main){
    if (mapRO) mapRO.disconnect(); const m = X().$('.sv-map', main);
    if (m){ placeMap(m); mapRO = new ResizeObserver(() => placeMap(m)); mapRO.observe(m); }
  }
  function page(){
    if (SV.open){ const p = byId(SV.open); if (p) return wsPage(p); SV.open = null; }
    return listPage();
  }

  // ───────────────────────── Actions
  const rr = sel => { X().renderMain(); if (sel) X().$(sel)?.focus(); };
  function open(id){ cleanupDraft(id); SV.open = id; SV.target = undefined; SV.targetFor = null; SV.wsProject = null; SV.pane = 'fiche'; X().renderMain(); X().$('#main').scrollTop = 0; X().$('#main h1')?.focus?.(); }
  // nouveau suivi laissé vide (ni structure, ni artiste, ni échange, ni texte, ni brouillon) : supprimé quand on le quitte (actions.js cleanupDraft)
  function cleanupDraft(next){
    const id = SV.draftSuivi; if (!id || id === next) return; SV.draftSuivi = null;
    const p = byId(id), d = SV.drafts[id] || {};
    if (p && !p.structure_id && !p.project_ids.length && !logsOf(id).length && !filesOf(id).length && !p.summary && !p.content_md && !(d.body || d.who)){
      DB.prospects = DB.prospects.filter(x => x.id !== id); X().toast('Nouveau suivi vide : retiré', 'info'); }
  }
  function setStatus(p, v, el){
    const before = p.status; if (before === v) return;
    if (suiviClosed({ status: v })){
      const undo = DB.tasks.filter(t => t.prospect_id === p.id && ['relance_mail', 'relance_tel'].includes(t.auto_kind) && !isDone(t)).map(t => [t, t.status]);
      undo.forEach(([t]) => { t.status = 'Cancelled'; });                                   // relances automatiques retirées (prospection.js cancelAutoRelances)
      p.status = v; linger(p.id);
      SV.undo = { id: p.id, before, tasks: undo, until: Date.now() + 5000, msg: v === 'Confirmed' ? 'Suivi confirmé : rangé dans les suivis clos (relances automatiques retirées)' : 'Suivi clos (relances automatiques retirées)' };
      setTimeout(() => { if (SV.undo && SV.undo.until <= Date.now()){ SV.undo = null; if (X().S.tab === 'suivi') X().renderMain(); } }, 5100);
      rr('#' + (el?.id || 'sv-status')); return;
    }
    p.status = v; p.updated_at = TODAY; rr('#' + (el?.id || 'sv-status')); X().toast('Statut du suivi enregistré');
  }
  function addLog(form){
    const p = byId(form.dataset.svlog), f = new FormData(form), body = String(f.get('body') || '').trim(), who = String(f.get('who') || '').trim();
    if (!body && !who){ X().toast('Écris les notes de l’échange', 'triangle-alert'); form.elements.body.focus(); return; }
    const date = f.get('date') || TODAY;
    DB.logs.push({ id: 'l' + Date.now(), prospect_id: p.id, date, time: null, kind: f.get('kind'), contact_name: who || null, body, mail: false, draft: false });
    p.last_contact = [p.last_contact, date].filter(Boolean).sort().pop(); delete SV.drafts[p.id];
    rr('#sv-logf textarea'); X().toast('Ajouté au journal');
  }
  function textPanel(p, f){
    const { panelShell, openPanel, esc, device } = X(), label = f === 'summary' ? 'Résumé des échanges' : 'Autres notes';
    SV.edit = { kind: 'text', id: p.id, f }; SV.dirty = false; X().EXT.guard = () => SV.dirty;
    openPanel('svtext', panelShell(label, 'Suivi', `<form id="sv-form" class="sv-pform"><label class="field"><span>${label}</span><textarea class="input" name="v" rows="14">${esc(p[f] || '')}</textarea></label>
      <p class="hint">Mise en forme : **gras**, une puce par ligne commençant par « - ».</p></form>`,
      '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="sv-form">Enregistrer</button>'), { full: device() === 'phone' });
  }
  function logPanel(l){
    const { panelShell, openPanel, esc, device } = X();
    SV.edit = { kind: 'log', id: l.id }; SV.dirty = false; X().EXT.guard = () => SV.dirty;
    openPanel('svlog', panelShell('Modifier l’échange', 'Journal', `<form id="sv-form" class="sv-pform"><div class="sv-grid2"><label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(l.date || '')}"></label>
      <label class="field"><span>Type</span><select class="input" name="kind">${LOG_KINDS.map(k => `<option ${k === l.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div>
      <label class="field"><span>Interlocuteur</span><input class="input" name="who" value="${esc(l.contact_name || '')}"></label>
      <label class="field"><span>Notes</span><textarea class="input" name="body" rows="8">${esc(l.body || '')}</textarea></label></form>`,
      '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="sv-form">Enregistrer</button>'), { full: device() === 'phone' });
  }
  function taskPanel(p, t){
    const { panelShell, openPanel, esc, device } = X(), isNew = !t;
    SV.edit = { kind: 'task', id: t?.id || null, p: p.id }; SV.dirty = false; X().EXT.guard = () => SV.dirty;
    openPanel('svtask', panelShell(isNew ? 'Nouvelle tâche' : t.title, 'Tâche · Booking', `<form id="sv-form" class="sv-pform"><label class="field"><span>Tâche</span><input class="input" name="title" value="${esc(t?.title || '')}" required></label>
      <div class="sv-grid2"><label class="field"><span>Échéance</span><input class="input" type="date" name="deadline" value="${esc(t?.deadline || addDays(TODAY, 7))}"></label>
      <label class="field"><span>Pôle</span><input class="input" value="Booking" disabled></label></div>
      <p class="hint">Rattachée au suivi, à la structure et aux artistes (${esc(projNames(p) || 'aucun')}), comme sur main.${t?.auto_kind ? ' Tâche de relance créée automatiquement.' : ''}</p></form>`,
      '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="sv-form">' + (isNew ? 'Créer la tâche' : 'Enregistrer') + '</button>'), { full: device() === 'phone' });
  }
  function readPanel(l){
    const { panelShell, openPanel, esc, device } = X();
    openPanel('svread', panelShell(l.body.replace(/\*\*/g, '').split('\n')[0], 'Mail', `<p class="hint">${esc([fmtD(l.date), l.time, l.contact_name].filter(Boolean).join(' · '))}</p><pre class="sv-mailtext">${esc(l.full)}</pre>
      <p class="hint">Texte intégral fictif. Dans MATRICE : message exact de la messagerie (pièces jointes, images, liens).</p>`, '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Fermer</button>'), { full: device() === 'phone' });
  }
  function artistsEdit(p){
    const { panelShell, openPanel, esc, device } = X();
    SV.edit = { kind: 'artists', id: p.id }; SV.dirty = false; X().EXT.guard = () => SV.dirty;
    const list = BK().PROJECTS.filter(x => x.active || p.project_ids.includes(x.id));
    openPanel('svart', panelShell('Artistes du suivi', 'Suivi', `<form id="sv-form" class="sv-pform"><fieldset class="sv-checks"><legend>Artiste(s) concerné(s)</legend>${list.map(x => `<label class="chk"><input type="checkbox" name="pids" value="${x.id}" ${p.project_ids.includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}${x.active ? '' : ' <span class="tag">inactif</span>'}</span></label>`).join('')}</fieldset>
      <p class="hint">Choisis explicitement : jamais repris du filtre d’affichage (règle de main).</p></form>`,
      '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="sv-form">Enregistrer</button>'), { full: device() === 'phone' });
  }
  function exportPanel(){
    const { panelShell, openPanel, esc, device } = X();
    const proj = SV.projects.length === 1 ? SV.projects[0] : '';
    openPanel('svexp', panelShell('Exporter les suivis', 'Suivi', `<form id="sv-exp" class="sv-pform"><label class="field"><span>Projet</span><select class="input" name="project"><option value="">Choisir…</option>${BK().PROJECTS.map(x => `<option value="${x.id}" ${x.id === proj ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <fieldset class="sv-checks"><legend>Statuts</legend>${PROSPECT.map(x => `<label class="chk"><input type="checkbox" name="st" value="${x}" ${x !== 'Closed' ? 'checked' : ''}><span>${LABEL[x]}</span></label>`).join('')}</fieldset>
      <div class="sv-grid2"><label class="field"><span>Dernier échange à partir du</span><input class="input" type="date" name="from"></label><label class="field"><span>jusqu’au</span><input class="input" type="date" name="to"></label></div>
      <fieldset class="sv-checks"><legend>Format</legend>${[['xlsx', 'Excel'], ['csv', 'CSV'], ['pdf', 'PDF']].map(([v, l], i) => `<label class="chk"><input type="radio" name="fmt" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</fieldset>
      <p class="hint">Une ligne par contact de la structure : projet, structure, ville, prénom, nom, mail, statut, dernier échange.</p></form>`,
      '<span class="grow"></span><button class="btn" type="button" data-act="closePanel">Annuler</button><button class="btn primary" type="submit" form="sv-exp">Télécharger</button>'), { full: device() === 'phone' });
  }
  function exportGo(form){
    const f = new FormData(form), pid = f.get('project'), sts = f.getAll('st'), from = f.get('from'), to = f.get('to');
    if (!pid){ X().toast('Choisis un projet', 'triangle-alert'); form.elements.project.focus(); return; }
    if (!sts.length){ X().toast('Coche au moins un statut', 'triangle-alert'); return; }
    const list = DB.prospects.filter(p => p.project_ids.includes(pid) && sts.includes(p.status)).filter(p => { const l = lastExchange(p); if ((from || to) && !l) return false; return (!from || l >= from) && (!to || l <= to); });
    const n = list.reduce((a, p) => a + Math.max(1, (CONTACTS[p.structure_id] || []).length), 0);
    X().closePanel({ force: true }); X().toast(`${n} ligne${n > 1 ? 's' : ''} exportée${n > 1 ? 's' : ''} (${list.length} suivi${list.length > 1 ? 's' : ''}) — fichier non généré dans le prototype`);
  }
  function filtersSheet(){
    const { panelShell, openPanel, esc } = X();
    const sw = (k, l, n) => `<label class="switch" for="svf-${k}"><span class="txt">${l}${n != null ? ` <span class="hint">${n}</span>` : ''}</span><input type="checkbox" role="switch" id="svf-${k}" data-svx="${k}" ${SV[k] ? 'checked' : ''}></label>`;
    const nClosed = DB.prospects.filter(p => projOk(p) && suiviClosed(p)).length;
    openPanel('svfilters', panelShell('Filtres', 'Suivi', `<div class="pnl-sec"><h3>Statut</h3><select class="input" data-sv="status" aria-label="Statut"><option value="">Tous les statuts</option>${PROSPECT.map(x => `<option value="${x}" ${x === SV.status ? 'selected' : ''}>${LABEL[x]}</option>`).join('')}</select></div>
      <div class="pnl-sec"><h3>Artistes</h3>${BK().PROJECTS.filter(x => x.active || SV.showInactive).map(x => `<label class="chk"><input type="checkbox" data-svproj="${x.id}" ${SV.projects.includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div>
      <div class="pnl-sec"><h3>Affichage</h3>${sw('showInactive', 'Artistes inactifs')}${sw('showClosed', 'Suivis clos', nClosed)}</div>`,
      '<button class="btn ghost" type="button" data-act="svReset">Réinitialiser</button><span class="grow"></span><button class="btn primary" type="button" data-act="closePanel">Voir les suivis</button>'), { full: true });
  }
  const refreshFilters = () => { if (X().S.panel === 'svfilters') filtersSheet(); };
  function artistsPop(btn){
    const { esc } = X();
    X().openPop(btn, `<p class="eyebrow">Artistes</p><div class="pop-sw">${BK().PROJECTS.filter(x => x.active || SV.showInactive).map(x => `<label class="chk"><input type="checkbox" data-svproj="${x.id}" ${SV.projects.includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div>
      ${SV.projects.length ? '<button class="btn ghost sm" type="button" data-act="svArtClear">Tous les artistes</button>' : ''}`, { label: 'Artistes', cls: 'bk-pop' });
  }
  function displayPop(btn){
    const nClosed = DB.prospects.filter(p => projOk(p) && suiviClosed(p)).length;
    const sw = (k, l, n) => `<label class="switch" for="svp-${k}"><span class="txt">${l}${n != null ? ` <span class="hint">${n}</span>` : ''}</span><input type="checkbox" role="switch" id="svp-${k}" data-svx="${k}" ${SV[k] ? 'checked' : ''}></label>`;
    X().openPop(btn, `<p class="eyebrow">Affichage</p><div class="pop-sw">${sw('showInactive', 'Artistes inactifs')}${sw('showClosed', 'Suivis clos (confirmés et clos)', nClosed)}</div>`, { label: 'Affichage', cls: 'bk-pop bk-mfpop' });
  }
  const cur = () => byId(SV.open);
  const ACTS = {
    svOpen: b => open(b.dataset.id),
    svBack: () => { cleanupDraft(null); SV.open = null; SV.undo = null; X().renderMain(); X().$('#sv-q')?.focus(); },
    svNew: () => { cleanupDraft(null); const id = 'p' + Date.now();
      DB.prospects.unshift({ id, structure_id: null, project_ids: [], status: 'Mailed', last_contact: TODAY, summary: '', content_md: '', relances: 0, mail_sent_at: null, mail_draft: false, place: null, updated_at: TODAY });
      SV.draftSuivi = id; open(id); X().$('#sv-struct')?.focus(); },
    svExport: () => exportPanel(),
    svFilters: () => filtersSheet(),
    svArtists: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } artistsPop(b); },
    svDisplay: b => { if (X().$('.pop')?._from === b){ X().closePop(); return; } displayPop(b); },
    svArtClear: () => { SV.projects = []; X().closePop(); rr('[data-act="svArtists"]'); },
    svUnset: b => { const k = b.dataset.k; if (k === 'q') SV.q = ''; else if (k === 'status') SV.status = ''; else if (k.startsWith('proj:')) SV.projects = SV.projects.filter(x => x !== k.slice(5)); else SV[k] = false;
      rr('.bk-active .fchip, #sv-q'); refreshFilters(); },
    svReset: () => { Object.assign(SV, { q: '', status: '', projects: [], showInactive: false, showClosed: false }); rr('#sv-q'); refreshFilters(); },
    svUndo: () => { const u = SV.undo; if (!u) return; const p = byId(u.id); if (p){ p.status = u.before; delete SV.linger[p.id]; } u.tasks.forEach(([t, s]) => { t.status = s; });
      SV.undo = null; rr(); X().toast('Annulé : statut et relances rétablis'); },
    svSim: b => sim(b.dataset.m),
    svPlaceClear: () => { cur().place = null; rr('#sv-place'); },
    svArtistsEdit: () => artistsEdit(cur()),
    svAi: b => { b.disabled = true; b.textContent = 'Rédaction en cours…'; setTimeout(() => { b.disabled = false; X().renderMain(); sim('Résumé par l’IA : aucun appel dans le prototype (résumé inchangé)'); }, 700); },
    svText: b => textPanel(cur(), b.dataset.f),
    svCopy: async () => { const p = cur(), st = stOf(p.structure_id);
      const txt = `Mets à jour le résumé de ce suivi de booking (L'ArtBoristerie). 6 à 8 puces max… N'invente rien.\n\nStructure : ${st?.name || ''}\nArtiste(s) : ${projNames(p)}\nRésumé actuel :\n${p.summary || '—'}\n\nJournal :\n${logsOf(p.id).slice().reverse().map(l => `[${l.date ? fmtD(l.date) : 'sans date'}] ${l.kind}${l.contact_name ? ' — ' + l.contact_name : ''}\n${l.body}`).join('\n\n')}`;
      try { await navigator.clipboard.writeText(txt); X().toast('Copié : colle-le dans ChatGPT'); } catch { sim('Copie impossible dans ce navigateur'); } },
    svTaskNew: () => taskPanel(cur(), null),
    svTaskEdit: b => taskPanel(cur(), DB.tasks.find(t => t.id === b.dataset.id)),
    svNoAnswer: async b => { const t = DB.tasks.find(x => x.id === b.dataset.id), p = cur();
      if (!(await X().askConfirm('Clore le suivi ?', 'Pas de réponse au téléphone : la tâche est terminée et le suivi est clos (noté dans son journal).', 'Clore le suivi'))) return;
      DB.logs.push({ id: 'l' + Date.now(), prospect_id: p.id, date: TODAY, kind: 'Appel', contact_name: null, body: `**Appel sans réponse : suivi clos.**\nAppel le ${fmtD(TODAY)}.` });
      p.status = 'Closed'; p.last_contact = TODAY; t.status = 'Done'; linger(t.id); rr(); X().toast(`Suivi ${stOf(p.structure_id)?.name || ''} clos (appel sans réponse)`); },
    svDraftClear: () => { delete SV.drafts[cur().id]; rr('#sv-logf textarea'); },
    svRead: b => readPanel(DB.logs.find(l => l.id === b.dataset.id)),
    svSent: b => { const l = DB.logs.find(x => x.id === b.dataset.id), p = cur(); if (!l) return;
      l.draft = false; l.date = TODAY; l.body = l.body.replace(' (brouillon Gmail)', ''); p.mail_draft = false; if (/\*\*Prospection/.test(l.body) && !p.mail_sent_at) p.mail_sent_at = TODAY;
      p.last_contact = [p.last_contact, TODAY].filter(Boolean).sort().pop(); rr(); X().toast('Noté « envoyé » le ' + fmtD(TODAY)); },
    svLogEdit: b => logPanel(DB.logs.find(l => l.id === b.dataset.id)),
    svLogDel: async b => { const l = DB.logs.find(x => x.id === b.dataset.id);
      if (!(await X().askConfirm('Supprimer l’entrée ?', `Supprimer l’échange du ${l.date ? fmtD(l.date) : 'journal (sans date)'}${l.contact_name ? ' avec ' + l.contact_name : ''} ?`, 'Supprimer l’entrée'))) return;
      DB.logs = DB.logs.filter(x => x !== l); rr('#sv-j-h'); X().toast('Entrée supprimée'); },
    svDelete: async () => { const p = cur(), n = logsOf(p.id).length, f = filesOf(p.id).length;
      const plus = [n ? `son journal (${n} échange${n > 1 ? 's' : ''})` : '', f ? `${f} fichier${f > 1 ? 's' : ''} joint${f > 1 ? 's' : ''}` : ''].filter(Boolean).join(' et ');
      if (!(await X().askConfirm('Supprimer le suivi ?', `Supprimer le suivi « ${stOf(p.structure_id)?.name || 'sans structure'} »${plus ? ' avec ' + plus : ''} ? Les fichiers Google Drive ne sont pas touchés.`, 'Supprimer le suivi'))) return;
      DB.prospects = DB.prospects.filter(x => x !== p); DB.logs = DB.logs.filter(l => l.prospect_id !== p.id); DB.files = DB.files.filter(x => x.prospect_id !== p.id);
      SV.open = null; SV.draftSuivi = null; rr('#sv-q'); X().toast('Suivi supprimé'); },
    svShowNew: () => { const p = cur(), st = stOf(p.structure_id), pid = p.project_ids.includes(SV.wsProject) ? SV.wsProject : p.project_ids[0] || '';
      BK().openShow(null, { isNew: true, prefill: { project_id: pid, structure_id: st?.id || null, venue: st?.name || '', city: st?.city || '', department: st?.dep || '', date: SV.target || '',
        status: st?.festival ? 'Option Festival' : 'Option Salle', prospect_id: p.id, spectacle_id: BK().SPECTACLES.find(x => x.p === pid && x.active)?.id || null } }); },
    svShowEdit: b => BK().openShow(b.dataset.id),
    svCenter: b => { SV.target = b.dataset.d; rr('#sv-target'); },
    svClear: () => { SV.target = null; rr('#sv-target'); },
    svDetach: b => { const s = BK().byId(b.dataset.id); if (!s) return; s.prospect_id = null; rr('#sv-d-h'); X().toast('Date détachée du suivi : rien n’est supprimé'); },
  };

  // ───────────────────────── Évènements (composés avec ceux de Booking)
  function change(t){
    if (t.dataset.svst){ setStatus(byId(t.dataset.svst), t.value, t); return true; }
    if (t.dataset.sv === 'status'){ SV.status = t.value; X().renderMain(); refreshFilters(); return true; }
    if (t.dataset.sv === 'pane'){ SV.pane = t.value; rr(`input[name="svpane"][value="${t.value}"]`); return true; }
    if (t.dataset.sv === 'proj'){ SV.wsProject = t.value; rr(`input[name="svproj"][value="${t.value}"]`); return true; }
    if (t.dataset.sv === 'target'){ SV.target = t.value || null; rr('#sv-target'); return true; }
    if (t.dataset.sv === 'radius'){ SV.radius = Number(t.value); rr('#sv-radius'); return true; }
    if (t.dataset.svx){ SV[t.dataset.svx] = t.checked; const inPop = !!t.closest('.pop'); X().renderMain(); refreshFilters();
      if (inPop){ displayPop(X().$('[data-act="svDisplay"]')); X().$(`#svp-${t.dataset.svx}`)?.focus(); } return true; }
    if (t.dataset.svproj){ const id = t.dataset.svproj; SV.projects = t.checked ? [...SV.projects, id] : SV.projects.filter(x => x !== id);
      const inPop = !!t.closest('.pop'); X().renderMain(); refreshFilters(); if (inPop){ artistsPop(X().$('[data-act="svArtists"]')); X().$(`.pop [data-svproj="${id}"]`)?.focus(); } return true; }
    if (t.dataset.svtask){ const tk = DB.tasks.find(x => x.id === t.dataset.svtask); tk.status = t.checked ? 'Done' : 'To Do'; if (t.checked){ linger(tk.id); X().toast('Tâche faite'); } rr(`[data-svtask="${tk.id}"]`); return true; }
    if (t.dataset.svf === 'structure'){ const p = cur(); p.structure_id = t.value || null; rr('#sv-struct'); return true; }
    if (t.dataset.svf === 'place'){ const p = cur(), v = t.value.trim(); if (!v){ p.place = null; rr('#sv-place'); return true; }
      const s = BK().DB.shows.find(x => `${x.venue} — ${x.city}` === v); p.place = s ? { venue: s.venue, city: s.city, lat: s.lat, lng: s.lng } : { venue: v, city: '', lat: null, lng: null }; rr('#sv-place'); return true; }
    if (t.dataset.svf === 'link'){ const s = BK().byId(t.value); if (s){ s.prospect_id = cur().id; rr('#sv-d-h'); X().toast('Date rattachée au suivi'); } return true; }
    if (t.id === 'sv-file'){ const p = cur(); [...t.files].forEach((f, i) => DB.files.push({ id: 'f' + Date.now() + i, prospect_id: p.id, name: f.name, date: TODAY, size: `${Math.max(1, Math.round(f.size / 1024))} Ko` }));
      rr('#sv-j-h'); X().toast('Pièce jointe ajoutée au suivi (fictif : rien n’est envoyé)'); return true; }
    if (t.closest?.('#sv-form')){ SV.dirty = true; return true; }
    return false;
  }
  function input(t){
    if (t.id === 'sv-q'){ SV.q = t.value; const pos = t.selectionStart; X().renderMain(); const q = X().$('#sv-q'); if (q){ q.focus(); q.setSelectionRange(pos, pos); } return true; }
    if (t.id === 'sv-radius'){ X().$('#sv-rv') && (X().$('#sv-rv').textContent = t.value + ' km'); return true; }
    if (t.closest?.('#sv-logf')){ const f = t.closest('form'), d = SV.drafts[f.dataset.svlog] ||= {}; d[t.name] = t.value; return true; }
    if (t.closest?.('#sv-form')){ SV.dirty = true; return true; }
    return false;
  }
  function submit(e){
    const f = e.target;
    if (f.id === 'sv-logf'){ e.preventDefault(); addLog(f); return; }
    if (f.id === 'sv-exp'){ e.preventDefault(); exportGo(f); return; }
    if (f.id !== 'sv-form' || !SV.edit) return; e.preventDefault();
    const v = Object.fromEntries(new FormData(f)), E = SV.edit;
    if (E.kind === 'text'){ byId(E.id)[E.f] = v.v.trim(); X().toast(E.f === 'summary' ? 'Résumé enregistré' : 'Notes enregistrées'); }
    if (E.kind === 'log'){ const l = DB.logs.find(x => x.id === E.id); Object.assign(l, { date: v.date || null, kind: v.kind, contact_name: v.who || null, body: v.body }); X().toast('Échange modifié'); }
    if (E.kind === 'task'){ if (!v.title?.trim()){ X().toast('Indique la tâche', 'triangle-alert'); f.elements.title.focus(); return; }
      if (E.id) Object.assign(DB.tasks.find(x => x.id === E.id), { title: v.title.trim(), deadline: v.deadline || null });
      else DB.tasks.push({ id: 't' + Date.now(), prospect_id: E.p, title: v.title.trim(), deadline: v.deadline || null, status: 'To Do', auto_kind: null });
      X().toast(E.id ? 'Tâche enregistrée' : 'Tâche créée'); }
    if (E.kind === 'artists'){ const ids = new FormData(f).getAll('pids'); const p = byId(E.id); p.project_ids = ids; X().toast('Artistes du suivi enregistrés'); }
    SV.dirty = false; SV.edit = null; X().EXT.guard = null; X().closePanel({ force: true }); X().renderMain();
  }
  function keydown(e){
    const r = e.target.closest?.('.sv-row'); if (r && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); open(r.dataset.svid); return true; }
    return false;
  }
  document.addEventListener('submit', submit);
  document.addEventListener('click', e => { if (e.defaultPrevented) return; const r = e.target.closest?.('.sv-row'); if (r && !e.target.closest('button,a,input,select')) open(r.dataset.svid); });
  // dépôt de fichiers sur le formulaire du journal (fictif : nom et taille seulement)
  document.addEventListener('dragover', e => { if (e.target.closest?.('#sv-logf')){ e.preventDefault(); e.target.closest('#sv-logf').classList.add('drop-on'); } });
  document.addEventListener('dragleave', e => { e.target.closest?.('#sv-logf')?.classList.remove('drop-on'); });
  document.addEventListener('drop', e => { const f = e.target.closest?.('#sv-logf'); if (!f || !e.dataTransfer?.files?.length) return; e.preventDefault(); f.classList.remove('drop-on');
    const p = cur(); [...e.dataTransfer.files].forEach((x, i) => DB.files.push({ id: 'f' + Date.now() + i, prospect_id: p.id, name: x.name, date: TODAY, size: `${Math.max(1, Math.round(x.size / 1024))} Ko` }));
    rr('#sv-j-h'); X().toast('Pièce jointe ajoutée au suivi (fictif : rien n’est envoyé)'); });

  const prev = window.MX_EXT || {}, pc = prev.change, pi = prev.input, pk = prev.keydown, pd = prev.discard;   // fonctions de Booking capturées avant composition
  window.MX_EXT = Object.assign(prev, {
    pages: { ...(prev.pages || {}), suivi: page }, after: { ...(prev.after || {}), suivi: after },
    acts: { ...(prev.acts || {}), ...ACTS },
    change: (t, e) => change(t) || (pc ? pc(t, e) : false),
    input: (t, e) => input(t) || (pi ? pi(t, e) : false),
    keydown: e => keydown(e) || (pk ? pk(e) : false),
    discard: () => { SV.dirty = false; SV.edit = null; pd?.(); },
  });
  window.MATRICE_SUIVI = { DB, SV, LABEL, suiviClosed, showsOfSuivi, lastExchange };   // lecture par les tests automatisés
})();
