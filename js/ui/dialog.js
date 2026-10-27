/**
 * 💬 Fenêtre de dialogue de l'application (DESIGN_SYSTEM.md §9.1, CONVENTIONS.md §4.5, décision Q20) — remplace confirm().
 *
 *   const choix = await ask({title, text, actions: [{value, label, danger}], cancel: 'Annuler'});
 *   → la valeur du bouton choisi, ou null si « Annuler », Échap ou clic hors de la fenêtre : jamais l'action.
 *
 * Texte : l'action ET ses conséquences (« et ses 2 pièces jointes »). Boutons nommés (.btn.danger pour détruire, .btn.primary sinon) ;
 * question à deux issues = deux boutons nommés + « Annuler ». Focus initial sur « Annuler » (le moins risqué).
 * Mêmes styles que les fenêtres de formulaire (dialog, .modal-head, .modal-foot) ; plein écran sur téléphone comme elles.
 */
import { esc } from '../utils.js';

export function ask({title, text = '', actions = [], cancel = 'Annuler'}){
  const dlg = document.createElement('dialog');
  dlg.className = 'ask';
  dlg.setAttribute('aria-label', title);
  dlg.setAttribute('aria-describedby', 'ask-text');
  dlg.innerHTML = `<form method="dialog" class="mform">
    <div class="modal-head"><h2>${esc(title)}</h2></div>
    <div class="modal-body" id="ask-text">${String(text).split('\n').filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('')}</div>
    <div class="modal-foot"><button type="button" class="btn" data-ask="">${esc(cancel)}</button>${actions.map((a, i) =>
      `<button type="button" class="btn ${a.danger ? 'danger' : 'primary'}" data-ask="${i}">${esc(a.label)}</button>`).join('')}</div></form>`;
  document.body.appendChild(dlg);
  return new Promise(resolve => {
    let out = null;
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-ask]');
      if (b){ e.stopPropagation(); out = b.dataset.ask === '' ? null : actions[Number(b.dataset.ask)].value; dlg.close(); }
      else if (e.target === dlg) dlg.close();   // clic hors de la fenêtre (fond) : rien
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(out); }, {once: true});   // Échap : « cancel » puis « close », out reste null
    dlg.showModal();
    dlg.querySelector('[data-ask=""]').focus();
  });
}
