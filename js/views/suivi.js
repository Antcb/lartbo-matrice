/**
 * Onglet Suivi : liste des suivis (filtres artiste + statut, export CSV) et espace de prospection.
 * Espace de prospection = la fiche du suivi à gauche (résumé IA, journal, pièces jointes) et, à droite,
 * sans quitter la fiche : les dates de ce suivi (modifiables), la date en négociation, la carte avec
 *  - les dates de l'artiste dans un rayon réglable (0–300 km) autour de la structure, d'aujourd'hui à un an après la date,
 *  - toutes ses dates dans le monde 5 jours avant / après,
 * avec distance et temps de route depuis la structure, et le planning de l'artiste.
 */
import { LOG_ICON, LOG_KINDS, PROSPECT, isOff, stColor } from '../constants.js';
import { lingering } from '../data.js';
import { distKm, routeCached, route } from '../geo.js';
import { byId, isDone, tasksOfStructure, urgency, filesOf, lastExchange, linksOfStructure, logsOf, projIds, projName, projNames, projectOptions, showCoords, showsOfProject, structName } from '../selectors.js';
import { S, localGet, localSet } from '../state.js';
import { dropZone, fileRow, fold, projPicker, stSelect, pstBadge, stBadge, tabsBar, curTab, viewHead } from '../ui/bits.js';
import { cAc, cIn, cSel, projChips } from '../ui/cells.js';
import { acInput } from '../ui/autocomplete.js';
import { dateInput } from '../ui/datefield.js';
import { $, daysBetween, esc, eur, fmtDate, fmtShort, matches, md, period, today } from '../utils.js';
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
      ${projPicker(S.project, {attrs:'data-suivi-filter="project" aria-label="Artiste"'})}
      <select class="sel" data-suivi-filter="status" aria-label="Statut"><option value="">Tous les statuts</option>${PROSPECT.map(x=>`<option value="${x}" ${x===st?'selected':''}>${x}</option>`).join('')}</select>
      <input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-suivi" placeholder="Structure, ville, mot du résumé…" data-search="prospects" value="${esc(q)}"></div>`,
    actions: `${nClosed ? `<button class="btn" data-act="toggleClosed" aria-pressed="${!!S.showClosed}">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${nClosed})</button>` : ''}
      <button class="btn" data-act="exportSuivis">Exporter</button>
      <button class="btn primary" data-act="newProspect">Nouveau suivi</button>`})
  + `<div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Artiste(s)</th><th>Statut</th><th>Dernier échange</th><th class="num">Journal</th><th class="num">Fichiers</th><th>Résumé</th></tr></thead><tbody>
    ${rows.slice(0,500).map(({p,last})=>{ const s=byId('structures',p.structure_id);
      return `<tr class="click ${lingering(p.id)?'leaving':''}" data-act="openSuivi" data-id="${p.id}"><td><b>${esc(s?.name||p.name)}</b><span class="sub">${esc([s?.city, s?.department_code && '('+s.department_code+')'].filter(Boolean).join(' '))}</span></td>
      <td>${esc(projNames(p))}</td><td>${pstBadge(p.status)}</td>
      <td class="nowrap">${last?fmtDate(last):'<span class="muted">—</span>'}</td><td class="num">${logsOf(p.id).length||''}</td><td class="num">${filesOf(p.id).length||''}</td>
      <td class="muted" style="min-width:280px">${esc((p.summary||p.content_md||'').replace(/\*\*/g,'').replace(/\n/g,' ').slice(0,200))}</td></tr>`;}).join('') || '<tr><td colspan="7" class="empty">Aucun suivi.</td></tr>'}
    </tbody></table></div>`;
}

/** Fiche de suivi : résumé (IA) en haut, puis journal des échanges, pièces jointes et notes.
 *  Utilisée dans l'espace de prospection (page) et dans l'onglet Suivi d'une structure. */
