/**
 * Onglet Production : dates confirmées salle / festival, groupées par artiste et triées par date.
 * Chaque date se déplie : suivi admin, commissions, dossier Drive, facturation.
 * Projet en « booking seul » : seulement la conf, le contrat co-signé et la facture de commission.
 */
import { vatConflict, payeeParMouvements, BILL_KINDS, avoirsARattacher, avoirsAVerifier, avoirsOf, origineEcart, resteDu, restesDate, soldeeParAvoir, reglementsTousOf, mouvementsOf, factureNetTtc, encaisseTtc, resteDuTtc, aRembourserTtc, tropPercuTtc, htFiable, canFixInvoice, correctionsOf, acompteRetire, acompteState, allPaymentsOf, counted, isCoproduction, commissionState, billLockReason, billPct, billedPct, billingOf, financeOf, multiSolde, isInvoiced, netArtbo, allPiecesToAttach, pieceShowId, piecesToAttach, tracked, payAmount, payPct, payVat, paymentsOf, showVat, ttc } from '../calc.js';
import { BOOKING_STEPS, CONFIRMED_PROD, OPTION_PROD, PROD_STEPS } from '../constants.js';
import { byId, isArchived, projName, setting, showsFiltered, spectacleName, structName } from '../selectors.js';
import { followedInvoice, lateSteps, remindersOf, staleOf } from '../reminders.js';
import { S } from '../state.js';
import { filterBar, remindersSuspendedNote, stBadge, stSelect, tabsBar, viewHead } from '../ui/bits.js';
import { cChk, cIn, cSel } from '../ui/cells.js';
import { dateInput } from '../ui/datefield.js';
import { esc, eur2, fmtDate, matches, today, pct } from '../utils.js';
import { coreaCommissionCheck, payerLabel } from '../budget.js';
import { commissionPctOf, isCorea } from '../corea.js';
import { commissionTransferCell, productionBudgetHTML, projectBudgetHTML, showBudgetHTML, textBreakHint } from './budget.js';
import { isProductionShow } from '../production-budget.js';

const vatWarn = s => vatConflict(s) ? ' <span class="warn-txt small">Structure administrative de l’artiste non soumise à la TVA : à vérifier (TTC = HT)</span>' : '';

export function viewProduction(){
  const q = S.search.production || '';
  const all = showsFiltered().filter(s => CONFIRMED_PROD.includes(s.status));
  const hit = s => matches([s.venue, s.city, s.department, structName(s.structure_id), projName(s.project_id), fmtDate(s.date), s.date, s.contract_type].join(' '), q);
  const shows = all.filter(hit);
  // (v1.67) options salle / festival : listées avec leur statut pour préparer le budget prévisionnel ; jamais dans les montants, le
  // nombre de dates confirmées, les relances ni les anciens éléments
  const options = showsFiltered().filter(s => OPTION_PROD.includes(s.status) && hit(s));
  // indicateurs FINANCIERS : dates archivées comprises (v1.60.3, réponse d'Anthony du 07/11) — un archivage ne change aucun montant ;
  // la liste de travail et les relances ne les montrent pas
  const archivedFin = showsFiltered({archived: true}).filter(s => isArchived(s) && CONFIRMED_PROD.includes(s.status) && hit(s));
  const finShows = shows.concat(archivedFin);
  let artbo=0, partner=0;
  finShows.forEach(s => paymentsOf(s.id).forEach(p => {
    const a = payAmount(p)||0;
    if (p.kind==='artbo') artbo+=a; if (p.kind==='partner') partner+=a;
  }));
  // trois indicateurs distincts, jamais additionnés (décision d'Anthony du 26/10, lot C1) ; les factures de l'artiste en booking n'y entrent pas
  const fin = financeOf(finShows);
  const late = shows.reduce((n,s)=>n+remindersOf(s).filter(r=>r.late).length, 0);
  const groups = {};
  shows.concat(options).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach(s => (groups[s.project_id||''] ||= []).push(s));
  const order = Object.keys(groups).sort((a,b)=>projName(a).localeCompare(projName(b)));
  const head = viewHead('Production', {
    sub: `${shows.length} date${shows.length>1?'s':''} confirmée${shows.length>1?'s':''}${options.length ? ` · ${options.length} en option (hors montants)` : ''}`,
    filters: filterBar() + `<input class="search" type="search" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" name="recherche-prod" placeholder="Artiste, ville, salle, festival, date…" data-search="production" value="${esc(q)}">`,
    actions: `<button class="btn" data-act="syncPennylane" title="Coche « Payée » les acomptes et soldes réglés dans Pennylane (virement rapproché) et importe les avoirs">Synchroniser Pennylane</button><button class="btn" data-act="expandAll">${shows.length && shows.every(s=>S.openProd.has(s.id)) ? 'Tout replier' : 'Tout déplier'}</button>`});
  // pièces à rattacher d'une date absente de cette liste (supprimée, annulée, autre année, filtrée) : listées ici
  const listed = new Set(shows.map(s => s.id)), away = allPiecesToAttach().filter(a => !listed.has(pieceShowId(a)));
  const awayHTML = away.length ? `<div class="panel pad mb"><p class="help full"><b>Pièces à rattacher hors de cette liste</b> : factures déposées sur une date qui n’apparaît pas ici. Ouvre-les pour les retrouver ; le rattachement se fait depuis l’onglet Factures de la date.</p>
    ${away.map(a => { const sh = byId('shows', pieceShowId(a));
      return `<div class="file-row"><span class="file-ico" aria-hidden="true">📎</span><a href="#" data-act="openAttachment" data-id="${a.id}">${esc(a.name)}</a>
        <span class="muted small">${sh ? esc([fmtDate(sh.date), sh.venue, projName(sh.project_id), sh.status].filter(Boolean).join(' · ')) : `date supprimée · ${esc(projName(a.project_id) || 'artiste inconnu')}`}</span></div>`; }).join('')}</div>` : '';
  const archHTML = archivedFin.length ? `<div class="panel pad mb"><p class="help full"><b>Dates archivées comptées dans ces montants</b> (hors de la liste et des relances) :</p>
    ${archivedFin.map(s => `<div class="file-row"><a href="#" data-act="editShow" data-id="${s.id}">${esc([fmtDate(s.date), s.venue, projName(s.project_id)].filter(Boolean).join(' · '))}</a> <span class="badge tag">date archivée</span></div>`).join('')}</div>` : '';
  // anciens éléments à traiter (décision d'Anthony du 09/11) : obligations encore ouvertes d'une date passée au-delà de la limite des
  // notifications quotidiennes (120 j ; 30 j pour la facture de solde à faire) — toutes années, pour qu'elles ne disparaissent jamais
  const stale = S.db.shows.filter(s => !isArchived(s) && CONFIRMED_PROD.includes(s.status)).flatMap(s => staleOf(s).map(r => ({s, r})))
    .sort((a, b) => String(a.s.date).localeCompare(String(b.s.date)));
  const staleHTML = stale.length ? `<div class="panel pad mb" id="stale-items"><p class="help full"><b>Anciens éléments à traiter</b> (${stale.length}) : obligations encore ouvertes sur des concerts passés. Plus de notification quotidienne au-delà de la limite (120 jours après le concert, 30 jours pour la facture de solde à faire) ; elles restent ici jusqu’à ce que l’étape soit faite.</p>
    ${stale.map(({s, r}) => `<div class="file-row"><a href="#" data-act="editShow" data-id="${s.id}">${esc([fmtDate(s.date), s.venue, projName(s.project_id)].filter(Boolean).join(' · '))}</a> <span class="warn-txt small">${esc(r.title)}</span> <span class="muted small">— ${esc(r.staleWhy)}, échéance du ${esc(fmtDate(r.due))}</span></div>`).join('')}</div>` : '';
  const avoirsHTML = avoirsPendingHTML();
  if (!all.length && !archivedFin.length && !options.length) return head + awayHTML + avoirsHTML + staleHTML + `<div class="empty panel">Aucune date confirmée salle ou festival en ${S.year}. Une date apparaît ici dès qu'elle passe en « Confirmée Salle » ou « Confirmée Festival ».</div>`;
  return head + awayHTML + avoirsHTML + staleHTML + `
    <div class="stat-row">
      <div class="stat"><b>${eur2(artbo)}</b><span>Commissions L'ArtBo</span></div>
      <div class="stat"><b>${eur2(partner)}</b><span>dont partenaires</span></div>
      <div class="stat"><b>${eur2(artbo-partner)}</b><span>Net L'ArtBo</span></div>
      <div class="stat" title="Contrats de production : cession − déjà encaissé, date par date (inclut les factures pas encore émises)"><b>${eur2(fin.resteProd)}</b><span>Reste à encaisser — production</span></div>
      <div class="stat" title="Factures d’acompte et de solde de production émises et pas encore réglées, avoirs Pennylane déduits (déjà comprises dans le reste à encaisser : ne pas additionner)"><b>${eur2(fin.impayesProd)}</b><span>Factures émises impayées — production${fin.factures ? ` (${fin.factures})` : ''}</span></div>
      <div class="stat" title="Factures de commission L’ArtBo à l’artiste (dates booking) émises et pas encore réglées"><b>${eur2(fin.commissionsBooking)}</b><span>Commissions à encaisser — booking${fin.commissions ? ` (${fin.commissions})` : ''}</span></div>
      <div class="stat"><b style="${late?'color:var(--danger)':''}">${late}</b><span>Relance${late>1?'s':''} en retard</span></div>
    </div>
    ${archHTML}
    ${shows.length || options.length ? order.map(pid => `<section class="group"><div class="group-head"><h2>${esc(projName(pid)||'Sans projet')}</h2><span class="count">${groups[pid].length}</span></div>
      ${pid ? projectBudgetHTML(pid) : ''}
      <div class="prod-list">${groups[pid].map(prodRow).join('')}</div></section>`).join('') : '<div class="empty panel">Aucune date ne correspond à la recherche.</div>'}`;
}

