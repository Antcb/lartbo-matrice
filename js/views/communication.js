/**
 * Onglet Communication : dates confirmées concernées, par artiste et par date.
 * Conf + kit, boucle com, affiches (demande, suivi, quantités, référent, livraison), liens.
 */
import { POSTER } from '../constants.js';
import { lingering } from '../data.js';
import { projName, showsFiltered } from '../selectors.js';
import { filterBar, viewHead } from '../ui/bits.js';
import { cAc, cChk, cIn, cSel, cUrl } from '../ui/cells.js';
import { esc } from '../utils.js';
import { byArtist, dateCell, notConcerned } from './ticketing.js';

export function viewCommunication(){
  const all = showsFiltered().filter(s => s.status && s.status.startsWith('Confirmée'));
  const shows = all.filter(s => s.communication_enabled || lingering(s.id));
  const others = all.filter(s => !s.communication_enabled && !lingering(s.id));
  const q = (s, f, l) => `<label class="qty"><span class="muted">${l}</span>${cIn('shows',s.id,f,s[f],'number','class="narrow" aria-label="Affiches '+l+'"')}</label>`;
  const row = (l, html) => `<div><span class="muted">${l}</span>${html}</div>`;
  const table = list => `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Conf + FT + kit</th><th>Boucle com</th><th>Affiches</th><th>Liens</th><th>Suivi</th></tr></thead><tbody>
    ${list.map(s => `<tr>${dateCell(s)}
      <td>${cIn('shows',s.id,'conf_kit_sent',s.conf_kit_sent,'date')}</td>
      <td>${cIn('shows',s.id,'boucle_com',s.boucle_com,'date')}</td>
      <td class="mini-grid" style="min-width:380px">
        ${row('Demande', cIn('shows',s.id,'poster_request_date',s.poster_request_date,'date'))}
        ${row('Suivi', cSel('shows',s.id,'poster_status',s.poster_status,POSTER))}
        ${row('Quantités', `<div class="qtys">${q(s,'poster_a3','A3')}${q(s,'poster_a2','A2')}${q(s,'poster_b1','B1')}</div>`)}
        ${row('Référent', cAc('contacts','shows',s.id,'poster_contact_id',s.poster_contact_id,{placeholder:'Chercher un contact…', create:true}))}
        ${row('Livraison', cAc('fulladdr','shows',s.id,'poster_delivery',s.poster_delivery,{text:s.poster_delivery||'', placeholder:'Adresse de livraison'}))}</td>
      <td class="mini-grid" style="min-width:280px">
        ${row('Billetterie', cUrl('shows',s.id,'ticketing_url',s.ticketing_url))}
        ${row('Instagram', cUrl('shows',s.id,'instagram_url',s.instagram_url))}
        ${row('Facebook', cUrl('shows',s.id,'facebook_url',s.facebook_url))}</td>
      <td>${cChk('shows',s.id,'communication_enabled',s.communication_enabled)}</td></tr>`).join('')}
    </tbody></table></div>`;
  return viewHead('Communication', {sub: `${shows.length} date${shows.length>1?'s':''} suivie${shows.length>1?'s':''}`, filters: filterBar()})
    + (shows.length ? byArtist(shows).map(([pid, list]) => `<section class="group"><div class="group-head"><h2>${esc(projName(pid)||'Sans projet')}</h2><span class="count">${list.length}</span></div>${table(list)}</section>`).join('')
       : `<div class="empty panel">Aucune date suivie en communication. Ajoute une date depuis la liste ci-dessous.</div>`)
    + notConcerned(others, 'communication_enabled', 'communication');
}
