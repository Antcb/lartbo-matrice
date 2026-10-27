/**
 * 💬 Fenêtres de dialogue de l'application (DESIGN_SYSTEM.md §9.1, CONVENTIONS.md §4.5, décision Q20) — remplacent confirm / prompt / alert.
 *
 *   ask({title, text, actions: [{value, label, danger}], cancel})  → valeur du bouton choisi, ou null
 *   confirmAsk(title, text, label, {danger})                        → true seulement si le bouton d'action est choisi
 *   askText({title, text, label, value, type, placeholder, ok, required, check}) → texte saisi, ou null
 *   inform({title, text, value})                                     → fermée par « Fermer » (value : texte à copier, sélectionné)
 *   copyText(texte, message, titre)                                  → copie ; si le navigateur refuse, le texte est montré à copier
 *
 * « Annuler », Échap et clic hors de la fenêtre ne déclenchent jamais l'action (null / false). Texte : l'action ET ses conséquences.
 * Boutons nommés (.btn.danger pour détruire, .btn.primary sinon) ; question à deux issues = deux boutons nommés + « Annuler ».
 * Focus initial sur « Annuler » (le moins risqué), ou sur le champ à remplir. Mot de passe : champ masqué (type password).
 * Mêmes styles que les fenêtres de formulaire (dialog, .modal-head, .modal-foot) ; plein écran sur téléphone comme elles.
 */
import { esc, toast } from '../utils.js';

let SEQ = 0;
const paras = text => String(text || '').split('\n').filter(l => l.trim()).map(l => `<p>${esc(l)}</p>`).join('');

/** Ouvre la fenêtre ; done(bouton, fenêtre) donne la valeur renvoyée (undefined = la fenêtre reste ouverte) */
function open({title, text, extra = '', buttons, cancel, focus, done}){
  const dlg = document.createElement('dialog'), id = 'ask-text-' + (++SEQ);
  dlg.className = 'ask';
  dlg.setAttribute('aria-label', title);
  dlg.setAttribute('aria-describedby', id);
  dlg.innerHTML = `<form method="dialog" class="mform">
    <div class="modal-head"><h2>${esc(title)}</h2></div>
    <div class="modal-body" id="${id}">${paras(text)}${extra}</div>
    <div class="modal-foot">${cancel ? `<button type="button" class="btn" data-ask="">${esc(cancel)}</button>` : ''}${buttons.map((a, i) =>
      `<button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.danger ? 'danger' : a.plain ? '' : 'primary'}" data-ask="${i}">${esc(a.label)}</button>`).join('')}</div></form>`;
  document.body.appendChild(dlg);
  return new Promise(resolve => {
    let out = null; const opened = Date.now();
    const pick = b => { const r = b.dataset.ask === '' ? null : done(buttons[Number(b.dataset.ask)], dlg); if (r === undefined) return; out = r; dlg.close(); };
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-ask]');
      if (b){ e.preventDefault(); e.stopPropagation(); pick(b); }
      else if (e.target === dlg && Date.now() - opened > 400) dlg.close();   // clic hors de la fenêtre (fond) : rien ; ignoré juste après l'ouverture (double-clic)
    });
    // Entrée dans un champ : le bouton d'action (submit), jamais « Annuler »
    dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const b = dlg.querySelector('button[type=submit]'); if (b) pick(b); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(out); }, {once: true});   // Échap : « cancel » puis « close », out reste null
    dlg.showModal();
    (dlg.querySelector(focus) || dlg.querySelector('[data-ask=""]') || dlg.querySelector('[data-ask]')).focus();
  });
}

export function ask({title, text = '', actions = [], cancel = 'Annuler'}){
  return open({title, text, cancel, buttons: actions, done: a => a.value});
}

/** Question à une seule action : true seulement si on clique le bouton d'action */
export async function confirmAsk(title, text, label, {danger = false} = {}){
  return (await ask({title, text, actions: [{value: true, label, danger}]})) === true;
}

/** Saisie d'un texte (remplace prompt) ; check(v) renvoie un message d'erreur pour refuser la valeur */
export function askText({title, text = '', label = '', value = '', type = 'text', placeholder = '', ok = 'Valider', required = true, check}){
  const extra = `<div class="field full"><label for="ask-input">${esc(label)}</label>
    <input id="ask-input" type="${type === 'password' ? 'password' : type === 'url' ? 'url' : 'text'}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="${type === 'password' ? 'new-password' : 'off'}" data-1p-ignore>
    <p class="help err" hidden></p></div>`;
  return open({title, text, extra, cancel: 'Annuler', focus: '#ask-input', buttons: [{label: ok, submit: true}], done: (_, dlg) => {
    const el = dlg.querySelector('#ask-input'), v = el.value.trim(), msg = dlg.querySelector('.help.err');
    const why = required && !v ? 'À remplir' : check ? check(v) : '';
    if (why){ msg.textContent = why; msg.hidden = false; el.classList.add('bad'); el.focus(); return undefined; }   // la fenêtre reste ouverte
    return v;
  }});
}

/** Information (remplace alert) ; value : texte à copier à la main, présenté sélectionné */
export async function inform({title, text = '', value = null}){
  const extra = value == null ? '' : `<div class="field full"><textarea id="ask-input" class="ask-copy" rows="${Math.min(8, String(value).split('\n').length + 1)}" readonly>${esc(value)}</textarea></div>`;
  const p = open({title, text, extra, cancel: '', focus: value == null ? '[data-ask]' : '#ask-input', buttons: [{label: 'Fermer', plain: true}], done: () => true});
  document.querySelector('dialog.ask:last-of-type #ask-input')?.select();
  await p;
}

/** Copie dans le presse-papiers ; si le navigateur la refuse, le texte est présenté sélectionné dans une fenêtre (remplace prompt) */
export async function copyText(text, okMsg, title = 'Texte à copier'){
  try { await navigator.clipboard.writeText(text); if (okMsg) toast(okMsg); return true; }
  catch { await inform({title, text: 'La copie automatique est bloquée par le navigateur : le texte ci-dessous est sélectionné, copie-le (Cmd+C ou Ctrl+C).', value: text}); return false; }
}