function prodRow(s){
  if (OPTION_PROD.includes(s.status)) return optionRow(s);
  const d = s.date ? new Date(s.date+'T12:00:00') : null;
  const booking = s.prod_mode === 'booking';
  // date en booking : seulement la commission de L'ArtBo et la part partenaire (les factures de l'artiste ne sont pas suivies, lot C1)
  const pays = paymentsOf(s.id).filter(tracked);
  const steps = booking ? BOOKING_STEPS : PROD_STEPS;
  const late = lateSteps(s);
  const checks = steps.map(([k])=>({ok:!!s[k], late:late.has(k)})).concat(pays.filter(p=>p.kind!=='cnm' && !acompteRetire(p)).map(p=>({ok:!!p.paid_at || soldeeParAvoir(p), late:late.has(p.kind)})));
  const open = S.openProd.has(s.id);
  return `<div class="prod-row ${open?'open':''}" id="prod-${s.id}">
    <div class="prod-head" data-act="toggleProd" data-id="${s.id}" aria-expanded="${open}">
      <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{month:'short', year:'2-digit'}):''}</span></div>
      <div class="what"><b>${esc(s.venue)}</b> ${booking?'<span class="badge tag">Booking seul</span>':''}${s.structure_id?` <a href="#" class="struct-link" data-act="openStructure" data-id="${s.structure_id}" title="Ouvrir la fiche de la structure">${esc(structName(s.structure_id))} ↗</a>`:''}<div class="sub">${s.spectacle_id ? `${esc(spectacleName(s.spectacle_id))} · ` : ''}${esc([s.city, s.department && '('+s.department+')'].filter(Boolean).join(' '))} · ${esc(s.contract_type||'Contrat ?')} · ${eur2(s.fee_ht)} HT · ${eur2(ttc(s.fee_ht, showVat(s)))} TTC${billWarn(s, booking)}${(n => n ? ` <span class="warn-badge" title="Factures déposées sans ligne sûre : onglet Factures">${n} pièce${n > 1 ? 's' : ''} à rattacher</span>` : '')(piecesToAttach(s).length)}</div></div>
      <div class="progress" title="${checks.filter(c=>c.ok).length}/${checks.length} étapes faites${late.size?` · ${late.size} en retard`:''}">${checks.map(c=>`<i class="${c.ok?'ok':c.late?'late':''}"></i>`).join('')}</div>
      ${stSelect(s)}
      <span class="chev" aria-hidden="true">▸</span>
    </div>
    ${open ? prodBody(s, booking, steps, pays, late) : ''}
  </div>`;
}

/** (v1.67) date en option : statut visible, budget prévisionnel préparable avant confirmation ; ni étapes, ni factures, ni relances */
function optionRow(s){
  const d = s.date ? new Date(s.date+'T12:00:00') : null, booking = s.prod_mode === 'booking', open = S.openProd.has(s.id);
  const key = 'prod:' + s.id, tabs = [['conditions', 'Conditions'], ...(booking ? [] : [['budget', 'Budget prévisionnel']]), ['notes', 'Notes', s.notes ? '•' : '']];
  const cur = tabs.some(([k]) => k === S.tab[key]) ? S.tab[key] : (booking ? 'conditions' : 'budget');
  const body = open ? {conditions: () => conditionsTab(s, booking), budget: () => isProductionShow(s) ? productionBudgetHTML(s) : showBudgetHTML(s), notes: () => notesTab(s)}[cur]() : '';
  return `<div class="prod-row prod-option ${open?'open':''}" id="prod-${s.id}">
    <div class="prod-head" data-act="toggleProd" data-id="${s.id}" aria-expanded="${open}">
      <div class="day"><b>${d?String(d.getDate()).padStart(2,'0'):'—'}</b><span>${d?d.toLocaleDateString('fr-FR',{month:'short', year:'2-digit'}):''}</span></div>
      <div class="what"><b>${esc(s.venue)}</b> <span class="badge tag">${esc(s.status)} · pas encore confirmée</span>${booking?' <span class="badge tag">Booking seul</span>':''}<span class="muted"> ${esc([s.city, structName(s.structure_id)].filter(Boolean).join(' · '))}</span></div>
      ${stSelect(s)}
      <span class="chev" aria-hidden="true">▸</span>
    </div>
    ${open ? `<div class="prod-body"><p class="mode-note">Date en option : budget prévisionnel préparable dès maintenant ; elle n’entre dans aucun montant ni dans les dates confirmées tant qu’elle n’est pas confirmée.</p>
      ${tabsBar(key, tabs.map(([k, l, n]) => [k, l, n]))}<div class="prod-tab">${body}</div></div>` : ''}
  </div>`;
}

