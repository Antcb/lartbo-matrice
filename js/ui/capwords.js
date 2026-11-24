// v1.66.6 — point n°1 d'Anthony (24/11/2026) : Prénom, Nom (contacts, équipe d'un artiste, fiche RH) et nom de structure prennent une
// majuscule à chaque mot PENDANT LA FRAPPE. Un champ concerné porte data-cap ; seules les nouvelles saisies sont touchées (une fiche
// existante n'est modifiée que si on retape dans le champ), rien n'est corrigé en masse. Le curseur reste à sa place ; pas pendant une
// composition (accents par touche morte, saisie asiatique), appliqué à sa fin.
import { capWords } from '../utils.js';

function apply(el){
  const v = el.value, u = capWords(v);
  if (u === v) return;
  const [a, b, dir] = [el.selectionStart, el.selectionEnd, el.selectionDirection];
  el.value = u;
  try { el.setSelectionRange(a, b, dir || 'none'); } catch {}
}
document.addEventListener('input', e => { const el = e.target; if (el.matches?.('input[data-cap], textarea[data-cap]') && !e.isComposing) apply(el); });
document.addEventListener('compositionend', e => { const el = e.target; if (el.matches?.('input[data-cap], textarea[data-cap]')) apply(el); });
