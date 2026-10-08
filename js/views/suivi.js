/**
 * Onglet Suivi (liste) et fiche de suivi (résumé, journal, pièces jointes).
 */
import { LOG_ICON, LOG_KINDS, PROSPECT } from '../constants.js';
import { byId, filesOf, lastExchange, linksOfStructure, logsOf, projIds, projNames, prospectTitle } from '../selectors.js';
import { S } from '../state.js';
import { cSel, projChips } from '../ui/cells.js';
import { esc, fmtDate, md } from '../utils.js';

export function viewProspects(){
  const q = (S.search.prospects||'').toLowerCase();
  const st = S.suiviStatus || '';
  let rows = S.db.prospects.filter(p => (!S.project || projIds(p).includes(S.project)) && (!st || p.status===st));
  const nClosed = st ? 0 : rows.filter(p=>p.status==='Closed').length;
  if (!st && !S.showClosed) rows = rows.filter(p=>p.status!=='Closed');
  if (q) rows = rows.filter(p => (prospectTitle(p)+' '+(p.summary||'')+' '+(byId('structures',p.structure_id)?.city||'')).toLowerCase().includes(q));
  rows = rows.map(p=>({p, last:lastExchange(p)})).sort((a,b)=>(b.last||'').localeCompare(a.last||'') || (b.p.updated_at||'').localeCompare(a.p.updated_at||''));
  const projOpts = S.db.projects.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name));
  return `<div class="view-head"><h1>Suivi</h1><span class="sub">${rows.length} suivis${nClosed && !S.showClosed ? ` · ${nClosed} clos masqués` : ''}</span>
    ${nClosed ? `<button class="btn small ghost" data-act="toggleClosed">${S.showClosed?'Masquer':'Afficher'} les clos</button>` : ''}
    <select class="filter-sel" data-suivi-filter="project" aria-label="Artiste"><option value="">Tous les artistes</option>${projOpts.map(x=>`<option value="${x.id}" ${x.id===S.project?'selected':''}>${esc(x.name)}${x.active?'':' (inactif)'}</option>`).join('')}</select>
    <select class="filter-sel" data-suivi-filter="status" aria-label="Statut"><option value="">Tous les statuts</option>${PROSPECT.map(x=>`<option ${x===st?'selected':''}>${x}</option>`).join('')}</select>
    <span class="spacer"></span>
    <input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Structure, ville, mot du résumé…" data-search="prospects" value="${esc(S.search.prospects||'')}">
    <button class="btn primary" data-act="newProspect">Nouveau suivi</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Projet</th><th>Statut</th><th>Dernier échange</th><th class="num">Journal</th><th class="num">PDF</th><th>Résumé</th></tr></thead><tbody>
    ${rows.slice(0,500).map(({p,last})=>{ const s=byId('structures',p.structure_id);
      return `<tr class="click" data-act="openSuivi" data-id="${p.id}"><td><b>${esc(s?.name||p.name)}</b><br><span class="muted">${esc(s?.city||'')}</span></td>
      <td style="white-space:normal">${esc(projNames(p))}</td><td><span class="pst ${esc(p.status||'')}">${esc(p.status||'')}</span></td>
      <td>${last?fmtDate(last):'<span class="muted">—</span>'}</td><td class="num">${logsOf(p.id).length||''}</td><td class="num">${filesOf(p.id).length||''}</td>
      <td class="muted" style="white-space:normal;min-width:260px">${esc((p.summary||p.content_md||'').replace(/\*\*/g,'').replace(/\n/g,' ').slice(0,160))}</td></tr>`;}).join('') || '<tr><td colspan="7" class="empty">Aucun suivi.</td></tr>'}
    </tbody></table></div>`;
}

export function suiviCard(p){
  const logs = logsOf(p.id), files = filesOf(p.id), today = new Date().toISOString().slice(0,10);
  const contacts = linksOfStructure(p.structure_id);
  return `<div class="panel suivi" id="pr-${p.id}">
    <div class="suivi-head">
      ${projChips('prospects', p)}
      <div class="suivi-sel">${cSel('prospects',p.id,'status',p.status,PROSPECT,false)}</div>
      <span class="muted">Dernier échange : ${lastExchange(p)?fmtDate(lastExchange(p)):'—'}</span>
      <span class="spacer"></span>
      <button class="btn small ghost danger" data-act="delProspect" data-id="${p.id}">Supprimer</button>
    </div>
    <div class="suivi-grid">
      <div>
        <div class="suivi-block"><div class="suivi-title">Résumé <button class="btn small ghost" data-act="editText" data-id="${p.id}" data-f="summary">Modifier</button>
          <button class="btn small ghost" data-act="aiSummary" data-id="${p.id}" title="Résumé automatique à partir du journal, des notes et des PDF">✨ Mettre à jour avec l'IA</button>
          <button class="btn small ghost" data-act="copyForAi" data-id="${p.id}" title="Copie le prompt et le suivi pour les coller dans ChatGPT ou Claude">Copier pour ChatGPT</button></div>
          <div class="md">${md(p.summary) || '<span class="muted">Pas encore de résumé.</span>'}</div></div>
        <div class="suivi-block"><div class="suivi-title">Pièces jointes</div>
          ${files.map(f=>`<div class="file-row">📎 <a href="#" data-act="openFile" data-id="${f.id}">${esc(f.name)}</a>${f.size?` <span class="muted">${Math.round(f.size/1024)} Ko</span>`:''}
            <button class="btn small ghost danger" data-act="delFile" data-id="${f.id}" aria-label="Supprimer le fichier">✕</button></div>`).join('') || '<div class="muted">Aucun fichier.</div>'}
          <label class="btn small file-btn" style="margin-top:6px">Ajouter un PDF / fichier<input type="file" class="file-input" data-upload="${p.id}" multiple></label></div>
        <div class="suivi-block"><div class="suivi-title">Autres notes <button class="btn small ghost" data-act="editText" data-id="${p.id}" data-f="content_md">Modifier</button></div>
          <div class="md">${md(p.content_md) || '<span class="muted">—</span>'}</div></div>
      </div>
      <div>
        <div class="suivi-block"><div class="suivi-title">Journal des échanges</div>
          <form class="log-form" data-logform="${p.id}">
            <input type="date" name="date" value="${today}" aria-label="Date">
            <select name="kind" aria-label="Type">${LOG_KINDS.map(k=>`<option>${k}</option>`).join('')}</select>
            <input name="who" placeholder="Interlocuteur" list="dl-who-${p.id}" aria-label="Interlocuteur">
            <datalist id="dl-who-${p.id}">${contacts.map(c=>`<option value="${esc(c.display_name)}">`).join('')}</datalist>
            <textarea name="body" placeholder="Notes de l'échange…" aria-label="Notes"></textarea>
            <button class="btn small primary">Ajouter au journal</button>
          </form>
          ${logs.map(l=>`<div class="log">
            <div class="log-head">${LOG_ICON[l.kind]||'📝'} <b>${l.date?fmtDate(l.date):'Sans date'}</b>${l.contact_name?' — '+esc(l.contact_name):''}
              <button class="btn small ghost danger" data-act="delLog" data-id="${l.id}" aria-label="Supprimer l'entrée">✕</button></div>
            <div class="md">${md(l.body)}</div></div>`).join('') || '<div class="muted" style="margin-top:8px">Aucun échange enregistré.</div>'}
        </div>
      </div>
    </div></div>`;
}
