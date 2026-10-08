/**
 * Champs modifiables directement dans les tableaux et pastilles de projets.
 */
import { projIds, projName } from '../selectors.js';
import { S } from '../state.js';
import { esc } from '../utils.js';

export const cIn = (t,id,f,v,type='text',extra='') => `<input type="${type}" data-t="${t}" data-id="${id}" data-f="${f}" value="${esc(v??'')}" ${extra}>`;

export const cSel = (t,id,f,v,opts,blank=true) => `<select data-t="${t}" data-id="${id}" data-f="${f}">${blank?'<option value=""></option>':''}${opts.map(o=>{ const [val,lab]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(val)}" ${val===v?'selected':''}>${esc(lab)}</option>`;}).join('')}</select>`;

export const cChk = (t,id,f,v) => `<input type="checkbox" data-t="${t}" data-id="${id}" data-f="${f}" ${v?'checked':''}>`;

export function projChips(table, row){
  return `<div class="proj-chips">${projIds(row).map(pid=>`<span class="chip">${esc(projName(pid))}<button type="button" data-act="rmProj" data-t="${table}" data-id="${row.id}" data-p="${pid}" aria-label="Retirer">✕</button></span>`).join('')}
    <select class="add-proj" data-addproj="${row.id}" data-table="${table}" aria-label="Ajouter un projet"><option value="">+ Projet</option>${S.db.projects.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name)).filter(x=>!projIds(row).includes(x.id)).map(x=>`<option value="${x.id}">${esc(x.name)}${x.active?'':' (inactif)'}</option>`).join('')}</select></div>`;
}
