/**
 * Onglet Ticketing : jauges, ventes, remplissage.
 */
import { showsFiltered } from '../selectors.js';
import { S } from '../state.js';
import { cChk, cIn } from '../ui/cells.js';
import { field } from '../ui/modal.js';
import { esc, fmtDate } from '../utils.js';

export function viewTicketing(){
  const all = showsFiltered().filter(s => s.status && s.status.startsWith('Confirmée'));
  const shows = all.filter(s => s.ticketing_enabled);
  const others = all.filter(s => !s.ticketing_enabled);
  const rows = shows.map(s => {
    const avail = (s.capacity||0) - (s.comps||0);
    const remain = s.capacity!=null ? avail - (s.tickets_sold||0) : null;
    const rate = s.capacity ? Math.round(((s.tickets_sold||0)/Math.max(avail,1))*100) : null;
    return `<tr><td>${fmtDate(s.date)}</td><td><b>${esc(s.venue)}</b><br><span class="muted">${esc(s.city||'')}</span></td>
      <td>${esc(s.contract_type||'')}</td>
      <td class="num">${cIn('shows',s.id,'capacity',s.capacity,'number')}</td>
      <td class="num">${cIn('shows',s.id,'comps',s.comps,'number')}</td>
      <td class="num">${cIn('shows',s.id,'tickets_sold',s.tickets_sold,'number')}</td>
      <td class="num">${remain??'—'}</td>
      <td class="num"><b style="color:${rate==null?'inherit':rate>=80?'var(--ok)':rate<40?'var(--danger)':'var(--warn)'}">${rate==null?'—':rate+' %'}</b></td>
      <td>${cIn('shows',s.id,'ticketing_url',s.ticketing_url,'url','placeholder="Lien billetterie"')}</td>
      <td title="Concernée par le ticketing">${cChk('shows',s.id,'ticketing_enabled',s.ticketing_enabled)}</td></tr>`;
  }).join('');
  return `<div class="view-head"><h1>Ticketing ${S.year}</h1><span class="sub">${shows.length} dates suivies</span></div>
    ${shows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Contrat</th><th class="num">Jauge</th><th class="num">Invit.</th><th class="num">Vendus</th><th class="num">Restants</th><th class="num">Remplissage</th><th>Billetterie</th><th>Suivi</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty panel">Aucune date suivie en ticketing. Coche une date ci-dessous pour l'ajouter.</div>`}
    ${notConcerned(others,'ticketing_enabled','ticketing')}`;
}

export function notConcerned(list, field, label){
  if (!list.length) return '';
  return `<div class="section-title">Dates confirmées non concernées par le ${label}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Ville</th><th>Contrat</th><th></th></tr></thead><tbody>${list.map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${esc(s.venue)}</td><td class="muted">${esc(s.city||'')}</td><td class="muted">${esc(s.contract_type||'')}</td>
      <td><label>${cChk('shows',s.id,field,false)} Ajouter</label></td></tr>`).join('')}</tbody></table></div>`;
}