function prodBody(s, booking, steps, pays, late){
  const key = 'prod:' + s.id;
  // dans l'ordre du travail : conditions, suivi administratif (contrat…), factures, puis budget
  const tabs = [['conditions', 'Conditions'], ['suivi', 'Suivi admin', late.size ? '⚠︎' : ''], ['factures', 'Factures', pays.length], ...(booking ? [] : [['budget', 'Budget']]), ['notes', 'Notes', s.notes ? '•' : '']];
  const cur = tabs.some(([k]) => k === S.tab[key]) ? S.tab[key] : 'conditions';
  const body = {conditions: () => conditionsTab(s, booking), factures: () => billingTab(s, booking, pays, late),
    budget: () => isProductionShow(s) ? productionBudgetHTML(s) : showBudgetHTML(s), suivi: () => suiviTab(s, booking, steps, late), notes: () => notesTab(s)}[cur]();
  return `<div class="prod-body">
    ${remindersSuspendedNote(s)}
    ${actionsBar(s, booking)}
    ${tabsBar(key, tabs.map(([k, l, n]) => [k, l, n]))}
    <div class="prod-tab">${body}</div>
  </div>`;
}

/** En haut de la date : les mails à envoyer, la fiche, le contrat, le Drive — tout de suite visibles */
function actionsBar(s, booking){
  const log = s.mail_log || {};
  const state = kind => { const l = log[kind]; if (!l) return '';
    const sent = l.sent || (kind === 'confirmation' ? s.conf_kit_sent : s[kind]);
    return `<small class="${sent ? 'ok-txt' : 'muted'}">${sent ? '✓ envoyé' : 'brouillon'} le ${fmtDate(sent && typeof sent === 'string' && sent.length === 10 ? sent : l.at)}</small>`; };
  const mailBtn = (kind, label) => `<span class="pa-item"><button class="btn sm ${log[kind] ? '' : 'primary'}" data-act="prepareMail" data-kind="${kind}" data-id="${s.id}">${label}</button>${state(kind)}</span>`;
  // Boucle communication : la date d'envoi (shows.boucle_com, même donnée que l'onglet Communication) se saisit dans Suivi admin,
  // au-dessus de « Boucle technique » (v1.60.3 : champ retiré d'ici, doublon) ; le statut « mail préparé » reste distinct (préparer ≠ envoyer)
  const comLog = log.boucle_com;
  const comPrep = !comLog ? '' : comLog.sent
    ? `<small class="ok-txt">Envoyé depuis L’ArtBotrice le ${fmtDate(comLog.at)}</small>`
    : `<small class="muted">Mail préparé dans L’ArtBotrice le ${fmtDate(comLog.at)} (brouillon : n’indique pas l’envoi)</small>`;
  const comBtn = `<span class="pa-item pa-stack"><button class="btn sm ${comLog || s.boucle_com ? '' : 'primary'}" data-act="prepareMail" data-kind="boucle_com" data-id="${s.id}">Boucle communication</button>
      ${comPrep}</span>`;
  const fiche = s.fiche_validated_at
    ? `<span class="pa-item"><button class="btn sm ghost" data-act="validateFiche" data-id="${s.id}">Fiche de renseignements</button><small class="ok-txt">✓ validée le ${fmtDate(s.fiche_validated_at)}</small></span>`
    : s.fiche_submitted_at
      ? `<span class="pa-item"><button class="btn sm primary" data-act="validateFiche" data-id="${s.id}">Vérifier la fiche</button><small class="warn-txt">reçue le ${fmtDate(s.fiche_submitted_at)}</small></span>`
      : `<span class="pa-item"><button class="btn sm ghost" data-act="validateFiche" data-id="${s.id}">Fiche de renseignements</button><small class="muted">pas encore remplie</small></span>`;
  const contract = s.contract_doc_id
    ? `<span class="pa-item"><a class="btn sm" href="https://docs.google.com/document/d/${esc(s.contract_doc_id)}/edit" target="_blank" rel="noopener">Contrat ↗</a>${s.contract_pdf_id ? `<a class="btn sm ghost" href="https://drive.google.com/file/d/${esc(s.contract_pdf_id)}/view" target="_blank" rel="noopener">PDF ↗</a>` : ''}
       <button class="btn sm ghost" data-act="contractPdf" data-id="${s.id}">${s.contract_pdf_id ? 'Refaire le PDF' : 'Exporter en PDF'}</button>
       <button class="btn sm ghost" data-act="genContract" data-id="${s.id}" title="Refait le contrat avec les conditions à jour">Regénérer</button></span>`
    : `<span class="pa-item"><button class="btn sm ${s.fiche_validated_at ? 'primary' : 'ghost'}" data-act="genContract" data-id="${s.id}">Générer le contrat</button></span>`;
  return `<div class="prod-actions">
    <div class="pa-row">
      ${mailBtn('confirmation', 'Envoyer la confirmation')}
      ${booking ? '' : mailBtn('boucle_tech', 'Boucle accueil & technique') + comBtn}
    </div>
    <div class="pa-row">
      ${booking ? '' : fiche + contract}
      <span class="pa-item drive">${driveHTML(s)}</span>
    </div>
  </div>`;
}

/**
 * Conditions à valider ? Pas pour une date passée, ni pour une date dont la confirmation est déjà partie
 * (les conditions étaient dans le mail) : le rappel ne concerne que les dates à venir pas encore confirmées par mail.
 */
const isPastShow = s => !!s.date && s.date < today();
const termsPending = s => !s.terms_validated_at && !isPastShow(s) && !s.conf_kit_sent;
function termsStatus(s){
  if (s.terms_validated_at) return `<span class="ok-txt">✓ Conditions validées le ${fmtDate(s.terms_validated_at)}</span>`;
  if (s.conf_kit_sent) return `<span class="ok-txt">✓ Conditions envoyées dans la confirmation du ${fmtDate(s.conf_kit_sent)}</span>`;
  if (isPastShow(s)) return '<span class="muted">Date passée</span>';
  return '<span class="warn-txt">Conditions pas encore validées</span>';
}

