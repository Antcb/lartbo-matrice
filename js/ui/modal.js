/**
 * Fenêtre de saisie générique (formulaires). Deux niveaux : #modal pour le formulaire principal,
 * #modal2 pour créer quelque chose sans le quitter (ex. une structure depuis une tâche).
 *
 * Types de champs : text, number, email, url, date, textarea, select, checkbox, checks (cases multiples),
 * ac (recherche avec suggestions : f.kind, f.create), place / city (adresse ou ville avec remplissage auto),
 * links (liste de liens vers structures / contacts), files (pièces jointes), html (contenu libre).
 */
import { render } from '../app.js';
import { S } from '../state.js';
import { $, esc, toast } from '../utils.js';
import { SOURCES, acInput, commitTypedText } from './autocomplete.js';
import { dateInput } from './datefield.js';
import { tagPicker, commitTags } from './tagpicker.js';
import { projPicker } from './projpicker.js';
import { trackModal } from './history.js';
import { modalSaved, watchModal } from './drafts.js';

export function field(f, v){
  const id = 'fld-'+f.k, cls = 'field'+(f.full?' full':'')+(f.type==='checkbox'?' check':'')+(f.cls?' '+f.cls:'');
  if (f.type==='html') return `<div class="${cls}">${f.label?`<label>${f.label}</label>`:''}${f.html}</div>`;
  if (f.type==='checkbox') return `<div class="${cls}"><input id="${id}" type="checkbox" name="${f.k}" ${v?'checked':''}><label for="${id}">${f.label}</label></div>`;
  let input;
  if (f.type==='select') input = `<select id="${id}" name="${f.k}">${f.blank===false?'':'<option value="">—</option>'}${f.options.map(o=>{const [val,lab]=Array.isArray(o)?o:[o,o];return `<option value="${esc(val)}" ${String(val)===String(v??'')?'selected':''}>${esc(lab)}</option>`;}).join('')}</select>`;
  else if (f.type==='project') input = projPicker(v, {attrs:`name="${f.k}" id="${id}"`, allLabel: f.allLabel||'', cls:'sel pp-field'});
  else if (f.type==='textarea') input = `<textarea id="${id}" name="${f.k}" ${f.rows?`rows="${f.rows}"`:''}>${esc(v??'')}</textarea>`;
  else if (f.type==='date') input = dateInput(v, `name="${f.k}" id="${id}"`);
  else if (f.type==='ac') input = acInput(f.kind, {value:v, attrs:`name="${f.k}"`, create:f.create, placeholder:f.placeholder||'Taper pour chercher…'});
  else if (f.type==='fulladdr') input = acInput('fulladdr', {value:v, text:v||'', attrs:`name="${f.k}"`, placeholder:f.placeholder||'Taper une adresse…'});
  else if (f.type==='place' || f.type==='city') input = acInput(f.type==='city'?'cities':'places', {value:v, text:v||'', attrs:`name="${f.k}"`, fill:f.fill??'', placeholder:f.placeholder||(f.type==='city'?'Taper une ville…':'Taper une adresse ou une ville…')});
  else if (f.type==='tags') input = tagPicker({id, name: f.k, values: Array.isArray(v) ? v : (v ? String(v).split(',').map(x=>x.trim()).filter(Boolean) : []), suggestions: typeof f.suggest === 'function' ? f.suggest() : (f.suggest || [])});
  else if (f.type==='links') input = linksPicker(f, v);
  else if (f.type==='checks') input = `<div class="checks pills">${f.options.map(([val,lab])=>`<label><input type="checkbox" name="${f.k}" value="${esc(val)}" ${(v||[]).includes(val)?'checked':''}> ${esc(lab)}</label>`).join('')}</div>`;
  else if (f.type==='files') input = `<div class="dropzone" data-drop-form="${f.k}"><label class="btn sm file-btn">Ajouter un fichier<input type="file" name="${f.k}" multiple class="file-input" data-filelist="${f.k}"></label><span class="drop-hint">ou glisse les fichiers ici</span><div class="muted file-list" id="fl-${f.k}"></div></div>`;
  else input = `<input id="${id}" type="${f.type||'text'}" name="${f.k}" value="${esc(v??'')}" ${f.type==='number'?'step="any" inputmode="decimal"':''} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:''}>`;
  return `<div class="${cls}"><label for="${id}">${f.label}</label>${input}${f.help?`<div class="help">${f.help}</div>`:''}</div>`;
}