export function suiviCard(p, {page=false}={}){
  const logs = logsOf(p.id), files = filesOf(p.id);
  const contacts = linksOfStructure(p.structure_id);
  const summary = `
      <div class="suivi-block summary-block"><h3 class="block-title">Résumé des échanges
        <span class="spacer"></span>
        <button class="btn sm" data-act="aiSummary" data-id="${p.id}" title="Résumé automatique à partir du journal, des notes et des PDF">Mettre à jour avec l'IA</button>
        <button class="btn sm ghost" data-act="editText" data-id="${p.id}" data-f="summary">Modifier</button>
        <button class="btn sm ghost" data-act="copyForAi" data-id="${p.id}" title="Copie le suivi pour le coller dans ChatGPT">Copier pour ChatGPT</button></h3>
        <div class="md">${md(p.summary) || '<span class="muted">Pas encore de résumé.</span>'}</div></div>`;
  const d = logDraft(p.id);
  const tasks = suiviTasks(p);
  const tasksHTML = `<div class="suivi-block"><h3 class="block-title">Tâches Booking <span class="count">${tasks.filter(t=>!isDone(t)).length}</span><span class="spacer"></span>
      <button type="button" class="btn sm" data-act="wsTask" data-id="${p.id}">Nouvelle tâche</button></h3>
      ${tasks.length ? `<div class="mini-tasks">${tasks.map(t => { const u = urgency(t); return `<div class="mini-task ${isDone(t)?'done':''} ${lingering(t.id)?'leaving':''}">
        <input type="checkbox" data-act="toggleTask" data-id="${t.id}" ${t.status==='Done'?'checked':''} aria-label="Marquer comme faite">
        ${cIn('tasks',t.id,'title',t.title,'text','aria-label="Nom de la tâche"')}
        ${cIn('tasks',t.id,'deadline',t.deadline,'date')}
        ${u?`<span class="urg ${u.cls}">${esc(u.label)}</span>`:'<span></span>'}
        <button type="button" class="btn sm ghost" data-act="editTask" data-id="${t.id}">Détails</button></div>`; }).join('')}</div>` : '<p class="muted" style="margin:0">Aucune tâche Booking liée à cette structure.</p>'}</div>`;
  const journal = `
      <div class="suivi-block"><h3 class="block-title">Journal des échanges <span class="count">${logs.length}</span></h3>
        <form class="log-form" data-logform="${p.id}">
          ${dateInput(d.date || today(), 'name="date"')}
          <select name="kind" class="sel" aria-label="Type d'échange">${LOG_KINDS.map(k=>`<option ${k===d.kind?'selected':''}>${k}</option>`).join('')}</select>
          <input name="who" class="inp" placeholder="Interlocuteur" list="dl-who-${p.id}" aria-label="Interlocuteur" autocomplete="off" value="${esc(d.who||'')}">
          <datalist id="dl-who-${p.id}">${contacts.map(c=>`<option value="${esc(c.display_name)}">`).join('')}</datalist>
          <textarea name="body" placeholder="Notes de l'échange… (gardées en brouillon tant que tu ne les ajoutes pas)" aria-label="Notes">${esc(d.body||'')}</textarea>
          <div class="log-actions"><button class="btn primary sm">Ajouter au journal</button>${d.body||d.who?'<span class="draft-note">Brouillon enregistré</span><button type="button" class="btn sm ghost" data-act="clearLogDraft" data-id="'+p.id+'">Effacer le brouillon</button>':''}</div>
        </form>
        ${logs.map(l=>`<div class="log">
          <div class="log-head">${LOG_ICON[l.kind]||'📝'} <b>${l.date?fmtDate(l.date):'Sans date'}</b>${l.contact_name?' · '+esc(l.contact_name):''}
            <span class="spacer"></span><button type="button" class="btn sm ghost" data-act="editLog" data-id="${l.id}">Modifier</button>
            <button type="button" class="btn icon sm ghost danger" data-act="delLog" data-id="${l.id}" aria-label="Supprimer l'entrée">✕</button></div>
          <div class="md">${md(l.body)}</div></div>`).join('') || '<div class="muted">Aucun échange enregistré.</div>'}
      </div>`;
  const side = `
      <div class="suivi-block"><h3 class="block-title">Pièces jointes <span class="count">${files.length}</span></h3>
        ${dropZone({prospect_id:p.id}, files.map(f=>fileRow(f)).join(''))}</div>
      <div class="suivi-block"><h3 class="block-title">Autres notes <button class="btn sm ghost" data-act="editText" data-id="${p.id}" data-f="content_md">Modifier</button></h3>
        <div class="md">${md(p.content_md) || '<span class="muted">—</span>'}</div></div>`;
  const head = `<div class="suivi-head">
      ${projChips('prospects', p)}
      <span class="sel-wrap">${cSel('prospects',p.id,'status',p.status,PROSPECT,false)}</span>
      <span class="muted">Dernier échange : ${lastExchange(p)?fmtDate(lastExchange(p)):'—'}</span>
      <span class="spacer"></span>
      ${page ? '' : `<button class="btn sm" data-act="openSuivi" data-id="${p.id}">Ouvrir avec planning et carte</button>`}
      <button class="btn sm ghost danger" data-act="delProspect" data-id="${p.id}">Supprimer</button>
    </div>`;
  if (page) return `<div class="panel suivi ${lingering(p.id)?'leaving':''}" id="pr-${p.id}">${head}${summary}${tasksHTML}${journal}${side}</div>`;
  return `<div class="panel suivi ${lingering(p.id)?'leaving':''}" id="pr-${p.id}">${head}${summary}${tasksHTML}<div class="suivi-grid"><div>${journal}</div><div>${side}</div></div></div>`;
}

