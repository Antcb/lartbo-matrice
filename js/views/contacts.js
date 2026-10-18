/**
 * Onglet Contacts : recherche par nom, mail, téléphone, structure.
 */
import { linksOfContact } from '../selectors.js';
import { S } from '../state.js';
import { viewHead } from '../ui/bits.js';
import { esc, matches } from '../utils.js';

export function viewContacts(){
  const q = S.search.contacts || '';
  let rows = S.db.contacts;
  if (q) rows = rows.filter(c => matches([c.display_name,c.email,c.email_2,c.phone,(c.roles||[]).join(' '),...linksOfContact(c.id).map(s=>s.name)].join(' '), q));
  rows = rows.slice().sort((a,b)=>String(a.display_name).localeCompare(String(b.display_name)));
  return viewHead('Contacts', {sub:`${rows.length} personne${rows.length>1?'s':''}`,
      filters:`<input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-contacts" placeholder="Nom, mail, téléphone, structure…" data-search="contacts" value="${esc(q)}">`,
      actions:'<button class="btn primary" data-act="newContact">Nouveau contact</button>'})
    + `<div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Structure(s)</th><th>Mail</th><th>Téléphone</th></tr></thead><tbody>
    ${rows.slice(0,300).map(c=>`<tr class="click" data-act="editContact" data-id="${c.id}"><td><b>${esc(c.display_name)}</b>${(c.roles||[]).length?`<span class="sub">${esc(c.roles.join(', '))}</span>`:''}</td>
      <td>${linksOfContact(c.id).map(s=>`<a href="#" class="badge proj" data-act="openStructure" data-id="${s.id}">${esc(s.name)}</a>`).join(' ')}</td>
      <td>${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''}${c.email_2?`<span class="sub"><a href="mailto:${esc(c.email_2)}">${esc(c.email_2)}</a></span>`:''}</td>
      <td class="nowrap">${c.phone?`<a href="tel:${esc(c.phone.replace(/\s/g,''))}">${esc(c.phone)}</a>`:''}${c.phone_2?`<span class="sub">${esc(c.phone_2)}</span>`:''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucun contact ne correspond.</td></tr>'}
    </tbody></table>${rows.length>300?`<p class="muted" style="padding:10px 12px;margin:0">300 premiers résultats affichés — affine la recherche.</p>`:''}</div>`;
}
