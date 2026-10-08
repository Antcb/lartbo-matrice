/**
 * Onglet Suivi : liste des suivis (filtres artiste + statut, export CSV) et espace de prospection.
 * Espace de prospection = la fiche du suivi à gauche (résumé, journal, pièces jointes) et, à droite,
 * sans quitter la fiche : le planning de l'artiste, la carte des dates autour de la date visée avec
 * les distances, et les boutons pour poser une date (intérêt / option) ou une tâche.
 */
import { LOG_ICON, LOG_KINDS, PROSPECT, isOff, stColor } from '../constants.js';
import { lingering } from '../data.js';
import { distKm, routeCached, route } from '../geo.js';
import { byId, filesOf, lastExchange, linksOfStructure, logsOf, projIds, projName, projNames, projectOptions, showCoords, showsOfProject, structName } from '../selectors.js';
import { S } from '../state.js';
import { dropZone, fileRow, pstBadge, stBadge, tabsBar, curTab, viewHead } from '../ui/bits.js';
import { cSel, projChips } from '../ui/cells.js';
import { dateInput } from '../ui/datefield.js';
import { $, daysBetween, esc, eur, fmtDate, fmtShort, matches, md, today } from '../utils.js';
import { setMapData } from './booking.js';

export function viewProspects(){
  if (S.suiviPage){ const p = byId('prospects', S.suiviPage); if (p) return suiviPage(p); S.suiviPage = null; }
  const q = S.search.prospects || '';
  const st = S.suiviStatus || '';
  let rows = S.db.prospects.filter(p => (!S.project || projIds(p).includes(S.project)) && (!st || p.status===st));
  const nClosed = st ? 0 : rows.filter(p=>p.status==='Closed' && !lingering(p.id)).length;
  if (!st && !S.showClosed) rows = rows.filter(p=>p.status!=='Closed' || lingering(p.id));
  if (q) rows = rows.filter(p => matches(`${structName(p.structure_id)} ${byId('structures',p.structure_id)?.city||''} ${projNames(p)} ${p.summary||''}`, q));
  rows = rows.map(p=>({p, last:lastExchange(p)})).sort((a,b)=>(b.last||'').localeCompare(a.last||'') || (b.p.updated_at||'').localeCompare(a.p.updated_at||''));
  return viewHead('Suivi', {
    sub: `${rows.length} suivi${rows.length>1?'s':''}`,
    filters: `<div class="filters">
      <select class="sel" data-suivi-filter="project" aria-label="Artiste"><option value="">Tous les artistes</option>${projectOptions().map(x=>`<option value="${x.id}" ${x.id===S.project?'selected':''}>${esc(x.name)}${x.active?'':' (inactif)'}</option>`).join('')}</select>
      <select class="sel" data-suivi-filter="status" aria-label="Statut"><option value="">Tous les statuts</option>${PROSPECT.map(x=>`<option value="${x}" ${x===st?'selected':''}>${x}</option>`).join('')}</select>
      <input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-suivi" placeholder="Structure, ville, mot du résumé…" data-search="prospects" value="${esc(q)}"></div>`,
    actions: `${nClosed ? `<button class="btn" data-act="toggleClosed" aria-pressed="${!!S.showClosed}">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${nClosed})</button>` : ''}
      <button class="btn" data-act="exportSuivis">Exporter en CSV</button>
      <button class="btn primary" data-act="newProspect">Nouveau suivi</button>`})
  + `<div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Artiste(s)</th><th>Statut</th><th>Dernier échange</th><th class="num">Journal</th><th class="num">Fichiers</th><th>Résumé</th></tr></thead><tbody>
    ${rows.slice(0,500).map(({p,last})=>{ const s=byId('structures',p.structure_id);
      return `<tr class="click ${lingering(p.id)?'leaving':''}" data-act="openSuivi" data-id="${p.id}"><td><b>${esc(s?.name||p.name)}</b><span class="sub">${esc([s?.city, s?.department_code && '('+s.department_code+')'].filter(Boolean).join(' '))}</span></td>
      <td>${esc(projNames(p))}</td><td>${pstBadge(p.status)}</td>
      <td class="nowrap">${last?fmtDate(last):'<span class="muted">—</span>'}</td><td class="num">${logsOf(p.id).length||''}</td><td class="num">${filesOf(p.id).length||''}</td>
      <td class="muted" style="min-width:280px">${esc((p.summary||p.content_md||'').replace(/\*\*/g,'').replace(/\n/g,' ').slice(0,200))}</td></tr>`;}).join('') || '<tr><td colspan="7" class="empty">Aucun suivi.</td></tr>'}
    </tbody></table></div>`;
}

