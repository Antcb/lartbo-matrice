/**
 * 📝 Brouillons, partout sur le site : tout ce qui est tapé et pas encore enregistré est gardé dans le navigateur
 * (changement de page, fenêtre fermée, onglet rechargé) et revient tel quel à la réouverture.
 *  - Formulaires de la page : <form data-draft="clé"> (échanges d'un artiste, d'un suivi…).
 *  - Fenêtres (fiches, tâches, échanges, mails…) : automatique, une clé par fenêtre et par fiche.
 * Le brouillon disparaît une fois le formulaire enregistré (clearDraft) ou avec « Effacer le brouillon ».
 */
import { localGet, localSet } from '../state.js';

const KEY = k => 'draft.' + k;
export function getDraft(k){ try { return JSON.parse(localGet(KEY(k)) || 'null'); } catch { return null; } }
export function setDraft(k, d){ localSet(KEY(k), JSON.stringify(d)); }
export function clearDraft(k){ try { localStorage.removeItem('artbo.' + KEY(k)); } catch { /* navigateur sans stockage */ } }

/** Valeurs tapées d'un formulaire : champs texte, listes, cases, zones de texte mis en forme */
function snapshot(form){
  const d = {f: {}, h: {}};
  form.querySelectorAll('input[name], textarea[name], select[name], input[id], textarea[id], select[id]').forEach(el => {
    if (el.type === 'file' || el.type === 'search' || el.closest('.rt-bar, .pm-list, .gm-pick')) return;
    if (el.type === 'hidden' && !el.classList.contains('dt-val') && !el.classList.contains('ac-val') && !el.classList.contains('tp-val')) return;
    const k = el.name || '#' + el.id;
    if (el.type === 'checkbox' || el.type === 'radio'){ (d.f[k] ||= {c: []}).c.push(el.checked ? el.value || 'on' : null); return; }
    d.f[k] = el.value;
  });
  form.querySelectorAll('[contenteditable="true"][id]').forEach(el => { d.h[el.id] = el.innerHTML; });
  return d;
}
function apply(form, d){
  if (!d) return;
  const fire = (e, type) => e.dispatchEvent(new Event(type, {bubbles: true}));
  const entries = Object.entries(d.f || {}).map(([name, v]) => [v,
    name.startsWith('#') ? [form.querySelector('#' + CSS.escape(name.slice(1)))].filter(Boolean) : [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)]]);
  const isBox = ([v]) => v && typeof v === 'object' && v.c;
  // 1. cases et boutons (artistes…), 2. menus (expéditeur, modèle…) : ils préviennent la fenêtre pour qu'elle se remette à jour
  entries.filter(isBox).forEach(([v, els]) => els.filter(e => e.type === 'checkbox' || e.type === 'radio')
    .forEach((e, i) => { const c = v.c[i] != null; if (e.checked !== c){ e.checked = c; fire(e, 'change'); } }));
  entries.filter(x => !isBox(x)).forEach(([v, els]) => els.filter(e => e.tagName === 'SELECT')
    .forEach(e => { if (e.value !== v){ e.value = v; fire(e, 'change'); } }));
  // 3. les champs texte et 4. le texte mis en forme, ensuite (ce qu'on avait écrit l'emporte sur ce que le modèle a rempli) ;
  // refait un peu plus tard si une mise à jour lancée par un menu (adresse, balises…) arrive après coup, tant qu'on n'a rien tapé
  const texts = () => {
  entries.filter(x => !isBox(x)).forEach(([v, els]) => els.filter(e => e.tagName !== 'SELECT').forEach(e => {
    if (e.value === v) return;
    e.value = v;
    // champ date : la partie affichée suit la valeur
    if (e.classList.contains('dt-val')){ const t = e.parentElement?.querySelector('.dt-txt'); if (t && v){ const [y, m, j] = v.split('-'); t.value = `${j}/${m}/${y}`; } }
    if (e.tagName === 'TEXTAREA') fire(e, 'input');
    if (e.classList.contains('tp-val')) fire(e, 'tp-set');
  }));
  Object.entries(d.h || {}).forEach(([id, html]) => { const el = form.querySelector('#' + CSS.escape(id)); if (el && el.innerHTML !== html){ el.innerHTML = html; fire(el, 'input'); } });
  };
  const gen = form._draftGen = (form._draftGen || 0) + 1;   // une restauration plus récente (ex. « repartir de zéro ») annule celle-ci
  texts();
  let typed = false; const mark = e => { if (e.isTrusted) typed = true; };
  form.addEventListener('input', mark); form.addEventListener('change', mark);
  [400, 1200, 2500].forEach((ms, i, all) => setTimeout(() => {
    if (!typed && form.isConnected && form._draftGen === gen) texts();
    if (i === all.length - 1){ form.removeEventListener('input', mark); form.removeEventListener('change', mark); }
  }, ms));
}
const changedFrom = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

// ── Formulaires de la page ──
const save = e => { const form = e.target.closest?.('form[data-draft]'); if (form) setDraft(form.dataset.draft, snapshot(form)); };
document.addEventListener('input', save);
document.addEventListener('change', save);
/** Après chaque affichage : les formulaires retrouvent leur brouillon */
export function restorePageDrafts(root){
  root.querySelectorAll('form[data-draft]').forEach(form => { const d = getDraft(form.dataset.draft); if (d) apply(form, d); });
}

// ── Fenêtres ──
const OPEN = new WeakMap();   // dialog → {key, initial}
/** À l'ouverture d'une fenêtre : brouillon restauré (après la préparation du contenu) et bandeau pour l'effacer */
export function watchModal(dlg, key){
  const form = dlg.querySelector('form'); if (!form) return;
  const state = {key, initial: null};
  OPEN.set(dlg, state);
  setTimeout(() => {   // le contenu de la fenêtre (texte du modèle, signature…) est en place
    if (!dlg.open || OPEN.get(dlg) !== state) return;
    state.initial = snapshot(form);
    const d = getDraft(key);
    if (d && changedFrom(d, state.initial)){
      apply(form, d);
      const bar = document.createElement('div'); bar.className = 'draft-bar';
      bar.innerHTML = '<span>Brouillon non enregistré retrouvé : ta saisie est revenue.</span><button type="button" class="btn sm ghost" data-draft-drop="1">Effacer le brouillon</button>';
      form.querySelector('.modal-body')?.prepend(bar);
      bar.querySelector('[data-draft-drop]').onclick = () => { clearDraft(key); bar.remove(); apply(form, state.initial); };
    }
  }, 60);
  const onEdit = () => { if (state.initial && OPEN.get(dlg) === state){ const s = snapshot(form); changedFrom(s, state.initial) ? setDraft(key, s) : clearDraft(key); } };
  form.addEventListener('input', onEdit); form.addEventListener('change', onEdit);
}
/** Fenêtre enregistrée : son brouillon n'a plus lieu d'être */
export function modalSaved(dlg){ const st = OPEN.get(dlg); if (st) clearDraft(st.key); OPEN.delete(dlg); }
