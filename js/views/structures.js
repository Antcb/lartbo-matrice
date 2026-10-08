/**
 * Onglet Structures : recherche (nom, ville, département, région, « autour de » une ville) et page structure
 * avec ses onglets : Accueil, Suivi, Dates, Tâches, Événements, Coordonnées administratives.
 */
import { lingering } from '../data.js';
import { distKm } from '../geo.js';
import { byId, eventsOfStructure, lastExchange, linksOfStructure, projName, prospectsOfStructure, showsOfStructure, tasksOfStructure } from '../selectors.js';
import { S } from '../state.js';
import { curTab, pstBadge, stBadge, tabsBar, tag, viewHead } from '../ui/bits.js';
import { cIn } from '../ui/cells.js';
import { esc, eur, fmtDate, md, norm, url } from '../utils.js';
import { suiviCard } from './suivi.js';
import { taskSection } from './todo.js';

// Coordonnées administratives (champ admin de la structure) : [clé, libellé, pleine largeur ?]
export const ADMIN_FIELDS = [
  ['legal_name','Raison sociale'], ['legal_form','Forme juridique'], ['siret','SIRET'], ['ape','Code APE / NAF'],
  ['vat','N° TVA intracommunautaire'], ['licence','Licence(s) d’entrepreneur de spectacles'],
  ['address','Adresse du siège',true], ['postal_code','Code postal'], ['city','Ville'], ['country','Pays'],
  ['signatory','Représenté·e par (nom)'], ['signatory_role','Qualité (président·e, directeur·rice…)'],
  ['email','Mail administratif'], ['phone','Téléphone administratif'], ['billing_email','Mail de facturation'],
  ['notes','Remarques pour les contrats',true],
];