/** Fiche de suivi (résumé, journal, fichiers) — utilisée dans l'espace de prospection et la page structure */
export function suiviCard(p, {page=false}={}){
  const logs = logsOf(p.id), files = filesOf(p.id);
  const contacts = linksOfStructure(p.structure_id);
  const left = `
      <div class="suivi-block"><h3 class="block-title">Résumé <button class="btn sm ghost" data-act="editText" data-id="${p.id}" data-f="summary">Modifier</button>
        <button class="btn sm ghost" data-act="aiSummary" data-id="${p.id}" title="Résumé automatique à partir du journal, des notes et des PDF">Mettre à jour avec l'IA</button>
        <button class="btn sm ghost" data-act="copyForAi" data-id="${p.id}" title="Copie le suivi pour le coller dans ChatGPT">Copier pour ChatGPT</button></h3>
        <div class="md">${md(p.summary) || '<span class="muted">Pas encore de résumé.</span>'}</div></div>
      <div class="suivi-block"><h3 class="block-title">Pièces jointes <span class="count">${files.length}</span></h3>
        ${dropZone({prospect_id:p.id}, files.map(f=>fileRow(f)).join(''))}</div>
      <div class="suivi-block"><h3 class="block-title">Autres notes <button class="btn sm ghost" data-act="editText" data-id="${p.id}" data-f="content_md">Modifier</button></h3>
        <div class="md">${md(p.content_md) || '<span class="muted">—</span>'}</div></div>`;
  const journal = `
      <div class="suivi-block"><h3 class="block-title">Journal des échanges <span class="count">${logs.length}</span></h3>
        <form class="log-form" data-logform="${p.id}">
          ${dateInput(today(), 'name="date"')}
          <select name="kind" class="sel" aria-label="Type d'échange">${LOG_KINDS.map(k=>`<option>${k}</option>`).join('')}</select>
          <input name="who" class="inp" placeholder="Interlocuteur" list="dl-who-${p.id}" aria-label="Interlocuteur" autocomplete="off">
          <datalist id="dl-who-${p.id}">${contacts.map(c=>`<option value="${esc(c.display_name)}">`).join('')}</datalist>
          <textarea name="body" placeholder="Notes de l'échange…" aria-label="Notes"></textarea>
          <button class="btn primary sm">Ajouter au journal</button>
        </form>
        ${logs.map(l=>`<div class="log">
          <div class="log-head">${LOG_ICON[l.kind]||'📝'} <b>${l.date?fmtDate(l.date):'Sans date'}</b>${l.contact_name?' · '+esc(l.contact_name):''}
            <button class="btn icon sm ghost danger" data-act="delLog" data-id="${l.id}" aria-label="Supprimer l'entrée">✕</button></div>
          <div class="md">${md(l.body)}</div></div>`).join('') || '<div class="muted">Aucun échange enregistré.</div>'}
      </div>`;
  const head = `<div class="suivi-head">
      ${projChips('prospects', p)}
      <span class="sel-wrap">${cSel('prospects',p.id,'status',p.status,PROSPECT,false)}</span>
      <span class="muted">Dernier échange : ${lastExchange(p)?fmtDate(lastExchange(p)):'—'}</span>
      <span class="spacer"></span>
      ${page ? '' : `<button class="btn sm" data-act="openSuivi" data-id="${p.id}">Ouvrir avec planning et carte</button>`}
      <button class="btn sm ghost danger" data-act="delProspect" data-id="${p.id}">Supprimer</button>
    </div>`;
  if (page) return `<div class="panel suivi ${lingering(p.id)?'leaving':''}" id="pr-${p.id}">${head}${journal}${left}</div>`;
  return `<div class="panel suivi ${lingering(p.id)?'leaving':''}" id="pr-${p.id}">${head}<div class="suivi-grid"><div>${left}</div><div>${journal}</div></div></div>`;
}

/* ------------------------------------------------------------------ Espace de prospection */
function suiviPage(p){
  const st = byId('structures', p.structure_id);
  const ids = projIds(p);
  const proj = ids.includes(S.wsProject) ? S.wsProject : ids[0] || null;
  const target = S.wsTarget || null;
  return `<button class="btn ghost back" data-act="closeSuivi">← Suivi</button>
  <div class="view-head"><div class="vh-title"><h1>${esc(st?.name || p.name)}</h1>
    <span class="sub">${esc([st?.city, st?.department_code && '('+st.department_code+')', st?.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(' '))}</span></div>
    <span class="spacer"></span>
    <div class="vh-actions">${st?`<button class="btn" data-act="openStructure" data-id="${st.id}">Fiche structure</button>`:''}
      <button class="btn" data-act="wsTask" data-id="${p.id}">Nouvelle tâche</button>
      <button class="btn primary" data-act="wsShow" data-id="${p.id}">Poser une date</button></div></div>
  <div class="workspace">
    <div>${suiviCard(p, {page:true})}</div>
    <aside class="side">${sidePanel(p, st, proj, target)}</aside>
  </div>`;
}

