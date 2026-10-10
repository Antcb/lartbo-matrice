/**
 * Onglet Production : dates confirmées salle / festival, groupées par artiste et triées par date.
 * Chaque date se déplie : suivi admin, commissions, dossier Drive, facturation.
 * Projet en « booking seul » : seulement la conf, le contrat co-signé et la facture de commission.
 */
import { netArtbo, payAmount, payPct, payVat, paymentsOf, showVat, ttc } from '../calc.js';
import { BOOKING_STEPS, CONFIRMED_PROD, PROD_STEPS } from '../constants.js';
import { byId, projName, setting, showsFiltered, structName } from '../selectors.js';
import { lateSteps, remindersOf } from '../reminders.js';
import { S } from '../state.js';
import { filterBar, stBadge, stSelect, viewHead } from '../ui/bits.js';
import { cIn, cSel } from '../ui/cells.js';
import { dateInput } from '../ui/datefield.js';
import { esc, eur, fmtDate, matches } from '../utils.js';

export function viewProduction(){
  const q = S.search.production || '';
  const all = showsFiltered().filter(s => CONFIRMED_PROD.includes(s.status));
  const shows = all.filter(s => matches([s.venue, s.city, s.department, structName(s.structure_id), projName(s.project_id), fmtDate(s.date), s.date, s.contract_type].join(' '), q));
  let artbo=0, partner=0, toCollect=0;
  shows.forEach(s => paymentsOf(s.id).forEach(p => {
    const a = payAmount(p)||0;
    if (p.kind==='artbo') artbo+=a; if (p.kind==='partner') partner+=a;
    if ((p.kind==='acompte'||p.kind==='solde') && !p.paid_at) toCollect+=a;
  }));
  const late = shows.reduce((n,s)=>n+remindersOf(s).filter(r=>r.late).length, 0);
  const groups = {};
  shows.forEach(s => (groups[s.project_id||''] ||= []).push(s));
  const order = Object.keys(groups).sort((a,b)=>projName(a).localeCompare(projName(b)));
  const head = viewHead('Production', {
    sub: `${shows.length} date${shows.length>1?'s':''} confirmée${shows.length>1?'s':''}`,
    filters: filterBar() + `<input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-prod" placeholder="Artiste, ville, salle, festival, date…" data-search="production" value="${esc(q)}">`,
    actions: `<button class="btn" data-act="expandAll">${shows.length && shows.every(s=>S.openProd.has(s.id)) ? 'Tout replier' : 'Tout déplier'}</button>`});
  if (!all.length) return head + `<div class="empty panel">Aucune date confirmée salle ou festival en ${S.year}. Une date apparaît ici dès qu'elle passe en « Confirmée Salle » ou « Confirmée Festival ».</div>`;
  return head + `
    <div class="stat-row">
      <div class="stat"><b>${eur(artbo)}</b><span>Commissions L'ArtBo</span></div>
      <div class="stat"><b>${eur(partner)}</b><span>dont partenaires</span></div>
      <div class="stat"><b>${eur(artbo-partner)}</b><span>Net L'ArtBo</span></div>
      <div class="stat"><b>${eur(toCollect)}</b><span>Reste à encaisser (acomptes, soldes)</span></div>
      <div class="stat"><b style="${late?'color:var(--danger)':''}">${late}</b><span>Relance${late>1?'s':''} en retard</span></div>
    </div>
    ${shows.length ? order.map(pid => `<section class="group"><div class="group-head"><h2>${esc(projName(pid)||'Sans projet')}</h2><span class="count">${groups[pid].length}</span></div>
      <div class="prod-list">${groups[pid].map(prodRow).join('')}</div></section>`).join('') : '<div class="empty panel">Aucune date ne correspond à la recherche.</div>'}`;
}

