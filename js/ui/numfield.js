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

// Saisie illisible (« 12x ») : refusée partout avant tout enregistrement, l'ancienne valeur revient
const ok = v => v === '' || Number.isFinite(Number(v));
document.addEventListener('focusin', e => { const el = e.target; if (el.dataset?.num) el._good = desc.get.call(el); }, true);
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset?.num || ok(el.value)) return;
  e.stopImmediatePropagation(); e.preventDefault();
  toast('Nombre illisible : rien n’a été enregistré', true);
  desc.set.call(el, el._good ?? ''); el.focus();
}, true);
