/**
 * Champ « tags » : pastilles + liste de suggestions (tags prédéfinis et tags déjà utilisés).
 * On clique une suggestion pour l'ajouter, ou on tape un nouveau tag et « + Créer » l'ajoute en un clic.
 * La valeur est gardée dans un champ caché (« a, b, c »), lu comme avant par les formulaires.
 */
import { esc } from '../utils.js';

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function tagPicker({id, name, values = [], suggestions = [], placeholder = 'Ajouter…'}){
  const sugg = [...new Set(suggestions.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return `<div class="tagpick" data-tagpick data-sugg="${esc(JSON.stringify(sugg))}">
    <input type="hidden" class="tp-val" id="${id}" name="${esc(name)}" value="${esc(values.join(', '))}">
    <span class="tp-chips">${values.map(chip).join('')}</span>
    <input type="text" class="tp-q" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Ajouter un tag">
    <div class="tp-sugg" hidden></div>
  </div>`;
}
const chip = v => `<span class="tp-chip" data-v="${esc(v)}">${esc(v)}<button type="button" class="tp-rm" aria-label="Retirer ${esc(v)}">×</button></span>`;

const box = el => el.closest('[data-tagpick]');
const valuesOf = b => [...b.querySelectorAll('.tp-chip')].map(c => c.dataset.v);
function sync(b){ const f = b.closest('form'); if (f) f._draftGen = (f._draftGen || 0) + 1;   // action de l'utilisateur : le brouillon ne repasse plus dessus
  const h = b.querySelector('input[type=hidden]'); h.value = valuesOf(b).join(', '); h.dispatchEvent(new Event('input', {bubbles: true})); }
function add(b, v){
  v = String(v || '').trim(); if (!v) return;
  if (valuesOf(b).some(x => norm(x) === norm(v))) return;
  b.querySelector('.tp-chips').insertAdjacentHTML('beforeend', chip(v)); sync(b);
}
function show(b){
  const q = b.querySelector('.tp-q').value.trim(), have = valuesOf(b).map(norm);
  const all = JSON.parse(b.dataset.sugg || '[]').filter(s => !have.includes(norm(s)));
  const list = q ? all.filter(s => norm(s).includes(norm(q))) : all;
  const exact = all.concat(valuesOf(b)).some(s => norm(s) === norm(q));
  const s = b.querySelector('.tp-sugg');
  s.innerHTML = list.slice(0, 30).map(v => `<button type="button" class="tp-opt" data-v="${esc(v)}">${esc(v)}</button>`).join('')
    + (q && !exact ? `<button type="button" class="tp-opt tp-new" data-v="${esc(q)}">+ Créer « ${esc(q)} »</button>` : '');
  s.hidden = !s.innerHTML;
}

/** Avant d'enregistrer : le tag tapé mais pas encore validé est ajouté */
export function commitTags(root){
  root.querySelectorAll('[data-tagpick] .tp-q').forEach(q => { if (q.value.trim()){ add(box(q), q.value); q.value = ''; } });
}
/** Brouillon restauré : les pastilles suivent la valeur du champ caché */
document.addEventListener('tp-set', e => {
  const b = box(e.target); if (!b) return;
  const vals = String(e.target.value || '').split(',').map(x => x.trim()).filter(Boolean);
  b.querySelector('.tp-chips').innerHTML = vals.map(chip).join('');
});

document.addEventListener('focusin', e => { if (e.target.classList?.contains('tp-q')) show(box(e.target)); });
document.addEventListener('input', e => { if (e.target.classList?.contains('tp-q')) show(box(e.target)); });
document.addEventListener('mousedown', e => {
  const opt = e.target.closest('.tp-opt'); if (!opt) return;
  e.preventDefault();   // garde le focus dans la saisie
  const b = box(opt); add(b, opt.dataset.v); const q = b.querySelector('.tp-q'); q.value = ''; show(b);
});
document.addEventListener('click', e => {
  const rm = e.target.closest('.tp-rm'); if (!rm) return;
  const b = box(rm); rm.closest('.tp-chip').remove(); sync(b);
});
document.addEventListener('keydown', e => {
  const q = e.target; if (!q.classList?.contains('tp-q')) return;
  const b = box(q);
  if (e.key === 'Enter' || e.key === ','){ e.preventDefault(); if (q.value.trim()){ const first = b.querySelector('.tp-opt'); add(b, first && norm(first.dataset.v).includes(norm(q.value)) ? first.dataset.v : q.value); q.value = ''; show(b); } }
  else if (e.key === 'Backspace' && !q.value){ const last = [...b.querySelectorAll('.tp-chip')].pop(); if (last){ last.remove(); sync(b); show(b); } }
  else if (e.key === 'Escape'){ b.querySelector('.tp-sugg').hidden = true; }
});
document.addEventListener('focusout', e => {
  if (!e.target.classList?.contains('tp-q')) return;
  const b = box(e.target), q = e.target;
  setTimeout(() => { if (!b.contains(document.activeElement)){ if (q.value.trim()){ add(b, q.value); q.value = ''; } b.querySelector('.tp-sugg').hidden = true; } }, 120);
});