/** Liens vers plusieurs structures / contacts : pastilles + recherche avec création */
export function linksPicker(f, ids){
  const kind = f.source;   // 'structures' ou 'contacts'
  return `<div class="chips" data-links="${f.k}">${(ids||[]).map(id=>chip(id, SOURCES[kind].label(id))).join('')}</div>
    <div class="links-add" data-links-add="${f.k}">${acInput(kind, {placeholder:'Taper pour ajouter…', create:!!f.create})}</div>`;
}
const chip = (id, label) => `<span class="chip" data-lid="${id}">${esc(label)}<button type="button" data-act="unlink" aria-label="Retirer">✕</button></span>`;

document.addEventListener('ac-chosen', e => {
  const add = e.target.closest('[data-links-add]'); if (!add) return;
  const box = add.closest('.field').querySelector(`[data-links="${add.dataset.linksAdd}"]`);
  if (!box.querySelector(`[data-lid="${e.detail.id}"]`)) box.insertAdjacentHTML('beforeend', chip(e.detail.id, e.detail.label));
  const inp = add.querySelector('.ac-input'); inp.value = ''; add.querySelector('.ac-val').value = '';
});

export const MODALS = {};
export let MODAL = null;

/**
 * openModal({title, fields, values, onSave, onDelete, deleteAsk, extra, extraTop, level, wide, saveLabel})
 * deleteAsk() : question de suppression ({title, text, actions}, voir ui/dialog.js) ; onDelete(choix) reçoit la valeur du bouton choisi.
 * extraTop : contenu libre affiché avant les champs, extra : après.
 * onSave(valeurs) : renvoyer false pour garder la fenêtre ouverte.
 */
export function openModal({title, fields, values={}, onSave, onDelete, deleteAsk, extra='', extraTop='', level=1, wide=false, mail=false, footExtra='', saveLabel='Enregistrer'}){
  const dlg = $(level===2 ? '#modal2' : '#modal');
  MODALS[level] = {fields, onSave, onDelete, deleteAsk, dlg};
  if (level===1) MODAL = MODALS[1];
  // mail : fenêtre haute, seul le texte du mail défile (champs en haut, boutons toujours visibles en bas)
  dlg.className = [wide || mail ? 'wide' : '', mail ? 'mail' : ''].filter(Boolean).join(' ');
  dlg.innerHTML = `<form method="dialog" class="mform" data-level="${level}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn icon ghost" data-act="closeModal" data-level="${level}" aria-label="Fermer">✕</button></div>
    <div class="modal-body">${extraTop}${fields.map(f=>field(f, values[f.k])).join('')}${extra}</div>
    <div class="modal-foot">${onDelete?`<button type="button" class="btn ghost danger left" data-act="modalDelete" data-level="${level}">Supprimer</button>`:''}
      <button type="button" class="btn" data-act="closeModal" data-level="${level}">Annuler</button>${footExtra}<button class="btn primary" type="submit">${esc(saveLabel)}</button></div></form>`;
  const wasOpen = dlg.open;
  dlg.showModal();
  if (!wasOpen) trackModal(dlg);
  // brouillon de la fenêtre : la saisie non enregistrée est gardée et revient à la réouverture
  watchModal(dlg, 'modal.' + level + '.' + title + '.' + (values.id || 'new'));
  autosizeAll(dlg);
  const first = dlg.querySelector('.modal-body input:not([type=hidden]):not(.dt-val), .modal-body textarea, .modal-body select');
  if (first && !values.id) setTimeout(() => first.focus(), 30);
  return new Promise(resolve => {
    dlg.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      // un champ date en cours de saisie doit être validé avant lecture
      if (document.activeElement?.classList.contains('dt-txt')) document.activeElement.blur();
      commitTypedText(ev.target); commitTags(ev.target);
      // un seul enregistrement à la fois : tous les boutons du bas attendent la fin (envoi, brouillon…)
      if (dlg._busy) return;
      // une date illisible ou une fin avant le début : on ne ferme pas, on montre le champ
      const bad = ev.target.querySelector('.dt-txt.bad');
      if (bad){ toast(bad.title || 'Date à corriger', true); bad.focus(); return; }
      const out = readForm(ev.target, fields);
      // un nombre illisible (« 12x ») : la fenêtre reste ouverte sur le champ, rien n'est enregistré
      const badNum = fields.find(f => f.type === 'number' && out[f.k] != null && !Number.isFinite(out[f.k]));
      if (badNum){ toast(`« ${badNum.label || badNum.k} » : nombre illisible`, true); ev.target.elements[badNum.k]?.focus(); return; }
      const btns = [...ev.target.querySelectorAll('.modal-foot button')];
      dlg._busy = true; btns.forEach(b => b.disabled = true);
      let ok;
      try { ok = await onSave(out); } finally { dlg._busy = false; btns.forEach(b => b.disabled = false); }
      if (ok!==false){ modalSaved(dlg); dlg.close(); if (level===1) render(); resolve(ok); }
    };
    // fermeture sans enregistrer : null. Un « close » en retard de la fenêtre précédente (fenêtres enchaînées) est ignoré.
    const token = dlg._mtoken = {};
    const onClose = () => {
      if (dlg._mtoken !== token){ dlg.removeEventListener('close', onClose); return; }
      if (dlg.open) return;
      dlg.removeEventListener('close', onClose); resolve(null);
    };
    dlg.addEventListener('close', onClose);
  });
}

