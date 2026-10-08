/**
 * Onglet Ticketing : dates confirmées concernées par le ticketing, par artiste et par date.
 * Jauge, break (point d'équilibre en billets), billets vendus → reste pour le break,
 * remplissage pour atteindre le break et pour le complet.
 */
import { lingering } from '../data.js';
import { projName, showsFiltered } from '../selectors.js';
import { S } from '../state.js';
import { filterBar, fold, viewHead } from '../ui/bits.js';
import { cChk, cIn, cUrl } from '../ui/cells.js';
import { esc, fmtShort } from '../utils.js';

const pct = (a, b) => b ? Math.round((a||0) / b * 100) : null;
const meter = (p, label) => p==null ? '<span class="muted">—</span>'
  : `<div class="meter" style="--c:${p>=100?'var(--ok)':p>=60?'var(--brand-2)':p>=30?'var(--warn)':'var(--danger)'}"><b>${p} %</b><div class="bar"><i style="width:${Math.min(p,100)}%"></i></div>${label?`<span class="muted" style="font-size:12px">${label}</span>`:''}</div>`;

/** Dates confirmées groupées par artiste : [[projectId, [dates]]] */
export function byArtist(shows){
  const g = {}; shows.forEach(s => (g[s.project_id||''] ||= []).push(s));
  return Object.entries(g).sort((a,b)=>projName(a[0]).localeCompare(projName(b[0])));
}

export const dateCell = s => `<td class="nowrap"><b>${fmtShort(s.date)}</b><span class="sub">${s.date?s.date.slice(0,4):''}</span></td>
  <td style="min-width:170px"><b>${esc(s.venue)}</b><span class="sub">${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))}</span></td>`;

export function viewTicketing(){
  const all = showsFiltered().filter(s => s.status && s.status.startsWith('Confirmée'));
  const shows = all.filter(s => s.ticketing_enabled || lingering(s.id));
  const others = all.filter(s => !s.ticketing_enabled && !lingering(s.id));
  const table = list => `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th class="num">Jauge</th><th class="num">Break</th><th class="num">Vendus</th><th class="num">Reste pour le break</th><th>Remplissage (break)</th><th>Remplissage (complet)</th><th>Billetterie</th><th>Suivi</th></tr></thead><tbody>
    ${list.map(s => {
      const sold = s.tickets_sold || 0;
      const rest = s.break_even!=null ? Math.max(s.break_even - sold, 0) : null;
      return `<tr>${dateCell(s)}
        <td class="num">${cIn('shows',s.id,'capacity',s.capacity,'number','class="narrow" aria-label="Jauge"')}</td>
        <td class="num">${cIn('shows',s.id,'break_even',s.break_even,'number','class="narrow" aria-label="Break (billets pour être à l\'équilibre)"')}</td>
        <td class="num">${cIn('shows',s.id,'tickets_sold',s.tickets_sold,'number','class="narrow" aria-label="Billets vendus"')}</td>
        <td class="num"><b>${rest==null?'—':rest===0?'<span style="color:var(--ok)">Atteint</span>':rest}</b></td>
        <td>${meter(pct(sold, s.break_even), s.break_even?`${sold} / ${s.break_even}`:'')}</td>
        <td>${meter(pct(sold, s.capacity), s.capacity?`${sold} / ${s.capacity}`:'')}</td>
        <td>${cUrl('shows',s.id,'ticketing_url',s.ticketing_url,'Lien billetterie')}</td>
        <td>${cChk('shows',s.id,'ticketing_enabled',s.ticketing_enabled)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  return viewHead('Ticketing', {sub: `${shows.length} date${shows.length>1?'s':''} suivie${shows.length>1?'s':''}`, filters: filterBar()})
    + (shows.length ? byArtist(shows).map(([pid, list]) => `<section class="group"><div class="group-head"><h2>${esc(projName(pid)||'Sans projet')}</h2><span class="count">${list.length}</span></div>${table(list)}</section>`).join('')
       : `<div class="empty panel">Aucune date suivie en ticketing. Ajoute une date depuis la liste ci-dessous.</div>`)
    + notConcerned(others, 'ticketing_enabled', 'ticketing')
    + '<p class="help">Break : nombre de billets à vendre pour être à l’équilibre. Décocher « Suivi » retire la date de cette page.</p>';
}

export function notConcerned(list, field, label){
  if (!list.length) return '';
  return fold('nc-'+label, `Dates confirmées non concernées par le ${label}`, `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Artiste</th><th>Contrat</th><th></th></tr></thead><tbody>${list.map(s=>`<tr>${dateCell(s)}<td>${esc(projName(s.project_id))}</td><td class="muted">${esc(s.contract_type||'')}</td>
      <td>${cChk('shows',s.id,field,false,'Ajouter')}</td></tr>`).join('')}</tbody></table></div>`, {count:list.length});
}
