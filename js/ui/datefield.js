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
  txt.classList.remove('bad'); txt.title = '';
  txt.value = fmtNum(iso);
  if (iso !== val.value){ val.value = iso; val.dispatchEvent(new Event('change', {bubbles:true})); }
}

document.addEventListener('focusin', e => { const t = e.target; if (!t.classList?.contains('dt-txt')) return; const v = t.value; setTimeout(() => { if (t.value === v) t.select(); }, 0); });
document.addEventListener('mouseup', e => { if (e.target.classList?.contains('dt-txt') && document.activeElement===e.target && e.target.selectionStart===e.target.selectionEnd) e.target.select(); });
document.addEventListener('focusout', e => { if (e.target.classList?.contains('dt-txt')) commit(e.target); });
document.addEventListener('keydown', e => {
  if (!e.target.classList?.contains('dt-txt')) return;
  if (e.key === 'Enter'){ e.preventDefault(); commit(e.target); e.target.blur(); }
});
document.addEventListener('click', e => {
  const b = e.target.closest('.dt-cal'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const val = b.parentElement.querySelector('.dt-val');
  try { val.showPicker(); } catch(_) { val.focus(); }
});
// Choix dans le calendrier → met à jour le texte
document.addEventListener('input', e => {
  if (!e.target.classList?.contains('dt-val')) return;
  const txt = e.target.parentElement.querySelector('.dt-txt'); txt.value = fmtNum(e.target.value); txt.classList.remove('bad');
});
