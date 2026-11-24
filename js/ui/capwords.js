// v1.66.6 — point n°1 d'Anthony (24/11/2026) : Prénom, Nom (contacts, équipe d'un artiste, fiche RH) et nom de structure prennent une
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
document.addEventListener('beforeinput', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || e.isComposing || e.inputType !== 'insertText' || !e.data) return;
  const [a, b] = [el.selectionStart, el.selectionEnd];
  // (décision d'Anthony du 24/11/2026) première lettre d'un mot déjà saisi, sélectionnée puis remplacée par une lettre : correction
  // volontaire, respectée telle quelle (« IBoat » → « iBoat ») — à la frappe comme à l'enregistrement (aucune mise en forme ensuite)
  if (b - a === 1 && [...e.data].length === 1 && (a === 0 || /\s/u.test(el.value[a - 1])) && !/\s/u.test(el.value[a])) return;
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
  if (start < 0 || el.value.slice(start, end) !== e.data) return;
  const t = capInserted(el.value, start, e.data);
  if (t !== e.data){ el.setRangeText(t, start, end, 'end'); el.dispatchEvent(new Event('input', {bubbles: true})); }
});
