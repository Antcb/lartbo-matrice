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
import { filterBar, stBadge, viewHead } from '../ui/bits.js';
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
    <aside class="side">
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
    <div class="right">${stBadge(s.status)}
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
  return `<h3>Trajet</h3>${pair}
    <h3 style="margin-top:16px">Enchaînements</h3>
    ${legs ? `<ul class="legs">${legs}</ul>` : '<p class="muted" style="margin:0">Aucune date qui se suit (au plus un jour off) sur cette période.</p>'}`;
}

/* ---------------------------------------------------------------------------------------
   Carte partagée (Booking et espace de prospection)
   setMapData({points, key, fitTo}) : points = [{lat, lng, color, label, big, ring}]
--------------------------------------------------------------------------------------- */
let MAP = null, MAP_EL = null, LAYER = null, LAST_KEY = null;

export function setMapData(data){ S.mapData = data; }

function setBookingMap(shows){
  const pts = shows.map(s => { const c = showCoords(s); return c && {lat:c[0], lng:c[1], color:stColor(s.status), big:(s.status||'').startsWith('Confirmée'),
    label:`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}${s.project_id?' · '+esc(projName(s.project_id)):''}${s.fee_ht?'<br>'+eur(s.fee_ht):''}`}; }).filter(Boolean);
  setMapData({points: pts, key: `booking|${S.year}|${S.project}|${S.showCancelled}`});
  // calcul des trajets en arrière-plan, puis mise à jour du cadre « Trajet »
  const jobs = chains(shows).map(c => [c.a, c.b]);
  const a = byId('shows', S.routePick.a), b = byId('shows', S.routePick.b); if (a && b) jobs.push([a, b]);
  const todo = jobs.filter(([x,y]) => !routeCached(x,y));
  if (todo.length) Promise.all(todo.map(([x,y]) => route(x,y))).then(() => { const box = $('#route-box'); if (box && S.view==='booking') box.innerHTML = routeBoxHTML(shows); });
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
  } else slot.appendChild(MAP_EL);
  MAP.invalidateSize();
  const data = S.mapData || {points:[]};
  LAYER.clearLayers();
  for (const p of data.points){
    const light = ['#A9C8EC','#BFE3B9','#C9CDD4','#9EA4AD'].includes(p.color);
    L.circleMarker([p.lat, p.lng], {radius: p.big?9:7, color: p.ring ? '#C8372D' : (light ? '#5B677D' : '#FFFFFF'), weight: p.ring?3:1.5,
      fillColor: p.color, fillOpacity:1}).bindPopup(p.label).addTo(LAYER);
  }
  if (data.key !== LAST_KEY){
    LAST_KEY = data.key;
    const fit = data.fitTo || data.points.map(p => [p.lat, p.lng]);
    if (fit.length === 1) MAP.setView(fit[0], data.zoom || 8);
    else if (fit.length) MAP.fitBounds(fit, {padding:[30,30], maxZoom:9});
    else MAP.setView([46.6, 2.4], 5);
  }
}
export const mapColors = STATUS_COLOR;
