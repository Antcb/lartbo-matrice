// v1.66.6 → v1.66.8 — point n°1 d'Anthony : Prénom, Nom (contacts, équipe d'un artiste, fiche RH) et nom de structure prennent une
// majuscule au début de chaque NOUVEAU mot, PENDANT LA FRAPPE. Un champ concerné porte data-cap ; seules les nouvelles saisies sont touchées.
// Règle (décision d'Anthony du 25/11/2026) : une lettre tapée au début d'un mot qui existe déjà (des lettres la suivent immédiatement)
// est respectée telle quelle, quel que soit le geste — Retour arrière puis « i », lettre surlignée remplacée, curseur placé devant le mot :
// « IBoat » se corrige en « iBoat », à la frappe comme à l'enregistrement. La majuscule automatique ne vaut que pour un mot qu'on commence
// (rien ne suit, ou une espace). Seul le texte tapé ou collé est mis en forme, jamais le reste du champ ; Annuler (Cmd+Z) reste cohérent
// (insertion par execCommand « insertText ») ; composition (touche morte) : appliquée à sa fin.
import { capWords } from '../utils.js';

const CAP = 'input[data-cap], textarea[data-cap]';
const SPACE = /\s/u;
/**
 * Texte inséré entre start et end de value, mis en forme : sa 1re lettre en majuscule seulement si elle commence un NOUVEAU mot (début de
 * champ ou espace avant, ET rien ou une espace après) ; chaque mot qu'il commence lui-même prend sa majuscule (collage de plusieurs mots).
 */
export function capInserted(value, start, text, end = start){
  const startsWord = start === 0 || SPACE.test(value[start - 1]);
  const after = value[end], newWord = after === undefined || SPACE.test(after);
  return startsWord && newWord ? capWords(text) : capWords('x' + text).slice(1);
}

function insert(el, text, start, end){
  el.focus();
  el.setSelectionRange(start, end);
  // execCommand garde l'historique d'annulation (Safari, Chrome) ; sinon remplacement direct, curseur après le texte
  if (!document.execCommand?.('insertText', false, text)){ el.setRangeText(text, start, end, 'end'); el.dispatchEvent(new Event('input', {bubbles: true})); }
}
// champs de noms : pas de correction ni de majuscule automatiques du système (macOS / iOS / navigateur) ; la majuscule à chaque nouveau
// mot reste celle de MATRICE (Modern Web Guidance, formulaires : identifiants hors prose)
document.addEventListener('focusin', e => { const el = e.target;
  if (!el.matches?.(CAP) || el.hasAttribute('autocorrect')) return;
  el.setAttribute('autocorrect', 'off'); el.setAttribute('autocapitalize', 'none'); el.setAttribute('spellcheck', 'false'); });
document.addEventListener('beforeinput', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || e.isComposing || e.inputType !== 'insertText' || !e.data) return;
  const [a, b] = [el.selectionStart, el.selectionEnd], t = capInserted(el.value, a, e.data, b);
  if (t === e.data) return;
  e.preventDefault(); insert(el, t, a, b);
});
document.addEventListener('paste', e => {
  const el = e.target;
  if (!el.matches?.(CAP)) return;
  const text = e.clipboardData?.getData('text/plain'); if (!text) return;
  const [a, b] = [el.selectionStart, el.selectionEnd], t = capInserted(el.value, a, el.tagName === 'INPUT' ? text.replace(/\r?\n/g, ' ') : text, b);
  if (t === text) return;
  e.preventDefault(); insert(el, t, a, b);
});
document.addEventListener('compositionend', e => {
  const el = e.target;
  if (!el.matches?.(CAP) || !e.data) return;
  const end = el.selectionStart, start = end - e.data.length;
  if (start < 0 || el.value.slice(start, end) !== e.data) return;
  const t = capInserted(el.value, start, e.data, end);
  if (t !== e.data){ el.setRangeText(t, start, end, 'end'); el.dispatchEvent(new Event('input', {bubbles: true})); }
});
