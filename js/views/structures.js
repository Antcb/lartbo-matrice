/**
 * Onglet Structures : recherche (nom, ville, département, région, « autour de » une ville) et page structure
 * avec ses onglets : Accueil, Suivi, Dates, Tâches, Événements, Coordonnées administratives.
 */
import { lingering } from '../data.js';
import { distKm } from '../geo.js';
import { suiviClosed, byId, eventsOfStructure, isInactive, relanceTaskSuspended, lastExchange, linkRole, linksOfContact, linksOfStructure, projName, prospectsOfStructure, showsOfStructure, tasksOfStructure } from '../selectors.js';
import { S } from '../state.js';
import { curTab, fold, pstBadge, stBadge, stSelect, tabsBar, tag, viewHead } from '../ui/bits.js';
import { cAc, cIn, cSel } from '../ui/cells.js';
import { EVENT_KINDS, PRICING, isOff } from '../constants.js';
import { acInput } from '../ui/autocomplete.js';
import { esc, eur, fmtDate, hayOf, md, norm, period, url } from '../utils.js';
import { suiviCard } from './suivi.js';
import { lastProspectMail } from '../prospection.js';
import { taskSection } from './todo.js';

// Coordonnées administratives (champ admin de la structure) : [clé, libellé, pleine largeur ?]
export const ADMIN_FIELDS = [
  ['legal_name','Raison sociale'], ['legal_form','Forme juridique'], ['siret','SIRET'], ['ape','Code APE / NAF'], ['rna','N° RNA (association)'],
  ['vat','N° TVA intracommunautaire'], ['licence','Licence(s) d’entrepreneur de spectacles'],
  ['address','Adresse du siège',true], ['postal_code','Code postal'], ['city','Ville'], ['country','Pays'],
  ['vat_subject','Soumise à la TVA (Oui / Non)'],
  ['signatory','Représenté·e par (nom)'], ['signatory_role','Qualité (président·e, directeur·rice…)'],
  ['signatory_phone','Téléphone du signataire'], ['signatory_email','Mail du signataire'],
  ['email','Mail administratif'], ['phone','Téléphone administratif'], ['billing_email','Mail de facturation'],
  ['notes','Remarques pour les contrats',true],
];

