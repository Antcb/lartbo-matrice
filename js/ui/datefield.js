/**
 * Champ date : on tape la date complète (08/10/2026, 8/10/26, 08102026, 8/10…) — tout le texte est
 * sélectionné au clic — ou on choisit dans le calendrier. La valeur ISO est dans l'input caché
 * (.dt-val), qui porte le name / data-t / data-f : les formulaires et l'enregistrement direct le lisent.
 */
import { esc, fmtNum } from '../utils.js';

export function dateInput(value, attrs=''){
  return `<span class="dt"><input type="text" class="dt-txt" value="${esc(fmtNum(value))}" placeholder="jj/mm/aaaa" inputmode="numeric" autocomplete="off" aria-label="Date (jj/mm/aaaa)"><input type="date" class="dt-val" value="${esc(value||'')}" tabindex="-1" aria-hidden="true" ${attrs}><button type="button" class="dt-cal" tabindex="-1" aria-label="Ouvrir le calendrier"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M5 1h1.5v1.5h3V1H11v1.5h2A1.5 1.5 0 0 1 14.5 4v9A1.5 1.5 0 0 1 13 14.5H3A1.5 1.5 0 0 1 1.5 13V4A1.5 1.5 0 0 1 3 2.5h2zm-2 5v7h10V6z"/></svg></button></span>`;
}