/** Conditions : ce que reprennent le mail de confirmation, la fiche et le contrat */
function conditionsTab(s, booking){
  const partners = S.db.partners.map(p=>[p.id,p.name]);
  const plan = paymentsOf(s.id).filter(p => BILL_KINDS.includes(p.kind));   // échéancier prévu au contrat (acomptes prévus compris)
  return `<div class="prod-cols">
    <div>
      <p class="tab-intro">${termsStatus(s)} · elles partent dans la confirmation, la fiche et le contrat.
        <button class="btn sm ${termsPending(s) ? 'primary' : 'ghost'}" data-act="validateTerms" data-id="${s.id}">${termsPending(s) ? 'Valider les conditions' : 'Modifier les conditions'}</button></p>
      <div class="steps">
        <label>Contrat</label><span>${esc(s.contract_type || '—')}</span>
        <label>Cachet HT</label>${cIn('shows',s.id,'fee_ht',s.fee_ht,'number')}
        <label>TVA du cachet (%)</label><span>${cIn('shows',s.id,'vat_rate',s.vat_rate,'number','placeholder="5.5" class="narrow"')}${vatWarn(s)}</span>
        <label>Cachet TTC</label><b>${eur2(ttc(s.fee_ht, showVat(s)))}</b>
        ${booking ? '' : `<label>Acomptes</label><span>${plan.filter(p => p.kind === 'acompte').map(p => `${esc(p.label || 'Acompte')} ${pct(billPct(p))}${p.due_label ? ` <span class="muted">(${esc(p.due_label)})</span>` : ''}`).join(' · ') || '<span class="muted">aucun</span>'}${plan.some(p => p.kind === 'solde') ? ` · solde ${pct(billPct(plan.find(p => p.kind === 'solde')))}` : ''}</span>`}
        <label>Heure de passage</label>${cIn('shows',s.id,'show_time',s.show_time,'text','placeholder="ex. 22h30" class="narrow"')}
        <label>Durée du set</label>${cIn('shows',s.id,'set_length',s.set_length,'text','placeholder="ex. 1h15" class="narrow"')}
        ${booking ? '' : `<label>Invitations producteur</label>${cIn('shows',s.id,'invitations',s.invitations,'number','placeholder="10" class="narrow"')}`}
        ${s.contract_type === 'Co-Réalisation' ? `<label>% résultat net après break au producteur</label>${cIn('shows',s.id,'cr_producer_pct',s.cr_producer_pct,'number','class="narrow"')}
        <label>Break</label>${cIn('shows',s.id,'cr_break',s.cr_break,'text','placeholder="ex. 450 entrées payantes"')}` : ''}
      </div>
    </div>
    <div>
      <h3 class="block-title">Commission</h3>
      <label class="chk booking-only"><input type="checkbox" data-act="toggleBookingOnly" data-id="${s.id}" ${booking?'checked':''}><span>Booking uniquement sur cette date <span class="muted">(seulement la facture de commission, pas de budget)</span></span></label>
      <div class="steps">
        <label>% L'ArtBo</label>${cIn('shows',s.id,'artbo_pct',s.artbo_pct,'number')}
        ${booking ? '' : `<label>Partenaire</label>${cSel('shows',s.id,'partner_id',s.partner_id,partners)}
        <label>% partenaire</label>${cIn('shows',s.id,'partner_pct',s.partner_pct,'number')}`}
      </div>
      <p class="muted" style="font-size:13px;margin:8px 0 0">${booking ? `Commission : <b>${eur2(netArtbo(s))}</b>` : `Le % partenaire s'applique à la commission L'ArtBo. Net L'ArtBo : <b>${eur2(netArtbo(s))}</b>`}</p>
      ${booking && isCorea(s) ? coreaBookingBlock(s) : ''}
      ${booking ? '<p class="mode-note">Booking seul : L\'ArtBoristerie envoie la conf + FT + kit, puis facture sa commission à l\'artiste une fois le contrat co-signé entre l\'artiste et l\'organisateur.</p>' : ''}
    </div>
  </div>`;
}

/**
 * Coréalisation en booking (décision d'Anthony du 27/10/2026, 22 h 36) : sans budget de production. MG HT (cachet), break
 * contractuel (billets), part du résultat HT revenant à l'artiste saisie puis VALIDÉE ; commission provisoire (MG × taux) avant
 * validation, définitive ((MG + part validée) × taux) après. Aucune facture créée ; l'onglet Factures reprend ces montants (payAmount).
 */
function coreaBookingBlock(s){
  const c = s.corea || {}, mg = Number(s.fee_ht) || 0, rate = commissionPctOf(s), filled = v => v != null && v !== '';
  const proposed = filled(c.booking_share) ? Number(c.booking_share) : null, validated = filled(s.corea_share) ? Number(s.corea_share) : null;
  const stale = validated != null && proposed != null && Math.abs(proposed - validated) >= 0.005;
  const q = coreaCommissionCheck(s);
  return `<div class="corea-block mt-sm">
    <h4 class="block-title">Coréalisation : part du résultat</h4>
    <div class="steps">
      <label>MG HT (cachet)</label><b>${eur2(mg)}</b>
      <label>Break contractuel (billets)</label><span>${cIn('shows', s.id, 'break_even', s.break_even, 'number', 'class="narrow" aria-label="Break contractuel (billets)"')}${textBreakHint(s)}</span>
      <label>Part du résultat HT revenant à l’artiste</label><input type="number" step="any" inputmode="decimal" class="narrow" data-corea-show="${s.id}" data-corea-path="booking_share" value="${esc(c.booking_share ?? '')}" placeholder="0 si break non dépassé">
      <label>Part validée</label><span>${validated == null ? '<b>pas encore validée</b>' : `<b>${eur2(validated)}</b>${c.share_validated_at ? ` <span class="muted">le ${fmtDate(c.share_validated_at)}${c.share_validated_by ? ' par ' + esc(c.share_validated_by) : ''}</span>` : ''}`}${stale ? ' <span class="warn-txt">part modifiée depuis la validation : à valider de nouveau</span>' : ''}</span>
      <label>Commission (${esc(pct(rate))})</label><span>${validated == null
        ? `<b>${eur2(Math.round(mg * rate) / 100)}</b> <span class="muted">provisoire : sur le MG seul</span>`
        : `<b>${eur2(Math.round((mg + validated) * rate) / 100)}</b> <span class="muted">définitive : (MG + part validée) × taux</span>`}</span>
    </div>
    ${q?.frozen ? `<p class="small ${Math.abs(q.gap) >= 0.005 ? 'warn-txt' : 'muted'}">Commission retenue : ${eur2(q.held)} · facturée : ${q.invoiced ? 'oui' : 'non'} · encaissée : ${eur2(q.cashed)}.${Math.abs(q.gap) >= 0.005 ? ` <b>Régularisation à prévoir : ${q.gap > 0 ? '+' : ''}${eur2(q.gap)}</b> (rien n’est fait automatiquement ; le montant historique reste).` : ''}</p>` : ''}
    ${proposed != null && (validated == null || stale) ? `<div class="vh-actions mt-sm"><button class="btn sm" data-act="coreaValidateShare" data-id="${s.id}">Valider la part (${eur2(proposed)})</button> <span class="muted">aucune facture n’est créée</span></div>` : ''}
  </div>`;
}

/** Notes de la date (v1.53) : le champ « Notes » qui existait déjà (fenêtre de la date), enregistré en quittant le champ */
function notesTab(s){
  return `<div class="date-notes"><p class="tab-intro">Notes propres à cette date, visibles par toute l’équipe (les mêmes que dans la fenêtre de la date).</p>
    <textarea class="cell-ta date-notes-ta" data-t="shows" data-id="${s.id}" data-f="notes" aria-label="Notes de la date" placeholder="Accès, horaires, contacts sur place, points d’attention…">${esc(s.notes ?? '')}</textarea></div>`;
}

/** Suivi admin : les étapes datées et les rappels */
function suiviTab(s, booking, steps, late){
  const rem = remindersOf(s);
  return `<p class="tab-intro">Chaque étape prend la date du jour où elle est faite (les mails envoyés depuis la Matrice la remplissent tout seuls).</p>
    <div class="steps">${steps.map(([k,l])=>`<label style="${late.has(k)?'color:var(--danger);font-weight:700':''}">${l}</label>${dateInput(s[k], `data-t="shows" data-id="${s.id}" data-f="${k}"`)}`).join('')}</div>
    ${rem.length ? `<div class="mt">${rem.map(r=>`<div class="${r.late?'':'muted'}" style="font-size:13px;${r.late?'color:var(--danger);font-weight:600':''}">${r.late?'⚠︎':'•'} ${esc(r.title)} — ${r.late?'depuis le':'le'} ${fmtDate(r.due)}${r.stale ? ` (ancien élément : ${esc(r.staleWhy)}, plus de notification quotidienne)` : ''}</div>`).join('')}</div>` : ''}`;
}

/** Factures : ce que l'organisateur paie (acomptes, solde), la commission, les autres lignes */
function billingTab(s, booking, pays, late){
  return `<div class="prod-bill">
      <p class="tab-intro">${booking ? 'La facture de commission de L’ArtBo à l’artiste (et la part partenaire). Les factures d’acompte et de solde sont celles de l’artiste à l’organisateur : elles ne sont pas suivies ici.' : 'Ce que l’organisateur paie (acomptes + solde = le cachet), et la commission de L’ArtBo.'} Montants HT ; saisis le %, le HT ou le TTC, les deux autres se calculent.</p>
      ${isCorea(s) && pays.some(p => p.kind === 'artbo') ? `<p class="muted small">Commission de coréalisation : ${s.corea_share == null || s.corea_share === '' ? 'provisoire, sur le MG seul (part du résultat pas encore validée)' : `sur MG + part validée (${eur2(Number(s.fee_ht || 0) + Number(s.corea_share))} HT)`}.</p>` : ''}
      <div class="tbl-wrap"><table>
        <thead><tr><th>Ligne</th><th class="num">%</th><th class="num">Montant HT</th><th class="num">TVA</th><th class="num">TTC</th><th>Arrive sur</th><th>N° facture</th><th>Envoyée</th><th>Relancée</th><th>Payée</th><th>Pennylane</th><th></th></tr></thead>
        <tbody>${pays.map(p=>{ const a=payAmount(p), ov=p.amount!=null, selfPaid = !booking && p.kind==='artbo';   // production : pas de facture, L'ArtBo se verse sa commission
          const why = billLockReason(p), lock = why ? `disabled title="${esc(why)}"` : '';   // facture émise : montants verrouillés (§6.4)
          const st = acompteState(p), soldeCalc = p.kind === 'solde' && !isInvoiced(p) && !ov;   // solde calculé : cession − acomptes de la date (10/11/2026)
          const pctLock = lock || (soldeCalc ? 'disabled title="Calculé : cession − acomptes de la date, prévus et facturés (saisis un montant HT pour le fixer)"' : '');
          const fixes = correctionsOf(p.id);   // (v1.68) facture émise corrigée dans MATRICE : signalée, motif au survol
          return `<tr>
          <td>${cIn('show_payments',p.id,'label',p.label)}${fixes.length ? ` <span class="badge" title="${esc(`Corrigée dans MATRICE le ${fmtDate(String(fixes[0].at).slice(0, 10))}${fixes[0].actor ? ' par ' + fixes[0].actor : ''} : ${fixes[0].motif}`)}">corrigée</span>` : ''}${soldeCalc && !booking ? ` <span class="badge" title="Montant calculé (cession − acomptes de la date, prévus et facturés) : aucune facture de solde n’est encore émise">calculé, non facturé</span>` : ''}${st === 'prevu' && !acompteRetire(p) ? ` <span class="badge" title="Prévu au contrat (${pct(billPct(p))}), pas encore facturé : déjà déduit du solde, il reste dû (mets 0 % pour le retirer)">prévu, non facturé</span>` : ''}</td>
          <td class="num">${BILL_KINDS.includes(p.kind) ? `<input type="number" step="any" inputmode="decimal" class="narrow" data-t="show_payments" data-id="${p.id}" data-f="pct" value="${pctVal(billedPct(p))}" aria-label="% du cachet" ${pctLock}>`
            : ['cnm','autre'].includes(p.kind) ? cIn('show_payments',p.id,'pct',p.pct,'number','class="narrow"') : `<span class="muted">${payPct(p)??'—'}</span>`}</td>
          <td class="num"><input type="number" step="any" data-t="show_payments" data-id="${p.id}" data-f="amount" value="${ov?p.amount:''}" placeholder="${a==null?'à saisir':a}" ${lock || 'title="Laisse vide pour le calcul automatique"'} class="${ov?'override':''}"></td>
          ${selfPaid ? '<td class="num muted">—</td>' : `<td class="num"><input type="number" step="any" class="narrow" data-t="show_payments" data-id="${p.id}" data-f="vat_rate" value="${p.vat_rate??''}" placeholder="${payVat(p)}" aria-label="TVA %" ${lock}></td>`}
          <td class="num nowrap">${BILL_KINDS.includes(p.kind) && s.fee_ht ? `<input type="number" step="any" inputmode="decimal" data-t="show_payments" data-id="${p.id}" data-f="amount_ttc" value="${a==null?'':ttc(a, payVat(p))}" aria-label="Montant TTC" ${lock || 'title="Saisis le TTC : le HT et le % se calculent"'}>` : eur2(ttc(a, payVat(p)))}</td>
          <td>${payeeCell(s, p, booking)}</td>
          ${selfPaid ? `<td class="muted small">Pas de facture : tu te verses ta commission depuis le compte de l’artiste</td><td></td><td></td>
          <td class="${commissionState(p).full || commissionState(p).legacy ? 'done-cell' : late.has('artbo') ? 'late-cell' : ''}" title="Versements de la commission à L’ArtBo">${commissionTransferCell(p)}</td><td></td>` : `
          <td>${cIn('show_payments',p.id,'invoice_number',p.invoice_number,'text','aria-label="N° de facture"')}</td>
          <td class="${late.has(p.kind)&&!p.sent_at?'late-cell':''}">${cIn('show_payments',p.id,'sent_at',p.sent_at,'date')}</td>
          <td title="Date de la dernière relance">${cIn('show_payments',p.id,'reminded_at',p.reminded_at,'date')}${p.sent_at && !p.paid_at && followedInvoice(p, booking) && !soldeeParAvoir(p) ? `<div class="small" title="Plus de rappel « Paiement à vérifier » pour cette facture tant que la case est cochée (elle reste impayée et comptée)">${cChk('show_payments', p.id, 'reminders_paused', p.reminders_paused, 'Relances suspendues')}</div>` : ''}</td>
          <td class="${p.paid_at?'done-cell':''}">${payeeParMouvements(p) ? `<span data-paye-mouvements="${p.id}" title="Date « Payée » d’après les encaissements enregistrés : posée quand ils couvrent le reste dû, à la date du dernier ; jamais forcée à la main. Encaissement manquant : « Ajouter un encaissement ».">${p.paid_at ? fmtDate(p.paid_at) : '—'} <span class="small muted">d’après les encaissements</span></span>` : cIn('show_payments',p.id,'paid_at',p.paid_at,'date')}${soldeeParAvoir(p) && !p.paid_at ? ' <span class="badge" title="Facture entièrement couverte par son avoir Pennylane : plus rien à encaisser ; aucun encaissement n’est noté">soldée par avoir</span>' : ''}</td>
          <td>${pennylaneCell(p, s)}</td>`}
          <td>${why ? `<span class="muted" role="img" aria-label="Ligne verrouillée" title="${esc(why)}">🔒</span>${canFixInvoice(p) ? ` <button type="button" class="btn sm ghost" data-act="fixInvoice" data-id="${p.id}" title="Corriger le suivi de cette facture dans MATRICE (montant, %, TVA), avec un motif ; rien n’est fait dans Pennylane">Déverrouiller pour corriger</button>` : ''}` : `<button class="btn icon sm ghost danger" data-act="delPay" data-id="${p.id}" aria-label="Supprimer la ligne">✕</button>`}</td></tr>${avoirRowsHTML(p)}${selfPaid ? '' : reglementRowsHTML(s, p, booking)}`;}).join('')}
        </tbody>${booking || isCoproduction(s) ? '' : billFoot(s)}</table></div>
      ${isCoproduction(s) ? `<p class="help mt-sm">Coproduction : aucune facture de cession, aucun acompte ni solde, aucune commission L’ArtBo ni part partenaire générés. Ajoute une ligne seulement pour une opération réelle.</p>` : ''}
      ${horsCalculHTML(s)}
      ${booking ? '' : pendingPennylaneHTML(s)}
      <div class="vh-actions mt">
        ${booking ? '' : `<button class="btn sm" data-act="addPay" data-kind="acompte" data-id="${s.id}">Ajouter un acompte</button>`}
        ${booking ? '' : `<button class="btn sm" data-act="addPay" data-kind="autre" data-id="${s.id}">Autre ligne</button>
        ${isCoproduction(s) && !s.pennylane_quote_id ? '' : `<button class="btn sm" data-act="pennylaneQuote" data-id="${s.id}" title="Crée le devis dans Pennylane (non envoyé)" ${isCoproduction(s) ? 'disabled' : ''}>${s.pennylane_quote_id ? 'Devis Pennylane créé ✓' : 'Devis dans Pennylane'}</button>`}
        ${s.pennylane_quote_url ? `<a class="btn sm ghost" href="${esc(s.pennylane_quote_url)}" target="_blank" rel="noopener">Voir le devis ↗</a>` : ''}`}
        <button class="btn sm ghost" data-act="editShow" data-id="${s.id}">Fiche complète de la date</button>
        ${s.structure_id ? `<button class="btn sm ghost" data-act="openStructure" data-id="${s.structure_id}">Fiche de la structure</button>` : ''}
      </div>
      ${(f => f.length ? `<div class="mt"><p class="help full"><b>Pièces à rattacher</b> : factures déposées sans ligne sûre (rien n’a été rattaché automatiquement). Ouvre-les, puis rattache chacune à sa ligne.</p>
        ${f.map(a => `<div class="file-row"><span class="file-ico" aria-hidden="true">📎</span><a href="#" data-act="openAttachment" data-id="${a.id}">${esc(a.name)}</a>
          <button type="button" class="btn sm" data-act="attachPiece" data-id="${a.id}" data-show="${s.id}">Rattacher</button></div>`).join('')}</div>` : '')(piecesToAttach(s))}
      <p class="muted small mt-sm">Vide = calcul automatique sur le cachet HT ; un montant saisi à la main apparaît en orange. TVA par défaut : 5,5 % sur le cachet, 20 % sur les commissions. Le solde à facturer = cession − acomptes de la date, prévus et facturés (un acompte modifié ou retiré à 0 % le réadapte) ; une fois facturé, son montant ne bouge plus. Acomptes + solde ne dépassent jamais 100 % du cachet (commissions et autres lignes à part).</p>
    </div>`;
}

const pctVal = v => v == null ? '' : Math.round(v * 100) / 100;

/** Lignes gardées pour la traçabilité mais hors de tout calcul (coproduction, import — v1.44) : jamais présentées comme facture ni paiement */
function horsCalculHTML(s){
  const list = allPaymentsOf(s.id).filter(p => !counted(p));
  if (!list.length) return '';
  const KIND = {acompte: 'Acompte', solde: 'Solde', artbo: 'Commission L’ArtBo', partner: 'Commission partenaire', cnm: 'Taxe CNM (historique)', autre: 'Autre ligne'};
  return `<details class="hors-calcul mt-sm"><summary>${list.length} ligne${list.length > 1 ? 's' : ''} importée${list.length > 1 ? 's' : ''}, hors calcul (aucune facture ni paiement réels)</summary>
    <ul class="muted small">${list.map(p => `<li><b>${esc(p.label || KIND[p.kind] || p.kind)}</b> — ${esc(p.hors_calcul)}</li>`).join('')}</ul>
    <p class="muted small">Gardées pour l’historique : elles n’entrent dans aucun indicateur, compte, rappel ni opération Pennylane.</p></details>`;
}

/** Total des factures (acomptes + solde) face au cachet */
function billFoot(s){
  const b = billingOf(s), ok = Math.abs(b.gap) < 0.01;
  return `<tfoot><tr class="bill-total ${ok ? 'ok' : 'warn'}">
    <td><b>Total factures</b><div class="muted tiny">acomptes + solde</div></td>
    <td class="num"><b>${pct(b.pct)}</b></td><td class="num nowrap"><b>${eur2(b.ht)}</b></td><td></td><td class="num nowrap"><b>${eur2(b.ttc)}</b></td>
    <td colspan="7">${ok ? `<span class="ok-badge">✓ = cachet (${eur2(b.fee)} HT · ${eur2(b.feeTtc)} TTC)</span>`
      : `<span class="warn-badge">${b.gap > 0 ? `Il manque ${eur2(b.gap)} HT` : `${eur2(-b.gap)} HT de trop`} par rapport au cachet (${eur2(b.fee)} HT)</span>`}
      <span class="muted nowrap"> · envoyées ${eur2(b.sentHt)} HT · encaissé ${eur2(b.paidHt)} HT${b.otherHt ? ` · autres lignes ${eur2(b.otherHt)} HT` : ''}</span>
      ${multiSolde(s.id) ? '<span class="warn-badge">Plusieurs lignes de solde sur cette date : à vérifier (le reste à facturer ne va qu’à la première)</span>' : ''}
      ${b.plannedHt ? `<span class="muted nowrap"> · dont acomptes prévus, non facturés : ${eur2(b.plannedHt)} HT</span>` : ''}
      ${restesHTML(s)}</td></tr></tfoot>`;
}
/** Alerte dans l'en-tête de la date quand les factures ne tombent pas juste */
function billWarn(s, booking){
  if (booking || !s.fee_ht || isCoproduction(s)) return '';
  const b = billingOf(s);
  return (b.lines.length && Math.abs(b.gap) >= 0.01 ? ` <span class="warn-badge" title="Acomptes + solde ≠ cachet">factures ${pct(b.pct)}</span>` : '')
    + (multiSolde(s.id) ? ' <span class="warn-badge" title="Plusieurs lignes de solde sur cette date : à vérifier">plusieurs soldes</span>' : '');
}

/** Où arrive l'argent d'une ligne de facturation */
function payeeCell(s, p, booking){
  const proj = byId('projects', s.project_id);
  if (p.kind === 'artbo') return `<span class="muted nowrap">${booking ? "L'ArtBo" : esc(payerLabel('compte', proj)) + ' → L’ArtBo'}</span>`;
  if (p.kind === 'partner') return `<span class="muted nowrap">L'ArtBo → partenaire</span>`;
  if (!['acompte','solde','autre'].includes(p.kind) || booking) return '';
  // vide = « Non renseigné » (§6.6, Q6) : jamais de compte supposé ; à choisir, surtout une fois payé
  const sel = cSel('show_payments', p.id, 'payee', p.payee || '', [['', 'Non renseigné'], ...['compte','artbo','artiste','autre'].map(c => [c, payerLabel(c, proj)])], false);
  return !p.payee && p.paid_at ? `${sel} <span class="warn-badge" title="Payé, mais sans compte d’encaissement : compté dans la date et l’artiste, dans aucun compte">compte à choisir</span>` : sel;
}

