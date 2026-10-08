/**
 * Onglet Projets : cartes et page de chaque projet.
 */
import { stClass } from '../constants.js';
import { byId, projIds, taskSort } from '../selectors.js';
import { S } from '../state.js';
import { esc, eur, fmtDate } from '../utils.js';
import { taskSection } from './todo.js';

export function viewProjects(){
  if (S.projectPage) return projectPage(byId('projects', S.projectPage));
  const card = p => {
    const shows = S.db.shows.filter(s=>s.project_id===p.id);
    const yr = shows.filter(s=>s.date && Number(s.date.slice(0,4))===S.year);
    const tasks = S.db.tasks.filter(t=>projIds(t).includes(p.id) && !['Done','Cancelled'].includes(t.status));
    return `<div class="panel pcard" data-act="openProject" data-id="${p.id}">
      <h3>${esc(p.name)}</h3><span class="muted">${p.active?'Actif':'Inactif'}</span>
      <div class="stats"><span><b>${yr.filter(s=>stClass(s.status)==='conf').length}</b>confirmées ${S.year}</span><span><b>${yr.filter(s=>['int','opt'].includes(stClass(s.status))).length}</b>en cours</span><span><b>${tasks.length}</b>tâches</span></div></div>`;
  };
  const act = S.db.projects.filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name));
  const ina = S.db.projects.filter(p=>!p.active).sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="view-head"><h1>Projets</h1><span class="spacer"></span><button class="btn primary" data-act="newProject">Nouveau projet</button></div>
    <div class="grid-cards">${act.map(card).join('') || '<div class="empty">Aucun projet actif.</div>'}</div>
    ${ina.length?`<div class="section-title">Inactifs</div><div class="grid-cards">${ina.map(card).join('')}</div>`:''}`;
}

export function projectPage(p){
  if (!p) { S.projectPage=null; return viewProjects(); }
  const shows = S.db.shows.filter(s=>s.project_id===p.id).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const tasks = S.db.tasks.filter(t=>projIds(t).includes(p.id)).sort(taskSort);
  const byYear = {};
  shows.forEach(s=>{ const y=s.date?s.date.slice(0,4):'Sans date'; (byYear[y]=byYear[y]||[]).push(s); });
  return `<div class="view-head"><button class="btn ghost" data-act="closeProject">← Projets</button><h1>${esc(p.name)}</h1>
    <span class="muted">${p.active?'Actif':'Inactif'}</span><span class="spacer"></span>
    ${p.drive_artist_folder_id?`<a class="btn" href="https://drive.google.com/drive/folders/${esc(p.drive_artist_folder_id)}" target="_blank" rel="noopener">Dossier Drive</a>`:''}
    <button class="btn" data-act="editProject" data-id="${p.id}">Modifier</button>
    <button class="btn primary" data-act="newShow" data-project="${p.id}">Nouvelle date</button></div>
    ${p.notes?`<div class="panel" style="padding:12px;margin-bottom:12px;white-space:pre-wrap">${esc(p.notes)}</div>`:''}
    <div class="tbl-wrap"><table><thead><tr><th>Année</th><th class="num">Dates</th><th class="num">Confirmées</th><th class="num">Options</th><th class="num">Intérêts</th><th class="num">Cachets confirmés</th></tr></thead><tbody>
    ${Object.entries(byYear).map(([y,l])=>`<tr><td><b>${y}</b></td><td class="num">${l.length}</td><td class="num">${l.filter(s=>stClass(s.status)==='conf').length}</td><td class="num">${l.filter(s=>stClass(s.status)==='opt').length}</td><td class="num">${l.filter(s=>stClass(s.status)==='int').length}</td><td class="num">${eur(l.filter(s=>stClass(s.status)==='conf').reduce((a,s)=>a+(Number(s.fee_ht)||0),0))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucune date.</td></tr>'}
    </tbody></table></div>
    <div class="section-title">Tâches</div>${taskSection(tasks)}
    <div class="section-title">Dates</div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Ville</th><th>Statut</th><th class="num">Cachet</th></tr></thead><tbody>
      ${shows.map(s=>`<tr class="click" data-act="editShow" data-id="${s.id}"><td>${fmtDate(s.date)}</td><td>${esc(s.venue)}</td><td>${esc(s.city||'')}</td><td><span class="st ${stClass(s.status)}">${esc(s.status)}</span></td><td class="num">${eur(s.fee_ht)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
