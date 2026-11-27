// MATRICE — prototype UX/UI V6 (tableau de bord Bento, navigation Liquid Glass, préférences, panneau latéral).
// JavaScript natif, sans framework ni dépendance chargée en ligne. Données : js/data.js (fictives).
// Préférences : stockage local de ce navigateur uniquement (arbitrage A12) — aucune base, aucun service réel.
(() => {
  'use strict';
  const D = window.MATRICE_DATA, IC = window.MATRICE_ICONS || {};
  const root = document.documentElement;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => [...(r || document).querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
  const NUM = new Intl.NumberFormat('fr-FR');
  const NUM1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const eur = n => `${NUM.format(n)} €`;
  const day = iso => new Date(iso + 'T12:00:00');
  const dShort = iso => day(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const dLong = iso => day(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dWeek = iso => day(iso).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mq = q => window.matchMedia(q);
  const MQ = { phone: mq('(max-width:760px)'), tablet: mq('(max-width:1023px)'), dark: mq('(prefers-color-scheme: dark)'), still: mq('(prefers-reduced-motion: reduce)') };
  const device = () => MQ.phone.matches ? 'phone' : MQ.tablet.matches ? 'tablet' : 'desktop';
  const DEVICE_LABEL = { desktop: 'ordinateur', tablet: 'tablette', phone: 'téléphone' };
  const MONTHS = ['oct', 'nov', 'déc', 'jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep'];   // abréviations sans ambiguïté
  const motionMs = () => (P.motion && !MQ.still.matches) ? 180 : 0;

  const TABS = D.MODULES.flatMap(m => m.tabs.map(t => ({ ...t, module: m })));
  const tabById = id => TABS.find(t => t.id === id);
  const modById = id => D.MODULES.find(m => m.id === id);

  // ───────────────────────── Préférences (stockage local, A12)
  const KEY = 'matrice-proto.prefs.v1';
  const fromProfile = p => { const pr = D.PROFILES[p]; return { profile: p, order: [...pr.order], shortcuts: [...pr.shortcuts], kpis: [...pr.kpis] }; };
  const DEFAULTS = () => ({
    ...fromProfile('booking'), hidden: [], folded: [], blocks: ['dates', 'billetterie', 'taches', 'relances', 'pipeline', 'finances', 'messages'], hiddenBlocks: [], layout: 6,
    appearance: 'system', darkFrom: '19:00', darkTo: '07:30', density: { desktop: 'compacte', tablet: 'compacte', phone: 'compacte' },
    palette: 'lagoon', bgLight: 'glacier', textSize: 1, weight: 'normal', leading: 'normal', tracking: 'normal', contrast: 'normal', zebra: true, glass: true, motion: true, mini: false, owner: true,
  });
  function load(){
    try { const raw = localStorage.getItem(KEY); if (raw){ const v = JSON.parse(raw); return migrate({ ...DEFAULTS(), ...v, density: { ...DEFAULTS().density, ...(v.density || {}) } }); } }
    catch { /* stockage indisponible : réglages par défaut */ }
    return DEFAULTS();
  }
  // Blocs des versions précédentes : « Cachets par mois » → Finances ; « Suivis à relancer » → Suivis actifs + Relances prioritaires
  function migrate(v){
    const known = DEFAULTS().blocks, map = b => b === 'cachets' ? ['finances'] : b === 'suivis' ? ['pipeline', 'relances'] : [b];
    v.blocks = [...new Set((v.blocks || []).flatMap(map).filter(b => known.includes(b)))];
    if ((v.layout || 0) < 6){ v.blocks = [...known]; v.layout = 6; }   // V6 : ordre des colonnes Bento (Modules retiré du tableau de bord)
    known.forEach(b => { if (!v.blocks.includes(b)) v.blocks.push(b); });
    v.hiddenBlocks = (v.hiddenBlocks || []).flatMap(map).filter(b => known.includes(b));
    if (!['apple', 'glacier', 'mineral'].includes(v.bgLight)) v.bgLight = 'glacier';
    delete v.hot;
    return v;
  }
  let P = load();
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* sans stockage : réglages gardés le temps de la visite */ } }

  // État de la page (non enregistré)
  const S = { tab: 'tableau-de-bord', views: { fin: 'chart', billetterie: 'chart' }, finP: '1A', sel: null, done: [], datesAll: false, notifRead: false, panel: null, panelFrom: null, openDate: null };

  const allowed = t => !(t.owner && !P.owner);          // A8 : Mails masqué hors titulaire ; contrôle serveur inchangé
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
    const host = root.getAttribute('data-theme');
    if (host === 'dark' || host === 'light') return host === 'dark';
    return MQ.dark.matches;
  }
  function applyLook(){
    const a = {
      'data-appearance': darkNow() ? 'dark' : 'light', 'data-density': P.density[device()] || 'compacte', 'data-weight': P.weight, 'data-leading': P.leading,
      'data-tracking': P.tracking, 'data-contrast': P.contrast, 'data-motion': P.motion ? 'on' : 'off', 'data-glass': P.glass ? 'on' : 'off',
      'data-zebra': P.zebra ? 'on' : 'off', 'data-palette': P.palette === 'opal' ? 'opal' : 'lagoon', 'data-bg': P.bgLight, 'data-tsl': P.textSize >= 1.125 ? 'l' : 'n',
    };
    Object.entries(a).forEach(([k, v]) => root.setAttribute(k, v));
    root.style.setProperty('--ts', String(P.textSize));
    $('.app')?.classList.toggle('mini', !!P.mini && device() === 'desktop');
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
  const statusPill = s => `<span class="st">${marker(s)}<span>${esc(s)}</span></span>`;   // V5 : libellé complet partout (onze statuts distincts)

  // ───────────────────────── Coque
  function shell(){
    document.body.innerHTML = `<a class="skip" href="#main">Aller au contenu</a>
      <div class="app">
        <aside class="side glassy" id="side" aria-label="Navigation principale"></aside>
        <div class="scrim" data-act="closeDrawer"></div>
        <div class="work">
          <header class="top" id="top"></header>
          <main id="main" tabindex="-1"></main>
          <nav class="bottom" id="bottom" aria-label="Raccourcis"></nav>
        </div>
        <aside class="dock" id="dock" aria-label="Panneau de consultation" hidden></aside>
      </div>
      <div class="toasts" role="status" aria-live="polite"></div>
      <dialog class="psheet" id="psheet" aria-labelledby="pnl-title"></dialog>
      <dialog class="modal" id="search" aria-label="Recherche globale"></dialog>
      <dialog class="modal" id="confirm" aria-labelledby="confirm-title"></dialog>
      <dialog class="sheet" id="sheet" aria-label="Modules"></dialog>`;
  }

  const navLink = (t, label = t.label, cls = '') => `<a class="nav-item ${cls}" href="#${t.id}" data-go="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''} title="${esc(label)}">${icon(t.icon)}<span class="lbl">${esc(label)}</span></a>`;
  function navTree({ sheet = false } = {}){
    const sc = P.shortcuts.map(tabById).filter(t => t && allowed(t));
    const mods = visibleModules().map(m => {
      const tabs = m.tabs.filter(allowed); if (!tabs.length) return '';
      if (m.id === 'accueil') return navLink(tabs[0], m.label, 'nav-mod');
      const open = sheet || !P.folded.includes(m.id), cur = tabs.some(t => t.id === S.tab);
      return `<button class="nav-item nav-mod ${cur ? 'has-current' : ''}" type="button" data-act="${sheet ? 'noop' : 'fold'}" data-id="${m.id}" aria-expanded="${open}" title="${esc(m.label)}">${icon(m.icon)}<span class="lbl">${esc(m.label)}</span>${sheet ? '' : icon('chevron-down', 'sm chev')}</button>
        <div class="nav-tabs" ${open ? '' : 'hidden'}>${tabs.map(t => navLink(t)).join('')}</div>`;
    }).join('');
    return `${sc.length ? `<div class="side-label">${icon('star', 'sm')}<span class="eyebrow">Raccourcis</span></div>${sc.map(t => navLink(t)).join('')}` : ''}
      <div class="side-label"><span class="eyebrow">Modules</span></div>${mods}`;
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  function renderSide(){
    $('#side').innerHTML = `<div class="side-head">
        <a class="brand" href="#tableau-de-bord" data-go="tableau-de-bord" aria-label="MATRICE — tableau de bord"><span class="brand-name">MATRICE</span><span class="slashes" aria-hidden="true"><i></i><i></i><i></i></span></a>
        <button class="btn ghost icon sm collapse-btn" type="button" data-act="mini" aria-label="${P.mini ? 'Déplier la barre latérale' : 'Réduire la barre latérale'}" title="${P.mini ? 'Déplier' : 'Réduire'}">${icon(P.mini ? 'panel-left-open' : 'panel-left-close', 'sm')}</button>
        <button class="btn ghost icon sm only-tablet" type="button" data-act="closeDrawer" aria-label="Fermer le menu">${icon('x', 'sm')}</button>
      </div>
      <button class="side-search" type="button" data-act="search" aria-label="Rechercher (${isMac ? 'Cmd' : 'Ctrl'} + K)" title="Rechercher">${icon('search', 'sm')}<span>Rechercher</span><kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd></button>
      <div class="side-scroll">${navTree()}</div>
      <div class="side-foot"><span class="avatar" aria-hidden="true">A</span><span class="who"><b>Anthony</b><span class="muted">Compte de démonstration</span></span>
        <a class="btn ghost icon sm" href="#preferences" data-go="preferences" aria-label="Préférences personnelles" title="Préférences personnelles">${icon('sliders-horizontal', 'sm')}</a></div>`;
  }
  function renderTop(){
    const t = tabById(S.tab);
    $('#top').innerHTML = `<a class="brand brand-top" href="#tableau-de-bord" data-go="tableau-de-bord" aria-label="MATRICE — tableau de bord"><span>MATRICE</span><span class="slashes" aria-hidden="true"><i></i><i></i><i></i></span></a><button class="btn ghost icon only-tablet" type="button" data-act="drawer" aria-label="Ouvrir le menu" aria-controls="side">${icon('menu')}</button>
      <div class="crumb"><span>${esc(t.module.label)}</span>${t.module.tabs.length > 1 ? `${icon('chevron-right', 'sm')}<b>${esc(t.label)}</b>` : ''}</div>
      <span class="proto-flag">Prototype</span>
      <button class="btn ghost icon" type="button" data-act="search" aria-label="Rechercher" title="Rechercher (${isMac ? '⌘' : 'Ctrl'} + K)">${icon('search')}</button>
      <button class="btn ghost icon" type="button" data-act="notifs" aria-label="Notifications${S.notifRead ? '' : ' (3 non lues)'}" aria-haspopup="dialog">${icon('bell')}${S.notifRead ? '' : '<span class="bell-dot" aria-hidden="true"></span>'}</button>`;
  }
  function renderBottom(){
    const sc = P.shortcuts.map(tabById).filter(t => t && allowed(t)).slice(0, 4);
    const inSc = sc.some(t => t.id === S.tab);
    $('#bottom').innerHTML = `<div class="bottom-bar glassy">${sc.map(t => `<a href="#${t.id}" data-go="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''}>${icon(t.icon)}<span class="lbl">${esc(t.label)}</span></a>`).join('')}
      <button type="button" data-act="sheet" aria-haspopup="dialog" ${inSc ? '' : 'aria-current="page"'}>${icon('layout-grid')}<span class="lbl">Modules</span></button></div>`;
  }

  // ───────────────────────── Pages
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function pageHead(t, { sub = '', acts = '' } = {}){
    const pinned = P.shortcuts.includes(t.id);
    const tabs = t.module.tabs.filter(allowed);
    const strip = tabs.length > 1 ? `<nav class="subtabs" aria-label="${esc(t.module.label)}">${tabs.map(x => `<a href="#${x.id}" data-go="${x.id}" ${x.id === t.id ? 'aria-current="page"' : ''}>${esc(x.label)}</a>`).join('')}</nav>` : '';
    return `<div class="page-head"><div class="grow"><h1>${esc(t.label)}</h1><p class="sub">${sub}<span class="chip">Données fictives</span></p></div>
      <div class="acts">${acts}<button class="btn ghost icon tool" type="button" data-act="pin" data-id="${t.id}" aria-pressed="${pinned}" aria-label="${pinned ? 'Retirer des raccourcis' : 'Ajouter aux raccourcis'}" title="${pinned ? 'Retirer des raccourcis' : 'Ajouter aux raccourcis'}">${icon('star', 'sm')}</button></div></div>${strip}`;
  }

  function renderMain(){
    const t = tabById(S.tab), main = $('#main'), keep = main.dataset.tab === S.tab ? main.scrollTop : 0;
    main.dataset.tab = S.tab;
    main.innerHTML = `<div class="page">${S.tab === 'tableau-de-bord' ? dashboard() : S.tab === 'preferences' ? prefsPage() : placeholder(t)}</div>`;
    main.scrollTop = keep;
    applyVars(main);
    const fig = $('#fig-fin', main); if (fig) mountChart(fig);
  }
  const applyVars = r => { [['w', '--w'], ['s', '--s'], ['h', '--h']].forEach(([k, v]) => $$(`[data-${k}]`, r).forEach(el => el.style.setProperty(v, el.dataset[k]))); };

  // Valeurs : exactes ; sur téléphone, forme abrégée au-delà de 10 000 € (valeur exacte lue par les lecteurs d'écran)
  function kpiValue(k){
    if (k.eur){
      const full = `${esc(NUM.format(k.value))}<span class="u">€</span>`;
      return k.value >= 10000 ? `<span class="k-full">${full}</span><span class="k-short" aria-hidden="true">${esc(NUM1.format(k.value / 1000))}<span class="u">k€</span></span>` : full;
    }
    const m = String(k.value).match(/^(.*?)\s*%$/);
    return m ? `${esc(m[1])}<span class="u">%</span>` : esc(k.value);
  }
  const money = n => `${esc(NUM.format(n))}<span class="u">€</span>`;
  const dMed = iso => day(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const dDay = iso => `${cap(dWeek(iso))}. ${dShort(iso)}`;
  const daysFrom = iso => Math.round((day(iso) - day(D.TODAY)) / 864e5);

  function dashboard(){
    const t = tabById('tableau-de-bord');
    const blocks = P.blocks.filter(b => !P.hiddenBlocks.includes(b) && BLOCK[b]);
    return pageHead(t, { sub: `<span>${esc(cap(dLong(D.TODAY)))}</span>`,
        acts: `<button class="btn ghost icon tool" type="button" data-act="customize" aria-label="Personnaliser le tableau de bord" title="Personnaliser le tableau de bord">${icon('sliders-horizontal', 'sm')}</button>` })
      + hero()
      + `<div class="bento"><div class="pair">${[0, 1].map(c => col(blocks, c)).join('')}</div>${col(blocks, 2)}</div>`;
  }
  // Bento Mac : 3 colonnes indépendantes (gauche 31 %, centre 27 %, droite 42 %), sans hauteurs alignées de force
  const COL = { dates: 0, billetterie: 0, taches: 1, relances: 1, pipeline: 1, finances: 2, messages: 2 };
  const col = (blocks, c) => `<div class="col col-${c}">${blocks.filter(b => COL[b] === c).map(b => `<section class="card blk blk-${b}" aria-labelledby="h-${b}">${BLOCK[b]()}</section>`).join('')}</div>`;
  // Marqueur de section : pictogramme linéaire sur un petit support teinté par la palette
  const MARK = { dates: 'calendar-days', billetterie: 'ticket', taches: 'circle-check', relances: 'refresh-cw', pipeline: 'chart-column', finances: 'chart-spline', messages: 'mail' };
  const cardHead = (id, title, count, tools = '') => `<div class="card-head">${MARK[id] ? `<span class="sec-mk" aria-hidden="true">${icon(MARK[id])}</span>` : ''}<h2 id="h-${id}">${esc(title)}</h2>${count != null ? `<span class="count">${count}</span>` : ''}<span class="grow"></span>${tools}</div>`;
  const goBtn = (id, label) => `<a class="btn ghost sm go" href="#${id}" data-go="${id}" title="Ouvrir ${esc(label)}">${esc(label)}${icon('chevron-right', 'sm')}</a>`;
  const viewToggle = key => `<div class="chart-tools" role="group" aria-label="Affichage">
    <button class="btn sm icon" type="button" data-act="view" data-k="${key}" data-v="chart" aria-pressed="${S.views[key] === 'chart'}" aria-label="Graphique" title="Graphique">${icon('chart-line', 'sm')}</button>
    <button class="btn sm icon" type="button" data-act="view" data-k="${key}" data-v="table" aria-pressed="${S.views[key] === 'table'}" aria-label="Tableau des valeurs" title="Tableau des valeurs">${icon('table-2', 'sm')}</button></div>`;

  // 3.1 Booking — bloc signature : dégradé de la palette, courbe organique translucide, 4 indicateurs sur une ligne
  // V6 « Liquid Flow » : ruban translucide avec liseré lumineux, seconde courbe discrète pour le relief
  const HERO_CURVE = `<svg class="hero-curve" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="hf-band" class="hf-band" x1="0" x2="1" y1="0" y2="0"><stop offset="0"/><stop offset=".45"/><stop offset="1"/></linearGradient>
      <linearGradient id="hf-edge" class="hf-edge" x1="0" x2="1" y1="0" y2="0"><stop offset="0"/><stop offset=".35"/><stop offset=".7"/><stop offset="1"/></linearGradient>
      <linearGradient id="hf-depth" class="hf-depth" x1="0" x2="0" y1="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs>
    <rect class="hf-shadow" x="0" y="0" width="1200" height="200" fill="url(#hf-depth)"/>
    <path class="hf-ribbon" fill="url(#hf-band)" d="M0 128 C 170 120, 300 58, 470 70 S 760 168, 960 118 S 1130 30, 1200 26 L1200 70 C 1120 86, 1010 160, 900 170 S 640 132, 480 120 S 180 176, 0 186 Z"/>
    <path class="hf-edge-l" stroke="url(#hf-edge)" d="M0 128 C 170 120, 300 58, 470 70 S 760 168, 960 118 S 1130 30, 1200 26"/>
    <path class="hf-echo" d="M0 160 C 200 158, 330 104, 500 108 S 800 196, 990 150 S 1140 78, 1200 80"/></svg>`;
  function hero(){
    const kpis = P.kpis.map(k => D.KPIS[k]).filter(Boolean);
    const pr = D.PROFILES[P.profile];
    return `<section class="hero" aria-labelledby="h-hero">${HERO_CURVE}
      <div class="hero-top"><h2 id="h-hero">${esc(pr ? pr.label.split(' / ')[0] : 'Indicateurs')}</h2><span class="hero-meta">Saison 2026-2027</span></div>
      <dl class="hero-kpis">${kpis.map(k => `<div class="hk"><dt class="hk-l"><span class="hk-lf">${esc(k.label)}</span><span class="hk-ls" aria-hidden="true">${esc(k.m || k.label)}</span></dt>
        <dd class="hk-v">${kpiValue(k)}</dd><dd class="hk-n">${k.warn ? icon('triangle-alert') : ''}${esc(k.note)}</dd></div>`).join('')}</dl></section>`;
  }

  // 3.2 Prochaines dates — timeline mensuelle (statut complet, repère de forme et de couleur sur l'axe)
  function datesBlock(){
    const groups = [];
    D.DATES.forEach(d => { const k = d.date.slice(0, 7); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(d); });
    const y0 = D.TODAY.slice(0, 4), FIRST = 4, rest = D.DATES.length - FIRST;
    let k = 0; groups.forEach(g => { g.items.forEach(d => { d._more = k++ >= FIRST; }); g.more = g.items.every(d => d._more); });
    const more = rest > 0 ? `<button class="tl-more" type="button" data-act="moreDates" aria-expanded="${S.datesAll}">${S.datesAll ? 'Afficher moins' : `Afficher ${rest} date${rest > 1 ? 's' : ''} de plus`}${icon(S.datesAll ? 'chevron-up' : 'chevron-down', 'sm')}</button>` : '';
    return cardHead('dates', 'Prochaines dates', D.DATES.length, goBtn('booking', 'Booking'))
      + `<div class="tl${S.datesAll ? ' all' : ''}">${groups.map(g => { const n = g.items.length, y = g.k.slice(0, 4);
          const name = day(g.k + '-01').toLocaleDateString('fr-FR', { month: 'long' }) + (y !== y0 ? ' ' + y : '');
          const count = `${n} date${n > 1 ? 's' : ''}`;
          return `<div class="tl-month${g.more ? ' more' : ''}" role="group" aria-label="${esc(`${cap(name)}, ${count}`)}"><div class="tl-mh" aria-hidden="true"><span class="tl-mn">${esc(name)}</span><span class="tl-rule"></span><span class="tl-mc">${count}</span></div>
            ${g.items.map(d => `<div class="tl-ev${d._more ? ' more' : ''}" role="button" tabindex="0" data-act="date" data-id="${d.id}" ${S.openDate === d.id ? 'aria-current="true"' : ''} aria-label="${esc(`${dLong(d.date)}, ${d.artist}, ${d.venue}, ${d.city}, ${d.status}`)}">
              <span class="tl-day" aria-hidden="true"><b>${String(day(d.date).getDate()).padStart(2, '0')}</b><span>${esc(dWeek(d.date))}.</span></span>
              <span class="tl-axis">${marker(d.status)}</span>
              <span class="tl-body" aria-hidden="true"><span class="tl-l1"><b class="tl-a">${esc(d.artist)}</b><span class="tl-s">${esc(d.status)}</span></span><span class="tl-p">${esc(d.venue)} — ${esc(d.city)}</span></span></div>`).join('')}</div>`; }).join('')}</div>${more}`;
  }

  // 3.3 Tâches — rappels : 4 compteurs, puis les tâches à traiter en priorité (case « Marquer comme faite » conservée)
  function taskList(){
    return D.TASKS.map((x, i) => ({ ...x, i, done: x.done || (S.done.includes(i) ? D.TODAY : null) }));
  }
  function tasksBlock(){
    const T = taskList(), open = T.filter(x => !x.done);
    const c = { late: open.filter(x => x.due < D.TODAY).length, today: open.filter(x => x.due === D.TODAY).length, next: open.filter(x => x.due > D.TODAY).length,
      done: T.filter(x => x.done && daysFrom(x.done) >= -30).length };
    const tiles = [['late', 'En retard', 'triangle-alert'], ['today', 'Aujourd’hui', 'sun'], ['next', 'À venir', 'calendar-clock'], ['done', 'Terminées', 'check']];
    const prio = open.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
    return cardHead('taches', 'Tâches', null, goBtn('todo', 'To Do'))
      + `<div class="rem-grid">${tiles.map(([k, l, ic]) => `<div class="rem rem-${k}"><span class="rem-ico" aria-hidden="true">${icon(ic)}</span><span class="rem-n">${c[k]}</span>
          <span class="rem-l">${esc(l)}${k === 'done' ? '<span class="rem-p"> · 30 j</span><span class="sr"> ces 30 derniers jours</span>' : ''}</span></div>`).join('')}</div>`
      + (prio.length ? `<ul class="tasks" aria-label="À traiter en priorité">${prio.map(x => { const d = daysFrom(x.due);
          const st = d < 0 ? ['late', `En retard · ${-d} j`] : d === 0 ? ['today', 'Aujourd’hui'] : ['next', dDay(x.due)];
          return `<li class="tk-row"><label class="tick-w"><input type="checkbox" class="tick" data-tick="${x.i}" aria-label="Marquer comme faite : ${esc(x.t)}"></label>
            <span class="tk-b"><span class="tk-t">${esc(x.t)}</span><span class="tk-m">${esc(x.proj)} · ${esc(x.pole)}</span></span><span class="tk-st st-${st[0]}">${d < 0 ? icon('triangle-alert', 'sm') : ''}${esc(st[1])}</span></li>`; }).join('')}</ul>`
        : '<p class="empty">Aucune tâche ouverte.</p>');
  }

  // 3.4 Finances — chiffre d'affaires HT de la période, courbe réalisé / prévisionnel, encaissements TTC
  const FIN_P = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1A', '1A'], ['ALL', 'Tout']];
  const ymOf = i => { const [y, m] = D.FIN.start.split('-').map(Number), t = y * 12 + (m - 1) + i; return [Math.floor(t / 12), t % 12]; };
  const CUR = (() => { const [y, m] = D.TODAY.split('-').map(Number), [y0, m0] = D.FIN.start.split('-').map(Number); return (y - y0) * 12 + (m - m0); })();
  const MON3 = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const sum = a => a.reduce((s, v) => s + (v || 0), 0);
  function finSeries(p){
    const M = D.FIN.months, dToday = Number(D.TODAY.slice(8, 10));
    const mo = (i, full) => { const [y, m] = ymOf(i); return full ? `${MON3[m]} ${y}` : MON3[m] + (m === 0 || full === 0 ? ` ${String(y).slice(2)}` : ''); };
    const monthPts = (a, b) => M.slice(a, b + 1).map((x, k) => ({ lab: mo(a + k), long: mo(a + k, true), real: x.real, plan: x.plan, partial: a + k === CUR }));
    const n1 = (a, b) => sum(M.slice(a - 12, b - 12).map(x => x.real)) + D.FIN.n1ToDate;   // même période un an plus tôt, mois en cours à date
    const fy = CUR - ((ymOf(CUR)[1] + 3) % 12);   // premier mois de l'exercice (octobre)
    if (p === '1M'){
      const pts = D.FIN.weeks.map((w, k) => ({ lab: dMed(w.d), long: `semaine du ${dMed(w.d)}`, real: w.real, plan: w.plan, partial: k === 3 }));
      return { pts, title: cap(mo(CUR, true)), real: sum(pts.map(x => x.real)), prev: D.FIN.n1ToDate, prevLab: `${mo(CUR - 12, true)} à date`, plan: sum(pts.map(x => x.plan)), today: 3 + (dToday - 23) / 7 };
    }
    if (p === '3M' || p === '6M'){ const n = p === '3M' ? 3 : 6, a = CUR - n + 1, pts = monthPts(a, CUR);
      return { pts, title: `${mo(a, true)} – ${mo(CUR, true)}`, real: sum(pts.map(x => x.real)), prev: n1(a, CUR), prevLab: 'même période l’an dernier, à date' }; }
    if (p === '1A'){ const pts = monthPts(fy, fy + 11);
      return { pts, title: `Exercice ${ymOf(fy)[0]}-${ymOf(fy)[0] + 1}`, real: sum(pts.map(x => x.real)), prev: n1(fy, CUR), prevLab: `exercice ${ymOf(fy)[0] - 1}-${ymOf(fy)[0]} à date`,
        plan: sum(pts.map(x => x.plan)), today: CUR - fy + (dToday - 1) / 30 }; }
    const pts = monthPts(0, M.length - 1);
    return { pts, title: `Depuis ${mo(0, true)}`, real: sum(pts.map(x => x.real)), prev: null, today: CUR + (dToday - 1) / 30, every: 6 };
  }
  function finBlock(){
    const f = finSeries(S.finP), F = D.FIN;
    const pct = f.prev ? (f.real - f.prev) / f.prev * 100 : null, up = pct != null && pct >= 0;
    return cardHead('finances', 'Finances', null, viewToggle('fin') + goBtn('finances', 'Finances'))
      + `<div class="fin-top"><span class="fin-k">Chiffre d’affaires HT · ${esc(f.title)}</span>
        <div class="fin-v"><span class="fin-big">${money(f.real)}</span>${pct != null ? `<span class="fin-d ${up ? 'up' : 'down'}">${icon(up ? 'trending-up' : 'trending-down', 'sm')}${up ? '+' : '−'}${esc(NUM1.format(Math.abs(pct)))} %</span>` : ''}</div>
        <span class="fin-s">Réalisé au ${esc(dShort(D.TODAY))}${f.prev ? ` · ${esc(eur(f.prev))} ${esc(f.prevLab)}` : ''}${f.plan ? ` · prévisionnel ${esc(eur(f.plan))}` : ''}</span></div>`
      + `<p class="fin-lg"><span><i class="lg-real"></i>Réalisé</span><span><i class="lg-plan"></i>Prévisionnel</span></p>`
      + (S.views.fin === 'chart'
        ? `<div class="fig" id="fig-fin" role="group" aria-label="${esc(`Chiffre d’affaires HT, ${f.title} : réalisé et prévisionnel. Valeurs exactes au survol, au toucher ou dans le tableau.`)}"></div>`
        : `<div class="fin-tbl"><div class="tbl-wrap" tabindex="0" role="region" aria-label="Chiffre d’affaires HT"><table class="tbl"><thead><tr><th>Période</th><th class="num">Réalisé</th><th class="num">Prévisionnel</th></tr></thead><tbody>
          ${f.pts.map(x => `<tr><td>${esc(x.long)}</td><td class="num">${x.real == null ? '<span class="muted">—</span>' : esc(eur(x.real)) + (x.partial ? ' <span class="muted">à date</span>' : '')}</td><td class="num">${x.plan == null ? '<span class="muted">—</span>' : esc(eur(x.plan))}</td></tr>`).join('')}</tbody></table></div></div>`)
      + `<div class="seg per" role="radiogroup" aria-label="Période">${FIN_P.map(([v, l]) => `<label><input type="radio" name="finp" value="${v}" data-finp ${S.finP === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`
      + `<div class="fin-tiles" role="group" aria-label="Encaissements au ${esc(dShort(D.TODAY))}, TTC">
          <div class="ft"><span class="ft-l">Encaissé TTC</span><span class="ft-v">${money(F.encaisse)}</span></div>
          <div class="ft"><span class="ft-l">À encaisser TTC</span><span class="ft-v">${money(F.aEncaisser)}</span></div>
          <button class="ft ft-due" type="button" data-act="due"><span class="ft-l">Échu non soldé TTC</span><span class="ft-v">${money(F.echu)}</span><span class="ft-n">${F.echuN} factures</span><span class="sr">, compris dans le montant à encaisser</span></button></div>`;
  }

  // 3.5 Billetterie — jauges horizontales compactes, toutes les informations au-dessus de la jauge
  function ticketsBlock(){
    const list = D.DATES.filter(d => d.capacity && d.status.startsWith('Confirmée'));
    return cardHead('billetterie', 'Billetterie', list.length, viewToggle('billetterie') + goBtn('ticketing', 'Ticketing'))
      + (S.views.billetterie === 'chart'
        ? `<div class="tix">${list.map(d => { const pct = Math.round(d.sold / d.capacity * 100), ok = d.sold >= d.seuil;
            return `<div class="tix-ev"><b class="tix-a">${esc(d.artist)}</b><span class="tix-n">${NUM.format(d.sold)} / ${NUM.format(d.capacity)}</span><span class="tix-p">${pct} %</span>
              <span class="tix-w">${esc(dMed(d.date))} · ${esc(d.city.replace(/\s*\(.*\)$/, ''))}</span><span class="tix-b">Break : ${NUM.format(d.seuil)}</span>
              <span class="tix-s ${ok ? 'ok' : 'miss'}">${ok ? icon('check', 'sm') + 'Atteint' : `Manque ${NUM.format(d.seuil - d.sold)}`}</span>
              <span class="tix-bar" role="img" aria-label="${esc(`${d.sold} billets vendus sur ${d.capacity}, soit ${pct} %. Break à ${d.seuil} billets : ${ok ? 'atteint' : `il manque ${d.seuil - d.sold} billets`}.`)}"><span class="tix-fill" data-w="${pct}%"></span><span class="tix-mark" data-s="${(d.seuil / d.capacity * 100).toFixed(1)}%"></span></span></div>`; }).join('')}</div>`
        : `<div class="card-body"><div class="tbl-wrap" tabindex="0" role="region" aria-label="Billetterie"><table class="tbl"><thead><tr><th>Date</th><th>Artiste</th><th class="num">Vendus</th><th class="num">Jauge</th><th class="num">Break</th></tr></thead><tbody>
          ${list.map(d => `<tr><td class="mono">${esc(dShort(d.date))}</td><td>${esc(d.artist)}</td><td class="num">${NUM.format(d.sold)}</td><td class="num">${NUM.format(d.capacity)}</td><td class="num">${NUM.format(d.seuil)}</td></tr>`).join('')}</tbody></table></div></div>`);
  }

  // 3.6 Prospection — bloc 1 : suivis actifs (histogramme) ; bloc 2 : relances prioritaires
  function pipelineBlock(){
    const L = D.SUIVIS_ACTIFS, tot = sum(L.map(x => x.n)), max = Math.max(...L.map(x => x.n));
    return cardHead('pipeline', 'Suivis actifs', null, goBtn('suivi', 'Suivi'))
      + `<div class="pipe"><p class="pipe-tot"><span class="pipe-big">${tot}</span><span class="pipe-cap">suivis actifs, hors confirmés et clos</span></p>
        <ul class="bars" aria-label="Répartition par statut">${L.map(x => `<li class="bar b-${x.k}"><span class="bar-c"><span class="bar-v">${x.n}</span><span class="bar-f" data-h="${(x.n / max).toFixed(3)}"></span></span><span class="bar-l">${esc(x.l)}</span></li>`).join('')}</ul></div>`;
  }
  function relancesBlock(){
    const L = [...D.RELANCES].sort((a, b) => a.due.localeCompare(b.due));
    return cardHead('relances', 'Relances prioritaires', L.length, goBtn('suivi', 'Suivi'))
      + `<ul class="rl">${L.map(x => { const d = daysFrom(x.due), late = d < 0;
          return `<li><a class="rl-row" href="#suivi" data-go="suivi"><span class="rl-b"><b>${esc(x.s)}</b><span class="rl-m">${esc(x.proj)} · ${esc(x.city)} · ${esc(x.st)}</span></span>
            <span class="rl-d ${late ? 'late' : d === 0 ? 'today' : ''}">${late ? icon('triangle-alert', 'sm') + `En retard · ${-d} j` : d === 0 ? 'Aujourd’hui' : esc(dDay(x.due))}</span>${icon('chevron-right', 'sm rl-c')}</a></li>`; }).join('')}</ul>`;
  }

  // 3.7 Messagerie — ligne d'indicateurs discrète, puis les derniers échanges
  const initials = s => s.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avTone = s => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;
  function messagesBlock(){
    if (!P.owner) return cardHead('messages', 'Messagerie') + `<p class="empty">Boîte réservée à son titulaire : ce bloc et l’onglet Mails sont masqués pour ce compte.</p>`;
    const C = D.MAIL_COUNTS;
    return cardHead('messages', 'Messagerie', null, goBtn('mails', 'Mails'))
      + `<p class="mx-line"><a class="mx-unread" href="#mails" data-go="mails">${C.unread} non lus</a><span aria-hidden="true">·</span><a href="#mails" data-go="mails">${C.reply} à répondre</a><span aria-hidden="true">·</span><a href="#mails" data-go="mails">${C.link} à rattacher</a></p>`
      + `<ul class="mx">${D.MESSAGES.map(m => `<li class="mx-row ${m.unread ? 'is-unread' : ''}"><span class="av av-${avTone(m.from)}" aria-hidden="true">${esc(initials(m.from))}</span>
          <span class="mx-b"><span class="mx-1"><span class="mx-f">${esc(m.from)} <span class="mx-o">· ${esc(m.org)}</span></span><span class="mx-at">${esc(m.at)}</span></span>
          <span class="mx-s">${esc(m.subj)}</span><span class="mx-p">${esc(m.proj)}</span></span>${m.unread ? '<span class="mx-dot"><span class="sr">Non lu</span></span>' : '<span></span>'}</li>`).join('')}</ul>`;
  }

  // 3.8 Modules — Backstage Control : carré dégradé contenant le pictogramme, nom, chevron
  function moduleTiles(){
    return visibleModules().map(m => { const tabs = m.tabs.filter(allowed); if (!tabs.length) return '';
      const cur = tabs.some(t => t.id === S.tab);
      return `<a class="mt" href="#${tabs[0].id}" data-go="${tabs[0].id}" ${cur ? 'aria-current="true"' : ''}><span class="mt-i" aria-hidden="true">${icon(m.icon)}</span>
        <span class="mt-t"><b>${esc(m.label)}</b><span class="mt-s">${esc(tabs.map(t => t.label).join(' · '))}</span></span>${icon('chevron-right', 'sm mt-c')}</a>`; }).join('');
  }
  const BLOCK = { dates: datesBlock, finances: finBlock, taches: tasksBlock, billetterie: ticketsBlock, pipeline: pipelineBlock, relances: relancesBlock, messages: messagesBlock };

  // Courbe : interpolation monotone (passe exactement par chaque valeur, sans bosse ni creux inventés), aire en dégradé sous le réalisé
  function smooth(pts){   // Fritsch–Carlson
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
    const n = pts.length, dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++){ dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++){ const h = dx[i] / 3; d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`; }
    return d;
  }
  const runs = (pts, key, x, y) => { const out = []; let cur = []; pts.forEach((p, i) => { if (p[key] == null){ if (cur.length) out.push(cur); cur = []; } else cur.push([x(i), y(p[key])]); }); if (cur.length) out.push(cur); return out; };
  let chartObserver = null, chartDraw = () => {};
  function mountChart(fig){
    if (chartObserver) chartObserver.disconnect();
    const draw = chartDraw = () => {
      const W = fig.clientWidth, H = fig.clientHeight; if (!W || !H) return;
      const f = finSeries(S.finP), pts = f.pts, n = pts.length;
      const ml = 4, mr = 34, mb = 18, mt = 10;
      const top = Math.max(...pts.map(p => Math.max(p.real || 0, p.plan || 0)));
      const max = Math.ceil(top * 1.12 / 1000) * 1000 || 1000;
      const step = (W - ml - mr) / Math.max(n - 1, 1), x = i => ml + step * i, y = v => mt + (H - mt - mb) * (1 - v / max);
      const k = v => `${NUM.format(Math.round(v / 1000))} k€`;
      let s = `<defs><linearGradient id="g-line" class="g-line" x1="0" x2="1" y1="0" y2="0"><stop offset="0"/><stop offset=".55"/><stop offset="1"/></linearGradient>
        <linearGradient id="g-fill" class="g-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>
        <filter id="g-blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="4"/></filter></defs>`;
      s += [0, max / 2, max].map((v, i) => `<line class="${i ? 'grid-l' : 'base-l'}" x1="${ml}" x2="${W - mr + 4}" y1="${y(v)}" y2="${y(v)}"/>${i ? `<text class="axis-t" x="${W}" y="${y(v) + 3.5}" text-anchor="end">${k(v)}</text>` : ''}`).join('');
      runs(pts, 'plan', x, y).forEach(r => { s += `<path class="line-plan" d="${smooth(r)}"/>`; });
      runs(pts, 'real', x, y).forEach(r => { const d = smooth(r); s += `<path class="area-real" d="${d} L${r[r.length - 1][0]},${y(0)} L${r[0][0]},${y(0)} Z"/><path class="line-real" d="${d}"/>`; });
      if (f.today != null && f.today < n - 1){ const tx = ml + step * f.today; s += `<line class="today" x1="${tx}" x2="${tx}" y1="${mt - 4}" y2="${y(0)}"/><text class="today-t" x="${tx + 4}" y="${mt + 2}">auj.</text>`; }
      const every = f.every || (n > 8 ? 2 : 1);
      s += pts.map((p, i) => `${p.real != null && n <= 12 ? `<circle class="dot-real" cx="${x(i)}" cy="${y(p.real)}" r="2.75"/>` : ''}${i % every === 0 ? `<text class="axis-t" x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(p.lab)}</text>` : ''}`).join('');
      if (S.sel != null && pts[S.sel]){ const p = pts[S.sel], v = p.real ?? p.plan, cx = x(S.sel), cy = y(v);
        s += `<line class="sel-line" x1="${cx}" x2="${cx}" y1="${cy}" y2="${y(0)}"/><circle class="sel-glow" cx="${cx}" cy="${cy}" r="8"/><circle class="sel-dot" cx="${cx}" cy="${cy}" r="4.5"/>`; }
      s += pts.map((p, i) => { const aria = `${p.long} : ${p.real == null ? 'pas de réalisé' : 'réalisé ' + eur(p.real) + (p.partial ? ' à date' : '')}${p.plan == null ? '' : ', prévisionnel ' + eur(p.plan)}`;
        return `<rect class="hit" x="${x(i) - step / 2}" y="${mt}" width="${step}" height="${H - mt - mb}" tabindex="0" role="button" data-m="${i}" aria-label="${esc(aria)}" aria-pressed="${S.sel === i}"/>`; }).join('');
      fig.innerHTML = `<svg>${s}</svg>`;
      if (S.sel != null) showTip(fig, S.sel);
    };
    chartObserver = new ResizeObserver(draw); chartObserver.observe(fig); draw();
  }
  function showTip(fig, i){
    if (!fig) return;
    const p = finSeries(S.finP).pts[i], hit = $(`.hit[data-m="${i}"]`, fig); if (!p || !hit) return;
    $('.tip', fig)?.remove();
    const r = hit.getBoundingClientRect(), f = fig.getBoundingClientRect();
    const tip = document.createElement('div'); tip.className = 'tip';
    tip.innerHTML = `<b>${esc(cap(p.long))}</b><span class="mono">Réalisé ${p.real == null ? '—' : esc(eur(p.real)) + (p.partial ? ' à date' : '')}</span><br><span class="mono">Prévu ${p.plan == null ? '—' : esc(eur(p.plan))}</span>`;
    fig.appendChild(tip);
    const left = Math.min(Math.max(r.left - f.left + r.width / 2, tip.offsetWidth / 2), f.width - tip.offsetWidth / 2);
    tip.style.left = left + 'px'; tip.style.top = '-8px';
  }

  // Écran non prototypé : existant et accès transversaux
  function placeholder(t){
    if (t.owner && !P.owner) return pageHead(t) + `<section class="card placeholder"><h2>Accès réservé</h2><p class="muted">La boîte Mails est réservée à son titulaire. Pour ce compte, l’onglet est masqué de la navigation ; le contrôle d’accès reste assuré par le serveur.</p></section>`;
    return pageHead(t, { sub: `<span>${esc(t.module.label)}</span>` })
      + `<section class="card placeholder"><h2>Écran non prototypé à ce stade</h2>
        <p class="muted">Ce prototype couvre le tableau de bord, la navigation, les préférences et le panneau de consultation. Cet écran reprendra à l’identique les fonctionnalités actuelles lors de la généralisation.</p>
        <dl><dt>Dans MATRICE 1.68</dt><dd>${esc(t.from)}</dd>${t.cross ? `<dt>Accès transversaux conservés</dt><dd>${esc(t.cross)}</dd>` : ''}</dl></section>`
      + (t.id === 'booking' ? statusesCard() : '');
  }
  function statusesCard(){
    return `<section class="card"><div class="card-head"><h2>Représentation des statuts (A4)</h2></div><div class="pref-card">
      <p class="hint">Forme = type (carré : festival, rond : salle, losange : artiste) · remplissage = étape (contour : intérêt, point : option, plein : confirmée) · couleur fonctionnelle en complément · libellé toujours affiché.</p>
      <div class="legend-grid">${D.STATUSES.map(x => statusPill(x.s)).join('')}</div>
      <p class="eyebrow">Marqueurs de carte (aperçu)</p>
      <div class="map-demo" role="list">${D.STATUSES.map(x => `<span class="pin" role="listitem">${marker(x.s, 26)}<span>${esc(x.s)}</span></span>`).join('')}</div></div></section>`;
  }

  // Préférences personnelles (colonnes fluides)
  const seg = (name, cur, opts, label) => `<div class="seg" role="radiogroup" aria-label="${esc(label || name)}">${opts.map(([v, l]) => `<label><input type="radio" name="${esc(name)}" value="${esc(v)}" data-pref="${esc(name)}" ${String(cur) === String(v) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
  const sw = (id, label, on, hint = '', disabled = false) => `<label class="switch" for="${id}"><span class="txt">${esc(label)}${hint ? `<br><span class="hint">${esc(hint)}</span>` : ''}</span><input type="checkbox" role="switch" id="${id}" data-pref="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled aria-disabled="true"' : ''}></label>`;
  function prefsPage(){
    const t = tabById('preferences'), dev = device();
    const mods = P.order.map(modById).filter(Boolean);
    const sc = P.shortcuts.map(tabById).filter(Boolean);
    const free = TABS.filter(x => !P.shortcuts.includes(x.id) && allowed(x));
    const moveBtns = (kind, i, n, label) => `<button class="btn ghost sm icon" type="button" data-act="move" data-kind="${kind}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(label)}">${icon('arrow-up', 'sm')}</button>
      <button class="btn ghost sm icon" type="button" data-act="move" data-kind="${kind}" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(label)}">${icon('arrow-down', 'sm')}</button>`;
    const card = (id, title, body) => `<section class="card" aria-labelledby="${id}"><div class="pref-card"><h2 id="${id}">${title}</h2>${body}</div></section>`;
    return pageHead(t, { sub: '<span>Propres à ce compte et à ce navigateur</span>' }) + `<div class="prefs">
      ${card('p-look', 'Apparence', `<div class="pref-row"><span class="l">Identité chromatique</span>
        <div class="palettes" role="radiogroup" aria-label="Identité chromatique">
          <label class="pal pal-lagoon"><input type="radio" name="palette" value="lagoon" data-pref="palette" ${P.palette !== 'opal' ? 'checked' : ''}><span class="bar"></span><b>Electric Lagoon</b><span class="hexes"><span><i class="sw-lag1"></i>#247E91</span><span><i class="sw-lag2"></i>#72C9B4</span></span><span class="check" aria-hidden="true">${icon('check')}</span></label>
          <label class="pal pal-opal"><input type="radio" name="palette" value="opal" data-pref="palette" ${P.palette === 'opal' ? 'checked' : ''}><span class="bar"></span><b>Opal</b><span class="hexes"><span><i class="sw-op1"></i>#78B9AD</span><span><i class="sw-op2"></i>#A6B5E8</span><span><i class="sw-op3"></i>#D8A4C5</span></span><span class="check" aria-hidden="true">${icon('check')}</span></label>
        </div><p class="hint">Indépendante du mode clair, sombre ou automatique. Les couleurs des statuts ne changent pas.</p></div>
        <div class="pref-row"><span class="l">Fond clair</span>
        <div class="bgs" role="radiogroup" aria-label="Fond clair">${[['apple', 'Blanc Apple', '#F5F5F7'], ['glacier', 'Blanc glacier', '#EFF3F5'], ['mineral', 'Argent minéral', '#E8EBED']].map(([v, l, h]) =>
          `<label class="bgc bgc-${v}"><input type="radio" name="bgLight" value="${v}" data-pref="bgLight" ${P.bgLight === v ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><b>${l}</b><span class="hex">${h}${v === 'glacier' ? ' · défaut' : ''}</span></label>`).join('')}</div>
        <p class="hint">Utilisé en mode clair. Indépendant de l’identité chromatique et du mode ; le mode sombre garde le graphite.</p></div>
        <div class="pref-row"><span class="l">Mode</span>${seg('appearance', P.appearance, [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système'], ['schedule', 'Horaires']], 'Apparence')}
        ${P.appearance === 'schedule' ? `<div class="inline"><label class="field"><span>Sombre à partir de</span><input class="input" type="time" id="pf-from" data-pref="darkFrom" value="${esc(P.darkFrom)}"></label>
          <label class="field"><span>jusqu’à</span><input class="input" type="time" id="pf-to" data-pref="darkTo" value="${esc(P.darkTo)}"></label></div>` : ''}</div>`)}
      ${card('p-dens', 'Densité', `${seg('density', P.density[dev], [['compacte', 'Compacte'], ['standard', 'Standard'], ['confort', 'Confort']], 'Densité')}
        <p class="hint">Réglage propre à ce type d’appareil (${DEVICE_LABEL[dev]}).</p>`)}
      ${card('p-fx', 'Effets', `${sw('glass', 'Effets de verre', P.glass, 'Navigation et menus seulement, jamais sur les données')}
        ${MQ.still.matches ? sw('motion', 'Animations', false, 'Désactivées par votre système (réduction des animations) : réglage indisponible ici.', true) : sw('motion', 'Animations', P.motion, 'Panneaux, menus et fenêtres')}`)}
      ${card('p-read', 'Confort de lecture', `<div class="pref-row"><span class="l">Taille du texte</span>${seg('textSize', P.textSize, [['0.9', '90 %'], ['1', '100 %'], ['1.125', '112 %'], ['1.25', '125 %']], 'Taille du texte')}</div>
        <div class="pref-row"><span class="l">Graisse</span>${seg('weight', P.weight, [['normal', 'Normale'], ['strong', 'Renforcée']], 'Graisse')}</div>
        <div class="pref-row"><span class="l">Interligne</span>${seg('leading', P.leading, [['normal', 'Standard'], ['airy', 'Aéré']], 'Interligne')}</div>
        <div class="pref-row"><span class="l">Espacement des lettres</span>${seg('tracking', P.tracking, [['normal', 'Standard'], ['wide', 'Élargi']], 'Espacement des lettres')}</div>
        <div class="pref-row"><span class="l">Contraste</span>${seg('contrast', P.contrast, [['normal', 'Standard'], ['high', 'Renforcé']], 'Contraste')}</div>
        ${sw('zebra', 'Alternance des fonds des listes et tableaux', P.zebra)}`)}
      ${card('p-prof', 'Profil métier', `<p class="hint">Configuration de départ : ordre des modules, raccourcis, indicateurs. Ce n’est pas un rôle : les droits d’accès ne changent pas.</p>
        <div class="inline"><select class="input" id="pf-profile" aria-label="Profil métier">${Object.entries(D.PROFILES).map(([k, v]) => `<option value="${k}" ${P.profile === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}<option value="perso" ${P.profile === 'perso' ? 'selected' : ''}>Personnalisé</option></select>
        <button class="btn" type="button" data-act="applyProfile">Appliquer</button></div>`)}
      ${card('p-sc', 'Raccourcis', `<p class="hint">En tête de la barre latérale ; les 4 premiers forment la barre du bas sur téléphone.</p>
        ${sc.length ? `<ul class="order-list">${sc.map((x, i) => `<li><span class="t">${icon(x.icon, 'sm')}${esc(x.label)} <span class="hint">${esc(x.module.label)}</span></span>${moveBtns('shortcuts', i, sc.length, x.label)}
          <button class="btn ghost sm icon" type="button" data-act="unpin" data-id="${x.id}" aria-label="Retirer ${esc(x.label)} des raccourcis">${icon('x', 'sm')}</button></li>`).join('')}</ul>` : '<p class="hint">Aucun raccourci.</p>'}
        <div class="inline"><select class="input" id="pf-add" aria-label="Onglet à ajouter aux raccourcis">${free.map(x => `<option value="${x.id}">${esc(x.module.label)} › ${esc(x.label)}</option>`).join('')}</select>
          <button class="btn" type="button" data-act="addShortcut" ${free.length ? '' : 'disabled'}>${icon('plus', 'sm')}Ajouter</button></div>`)}
      ${card('p-mod', 'Modules', `<p class="hint">Ordre et visibilité dans la navigation. Masquer un module ne retire aucun droit : il reste accessible par la recherche.</p>
        <ul class="order-list">${mods.map((m, i) => { const off = P.hidden.includes(m.id);
          return `<li class="${off ? 'off' : ''}"><span class="t">${icon(m.icon, 'sm')}${esc(m.label)}</span>${moveBtns('order', i, mods.length, m.label)}
            <button class="btn ghost sm icon" type="button" data-act="hide" data-id="${m.id}" ${m.fixed ? 'disabled title="Toujours visible"' : ''} aria-pressed="${off}" aria-label="${off ? 'Afficher' : 'Masquer'} ${esc(m.label)}">${icon(off ? 'eye-off' : 'eye', 'sm')}</button></li>`; }).join('')}</ul>`)}
      ${card('p-prev', 'Aperçu d’un tableau', `<p class="hint">Densité, alternance, contraste et chiffres alignés (IBM Plex Mono).</p>
        <div class="tbl-wrap" tabindex="0" role="region" aria-label="Aperçu d’un tableau"><table class="tbl"><thead><tr><th>Date</th><th>Artiste</th><th>Statut</th><th class="num">Cachet HT</th></tr></thead><tbody>
          ${D.DATES.slice(0, 6).map(d => `<tr><td class="mono">${esc(dShort(d.date))}</td><td>${esc(d.artist)}</td><td>${statusPill(d.status)}</td><td class="num">${d.fee ? esc(eur(d.fee)) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>`)}
      ${card('p-acc', 'Compte de démonstration', sw('owner', 'Titulaire de la boîte Mails', P.owner, 'Décoché : onglet Mails et bloc Messages masqués (A8). Le contrôle réel reste sur le serveur.'))}
      ${card('p-reset', 'Paramètres par défaut', `<p class="hint">Revient au profil Booking / Diffusion et aux réglages d’origine.</p>
        <div><button class="btn" type="button" data-act="reset">${icon('rotate-ccw', 'sm')}Restaurer les paramètres par défaut</button></div>`)}
    </div>` + statusesCard();
  }

  // ───────────────────────── Panneau latéral : ancré et non bloquant sur Mac, feuille sur iPhone
  function panelShell(title, eyebrow, body, foot, meta = ''){
    return `<div class="pnl"><div class="pnl-head"><div class="ttl">${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}<h2 id="pnl-title" tabindex="-1">${esc(title)}</h2></div>
        <button class="btn ghost icon" type="button" data-act="closePanel" aria-label="Fermer le panneau">${icon('x')}</button>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
      <div class="pnl-body">${body}</div>${foot ? `<div class="pnl-foot">${foot}</div>` : ''}</div>`;
  }
  function openPanel(kind, html){
    if (!S.panel) S.panelFrom = document.activeElement;
    S.panel = kind;
    if (device() === 'phone'){
      const dlg = $('#psheet'); dlg.innerHTML = html; applyVars(dlg);
      if (!dlg.open) dlg.showModal();
      $('#pnl-title', dlg)?.focus();
      return;
    }
    const dock = $('#dock'), app = $('.app');
    dock.innerHTML = html; applyVars(dock); dock.hidden = false;
    requestAnimationFrame(() => { app.classList.add('dock-open'); $('#pnl-title', dock)?.focus({ preventScroll: true }); });
  }
  function closePanel({ restore = true } = {}){
    if (!S.panel) return;
    const from = S.panelFrom; S.panel = null; S.panelFrom = null;
    if (S.openDate){ S.openDate = null; $$('.tl-ev[aria-current]').forEach(r => r.removeAttribute('aria-current')); }
    const dlg = $('#psheet');
    if (dlg.open) animatedClose(dlg);
    const app = $('.app'), dock = $('#dock');
    if (app.classList.contains('dock-open')){ app.classList.remove('dock-open'); setTimeout(() => { if (!S.panel){ dock.hidden = true; dock.innerHTML = ''; } }, motionMs()); }
    if (restore && from?.isConnected) from.focus({ preventScroll: true });
  }
  function animatedClose(dlg){
    if (!dlg.open) return;
    const ms = motionMs(); if (!ms){ dlg.close(); return; }
    dlg.classList.add('closing');
    setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, ms);
  }
  function openDate(id){
    const d = D.DATES.find(x => x.id === id); if (!d) return;
    S.openDate = id;
    $$('.tl-ev').forEach(r => { if (r.dataset.id === id) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current'); });
    const pct = d.capacity ? Math.round(d.sold / d.capacity * 100) : 0;
    const body = `<div class="facts"><div class="fact"><span class="eyebrow">Date</span><span class="v">${esc(dShort(d.date))}</span><span class="hint">${esc(dLong(d.date))}</span></div>
        <div class="fact"><span class="eyebrow">Cachet HT</span><span class="v">${d.fee ? esc(eur(d.fee)) : '—'}</span><span class="hint">Contrat : ${esc(d.contract)}</span></div></div>
      <div class="pnl-sec"><h3>Lieu</h3><dl class="kv"><dt>Structure</dt><dd>${esc(d.venue)}</dd><dt>Ville</dt><dd>${esc(d.city)}</dd><dt>Artiste</dt><dd>${esc(d.artist)}</dd></dl></div>
      ${d.capacity ? `<div class="pnl-sec"><h3>Billetterie</h3><div class="meter"><span class="m-name">${NUM.format(d.sold)} vendus sur ${NUM.format(d.capacity)}</span><span class="m-val">${pct} %</span>
        <span class="m-track" role="img" aria-label="${esc(`${d.sold} billets vendus sur ${d.capacity}, seuil ${d.seuil}`)}"><span class="m-fill" data-w="${pct}%"></span><span class="m-seuil" data-s="${(d.seuil / d.capacity * 100).toFixed(1)}%"></span></span>
        <span class="m-state ${d.sold >= d.seuil ? 'ok' : ''}">${d.sold >= d.seuil ? icon('circle-check') + 'Seuil atteint' : `Seuil : ${NUM.format(d.seuil)} billets`}</span></div></div>` : ''}
      <p class="pnl-note">Consultation seule dans le prototype. Sur ordinateur, le panneau ne bloque pas l’espace de travail : cliquez sur une autre date pour l’afficher ici.</p>`;
    openPanel('date', panelShell(d.artist, 'Date', body, `<button class="btn" type="button" data-act="closePanel">Fermer</button><a class="btn primary" href="#production" data-go="production">Ouvrir dans Production</a>`,
      `${statusPill(d.status)}<span>${esc(d.venue)} · ${esc(d.city)}</span>`));
  }
  function customizeBody(){
    const opts = cur => Object.entries(D.KPIS).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    return `<div class="pnl-sec"><h3>Indicateurs du bloc principal</h3>${P.kpis.map((k, i) => `<label class="field"><span>Indicateur ${i + 1}</span><select class="input" id="kpi-${i}" data-kpi="${i}">${opts(k)}</select></label>`).join('')}</div>
      <div class="pnl-sec"><h3>Blocs</h3><ul class="order-list">${P.blocks.map((b, i) => { const off = P.hiddenBlocks.includes(b);
        return `<li class="${off ? 'off' : ''}"><span class="t">${esc(D.BLOCKS[b])}</span>
          <button class="btn ghost sm icon" type="button" data-act="move" data-kind="blocks" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(D.BLOCKS[b])}">${icon('arrow-up', 'sm')}</button>
          <button class="btn ghost sm icon" type="button" data-act="move" data-kind="blocks" data-i="${i}" data-d="1" ${i === P.blocks.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(D.BLOCKS[b])}">${icon('arrow-down', 'sm')}</button>
          <button class="btn ghost sm icon" type="button" data-act="hideBlock" data-id="${b}" aria-pressed="${off}" aria-label="${off ? 'Afficher' : 'Masquer'} ${esc(D.BLOCKS[b])}">${icon(off ? 'eye-off' : 'eye', 'sm')}</button></li>`; }).join('')}</ul></div>
      <p class="hint">Enregistré automatiquement. Contenu définitif des indicateurs à confirmer selon le métier et les données disponibles.</p>`;
  }
  const openCustomize = () => openPanel('customize', panelShell('Personnaliser le tableau de bord', 'Tableau de bord', customizeBody(),
    `<button class="btn" type="button" data-act="resetDash">Revenir au profil</button><button class="btn primary" type="button" data-act="closePanel">Terminé</button>`));
  function refreshCustomize(focusSel){
    if (S.panel !== 'customize') return;
    const host = device() === 'phone' ? $('#psheet') : $('#dock'); const body = $('.pnl-body', host); if (!body) return;
    const top = body.scrollTop; body.innerHTML = customizeBody(); body.scrollTop = top;
    if (focusSel) ($(focusSel, body) || $('[data-act]', body))?.focus();
  }

  // ───────────────────────── Fenêtres : confirmation, feuille Modules, recherche
  function askConfirm(title, text, ok){
    return new Promise(resolve => {
      const dlg = $('#confirm'), from = document.activeElement;
      dlg.innerHTML = `<div class="box solid"><div class="dlg-head"><h2 id="confirm-title">${esc(title)}</h2></div><div class="dlg-body"><p>${esc(text)}</p></div>
        <div class="dlg-foot"><button class="btn" type="button" value="non">Annuler</button><button class="btn primary" type="button" value="oui">${esc(ok)}</button></div></div>`;
      const done = v => { dlg.removeEventListener('click', onClick); animatedClose(dlg); if (from?.isConnected) from.focus(); resolve(v); };
      const onClick = e => { const b = e.target.closest('button[value]'); if (b) done(b.value === 'oui'); };
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('cancel', e => { e.preventDefault(); done(false); }, { once: true });
      dlg.showModal(); $('button[value="oui"]', dlg).focus();
    });
  }
  function openSheet(){
    const dlg = $('#sheet');
    const extra = P.shortcuts.map(tabById).filter(t => t && allowed(t)).slice(4);
    dlg.innerHTML = `<div class="box glassy"><div class="grabber" aria-hidden="true"></div>
      <div class="dlg-head"><h2 tabindex="-1">Modules</h2><button class="btn ghost icon" type="button" data-act="closeSheet" aria-label="Fermer">${icon('x')}</button></div>
      <div class="sheet-nav"><button class="sheet-search" type="button" data-act="search">${icon('search', 'sm')}<span>Rechercher</span></button>
        ${extra.length ? `<div class="mod-group" role="group" aria-label="Autres raccourcis"><span class="eyebrow">${icon('star')}Autres raccourcis</span><div class="mod-grid">${extra.map(t => navLink(t)).join('')}</div></div>` : ''}
        <div class="mt-grid">${moduleTiles()}</div>
      </div>
      <div class="sheet-foot"><span class="nav-item" aria-hidden="true"><span class="avatar">A</span><span class="lbl muted">Anthony · compte de démonstration</span></span></div></div>`;
    dlg.showModal(); $('.dlg-head h2', dlg).focus();
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
  let found = [], cursor = 0, searchFrom = null;
  function openSearch(){
    const dlg = $('#search'); if (dlg.open) return;
    searchFrom = document.activeElement;
    if ($('#sheet').open) $('#sheet').close();
    dlg.innerHTML = `<div class="box solid"><div class="search-box">${icon('search')}<input id="q" type="search" placeholder="Rechercher un écran, une date, une structure…" aria-label="Rechercher" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="results" aria-activedescendant="">
      <button class="btn ghost sm" type="button" data-act="closeSearch">Fermer</button></div>
      <div class="results" id="results" role="listbox" aria-label="Résultats"></div>
      <div class="search-foot"><span>↑ ↓ choisir</span><span>Entrée ouvrir</span><span>Échap fermer</span><span>Données fictives</span></div></div>`;
    dlg.showModal(); renderResults(''); $('#q').focus();
  }
  function closeSearch(){ animatedClose($('#search')); if (searchFrom?.isConnected) searchFrom.focus(); }
  function renderResults(q){
    const words = norm(q).split(/\s+/).filter(Boolean);
    found = searchItems().filter(x => words.every(w => norm(`${x.label} ${x.sub} ${x.g}`).includes(w))).slice(0, 40);
    cursor = 0; let last = '';
    $('#results').innerHTML = found.map((x, i) => { const head = x.g !== last ? `<div class="res-group eyebrow" role="presentation">${esc(x.g)}</div>` : ''; last = x.g;
      return `${head}<button class="res" type="button" role="option" id="res-${i}" data-i="${i}" aria-selected="${i === 0}" tabindex="-1">${icon(x.icon, 'sm')}<span class="t">${esc(x.label)}</span><span class="hint">${esc(x.sub)}</span></button>`; }).join('')
      || '<p class="empty">Aucun résultat dans les données fictives.</p>';
    $('#q').setAttribute('aria-activedescendant', found.length ? 'res-0' : '');
  }
  function moveCursor(d){
    if (!found.length) return;
    cursor = (cursor + d + found.length) % found.length;
    $$('#results .res').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.i) === cursor)));
    const cur = $(`#res-${cursor}`); cur.scrollIntoView({ block: 'nearest' }); $('#q').setAttribute('aria-activedescendant', cur.id);
  }
  function runResult(i){ const x = found[i]; if (!x) return; $('#search').close(); x.run(); }

  // ───────────────────────── Menus flottants : notifications, sous-onglets du rail réduit
  function closePop(restore){ const p = $('.pop'); if (!p) return; const from = p._from; p.remove(); if (restore && from?.isConnected) from.focus(); }
  function openPop(btn, html, { cls = '', side = 'below', label = '' } = {}){
    closePop();
    const pop = document.createElement('div'); pop.className = `pop solid ${cls}`; /* menus posés sur des données : surface opaque */ pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', label);
    pop.innerHTML = html; pop._from = btn; document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    if (side === 'right'){ pop.style.left = (r.right + 10) + 'px'; pop.style.top = Math.max(8, Math.min(r.top - 6, window.innerHeight - pop.offsetHeight - 8)) + 'px'; }
    else { pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px'; }
    $('a,button', pop)?.focus();
  }
  const notifsHtml = () => `<div class="pop-head"><b>Notifications</b><button class="btn ghost sm" type="button" data-act="readAll">Tout marquer comme lu</button></div>
    ${D.NOTIFS.map(n => `<div class="notif">${icon(n.icon)}<span>${S.notifRead ? esc(n.t) : `<b>${esc(n.t)}</b>`}</span><span class="when">${esc(n.b)} · ${esc(n.when)}</span></div>`).join('')}`;
  function flyout(btn, m){
    const tabs = m.tabs.filter(allowed);
    openPop(btn, `<p class="eyebrow">${esc(m.label)}</p>${tabs.map(t => navLink(t)).join('')}`, { cls: 'flyout', side: 'right', label: m.label });
  }

  // Confirmations discrètes, environ 3 secondes (étape 14)
  function toast(msg, ic = 'circle-check'){
    const box = $('.toasts'), el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
    box.appendChild(el); setTimeout(() => el.remove(), 3000);
  }

  // ───────────────────────── Navigation
  function go(id){
    const t = tabById(id) ? id : 'tableau-de-bord';
    if (location.hash !== '#' + t) history.pushState(null, '', '#' + t);
    route();
  }
  let started = false;
  function route(){
    const t = tabById(decodeURIComponent(location.hash.slice(1)));
    S.tab = t ? t.id : 'tableau-de-bord';   // onglet non autorisé : la page affiche « accès réservé »
    S.sel = null;
    closePanel({ restore: false }); closePop();
    $('.app').classList.remove('drawer'); $('.work').inert = false;
    ['#sheet', '#search'].forEach(s => { if ($(s).open) $(s).close(); });
    renderAll();
    document.title = `${tabById(S.tab).label} · MATRICE (prototype)`;
    if (started) $('#main').focus({ preventScroll: true });   // pas au chargement : « Aller au contenu » reste le premier arrêt clavier
    started = true;
  }
  function renderAll(){ applyLook(); renderSide(); renderTop(); renderBottom(); renderMain(); }
  function setDrawer(open){
    const app = $('.app'); if (!open && !app.classList.contains('drawer')) return;
    app.classList.toggle('drawer', open); $('.work').inert = open;
    if (open) $('#side .nav-item')?.focus(); else $('[data-act="drawer"]')?.focus();
  }

  // ───────────────────────── Actions
  function move(kind, i, d){
    if (kind === 'shortcuts') P.shortcuts = P.shortcuts.filter(id => tabById(id));
    const list = kind === 'order' ? P.order : kind === 'blocks' ? P.blocks : P.shortcuts;
    const j = i + d; if (j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    if (kind !== 'blocks') P.profile = 'perso';
    save(); return true;
  }
  const ACTS = {
    fold: b => { const m = modById(b.dataset.id);
      if ($('.app').classList.contains('mini')){ if ($('.pop')?._from === b){ closePop(); return; } flyout(b, m); return; }
      P.folded = P.folded.includes(m.id) ? P.folded.filter(x => x !== m.id) : [...P.folded, m.id]; save(); renderSide();
      $(`#side [data-act="fold"][data-id="${m.id}"]`)?.focus(); },
    mini: () => { P.mini = !P.mini; save(); closePop(); applyLook(); renderSide(); $('#side .collapse-btn')?.focus(); },
    drawer: () => setDrawer(true),
    closeDrawer: () => setDrawer(false),
    search: () => { setDrawer(false); openSearch(); },
    closeSearch: () => closeSearch(),
    notifs: b => { if ($('.pop')?._from === b){ closePop(); return; } openPop(b, notifsHtml(), { label: 'Notifications' }); },
    readAll: () => { S.notifRead = true; closePop(); renderTop(); $('[data-act="notifs"]')?.focus(); toast('Notifications marquées comme lues'); },
    sheet: () => openSheet(),
    closeSheet: () => animatedClose($('#sheet')),
    closePanel: () => closePanel(),
    customize: () => openCustomize(),
    moreDates: () => { S.datesAll = !S.datesAll; renderMain(); const b = $('[data-act="moreDates"]'); b?.focus(); if (S.datesAll) $('.tl-ev.more')?.focus(); },
    due: () => toast('Factures échues non soldées : parcours à raccorder aux fonctionnalités existantes', 'info'),
    date: b => openDate(b.dataset.id),
    view: b => { S.views[b.dataset.k] = b.dataset.v; S.sel = null; renderMain(); $(`[data-act="view"][data-k="${b.dataset.k}"][data-v="${b.dataset.v}"]`)?.focus(); },
    pin: b => { const id = b.dataset.id, on = P.shortcuts.includes(id);
      P.shortcuts = on ? P.shortcuts.filter(x => x !== id) : [...P.shortcuts, id]; P.profile = 'perso'; save(); renderSide(); renderBottom(); renderMain();
      $(`[data-act="pin"][data-id="${id}"]`)?.focus(); toast(on ? 'Retiré des raccourcis' : 'Ajouté aux raccourcis'); },
    unpin: b => { P.shortcuts = P.shortcuts.filter(x => x !== b.dataset.id); P.profile = 'perso'; save(); renderAll(); $('#pf-add')?.focus(); toast('Retiré des raccourcis'); },
    addShortcut: () => { const v = $('#pf-add')?.value; if (!v) return; P.shortcuts = [...P.shortcuts, v]; P.profile = 'perso'; save(); renderAll(); $('#pf-add')?.focus(); toast('Ajouté aux raccourcis'); },
    move: b => { const kind = b.dataset.kind, i = Number(b.dataset.i), d = Number(b.dataset.d);
      if (!move(kind, i, d)) return;
      const sel = `[data-act="move"][data-kind="${kind}"][data-i="${i + d}"][data-d="${d}"]`;
      if (kind === 'blocks'){ renderMain(); refreshCustomize(sel); return; }
      renderAll(); ($(sel) || $(`[data-act="move"][data-kind="${kind}"][data-i="${i}"]`))?.focus(); },
    hide: b => { const id = b.dataset.id; P.hidden = P.hidden.includes(id) ? P.hidden.filter(x => x !== id) : [...P.hidden, id]; P.profile = 'perso'; save(); renderAll();
      $(`[data-act="hide"][data-id="${id}"]`)?.focus(); },
    hideBlock: b => { const id = b.dataset.id; P.hiddenBlocks = P.hiddenBlocks.includes(id) ? P.hiddenBlocks.filter(x => x !== id) : [...P.hiddenBlocks, id]; save(); renderMain();
      refreshCustomize(`[data-act="hideBlock"][data-id="${id}"]`); },
    resetDash: () => { const pr = D.PROFILES[P.profile] || D.PROFILES.booking; P.kpis = [...pr.kpis]; P.blocks = DEFAULTS().blocks; P.hiddenBlocks = []; save(); renderMain(); refreshCustomize(); toast('Tableau de bord revenu au profil'); },
    applyProfile: async () => { const p = $('#pf-profile').value; if (p === 'perso'){ toast('Profil personnalisé : réglez modules et raccourcis ci-dessous', 'info'); return; }
      if (!await askConfirm('Appliquer ce profil ?', `L’ordre des modules, les raccourcis et les indicateurs du tableau de bord seront remplacés par la configuration « ${D.PROFILES[p].label} ». Les droits d’accès ne changent pas.`, 'Appliquer')) return;
      Object.assign(P, fromProfile(p), { hidden: [], folded: [] }); save(); renderAll(); toast(`Profil « ${D.PROFILES[p].label} » appliqué`); },
    reset: async () => { if (!await askConfirm('Restaurer les paramètres par défaut ?', 'Tous vos réglages du prototype (apparence, densité, modules, raccourcis, tableau de bord) reviennent à leur valeur d’origine.', 'Restaurer')) return;
      P = DEFAULTS(); save(); renderAll(); toast('Paramètres par défaut restaurés'); },
    noop: () => {},
  };

  document.addEventListener('click', e => {
    if ($('.pop') && !e.target.closest('.pop,[data-act="notifs"],[data-act="fold"]')) closePop();
    const res = e.target.closest('#results .res'); if (res){ runResult(Number(res.dataset.i)); return; }
    const g = e.target.closest('[data-go]');
    if (g){ e.preventDefault(); ['#sheet', '#psheet'].forEach(s => { if ($(s).open) $(s).close(); }); go(g.dataset.go); return; }
    const hit = e.target.closest('.hit[data-m]');
    if (hit){ const m = Number(hit.dataset.m); S.sel = S.sel === m ? null : m; chartDraw(); if (e.detail === 0) $(`#fig-fin .hit[data-m="${m}"]`)?.focus(); return; }   // focus rendu seulement au clavier
    if (e.target.tagName === 'DIALOG'){   // clic sur le fond d'une fenêtre
      if (e.target.id === 'psheet') closePanel(); else if (e.target.id === 'search') closeSearch(); else if (e.target.id === 'sheet') animatedClose(e.target);
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const fn = ACTS[b.dataset.act]; if (fn){ e.preventDefault(); fn(b); }
  });
  document.addEventListener('pointerover', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit && e.pointerType === 'mouse') showTip($('#fig-fin'), Number(hit.dataset.m)); });
  document.addEventListener('pointerout', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit && e.pointerType === 'mouse' && S.sel == null) $('#fig-fin .tip')?.remove(); });
  document.addEventListener('focusin', e => { const hit = e.target.closest?.('.hit[data-m]'); if (hit) showTip($('#fig-fin'), Number(hit.dataset.m)); });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.kpi != null){ P.kpis[Number(t.dataset.kpi)] = t.value; save(); renderMain(); return; }
    if (t.hasAttribute('data-finp')){ S.finP = t.value; S.sel = null; renderMain(); $('input[name="finp"]:checked')?.focus(); return; }
    if (t.dataset.tick != null){   // prototype : la tâche passe en « Terminées » pour cette visite seulement
      const i = Number(t.dataset.tick); S.done.push(i);
      const next = t.closest('li')?.nextElementSibling ? Number(t.closest('li').nextElementSibling.querySelector('[data-tick]')?.dataset.tick) : null;
      renderMain(); ($(`[data-tick="${next}"]`) || $('.blk-taches [data-tick]') || $('.blk-taches .go'))?.focus();
      toast('Tâche marquée comme faite (non enregistrée : prototype)'); return;
    }
    const k = t.dataset.pref; if (!k) return;
    const keepId = t.id || null, keepName = t.type === 'radio' ? t.name : null;
    if (k === 'density') P.density[device()] = t.value;
    else if (k === 'textSize') P.textSize = Number(t.value);
    else if (t.type === 'checkbox') P[k] = t.checked;
    else P[k] = t.value;
    save(); renderAll();
    (keepName ? $(`input[name="${keepName}"]:checked`) : keepId ? document.getElementById(keepId) : null)?.focus();
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'){
      const tg = e.target; if (tg.tagName === 'TEXTAREA' || tg.isContentEditable) return;   // éditeur : raccourci « insérer un lien » conservé
      e.preventDefault(); setDrawer(false); closePop(); openSearch(); return;
    }
    if ($('#search').open && e.target.id === 'q'){
      if (e.key === 'ArrowDown'){ e.preventDefault(); moveCursor(1); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); moveCursor(-1); }
      else if (e.key === 'Enter'){ e.preventDefault(); runResult(cursor); }
      else if (e.key === 'Escape'){ e.preventDefault(); closeSearch(); }
      return;
    }
    if (e.key === 'Escape'){
      if ($('.pop')){ closePop(true); return; }
      if ($('.app').classList.contains('drawer')){ setDrawer(false); return; }
      const d = e.target.closest?.('dialog');
      if (d){ if (d.id === 'psheet'){ e.preventDefault(); closePanel(); } else if (d.id === 'sheet'){ e.preventDefault(); animatedClose(d); } return; }
      if (S.panel){ closePanel(); return; }
    }
    const row = e.target.closest?.('.row[role="button"],.tl-ev[role="button"]');
    if (row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); row.click(); }
    const hit = e.target.closest?.('.hit[data-m]');
    if (hit && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); hit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); }
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') renderResults(e.target.value); });
  document.addEventListener('cancel', e => { if (e.target.id === 'psheet'){ e.preventDefault(); closePanel(); } }, true);

  // Changements de contexte : thème système, horaires, type d'appareil
  MQ.dark.addEventListener('change', applyLook);
  MQ.still.addEventListener('change', () => { if (S.tab === 'preferences') renderMain(); });
  [MQ.phone, MQ.tablet].forEach(m => m.addEventListener('change', () => { closePanel({ restore: false }); closePop(); $('.app').classList.remove('drawer'); $('.work').inert = false; renderAll(); }));
  new MutationObserver(() => { if (P.appearance === 'system') applyLook(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  setInterval(() => { if (P.appearance === 'schedule') applyLook(); }, 60000);
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => closePop());

  shell();
  route();
})();
