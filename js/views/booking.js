/**
 * Onglet Booking : liste des dates à gauche ; à droite carte carrée, calcul de trajet A → B
 * et enchaînements réels (dates d'un même artiste séparées d'un jour off au maximum).
 * La carte (Leaflet) est créée une seule fois et déplacée d'un affichage à l'autre (attachMap).
 */
import { STATUS_COLOR, STATUSES, isOff, stColor, viaArtbo } from '../constants.js';
import { EMITTED_FIELDS } from '../calc.js';
import { lingering } from '../data.js';
import { route, routeCached } from '../geo.js';
import { byId, isArchived, projFilterOk, projName, showCoords, showPlace, showPlaceNote, showsFiltered, visibleShow } from '../selectors.js';
import { S } from '../state.js';
import { filterBar, fold, stBadge, stSelect, viewHead } from '../ui/bits.js';
import { $, daysBetween, esc, eur, fmtDate, fmtShort } from '../utils.js';
import { calBookingRows, calMapPoints, calRowHTML, calStaleNotice, evSpan } from '../calendars.js';

export function viewBooking(){
  const all = showsFiltered();
  const shows = all.filter(visibleShow);
  const nOff = all.filter(s => isOff(s.status)).length;
  // dates archivées (v1.60.3) : hors de cette liste de travail et de la carte (showsFiltered), toutes années ; filtre artistes appliqué
  const archived = S.db.shows.filter(s => isArchived(s) && projFilterOk([s.project_id])).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const n = k => shows.filter(s => (s.status||'').startsWith(k)).length;
  // cachets confirmés : hors « Confirmée Artiste » (v1.53) ; dates archivées COMPRISES (v1.60.3) — l'archivage ne change aucun montant,
  // même périmètre que la fiche artiste et les indicateurs de Production (artistes et année choisis)
  const confFee = l => l.filter(s=>(s.status||'').startsWith('Confirmée') && viaArtbo(s)).reduce((a,s)=>a+(Number(s.fee_ht)||0),0);
  const archFee = confFee(showsFiltered({archived: true}).filter(isArchived)), totalConf = confFee(shows) + archFee;
  let lastMonth = '', list = '';
  // indisponibilités des agendas Google des artistes (lecture seule) : intercalées par jour, affichées à part, jamais comptées
  const projIds = S.projects.length ? S.projects : S.db.projects.filter(p => p.active || S.showInactive).map(p => p.id);
  const unav = calBookingRows(projIds, S.year);
  const monthOf = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : 'Sans date';
  const items = [...shows.map(s => ({d: s.date, s})), ...unav.map(u => ({d: u.span[0] < S.year + '-01-01' ? S.year + '-01-01' : u.span[0], u}))]
    .sort((x, y) => (x.d || '9999').localeCompare(y.d || '9999') || (x.s ? 1 : 0) - (y.s ? 1 : 0));
  for (const it of items){
    const m = monthOf(it.d);
    if (m!==lastMonth){ const cnt = shows.filter(x => monthOf(x.date) === m).length;
      // indisponibilités Google comptées à part (ce ne sont pas des dates) ; mois sans date : « aucune date »
      const nu = unav.filter(u => monthOf(u.span[0] < S.year + '-01-01' ? S.year + '-01-01' : u.span[0]) === m).length;
      const parts = [cnt ? `${cnt} date${cnt>1?'s':''}` : 'aucune date', nu ? `${nu} indisponibilité${nu>1?'s':''} Google` : ''].filter(Boolean).join(' · ');
      list += `<h2 class="month">${m} <small>${parts}</small></h2>`; lastMonth=m; }
    list += it.s ? gigRow(it.s) : calRowHTML(it.u, !S.project);
  }
  setBookingMap(shows);
  return viewHead('Booking', {
      sub: [plural(n('Intérêt'),'intérêt'), plural(n('Option'),'option'), plural(n('Confirmée'),'confirmée'), `${eur(totalConf)} de cachets confirmés${archFee ? ` (dont ${eur(archFee)} de dates archivées)` : ''}`].join(' · '),
      filters: filterBar(),
      actions: `${nOff?`<button class="btn" data-act="toggleCancelled" aria-pressed="${S.showCancelled}">${S.showCancelled?'Masquer':'Afficher'} annulées / sans suite (${nOff})</button>`:''}
        ${archived.length?`<button class="btn" data-act="toggleArchived" aria-pressed="${!!S.showArchived}">${S.showArchived?'Masquer':'Afficher'} les dates archivées (${archived.length})</button>`:''}
        <button class="btn" data-act="exportShows">Exporter</button>
        <button class="btn primary" data-act="newShow">Nouvelle date</button>`}) + `
  <div class="pane-switch" role="tablist">
    <button class="btn sm ${S.bookingPane!=='map'?'on':''}" data-act="bookingPane" data-p="list">Liste</button>
    <button class="btn sm ${S.bookingPane==='map'?'on':''}" data-act="bookingPane" data-p="map">Carte et trajets</button></div>
  <div class="booking pane-${S.bookingPane==='map'?'map':'list'}">
    <div class="list-wrap">${calStaleNotice(projIds)}${S.showArchived && archived.length ? archivedPanel(archived) : ''}${list || `<div class="empty panel">Aucune date en ${S.year}. Ajoute un intérêt avec « Nouvelle date ».</div>`}</div>
    <aside class="side side-booking">
      <div class="map-box"><div id="map-slot" role="region" aria-label="Carte des dates"></div></div>
      <div class="legend">${legend(shows)}</div>
      ${calLegend()}
      <div class="panel pad route-box" id="route-box">${routeBoxHTML(shows)}</div>
    </aside>
  </div>`;
}

