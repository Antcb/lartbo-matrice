/**
 * Onglet To Do et tableaux de tâches réutilisés ailleurs (structure, projet).
 * Une tâche cochée reste visible 5 s (bouton Annuler) avant de disparaître.
 */
import { CFG } from '../config.js';
import { TASK_STATUS, TEAM_NAMES } from '../constants.js';
import { lingering } from '../data.js';
import { deptColor, deptNames, attachmentsOf, isDone, projIds, projNames, showLabel, byId, structName, taskSort, teamName, urgency } from '../selectors.js';
import { S } from '../state.js';
import { deptBadge, projPicker, viewHead } from '../ui/bits.js';
import { cAc, cIn, cSel, projChips } from '../ui/cells.js';
import { daysUntil, esc, fmtDate, matches } from '../utils.js';

export function taskSection(all){
  const done = all.filter(t => isDone(t) && !lingering(t.id)), open = all.filter(t => !isDone(t) || lingering(t.id));
  const shown = (S.showDoneTasks ? all : open).slice().sort(taskSort);
  return taskTable(shown, open.length ? null : (done.length ? 'Tout est fait.' : null))
    + (done.length ? `<button class="btn toggle-more" data-act="toggleDoneTasks" aria-pressed="${!!S.showDoneTasks}">${S.showDoneTasks?'Masquer':'Afficher'} les tâches terminées (${done.length})</button>` : '');
}

export function taskTable(tasks, emptyMsg){
  if (!tasks.length) return `<div class="empty panel">${emptyMsg || 'Rien à faire ici. Ajoute une tâche avec « Nouvelle tâche ».'}</div>`;
  const team = CFG.TEAM.map(e=>[e, TEAM_NAMES[e]||e]);
  return `<div class="tbl-wrap"><table><thead><tr><th></th><th>Tâche</th><th>Pôle</th><th>Urgence</th><th>Échéance</th><th>Pour</th><th>Projets</th><th>Structure</th><th>Date concernée</th></tr></thead><tbody>
  ${tasks.map(t=>{ const u=urgency(t), nf = attachmentsOf('task_id', t.id).length; const leaving = lingering(t.id) && isDone(t);
    return `<tr class="${isDone(t) && !leaving ? 'task-done' : ''} ${leaving?'leaving':''}">
      <td><input type="checkbox" data-act="toggleTask" data-id="${t.id}" ${t.status==='Done'?'checked':''} aria-label="Marquer comme faite"></td>
      <td class="full-cell" style="min-width:260px"><div class="task-title">${cIn('tasks',t.id,'title',t.title,'text','aria-label="Nom de la tâche"')}
        <button class="btn sm ghost" data-act="editTask" data-id="${t.id}" title="Notes, pièces jointes, statut…">Détails${nf?` · ${nf} 📎`:''}</button></div>
        ${t.notes?`<div class="muted" style="font-size:13px;padding:0 6px;white-space:pre-line">${esc(t.notes.length>160?t.notes.slice(0,160)+'…':t.notes)}</div>`:''}</td>
      <td><select class="dept-sel" data-t="tasks" data-id="${t.id}" data-f="department" style="--c:${deptColor(t.department)}" aria-label="Pôle"><option value="">Pôle ?</option>${deptNames().concat(t.department && !deptNames().includes(t.department) ? [t.department] : []).map(d=>`<option ${d===t.department?'selected':''}>${esc(d)}</option>`).join('')}</select></td>
      <td>${t.status==='Done' && t.done_at ? `<span class="muted nowrap">Faite le ${fmtDate(t.done_at.slice(0,10))}</span>` : u?`<span class="urg ${u.cls}">${esc(u.label)}</span>`:''}</td>
      <td>${cIn('tasks',t.id,'deadline',t.deadline,'date')}</td>
      <td>${cSel('tasks',t.id,'assigned_to',t.assigned_to,team)}</td>
      <td style="min-width:180px">${projChips('tasks', t)}</td>
      <td style="min-width:200px">${cAc('structures','tasks',t.id,'structure_id',t.structure_id,{placeholder:'Chercher une structure…', create:true})}</td>
      <td style="min-width:270px">${cAc('shows','tasks',t.id,'show_id',t.show_id,{placeholder:'Chercher une date…'})}</td></tr>`;}).join('')}
  </tbody></table></div>`;
}

export function viewTodo(){
  const f = S.todoFilter || 'open';
  const dept = S.todoDept || '';
  let tasks = S.db.tasks.filter(t => !S.project || projIds(t).includes(S.project));
  const open = t => !isDone(t) || lingering(t.id);
  if (f==='open') tasks = tasks.filter(open);
  if (f==='mine') tasks = tasks.filter(t=>open(t) && t.assigned_to===S.user.email);
  if (f==='late') tasks = tasks.filter(t=>{ const d=daysUntil(t.deadline); return d!=null && d<=7 && open(t); });
  if (f==='done'){ const since = new Date(Date.now() - 30*864e5).toISOString(); tasks = tasks.filter(t => t.status==='Done' && (t.done_at||t.updated_at||'') >= since); }
  const byDept = d => tasks.filter(t => (t.department||'') === d).length;
  const total = tasks.length;
  if (dept) tasks = tasks.filter(t => (t.department||'') === (dept==='-' ? '' : dept));
  const q = S.search.todo || '';
  if (q) tasks = tasks.filter(t => matches(`${t.title} ${t.notes||''} ${projNames(t)} ${structName(t.structure_id)} ${t.department||''} ${showLabel(byId('shows', t.show_id))}`, q));
  if (f==='done') tasks.sort((a,b)=>(b.done_at||b.updated_at||'').localeCompare(a.done_at||a.updated_at||'')); else tasks.sort(taskSort);
  const btn = (k,l) => `<button class="btn ${f===k?'on':''}" data-act="todoFilter" data-f="${k}" aria-pressed="${f===k}">${l}</button>`;
  const dbtn = (k,l,n) => `<button class="btn ${dept===k?'on':''}" data-act="todoDept" data-f="${k}" aria-pressed="${dept===k}">${l} <span class="count">${n}</span></button>`;
  return viewHead('To Do', {sub:`${tasks.length} tâche${tasks.length>1?'s':''}`,
      filters:`<div class="seg">${btn('open','À faire')}${btn('mine','Les miennes')}${btn('late','Urgentes (≤ 7 j)')}${btn('done','Terminées (30 derniers jours)')}</div>
        ${projPicker(S.project, {attrs:'id="f-project" aria-label="Artiste"'})}
        <input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-taches" placeholder="Rechercher une tâche" data-search="todo" value="${esc(q)}">`,
      actions:'<button class="btn primary" data-act="newTask">Nouvelle tâche</button>'})
    + `<div class="dept-filter" role="group" aria-label="Pôle">${dbtn('', 'Tous les pôles', total)}${deptNames().map(d=>dbtn(d, d, byDept(d))).join('')}${dbtn('-', 'Sans pôle', byDept(''))}</div>`
    + taskTable(tasks);
}

export { teamName, TASK_STATUS };
