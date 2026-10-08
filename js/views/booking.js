/**
 * Onglet Booking : liste des dates, carte, calcul des trajets.
 */
import { stClass, stColor } from '../constants.js';
import { route } from '../geo.js';
import { byId, projName, showCoords, showsFiltered } from '../selectors.js';
import { S } from '../state.js';
import { $, daysUntil, esc, eur, fmtDate } from '../utils.js';

export function viewBooking(){
  let shows = showsFiltered();
  if (!S.showCancelled) shows = shows.filter(s => stClass(s.status)!=='off');
  const count = k => shows.filter(s=>stClass(s.status)===k).length;
  const totalConf = shows.filter(s=>stClass(s.status)==='conf').reduce((a,s)=>a+(Number(s.fee_ht)||0),0);
  let lastMonth = '', list = '';
  for (const s of shows){
    const m = s.date ? new Date(s.date+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) : 'Sans date';
    if (m!==lastMonth){ list += `<div class="month">${m}</div>`; lastMonth=m; }
    const d = s.date ? new Date(s.date+'T12:00:00') : null;
    const pa = S.routePick.a===s.id, pb = S.routePick.b===s.id;
    list += `<div class="gig ${pa||pb?'sel':''}" data-act="editShow" data-id="${s.id}">
      <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{weekday:'short'}):''}</span></div>
      <div class="what"><b>${esc(s.venue)}</b><small>${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))}${!S.project && s.project_id ? ' — '+esc(projName(s.project_id)) : ''}</small></div>
      <div class="right"><span class="st ${stClass(s.status)}">${esc(s.status)}</span>
        <span class="fee">${s.fee_ht?eur(s.fee_ht):''}${s.contract_type?' · '+esc(s.contract_type):''}</span>
        <span class="pick" title="Choisir comme point de départ (A) ou d'arrivée (B) pour calculer le trajet">
          <button class="btn small ${pa?'on':''}" data-act="pick" data-p="a" data-id="${s.id}">A</button><button class="btn small ${pb?'on':''}" data-act="pick" data-p="b" data-id="${s.id}">B</button></span>
      </div></div>`;
  }
  return `
  <div class="view-head"><h1>Booking ${S.year}</h1>
    <span class="sub"><span class="st int">${count('int')} intérêts</span> &nbsp; <span class="st opt">${count('opt')} options</span> &nbsp; <span class="st conf">${count('conf')} confirmées</span> &nbsp; · ${eur(totalConf)} confirmés</span>
    <span class="spacer"></span>
    <label class="muted"><input type="checkbox" data-act="toggleCancelled" ${S.showCancelled?'checked':''}> Annulées / sans suite</label>
    <button class="btn primary" data-act="newShow">Nouvelle date</button>
  </div>
  <div class="pane-switch mobile-only" role="tablist">
    <button class="btn small ${S.bookingPane!=='map'?'primary':''}" data-act="bookingPane" data-p="list">Liste</button>
    <button class="btn small ${S.bookingPane==='map'?'primary':''}" data-act="bookingPane" data-p="map">Carte et trajets</button></div>
  <div class="booking pane-${S.bookingPane==='map'?'map':'list'}">
    <div class="list-wrap">${list || `<div class="empty panel">Aucune date en ${S.year}. Ajoute un intérêt avec « Nouvelle date ».</div>`}</div>
    <div class="map-wrap">
      <div id="map" role="region" aria-label="Carte des dates"></div>
      <div class="legend"><span class="st int">Intérêt</span><span class="st opt">Option</span><span class="st conf">Confirmée</span><span class="st book">Booking</span></div>
      <div class="panel route-box" id="route-box">${routeBoxHTML(shows)}</div>
    </div>
  </div>`;
}

export function routeBoxHTML(shows){
  const a = byId('shows', S.routePick.a), b = byId('shows', S.routePick.b);
  let pair = '<p class="muted" style="margin:0">Choisis un départ (A) puis une arrivée (B) dans la liste des dates pour calculer la route.</p>';
  if (a && b){
    const key = a.id+'|'+b.id, r = S.routeCache[key];
    pair = `<p style="margin:0"><b>${esc(a.venue)}</b> → <b>${esc(b.venue)}</b><br>
      ${r ? (r.error ? `<span class="muted">${esc(r.error)}</span>` : `<b>${r.km} km</b> · ${r.time} de route`) : '<span class="muted">Calcul en cours…</span>'}</p>`;
  }
  const conf = shows.filter(s=>stClass(s.status)==='conf' && s.date && showCoords(s));
  let legs = '';
  for (let i=1;i<conf.length;i++){
    const k = conf[i-1].id+'|'+conf[i].id, r = S.routeCache[k];
    const days = daysUntil(conf[i].date) - daysUntil(conf[i-1].date);
    legs += `<li><span>${fmtDate(conf[i-1].date).slice(0,6)} ${esc(conf[i-1].city||conf[i-1].venue)} → ${fmtDate(conf[i].date).slice(0,6)} ${esc(conf[i].city||conf[i].venue)}</span>
      <span class="km ${r && !r.error && days<=1 && r.km>600 ? 'long':''}">${r ? (r.error?'—':`${r.km} km · ${r.time}`) : '…'}${days>1?` · J+${days}`:''}</span></li>`;
  }
  return `<h3>Trajet</h3>${pair}${legs?`<h3 style="margin-top:12px">Enchaînement des dates confirmées</h3><ul class="legs">${legs}</ul>`:''}`;
}

export let MAP, MAP_LAYER;

export function drawMap(){
  const el = $('#map'); if (!el) return;
  if (MAP){ MAP.remove(); MAP=null; }
  MAP = L.map(el, {scrollWheelZoom:true}).setView([46.6, 2.4], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', maxZoom:18}).addTo(MAP);
  MAP_LAYER = L.layerGroup().addTo(MAP);
  let shows = showsFiltered(); if (!S.showCancelled) shows = shows.filter(s=>stClass(s.status)!=='off');
  const pts = [];
  for (const s of shows){
    const c = showCoords(s); if (!c) continue; pts.push(c);
    L.circleMarker(c, {radius: stClass(s.status)==='conf'?9:7, color:'#fff', weight:2, fillColor: stColor(s.status), fillOpacity:1})
      .bindPopup(`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}${s.fee_ht?'<br>'+eur(s.fee_ht):''}`)
      .addTo(MAP_LAYER);
  }
  const conf = shows.filter(s=>stClass(s.status)==='conf' && s.date && showCoords(s));
  if (conf.length>1) L.polyline(conf.map(showCoords), {color: stColor('Confirmée'), weight:2, dashArray:'4 6', opacity:.7}).addTo(MAP_LAYER);
  if (pts.length) MAP.fitBounds(pts, {padding:[30,30], maxZoom:9});
  // routes
  const a = byId('shows', S.routePick.a), b = byId('shows', S.routePick.b);
  const jobs = [];
  if (a && b) jobs.push([a,b,true]);
  for (let i=1;i<conf.length;i++) jobs.push([conf[i-1], conf[i], false]);
  jobs.forEach(([x,y,draw]) => route(x,y).then(r => {
    if (draw && r && r.geometry && MAP) L.geoJSON(r.geometry, {style:{weight:4, color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}}).addTo(MAP_LAYER);
    const box = $('#route-box'); if (box) box.innerHTML = routeBoxHTML(shows);
  }));
}