/** Brouillon des notes d'échange d'un suivi (gardé dans le navigateur jusqu'à l'ajout au journal) */
export function logDraft(pid){ S.logDrafts ||= {}; if (!S.logDrafts[pid]) { try { S.logDrafts[pid] = JSON.parse(localGet('logdraft.'+pid) || '{}'); } catch(e){ S.logDrafts[pid] = {}; } } return S.logDrafts[pid]; }
export function setLogDraft(pid, d){ S.logDrafts ||= {}; S.logDrafts[pid] = d; localSet('logdraft.'+pid, JSON.stringify(d)); }
export const hasLogDraft = pid => { const d = logDraft(pid); return !!((d.body||'').trim() || (d.who||'').trim()); };

/** Tâches d'un suivi : même structure (et même artiste si la tâche en a un) ; terminées masquées sauf pendant 5 s */
export function suiviTasks(p){
  if (!p.structure_id) return [];
  const ids = projIds(p);
  return tasksOfStructure(p.structure_id).filter(t => /^booking$/i.test(t.department || '') && (!projIds(t).length || projIds(t).some(x => ids.includes(x))) && (!isDone(t) || lingering(t.id)))
    .slice().sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));
}

/** Dates rattachées à un suivi : liées explicitement, ou même structure et même artiste */
export function showsOfSuivi(p){
  const ids = projIds(p);
  return S.db.shows.filter(s => s.prospect_id === p.id || (p.structure_id && s.structure_id === p.structure_id && ids.includes(s.project_id)))
    .sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
}

/* ------------------------------------------------------------------ Espace de prospection */
function suiviPage(p){
  const st = byId('structures', p.structure_id);
  const ids = projIds(p);
  const proj = ids.includes(S.wsProject) ? S.wsProject : ids[0] || null;
  const linked = showsOfSuivi(p);
  // date en négociation : celle tapée, sinon la prochaine date déjà posée pour ce suivi
  if (S.wsTarget === undefined || S.wsFor !== p.id){
    S.wsFor = p.id;
    S.wsTarget = (linked.find(s => s.date >= today() && !isOff(s.status) && (!proj || s.project_id===proj)) || linked.find(s => !isOff(s.status)))?.date || null;
  }
  const contacts = linksOfStructure(p.structure_id);
  return `<button class="btn ghost back" data-act="closeSuivi">← Suivi</button>
  <div class="view-head"><div class="vh-title"><h1>${esc(st?.name || 'Nouveau suivi')}</h1>
    <span class="sub">${esc([st?.city, st?.department_code && '('+st.department_code+')', st?.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(' '))}</span></div>
    <span class="spacer"></span>
    <div class="vh-actions">${st?`<button class="btn" data-act="openStructure" data-id="${st.id}">Fiche structure</button>`:''}
      <button class="btn" data-act="wsTask" data-id="${p.id}">Nouvelle tâche</button>
      <button class="btn primary" data-act="wsShow" data-id="${p.id}" ${st?'':'disabled title="Choisis d’abord la structure"'}>Poser une date</button></div></div>
  <div class="panel pad ws-who">
    <div class="field"><label>Structure</label>${cAc('structures','prospects',p.id,'structure_id',p.structure_id,{create:true, placeholder:'Chercher ou créer la structure (salle, festival…)'})}</div>
    <div class="field"><label>Contacts de la structure</label><div class="proj-chips">${contacts.map(c=>`<a href="#" class="chip" data-act="editContact" data-id="${c.id}" style="padding-right:10px">${esc(c.display_name)}</a>`).join('')}
      ${st?`<button type="button" class="btn sm" data-act="newContactFor" data-id="${st.id}">+ Contact</button>`:'<span class="muted">Choisis la structure</span>'}</div></div>
  </div>
  <div class="workspace">
    <div>${suiviCard(p, {page:true})}</div>
    <aside class="side">${sidePanel(p, st, proj, linked)}</aside>
  </div>`;
}

