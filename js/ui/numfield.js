/**
 * Champs de nombres à la française, partout dans l'application : « 68,41 » au lieu de « 68.41 ».
 * Chaque <input type="number"> devient un champ texte (clavier numérique sur téléphone) qui affiche la virgule ;
 * son .value se lit toujours avec un point, donc tous les calculs et enregistrements existants marchent tels quels.
 */
import { toast } from '../utils.js';

const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const show = v => String(v ?? '').replace('.', ',');
const read = v => String(v ?? '').replace(/\s/g, '').replace(',', '.');

function enhance(el){
  if (el.dataset.num) return;
  const v = desc.get.call(el);
  el.type = 'text'; el.inputMode = 'decimal'; el.classList.add('num-in'); el.dataset.num = '1';
  el.setAttribute('autocomplete', 'off');
  Object.defineProperty(el, 'value', {configurable: true, get(){ return read(desc.get.call(this)); }, set(x){ desc.set.call(this, show(x)); }});
  el.value = v;
  if (/^-?\d+\.\d+$/.test(el.placeholder)) el.placeholder = show(el.placeholder);
}
const scan = root => root.querySelectorAll?.('input[type=number]').forEach(enhance);
scan(document);
new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
  if (n.nodeType !== 1) return;
  if (n.matches('input[type=number]')) enhance(n); else scan(n);
}))).observe(document.documentElement, {childList: true, subtree: true});

// Premier focus (clic, Tab ou doigt) : toute la valeur est sélectionnée, la frappe la remplace directement (07/11/2026) ; ensuite,
// un clic ou un toucher dans le champ déjà actif place le curseur normalement (édition partielle, décimales) : la sélection
// complète n'a lieu qu'une fois par focus, jamais à chaque déplacement du curseur. Écran tactile (réponse d'Anthony du
// 07/11/2026) : sélection posée juste après le focus par setSelectionRange (le toucher place d'abord son curseur ; select()
// est peu fiable sur iOS). Un réaffichage qui rend le focus au champ garde la position du curseur (app.js, focusKey).
let firstFocus = null;
const selectAll = el => { try { el.setSelectionRange(0, el.value.length); } catch(e){ el.select(); } };
document.addEventListener('focusin', e => {
  const el = e.target; if (!el.dataset?.num || el.readOnly) return;
  selectAll(el); firstFocus = {el, at: Date.now()};
  if (matchMedia('(pointer:coarse)').matches){ const v = desc.get.call(el);
    setTimeout(() => { if (document.activeElement === el && desc.get.call(el) === v && el.selectionStart === el.selectionEnd) selectAll(el); }, 0); }
});
// le clic / toucher qui donne le focus ne doit pas annuler la sélection (le navigateur la réduit au relâchement) ; une seule fois
const keepFirst = e => {
  const f = firstFocus; firstFocus = null;
  if (!f || e.target !== f.el || Date.now() - f.at > 600) return;
  if (f.el.selectionStart === f.el.selectionEnd) selectAll(f.el);
};
document.addEventListener('mouseup', keepFirst);
document.addEventListener('touchend', e => { const f = firstFocus; if (f && e.target === f.el) setTimeout(() => keepFirst({target: f.el}), 0); });

// Saisie illisible (« 12x ») : refusée partout avant tout enregistrement, l'ancienne valeur revient
const ok = v => v === '' || Number.isFinite(Number(v));
document.addEventListener('focusin', e => { const el = e.target; if (el.dataset?.num) el._good = desc.get.call(el); }, true);
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset?.num || ok(el.value)) return;
  e.stopImmediatePropagation(); e.preventDefault();
  toast('Nombre illisible : rien n’a été enregistré', true);
  desc.set.call(el, el._good ?? ''); el.focus();
}, true);
