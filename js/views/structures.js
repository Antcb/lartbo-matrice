/**
 * Onglet Structures : recherche (texte, autour d'une ville) et page structure.
 */
import { stClass } from '../constants.js';
import { distKm } from '../geo.js';
import { byId, lastExchange, linksOfStructure, projName, taskSort } from '../selectors.js';
import { S } from '../state.js';
import { esc, eur, fmtDate, md } from '../utils.js';
import { suiviCard } from './suivi.js';
import { taskSection } from './todo.js';

export function structurePage(st){
  if (!st){ S.structurePage=null; return viewStructures(); }
  const contacts = linksOfStructure(st.id);
  const suivis = S.db.prospects.filter(p=>p.structure_id===st.id).sort((a,b)=>(lastExchange(b)||'').localeCompare(lastExchange(a)||''));
  const shows = S.db.shows.filter(x=>x.structure_id===st.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const tasks = S.db.tasks.filter(t=>t.structure_id===st.id).sort(taskSort);
  return `<div class="view-head"><button class="btn ghost" data-act="closeStructure">← Structures</button><h1>${esc(st.name)}</h1>
    <span class="sub">${esc([st.city, st.region, st.country].filter(Boolean).join(' · '))}</span><span class="spacer"></span>
    <button class="btn" data-act="editStructure" data-id="${st.id}">Modifier la fiche</button>
    <button class="btn primary" data-act="newSuiviFor" data-id="${st.id}">Nouveau suivi</button></div>
  <div class="struct-top">
    <div class="panel" style="padding:12px 14px">
      ${(st.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join(' ')}
      <div class="kv">${[['Adresse',[st.address,st.postal_code].filter(Boolean).join(' ')],['Jauge',[st.capacity_1,st.capacity_2].filter(Boolean).join(' / ')],['Tarif',st.pricing],
        ['Site',st.website?`<a href="${esc(/^https?:/.test(st.website)?st.website:'https://'+st.website)}" target="_blank" rel="noopener">${esc(st.website)}</a>`:'']]
        .filter(([,v])=>v).map(([k,v])=>`<span class="muted">${k}</span><span>${k==='Site'?v:esc(v)}</span>`).join('')}</div>
      ${st.notes?`<div class="md" style="margin-top:8px">${md(st.notes)}</div>`:''}
    </div>
    <div class="panel" style="padding:12px 14px"><div class="suivi-title">Contacts</div>
      ${contacts.map(c=>`<div class="contact-row"><a href="#" data-act="editContact" data-id="${c.id}"><b>${esc(c.display_name)}</b></a>
        <span class="muted">${esc((c.roles||[]).join(', '))}</span>
        ${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''} ${c.phone?`<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`:''}</div>`).join('') || '<div class="muted">Aucun contact lié.</div>'}
    </div>
  </div>
  <div class="section-title">Suivi</div>
  ${(() => { const closed = suivis.filter(p=>p.status==='Closed'), open = suivis.filter(p=>p.status!=='Closed');
     const shown = S.showClosed ? suivis : open;
     return (shown.map(suiviCard).join('') || `<div class="empty panel">${closed.length ? 'Aucun suivi en cours avec cette structure.' : 'Aucun suivi avec cette structure. Crée-le avec « Nouveau suivi ».'}</div>`)
       + (closed.length ? `<button class="btn small ghost toggle-more" data-act="toggleClosed">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${closed.length})</button>` : ''); })()}
  <div class="section-title row">Dates <button class="btn small" data-act="newShowFor" data-id="${st.id}">Nouvelle date</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Projet</th><th>Lieu</th><th>Statut</th><th class="num">Cachet</th></tr></thead><tbody>
    ${shows.map(x=>`<tr class="click" data-act="editShow" data-id="${x.id}"><td>${fmtDate(x.date)}</td><td>${esc(projName(x.project_id))}</td><td>${esc(x.venue)}</td><td><span class="st ${stClass(x.status)}">${esc(x.status)}</span></td><td class="num">${eur(x.fee_ht)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune date.</td></tr>'}
  </tbody></table></div>
  <div class="section-title row">Tâches <button class="btn small" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`;
}

export function viewStructures(){
  if (S.structurePage) return structurePage(byId('structures', S.structurePage));
  const norm = x => String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const words = norm(S.search.structures).split(/\s+/).filter(Boolean);
  const tag = S.structTag || '';
  let rows = S.db.structures;
  if (tag) rows = rows.filter(s => (s.tags||[]).includes(tag));
  if (words.length) rows = rows.filter(s => { const hay = norm([s.name,s.address,s.city,s.postal_code,s.department_code,s.department_name,s.region,s.country,...(s.tags||[])].join(' '));
    return words.every(w => hay.includes(w)); });
  const near = S.near;   // {label, lat, lng, km}
  if (near){
    rows = rows.map(s => ({s, d: s.lat!=null ? distKm([near.lat,near.lng],[s.lat,s.lng]) : null})).filter(x => x.d!=null && x.d <= near.km)
      .sort((a,b)=>a.d-b.d).map(x => (x.s._d = x.d, x.s));
  } else rows = rows.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const tags = [...new Set(S.db.structures.flatMap(s=>s.tags||[]))].sort((a,b)=>a.localeCompare(b));
  return `<div class="view-head"><h1>Structures</h1><span class="sub">${rows.length} structures${near?` à moins de ${near.km} km de ${esc(near.label)}`:''}</span><span class="spacer"></span>
    <button class="btn primary" data-act="newStructure">Nouvelle structure</button></div>
    <form class="near-form" id="near-form">
      <input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Nom, ville, département (69, Rhône…), région, tag…" data-search="structures" value="${esc(S.search.structures||'')}">
      <select class="filter-sel" data-struct-tag aria-label="Type"><option value="">Tous les types</option>${tags.map(t=>`<option ${t===tag?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <span class="near-box">
        <input type="search" autocomplete="off" name="autour" placeholder="Autour de… (ville)" value="${esc(near?.label||'')}" aria-label="Autour de quelle ville">
        <select name="km" aria-label="Rayon">${[20,50,100,150,200,300].map(k=>`<option value="${k}" ${(near?.km||50)===k?'selected':''}>${k} km</option>`).join('')}</select>
        <button class="btn small primary">Chercher</button>
        ${near?'<button type="button" class="btn small" data-act="clearNear">Effacer</button>':''}
      </span>
    </form>
    ${near?'<p class="muted" style="margin:-4px 0 10px;font-size:12px">Seules les structures localisées (avec une ville connue) apparaissent dans la recherche par distance.</p>':''}
    <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Tags</th><th>Ville</th><th>Département · Région</th><th>Pays</th><th class="num">Jauge</th><th>Contacts</th><th>Suivi</th></tr></thead><tbody>
    ${rows.slice(0,400).map(s=>`<tr class="click" data-act="openStructure" data-id="${s.id}"><td><b>${esc(s.name)}</b></td>
      <td style="white-space:normal">${(s.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</td>
      <td>${esc(s.city||'')}${s._d!=null && near?` <span class="muted">· ${Math.round(s._d)} km</span>`:''}</td><td>${esc([s.department_code&&s.department_name?s.department_code+' '+s.department_name:'', s.region].filter(Boolean).join(' · '))}</td><td>${esc(s.country||'')}</td>
      <td class="num">${[s.capacity_1,s.capacity_2].filter(Boolean).join(' / ')}</td>
      <td>${linksOfStructure(s.id).length||''}</td><td>${(()=>{const p=S.db.prospects.filter(x=>x.structure_id===s.id); return p.length?p.map(x=>`<span class="pst ${esc(x.status)}">${esc(x.status)}</span>`).join(' '):'';})()}</td></tr>`).join('')}
    </tbody></table>${rows.length>400?`<p class="muted" style="padding:8px">400 premiers résultats affichés — affine la recherche.</p>`:''}</div>`;
}