/** Interprète la saisie : renvoie 'AAAA-MM-JJ', '' (vide) ou null (illisible) */
export function parseDate(txt){
  const t = txt.trim(); if (!t) return '';
  let d, m, y;
  const digits = t.replace(/\D/g,'');
  const parts = t.split(/[^\d]+/).filter(Boolean);
  if (parts.length >= 2){ [d, m, y] = parts; }
  else if (digits.length === 8){ d = digits.slice(0,2); m = digits.slice(2,4); y = digits.slice(4); }
  else if (digits.length === 6){ d = digits.slice(0,2); m = digits.slice(2,4); y = digits.slice(4); }
  else if (digits.length === 4){ d = digits.slice(0,2); m = digits.slice(2,4); }
  else return null;
  d = Number(d); m = Number(m);
  const now = new Date();
  if (!y){ y = now.getFullYear(); }
  y = Number(y); if (y < 100) y += 2000;
  const dt = new Date(y, m-1, d);
  if (dt.getFullYear()!==y || dt.getMonth()!==m-1 || dt.getDate()!==d) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function commit(txt){
  const box = txt.closest('.dt'), val = box.querySelector('.dt-val');
  const iso = parseDate(txt.value);
  if (iso === null){ txt.classList.add('bad'); txt.title = 'Date illisible : tape par ex. 08/10/2026'; return; }
  const start = iso && startFor(val);
  if (start && iso < start){ txt.classList.add('bad'); txt.title = `La fin ne peut pas être avant le début (${fmtNum(start)})`; return; }
  txt.classList.remove('bad'); txt.title = '';
  txt.value = fmtNum(iso);
  if (iso !== val.value){ val.value = iso; val.dispatchEvent(new Event('change', {bubbles:true})); }
}

document.addEventListener('focusin', e => { const t = e.target; if (!t.classList?.contains('dt-txt') || matchMedia('(pointer:coarse)').matches) return; const v = t.value; setTimeout(() => { if (t.value === v) t.select(); }, 0); });
document.addEventListener('mouseup', e => { if (e.target.classList?.contains('dt-txt') && document.activeElement===e.target && e.target.selectionStart===e.target.selectionEnd) e.target.select(); });
document.addEventListener('focusout', e => { if (e.target.classList?.contains('dt-txt')) commit(e.target); });
document.addEventListener('keydown', e => {
  if (!e.target.classList?.contains('dt-txt')) return;
  if (e.key === 'Enter'){ e.preventDefault(); commit(e.target); e.target.blur(); }
});
// Les / se mettent tout seuls : 22011996 → 22/01/1996 (seulement quand on tape des chiffres à la suite, en fin de champ)
document.addEventListener('input', e => {
  const t = e.target; if (!t.classList?.contains('dt-txt')) return;
  if (!/^insert/.test(e.inputType || '') || t.selectionStart !== t.value.length) return;
  const v = t.value;
  if (!/^\d{0,2}(\/\d{0,2}(\/\d{0,4})?)?$/.test(v) && !/^\d{3,8}$/.test(v)) return;   // « 8/10 » tapé à la main : on ne touche à rien
  const d = v.replace(/\D/g, '').slice(0, 8);
  const out = d.slice(0, 2) + (d.length >= 2 ? '/' + d.slice(2, 4) : '') + (d.length >= 4 ? '/' + d.slice(4) : '');
  if (out !== v) t.value = out;
});

/**
 * Couple début → fin, partout sur le site (formulaires, lignes de tableau, champs préfixés comme « _ev_date_end ») :
 * - le calendrier de la fin s'ouvre sur le mois du début, et rien avant le début n'est proposé ;
 * - une fin tapée avant le début est refusée ;
 * - si on recule… ou avance le début après la fin, la fin suit.
 */
const PAIRS = [['date_end', ['date', 'date_start']], ['to', ['from']], ['end', ['start']], ['date_to', ['date_from']], ['expires', ['issued']]];
const keyOf = el => el.name || el.dataset.f || '';
const scopeOf = el => el.closest('form, tr, .panel, dialog') || document;
const find = (scope, k) => scope.querySelector(`.dt-val[name="${k}"], .dt-val[data-f="${k}"]`);
/** Champ « début » d'un champ « fin » */
function startEl(val){
  const key = keyOf(val);
  for (const [end, starts] of PAIRS){
    if (key !== end && !key.endsWith('_' + end)) continue;
    const pre = key.slice(0, key.length - end.length);
    for (const k of starts){ const el = find(scopeOf(val), pre + k); if (el) return el; }
  }
  return null;
}
/** Champ « fin » d'un champ « début » */
function endEl(val){
  const key = keyOf(val);
  for (const [end, starts] of PAIRS) for (const k of starts){
    if (key !== k && !key.endsWith('_' + k)) continue;
    const el = find(scopeOf(val), key.slice(0, key.length - k.length) + end);
    if (el) return el;
  }
  return null;
}
const startFor = val => startEl(val)?.value || '';
function setVal(val, iso){
  val.value = iso;
  const txt = val.parentElement.querySelector('.dt-txt'); if (txt){ txt.value = fmtNum(iso); txt.classList.remove('bad'); txt.title = ''; }
  val.dispatchEvent(new Event('change', {bubbles: true}));
}
// le début passe après la fin : la fin suit
document.addEventListener('change', e => {
  const val = e.target; if (!val.classList?.contains('dt-val') || !val.value) return;
  const end = endEl(val); if (end?.value && end.value < val.value) setVal(end, val.value);
});

/** Avant d'ouvrir le calendrier : date de fin bornée par le début, et ouverte sur le mois du début */
function prepare(val){
  // date de fin : le calendrier s'ouvre au mois de la date de début (la fin ne peut pas être avant)
  const start = startFor(val);
  if (start) val.min = start; else val.removeAttribute('min');
  // fin encore vide : le calendrier s'ouvre sur le début (et pas sur aujourd'hui) ; rien n'est gardé si on ferme sans choisir
  if (start && !val.value){ val.value = start; val.dataset.tmp = '1'; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('.dt-cal'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const val = b.parentElement.querySelector('.dt-val');
  prepare(val);
  try { val.showPicker(); } catch(_) { val.focus(); }
});
// Téléphone / tablette : le vrai calendrier du téléphone est posé (invisible) sur l'icône, un appui l'ouvre directement
document.addEventListener('pointerdown', e => { if (e.target.classList?.contains('dt-val')) prepare(e.target); });
const dropTmp = () => document.querySelectorAll('.dt-val[data-tmp]').forEach(v => { v.value = ''; delete v.dataset.tmp; });
document.addEventListener('pointerdown', dropTmp, true);
document.addEventListener('keydown', dropTmp, true);
// Choix dans le calendrier → met à jour le texte
document.addEventListener('input', e => {
  if (!e.target.classList?.contains('dt-val')) return;
  delete e.target.dataset.tmp;
  const txt = e.target.parentElement.querySelector('.dt-txt'); txt.value = fmtNum(e.target.value); txt.classList.remove('bad');
});
