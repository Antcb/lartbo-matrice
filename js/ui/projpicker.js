/**
 * Choix d'un artiste : liste des projets actifs, et « Projets inactifs » qui se déplient
 * dans la même liste (sans la fermer). On peut taper les premières lettres pour filtrer
 * (champ de recherche en haut de la liste, ↑ ↓ Entrée), y compris directement sur le bouton.
 * projPicker(value, {attrs, allLabel}) : attrs posés sur l'input caché (id, name, data-…),
 * qui reçoit l'identifiant choisi et déclenche « change ».
 * multi:true (filtres en haut des pages) : on coche un ou plusieurs artistes, la liste reste ouverte entre deux choix ;
 * l'input caché reçoit les identifiants séparés par des virgules.
 */
import { byUsage } from '../selectors.js';
import { S } from '../state.js';
import { esc, hayOf, norm } from '../utils.js';

const label = (id, allLabel) => { const p = S.db.projects.find(x => x.id === id); return p ? p.name + (p.active ? '' : ' (inactif)') : (allLabel || 'Choisir un artiste'); };

const multiLabel = (ids, allLabel) => {
  if (!ids.length) return allLabel || 'Tous les artistes';
  if (ids.length === 1) return label(ids[0], allLabel);
  const names = ids.map(id => S.db.projects.find(x => x.id === id)?.name).filter(Boolean);
  return names.length <= 2 ? names.join(' + ') : `${names.length} artistes`;
};
const idsOf = v => String(v || '').split(',').filter(Boolean);

export function projPicker(value, {attrs='', allLabel='Tous les artistes', cls='sel', multi=false}={}){
  const val = multi ? (Array.isArray(value) ? value : idsOf(value)).join(',') : (value || '');
  const text = multi ? multiLabel(idsOf(val), allLabel) : label(value, allLabel);
  return `<span class="pp"><button type="button" class="${cls} pp-btn ${multi && idsOf(val).length ? 'pp-on' : ''}" aria-haspopup="listbox" aria-expanded="false" data-all="${esc(allLabel??'')}" ${multi ? 'data-multi="1"' : ''}>${esc(text)} <span aria-hidden="true">▾</span></button><input type="hidden" class="pp-val" value="${esc(val)}" ${attrs}></span>`;
}

let OPEN = null;
function close(){ if (OPEN){ OPEN.list.remove(); OPEN.btn.setAttribute('aria-expanded','false'); OPEN = null; } }

function draw(){
  const {list, val, allLabel, showInactive, q} = OPEN;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const ok = p => !words.length || words.every(w => hayOf(p.name).includes(w));
  // ceux qui commencent par ce qu'on tape d'abord
  const sort = (a, b) => (words.length ? (norm(a.name).startsWith(words[0]) ? 0 : 1) - (norm(b.name).startsWith(words[0]) ? 0 : 1) : 0) || byUsage(a, b);
  const act = S.db.projects.filter(p => p.active && ok(p)).sort(sort);
  const ina = S.db.projects.filter(p => !p.active && ok(p)).sort(sort);
  const multi = OPEN.multi, sel = idsOf(val.value);
  const on = id => multi ? (id ? sel.includes(id) : !sel.length) : id === val.value;
  const item = (id, name, extra='') => `<div class="ac-item ${on(id)?'on':''} ${extra}" data-pp="${id}" role="option" aria-selected="${on(id)}">${multi ? `<span class="pp-box" aria-hidden="true">${on(id) ? '✓' : ''}</span>` : ''}${esc(name)}</div>`;
  const showIna = showInactive || (words.length && !act.length);
  list.querySelector('.pp-items').innerHTML = (allLabel && !words.length ? item('', allLabel) : '')
    + act.map(p => item(p.id, p.name)).join('')
    + (ina.length ? `<div class="ac-item pp-toggle" data-pp-toggle="1">${showIna?'▾':'▸'} Projets inactifs <span class="count">${ina.length}</span></div>` : '')
    + (showIna ? ina.map(p => item(p.id, p.name, 'pp-inactive')).join('') : '')
    + (!act.length && !ina.length ? '<div class="ac-item muted" aria-disabled="true">Aucun artiste ne correspond</div>' : '');
  OPEN.idx = -1;
}