export function structurePage(st){
  if (!st){ S.structurePage=null; return viewStructures(); }
  const contacts = linksOfStructure(st.id);
  const suivis = prospectsOfStructure(st.id).slice().sort((a,b)=>(lastExchange(b)||'').localeCompare(lastExchange(a)||''));
  const shows = showsOfStructure(st.id).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const tasks = tasksOfStructure(st.id);
  const events = eventsOfStructure(st.id);
  const openSuivis = suivis.filter(p=>p.status!=='Closed' || lingering(p.id));
  const tab = curTab('structure', 'home');
  const tabs = tabsBar('structure', [['home','Accueil'], ['suivi','Suivi', openSuivis.length], ['dates','Dates', shows.length], ['tasks','Tâches', tasks.filter(t=>!['Done','Cancelled'].includes(t.status)).length],
    ['events','Festivals / événements', events.length], ['admin','Coordonnées administratives']]);
  let body = '';
  if (tab==='home') body = homeTab(st, contacts);
  else if (tab==='suivi'){
    const closed = suivis.filter(p=>p.status==='Closed' && !lingering(p.id));
    const shown = S.showClosed ? suivis : openSuivis;
    body = `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="newSuiviFor" data-id="${st.id}">Nouveau suivi</button>
        ${closed.length ? `<button class="btn" data-act="toggleClosed" aria-pressed="${!!S.showClosed}">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${closed.length})</button>` : ''}</div>`
      + (shown.map(p => suiviCard(p)).join('') || `<div class="empty panel">${closed.length ? 'Aucun suivi en cours avec cette structure.' : 'Aucun suivi avec cette structure.'}</div>`);
  }
  else if (tab==='dates') body = `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="newShowFor" data-id="${st.id}">Nouvelle date</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Artiste</th><th>Lieu</th><th>Statut</th><th class="num">Cachet</th><th>Contrat</th></tr></thead><tbody>
    ${shows.map(x=>`<tr class="click" data-act="editShow" data-id="${x.id}"><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(projName(x.project_id))}</td><td>${esc(x.venue)}<span class="sub">${esc(x.city||'')}</span></td><td>${stBadge(x.status)}</td><td class="num">${eur(x.fee_ht)}</td><td>${esc(x.contract_type||'')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucune date avec cette structure.</td></tr>'}
    </tbody></table></div>`;
  else if (tab==='tasks') body = `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`;
  else if (tab==='events') body = eventsTab(st, events);
  else if (tab==='admin') body = adminTab(st);
  return `<button class="btn ghost back" data-act="closeStructure">← Structures</button>
  ${viewHead(esc(st.name), {sub: esc([st.city, st.department_code && '('+st.department_code+')', st.region, st.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(' · ')),
    actions:`<button class="btn" data-act="editStructure" data-id="${st.id}">Modifier la fiche</button>
      <button class="btn" data-act="newShowFor" data-id="${st.id}">Nouvelle date</button>
      <button class="btn" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button>
      <button class="btn primary" data-act="newSuiviFor" data-id="${st.id}">Nouveau suivi</button>`})}
  ${tabs}${body}`;
}

function homeTab(st, contacts){
  const facts = [
    ['Adresse', [st.address, [st.postal_code, st.city].filter(Boolean).join(' '), st.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(', ')],
    ['Jauge', [st.capacity_1, st.capacity_2].filter(Boolean).join(' / ')],
    ['Tarif', st.pricing],
    ['Département', st.department_code ? `${st.department_code} ${st.department_name||''}` : ''],
    ['Région', st.region],
  ].filter(([,v])=>v);
  return `<div class="struct-hero">
    <div class="panel pad">
      ${(st.tags||[]).length ? `<div class="proj-chips">${st.tags.map(tag).join('')}</div>` : ''}
      <div class="facts">${facts.map(([k,v])=>`<span><small>${k}</small>${esc(v)}</span>`).join('')}
        ${st.website?`<span><small>Site</small><a href="${esc(url(st.website))}" target="_blank" rel="noopener">${esc(st.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''))}</a></span>`:''}</div>
      ${st.notes?`<div class="md" style="margin-top:14px">${md(st.notes)}</div>`:''}
      ${!facts.length && !st.notes ? '<p class="muted" style="margin:0">Fiche vide. « Modifier la fiche » pour ajouter l’adresse, la jauge, le site…</p>' : ''}
    </div>
    <div class="panel pad"><h3 class="block-title">Contacts <span class="count">${contacts.length}</span><span class="spacer"></span><button class="btn sm" data-act="newContactFor" data-id="${st.id}">Ajouter un contact</button></h3>
      ${contacts.map(c=>`<div class="contact-row"><a href="#" data-act="editContact" data-id="${c.id}"><b>${esc(c.display_name)}</b></a>
        <span class="muted">${esc((c.roles||[]).join(', '))}</span>
        <span class="links">${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''}${c.phone?`<a href="tel:${esc(c.phone.replace(/\s/g,''))}">${esc(c.phone)}</a>`:''}</span></div>`).join('') || '<div class="muted">Aucun contact lié.</div>'}
    </div></div>`;
}

function eventsTab(st, events){
  return `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="newEvent" data-id="${st.id}">Ajouter un festival / événement</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Festival / événement</th><th>Début</th><th>Fin</th><th>Période habituelle</th><th>Lieu</th><th>Ville</th><th class="num">Jauge</th><th>Notes</th><th></th></tr></thead><tbody>
  ${events.map(e=>`<tr>
    <td>${cIn('structure_events',e.id,'name',e.name,'text','style="font-weight:700"')}</td>
    <td>${cIn('structure_events',e.id,'date_start',e.date_start,'date')}</td>
    <td>${cIn('structure_events',e.id,'date_end',e.date_end,'date')}</td>
    <td>${cIn('structure_events',e.id,'period',e.period,'text','placeholder="ex. 2e week-end de juillet"')}</td>
    <td>${cIn('structure_events',e.id,'place',e.place)}</td>
    <td>${cIn('structure_events',e.id,'city',e.city)}</td>
    <td class="num">${cIn('structure_events',e.id,'capacity',e.capacity,'number','class="narrow"')}</td>
    <td>${cIn('structure_events',e.id,'notes',e.notes)}</td>
    <td><button class="btn icon sm ghost danger" data-act="delEvent" data-id="${e.id}" aria-label="Supprimer l'événement">✕</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Aucun festival ou événement renseigné pour cette structure.</td></tr>'}
  </tbody></table></div>`;
}

function adminTab(st){
  const a = st.admin || {};
  return `<div class="panel pad">
    <p class="help" style="margin:0 0 14px">Informations utilisées pour les contrats. Enregistrées dès que tu quittes le champ.</p>
    <div class="admin-grid">${ADMIN_FIELDS.map(([k,l,full])=>`<div class="field ${full?'full':''}" style="${full?'grid-column:1/-1':''}"><label for="adm-${k}">${l}</label>
      ${k==='notes' ? `<textarea id="adm-${k}" data-admin="${k}" data-sid="${st.id}">${esc(a[k]||'')}</textarea>` : `<input id="adm-${k}" data-admin="${k}" data-sid="${st.id}" value="${esc(a[k]||'')}">`}</div>`).join('')}</div>
    <div class="vh-actions" style="margin-top:12px"><button class="btn sm" data-act="adminFromStructure" data-id="${st.id}">Reprendre l’adresse de la fiche</button></div>
  </div>`;
}

export function viewStructures(){
  if (S.structurePage) return structurePage(byId('structures', S.structurePage));
  const words = norm(S.search.structures).split(/\s+/).filter(Boolean);
  const tg = S.structTag || '';
  let rows = S.db.structures;
  if (tg) rows = rows.filter(s => (s.tags||[]).includes(tg));
  if (words.length) rows = rows.filter(s => { const hay = norm([s.name,s.address,s.city,s.postal_code,s.department_code,s.department_name,s.region,s.country,...(s.tags||[])].join(' '));
    return words.every(w => hay.includes(w)); });
  const near = S.near;   // {label, lat, lng, km}
  const dist = new Map();
  if (near){
    rows = rows.filter(s => s.lat!=null).map(s => { const d = distKm([near.lat,near.lng],[s.lat,s.lng]); dist.set(s.id, d); return s; })
      .filter(s => dist.get(s.id) <= near.km).sort((a,b)=>dist.get(a.id)-dist.get(b.id));
  } else rows = rows.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const tags = [...new Set(S.db.structures.flatMap(s=>s.tags||[]))].sort((a,b)=>a.localeCompare(b));
  return viewHead('Structures', {sub:`${rows.length} structure${rows.length>1?'s':''}${near?` à moins de ${near.km} km de ${esc(near.label)}`:''}`,
      actions:'<button class="btn primary" data-act="newStructure">Nouvelle structure</button>'}) + `
    <form class="near-form" id="near-form" autocomplete="off">
      <input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Nom, ville, département (69, Rhône…), région, type…" data-search="structures" value="${esc(S.search.structures||'')}">
      <select class="sel" data-struct-tag aria-label="Type"><option value="">Tous les types</option>${tags.map(t=>`<option ${t===tg?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <span class="near-box">
        <input class="inp" type="search" autocomplete="off" data-1p-ignore name="autour" placeholder="Autour de… (ville)" value="${esc(near?.label||'')}" aria-label="Autour de quelle ville">
        <select class="sel" name="km" aria-label="Rayon">${[20,50,100,150,200,300].map(k=>`<option value="${k}" ${(near?.km||50)===k?'selected':''}>${k} km</option>`).join('')}</select>
        <button class="btn">Chercher autour</button>
        ${near?'<button type="button" class="btn ghost" data-act="clearNear">Effacer</button>':''}
      </span>
    </form>
    ${near?'<p class="help" style="margin:-6px 0 12px">Seules les structures dont la ville est connue apparaissent dans la recherche par distance.</p>':''}
    <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Ville</th><th>Département · région</th><th class="num">Jauge</th><th class="num">Contacts</th><th>Suivi</th></tr></thead><tbody>
    ${rows.slice(0,300).map(s=>{ const ps = prospectsOfStructure(s.id); return `<tr class="click" data-act="openStructure" data-id="${s.id}">
      <td class="struct-name"><b>${esc(s.name)}</b>${(s.tags||[]).length?`<div class="proj-chips" style="margin-top:4px">${s.tags.map(tag).join('')}</div>`:''}</td>
      <td>${esc(s.city||'')}${near?` <span class="muted">· ${Math.round(dist.get(s.id))} km</span>`:''}${s.country && s.country!=='France'?`<span class="sub">${esc(s.country)}</span>`:''}</td>
      <td>${esc(s.department_code ? `${s.department_code} ${s.department_name||''}` : '')}<span class="sub">${esc(s.region||'')}</span></td>
      <td class="num">${[s.capacity_1,s.capacity_2].filter(Boolean).join(' / ')}</td>
      <td class="num">${linksOfStructure(s.id).length||''}</td><td>${ps.map(x=>pstBadge(x.status)).join(' ')}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Aucune structure ne correspond. Crée-la avec « Nouvelle structure ».</td></tr>'}
    </tbody></table>${rows.length>300?`<p class="muted" style="padding:10px 12px;margin:0">300 premiers résultats affichés — affine la recherche.</p>`:''}</div>`;
}
