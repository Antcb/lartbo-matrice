/**
 * Onglet To Do et tableaux de tâches réutilisés ailleurs.
 */
import { CFG } from '../config.js';
import { TASK_STATUS } from '../constants.js';
import { byId, isDone, projIds, projNames, structName, taskSort, urgency } from '../selectors.js';
import { S } from '../state.js';
import { cIn, cSel, projChips } from '../ui/cells.js';
import { daysUntil, esc, fmtDate } from '../utils.js';

export function taskSection(all){
  const done = all.filter(isDone), open = all.filter(t=>!isDone(t));
  const shown = S.showDoneTasks ? all : open;
  return taskTable(shown, open.length ? null : (done.length ? 'Tout est fait.' : null))
    + (done.length ? `<button class="btn small ghost toggle-more" data-act="toggleDoneTasks">${S.showDoneTasks?'Masquer':'Afficher'} les tâches terminées (${done.length})</button>` : '');
}

export function taskTable(tasks, emptyMsg){
  if (!tasks.length) return `<div class="empty panel">${emptyMsg || 'Rien à faire ici. Ajoute une tâche avec « Nouvelle tâche ».'}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th></th><th>Tâche</th><th>Urgence</th><th>Échéance</th><th>Statut</th><th>Pour</th><th>Projets</th><th>Structure</th><th>Date</th></tr></thead><tbody>
  ${tasks.map(t=>{ const u=urgency(t), sh=byId('shows',t.show_id);
    return `<tr class="${['Done','Cancelled'].includes(t.status)?'task-done':''}">
      <td><input type="checkbox" data-act="toggleTask" data-id="${t.id}" ${t.status==='Done'?'checked':''} aria-label="Marquer comme faite"></td>
      <td class="full-cell" style="white-space:normal;min-width:240px"><div class="task-title">${cIn('tasks',t.id,'title',t.title,'text','class="title-input" aria-label="Nom de la tâche"')}
        <button class="btn small ghost" data-act="editTask" data-id="${t.id}" title="Tous les détails (notes, date, pôle…)">Détails</button></div>${t.tags?.length?t.tags.map(x=>`<span class="tag">${esc(x)}</span>`).join(''):''}</td>
      <td>${u?`<span class="urg ${u.cls}">${esc(u.label)}</span>`:''}</td>
      <td>${cIn('tasks',t.id,'deadline',t.deadline,'date')}</td>
      <td>${cSel('tasks',t.id,'status',t.status,TASK_STATUS,false)}</td>
      <td>${cSel('tasks',t.id,'assigned_to',t.assigned_to,CFG.TEAM.map(e=>[e,e.split('@')[0]]))}</td>
      <td style="white-space:normal;min-width:180px">${projChips('tasks', t)}</td><td>${t.structure_id?`<a href="#" data-act="openStructure" data-id="${t.structure_id}">${esc(structName(t.structure_id))}</a>`:''}</td>
      <td>${sh?esc(fmtDate(sh.date)+' '+sh.venue):''}</td></tr>`;}).join('')}
  </tbody></table></div>`;
}

export function viewTodo(){
  const f = S.todoFilter || 'open';
  let tasks = S.db.tasks.filter(t => !S.project || projIds(t).includes(S.project));
  if (f==='open') tasks = tasks.filter(t=>!['Done','Cancelled'].includes(t.status));
  if (f==='mine') tasks = tasks.filter(t=>!['Done','Cancelled'].includes(t.status) && t.assigned_to===S.user.email);
  if (f==='late') tasks = tasks.filter(t=>{ const d=daysUntil(t.deadline); return d!=null && d<=7 && !['Done','Cancelled'].includes(t.status); });
  const q = (S.search.todo||'').toLowerCase();
  if (q) tasks = tasks.filter(t => (t.title+' '+projNames(t)+' '+structName(t.structure_id)).toLowerCase().includes(q));
  tasks.sort(taskSort);
  const btn = (k,l) => `<button class="btn small ${f===k?'primary':''}" data-act="todoFilter" data-f="${k}">${l}</button>`;
  return `<div class="view-head"><h1>To Do</h1>${btn('open','À faire')}${btn('mine','Les miennes')}${btn('late','Urgentes (≤ 7 j)')}${btn('all','Avec les terminées')}
    <span class="spacer"></span><input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Rechercher une tâche" data-search="todo" value="${esc(S.search.todo||'')}">
    <button class="btn primary" data-act="newTask">Nouvelle tâche</button></div>${taskTable(tasks)}`;
}
