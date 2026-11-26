// MATRICE — prototype UX/UI (tableau de bord + navigation modulaire).
// JavaScript natif, sans framework ni dépendance chargée en ligne. Données : js/data.js (fictives).
// Préférences : stockage local de ce navigateur uniquement (arbitrage A12) — aucune base, aucun service réel.
(() => {
  'use strict';
  const D = window.MATRICE_DATA, IC = window.MATRICE_ICONS || {};
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
  const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur = n => EUR.format(n);
  const NUM = new Intl.NumberFormat('fr-FR');
  // format court des montants pour le bloc d'indicateurs sur téléphone (le montant exact reste lu par les lecteurs d'écran)
  const eurShort = n => n >= 1000 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n / 1000)} k€` : eur(n);
  const day = iso => new Date(iso + 'T12:00:00');
  const dShort = iso => day(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const dLong = iso => day(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dWeek = iso => day(iso).toLocaleDateString('fr-FR', { weekday: 'short' });
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mq = q => window.matchMedia(q);
  const MQ = { phone: mq('(max-width:760px)'), tablet: mq('(max-width:1023px)'), dark: mq('(prefers-color-scheme: dark)'), still: mq('(prefers-reduced-motion: reduce)') };
  const device = () => MQ.phone.matches ? 'phone' : MQ.tablet.matches ? 'tablet' : 'desktop';
  const DEVICE_LABEL = { desktop: 'ordinateur', tablet: 'tablette', phone: 'téléphone' };

  const TABS = D.MODULES.flatMap(m => m.tabs.map(t => ({ ...t, module: m })));
  const tabById = id => TABS.find(t => t.id === id);
  const modById = id => D.MODULES.find(m => m.id === id);

  // ───────────────────────── Préférences (stockage local, A12)
  const KEY = 'matrice-proto.prefs.v1';
  const fromProfile = p => { const pr = D.PROFILES[p]; return { profile: p, order: [...pr.order], shortcuts: [...pr.shortcuts], kpis: [...pr.kpis] }; };
  const DEFAULTS = () => ({
    ...fromProfile('booking'), hidden: [], folded: [], blocks: ['dates', 'taches', 'cachets', 'billetterie', 'suivis', 'messages'], hiddenBlocks: [],
    appearance: 'system', darkFrom: '19:00', darkTo: '07:30', density: { desktop: 'compacte', tablet: 'compacte', phone: 'compacte' },
    textSize: 1, weight: 'normal', leading: 'normal', tracking: 'normal', contrast: 'normal', zebra: true, glass: true, motion: true, mini: false, owner: true,
  });
  function load(){
    try { const raw = localStorage.getItem(KEY); if (raw){ const v = JSON.parse(raw); return { ...DEFAULTS(), ...v, density: { ...DEFAULTS().density, ...(v.density || {}) } }; } }
    catch { /* stockage indisponible : réglages par défaut */ }
    return DEFAULTS();
  }
  let P = load();
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* navigateur sans stockage : réglages gardés le temps de la visite */ } }

  // État de la page (non enregistré)
  const S = { tab: 'tableau-de-bord', views: { cachets: 'chart', billetterie: 'chart' }, sel: null, notifRead: false, lastFocus: null };

  // Onglets visibles pour ce compte (A8 : Mails masqué hors titulaire ; contrôle serveur inchangé)
  const allowed = t => !(t.owner && !P.owner);
  const visibleModules = () => P.order.map(modById).filter(m => m && !P.hidden.includes(m.id));

  // ───────────────────────── Apparence, densité, confort
  function darkNow(){
    if (P.appearance === 'dark') return true;
    if (P.appearance === 'light') return false;
    if (P.appearance === 'schedule'){
      const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
      const toMin = s => { const [h, mi] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
      const a = toMin(P.darkFrom), b = toMin(P.darkTo);
      return a <= b ? (m >= a && m < b) : (m >= a || m < b);
    }
    const host = root.getAttribute('data-theme');   // thème imposé par la page qui affiche le prototype, s'il y en a un
    if (host === 'dark' || host === 'light') return host === 'dark';
    return MQ.dark.matches;
  }
  function applyLook(){
    root.setAttribute('data-appearance', darkNow() ? 'dark' : 'light');
    root.setAttribute('data-density', P.density[device()] || 'compacte');
    root.setAttribute('data-weight', P.weight);
    root.setAttribute('data-leading', P.leading);
    root.setAttribute('data-tracking', P.tracking);
    root.setAttribute('data-contrast', P.contrast);
    root.setAttribute('data-motion', P.motion ? 'on' : 'off');
    root.style.setProperty('--ts', String(P.textSize));
    const app = $('.app'); if (!app) return;
    app.classList.toggle('glass', !!P.glass);
    app.classList.toggle('zebra', !!P.zebra);
    app.classList.toggle('mini', !!P.mini && device() === 'desktop');
  }

  // ───────────────────────── Statuts : forme + remplissage + libellé (A4)
  const ST = Object.fromEntries(D.STATUSES.map(x => [x.s, x]));
  const TONE = { int: 't-int', opt: 't-opt', conf: 't-conf' };
  function marker(status, size = 12){
    const x = ST[status] || ST['Sans statut'];
    const tone = x.type === 'art' ? 't-art' : x.type === 'ann' ? 't-ann' : x.type === 'ss' || x.type === 'none' ? 't-ss' : TONE[x.stage];
    const shape = { fest: '<rect class="shape" x="2" y="2" width="8" height="8" rx="1"/>', salle: '<circle class="shape" cx="6" cy="6" r="4.3"/>',
      art: '<path class="shape" d="M6 1.2 10.8 6 6 10.8 1.2 6Z"/>', ann: '<path class="shape" d="M2.5 2.5l7 7M9.5 2.5l-7 7"/>',
      ss: '<circle class="shape" cx="6" cy="6" r="4.3"/><path class="shape" d="M3.6 6h4.8"/>', none: '<circle class="shape" cx="6" cy="6" r="2.4"/>' }[x.type];
    const dot = x.stage === 'opt' ? '<circle cx="6" cy="6" r="1.7" fill="currentColor"/>' : '';
    return `<svg class="mk ${tone} ${x.stage === 'conf' ? 'fill' : ''}" width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">${shape}${dot}</svg>`;
  }
  const statusPill = s => `<span class="st">${marker(s)}<span>${esc(s)}</span></span>`;

  // ───────────────────────── Coque
  function shell(){
    document.body.innerHTML = `<div class="app">
      <aside class="side" id="side" aria-label="Navigation principale"></aside>
      <div class="scrim" data-act="closeDrawer"></div>
      <div class="work">
        <header class="top" id="top"></header>
        <main id="main" tabindex="-1"></main>
        <nav class="bottom" id="bottom" aria-label="Raccourcis"></nav>
      </div></div>
      <div class="toasts" role="status" aria-live="polite"></div>
      <dialog class="panel" id="panel" aria-labelledby="panel-title"></dialog>
      <dialog class="modal" id="search" aria-label="Recherche globale"></dialog>
      <dialog class="modal" id="confirm" aria-labelledby="confirm-title"></dialog>
      <dialog class="sheet" id="sheet" aria-label="Modules"></dialog>`;
  }

  const navLink = (t, extra = '') => `<a class="nav-item" href="#${t.id}" data-go="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''} title="${esc(t.label)}" ${extra}>${icon(t.icon)}<span class="lbl">${esc(t.label)}</span></a>`;
  function navTree({ sheet = false } = {}){
    const sc = P.shortcuts.map(tabById).filter(t => t && allowed(t));
    const mods = visibleModules().map(m => {
      const tabs = m.tabs.filter(allowed); if (!tabs.length) return '';
      const open = sheet || !P.folded.includes(m.id);
      const single = tabs.length === 1 && tabs[0].label === 'Tableau de bord';
      if (single) return navLink(tabs[0], 'data-mod="1"').replace('class="nav-item"', 'class="nav-item nav-mod"').replace(`<span class="lbl">${esc(tabs[0].label)}</span>`, `<span class="lbl">${esc(m.label)}</span>`);
      return `<button class="nav-item nav-mod" type="button" data-act="${sheet ? 'noop' : 'fold'}" data-id="${m.id}" aria-expanded="${open}" title="${esc(m.label)}">${icon(m.icon)}<span class="lbl">${esc(m.label)}</span>${sheet ? '' : icon('chevron-down', 'sm chev')}</button>
        <div class="nav-tabs" ${open ? '' : 'hidden'}>${tabs.map(t => navLink(t)).join('')}</div>`;
    }).join('');
    return `${sc.length ? `<div class="side-label">${icon('star', 'sm')}<span>Raccourcis</span></div>${sc.map(t => navLink(t)).join('')}` : ''}
      <div class="side-label"><span>Modules</span></div>${mods}`;
  }
  function renderSide(){
    $('#side').innerHTML = `<div class="side-head">
        <a class="brand" href="#tableau-de-bord" data-go="tableau-de-bord" aria-label="MATRICE — tableau de bord"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="brand-name">MATRICE</span></a>
        <button class="btn ghost icon sm collapse-btn" type="button" data-act="mini" aria-label="${P.mini ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}" title="${P.mini ? 'Déplier' : 'Réduire'}">${icon(P.mini ? 'panel-left-open' : 'panel-left-close')}</button>
        <button class="btn ghost icon sm only-touch-nav" type="button" data-act="closeDrawer" aria-label="Fermer le menu">${icon('x')}</button>
      </div>
      <button class="side-search" type="button" data-act="search" aria-label="Rechercher (Cmd ou Ctrl + K)" title="Rechercher">${icon('search', 'sm')}<span>Rechercher</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'} K</kbd></button>
      <div class="side-scroll">${navTree()}</div>
      <div class="side-foot"><span class="who"><b>Anthony</b><span class="muted">Compte de démonstration</span></span>
        <a class="btn ghost icon sm" href="#preferences" data-go="preferences" aria-label="Préférences personnelles" title="Préférences personnelles">${icon('user')}</a></div>`;
  }
  function renderTop(){
    const t = tabById(S.tab);
    $('#top').innerHTML = `<button class="btn ghost icon only-touch-nav" type="button" data-act="drawer" aria-label="Ouvrir le menu" aria-controls="side">${icon('menu')}</button>
      <div class="crumb"><span>${esc(t.module.label)}</span>${t.module.tabs.length > 1 ? `${icon('chevron-right', 'sm')}<b>${esc(t.label)}</b>` : ''}</div>
      <span class="proto-flag">Prototype · données fictives</span>
      <button class="btn ghost icon" type="button" data-act="search" aria-label="Rechercher" title="Rechercher (⌘ / Ctrl + K)">${icon('search')}</button>
      <button class="btn ghost icon" type="button" data-act="notifs" aria-label="Notifications${S.notifRead ? '' : ' (3 non lues)'}" aria-haspopup="dialog">${icon('bell')}${S.notifRead ? '' : '<span class="bell-dot" aria-hidden="true"></span>'}</button>`;
  }
  function renderBottom(){
    const sc = P.shortcuts.map(tabById).filter(t => t && allowed(t)).slice(0, 4);
    $('#bottom').innerHTML = `<div class="bottom-bar">${sc.map(t => `<a href="#${t.id}" data-go="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''}>${icon(t.icon)}<span class="lbl">${esc(t.label)}</span></a>`).join('')}
      <button type="button" data-act="sheet">${icon('layout-grid')}<span class="lbl">Modules</span></button></div>`;
  }

  // ───────────────────────── Pages
  function pageHead(t, { sub = '', acts = '' } = {}){
    const pinned = P.shortcuts.includes(t.id);
    return `<div class="page-head"><div class="grow"><h1>${esc(t.label)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
      <div class="acts">${acts}<button class="btn" type="button" data-act="pin" data-id="${t.id}" aria-pressed="${pinned}">${icon('star', 'sm')}<span>Raccourci</span><span class="sr">${pinned ? ' : présent dans les raccourcis' : ' : ajouter aux raccourcis'}</span></button></div></div>`;
  }
  const PROTO = `<p class="banner">${icon('info', 'sm')}Prototype isolé : données fictives, aucune connexion à la base ni aux services réels.</p>`;

  function renderMain(){
    const t = tabById(S.tab), main = $('#main'), keep = main.dataset.tab === S.tab ? main.scrollTop : 0;
    main.dataset.tab = S.tab;
    main.innerHTML = `<div class="page">${S.tab === 'tableau-de-bord' ? dashboard() : S.tab === 'preferences' ? prefsPage() : placeholder(t)}</div>`;
    main.scrollTop = keep;
    $$('[data-w]', main).forEach(el => el.style.setProperty('--w', el.dataset.w));
    $$('[data-s]', main).forEach(el => el.style.setProperty('--s', el.dataset.s));
    const fig = $('#fig-cachets', main); if (fig) mountBars(fig);
  }

  // Tableau de bord
  function dashboard(){
    const t = tabById('tableau-de-bord');
    const kpis = P.kpis.map(k => D.KPIS[k]).filter(Boolean);
    const blocks = P.blocks.filter(b => !P.hiddenBlocks.includes(b));
    const SPAN = { dates: 7, taches: 5, cachets: 7, billetterie: 5, suivis: 6, messages: 6 };
    return pageHead(t, { sub: `${esc(dLong(D.TODAY))} · configuration ${esc(D.PROFILES[P.profile]?.label || 'personnalisée')}`,
        acts: `<button class="btn" type="button" data-act="customize">${icon('sliders-horizontal', 'sm')}Personnaliser</button>` })
      + PROTO
      + `<section class="card kpis-wrap" aria-label="Indicateurs"><div class="kpis">${kpis.map(k => `<div class="kpi ${k.warn ? 'k-warn' : ''}">
          <span class="k-label">${esc(k.label)}</span><span class="k-value">${k.eur ? `<span class="k-full">${esc(eur(k.value))}</span><span class="k-short" aria-hidden="true">${esc(eurShort(k.value))}</span>` : esc(k.value)}</span>
          <span class="k-note">${k.warn ? icon('triangle-alert') : ''}${esc(k.note)}</span></div>`).join('')}</div></section>`
      + `<div class="grid">${blocks.map(b => `<section class="card span-${SPAN[b]}" aria-labelledby="h-${b}">${BLOCK[b]()}</section>`).join('')}</div>`;
  }
  const cardHead = (id, title, count, tools = '') => `<div class="card-head"><h2 id="h-${id}">${esc(title)}</h2>${count != null ? `<span class="count">${count}</span>` : ''}${tools}</div>`;
  const goBtn = (id, label) => `<a class="btn ghost sm" href="#${id}" data-go="${id}">${esc(label)}${icon('chevron-right', 'sm')}</a>`;
  const viewToggle = key => `<div class="chart-tools" role="group" aria-label="Affichage">
    <button class="btn sm icon" type="button" data-act="view" data-k="${key}" data-v="chart" aria-pressed="${S.views[key] === 'chart'}" aria-label="Graphique" title="Graphique">${icon('chart-column', 'sm')}</button>
    <button class="btn sm icon" type="button" data-act="view" data-k="${key}" data-v="table" aria-pressed="${S.views[key] === 'table'}" aria-label="Tableau des valeurs" title="Tableau des valeurs">${icon('table-2', 'sm')}</button></div>`;

  const BLOCK = {
    dates: () => cardHead('dates', 'Prochaines dates', D.DATES.length, goBtn('booking', 'Booking'))
      + `<ul class="list">${D.DATES.map(d => `<li class="row click r-date" tabindex="0" role="button" data-act="date" data-id="${d.id}" aria-label="${esc(`${dLong(d.date)}, ${d.artist}, ${d.venue}, ${d.status}`)}">
          <span class="dt">${esc(dShort(d.date))} <span class="muted">${esc(dWeek(d.date))}</span></span>
          <span class="t"><b>${esc(d.artist)}</b> <span class="sub">· ${esc(d.venue)}</span></span>
          <span class="t sub c-city">${esc(d.city)}</span>${statusPill(d.status)}</li>`).join('')}</ul>`,
    taches: () => cardHead('taches', 'Tâches', D.TASKS.length, goBtn('todo', 'To Do'))
      + `<ul class="list">${D.TASKS.map(x => `<li class="row r-task">
          <span class="prio ${x.prio}">${x.prio === 'late' ? icon('triangle-alert', 'sm') + 'En retard' : x.prio === 'high' ? icon('arrow-up', 'sm') + 'Haute' : '<span class="muted">Normale</span>'}</span>
          <span class="t">${esc(x.t)}</span><span class="tag">${esc(x.pole)}</span><span class="dt">${esc(dShort(x.due))}</span></li>`).join('')}</ul>`,
    suivis: () => cardHead('suivis', 'Suivis à relancer', D.SUIVIS.length, goBtn('suivi', 'Suivi'))
      + `<ul class="list">${D.SUIVIS.map(x => `<li class="row r-suivi"><span class="t"><b>${esc(x.s)}</b> <span class="sub">· ${esc(x.city)} · ${esc(x.artist)}</span></span>
          <span class="tag">${esc(x.st)}</span><span class="dt">${esc(dShort(x.last))}</span></li>`).join('')}</ul>`,
    messages: () => {
      if (!P.owner) return cardHead('messages', 'Messages') + `<p class="empty">Boîte réservée à son titulaire : ce bloc et l’onglet Mails sont masqués pour ce compte.</p>`;
      return cardHead('messages', 'Messages', D.MESSAGES.filter(m => m.unread).length + ' non lus', goBtn('mails', 'Mails'))
        + `<ul class="list">${D.MESSAGES.map(m => `<li class="row r-msg"><span class="unread ${m.unread ? '' : 'read'}" ${m.unread ? 'title="Non lu"' : ''}></span><span class="t sub c-from">${esc(m.from)}</span>
          <span class="t">${m.unread ? `<b>${esc(m.subj)}</b><span class="sr"> (non lu)</span>` : esc(m.subj)}</span><span class="dt">${esc(m.at)}</span></li>`).join('')}</ul>`;
    },
    cachets: () => cardHead('cachets', 'Cachets par mois', null, viewToggle('cachets'))
      + `<p class="legend"><span><i class="lg-real"></i>Réalisé</span><span><i class="lg-plan"></i>Prévisionnel</span><span><i class="lg-sel"></i>Mois sélectionné</span><span>Exercice 01/10/2026 → 30/09/2027 · HT</span></p>`
      + (S.views.cachets === 'chart'
        ? `<div class="card-body"><div class="fig" id="fig-cachets" role="group" aria-label="Cachets par mois : réalisé et prévisionnel. Valeurs exactes au survol, au toucher ou dans le tableau."></div></div>`
        : `<div class="card-body"><div class="tbl-wrap" tabindex="0" role="region" aria-label="Cachets par mois"><table class="tbl"><thead><tr><th>Mois</th><th class="num">Réalisé</th><th class="num">Prévisionnel</th></tr></thead><tbody>
          ${D.CACHETS.map(c => `<tr><td>${esc(D.MONTHS[c.m])}</td><td class="num">${c.real == null ? '<span class="muted">—</span>' : esc(eur(c.real))}</td><td class="num">${esc(eur(c.plan))}</td></tr>`).join('')}</tbody></table></div></div>`),
    billetterie: () => {
      const list = D.DATES.filter(d => d.capacity && d.status.startsWith('Confirmée'));
      return cardHead('billetterie', 'Billetterie', list.length, viewToggle('billetterie'))
        + `<p class="legend"><span><i class="lg-real"></i>Billets vendus</span><span><i class="lg-sel"></i>Seuil de rentabilité</span></p>`
        + (S.views.billetterie === 'chart'
          ? `<div class="card-body meters">${list.map(d => { const ok = d.sold >= d.seuil;
              return `<div class="meter"><span class="m-name"><b>${esc(d.venue)}</b> <span class="muted">· ${esc(dShort(d.date))}</span></span><span class="m-val">${NUM.format(d.sold)} / ${NUM.format(d.capacity)} · ${Math.round(d.sold / d.capacity * 100)} %</span>
                <span class="m-track" role="img" aria-label="${esc(`${d.sold} billets vendus sur ${d.capacity}, seuil ${d.seuil}`)}"><span class="m-fill" data-w="${(d.sold / d.capacity * 100).toFixed(1)}%"></span><span class="m-seuil" data-s="${(d.seuil / d.capacity * 100).toFixed(1)}%"></span></span>
                <span class="m-state ${ok ? 'ok' : ''}">${ok ? icon('circle-check') + 'Seuil atteint' : `Encore ${NUM.format(d.seuil - d.sold)} billets pour le seuil (${NUM.format(d.seuil)})`}</span></div>`; }).join('')}</div>`
          : `<div class="card-body"><div class="tbl-wrap" tabindex="0" role="region" aria-label="Billetterie"><table class="tbl"><thead><tr><th>Date</th><th>Lieu</th><th class="num">Vendus</th><th class="num">Jauge</th><th class="num">Seuil</th></tr></thead><tbody>
            ${list.map(d => `<tr><td class="mono">${esc(dShort(d.date))}</td><td>${esc(d.venue)}</td><td class="num">${NUM.format(d.sold)}</td><td class="num">${NUM.format(d.capacity)}</td><td class="num">${NUM.format(d.seuil)}</td></tr>`).join('')}</tbody></table></div></div>`);
    },
  };

  // Graphique en barres : graphite, sauge pour le seul mois choisi (pas de mise en avant automatique)
  let barsObserver = null, barsDraw = () => {};
  function mountBars(fig){
    if (barsObserver) barsObserver.disconnect();
    const draw = barsDraw = () => {
      const W = fig.clientWidth, H = fig.clientHeight; if (!W || !H) return;
      const narrow = W < 520, ml = narrow ? 34 : 48, mb = 22, mt = 8;
      const max = Math.ceil(Math.max(...D.CACHETS.map(c => Math.max(c.plan, c.real || 0))) * 1.1 / 5000) * 5000;
      const y = v => mt + (H - mt - mb) * (1 - v / max), band = (W - ml) / 12;
      const ticks = [0, max / 4, max / 2, max * 3 / 4, max];
      const k = v => narrow ? `${Math.round(v / 1000)}k` : `${NUM.format(v / 1000)} k€`;
      let s = ticks.map(v => `<line class="grid-l" x1="${ml}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-t" x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${k(v)}</text>`).join('');
      s += D.CACHETS.map(c => {
        const x = ml + band * c.m, pw = band * .62, rw = band * .36, label = D.MONTHS[c.m];
        const aria = `${label} : ${c.real == null ? 'pas encore réalisé' : 'réalisé ' + eur(c.real)}, prévisionnel ${eur(c.plan)}`;
        return `<g class="${S.sel === c.m ? 'sel' : ''}">
          <rect class="bar-plan" x="${x + (band - pw) / 2}" y="${y(c.plan)}" width="${pw}" height="${Math.max(0, y(0) - y(c.plan))}" rx="1"/>
          ${c.real == null ? '' : `<rect class="bar-real" x="${x + (band - rw) / 2}" y="${y(c.real)}" width="${rw}" height="${Math.max(0, y(0) - y(c.real))}" rx="1"/>`}
          ${!narrow || c.m % 2 === 0 ? `<text class="axis-t" x="${x + band / 2}" y="${H - 6}" text-anchor="middle">${esc(narrow ? label.slice(0, 3) : label)}</text>` : ''}
          <rect class="hit" x="${x}" y="${mt}" width="${band}" height="${H - mt - mb}" tabindex="0" role="button" data-m="${c.m}" aria-label="${esc(aria)}" aria-pressed="${S.sel === c.m}"/></g>`;
      }).join('');
      fig.innerHTML = `<svg aria-hidden="false">${s}</svg>`;
      if (S.sel != null) showTip(fig, S.sel);
    };
    barsObserver = new ResizeObserver(draw); barsObserver.observe(fig); draw();
  }
  function showTip(fig, m){
    if (!fig) return;
    const c = D.CACHETS[m], hit = $(`.hit[data-m="${m}"]`, fig); if (!hit) return;
    $('.tip', fig)?.remove();
    const r = hit.getBoundingClientRect(), f = fig.getBoundingClientRect();
    const tip = document.createElement('div'); tip.className = 'tip';
    tip.innerHTML = `<b>${esc(D.MONTHS[c.m])}</b><span class="mono">Réalisé : ${c.real == null ? '—' : esc(eur(c.real))}</span><br><span class="mono">Prévisionnel : ${esc(eur(c.plan))}</span>`;
    fig.appendChild(tip);
    const left = Math.min(Math.max(r.left - f.left + r.width / 2, tip.offsetWidth / 2), f.width - tip.offsetWidth / 2);
    tip.style.left = left + 'px'; tip.style.top = '4px';
  }

  // Écran non prototypé : rappel de l'existant et des accès transversaux
  function placeholder(t){
    if (t.owner && !P.owner) return pageHead(t) + `<section class="card placeholder"><h2>Accès réservé</h2><p class="muted">La boîte Mails est réservée à son titulaire. Pour ce compte, l’onglet est masqué de la navigation ; le contrôle d’accès reste assuré par le serveur.</p></section>`;
    return pageHead(t, { sub: esc(t.module.label) }) + PROTO
      + `<section class="card placeholder"><h2>Écran non prototypé à ce stade</h2>
        <p class="muted">Ce premier prototype couvre le tableau de bord et la navigation. Le contenu de cet écran reprendra à l’identique les fonctionnalités actuelles lors de la généralisation.</p>
        <dl><dt>Dans MATRICE 1.68</dt><dd>${esc(t.from)}</dd>${t.cross ? `<dt>Accès transversaux conservés</dt><dd>${esc(t.cross)}</dd>` : ''}</dl></section>`
      + (t.id === 'booking' ? statusesCard() : '');
  }
  function statusesCard(){
    return `<section class="card"><div class="card-head"><h2>Représentation des statuts (arbitrage A4)</h2></div><div class="card-body pref-sec">
      <p class="hint muted small">Forme = type (carré : festival, rond : salle, losange : artiste) · remplissage = étape (contour : intérêt, point : option, plein : confirmée) · couleur fonctionnelle en complément · libellé toujours affiché.</p>
      <div class="legend-grid">${D.STATUSES.map(x => statusPill(x.s)).join('')}</div>
      <p class="pref-row"><span class="l">Marqueurs de carte (aperçu, sans carte réelle)</span></p>
      <div class="map-demo" role="list">${D.STATUSES.map(x => `<span class="pin" role="listitem">${marker(x.s, 28)}<span>${esc(x.s)}</span></span>`).join('')}</div></div></section>`;
  }

  // Préférences personnelles
  const seg = (name, cur, opts) => `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${opts.map(([v, l]) => `<label><input type="radio" name="${esc(name)}" value="${esc(v)}" data-pref="${esc(name)}" ${String(cur) === String(v) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
  const sw = (id, label, on, hint = '') => `<label class="switch" for="${id}"><span class="txt">${esc(label)}${hint ? `<br><span class="muted small">${esc(hint)}</span>` : ''}</span><input type="checkbox" role="switch" id="${id}" data-pref="${id}" ${on ? 'checked' : ''}></label>`;
  function prefsPage(){
    const t = tabById('preferences'), dev = device();
    const mods = P.order.map(modById).filter(Boolean);
    const sc = P.shortcuts.map(tabById).filter(Boolean);
    const free = TABS.filter(x => !P.shortcuts.includes(x.id) && allowed(x));
    const moveBtns = (kind, i, n) => `<button class="btn ghost sm icon" type="button" data-act="move" data-kind="${kind}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">${icon('arrow-up', 'sm')}</button>
      <button class="btn ghost sm icon" type="button" data-act="move" data-kind="${kind}" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Descendre">${icon('arrow-down', 'sm')}</button>`;
    return pageHead(t, { sub: 'Propres à ce compte et à ce navigateur dans le prototype' }) + PROTO + `<div class="prefs">
      <section class="card pref-card pref-sec" aria-labelledby="p-prof"><h2 id="p-prof">Profil métier</h2>
        <p class="hint">Configuration de départ : ordre des modules, raccourcis, indicateurs. Ce n’est pas un rôle : les droits d’accès ne changent pas.</p>
        <div class="inline"><select class="input" id="pf-profile" aria-label="Profil métier">${Object.entries(D.PROFILES).map(([k, v]) => `<option value="${k}" ${P.profile === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}<option value="perso" ${P.profile === 'perso' ? 'selected' : ''}>Personnalisé</option></select>
        <button class="btn" type="button" data-act="applyProfile">Appliquer</button></div></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-look"><h2 id="p-look">Apparence</h2>
        ${seg('appearance', P.appearance, [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système'], ['schedule', 'Horaires']])}
        ${P.appearance === 'schedule' ? `<div class="inline"><label class="field"><span>Sombre à partir de</span><input class="input" type="time" id="pf-from" data-pref="darkFrom" value="${esc(P.darkFrom)}"></label>
          <label class="field"><span>jusqu’à</span><input class="input" type="time" id="pf-to" data-pref="darkTo" value="${esc(P.darkTo)}"></label></div>` : ''}
        <p class="hint">Mode sombre « Graphite doux » provisoire (étape 7) : à valider en conditions réelles.</p></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-dens"><h2 id="p-dens">Densité</h2>
        ${seg('density', P.density[dev], [['compacte', 'Compacte'], ['standard', 'Standard'], ['confort', 'Confort']])}
        <p class="hint">Réglage propre à ce type d’appareil (${DEVICE_LABEL[dev]}). Lignes de ${{ desktop: '28 / 34 / 42', tablet: '32 / 38 / 44', phone: '32 / 38 / 44' }[dev]} px.</p></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-read"><h2 id="p-read">Confort de lecture</h2>
        <div class="pref-row"><span class="l">Taille du texte</span>${seg('textSize', P.textSize, [['0.9', '90 %'], ['1', '100 %'], ['1.125', '112 %'], ['1.25', '125 %']])}</div>
        <div class="pref-row"><span class="l">Graisse</span>${seg('weight', P.weight, [['normal', 'Normale'], ['strong', 'Renforcée']])}</div>
        <div class="pref-row"><span class="l">Interligne</span>${seg('leading', P.leading, [['normal', 'Standard'], ['airy', 'Aéré']])}</div>
        <div class="pref-row"><span class="l">Espacement des lettres</span>${seg('tracking', P.tracking, [['normal', 'Standard'], ['wide', 'Élargi']])}</div>
        <div class="pref-row"><span class="l">Contraste</span>${seg('contrast', P.contrast, [['normal', 'Standard'], ['high', 'Renforcé']])}</div>
        ${sw('zebra', 'Alternance des fonds des tableaux et listes', P.zebra)}</section>

      <section class="card pref-card pref-sec" aria-labelledby="p-fx"><h2 id="p-fx">Effets</h2>
        ${sw('glass', 'Effets de verre', P.glass, 'Navigation seulement, jamais sur les données')}
        ${sw('motion', 'Animations', P.motion, MQ.still.matches ? 'Votre système demande de réduire les animations : elles restent coupées.' : 'Ouverture des panneaux, menus et fenêtres')}</section>

      <section class="card pref-card pref-sec" aria-labelledby="p-mod"><h2 id="p-mod">Modules</h2>
        <p class="hint">Ordre et visibilité dans la navigation. Masquer un module ne retire aucun droit : il reste accessible par la recherche.</p>
        <ul class="order-list">${mods.map((m, i) => { const off = P.hidden.includes(m.id);
          return `<li class="${off ? 'off' : ''}"><span class="t">${icon(m.icon, 'sm')}${esc(m.label)}</span>${moveBtns('order', i, mods.length)}
            <button class="btn ghost sm icon" type="button" data-act="hide" data-id="${m.id}" ${m.fixed ? 'disabled title="Toujours visible"' : ''} aria-pressed="${off}" aria-label="${off ? 'Afficher' : 'Masquer'} ${esc(m.label)}">${icon(off ? 'eye-off' : 'eye', 'sm')}</button></li>`; }).join('')}</ul></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-sc"><h2 id="p-sc">Raccourcis</h2>
        <p class="hint">Affichés en haut de la barre latérale ; les 4 premiers forment la barre du bas sur téléphone.</p>
        ${sc.length ? `<ul class="order-list">${sc.map((x, i) => `<li><span class="t">${icon(x.icon, 'sm')}${esc(x.label)} <span class="muted small">${esc(x.module.label)}</span></span>${moveBtns('shortcuts', i, sc.length)}
          <button class="btn ghost sm icon" type="button" data-act="unpin" data-id="${x.id}" aria-label="Retirer ${esc(x.label)} des raccourcis">${icon('x', 'sm')}</button></li>`).join('')}</ul>` : '<p class="muted small">Aucun raccourci.</p>'}
        <div class="inline"><select class="input" id="pf-add" aria-label="Onglet à ajouter">${free.map(x => `<option value="${x.id}">${esc(x.module.label)} › ${esc(x.label)}</option>`).join('')}</select>
          <button class="btn" type="button" data-act="addShortcut" ${free.length ? '' : 'disabled'}>${icon('plus', 'sm')}Ajouter</button></div></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-acc"><h2 id="p-acc">Compte de démonstration</h2>
        ${sw('owner', 'Titulaire de la boîte Mails', P.owner, 'Décoché : onglet Mails et bloc Messages masqués (A8). Le contrôle réel reste sur le serveur.')}</section>

      <section class="card pref-card pref-sec" aria-labelledby="p-prev"><h2 id="p-prev">Aperçu d’un tableau</h2>
        <p class="hint">Pour juger densité, alternance, contraste et chiffres alignés (IBM Plex Mono).</p>
        <div class="tbl-wrap" tabindex="0" role="region" aria-label="Aperçu d’un tableau"><table class="tbl"><thead><tr><th>Date</th><th>Artiste</th><th>Lieu</th><th>Statut</th><th class="num">Cachet HT</th></tr></thead><tbody>
          ${D.DATES.slice(0, 6).map(d => `<tr><td class="mono">${esc(dShort(d.date))}</td><td>${esc(d.artist)}</td><td>${esc(d.venue)}</td><td>${statusPill(d.status)}</td><td class="num">${d.fee ? esc(eur(d.fee)) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div></section>

      <section class="card pref-card pref-sec" aria-labelledby="p-reset"><h2 id="p-reset">Paramètres par défaut</h2>
        <p class="hint">Revient au profil Booking / Diffusion et aux réglages d’origine.</p>
        <div><button class="btn" type="button" data-act="reset">${icon('rotate-ccw', 'sm')}Restaurer les paramètres par défaut</button></div></section>
    </div>` + statusesCard();
  }

  // ───────────────────────── Panneaux, fenêtres, feuille, recherche
  function openDialog(dlg, html, { modal = true } = {}){
    S.lastFocus = document.activeElement;
    dlg.innerHTML = html;
    if (!dlg.open) modal ? dlg.showModal() : dlg.show();
  }
  function closeDialog(dlg){ if (dlg.open) dlg.close(); }
  document.addEventListener('close', e => { if (e.target.tagName === 'DIALOG' && S.lastFocus?.isConnected) S.lastFocus.focus(); }, true);

  function openDate(id){
    const d = D.DATES.find(x => x.id === id); if (!d) return;
    openDialog($('#panel'), `<div class="dlg-head"><h2 id="panel-title">${esc(d.venue)}</h2><button class="btn ghost icon" type="button" data-act="closePanel" aria-label="Fermer">${icon('x')}</button></div>
      <div class="dlg-body"><div>${statusPill(d.status)}</div>
        <dl class="kv"><dt>Artiste</dt><dd>${esc(d.artist)}</dd><dt>Date</dt><dd>${esc(dLong(d.date))}</dd><dt>Ville</dt><dd>${esc(d.city)}</dd>
          <dt>Contrat</dt><dd>${esc(d.contract)}</dd><dt>Cachet HT</dt><dd class="mono">${d.fee ? esc(eur(d.fee)) : '—'}</dd>
          ${d.capacity ? `<dt>Billetterie</dt><dd class="mono">${NUM.format(d.sold)} / ${NUM.format(d.capacity)} (seuil ${NUM.format(d.seuil)})</dd>` : ''}</dl>
        <p class="muted small">Panneau de consultation (étape 11) : le contexte de travail reste visible derrière. Consultation seule dans le prototype.</p></div>
      <div class="dlg-foot"><button class="btn" type="button" data-act="closePanel">Fermer</button><a class="btn primary" href="#production" data-go="production">Ouvrir dans Production</a></div>`);
  }
  function openCustomize(){
    const blocks = P.blocks;
    const opts = cur => Object.entries(D.KPIS).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    openDialog($('#panel'), `<div class="dlg-head"><h2 id="panel-title">Personnaliser le tableau de bord</h2><button class="btn ghost icon" type="button" data-act="closePanel" aria-label="Fermer">${icon('x')}</button></div>
      <div class="dlg-body"><div class="pref-sec"><h3 class="l">Indicateurs (4)</h3>
        ${P.kpis.map((k, i) => `<label class="field"><span>Indicateur ${i + 1}</span><select class="input" id="kpi-${i}" data-kpi="${i}">${opts(k)}</select></label>`).join('')}</div>
        <div class="pref-sec"><h3 class="l">Blocs</h3><ul class="order-list">${blocks.map((b, i) => { const off = P.hiddenBlocks.includes(b);
          return `<li class="${off ? 'off' : ''}"><span class="t">${esc(D.BLOCKS[b])}</span>
            <button class="btn ghost sm icon" type="button" data-act="move" data-kind="blocks" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(D.BLOCKS[b])}">${icon('arrow-up', 'sm')}</button>
            <button class="btn ghost sm icon" type="button" data-act="move" data-kind="blocks" data-i="${i}" data-d="1" ${i === blocks.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(D.BLOCKS[b])}">${icon('arrow-down', 'sm')}</button>
            <button class="btn ghost sm icon" type="button" data-act="hideBlock" data-id="${b}" aria-pressed="${off}" aria-label="${off ? 'Afficher' : 'Masquer'} ${esc(D.BLOCKS[b])}">${icon(off ? 'eye-off' : 'eye', 'sm')}</button></li>`; }).join('')}</ul></div>
        <p class="muted small">Enregistré automatiquement. Contenu définitif des indicateurs à confirmer selon le métier et les données disponibles.</p></div>
      <div class="dlg-foot"><button class="btn" type="button" data-act="resetDash">Revenir au profil</button><button class="btn primary" type="button" data-act="closePanel">Terminé</button></div>`);
  }
  function askConfirm(title, text, ok){
    return new Promise(resolve => {
      const dlg = $('#confirm');
      openDialog(dlg, `<div class="dlg-head"><h2 id="confirm-title">${esc(title)}</h2></div><div class="dlg-body"><p>${esc(text)}</p></div>
        <div class="dlg-foot"><button class="btn" type="button" value="non">Annuler</button><button class="btn primary" type="button" value="oui">${esc(ok)}</button></div>`);
      const done = v => { dlg.removeEventListener('click', onClick); closeDialog(dlg); resolve(v); };
      const onClick = e => { const b = e.target.closest('button[value]'); if (b) done(b.value === 'oui'); };
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('cancel', () => done(false), { once: true });
      $('button[value="oui"]', dlg).focus();
    });
  }
  function openSheet(){
    openDialog($('#sheet'), `<div class="dlg-head"><h2>Modules</h2><button class="btn ghost icon" type="button" data-act="closeSheet" aria-label="Fermer">${icon('x')}</button></div>
      <div class="dlg-body sheet-nav">${navTree({ sheet: true })}</div>`);
  }

  // Recherche globale (A11) : Cmd/Ctrl + K hors des éditeurs de texte
  function searchItems(){
    const items = [];
    TABS.filter(allowed).forEach(t => items.push({ g: 'Modules et onglets', label: t.label, sub: t.module.label, icon: t.icon, run: () => go(t.id) }));
    D.DATES.forEach(d => items.push({ g: 'Dates', label: `${d.artist} · ${d.venue}`, sub: `${dShort(d.date)} · ${d.status}`, icon: 'calendar-days', run: () => openDate(d.id) }));
    D.ARTISTS.forEach(a => items.push({ g: 'Projets', label: a, sub: 'Projet', icon: 'mic-vocal', run: () => { go('projets'); toast('Fiche projet non prototypée'); } }));
    D.STRUCTURES.forEach(s => items.push({ g: 'Structures', label: s, sub: 'Structure', icon: 'building-2', run: () => { go('structures'); toast('Fiche structure non prototypée'); } }));
    D.CONTACTS.forEach(c => items.push({ g: 'Contacts', label: c, sub: 'Contact', icon: 'contact', run: () => { go('contacts'); toast('Fiche contact non prototypée'); } }));
    return items;
  }
  let found = [], cursor = 0;
  function openSearch(){
    if ($('#search').open) return;
    openDialog($('#search'), `<div class="search-box">${icon('search')}<input id="q" type="search" placeholder="Rechercher un écran, une date, une structure…" aria-label="Rechercher" autocomplete="off" spellcheck="false" aria-controls="results" aria-activedescendant=""></div>
      <div class="results" id="results" role="listbox" aria-label="Résultats"></div>
      <div class="search-foot"><span>↑ ↓ pour choisir</span><span>Entrée pour ouvrir</span><span>Échap pour fermer</span><span>Données fictives</span></div>`);
    renderResults(''); $('#q').focus();
  }
  function renderResults(q){
    const words = norm(q).split(/\s+/).filter(Boolean);
    found = searchItems().filter(x => words.every(w => norm(`${x.label} ${x.sub} ${x.g}`).includes(w))).slice(0, 40);
    cursor = 0; let last = '';
    $('#results').innerHTML = found.map((x, i) => { const head = x.g !== last ? `<div class="res-group" role="presentation">${esc(x.g)}</div>` : ''; last = x.g;
      return `${head}<button class="res" type="button" role="option" id="res-${i}" data-i="${i}" aria-selected="${i === 0}" tabindex="-1">${icon(x.icon, 'sm')}<span class="t">${esc(x.label)}</span><span class="muted small">${esc(x.sub)}</span></button>`; }).join('')
      || '<p class="empty">Aucun résultat dans les données fictives.</p>';
    $('#q').setAttribute('aria-activedescendant', found.length ? 'res-0' : '');
  }
  function moveCursor(d){
    if (!found.length) return;
    cursor = (cursor + d + found.length) % found.length;
    $$('#results .res').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.i) === cursor)));
    const cur = $(`#res-${cursor}`); cur.scrollIntoView({ block: 'nearest' }); $('#q').setAttribute('aria-activedescendant', cur.id);
  }
  function runResult(i){ const x = found[i]; if (!x) return; closeDialog($('#search')); x.run(); }

  // Notifications
  function toggleNotifs(btn){
    const old = $('.pop'); if (old){ old.remove(); return; }
    const pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Notifications');
    pop.innerHTML = `<div class="pop-head"><b>Notifications</b><button class="btn ghost sm" type="button" data-act="readAll">Tout marquer comme lu</button></div>
      ${D.NOTIFS.map(n => `<div class="notif">${icon(n.icon)}<span>${S.notifRead ? esc(n.t) : `<b>${esc(n.t)}</b>`}</span><span class="when">${esc(n.b)} · ${esc(n.when)}</span></div>`).join('')}`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    $('button', pop).focus();
  }

  // Confirmations : discrètes, environ 3 secondes (étape 14)
  function toast(msg, ic = 'circle-check'){
    const box = $('.toasts'), el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
    box.appendChild(el); setTimeout(() => el.remove(), 3000);
  }

  // ───────────────────────── Navigation
  function go(id){
    const t = tabById(id) && allowed(tabById(id)) ? id : 'tableau-de-bord';
    if (location.hash !== '#' + t) history.pushState(null, '', '#' + t);
    route();
  }
  function route(){
    const h = decodeURIComponent(location.hash.slice(1));
    const t = tabById(h);
    S.tab = t ? t.id : 'tableau-de-bord';   // onglet non autorisé : la page affiche « accès réservé »
    S.sel = null;
    $('.app').classList.remove('drawer'); $('.work').inert = false;
    $$('dialog[open]').forEach(d => d.close()); $('.pop')?.remove();
    renderAll();
    document.title = `${tabById(S.tab).label} · MATRICE (prototype)`;
    $('#main').focus({ preventScroll: true });
  }
  function renderAll(){ applyLook(); renderSide(); renderTop(); renderBottom(); renderMain(); }

  function setDrawer(open){
    const app = $('.app'); if (!open && !app.classList.contains('drawer')) return;
    app.classList.toggle('drawer', open); $('.work').inert = open;
    if (open) $('#side .nav-item')?.focus(); else $('[data-act="drawer"]')?.focus();
  }

  // ───────────────────────── Actions
  function move(kind, i, d){
    const list = kind === 'order' ? P.order : kind === 'blocks' ? P.blocks : P.shortcuts;
    if (kind === 'shortcuts'){ const ids = P.shortcuts.filter(id => tabById(id)); P.shortcuts = ids; }
    const j = i + d; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    if (kind !== 'blocks') P.profile = 'perso';
    save();
  }
  const ACTS = {
    fold: b => { if ($('.app').classList.contains('mini')){ const m = modById(b.dataset.id); go(m.tabs.find(allowed).id); return; }
      const id = b.dataset.id; P.folded = P.folded.includes(id) ? P.folded.filter(x => x !== id) : [...P.folded, id]; save(); renderSide();
      $(`#side [data-act="fold"][data-id="${id}"]`)?.focus(); },
    mini: () => { P.mini = !P.mini; save(); applyLook(); renderSide(); $('#side .collapse-btn')?.focus(); },
    drawer: () => setDrawer(true),
    closeDrawer: () => setDrawer(false),
    search: () => { setDrawer(false); openSearch(); },
    notifs: b => toggleNotifs(b),
    readAll: () => { S.notifRead = true; $('.pop')?.remove(); renderTop(); toast('Notifications marquées comme lues'); },
    sheet: () => openSheet(),
    closeSheet: () => closeDialog($('#sheet')),
    closePanel: () => closeDialog($('#panel')),
    customize: () => openCustomize(),
    date: b => openDate(b.dataset.id),
    view: b => { S.views[b.dataset.k] = b.dataset.v; renderMain(); $(`[data-act="view"][data-k="${b.dataset.k}"][data-v="${b.dataset.v}"]`)?.focus(); },
    pin: b => { const id = b.dataset.id, on = P.shortcuts.includes(id);
      P.shortcuts = on ? P.shortcuts.filter(x => x !== id) : [...P.shortcuts, id]; P.profile = 'perso'; save(); renderAll();
      $(`[data-act="pin"][data-id="${id}"]`)?.focus(); toast(on ? 'Retiré des raccourcis' : 'Ajouté aux raccourcis'); },
    unpin: b => { P.shortcuts = P.shortcuts.filter(x => x !== b.dataset.id); P.profile = 'perso'; save(); renderAll(); toast('Retiré des raccourcis'); },
    addShortcut: () => { const v = $('#pf-add')?.value; if (!v) return; P.shortcuts = [...P.shortcuts, v]; P.profile = 'perso'; save(); renderAll(); $('#pf-add')?.focus(); toast('Ajouté aux raccourcis'); },
    move: b => { const kind = b.dataset.kind; move(kind, Number(b.dataset.i), Number(b.dataset.d));
      if (kind === 'blocks'){ openCustomize(); renderMain(); } else renderAll();
      const sel = `[data-act="move"][data-kind="${kind}"][data-i="${Number(b.dataset.i) + Number(b.dataset.d)}"][data-d="${b.dataset.d}"]`;
      ($(sel) || $(`[data-act="move"][data-kind="${kind}"][data-i="${b.dataset.i}"]`))?.focus(); },
    hide: b => { const id = b.dataset.id; P.hidden = P.hidden.includes(id) ? P.hidden.filter(x => x !== id) : [...P.hidden, id]; P.profile = 'perso'; save(); renderAll();
      $(`[data-act="hide"][data-id="${id}"]`)?.focus(); },
    hideBlock: b => { const id = b.dataset.id; P.hiddenBlocks = P.hiddenBlocks.includes(id) ? P.hiddenBlocks.filter(x => x !== id) : [...P.hiddenBlocks, id]; save(); openCustomize(); renderMain();
      $(`[data-act="hideBlock"][data-id="${id}"]`)?.focus(); },
    resetDash: () => { const pr = D.PROFILES[P.profile] || D.PROFILES.booking; P.kpis = [...pr.kpis]; P.blocks = DEFAULTS().blocks; P.hiddenBlocks = []; save(); openCustomize(); renderMain(); toast('Tableau de bord revenu au profil'); },
    applyProfile: async () => { const p = $('#pf-profile').value; if (p === 'perso'){ toast('Profil personnalisé : réglez modules et raccourcis ci-dessous', 'info'); return; }
      if (!await askConfirm('Appliquer ce profil ?', `L’ordre des modules, les raccourcis et les indicateurs du tableau de bord seront remplacés par la configuration « ${D.PROFILES[p].label} ». Les droits d’accès ne changent pas.`, 'Appliquer')) return;
      Object.assign(P, fromProfile(p), { hidden: [], folded: [] }); save(); renderAll(); toast(`Profil « ${D.PROFILES[p].label} » appliqué`); },
    reset: async () => { if (!await askConfirm('Restaurer les paramètres par défaut ?', 'Tous vos réglages du prototype (apparence, densité, modules, raccourcis, tableau de bord) reviennent à leur valeur d’origine.', 'Restaurer')) return;
      P = DEFAULTS(); save(); renderAll(); toast('Paramètres par défaut restaurés'); },
    noop: () => {},
  };

  document.addEventListener('click', e => {
    if (!e.target.closest('.pop,[data-act="notifs"]')) $('.pop')?.remove();
    const res = e.target.closest('#results .res'); if (res){ runResult(Number(res.dataset.i)); return; }
    const g = e.target.closest('[data-go]');
    if (g){ e.preventDefault(); closeDialog($('#sheet')); closeDialog($('#panel')); go(g.dataset.go); return; }
    const hit = e.target.closest('.hit[data-m]');
    if (hit){ const m = Number(hit.dataset.m); S.sel = S.sel === m ? null : m; barsDraw(); $(`#fig-cachets .hit[data-m="${m}"]`)?.focus(); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const fn = ACTS[b.dataset.act]; if (fn){ e.preventDefault(); fn(b); }
  });
  // Survol du graphique : valeur exacte sans cliquer
  document.addEventListener('pointerover', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit && e.pointerType === 'mouse') showTip($('#fig-cachets'), Number(hit.dataset.m)); });
  document.addEventListener('pointerout', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit && e.pointerType === 'mouse' && S.sel == null) $('#fig-cachets .tip')?.remove(); });
  document.addEventListener('focusin', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit) showTip($('#fig-cachets'), Number(hit.dataset.m)); });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.kpi != null){ P.kpis[Number(t.dataset.kpi)] = t.value; save(); renderMain(); return; }
    const k = t.dataset.pref; if (!k) return;
    const keepId = t.id || null, keepName = t.type === 'radio' ? t.name : null;
    if (k === 'density') P.density[device()] = t.value;
    else if (k === 'textSize') P.textSize = Number(t.value);
    else if (t.type === 'checkbox') P[k] = t.checked;
    else P[k] = t.value;
    save(); renderAll();
    const back = keepName ? $(`input[name="${keepName}"]:checked`) : keepId ? document.getElementById(keepId) : null;
    back?.focus();
  });

  document.addEventListener('keydown', e => {
    // Cmd/Ctrl + K : recherche globale, sauf dans un éditeur de texte (raccourci « insérer un lien » conservé, A11)
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'){
      const tg = e.target; if (tg.tagName === 'TEXTAREA' || tg.isContentEditable) return;
      e.preventDefault(); setDrawer(false); openSearch(); return;
    }
    if ($('#search').open && e.target.id === 'q'){
      if (e.key === 'ArrowDown'){ e.preventDefault(); moveCursor(1); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); moveCursor(-1); }
      else if (e.key === 'Enter'){ e.preventDefault(); runResult(cursor); }
      return;
    }
    if (e.key === 'Escape'){ if ($('.pop')){ $('.pop').remove(); $('[data-act="notifs"]')?.focus(); } else if ($('.app').classList.contains('drawer')) setDrawer(false); }
    const row = e.target.closest?.('.row[role="button"]');
    if (row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); row.click(); }
    const hit = e.target.closest?.('.hit[data-m]');
    if (hit && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); hit.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') renderResults(e.target.value); });
  // fermeture d'une fenêtre par clic sur le fond
  document.addEventListener('click', e => { if (e.target.tagName === 'DIALOG' && e.target.id !== 'confirm') e.target.close(); });

  // Changements de contexte : thème système, horaires, type d'appareil
  MQ.dark.addEventListener('change', applyLook);
  MQ.still.addEventListener('change', () => { if (S.tab === 'preferences') renderMain(); });
  [MQ.phone, MQ.tablet].forEach(m => m.addEventListener('change', () => { setDrawer(false); renderAll(); }));
  new MutationObserver(() => { if (P.appearance === 'system') applyLook(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  setInterval(() => { if (P.appearance === 'schedule') applyLook(); }, 60000);
  window.addEventListener('hashchange', route);

  shell();
  route();
})();