export function structurePage(st){
  if (!st){ S.structurePage=null; return viewStructures(); }
  const contacts = linksOfStructure(st.id);
  const suivis = prospectsOfStructure(st.id).slice().sort((a,b)=>(lastExchange(b)||'').localeCompare(lastExchange(a)||''));
  const shows = showsOfStructure(st.id).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const tasks = tasksOfStructure(st.id);
  const events = eventsOfStructure(st.id);
  const openSuivis = suivis.filter(p=>!suiviClosed(p) || lingering(p.id));
  const tab = curTab('structure', 'home');
  const tabs = tabsBar('structure', [['home','Accueil'], ['suivi','Suivi', openSuivis.length], ['dates','Dates', shows.filter(x=>!isOff(x.status)).length], ['tasks','Tâches', tasks.filter(t=>!['Done','Cancelled'].includes(t.status)).length],
    ['events','Festivals / salles', events.length], ['admin','Coordonnées administratives']]);
  let body = '';
  if (tab==='home') body = homeTab(st, contacts, events) + `<div class="section-title">Tâches <span class="count">${tasks.filter(t=>!['Done','Cancelled'].includes(t.status)).length}</span><span class="spacer"></span><button class="btn sm" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`;
  else if (tab==='suivi'){
    const closed = suivis.filter(p=>suiviClosed(p) && !lingering(p.id));
    const shown = S.showClosed ? suivis : openSuivis;
    body = `<div class="vh-actions mb"><button class="btn primary" data-act="newSuiviFor" data-id="${st.id}">Nouveau suivi</button></div>`
      + (openSuivis.map(p => suiviCard(p)).join('') || `<div class="empty panel">${closed.length ? 'Aucun suivi en cours avec cette structure.' : 'Aucun suivi avec cette structure.'}</div>`)
      + (closed.length ? fold('closed-suivis', 'Suivis clos', closed.map(p => suiviCard(p)).join(''), {count: closed.length}) : '');
  }
  else if (tab==='dates'){
    // Sans suite / annulées : repliées (elles n'ont pas eu lieu), dépliables si besoin
    const live = shows.filter(x => !isOff(x.status)), off = shows.filter(x => isOff(x.status));
    const table = list => `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Artiste</th><th>Lieu</th><th>Statut</th><th class="num">Cachet</th><th>Contrat</th></tr></thead><tbody>
      ${list.map(x=>`<tr class="click" data-act="editShow" data-id="${x.id}"><td class="nowrap">${fmtDate(x.date)}</td><td>${esc(projName(x.project_id))}</td><td>${esc(x.venue)}<span class="sub">${esc(x.city||'')}</span></td><td>${stSelect(x)}</td><td class="num">${eur(x.fee_ht)}</td><td>${esc(x.contract_type||'')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucune date en cours avec cette structure.</td></tr>'}
      </tbody></table></div>`;
    body = `<div class="vh-actions mb"><button class="btn primary" data-act="newShowFor" data-id="${st.id}">Nouvelle date</button></div>
      ${table(live)}${off.length ? fold('struct-off-dates', 'Sans suite et annulées', table(off), {count: off.length}) : ''}`;
  }
  else if (tab==='tasks') body = `<div class="vh-actions mb"><button class="btn primary" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`;
  else if (tab==='events') body = eventsTab(st, events);
  else if (tab==='admin') body = adminTab(st);
  return `<button class="btn ghost back" data-act="closeStructure">← Structures</button>
  ${isInactive(st) ? `<p class="mode-note">Structure <b>inactive</b> depuis le ${fmtDate(String(st.inactive_at).slice(0, 10))} : gardée avec ses contacts, suivis, dates et documents ; plus proposée par défaut. ${(n => n ? `${n} relance${n > 1 ? 's' : ''} automatique${n > 1 ? 's' : ''} suspendue${n > 1 ? 's' : ''} (contacts liés uniquement à des structures inactives). ` : '')(S.db.tasks.filter(t => relanceTaskSuspended(t) && byId('prospects', t.prospect_id)?.structure_id === st.id).length)}Ses contacts qui ne sont liés qu’à des structures inactives ne sont plus relancés ni proposés en prospection (désabonnements inchangés) ; la réactiver rétablit tout. <button class="btn sm" data-act="setStructureInactive" data-id="${st.id}" data-on="0">Réactiver</button></p>` : ''}
  ${viewHead(esc(st.name), {sub: esc([st.city, st.department_code && '('+st.department_code+')', st.region, st.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(' · ')),
    actions:`<button class="btn ${isInactive(st) ? '' : 'primary'}" data-act="prospection" data-id="${st.id}" title="Mail de prospection depuis un modèle : brouillon ou envoi, suivi et relance créés automatiquement">Prospection</button>
      ${(m => m ? `<button class="btn" data-act="relance" data-id="${m.id}" title="Relance en réponse au mail « ${esc(m.mail_subject || '')} »">Relance${m.relances ? ` (${m.relances + 1}e)` : ''}</button>` : '')(lastProspectMail(st.id))}
      <button class="btn" data-act="editStructure" data-id="${st.id}">Modifier la fiche</button>
      <button class="btn" data-act="newShowFor" data-id="${st.id}">Nouvelle date</button>
      <button class="btn" data-act="newTaskFor" data-id="${st.id}">Nouvelle tâche</button>
      <button class="btn" data-act="newSuiviFor" data-id="${st.id}">Nouveau suivi</button>
      ${isInactive(st) ? '' : `<button class="btn ghost" data-act="setStructureInactive" data-id="${st.id}" data-on="1" title="Structure fermée : gardée avec tout son historique, plus proposée par défaut">Marquer inactive</button>`}`})}
  ${tabs}${body}`;
}

/** Dates d'un festival / événement : « 10 → 12 juil. 2027 », sinon la période habituelle (rien pour une salle à l'année) */
const evDates = e => e.date_start ? period({date: e.date_start, date_end: e.date_end}) + ' ' + e.date_start.slice(0, 4) : (e.period || '');

/** Résumé des festivals / salles / événements de la structure (sous l'adresse, page d'accueil) */
function eventsSummary(st, events){
  if (!events.length) return `<div class="ev-sum"><small>Festivals / salles / événements</small><span class="muted">Aucun renseigné.</span>
    <button class="btn sm ghost" data-act="newEvent" data-id="${st.id}">+ Ajouter</button></div>`;
  return `<div class="ev-sum"><small>Festivals / salles / événements</small>${events.map(e => `<div class="ev-line">
      <b>${esc(e.name || st.name)}</b>${e.kind ? ` <span class="badge tag">${esc(e.kind)}</span>` : ''}
      <span>${[evDates(e) && `<span class="ev-dates">${esc(evDates(e))}</span>`, e.city && esc(e.city),
        e.capacity && `${esc(String(e.capacity))} pers.`, e.pricing && esc(e.pricing + (e.price_avg ? ` · ${eur(e.price_avg)} en moyenne` : '')),
        !e.pricing && e.price_avg && `${eur(e.price_avg)} en moyenne`].filter(Boolean).join(' · ')}</span></div>`).join('')}</div>`;
}

function homeTab(st, contacts, events){
  const facts = [
    ['Adresse', [st.address, [st.postal_code, st.city].filter(Boolean).join(' '), st.country && st.country!=='France' ? st.country : ''].filter(Boolean).join(', ')],
    ['Département', st.department_code ? `${st.department_code} ${st.department_name||''}` : ''],
    ['Région', st.region],
  ].filter(([,v])=>v);
  return `<div class="struct-hero">
    <div class="panel pad">
      ${(st.tags||[]).length ? `<div class="proj-chips">${st.tags.map(tagLink).join('')}</div>` : ''}
      <div class="facts">${facts.map(([k,v])=>`<span><small>${k}</small>${esc(v)}</span>`).join('')}
        ${st.website?`<span><small>Site</small><a href="${esc(url(st.website))}" target="_blank" rel="noopener">${esc(st.website.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''))}</a></span>`:''}</div>
      ${eventsSummary(st, events)}
      ${st.notes?`<div class="md mt">${md(st.notes)}</div>`:''}
      ${!facts.length && !st.notes ? '<p class="muted m0">« Modifier la fiche » pour ajouter l’adresse, le site…</p>' : ''}
    </div>
    <div class="panel pad"><h3 class="block-title">Contacts <span class="count">${contacts.length}</span><span class="spacer"></span><button class="btn sm" data-act="newContactFor" data-id="${st.id}">Nouveau contact</button></h3>
      <div class="attach-contact mb">${acInput('contacts', {attrs: `data-attach-contact="${st.id}" aria-label="Rattacher un contact existant"`, placeholder: 'Rattacher un contact existant (nom ou mail)…'})}</div>
      ${contacts.map(c=>`<div class="contact-row"><a href="#" data-act="editContact" data-id="${c.id}"><b>${esc(c.display_name)}</b>${(c.roles||[]).includes('★')?' <span title="Contact principal">★</span>':''}</a>
        ${roleCell(c, st)}
        ${(others => others.length ? `<span class="muted small">aussi : ${others.map(o => esc(o.name)).join(', ')}</span>` : '')(linksOfContact(c.id).filter(o => o.id !== st.id))}
        <span class="links">${[c.email, c.email_2].filter(Boolean).map(m => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join('')}${[c.phone, c.phone_2].filter(Boolean).map(t => `<a href="tel:${esc(t.replace(/\s/g,''))}">${esc(t)}</a>`).join('')}</span></div>`).join('') || '<div class="muted">Aucun contact lié.</div>'}
    </div></div>`;
}

function eventsTab(st, events){
  return `<div class="vh-actions mb"><button class="btn primary" data-act="newEvent" data-id="${st.id}">Ajouter un festival, une salle ou un événement</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Nom</th><th>Début</th><th>Fin</th><th>Période habituelle</th><th>Lieu</th><th>Ville</th><th class="num">Jauge</th><th>Payant / gratuit</th><th class="num">Prix moyen (€)</th><th>Notes</th><th></th></tr></thead><tbody>
  ${events.map(e=>`<tr>
    <td>${cSel('structure_events',e.id,'kind',e.kind,EVENT_KINDS)}</td>
    <td>${cIn('structure_events',e.id,'name',e.name,'text','style="font-weight:700"')}</td>
    <td>${cIn('structure_events',e.id,'date_start',e.date_start,'date')}</td>
    <td>${cIn('structure_events',e.id,'date_end',e.date_end,'date')}</td>
    <td>${cIn('structure_events',e.id,'period',e.period,'text','placeholder="ex. 2e week-end de juillet"')}</td>
    <td>${cIn('structure_events',e.id,'place',e.place)}</td>
    <td style="min-width:160px">${cAc('cities','structure_events',e.id,'city',e.city,{text:e.city||'', placeholder:'Ville'})}</td>
    <td class="num">${cIn('structure_events',e.id,'capacity',e.capacity,'number','class="narrow"')}</td>
    <td>${cSel('structure_events',e.id,'pricing',e.pricing,PRICING)}</td>
    <td class="num">${cIn('structure_events',e.id,'price_avg',e.price_avg,'number','class="narrow"')}</td>
    <td>${cIn('structure_events',e.id,'notes',e.notes)}</td>
    <td><button class="btn icon sm ghost danger" data-act="delEvent" data-id="${e.id}" aria-label="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="12" class="empty">Aucun festival, salle ou événement renseigné pour cette structure.</td></tr>'}
  </tbody></table></div>`;
}

/** Champs des coordonnées administratives (enregistrés à la sortie du champ ; adresse avec suggestions) */
export function adminForm(st){
  const a = st.admin || {};
  return `<div class="admin-grid">${ADMIN_FIELDS.map(([k,l,full])=>`<div class="field ${full?'full':''}" style="${full?'grid-column:1/-1':''}"><label for="adm-${k}">${l}</label>
      ${k==='notes' ? `<textarea id="adm-${k}" name="adm_${k}" data-admin="${k}" data-sid="${st.id}">${esc(a[k]||'')}</textarea>`
        : k==='address' ? acInput('places', {value:a[k]||'', text:a[k]||'', attrs:`name="adm_address" data-admin="address" data-sid="${st.id}"`, fill:'adm_', placeholder:'Taper l’adresse du siège…'})
        : `<input id="adm-${k}" name="adm_${k}" data-admin="${k}" data-sid="${st.id}" value="${esc(a[k]||'')}">`}</div>`).join('')}</div>`;
}

function adminTab(st){
  return `<div class="panel pad">
    <p class="help mb">Informations utilisées pour les contrats. Enregistrées dès que tu quittes le champ.</p>
    ${adminForm(st)}
    <div class="vh-actions mt"><button class="btn sm" data-act="adminFromStructure" data-id="${st.id}">Reprendre l’adresse de la fiche</button></div>
  </div>`;
}

/** Étiquette cliquable : ouvre la liste des structures qui l'ont */
const tagLink = t => `<button type="button" class="badge tag tag-link" data-act="filterTag" data-tag="${esc(t)}" data-only="1" title="Toutes les structures « ${esc(t)} »">${esc(t)}</button>`;

export function viewStructures(){
  if (S.structurePage) return structurePage(byId('structures', S.structurePage));
  const words = norm(S.search.structures).split(/\s+/).filter(Boolean);
  const sel = S.structTags || [];
  // structures inactives (fermées, v1.54) : gardées, cachées par défaut, retrouvées avec « Afficher les inactives »
  const nInactive = S.db.structures.filter(isInactive).length;
  let rows = S.showInactiveStructs ? S.db.structures : S.db.structures.filter(s => !isInactive(s));
  if (sel.length) rows = rows.filter(s => sel.some(t => (s.tags||[]).includes(t)));   // au moins un des types choisis (OU, décision d'Anthony du 01/11/2026)
  if (words.length) rows = rows.filter(s => { const hay = hayOf([s.name,...eventsOfStructure(s.id).map(e=>e.name),s.address,s.city,s.postal_code,s.department_code,s.department_name,s.region,s.country,...(s.tags||[]),
      // les contacts de la structure : nom, mails, téléphones (on retrouve une structure par le mail d'un de ses contacts)
      ...linksOfStructure(s.id).flatMap(c => [c.display_name, c.email, c.email_2, c.phone, c.phone_2])].join(' '));
    return words.every(w => hay.includes(w)); });
  const near = S.near;   // {label, lat, lng, km}
  const dist = new Map();
  if (near){
    rows = rows.filter(s => s.lat!=null).map(s => { const d = distKm([near.lat,near.lng],[s.lat,s.lng]); dist.set(s.id, d); return s; })
      .filter(s => dist.get(s.id) <= near.km).sort((a,b)=>dist.get(a.id)-dist.get(b.id));
  } else {
    // recherche : d'abord les structures dont le nom correspond (qui commence par ce qu'on tape, puis qui le contient),
    // ensuite celles trouvées ailleurs (ville, contacts, mails…)
    const rank = s => { if (!words.length) return 0; const n = hayOf(s.name);
      return words.every(w => n.includes(w)) ? (n.startsWith(words[0]) ? 0 : 1) : words.some(w => n.includes(w)) ? 2 : 3; };
    const r = new Map(rows.map(s => [s.id, rank(s)]));
    rows = rows.slice().sort((a,b)=>(r.get(a.id)-r.get(b.id)) || a.name.localeCompare(b.name));
  }
  const counts = new Map(); S.db.structures.forEach(s => (s.tags||[]).forEach(t => counts.set(t, (counts.get(t)||0) + 1)));
  const tags = [...counts.keys()].sort((a,b)=>a.localeCompare(b, 'fr'));
  // Types : un menu compact (cases à cocher) au lieu de toute la liste ; les types choisis restent visibles à côté
  const tagBar = tags.length ? `<div class="tag-filter">
      <details class="tag-dd" ${S.tagDdOpen ? 'open' : ''}><summary class="sel">${sel.length ? `Types (${sel.length})` : 'Tous les types'}</summary>
        <div class="tag-dd-list" role="group" aria-label="Filtrer par type">${tags.map(t => `<button type="button" class="ac-item ${sel.includes(t)?'on':''}" data-act="filterTag" data-tag="${esc(t)}" aria-pressed="${sel.includes(t)}"><span class="pp-box" aria-hidden="true">${sel.includes(t)?'✓':''}</span>${esc(t)} <span class="n">${counts.get(t)}</span></button>`).join('')}</div></details>
      ${sel.map(t => `<button type="button" class="tag-chip on" data-act="filterTag" data-tag="${esc(t)}" aria-label="Retirer le filtre ${esc(t)}">${esc(t)} ✕</button>`).join('')}
      ${sel.length ? '<button type="button" class="btn sm ghost" data-act="filterTag" data-tag="">Tout afficher</button>' : ''}</div>` : '';
  return viewHead('Structures', {sub:`${rows.length} structure${rows.length>1?'s':''}${near?` à moins de ${near.km} km de ${esc(near.label)}`:''}`,
      actions:'<button class="btn primary" data-act="newStructure">Nouvelle structure</button>'}) + `
    <form class="near-form" id="near-form" autocomplete="off">
      <input class="search" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche" placeholder="Nom, ville, département, type, contact ou mail…" data-search="structures" value="${esc(S.search.structures||'')}">
      <span class="near-box">
        <input class="inp" type="search" autocomplete="off" data-1p-ignore name="autour" placeholder="Autour de… (ville)" value="${esc(near?.label||'')}" aria-label="Autour de quelle ville">
        <select class="sel" name="km" aria-label="Rayon">${[20,50,100,150,200,300].map(k=>`<option value="${k}" ${(near?.km||50)===k?'selected':''}>${k} km</option>`).join('')}</select>
        <button class="btn">Chercher autour</button>
        ${near?'<button type="button" class="btn ghost" data-act="clearNear">Effacer</button>':''}
      </span>
    </form>
    ${tagBar}
    ${nInactive ? `<div class="vh-actions mb"><label class="chk"><input type="checkbox" data-act="toggleInactiveStructs" ${S.showInactiveStructs ? 'checked' : ''}><span>Afficher les structures inactives (${nInactive})</span></label></div>` : ''}
    ${near?'<p class="help" style="margin:-6px 0 12px">Seules les structures dont la ville est connue apparaissent dans la recherche par distance.</p>':''}
    <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Ville</th><th>Département · région</th><th class="num">Jauge</th><th class="num">Contacts</th><th>Suivi</th></tr></thead><tbody>
    ${rows.slice(0,300).map(s=>{ const ps = prospectsOfStructure(s.id); return `<tr class="click" data-act="openStructure" data-id="${s.id}">
      <td class="struct-name"><b>${esc(s.name)}</b>${isInactive(s) ? ' <span class="badge">Inactive</span>' : ''}${(s.tags||[]).length?`<div class="proj-chips mt-sm">${s.tags.map(tagLink).join('')}</div>`:''}</td>
      <td>${esc(s.city||'')}${near?` <span class="muted">· ${Math.round(dist.get(s.id))} km</span>`:''}${s.country && s.country!=='France'?`<span class="sub">${esc(s.country)}</span>`:''}</td>
      <td>${esc(s.department_code ? `${s.department_code} ${s.department_name||''}` : '')}<span class="sub">${esc(s.region||'')}</span></td>
      <td class="num">${[...new Set(eventsOfStructure(s.id).map(e=>e.capacity).filter(Boolean))].join(' / ')}</td>
      <td class="num">${linksOfStructure(s.id).length||''}</td><td>${ps.map(x=>pstBadge(x.status)).join(' ')}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Aucune structure ne correspond. Crée-la avec « Nouvelle structure ».</td></tr>'}
    </tbody></table>${rows.length>300?`<p class="muted" style="padding:10px 12px;margin:0">300 premiers résultats affichés — affine la recherche.</p>`:''}</div>`;
}

/**
 * Fonction d'un contact dans une structure (correction du 05/11/2026) : les fonctions du contact (contacts.roles, « Poste(s) »)
 * restent la référence et s'affichent ; une fonction propre à CETTE structure (contact_structures.role) n'est saisie que si besoin,
 * ne touche ni la fiche du contact ni ses autres structures, et s'efface pour revenir à la référence. Aucune recopie automatique.
 */
export const refRoles = c => (c.roles || []).filter(r => r !== '★').join(', ');   // ★ = contact principal, pas une fonction
function roleCell(c, st){
  const own = linkRole(c.id, st.id), ref = refRoles(c), key = `${c.id}|${st.id}`;
  if (S.editRole === key){
    // modifiée ailleurs depuis l'ouverture : signalée, jamais remplacée sans un nouvel « Enregistrer »
    const moved = (S.editRoleBase ?? null) !== (own ?? null), warned = !moved && S.editRoleWarn;
    return `<span class="role-edit"><input class="inp link-role" data-link-role="1" data-c="${c.id}" data-s="${st.id}" value="${esc(S.editRoleDraft ?? (own || ref))}" placeholder="Fonction dans cette structure" aria-label="Fonction de ${esc(c.display_name)} dans cette structure">
      <button type="button" class="btn sm primary" data-act="saveLinkRole" data-c="${c.id}" data-s="${st.id}">Enregistrer</button>
      <button type="button" class="btn sm ghost" data-act="editLinkRole" data-key="">Annuler</button>${moved || warned ? `
      <span class="warn-txt small">Modifiée ailleurs entre-temps : ${own ? `« ${esc(own)} »` : 'fonctions du contact'}${warned ? ' ; « Enregistrer » la remplacera par ta saisie' : ''}</span>` : ''}</span>`;
  }
  return own
    ? `<span class="role-view"><span title="Fonction propre à cette structure${ref ? ` (fonctions du contact : ${esc(ref)})` : ''}">${esc(own)} <span class="muted small">· ici</span></span>
        <button type="button" class="btn sm ghost" data-act="editLinkRole" data-key="${esc(key)}">Modifier</button>
        <button type="button" class="btn sm ghost" data-act="resetLinkRole" data-c="${c.id}" data-s="${st.id}" title="Revenir aux fonctions du contact${ref ? ` : ${esc(ref)}` : ''}">Fonctions du contact</button></span>`
    : `<span class="role-view"><span class="muted">${ref ? esc(ref) : 'Fonction non renseignée'}</span>
        <button type="button" class="btn sm ghost" data-act="editLinkRole" data-key="${esc(key)}">Modifier la fonction dans cette structure</button></span>`;
}
