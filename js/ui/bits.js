/**
 * Petits éléments d'interface réutilisés partout : pastilles de statut, de pôle, d'urgence,
 * barre d'onglets d'une page, filtres Année / Projet, zone de dépôt de fichiers.
 */
import { DEPT_COLOR, stClass, stColor } from '../constants.js';
import { projName, projectOptions } from '../selectors.js';
import { S } from '../state.js';
import { esc } from '../utils.js';

export const stBadge = s => `<span class="badge st-badge st-${stClass(s)}" style="--c:${stColor(s)}">${esc(s||'—')}</span>`;

export const pstBadge = s => s ? `<span class="badge pst pst-${esc(s)}">${esc({Mailed:'Mail envoyé',Interest:'Intérêt',Option:'Option',Confirmed:'Confirmé',Closed:'Clos'}[s]||s)}</span>` : '';

export const deptBadge = d => d ? `<span class="badge dept" style="--c:${DEPT_COLOR[d]||'#5D6678'}">${esc(d)}</span>` : '';

export const projTag = id => id ? `<span class="badge proj">${esc(projName(id))}</span>` : '';

export const tag = t => `<span class="badge tag">${esc(t)}</span>`;

/** Onglets d'une page : key = page (ex. 'structure'), tabs = [[clé, libellé, nombre?]] */
export function tabsBar(key, tabs){
  const cur = S.tab[key] || tabs[0][0];
  return `<nav class="subtabs" role="tablist">${tabs.map(([k,l,n])=>`<button class="subtab" role="tab" data-act="subtab" data-key="${key}" data-tab="${k}" aria-selected="${cur===k}">${esc(l)}${n?` <span class="count">${n}</span>`:''}</button>`).join('')}</nav>`;
}
export const curTab = (key, def) => S.tab[key] || def;

/** Filtres Année / Projet affichés dans l'en-tête de la vue */
export function filterBar({year=true, project=true, years=null}={}){
  const ys = years || [...new Set(S.db.shows.filter(s=>s.date).map(s=>Number(s.date.slice(0,4))).concat([new Date().getFullYear(), new Date().getFullYear()+1]))].sort();
  return `<div class="filters">
    ${year?`<select id="f-year" class="sel" aria-label="Année">${ys.map(y=>`<option ${y===S.year?'selected':''}>${y}</option>`).join('')}</select>`:''}
    ${project?`<select id="f-project" class="sel" aria-label="Projet"><option value="">Tous les artistes</option>${projectOptions().map(p=>`<option value="${p.id}" ${p.id===S.project?'selected':''}>${esc(p.name)}${p.active?'':' (inactif)'}</option>`).join('')}</select>`:''}
  </div>`;
}

/** Zone de pièces jointes : on y glisse des fichiers ou on clique sur « Ajouter un fichier » */
export function dropZone(owner, inner=''){
  return `<div class="dropzone" data-drop='${esc(JSON.stringify(owner))}'>${inner}
    <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" data-upload-owner='${esc(JSON.stringify(owner))}' multiple></label>
    <span class="drop-hint">ou glisse les fichiers ici</span></div>`;
}

/** Ligne de fichier */
export const fileRow = (f, act='openFile', del='delFile') => `<div class="file-row"><span class="file-ico" aria-hidden="true">📎</span><a href="#" data-act="${act}" data-id="${f.id}">${esc(f.name)}</a>${f.size?` <span class="muted">${f.size>1e6?(f.size/1e6).toFixed(1)+' Mo':Math.max(1,Math.round(f.size/1024))+' Ko'}</span>`:''}
  <button class="btn icon sm ghost danger" data-act="${del}" data-id="${f.id}" aria-label="Supprimer ${esc(f.name)}">✕</button></div>`;

/** En-tête de vue standard */
export const viewHead = (title, {sub='', filters='', actions=''}={}) =>
  `<div class="view-head"><div class="vh-title"><h1>${title}</h1>${sub?`<span class="sub">${sub}</span>`:''}</div>${filters}<span class="spacer"></span><div class="vh-actions">${actions}</div></div>`;

/** Bloc repliable */
export const fold = (key, title, inner, {open=false, count=null}={}) => {
  const isOpen = S.tab['fold:'+key] ?? open;
  return `<section class="fold ${isOpen?'open':''}"><button class="fold-head" data-act="fold" data-key="${key}" aria-expanded="${isOpen}"><span class="caret" aria-hidden="true">▸</span>${title}${count!=null?` <span class="count">${count}</span>`:''}</button>${isOpen?`<div class="fold-body">${inner}</div>`:''}</section>`;
};