function sidePanel(p, st, proj, target){
  const ids = projIds(p);
  if (!ids.length) return `<div class="panel pad"><p class="muted" style="margin:0">Ajoute l'artiste concerné (+ Projet) pour voir son planning et ses dates autour.</p></div>`;
  const here = st && st.lat!=null ? [st.lat, st.lng] : null;
  const shows = showsOfProject(proj).filter(s => s.date && (!isOff(s.status))).sort((a,b)=>a.date.localeCompare(b.date));
  const from = target ? addD(target, -45) : today();
  const to = target ? addD(target, 45) : addD(today(), 365);
  const win = shows.filter(s => s.date >= from && s.date <= to);
  const busy = target ? shows.filter(s => s.date <= target && (s.date_end||s.date) >= target) : [];
  // dates autour de la date visée (±10 jours), avec distance depuis cette structure
  const around = target ? shows.filter(s => Math.abs(daysBetween(target, s.date)) <= 10) : [];
  const pts = win.map(s => { const c = showCoords(s); return c && {lat:c[0], lng:c[1], color:stColor(s.status), big:(s.status||'').startsWith('Confirmée'),
    label:`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}`}; }).filter(Boolean);
  if (here) pts.push({lat:here[0], lng:here[1], color:'#FFFFFF', ring:true, big:true, label:`<b>${esc(st.name)}</b><br>Date en négociation${target?' : '+fmtDate(target):''}`});
  const near = target && here ? around.filter(s=>showCoords(s)) : pts.slice(0, 0);
  setMapData({points: pts, key:`ws|${p.id}|${proj}|${target}`, fitTo: here && near.length ? [here, ...near.map(showCoords)] : here ? [here] : null, zoom:7});
  // distances routières en arrière-plan
  if (here){ const todo = around.filter(s => showCoords(s) && !routeCached(here, s)); if (todo.length) Promise.all(todo.map(s=>route(here, s))).then(()=>{ const el = $('#ws-near'); if (el && S.suiviPage===p.id) el.innerHTML = nearList(around, here, target); }); }
  return `
    ${ids.length>1 ? `<div class="seg" role="tablist">${ids.map(id=>`<button class="btn ${id===proj?'on':''}" data-act="wsProject" data-id="${id}" aria-pressed="${id===proj}">${esc(projName(id))}</button>`).join('')}</div>` : ''}
    <div class="panel pad">
      <div class="target-row"><label class="block-title" style="margin:0">Date en négociation</label>
        ${dateInput(target, 'data-ws-target="1"')}
        ${target?`<button class="btn sm ghost" data-act="wsClear">Effacer</button>`:''}</div>
      ${target ? (busy.length ? `<p class="target-msg busy">${esc(projName(proj))} n'est pas libre le ${fmtDate(target)} : ${busy.map(s=>`${esc(s.venue)} (${esc(s.status)})`).join(', ')}</p>`
                                : `<p class="target-msg free">${esc(projName(proj))} est libre le ${fmtDate(target)}.</p>`)
               : '<p class="help" style="margin:6px 0 0">Indique la date demandée : le planning, la carte et les distances se centrent dessus.</p>'}
      ${target ? `<div id="ws-near">${here ? nearList(around, here, target) : '<p class="muted">Cette structure n’a pas de ville localisée : ajoute son adresse dans la fiche structure pour avoir les distances.</p>'}</div>` : ''}
    </div>
    <div class="map-box"><div id="map-slot" role="region" aria-label="Carte des dates de l'artiste"></div></div>
    <div class="panel pad"><h3 class="block-title">Planning de ${esc(projName(proj))} <span class="muted" style="font-weight:500">${target?'45 jours autour de la date':'12 prochains mois'}</span></h3>
      <div class="planning">${win.map(s => `<div class="plan-row ${target && Math.abs(daysBetween(target, s.date))<=2 ? 'target':''}" data-act="editShow" data-id="${s.id}" style="cursor:pointer">
          <span class="d">${fmtShort(s.date)}</span><span><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city||'')}</span></span>${stBadge(s.status)}</div>`).join('') || '<p class="muted">Aucune date sur cette période.</p>'}</div>
    </div>`;
}

function nearList(around, here, target){
  if (!around.length) return '<p class="muted" style="margin:8px 0 0">Aucune autre date à moins de 10 jours.</p>';
  return `<ul class="near-list" style="list-style:none;margin:8px 0 0;padding:0">${around.map(s => {
    const c = showCoords(s), r = c && routeCached(here, s), d = daysBetween(target, s.date);
    return `<li><span>${stBadge(s.status)} <b>${esc(s.venue)}</b> · ${esc(s.city||'')}<br><span class="muted">${fmtShort(s.date)} (${d===0?'même jour':d>0?'J+'+d:'J'+d})</span></span>
      <span class="num" style="text-align:right">${!c ? '<span class="muted">non localisée</span>' : r && !r.error ? `<b>${r.km} km</b><br><span class="muted">${r.time}</span>` : `${Math.round(distKm(here, c))} km<br><span class="muted">à vol d'oiseau</span>`}</span></li>`; }).join('')}</ul>`;
}

const addD = (d, n) => { const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