/**
 * Facture Pennylane d'une ligne.
 * Acompte et solde : comme dans Pennylane, ils se font DEPUIS LE DEVIS (facture d'acompte, puis facture de solde qui déduit l'acompte) ;
 * la Matrice crée le devis, puis « Synchroniser Pennylane » reprend tout seul le numéro et le paiement de chaque facture.
 * Commission et autres lignes : brouillon de facture créé directement.
 */
/** (v1.69, L1 du point 02) Avoirs Pennylane d'une facture, sous sa ligne : document distinct, jamais un encaissement ni un
 *  remboursement ; un paiement déjà noté est conservé tel quel ; sinon reste dû = montant − avoirs (soldée si tout est couvert) */
function avoirRowsHTML(p){
  const list = avoirsOf(p.id);
  if (!list.length) return '';
  const name = a => esc(a.invoice_number || 'Avoir ' + a.pennylane_id);
  const etat = [soldeeParAvoir(p) ? '<b>Facture soldée par l’avoir</b> : plus rien à encaisser sur cette facture, ni relance de paiement'
      : p.paid_at ? '' : `Reste dû sur cette facture après avoir : <b>${eur2(resteDu(p))}</b> HT (montant − avoirs)`,
    p.paid_at ? `Paiement noté le ${fmtDate(p.paid_at)} : conservé tel quel (un avoir ne crée ni encaissement ni remboursement)` : ''].filter(Boolean).join(' · ');
  return list.map(a => `<tr class="avoir-row"><td colspan="12"><span class="badge">Avoir</span> ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${name(a)} ↗</a>` : name(a)}${a.invoice_date ? ` du ${fmtDate(a.invoice_date)}` : ''} : <b>− ${eur2(a.amount_ht)}</b> HT
      <span class="muted small">sur la facture ${esc(p.invoice_number || p.label || '')} · document Pennylane</span>${origineEcart(a) ? ` <span class="warn-badge" title="Rattaché à cette facture ; Pennylane indique maintenant une autre facture d’origine. Rien n’a été déplacé : à vérifier.">facture d’origine changée dans Pennylane : à vérifier</span>` : ''}</td></tr>`).join('')
    + (etat ? `<tr class="avoir-row"><td colspan="12" class="small">${etat}</td></tr>` : '');
}

/** (v1.70, décision E3) Les cinq montants de la date, toujours distincts ; TTC (base bancaire, E2), HT à côté seulement s'il est fiable */
function restesHTML(s){
  const r = restesDate(s); if (!r.emis) return '';
  const ht = r.fiable ? ` <span class="muted">(${eur2(r.contratHt)} HT)</span>` : '';
  return `<div class="small mt-sm" data-restes="${s.id}">Reste contractuel : <b>${eur2(r.contratTtc)}</b> TTC${ht} <span class="muted">(cession − encaissé sur acomptes et soldes)</span>
    · Facturé net après avoirs : <b>${eur2(r.factureNet)}</b> TTC · Encaissé réel : <b>${eur2(r.encaisse)}</b> TTC · Reste dû : <b>${eur2(r.resteDu)}</b> TTC
    · Reste à rembourser : <b>${eur2(r.aRembourser)}</b> TTC${r.trop ? ` · <span class="warn-txt">encaissé au-delà du net facturé : ${eur2(r.trop)} TTC (trop-perçu ou facture réémise à rattacher)</span>` : ''}</div>`;
}

/** (v1.70, L2a) Encaissements et remboursements d'une facture émise, sous sa ligne : un mouvement par ligne, source et rapprochement
 *  visibles ; paiement historique lu tel quel (E1) ; saisie manuelle non rapprochée annulable avec motif (jamais effacée, R2) */
function reglementRowsHTML(s, p, booking){
  if (!isInvoiced(p) || !followedInvoice(p, booking)) return '';
  const proj = byId('projects', s.project_id), fiable = htFiable(p);
  const htOf = v => fiable ? ` <span class="muted">(≈ ${eur2(Math.round(v / (1 + (Number(payVat(p)) || 0) / 100) * 100) / 100)} HT)</span>` : '';
  const histo = mouvementsOf(p).find(m => m.historique);
  const rows = reglementsTousOf(p.id).map(r => {
    const quoi = r.sens === 'encaissement' ? 'Encaissement' : r.etat === 'a_faire' ? 'Remboursement à faire' : 'Remboursement fait';
    const src = r.transaction_id ? '<span class="ok-badge">rapproché Pennylane</span>' : r.source === 'manuel' ? '<span class="badge">saisi à la main, non rapproché</span>' : '';
    const etat = r.annule_at ? ` <span class="muted">— annulé le ${fmtDate(String(r.annule_at).slice(0, 10))}${r.annule_par ? ' par ' + esc(r.annule_par) : ''} : ${esc(r.annule_motif || '')}</span>` : '';
    const acts = r.annule_at ? '' : [r.etat === 'a_faire' ? `<button class="btn sm" data-act="reglementFait" data-id="${r.id}">Marquer fait</button>` : '',
      r.source === 'manuel' && !r.transaction_id ? `<button class="btn sm ghost" data-act="reglementAnnuler" data-id="${r.id}">Annuler la saisie</button>` : ''].join(' ');
    return `<tr class="reglement-row${r.annule_at ? ' is-cancelled' : ''}"><td colspan="12">${r.annule_at ? '<s>' : ''}${quoi} <b>${r.sens === 'remboursement' ? '− ' : ''}${eur2(Number(r.montant_ttc))}</b> TTC${htOf(Number(r.montant_ttc))}${r.date ? ` · ${fmtDate(r.date)}` : ''}${r.compte ? ` · ${esc(payerLabel(r.compte, proj))}` : ''}${r.reference ? ` · ${esc(r.reference)}` : ''}${r.motif ? ` · ${esc(r.motif)}` : ''}${r.annule_at ? '</s>' : ''} ${src}${etat} ${acts}</td></tr>`;
  }).join('');
  const trop = tropPercuTtc(p), reste = resteDuTtc(p), rem = aRembourserTtc(p);
  const bilan = `Facturé net : <b>${eur2(factureNetTtc(p))}</b> TTC · Encaissé réel : <b>${eur2(encaisseTtc(p))}</b> TTC · Reste dû : <b>${eur2(reste)}</b> TTC${rem ? ` · Reste à rembourser : <b>${eur2(rem)}</b> TTC` : ''}${trop ? ` · <span class="warn-txt">encaissé au-delà du net facturé : ${eur2(trop)} TTC (trop-perçu ou facture réémise à rattacher)</span>` : ''}`;
  const btns = [!p.paid_at ? `<button class="btn sm" data-act="reglementEncaisser" data-id="${p.id}" title="Encaissement réel reçu (TTC) : date, montant, compte">Ajouter un encaissement</button>` : '',
    `<button class="btn sm ghost" data-act="reglementRembourser" data-id="${p.id}" data-etat="a_faire">Remboursement à faire</button>`,
    `<button class="btn sm ghost" data-act="reglementRembourser" data-id="${p.id}" data-etat="fait">Remboursement fait</button>`].join(' ');
  return `${histo ? `<tr class="reglement-row"><td colspan="12" class="small muted">Paiement noté le ${fmtDate(histo.date)} (avant les encaissements détaillés) : montant de la facture, conservé tel quel</td></tr>` : ''}${rows}
    <tr class="reglement-row"><td colspan="12" class="small">${bilan} <span class="nowrap">${btns}</span></td></tr>`;
}

/** (v1.69) Avoirs que la synchronisation n'a pas rattachés seule : listés en tête de Production (date inconnue ou ambiguë) */
function avoirsPendingHTML(){
  const list = avoirsARattacher(), ecarts = avoirsAVerifier();
  const ecartsHTML = ecarts.length ? `<div class="panel pad mb" id="avoirs-a-verifier" role="status"><p class="help full"><b>Avoir${ecarts.length > 1 ? 's' : ''} à vérifier</b> (${ecarts.length}) : Pennylane indique maintenant une autre facture d’origine que celle du rattachement. Rien n’a été déplacé ; l’écart reste signalé jusqu’à sa résolution.</p>
    ${ecarts.map(a => { const l = byId('show_payments', a.payment_id), sh = l && byId('shows', l.show_id);
      return `<div class="file-row"><span>${esc(a.invoice_number || 'Avoir ' + a.pennylane_id)} · − ${eur2(a.amount_ht)} HT · rattaché à ${esc(l?.invoice_number || l?.label || 'une ligne')}${sh ? ' (' + esc([fmtDate(sh.date), sh.venue].filter(Boolean).join(' ')) + ')' : ''} — <span class="muted">origine indiquée par Pennylane : ${esc(a.credited_invoice_number || a.credited_pennylane_id || 'aucune')}</span></span>
      ${a.url ? `<a class="btn sm ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Voir ↗</a>` : ''}</div>`; }).join('')}</div>` : '';
  if (!list.length) return ecartsHTML;
  return ecartsHTML + `<div class="panel pad mb" id="avoirs-a-rattacher" role="status"><p class="help full"><b>Avoir${list.length > 1 ? 's' : ''} Pennylane à rattacher</b> (${list.length}) : la synchronisation ne sait pas à quelle facture de MATRICE ${list.length > 1 ? 'ils se rapportent' : 'il se rapporte'} (rien n’a été modifié, rien n’est compté).</p>
    ${list.map(a => { const sh = a.show_id && byId('shows', a.show_id);
      return `<div class="file-row"><span>${esc(a.invoice_number || 'Avoir ' + a.pennylane_id)} · − ${eur2(a.amount_ht)} HT${a.invoice_date ? ' · ' + fmtDate(a.invoice_date) : ''}${a.credited_invoice_number ? ' · facture d’origine ' + esc(a.credited_invoice_number) : ''}${sh ? ' · ' + esc([fmtDate(sh.date), sh.venue].filter(Boolean).join(' ')) : ''} — <span class="muted">${esc(a.reason || '')}</span></span>
      ${a.url ? `<a class="btn sm ghost" href="${esc(a.url)}" target="_blank" rel="noopener">Voir ↗</a>` : ''}</div>`; }).join('')}</div>`;
}

/** Factures du devis que la synchronisation n'a pas reliées seule (v1.56.9) : choix explicite de la ligne, rien d'automatique */
function pendingPennylaneHTML(s){
  const list = S.db.pennylane_a_rattacher.filter(r => r.show_id === s.id && !r.resolved_at && !r.cancelled_at);
  if (!list.length) return '';
  return `<div class="mt" role="status"><p class="m0 warn-txt"><b>Facture${list.length > 1 ? 's' : ''} Pennylane à rattacher</b> : la synchronisation ne l’a pas reliée seule (rien n’a été modifié).</p>
    ${list.map(r => `<div class="file-row"><span>${esc(r.invoice_number || 'Facture ' + r.pennylane_id)} · ${eur2(r.amount_ht)} HT${r.invoice_date ? ' · ' + fmtDate(r.invoice_date) : ''} — <span class="muted">${esc(r.reason)}</span></span>
      ${r.url ? `<a class="btn sm ghost" href="${esc(r.url)}" target="_blank" rel="noopener">Voir ↗</a>` : ''}
      <button class="btn sm" data-act="pennylaneAttach" data-pid="${esc(r.pennylane_id)}" data-show="${s.id}">Rattacher…</button></div>`).join('')}</div>`;
}

function pennylaneCell(p, s){
  if (!['acompte','solde','artbo','autre'].includes(p.kind)) return '';
  // acompte / solde relié à une facture du devis : rattachement corrigeable (confirmation, motif, historique ; v1.56.9)
  const fix = ['acompte','solde'].includes(p.kind) && !p.paid_at ? ` <button class="btn sm ghost" data-act="pennylaneAttach" data-pid="${esc(p.pennylane_id)}" data-show="${p.show_id}" title="La facture est sur la mauvaise ligne ? Choisir la bonne (le document Pennylane n’est pas modifié)">Corriger</button>` : '';
  if (p.pennylane_id) return (p.pennylane_url ? `<a class="btn sm ghost" href="${esc(p.pennylane_url)}" target="_blank" rel="noopener">Facture ↗</a>` : '<span class="ok-badge">Facture créée</span>') + fix;
  if (['acompte','solde'].includes(p.kind)){
    if (p.invoice_number) return '';
    return s?.pennylane_quote_id
      ? `<a class="btn sm ghost" href="${esc(s.pennylane_quote_url || 'https://app.pennylane.com/')}" target="_blank" rel="noopener" title="Ouvre le devis dans Pennylane : « Créer une facture d’acompte » (ou la facture de solde). Le numéro revient ici avec « Synchroniser Pennylane ».">Facturer depuis le devis ↗</a>`
      : isCoproduction(s) ? ''   // coproduction : jamais de devis (résultat inconnu), décision du 27/10/2026
      : `<button class="btn sm" data-act="pennylaneQuote" data-id="${p.show_id}" title="L’acompte et le solde se facturent depuis le devis Pennylane">Créer le devis</button>`;
  }
  // facture déjà émise hors Pennylane (numéro, envoi ou paiement noté, ex. ancienne facture) : jamais de second brouillon (§6.3)
  if (isInvoiced(p)) return '<span class="muted small" title="Facture déjà émise (numéro, envoi ou paiement noté) : aucun brouillon Pennylane ne se crée">Facture existante</span>';
  return `<button class="btn sm" data-act="pennylaneInvoice" data-id="${p.id}" title="Crée la facture en brouillon dans Pennylane">Créer</button>`;
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
