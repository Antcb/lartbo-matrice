/**
 * Choix d'un artiste : liste des projets actifs, et « Projets inactifs » qui se déplient
 * dans la même liste (sans la fermer).
 * projPicker(value, {attrs, allLabel}) : attrs posés sur l'input caché (id, name, data-…),
 * qui reçoit l'identifiant choisi et déclenche « change ».
 */
import { S } from '../state.js';
import { esc } from '../utils.js';

const label = (id, allLabel) => { const p = S.db.projects.find(x => x.id === id); return p ? p.name + (p.active ? '' : ' (inactif)') : (allLabel || 'Choisir un artiste'); };

export function projPicker(value, {attrs='', allLabel='Tous les artistes', cls='sel'}={}){
  return `<span class="pp"><button type="button" class="${cls} pp-btn" aria-haspopup="listbox" aria-expanded="false" data-all="${esc(allLabel??'')}">${esc(label(value, allLabel))} <span aria-hidden="true">▾</span></button><input type="hidden" class="pp-val" value="${esc(value||'')}" ${attrs}></span>`;
}

let OPEN = null;
function close(){ if (OPEN){ OPEN.list.remove(); OPEN.btn.setAttribute('aria-expanded','false'); OPEN = null; } }

function draw(){
  const {list, val, allLabel, showInactive} = OPEN;
  const act = S.db.projects.filter(p => p.active).sort((a,b)=>a.name.localeCompare(b.name));
  const ina = S.db.projects.filter(p => !p.active).sort((a,b)=>a.name.localeCompare(b.name));
  const item = (id, name, extra='') => `<div class="ac-item ${id===val.value?'on':''} ${extra}" data-pp="${id}" role="option">${esc(name)}</div>`;
  list.innerHTML = (allLabel ? item('', allLabel) : '')
    + act.map(p => item(p.id, p.name)).join('')
    + (ina.length ? `<div class="ac-item pp-toggle" data-pp-toggle="1">${showInactive?'▾':'▸'} Projets inactifs <span class="count">${ina.length}</span></div>` : '')
    + (showInactive ? ina.map(p => item(p.id, p.name, 'pp-inactive')).join('') : '');
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.pp-btn');
  if (btn){
    e.preventDefault();
    if (OPEN && OPEN.btn === btn) return close();
    close();
    const box = btn.closest('.pp'), val = box.querySelector('.pp-val');
    const list = document.createElement('div'); list.className = 'ac-list pp-list'; list.setAttribute('role','listbox');
    (btn.closest('dialog') || document.body).appendChild(list);
    const cur = S.db.projects.find(p => p.id === val.value);
    OPEN = {btn, val, list, allLabel: btn.dataset.all || '', showInactive: !!(cur && !cur.active)};
    const r = btn.getBoundingClientRect();
    list.style.left = r.left + 'px'; list.style.top = (r.bottom + 4) + 'px'; list.style.minWidth = Math.max(r.width, 240) + 'px';
    btn.setAttribute('aria-expanded','true');
    draw(); return;
  }
  if (!OPEN) return;
  const tg = e.target.closest('[data-pp-toggle]');
  if (tg){ e.preventDefault(); e.stopPropagation(); OPEN.showInactive = !OPEN.showInactive; draw(); return; }
  const it = e.target.closest('[data-pp]');
  if (it){
    e.preventDefault(); e.stopPropagation();
    const {btn, val, allLabel} = OPEN; close();
    btn.firstChild.textContent = label(it.dataset.pp, allLabel) + ' ';
    if (val.value !== it.dataset.pp){ val.value = it.dataset.pp; val.dispatchEvent(new Event('change', {bubbles:true})); }
    return;
  }
  if (!e.target.closest('.pp-list')) close();
}, true);
document.addEventListener('keydown', e => { if (OPEN && e.key === 'Escape') close(); });
window.addEventListener('scroll', e => { if (OPEN && !OPEN.list.contains(e.target)) close(); }, true);