/** Dates archivées (v1.60.3) : consultables et restaurables ; une facture arrivée depuis l'archivage (synchronisation Pennylane)
 *  est signalée — la date doit alors être restaurée pour revenir dans les comptes et les relances */
function archivedPanel(rows){
  const emitted = id => S.db.show_payments.some(p => p.show_id === id && EMITTED_FIELDS.some(k => p[k] != null && String(p[k]).trim() !== ''))
    || S.db.pennylane_a_rattacher.some(r => r.show_id === id && !r.resolved_at && !r.cancelled_at);
  return `<div class="panel pad"><h2 class="month">Dates archivées <small>${rows.length}</small></h2>
    <p class="muted small">Hors des listes de travail, des relances, de la carte et des calendriers ; fiche publique fermée. Leurs factures, paiements, créances et dettes restent dans les vues financières et les comptes. Ce n’est ni une annulation (statut inchangé) ni une suppression.</p>
    ${rows.map(s => `<p><strong>${esc([s.date ? fmtDate(s.date) : 'sans date', s.venue, projName(s.project_id)].filter(Boolean).join(' · '))}</strong> <span class="muted">— ${esc(s.status || '')}</span><br>
      <span class="muted small">Archivée le ${fmtDate(String(s.archived_at).slice(0, 10))}${s.archived_by ? ' par ' + esc(s.archived_by) : ''} : ${esc(s.archived_reason || '')}</span>
      ${emitted(s.id) ? '<br><span class="warn-txt">Une facture est arrivée pour cette date (comptée dans les montants) : restaure-la pour la suivre et la relancer.</span>' : ''}
      <br><button class="btn sm" data-act="restoreShow" data-id="${s.id}">Restaurer</button></p>`).join('')}</div>`;
}

function gigRow(s){
  const d = s.date ? new Date(s.date+'T12:00:00') : null;
  const pa = S.routePick.a===s.id, pb = S.routePick.b===s.id;
  return `<div class="gig ${pa||pb?'picked':''} ${lingering(s.id)&&isOff(s.status)?'leaving':''}" style="--c:${stColor(s.status)}" data-act="editShow" data-id="${s.id}">
    <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{weekday:'short'}):''}</span></div>
    <div class="what"><b>${esc(s.venue)}</b><small>${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))}${!S.project && s.project_id ? ' · '+esc(projName(s.project_id)) : ''}${s.date_end && s.date_end!==s.date ? ' · jusqu’au '+fmtShort(s.date_end) : ''}${showPlace(s).state === 'missing' ? ' · <span class="warn-txt">localisation manquante</span>' : ''}</small></div>
    <div class="right">${stSelect(s)}
      <span class="fee">${[s.fee_ht?eur(s.fee_ht):'', s.contract_type||''].filter(Boolean).join(' · ')}</span>
      <span class="pick" title="Calcul de trajet : choisis un départ (A) puis une arrivée (B)">
        <button class="btn sm ${pa?'on':''}" data-act="pick" data-p="a" data-id="${s.id}" aria-pressed="${pa}" aria-label="Départ du trajet">A</button><button class="btn sm ${pb?'on':''}" data-act="pick" data-p="b" data-id="${s.id}" aria-pressed="${pb}" aria-label="Arrivée du trajet">B</button></span>
    </div></div>`;
}

