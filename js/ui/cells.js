/**
 * Champs modifiables directement dans les tableaux et fiches (enregistrés dès qu'on quitte le champ),
 * et pastilles de projets.
 *   cIn  : texte (s'agrandit pour tout afficher), nombre, date, lien
 *   cSel : liste déroulante · cChk : case à cocher · cAc : recherche avec suggestions
 */
import { projIds, projName, projectOptions } from '../selectors.js';
import { esc } from '../utils.js';
import { acInput } from './autocomplete.js';
import { dateInput } from './datefield.js';

const dataAttrs = (t,id,f) => `data-t="${t}" data-id="${id}" data-f="${f}"`;

export function cIn(t, id, f, v, type='text', extra=''){
  if (type==='date') return dateInput(v, dataAttrs(t,id,f) + ' ' + extra);
  if (type==='text' || type==='url')
    return `<textarea rows="1" class="cell-ta${type==='url'?' is-url':''}" ${dataAttrs(t,id,f)} ${extra}>${esc(v??'')}</textarea>`;
  return `<input type="${type}" ${type==='number'?'step="any" inputmode="decimal"':''} ${dataAttrs(t,id,f)} value="${esc(v??'')}" ${extra}>`;
}

export const cSel = (t,id,f,v,opts,blank=true) => `<select ${dataAttrs(t,id,f)}>${blank?'<option value=""></option>':''}${opts.map(o=>{ const [val,lab]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(val)}" ${String(val)===String(v??'')?'selected':''}>${esc(lab)}</option>`;}).join('')}</select>`;

export const cChk = (t,id,f,v,label='') => `<label class="chk"><input type="checkbox" ${dataAttrs(t,id,f)} ${v?'checked':''}>${label?`<span>${esc(label)}</span>`:''}</label>`;

export const cAc = (kind, t, id, f, v, opts={}) => acInput(kind, {value:v, attrs:dataAttrs(t,id,f), ...opts});

/** Lien cliquable + champ pour le modifier */
export function cUrl(t, id, f, v, placeholder='Coller le lien'){
  return `<span class="url-cell">${v?`<a class="btn icon sm" href="${esc(/^https?:/i.test(v)?v:'https://'+v)}" target="_blank" rel="noopener" title="Ouvrir le lien" aria-label="Ouvrir le lien">↗</a>`:''}${cIn(t,id,f,v,'url',`placeholder="${esc(placeholder)}"`)}</span>`;
}

/** Projets d'un suivi / d'une tâche : pastilles + ajout (projets actifs seulement) */
export function projChips(table, row){
  const ids = projIds(row);
  return `<div class="proj-chips">${ids.map(pid=>`<span class="chip">${esc(projName(pid))}<button type="button" data-act="rmProj" data-t="${table}" data-id="${row.id}" data-p="${pid}" aria-label="Retirer ${esc(projName(pid))}">✕</button></span>`).join('')}
    <select class="add-proj" data-addproj="${row.id}" data-table="${table}" aria-label="Ajouter un projet"><option value="">+ Projet</option>${projectOptions(true).filter(x=>!ids.includes(x.id)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>`;
}