const addD = (d, n) => { const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const addY = (d, n) => `${Number(d.slice(0,4))+n}${d.slice(4)}`;

function sidePanel(p, st, proj, linked){
  const ids = projIds(p);
  // Dates sans suite, annulées ou d'un artiste qui n'est pas dans ce suivi : repliées
  const active = linked.filter(s => !isOff(s.status) && ids.includes(s.project_id)), others = linked.filter(s => !active.includes(s));
  const linkedRow = s=>`<div class="plan-row ${s.date===S.wsTarget?'target':''}" data-id="${s.id}"><span class="d">${period(s)}<br><span class="muted" style="font-weight:400">${s.date?s.date.slice(0,4):''}</span></span>
      <span><b>${esc(projName(s.project_id))}</b> <span class="muted">${esc(s.venue)}</span><br>${stSelect(s)} ${s.fee_ht?`<b class="fee-tag">${eur(s.fee_ht)} HT</b>`:''}</span>
      <span style="display:flex;gap:4px;flex-direction:column;align-items:flex-end"><button type="button" class="btn sm" data-act="editShow" data-id="${s.id}">Modifier</button>
        ${s.date && s.date!==S.wsTarget?`<button type="button" class="btn sm ghost" data-act="wsSetTarget" data-d="${s.date}">Centrer</button>`:''}</span></div>`;
  const linkedHTML = `<div class="panel pad"><h3 class="block-title">Dates de ce suivi <span class="count">${active.length}</span></h3>
    ${active.map(linkedRow).join('') || '<p class="muted" style="margin:0 0 6px">Aucune date en cours pour ce suivi.</p>'}
    ${others.length ? fold('suivi-others', 'Sans suite, annulées ou autres artistes', others.map(linkedRow).join(''), {count: others.length}) : ''}
    <div class="field" style="margin-top:8px"><label>Rattacher une date existante</label>${acInput('shows', {attrs:`data-link-show="${p.id}"`, placeholder:'Chercher une date (artiste, lieu, date)…'})}</div></div>`;
  if (!ids.length) return linkedHTML + `<div class="panel pad"><p class="muted" style="margin:0">Ajoute l'artiste concerné (+ Projet) pour voir son planning et ses dates autour.</p></div>`;
  const target = S.wsTarget;
  const R = S.wsRadius ?? 200;
  const here = st && st.lat!=null ? [st.lat, st.lng] : null;
  const shows = showsOfProject(proj).filter(s => s.date && !isOff(s.status)).sort((a,b)=>a.date.localeCompare(b.date));
  const now = today();
  // ±5 jours autour de la date, partout dans le monde
  const around = target ? shows.filter(s => Math.abs(daysBetween(target, s.date)) <= 5) : [];
  // rayon autour de la structure, d'aujourd'hui à un an après la date
  const until = target ? addY(target, 1) : addY(now, 1);
  const inRadius = here ? shows.filter(s => s.date >= now && s.date <= until && !around.includes(s) && showCoords(s) && distKm(here, showCoords(s)) <= R) : [];
  const shown = target ? [...around, ...inRadius] : shows.filter(s => s.date >= now && s.date <= until);
  const pts = shown.map(s => { const c = showCoords(s); return c && {lat:c[0], lng:c[1], color:stColor(s.status), big:(s.status||'').startsWith('Confirmée'), showId:s.id, from: here,
    label:`<b>${esc(s.venue)}</b><br>${fmtDate(s.date)} — ${esc(s.city||'')}<br>${esc(s.status)}`}; }).filter(Boolean);
  if (here) pts.push({lat:here[0], lng:here[1], color:'#FFFFFF', ring:true, big:true, label:`<b>${esc(st.name)}</b><br>Date en négociation${target?' : '+fmtDate(target):''}`});
  setMapData({points: pts, key:`ws|${p.id}|${proj}|${target}|${R}`, circle: here && target ? {center: here, km: R} : null,
    fitTo: here ? [here, ...pts.map(x=>[x.lat,x.lng])] : null, zoom:7});
  // distances routières en arrière-plan pour les listes
  if (here){ const todo = shown.filter(s => showCoords(s) && !routeCached(here, s)).slice(0, 25);
    if (todo.length) Promise.all(todo.map(s=>route(here, s))).then(()=>{ if (S.suiviPage===p.id){ const el = $('#ws-lists'); if (el) el.innerHTML = lists(around, inRadius, here, target, R, until); } }); }
  const busy = target ? shows.filter(s => s.date <= target && (s.date_end||s.date) >= target && !(s.structure_id===p.structure_id)) : [];
  return linkedHTML + `
    ${ids.length>1 ? `<div class="seg" role="tablist">${ids.map(id=>`<button class="btn ${id===proj?'on':''}" data-act="wsProject" data-id="${id}" aria-pressed="${id===proj}">${esc(projName(id))}</button>`).join('')}</div>` : ''}
    <div class="panel pad">
      <div class="target-row"><label class="block-title" style="margin:0">Date en négociation</label>
        ${dateInput(target, 'data-ws-target="1"')}
        ${target?`<button class="btn sm ghost" data-act="wsClear">Effacer</button>`:''}</div>
      <div class="target-row" style="margin-top:8px"><label class="block-title" style="margin:0" for="ws-radius">Rayon</label>
        <input id="ws-radius" type="range" min="0" max="300" step="10" value="${R}" data-ws-radius="1" aria-label="Rayon en kilomètres"><b class="num" id="ws-radius-v">${R} km</b></div>
      ${target ? (busy.length ? `<p class="target-msg busy">${esc(projName(proj))} n'est pas libre le ${fmtDate(target)} : ${busy.map(s=>`${esc(s.venue)} (${esc(s.status)})`).join(', ')}</p>`
                                : `<p class="target-msg free">${esc(projName(proj))} est libre le ${fmtDate(target)}.</p>`)
               : '<p class="help" style="margin:6px 0 0">Indique la date demandée : la carte montre ses dates 5 jours avant / après, et celles dans le rayon jusqu’à un an après.</p>'}
    </div>
    <div class="map-box"><div id="map-slot" role="region" aria-label="Carte des dates de l'artiste"></div></div>
    ${target ? `<div id="ws-lists">${lists(around, inRadius, here, target, R, until)}</div>` : ''}
    <div class="panel pad"><h3 class="block-title">Planning de ${esc(projName(proj))} <span class="muted" style="font-weight:500">${target?'45 jours autour de la date':'12 prochains mois'}</span></h3>
      <div class="planning">${(target ? shows.filter(s => Math.abs(daysBetween(target, s.date)) <= 45) : shows.filter(s => s.date >= now && s.date <= until)).map(s => `<div class="plan-row ${target && Math.abs(daysBetween(target, s.date))<=2 ? 'target':''}" data-act="editShow" data-id="${s.id}" style="cursor:pointer">
          <span class="d">${period(s)}</span><span><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city||'')}</span>${s.fee_ht?` <span class="fee-tag">${eur(s.fee_ht)} HT</span>`:''}</span>${stSelect(s)}</div>`).join('') || '<p class="muted">Aucune date sur cette période.</p>'}</div>
    </div>`;
}

function distCell(s, here){
  const c = showCoords(s); if (!c) return '<span class="muted">non localisée</span>';
  if (!here) return '';
  const r = routeCached(here, s);
  return r && !r.error ? `<b>${r.km} km</b><br><span class="muted">${r.time}</span>` : `${Math.round(distKm(here, c))} km<br><span class="muted">à vol d'oiseau</span>`;
}