/** Repères « Date artiste — calendrier Google » et « Show » à localiser (jamais placés au hasard) */
function calLegend(){
  const cal = calMapPoints(S.projects.length ? S.projects : null, S.year);
  if (!cal.points.length && !cal.toLocate.length) return '';
  return `<div class="cal-legend"><span class="cal-dot" aria-hidden="true"></span> Date artiste — calendrier Google (${cal.points.length})
    ${cal.toLocate.length ? `<p class="help m0">Localisation à préciser : ${cal.toLocate.map(e => esc(`${fmtShort(evSpan(e)[0])} ${e.title || ''}${e.location ? ' (' + e.location + ')' : ''}`)).join(' · ')}</p>` : ''}</div>`;
}

const plural = (n, w) => `${n} ${w}${n>1?'s':''}`;

/** Pastilles sous la carte : un clic masque / affiche ce statut sur la carte */
const legend = shows => STATUSES.filter(st => shows.some(s=>s.status===st)).map(st => {
  const off = S.mapHidden.has(st), n = shows.filter(s => s.status === st).length;
  return `<button type="button" class="legend-chip ${off ? 'off' : ''}" data-act="toggleMapStatus" data-st="${esc(st)}" aria-pressed="${!off}" title="${off ? 'Afficher' : 'Masquer'} sur la carte">${stBadge(st)}<span class="count">${n}</span></button>`;
}).join('') + (S.mapHidden.size ? `<button type="button" class="btn sm ghost" data-act="showAllMapStatus">Tout afficher</button>` : '');

/** Enchaînements : dates d'un même artiste qui se suivent (au plus un jour off entre les deux) */
export function chains(shows){
  const out = [];
  const byProj = {};
  shows.filter(s => s.date && !isOff(s.status) && showCoords(s)).forEach(s => (byProj[s.project_id] ||= []).push(s));
  for (const list of Object.values(byProj)){
    list.sort((a,b)=>a.date.localeCompare(b.date));
    for (let i=1;i<list.length;i++){
      const a = list[i-1], b = list[i], gap = daysBetween(a.date_end || a.date, b.date);
      if (gap >= 0 && gap <= 2) out.push({a, b, gap});
    }
  }
  return out.sort((x,y)=>x.a.date.localeCompare(y.a.date));
}

export function routeBoxHTML(shows){
  const a = byId('shows', S.routePick.a), b = byId('shows', S.routePick.b);
  let pair = '<p class="muted m0">Clique sur A puis sur B dans deux dates pour calculer la distance et le temps de route.</p>';
  if (a || b){
    const r = a && b ? routeCached(a, b) : null;
    pair = `<p class="mb-sm"><b>A</b> ${a?esc(a.venue)+' <span class="muted">'+esc(a.city||'')+'</span>':'—'}<br><b>B</b> ${b?esc(b.venue)+' <span class="muted">'+esc(b.city||'')+'</span>':'—'}</p>
      ${a && b ? `<div class="route-result">${r ? (r.error ? `<span class="muted">${esc(r.error)}</span>` : `<b>${r.km} km</b> · ${r.time} de route`) : '<span class="muted">Calcul en cours…</span>'}</div>` : ''}
      <button class="btn sm ghost" data-act="clearPick">Effacer</button>`;
  }
  const legs = chains(shows).map(({a, b, gap}) => {
    const r = routeCached(a, b);
    return `<li><span>${fmtShort(a.date)} ${esc(a.city||a.venue)} → ${fmtShort(b.date)} ${esc(b.city||b.venue)}</span>
      <span class="km ${r && !r.error && gap<=1 && r.km>600 ? 'long':''}">${r ? (r.error?'—':`${r.km} km · ${r.time}`) : '…'}${gap===2?' · 1 jour off':gap===0?' · même jour':''}</span>
      ${!S.project?`<span class="proj-line">${esc(projName(a.project_id))}</span>`:''}</li>`;
  }).join('');
  const n = chains(shows).length;
  return `<h3>Trajet</h3>${pair}
    ${fold('chains', 'Enchaînements', legs ? `<ul class="legs">${legs}</ul>` : '<p class="muted m0">Aucune date qui se suit (au plus un jour off) sur cette période.</p>', {open:false, count:n})}`;
}

