// v1.66.6 (corrigé en v1.66.7 pour Safari) — point n°1 d'Anthony (24/11/2026) : Prénom, Nom (contacts, équipe d'un artiste, fiche RH) et nom de structure prennent une
// majuscule à chaque mot PENDANT LA FRAPPE. Un champ concerné porte data-cap ; seules les nouvelles saisies sont touchées.
// Seul le texte qu'on vient de taper ou de coller est mis en forme (relecture v1.66.6) : jamais le reste du champ — effacer puis retaper
// une lettre ne change pas les autres (« Jean Van » ne devient jamais « Jean VAn »), et une fiche existante n'est pas réécrite d'un coup.
// La majuscule passe par la saisie du navigateur (execCommand « insertText ») : Annuler (Cmd+Z) reste cohérent ; composition
// (touche morte, saisie asiatique) : appliquée à sa fin.
import { capWords } from '../utils.js';

const CAP = 'input[data-cap], textarea[data-cap]';
/** Texte inséré à la position pos de value, mis en forme : 1re lettre en majuscule si elle commence un mot, et chaque mot qu'il commence */
export const capInserted = (value, pos, text) => (pos === 0 || /\s/u.test(value[pos - 1])) ? capWords(text) : capWords('x' + text).slice(1);

function insert(el, text, start, end){
  el.focus();
  el.setSelectionRange(start, end);
  // execCommand garde l'historique d'annulation (Safari, Chrome) ; sinon remplacement direct, curseur après le texte
  if (!document.execCommand?.('insertText', false, text)){ el.setRangeText(text, start, end, 'end'); el.dispatchEvent(new Event('input', {bubbles: true})); }
}
/** Sélection d'exactement la première lettre d'un mot déjà saisi : la remplacer est une correction volontaire, respectée */
const firstLetterSelected = (el, a, b) => b - a === 1 && (a === 0 || /\s/u.test(el.value[a - 1])) && !/\s/u.test(el.value[a]);
// (v1.66.7, Safari sur Mac, 25/11/2026) la correction est repérée dès l'appui sur la touche (keydown), avant tout autre événement :
// selon le navigateur, la lettre tapée peut arriver comme une composition (Safari : compositionstart APRÈS le remplacement de la
// sélection), ou avec une sélection déjà réduite. Position mémorisée → aucune mise en forme du caractère inséré à cet endroit,
// quel que soit le chemin (beforeinput, compositionend) ; oubliée à la touche suivante.
const deliberate = new WeakMap();
// (25/11, Safari : la lettre passait directement en majuscule) la position que Safari donne pendant la saisie n'est pas fiable : seul
// compte le repère posé par la touche qui produit ce caractère (effacé par toute autre touche)
const isDeliberate = (el, pos, data) => deliberate.has(el) && [...data].length === 1;
// dernière sélection connue, relevée à la fin du geste qui l'a faite (souris, Maj+flèches, événement « select ») : repli si le
// navigateur donne une sélection déjà modifiée à l'appui de la touche suivante
const lastSel = new WeakMap();
const snap = e => { const el = e.target; if (el?.matches?.(CAP)) lastSel.set(el, [el.selectionStart, el.selectionEnd, el.value]); };
['select', 'mouseup', 'keyup'].forEach(t => document.addEventListener(t, snap, true));
const selectedFirst = el => { if (firstLetterSelected(el, el.selectionStart, el.selectionEnd)) return el.selectionStart;
  const l = lastSel.get(el); return l && l[2] === el.value && firstLetterSelected(el, l[0], l[1]) ? l[0] : -1; };
document.addEventListener('keydown', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || e.isComposing || e.metaKey || e.ctrlKey || e.altKey && e.key !== 'Dead') return;
  const at = [...e.key].length === 1 || e.key === 'Dead' ? selectedFirst(el) : (firstLetterSelected(el, el.selectionStart, el.selectionEnd) ? el.selectionStart : -1);
  if (at >= 0){ deliberate.set(el, at);
    if ([...e.key].length === 1) trace = {el, pos: at, key: e.key, seq: [['keydown', e.key === 'Dead' ? 'dead' : '', false, el.selectionStart, el.selectionEnd, at]]}; }
  else deliberate.delete(el);
}, true);
// trace de diagnostic (sans contenu : types d'événements, positions) si la correction n'est pas respectée malgré tout
let trace = null;
const TRACED = ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'keyup'];
TRACED.forEach(t => document.addEventListener(t, e => { if (trace && e.target === trace.el && trace.seq.length < 30)
  trace.seq.push([t, e.inputType || '', !!e.isComposing, e.target.selectionStart, e.target.selectionEnd]); }, true));
document.addEventListener('keyup', e => {
  const tr = trace; if (!tr || e.target !== tr.el) return; trace = null;
  setTimeout(() => { const c = tr.el.value[tr.pos];
    if (tr.key !== tr.key.toUpperCase() && c === tr.key.toUpperCase())
      window.dispatchEvent(new CustomEvent('matrice-diag', {detail: {key: 'majuscule : correction non respectée', data: {seq: tr.seq}}})); }, 0);
}, true);
document.addEventListener('compositionstart', e => { const el = e.target;
  if (el.matches?.(CAP) && firstLetterSelected(el, el.selectionStart, el.selectionEnd)) deliberate.set(el, el.selectionStart); });
// champs de noms : pas de correction ni de majuscule automatiques du système (Safari / macOS / iOS), qui défaisaient la correction
// volontaire ; la majuscule à chaque mot reste celle de MATRICE (Modern Web Guidance, formulaires : identifiants hors prose)
document.addEventListener('focusin', e => { const el = e.target;
  if (!el.matches?.(CAP) || el.hasAttribute('autocorrect')) return;
  el.setAttribute('autocorrect', 'off'); el.setAttribute('autocapitalize', 'none'); el.setAttribute('spellcheck', 'false'); });
document.addEventListener('beforeinput', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || e.isComposing || e.inputType !== 'insertText' || !e.data) return;
  const [a, b] = [el.selectionStart, el.selectionEnd];
  // (décision d'Anthony du 24/11/2026) première lettre d'un mot déjà saisi, sélectionnée puis remplacée par une lettre : correction
  // volontaire, respectée telle quelle (« IBoat » → « iBoat ») — à la frappe comme à l'enregistrement (aucune mise en forme ensuite)
  if ((firstLetterSelected(el, a, b) || isDeliberate(el, a, e.data)) && [...e.data].length === 1){ deliberate.delete(el); return; }
  const t = capInserted(el.value, a, e.data);
  if (t === e.data) return;
  e.preventDefault(); insert(el, t, a, b);
});
document.addEventListener('paste', e => {
  const el = e.target;
  if (!el.matches?.(CAP)) return;
  const text = e.clipboardData?.getData('text/plain'); if (!text) return;
  const [a, b] = [el.selectionStart, el.selectionEnd], t = capInserted(el.value, a, el.tagName === 'INPUT' ? text.replace(/\r?\n/g, ' ') : text);
  if (t === text) return;
  e.preventDefault(); insert(el, t, a, b);
});
document.addEventListener('compositionend', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || !e.data) return;
  const end = el.selectionStart, start = end - e.data.length;
  if (isDeliberate(el, start, e.data)){ deliberate.delete(el); return; }
  deliberate.delete(el);
  if (start < 0 || el.value.slice(start, end) !== e.data) return;
  const t = capInserted(el.value, start, e.data);
  if (t !== e.data){ el.setRangeText(t, start, end, 'end'); el.dispatchEvent(new Event('input', {bubbles: true})); }
});