/** Plusieurs artistes : on coche / décoche sans fermer la liste ; la page se met à jour derrière */
let QUIET = 0;
function toggle(id){
  const {val, allLabel} = OPEN;
  let ids = idsOf(val.value);
  ids = !id ? [] : ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  val.value = ids.join(',');
  OPEN.btn.firstChild.textContent = multiLabel(ids, allLabel) + ' ';
  const key = OPEN.key; QUIET = Date.now();
  val.dispatchEvent(new Event('change', {bubbles:true}));
  // la page a pu être redessinée : la liste ouverte se rattache au nouveau bouton
  setTimeout(() => {
    if (!OPEN) return;
    const nv = key && document.querySelector(key);
    if (nv && nv !== OPEN.val){ OPEN.val = nv; OPEN.btn = nv.closest('.pp').querySelector('.pp-btn'); OPEN.btn.setAttribute('aria-expanded','true'); place(); }
    draw(); OPEN.list.querySelector('.pp-q')?.focus({preventScroll:true});
  }, 0);
}
function place(){
  const r = OPEN.btn.getBoundingClientRect();
  OPEN.list.style.left = r.left + 'px'; OPEN.list.style.top = (r.bottom + 4) + 'px'; OPEN.list.style.minWidth = Math.max(r.width, 240) + 'px';
}

function choose(id){
  if (OPEN.multi) return toggle(id);
  const {btn, val, allLabel} = OPEN; close();
  btn.firstChild.textContent = label(id, allLabel) + ' ';
  if (val.value !== id){ val.value = id; val.dispatchEvent(new Event('change', {bubbles:true})); }
  btn.focus();
}

function open(btn, q=''){
  close();
  const box = btn.closest('.pp'), val = box.querySelector('.pp-val');
  const list = document.createElement('div'); list.className = 'ac-list pp-list'; list.setAttribute('role','listbox');
  list.innerHTML = `<input type="text" class="pp-q" placeholder="Taper le nom de l’artiste…" autocomplete="off" spellcheck="false" data-1p-ignore aria-label="Chercher un artiste"><div class="pp-items"></div>`;
  (btn.closest('dialog') || document.body).appendChild(list);
  const cur = S.db.projects.find(p => p.id === val.value);
  const multi = !!btn.dataset.multi;
  const key = val.id ? '#' + CSS.escape(val.id) : [...val.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('') || null;
  OPEN = {btn, val, list, multi, key, allLabel: btn.dataset.all || '', q, idx: -1,
    showInactive: multi ? idsOf(val.value).some(id => S.db.projects.find(p => p.id === id && !p.active)) : !!(cur && !cur.active)};
  place();
  btn.setAttribute('aria-expanded','true');
  const inp = list.querySelector('.pp-q'); inp.value = q;
  draw(); if (!matchMedia('(pointer:coarse)').matches) inp.focus();   // téléphone : pas de clavier d'office
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.pp-btn');
  if (btn){
    e.preventDefault();
    if (OPEN && OPEN.btn === btn) return close();
    open(btn); return;
  }
  if (!OPEN) return;
  const tg = e.target.closest('[data-pp-toggle]');
  if (tg){ e.preventDefault(); e.stopPropagation(); OPEN.showInactive = !OPEN.showInactive; draw(); return; }
  const it = e.target.closest('[data-pp]');
  if (it){ e.preventDefault(); e.stopPropagation(); choose(it.dataset.pp); return; }
  if (!e.target.closest('.pp-list')) close();
}, true);
document.addEventListener('input', e => { if (OPEN && e.target.classList?.contains('pp-q')){ OPEN.q = e.target.value; draw(); } });
document.addEventListener('keydown', e => {
  // une lettre tapée sur le bouton ouvre la liste déjà filtrée
  if (!OPEN && e.target.classList?.contains('pp-btn') && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey){ e.preventDefault(); open(e.target, e.key); return; }
  if (!OPEN) return;
  if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); const b = OPEN.btn; close(); b.focus(); return; }
  if (!e.target.classList?.contains('pp-q')) return;
  const items = [...OPEN.list.querySelectorAll('[data-pp]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    OPEN.idx = Math.max(0, Math.min(items.length - 1, OPEN.idx + (e.key === 'ArrowDown' ? 1 : -1)));
    items.forEach((x, i) => x.classList.toggle('active', i === OPEN.idx)); items[OPEN.idx]?.scrollIntoView({block:'nearest'});
  } else if (e.key === 'Enter'){
    e.preventDefault(); e.stopPropagation();
    const it = items[OPEN.idx >= 0 ? OPEN.idx : 0]; if (it) choose(it.dataset.pp);
  } else if (e.key === 'Tab') close();
}, true);
window.addEventListener('scroll', e => { if (OPEN && !matchMedia('(pointer:coarse)').matches && Date.now() - QUIET > 500 && !OPEN.list.contains(e.target) && e.target !== OPEN.list) close(); }, true);