/* ---------------------------------------------------------------------------------------
   Carte partagée (Booking et espace de prospection)
   setMapData({points, key, fitTo}) : points = [{lat, lng, color, label, big, ring}]
--------------------------------------------------------------------------------------- */
let MAP = null, MAP_EL = null, LAYER = null, LINE = null, LAST_KEY = null;
const MARKERS = new Map();
let HOVERED = null;          // point ouvert par simple survol (se referme quand la souris s'éloigne)   // id de date → point de la carte (pour le grossir au survol de la liste)

function drawLine(){
  if (LINE){ LINE.remove(); LINE = null; }
  const g = S.mapData?.line; if (!g || !MAP) return;
  LINE = L.geoJSON(g, {style:{color:'#283C63', weight:4, opacity:.85}, interactive:false}).addTo(MAP);
}

export function setMapData(data){ S.mapData = data; }

function setBookingMap(shows){
  const pts = shows.filter(s => !S.mapHidden.has(s.status)).map(s => { const c = showCoords(s); return c && {lat:c[0], lng:c[1], color:stColor(s.status), big:(s.status||'').startsWith('Confirmée'), showId:s.id, hover:true,
    label:`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}${s.project_id?' · '+esc(projName(s.project_id)):''}${s.fee_ht?'<br>'+eur(s.fee_ht):''}${showPlaceNote(s) ? `<br><span class="warn-txt">${esc(showPlaceNote(s))}</span>` : ''}
      <div class="pop-actions"><button type="button" class="btn sm ${S.routePick.a===s.id?'on':''}" data-act="pick" data-p="a" data-id="${s.id}">Départ (A)</button><button type="button" class="btn sm ${S.routePick.b===s.id?'on':''}" data-act="pick" data-p="b" data-id="${s.id}">Arrivée (B)</button></div>`}; }).filter(Boolean);
  const a0 = byId('shows', S.routePick.a), b0 = byId('shows', S.routePick.b);
  const rr = a0 && b0 ? routeCached(a0, b0) : null;
  // « Show » des agendas Google : repère distinct, jamais approximatif ; sinon « localisation à préciser » (sous la carte)
  const cal = calMapPoints(S.projects.length ? S.projects : null, S.year);
  pts.push(...cal.points); S.calToLocate = cal.toLocate;
  setMapData({points: pts, key: `booking|${S.year}|${S.projects.join()}|${S.showInactive}|${S.showCancelled}`, keepView: true, line: rr?.geometry || null});
  // calcul des trajets en arrière-plan, puis mise à jour du cadre « Trajet »
  const jobs = chains(shows).map(c => [c.a, c.b]);
  const a = byId('shows', S.routePick.a), b = byId('shows', S.routePick.b); if (a && b) jobs.push([a, b]);
  const todo = jobs.filter(([x,y]) => !routeCached(x,y));
  if (todo.length) Promise.all(todo.map(([x,y]) => route(x,y))).then(() => { const box = $('#route-box'); if (box && S.view==='booking'){ box.innerHTML = routeBoxHTML(shows);
    // tracé du trajet A → B
    if (a && b){ const r = routeCached(a, b); if (r?.geometry && S.mapData){ S.mapData.line = r.geometry; drawLine(); } } } });
}