function lists(around, inRadius, here, target, R, until){
  const row = s => { const d = daysBetween(target, s.date);
    return `<li><span>${stBadge(s.status)} <b>${esc(s.venue)}</b> · ${esc(s.city||'')}<br><span class="muted">${period(s)} ${s.date.slice(0,4)} (${d===0?'même jour':d>0?'J+'+d:'J'+d})${s.fee_ht?' · '+eur(s.fee_ht)+' HT':''}</span></span>
      <span class="num" style="text-align:right">${distCell(s, here)}</span></li>`; };
  return `<div class="panel pad near-list"><h3 class="block-title">5 jours avant / après <span class="count">${around.length}</span></h3>
      ${around.length ? `<ul>${around.map(row).join('')}</ul>` : '<p class="muted" style="margin:0">Aucune date entre le '+fmtDate(addD(target,-5))+' et le '+fmtDate(addD(target,5))+'.</p>'}
    </div>
    <div class="panel pad near-list"><h3 class="block-title">Dans un rayon de ${R} km jusqu’au ${fmtDate(until)} <span class="count">${inRadius.length}</span></h3>
      ${!here ? '<p class="muted" style="margin:0">Cette structure n’a pas de ville localisée : ajoute son adresse dans la fiche structure.</p>'
        : inRadius.length ? `<ul>${inRadius.map(row).join('')}</ul>` : '<p class="muted" style="margin:0">Aucune date dans ce rayon sur la période.</p>'}
    </div>`;
}