function prodRow(s){
  const d = s.date ? new Date(s.date+'T12:00:00') : null;
  const booking = s.prod_mode === 'booking';
  const pays = paymentsOf(s.id).filter(p => !booking || p.kind==='artbo');
  const steps = booking ? BOOKING_STEPS : PROD_STEPS;
  const late = lateSteps(s);
  const checks = steps.map(([k])=>({ok:!!s[k], late:late.has(k)})).concat(pays.filter(p=>p.kind!=='cnm').map(p=>({ok:!!p.paid_at, late:late.has(p.kind)})));
  const open = S.openProd.has(s.id);
  return `<div class="prod-row ${open?'open':''}" id="prod-${s.id}">
    <div class="prod-head" data-act="toggleProd" data-id="${s.id}" aria-expanded="${open}">
      <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{month:'short', year:'2-digit'}):''}</span></div>
      <div class="what"><b>${esc(s.venue)}</b> ${booking?'<span class="badge tag">Booking seul</span>':''}<div class="sub">${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))} · ${esc(s.contract_type||'Contrat ?')} · ${eur(s.fee_ht)} HT · ${eur(ttc(s.fee_ht, showVat(s)))} TTC</div></div>
      <div class="progress" title="${checks.filter(c=>c.ok).length}/${checks.length} étapes faites${late.size?` · ${late.size} en retard`:''}">${checks.map(c=>`<i class="${c.ok?'ok':c.late?'late':''}"></i>`).join('')}</div>
      ${stSelect(s)}
      <span class="chev" aria-hidden="true">▸</span>
    </div>
    ${open ? prodBody(s, booking, steps, pays, late) : ''}
  </div>`;
}

