/**
 * Onglet Communication : kit promo, affiches, liens.
 */
import { POSTER } from '../constants.js';
import { showsFiltered } from '../selectors.js';
import { S } from '../state.js';
import { cChk, cIn, cSel } from '../ui/cells.js';
import { esc, fmtDate } from '../utils.js';
import { notConcerned } from './ticketing.js';

export function viewCommunication(){
  const all = showsFiltered().filter(s => s.status && s.status.startsWith('Confirmée'));
  const shows = all.filter(s => s.communication_enabled);
  const others = all.filter(s => !s.communication_enabled);
  const contacts = S.db.contacts.slice().sort((a,b)=>a.display_name.localeCompare(b.display_name)).map(c=>[c.id,c.display_name]);
  const rows = shows.map(s => `<tr>
    <td class="sticky">${fmtDate(s.date)}<br><b>${esc(s.venue)}</b></td>
    <td>${cIn('shows',s.id,'conf_kit_sent',s.conf_kit_sent,'date')}</td>
    <td>${cIn('shows',s.id,'boucle_com',s.boucle_com,'date')}</td>
    <td>${cIn('shows',s.id,'poster_request_date',s.poster_request_date,'date')}</td>
    <td>${cSel('shows',s.id,'poster_status',s.poster_status,POSTER)}</td>
    <td class="num">${cIn('shows',s.id,'poster_a3',s.poster_a3,'number','style="min-width:55px"')}</td>
    <td class="num">${cIn('shows',s.id,'poster_a2',s.poster_a2,'number','style="min-width:55px"')}</td>
    <td class="num">${cIn('shows',s.id,'poster_b1',s.poster_b1,'number','style="min-width:55px"')}</td>
    <td>${cSel('shows',s.id,'poster_contact_id',s.poster_contact_id,contacts)}</td>
    <td>${cIn('shows',s.id,'poster_delivery',s.poster_delivery)}</td>
    <td>${cIn('shows',s.id,'ticketing_url',s.ticketing_url,'url')}</td>
    <td>${cIn('shows',s.id,'instagram_url',s.instagram_url,'url')}</td>
    <td>${cIn('shows',s.id,'facebook_url',s.facebook_url,'url')}</td>
    <td title="Concernée par la communication">${cChk('shows',s.id,'communication_enabled',s.communication_enabled)}</td></tr>`).join('');
  return `<div class="view-head"><h1>Communication ${S.year}</h1><span class="sub">${shows.length} dates suivies</span></div>
    ${shows.length ? `<div class="tbl-wrap"><table><thead><tr><th class="sticky">Date</th><th>Conf + FT + kit</th><th>Boucle com</th><th>Demande affiches</th><th>Suivi affiches</th><th class="num">A3</th><th class="num">A2</th><th class="num">B1</th><th>Référent affiches</th><th>Livraison</th><th>Billetterie</th><th>Instagram</th><th>Facebook</th><th>Suivi</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty panel">Aucune date suivie en communication.</div>`}
    ${notConcerned(others,'communication_enabled','communication')}`;
}
