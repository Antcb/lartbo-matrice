/**
 * Fenêtre de saisie générique (formulaires).
 */
import { render } from '../app.js';
import { S } from '../state.js';
import { $, esc } from '../utils.js';

export function field(f, v){
  const id = 'fld-'+f.k, cls = 'field'+(f.full?' full':'')+(f.type==='checkbox'?' check':'');
  if (f.type==='checkbox') return `<div class="${cls}"><input id="${id}" type="checkbox" name="${f.k}" ${v?'checked':''}><label for="${id}">${f.label}</label></div>`;
  let input;
  if (f.type==='select') input = `<select id="${id}" name="${f.k}">${f.blank===false?'':'<option value=""></option>'}${f.options.map(o=>{const [val,lab]=Array.isArray(o)?o:[o,o];return `<option value="${esc(val)}" ${String(val)===String(v??'')?'selected':''}>${esc(lab)}</option>`;}).join('')}</select>`;
  else if (f.type==='textarea') input = `<textarea id="${id}" name="${f.k}">${esc(v??'')}</textarea>`;
  else if (f.type==='tags') input = `<input id="${id}" name="${f.k}" value="${esc((v||[]).join(', '))}" placeholder="séparés par des virgules" list="${f.list||''}">`;
  else if (f.type==='links') input = linksPicker(f, v);
  else if (f.type==='checks') input = `<div class="checks">${f.options.map(([val,lab])=>`<label><input type="checkbox" name="${f.k}" value="${esc(val)}" ${(v||[]).includes(val)?'checked':''}> ${esc(lab)}</label>`).join('')}</div>`;
  else if (f.type==='files') input = `<label class="btn small file-btn">Choisir des fichiers<input type="file" name="${f.k}" multiple class="file-input" data-filelist="${f.k}"></label><div class="muted file-list" id="fl-${f.k}"></div>`;
  else input = `<input id="${id}" type="${f.type||'text'}" name="${f.k}" value="${esc(v??'')}" ${f.type==='number'?'step="any"':''}>`;
  return `<div class="${cls}"><label for="${id}">${f.label}</label>${input}</div>`;
}

export function linksPicker(f, ids){
  const src = S.db[f.source];
  return `<div class="chips" data-links="${f.k}">${(ids||[]).map(id=>{const r=src.find(x=>x.id===id); return r?`<span class="chip" data-lid="${id}">${esc(r[f.labelKey])}<button type="button" data-act="unlink" aria-label="Retirer">✕</button></span>`:'';}).join('')}</div>
    <input list="dl-${f.k}" placeholder="Taper pour ajouter…" data-linkinput="${f.k}">
    <datalist id="dl-${f.k}">${src.map(r=>`<option value="${esc(r[f.labelKey])}">`).join('')}</datalist>`;
}

document.addEventListener('change', e => {
  const k = e.target.dataset.linkinput; if (!k) return;
  const f = MODAL.fields.find(x=>x.k===k); const r = S.db[f.source].find(x=>x[f.labelKey]===e.target.value);
  if (!r) return; const box = $(`[data-links="${k}"]`);
  if (!box.querySelector(`[data-lid="${r.id}"]`)) box.insertAdjacentHTML('beforeend', `<span class="chip" data-lid="${r.id}">${esc(r[f.labelKey])}<button type="button" data-act="unlink" aria-label="Retirer">✕</button></span>`);
  e.target.value='';
});

export let MODAL = null;

export function openModal({title, fields, values={}, onSave, onDelete, extra=''}){
  MODAL = {fields, onSave, onDelete};
  const dlg = $('#modal');
  dlg.innerHTML = `<form method="dialog" id="mform">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost" data-act="closeModal" aria-label="Fermer">✕</button></div>
    <div class="modal-body">${fields.map(f=>field(f, values[f.k])).join('')}${extra}</div>
    <div class="modal-foot">${onDelete?'<button type="button" class="btn danger left" data-act="modalDelete">Supprimer</button>':''}
      <button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`;
  dlg.showModal();
  $('#mform').onsubmit = async ev => {
    ev.preventDefault();
    const out = {};
    for (const f of fields){
      if (f.type==='links'){ out[f.k] = [...document.querySelectorAll(`[data-links="${f.k}"] [data-lid]`)].map(c=>c.dataset.lid); continue; }
      if (f.type==='checks'){ out[f.k] = [...ev.target.querySelectorAll(`input[name="${f.k}"]:checked`)].map(c=>c.value); continue; }
      if (f.type==='files'){ out[f.k] = [...(ev.target.elements[f.k]?.files||[])]; continue; }
      const el = ev.target.elements[f.k]; if (!el) continue;
      let v = f.type==='checkbox' ? el.checked : el.value;
      if (f.type==='number') v = v===''?null:Number(v);
      else if (f.type==='tags') v = v.split(',').map(x=>x.trim()).filter(Boolean);
      else if (v==='') v = null;
      out[f.k] = v;
    }
    const ok = await onSave(out);
    if (ok!==false){ dlg.close(); render(); }
  };
}