export function attachMap(){
  const slot = document.getElementById('map-slot'); if (!slot || !window.L) return;
  if (!MAP){
    MAP_EL = document.createElement('div'); MAP_EL.id = 'map-el';
    slot.appendChild(MAP_EL);
    MAP = L.map(MAP_EL, {scrollWheelZoom:true, zoomControl:true}).setView([46.6, 2.4], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', maxZoom:18}).addTo(MAP);
    LAYER = L.layerGroup().addTo(MAP);
    MAP.on('mousemove', ev => { if (HOVERED && HOVERED.isPopupOpen() && MAP.latLngToContainerPoint(HOVERED.getLatLng()).distanceTo(ev.containerPoint) > 160){ HOVERED.closePopup(); HOVERED = null; } });
    MAP.on('popupclose', () => { HOVERED = null; });
  } else slot.appendChild(MAP_EL);
  // Dans un suivi : la molette (deux doigts qui glissent) fait défiler la colonne, le pincement (deux doigts qui s'écartent) zoome la carte.
  // Sur Mac, le pincement du trackpad arrive comme une molette avec Ctrl : on ne laisse passer à la carte que celui-là.
  if (slot.closest('.workspace') && !slot._wheelGuard){
    slot._wheelGuard = true;
    slot.addEventListener('wheel', e => { if (!e.ctrlKey) e.stopPropagation(); }, {capture: true});
  }
  MAP.invalidateSize();
  const data = S.mapData || {points:[]};
  LAYER.clearLayers(); MARKERS.clear(); drawLine();
  if (data.circle) L.circle(data.circle.center, {radius: data.circle.km*1000, color:'#283C63', weight:1, opacity:.5, fillOpacity:.05, interactive:false}).addTo(LAYER);
  for (const p of data.points){
    const light = ['#A9C8EC','#BFE3B9','#C9CDD4','#9EA4AD'].includes(p.color);
    const m = L.circleMarker([p.lat, p.lng], p.gcal ? {radius: 8, color: '#283C63', weight: 2.5, dashArray: '3 3', fillColor: '#FFFFFF', fillOpacity: 1}   // agenda Google : repère distinct
      : {radius: p.big?9:7, color: p.ring ? '#C8372D' : (light ? '#5B677D' : '#FFFFFF'), weight: p.ring?3:1.5,
      fillColor: p.color, fillOpacity:1}).bindPopup(p.label + (p.from ? '<div class="pop-dist">Calcul de la distance…</div>' : '')).addTo(LAYER);
    if (p.showId) MARKERS.set(p.showId, {m, r: p.big?9:7});
    // fiche du point après 1 seconde de survol
    if (p.hover !== false){ let tm = null;
      m.on('mouseover', () => { tm = setTimeout(() => { HOVERED = m; m.openPopup(); }, 900); });
      m.on('mouseout', () => clearTimeout(tm));
      m.on('click', () => { clearTimeout(tm); HOVERED = null; }); }
    // distance et temps de route depuis la structure, calculés à l'ouverture
    if (p.from) m.on('popupopen', async ev => {
      const r = await route(p.from, [p.lat, p.lng]);
      const el = ev.popup.getElement()?.querySelector('.pop-dist');
      if (el) el.textContent = r.error ? r.error : `${r.km} km · ${r.time} de route depuis la structure`;
    });
  }
  if (data.key !== LAST_KEY){
    LAST_KEY = data.key;
    const fit = data.fitTo || data.points.map(p => [p.lat, p.lng]);
    if (data.circle){ const [la, ln] = data.circle.center, km = Math.max(data.circle.km, 20), dl = km/111, dg = km/(111*Math.cos(la*Math.PI/180));
      const bounds = L.latLngBounds([la-dl, ln-dg], [la+dl, ln+dg]);
      fit.forEach(c => bounds.extend(c)); MAP.fitBounds(bounds, {padding:[20,20], maxZoom:10}); LAST_KEY = data.key; return; }
    if (fit.length === 1) MAP.setView(fit[0], data.zoom || 8);
    else if (fit.length) MAP.fitBounds(fit, {padding:[30,30], maxZoom:9});
    else MAP.setView([46.6, 2.4], 5);
  }
}
export const mapColors = STATUS_COLOR;

// Survol d'une date dans la liste → son point grossit sur la carte
document.addEventListener('mouseover', e => {
  const g = e.target.closest?.('.gig[data-id], .plan-row[data-id]'); if (!g) return;
  const k = MARKERS.get(g.dataset.id); if (!k || k.on) return;
  MARKERS.forEach(x => { if (x.on){ x.m.setRadius(x.r); x.m.setStyle({weight:1.5}); x.on = false; } });
  k.m.setRadius(15); k.m.setStyle({weight:3}); k.m.bringToFront(); k.on = true;
});
document.addEventListener('mouseout', e => {
  const g = e.target.closest?.('.gig[data-id], .plan-row[data-id]'); if (!g || g.contains(e.relatedTarget)) return;
  const k = MARKERS.get(g.dataset.id); if (k?.on){ k.m.setRadius(k.r); k.m.setStyle({weight:1.5}); k.on = false; }
});