function prodBody(s, booking, steps, pays, late){
  const partners = S.db.partners.map(p=>[p.id,p.name]);
  const rem = remindersOf(s);
  return `<div class="prod-body">
    <div>
      <h3 class="block-title">Suivi admin</h3>
      ${booking ? '<p class="mode-note">Booking seul : L\'ArtBoristerie envoie la conf + FT + kit, puis facture sa commission à l\'artiste une fois le contrat co-signé entre l\'artiste et l\'organisateur.</p>' : ''}
      <div class="steps">${steps.map(([k,l])=>`<label style="${late.has(k)?'color:var(--danger);font-weight:700':''}">${l}</label>${dateInput(s[k], `data-t="shows" data-id="${s.id}" data-f="${k}"`)}`).join('')}</div>
      ${rem.length ? `<div style="margin-top:12px">${rem.map(r=>`<div class="${r.late?'':'muted'}" style="font-size:13px;${r.late?'color:var(--danger);font-weight:600':''}">${r.late?'⚠︎':'•'} ${esc(r.title)} — ${r.late?'depuis le':'le'} ${fmtDate(r.due)}</div>`).join('')}</div>` : ''}
    </div>
    <div>
      <h3 class="block-title">Cachet et commission</h3>
      <div class="steps">
        <label>Cachet HT</label>${cIn('shows',s.id,'fee_ht',s.fee_ht,'number')}
        <label>TVA du cachet (%)</label>${cIn('shows',s.id,'vat_rate',s.vat_rate,'number','placeholder="5.5" class="narrow"')}
        <label>Cachet TTC</label><b>${eur(ttc(s.fee_ht, showVat(s)))}</b>
        <label>% L'ArtBo</label>${cIn('shows',s.id,'artbo_pct',s.artbo_pct,'number')}
        ${booking ? '' : `<label>Partenaire</label>${cSel('shows',s.id,'partner_id',s.partner_id,partners)}
        <label>% partenaire</label>${cIn('shows',s.id,'partner_pct',s.partner_pct,'number')}`}
      </div>
      <p class="muted" style="font-size:13px;margin:8px 0 0">${booking ? `Commission : <b>${eur(netArtbo(s))}</b>` : `Le % partenaire s'applique à la commission L'ArtBo. Net L'ArtBo : <b>${eur(netArtbo(s))}</b>`}</p>
      <div class="drive">${driveHTML(s)}</div>
    </div>
    ${mailsHTML(s, booking)}
    <div class="prod-bill">
      <h3 class="block-title">Facturation</h3>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Ligne</th><th class="num">%</th><th class="num">Montant HT</th><th class="num">TVA</th><th class="num">TTC</th><th>N° facture</th><th>Envoyée</th><th>Relancée</th><th>Payée</th><th></th></tr></thead>
        <tbody>${pays.map(p=>{ const a=payAmount(p), ov=p.amount!=null;
          return `<tr>
          <td>${cIn('show_payments',p.id,'label',p.label)}</td>
          <td class="num">${['cnm','autre','acompte','solde'].includes(p.kind) ? cIn('show_payments',p.id,'pct',p.pct,'number','class="narrow"') : `<span class="muted">${payPct(p)??'—'}</span>`}</td>
          <td class="num"><input type="number" step="any" data-t="show_payments" data-id="${p.id}" data-f="amount" value="${ov?p.amount:''}" placeholder="${a==null?'à saisir':a}" title="Laisse vide pour le calcul automatique" class="${ov?'override':''}"></td>
          <td class="num"><input type="number" step="any" class="narrow" data-t="show_payments" data-id="${p.id}" data-f="vat_rate" value="${p.vat_rate??''}" placeholder="${payVat(p)}" aria-label="TVA %"></td>
          <td class="num nowrap">${eur(ttc(a, payVat(p)))}</td>
          <td>${cIn('show_payments',p.id,'invoice_number',p.invoice_number,'text','style="min-width:90px"')}</td>
          <td class="${late.has(p.kind)&&!p.sent_at?'late-cell':''}">${cIn('show_payments',p.id,'sent_at',p.sent_at,'date')}</td>
          <td title="Date de la dernière relance">${cIn('show_payments',p.id,'reminded_at',p.reminded_at,'date')}</td>
          <td class="${p.paid_at?'done-cell':''}">${cIn('show_payments',p.id,'paid_at',p.paid_at,'date')}</td>
          <td><button class="btn icon sm ghost danger" data-act="delPay" data-id="${p.id}" aria-label="Supprimer la ligne">✕</button></td></tr>`;}).join('')}
        </tbody></table></div>
      <div class="vh-actions" style="margin-top:10px">
        ${booking ? '' : `<button class="btn sm" data-act="addPay" data-kind="acompte" data-id="${s.id}">Ajouter un acompte</button>
        <button class="btn sm" data-act="addPay" data-kind="cnm" data-id="${s.id}">Ajouter la taxe CNM</button>`}
        <button class="btn sm" data-act="addPay" data-kind="autre" data-id="${s.id}">Autre ligne</button>
        <button class="btn sm ghost" data-act="editShow" data-id="${s.id}">Fiche complète de la date</button>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Montants HT. Vide = calcul automatique sur le cachet HT ; un montant saisi à la main apparaît en orange. TVA par défaut : 5,5 % sur le cachet, 20 % sur les commissions. Le solde suit l’acompte (100 % − acomptes).</p>
    </div>
  </div>`;
}

/** Mails (confirmation, boucles) et fiche de renseignements */
function mailsHTML(s, booking){
  const log = s.mail_log || {};
  const btn = (kind, label) => `<button class="btn sm ${log[kind]?'':'primary'}" data-act="prepareMail" data-kind="${kind}" data-id="${s.id}">${label}</button>${log[kind]?`<span class="muted mail-done">préparé le ${fmtDate(log[kind].at.slice(0,10))}</span>`:''}`;
  const fiche = s.fiche_submitted_at
    ? `<span class="badge ok-badge">Fiche remplie le ${fmtDate(s.fiche_submitted_at.slice(0,10))}</span> <button class="btn sm" data-act="ficheAnswers" data-id="${s.id}">Voir les réponses</button>`
    : `<span class="muted">Fiche pas encore remplie par l’organisateur.</span>`;
  return `<div class="prod-mails">
    <h3 class="block-title">Mails et fiche de renseignements</h3>
    <div class="mail-btns">
      <span>${btn('confirmation', 'Préparer la confirmation')}</span>
      ${booking ? '' : `<span>${btn('boucle_tech', 'Boucle accueil & technique')}</span><span>${btn('boucle_com', 'Boucle communication')}</span>`}
    </div>
    ${booking ? '' : `<div class="fiche-line">${fiche}
      <button class="btn sm ghost" data-act="copyFiche" data-id="${s.id}">Copier le lien de la fiche</button>
      <a class="btn sm ghost" href="fiche.html?t=${esc(s.fiche_token||'')}" target="_blank" rel="noopener">Ouvrir la fiche</a></div>`}
  </div>`;
}

export function driveHTML(s){
  if (s.drive_folder_id) return `<a class="btn sm" href="https://drive.google.com/drive/folders/${esc(s.drive_folder_id)}" target="_blank" rel="noopener">Ouvrir le dossier Drive</a>
    ${setting('drive_webhook_url') ? `<button class="btn sm ghost" data-act="finderPath" data-id="${s.id}">Copier le chemin Finder</button>` : ''}
    <button class="btn sm ghost" data-act="linkDrive" data-id="${s.id}">Changer de dossier</button>`;
  const state = s.drive_folder_error ? `<span class="err">Dossier non créé : ${esc(s.drive_folder_error)}</span>`
    : s.drive_folder_requested_at ? '<span class="muted">Création du dossier en cours…</span>' : '<span class="muted">Pas encore de dossier Drive.</span>';
  return `${state} <button class="btn sm" data-act="retryDrive" data-id="${s.id}">Créer le dossier</button>
    <button class="btn sm" data-act="linkDrive" data-id="${s.id}">Lier un dossier</button>`;
}
