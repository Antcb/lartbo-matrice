/**
 * Onglet Booking : liste des dates à gauche ; à droite carte carrée, calcul de trajet A → B
 * et enchaînements réels (dates d'un même artiste séparées d'un jour off au maximum).
 * La carte (Leaflet) est créée une seule fois et déplacée d'un affichage à l'autre (attachMap).
 */
import { STATUS_COLOR, STATUSES, isOff, stColor } from '../constants.js';
import { lingering } from '../data.js';
import { route, routeCached } from '../geo.js';
import { byId, projName, showCoords, showsFiltered, visibleShow } from '../selectors.js';
import { S } from '../state.js';
import { filterBar, fold, stBadge, stSelect, viewHead } from '../ui/bits.js';
import { $, daysBetween, esc, eur, fmtDate, fmtShort } from '../utils.js';

export function viewBooking(){
  const all = showsFiltered();
  const shows = all.filter(visibleShow);
  const nOff = all.filter(s => isOff(s.status)).length;
  const n = k => shows.filter(s => (s.status||'').startsWith(k)).length;
  const totalConf = shows.filter(s=>(s.status||'').startsWith('Confirmée')).reduce((a,s)=>a+(Number(s.fee_ht)||0),0);
  let lastMonth = '', list = '';
  for (const s of shows){
    const m = s.date ? new Date(s.date+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : 'Sans date';
    if (m!==lastMonth){ const cnt = shows.filter(x => (x.date ? new Date(x.date+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : 'Sans date') === m).length;
      list += `<h2 class="month">${m} <small>${cnt} date${cnt>1?'s':''}</small></h2>`; lastMonth=m; }
    list += gigRow(s);
  }
  setBookingMap(shows);
  return viewHead('Booking', {
      sub: [plural(n('Intérêt'),'intérêt'), plural(n('Option'),'option'), plural(n('Confirmée'),'confirmée'), `${eur(totalConf)} de cachets confirmés`].join(' · '),
      filters: filterBar(),
      actions: `${nOff?`<button class="btn" data-act="toggleCancelled" aria-pressed="${S.showCancelled}">${S.showCancelled?'Masquer':'Afficher'} annulées / sans suite (${nOff})</button>`:''}
        <button class="btn primary" data-act="newShow">Nouvelle date</button>`}) + `
  <div class="pane-switch" role="tablist">
    <button class="btn sm ${S.bookingPane!=='map'?'on':''}" data-act="bookingPane" data-p="list">Liste</button>
    <button class="btn sm ${S.bookingPane==='map'?'on':''}" data-act="bookingPane" data-p="map">Carte et trajets</button></div>
  <div class="booking pane-${S.bookingPane==='map'?'map':'list'}">
    <div class="list-wrap">${list || `<div class="empty panel">Aucune date en ${S.year}. Ajoute un intérêt avec « Nouvelle date ».</div>`}</div>
    <aside class="side side-booking">
      <div class="map-box"><div id="map-slot" role="region" aria-label="Carte des dates"></div></div>
      <div class="legend">${legend(shows)}</div>
      <div class="panel pad route-box" id="route-box">${routeBoxHTML(shows)}</div>
    </aside>
  </div>`;
}

function gigRow(s){
  const d = s.date ? new Date(s.date+'T12:00:00') : null;
  const pa = S.routePick.a===s.id, pb = S.routePick.b===s.id;
  return `<div class="gig ${pa||pb?'picked':''} ${lingering(s.id)&&isOff(s.status)?'leaving':''}" style="--c:${stColor(s.status)}" data-act="editShow" data-id="${s.id}">
    <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{weekday:'short'}):''}</span></div>
    <div class="what"><b>${esc(s.venue)}</b><small>${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))}${!S.project && s.project_id ? ' · '+esc(projName(s.project_id)) : ''}${s.date_end && s.date_end!==s.date ? ' · jusqu’au '+fmtShort(s.date_end) : ''}</small></div>
    <div class="right">${stSelect(s)}
      <span class="fee">${[s.fee_ht?eur(s.fee_ht):'', s.contract_type||''].filter(Boolean).join(' · ')}</span>
      <span class="pick" title="Calcul de trajet : choisis un départ (A) puis une arrivée (B)">
        <button class="btn sm ${pa?'on':''}" data-act="pick" data-p="a" data-id="${s.id}" aria-pressed="${pa}" aria-label="Départ du trajet">A</button><button class="btn sm ${pb?'on':''}" data-act="pick" data-p="b" data-id="${s.id}" aria-pressed="${pb}" aria-label="Arrivée du trajet">B</button></span>
    </div></div>`;
}

const plural = (n, w) => `${n} ${w}${n>1?'s':''}`;

const legend = shows => STATUSES.filter(st => shows.some(s=>s.status===st)).map(stBadge).join('');

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
  let pair = '<p class="muted" style="margin:0">Clique sur A puis sur B dans deux dates pour calculer la distance et le temps de route.</p>';
  if (a || b){
    const r = a && b ? routeCached(a, b) : null;
    pair = `<p style="margin:0 0 6px"><b>A</b> ${a?esc(a.venue)+' <span class="muted">'+esc(a.city||'')+'</span>':'—'}<br><b>B</b> ${b?esc(b.venue)+' <span class="muted">'+esc(b.city||'')+'</span>':'—'}</p>
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
    ${fold('chains', 'Enchaînements', legs ? `<ul class="legs">${legs}</ul>` : '<p class="muted" style="margin:0">Aucune date qui se suit (au plus un jour off) sur cette période.</p>', {open:true, count:n})}`;
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
  const pts = shows.map(s => { const c = showCoords(s); return c && {lat:c[0], lng:c[1], color:stColor(s.status), big:(s.status||'').startsWith('Confirmée'), showId:s.id, hover:true,
    label:`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}${s.project_id?' · '+esc(projName(s.project_id)):''}${s.fee_ht?'<br>'+eur(s.fee_ht):''}
      <div class="pop-actions"><button type="button" class="btn sm ${S.routePick.a===s.id?'on':''}" data-act="pick" data-p="a" data-id="${s.id}">Départ (A)</button><button type="button" class="btn sm ${S.routePick.b===s.id?'on':''}" data-act="pick" data-p="b" data-id="${s.id}">Arrivée (B)</button></div>`}; }).filter(Boolean);
  const a0 = byId('shows', S.routePick.a), b0 = byId('shows', S.routePick.b);
  const rr = a0 && b0 ? routeCached(a0, b0) : null;
  setMapData({points: pts, key: `booking|${S.year}|${S.project}|${S.showCancelled}`, keepView: true, line: rr?.geometry || null});
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
  MAP.invalidateSize();
  const data = S.mapData || {points:[]};
  LAYER.clearLayers(); MARKERS.clear(); drawLine();
  if (data.circle) L.circle(data.circle.center, {radius: data.circle.km*1000, color:'#283C63', weight:1, opacity:.5, fillOpacity:.05, interactive:false}).addTo(LAYER);
  for (const p of data.points){
    const light = ['#A9C8EC','#BFE3B9','#C9CDD4','#9EA4AD'].includes(p.color);
    const m = L.circleMarker([p.lat, p.lng], {radius: p.big?9:7, color: p.ring ? '#C8372D' : (light ? '#5B677D' : '#FFFFFF'), weight: p.ring?3:1.5,
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
