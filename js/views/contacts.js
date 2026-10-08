/**
 * Onglet Contacts.
 */
import { linksOfContact } from '../selectors.js';
import { S } from '../state.js';
import { esc } from '../utils.js';

export function viewContacts(){
  const q = (S.search.contacts||'').toLowerCase();
  let rows = S.db.contacts;
  if (q) rows = rows.filter(c => [c.display_name,c.email,c.phone,...linksOfContact(c.id).map(s=>s.name)].join(' ').toLowerCase().includes(q));
  rows = rows.slice().sort((a,b)=>a.display_name.localeCompare(b.display_name));
  return `<div class="view-head"><h1>Contacts</h1><span class="sub">${rows.length} personnes</span><span class="spacer"></span>
    <input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Nom, mail, structure…" data-search="contacts" value="${esc(S.search.contacts||'')}">
    <button class="btn primary" data-act="newContact">Nouveau contact</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Structures</th><th>Poste</th><th>Mail</th><th>Téléphone</th></tr></thead><tbody>
    ${rows.slice(0,400).map(c=>`<tr class="click" data-act="editContact" data-id="${c.id}"><td><b>${esc(c.display_name)}</b></td>
      <td style="white-space:normal">${linksOfContact(c.id).map(s=>`<span class="tag">${esc(s.name)}</span>`).join('')}</td>
      <td style="white-space:normal">${(c.roles||[]).map(r=>`<span class="tag">${esc(r)}</span>`).join('')}</td>
      <td>${c.email?`<a href="mailto:${esc(c.email)}" onclick="event.stopPropagation()">${esc(c.email)}</a>`:''}</td><td>${esc(c.phone||'')}</td></tr>`).join('')}
    </tbody></table>${rows.length>400?`<p class="muted" style="padding:8px">400 premiers résultats affichés — affine la recherche.</p>`:''}</div>`;
}
