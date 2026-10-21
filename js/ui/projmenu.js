/**
 * Choix des artistes d'un suivi / d'une tâche : une liste à cases qui reste ouverte,
 * on coche ou décoche plusieurs artistes d'affilée (filtre en tapant), et tout s'enregistre au fur et à mesure.
 */
import { render } from '../app.js';
import { save } from '../data.js';
import { byId, byUsage, projIds } from '../selectors.js';
import { S } from '../state.js';
import { esc, hayOf, norm } from '../utils.js';

let OPEN = null;
// téléphone / tablette : la liste s'ouvre en bas de l'écran, sans clavier (sinon le clavier fait défiler la page et la liste se refermait)
const touch = () => matchMedia('(pointer:coarse)').matches;

function close(){
  if (!OPEN) return;
  const changed = OPEN.changed; OPEN.list.remove(); OPEN = null;
  if (changed) render();
}

function draw(){
  const {list, table, id, q} = OPEN;
  const ids = projIds(byId(table, id));
  const words = norm(q).split(/\s+/).filter(Boolean);
  const ok = p => !words.length || words.every(w => hayOf(p.name).includes(w));
  const rows = S.db.projects.filter(p => (p.active || ids.includes(p.id)) && ok(p)).sort(byUsage);
  list.querySelector('.pm-items').innerHTML = rows.map(p => `<label class="ac-item pm-item"><input type="checkbox" data-pm="${p.id}" ${ids.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')
    || '<div class="ac-empty">Aucun artiste</div>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-projmenu]');
  if (b){
    e.preventDefault(); e.stopPropagation();
    if (OPEN && OPEN.btn === b) return close();
    close();
    const list = document.createElement('div'); list.className = 'ac-list pp-list pm-list';
    list.innerHTML = `<input type="text" class="pp-q" placeholder="Filtrer les artistes…" autocomplete="off" spellcheck="false" data-1p-ignore aria-label="Filtrer les artistes"><div class="pm-items"></div>
      <div class="pm-foot"><button type="button" class="btn sm primary" data-pm-done="1">OK</button></div>`;
    (b.closest('dialog') || document.body).appendChild(list);
    OPEN = {btn: b, list, table: b.dataset.t, id: b.dataset.id, q: '', changed: false};
    if (touch()) list.classList.add('pm-sheet');
    else { const r = b.getBoundingClientRect();
      list.style.left = Math.min(r.left, innerWidth - 280) + 'px'; list.style.top = (r.bottom + 4) + 'px'; list.style.minWidth = '260px'; }
    draw(); if (!touch()) list.querySelector('.pp-q').focus();
    return;
  }
  if (!OPEN) return;
  if (e.target.closest('[data-pm-done]')){ e.preventDefault(); close(); return; }
  if (!e.target.closest('.pm-list')) close();
}, true);

document.addEventListener('change', async e => {
  const c = e.target.closest?.('[data-pm]'); if (!c || !OPEN) return;
  e.stopPropagation();
  const {table, id} = OPEN, row = byId(table, id);
  const ids = projIds(row).filter(x => x !== c.dataset.pm).concat(c.checked ? [c.dataset.pm] : []);
  OPEN.changed = true;
  await save(table, id, {project_ids: ids, project_id: ids[0] || null}, {rerender: false});
}, true);

document.addEventListener('input', e => { if (OPEN && e.target.classList?.contains('pp-q') && OPEN.list.contains(e.target)){ OPEN.q = e.target.value; draw(); } });
document.addEventListener('keydown', e => { if (OPEN && (e.key === 'Escape' || (e.key === 'Enter' && e.target.classList?.contains('pp-q')))){ e.preventDefault(); e.stopPropagation(); close(); } }, true);
window.addEventListener('scroll', e => { if (OPEN && !touch() && !OPEN.list.contains(e.target)) close(); }, true);