function readForm(form, fields){
  const out = {};
  for (const f of fields){
    if (f.type==='html') continue;
    if (f.type==='links'){ out[f.k] = [...form.querySelectorAll(`[data-links="${f.k}"] [data-lid]`)].map(c=>c.dataset.lid); continue; }
    if (f.type==='checks'){ out[f.k] = [...form.querySelectorAll(`input[name="${f.k}"]:checked`)].map(c=>c.value); continue; }
    if (f.type==='files'){ out[f.k] = [...(form.elements[f.k]?._files || form.elements[f.k]?.files || [])]; continue; }
    const el = form.elements[f.k]; if (!el) continue;
    let v = f.type==='checkbox' ? el.checked : el.value;
    if (f.type==='number') v = v===''?null:Number(String(v).replace(',','.'));
    else if (f.type==='tags') v = v.split(',').map(x=>x.trim()).filter(Boolean);
    else if (typeof v === 'string'){ v = v.trim(); if (v==='') v = null; }
    out[f.k] = v;
  }
  // champs remplis automatiquement (adresse → ville, coordonnées…) : name="…" sans champ déclaré
  form.querySelectorAll('input[type=hidden][data-extra]').forEach(h => { out[h.name] = h.value === '' ? null : (h.dataset.num ? Number(h.value) : h.value); });
  return out;
}

/** Champs cachés remplis par le choix d'une adresse (coordonnées, département…) */
export const hiddenFields = (vals, keys) => keys.map(([k, num]) => `<input type="hidden" name="${k}" data-extra="1" ${num?'data-num="1"':''} value="${esc(vals[k] ?? '')}">`).join('');

/** Ajuste la hauteur des zones de texte à leur contenu */
export function autosize(ta){ ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
/** Toutes les zones d'un coup : écrire, puis lire, puis écrire (sinon le navigateur recalcule la page à chaque zone : très lent sur une longue liste) */
export function autosizeAll(root=document){
  const tas = [...root.querySelectorAll('textarea.cell-ta, .field textarea')]; if (!tas.length) return;
  tas.forEach(ta => { ta.style.height = 'auto'; });
  const hs = tas.map(ta => ta.scrollHeight);
  tas.forEach((ta, i) => { ta.style.height = (hs[i] + 2) + 'px'; });
}
document.addEventListener('input', e => { if (e.target.matches?.('textarea.cell-ta, .field textarea')) autosize(e.target); });
// Entrée valide un champ d'une ligne (Maj+Entrée pour aller à la ligne)
document.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey && e.target.matches?.('textarea.cell-ta')){ e.preventDefault(); e.target.blur(); } });
