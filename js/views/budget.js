/**
 * Budget dans l'onglet Production : le budget de chaque date (prévu / réel, pièces, qui paie)
 * et la vue d'ensemble d'un artiste (compte dédié, toutes les dates, frais hors date).
 */
import { accountMoves, accountOf, availableForArtist, commissionAmount, commissionOf, isFree, isSolde, lineForecast, lineStatus, lineValue, linesOf, offLinesOf, payerLabel, payslipCost, prodShowsOf, showBudget } from '../budget.js';
import { BUDGET_CATS, PAYERS } from '../constants.js';
import { commissionState, payAmount, paymentsOf } from '../calc.js';
import { byId } from '../selectors.js';
import { S } from '../state.js';
import { cIn, cSel } from '../ui/cells.js';
import { esc, eur2, fmtDate, today, r2, pct as fmtPct } from '../utils.js';
import { PROD_CATS, isProductionShow, productionBudget } from '../production-budget.js';

const STATUS = {paid:['Payé','ok-badge'], doc:['Pièce reçue','warn-badge'], planned:['Prévu','badge']};
const badge = l => { const [t,c] = STATUS[lineStatus(l)]; return `<span class="${c}">${t}</span>`; };
const money = (v, cls='') => `<span class="num nowrap ${cls}">${eur2(v)}</span>`;

function lineRow(l, project, {qtyAll = false} = {}){
  const fc = lineForecast(l), staff = l.category === 'Staff' || (qtyAll && !l.auto), auto = !!l.auto, st = lineStatus(l);
  const payers = PAYERS.map(c => [c, payerLabel(c, project)]);
  const hasQty = staff && l.forecast == null;
  const prev = staff && hasQty
    ? `<span class="qty-line">${cIn('budget_lines', l.id, 'qty', l.qty, 'number', `class="narrow" title="${qtyAll ? 'Quantité' : 'Nombre de bulletins'}" placeholder="${qtyAll ? 'qté' : 'nb'}"`)}<span class="x">×</span>${cIn('budget_lines', l.id, 'unit_cost', l.unit_cost, 'number', `class="narrow2" title="${qtyAll ? 'Prix unitaire HT' : 'Coût employeur d’un bulletin'}" placeholder="${qtyAll ? 'P.U.' : 'coût'}"`)}<b>${eur2(fc ?? 0)}</b></span>`
    : `<input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="forecast" value="${l.forecast??''}" placeholder="${fc==null?'à saisir':fc}" class="${auto && l.forecast!=null?'override':''}" title="${auto ? (l.forecast!=null ? 'Montant saisi à la main à la place du calcul automatique (efface-le pour revenir au calcul)' : 'Vide = calcul automatique') : 'Montant prévu HT'}">`;
  const calc = l.auto==='movinmotion' ? 'bulletins × coût Movinmotion' : l.auto==='cnm' ? '% du cachet (entrée gratuite)' : '';
  return `<tr data-budget-line="${l.id}" class="${st==='paid'?'is-paid':st==='doc'?'has-doc':''}" title="${st==='paid'?'Payé':st==='doc'?'Pièce reçue, pas encore payée':'Prévu'}">
    <td>${cSel('budget_lines', l.id, 'category', l.category, BUDGET_CATS)}</td>
    <td>${cIn('budget_lines', l.id, 'label', l.label, 'text', 'placeholder="Libellé"')}${calc?`<div class="muted calc-note">calcul : ${calc}</div>`:''}</td>
    <td>${cIn('budget_lines', l.id, 'supplier', l.supplier, 'text', `placeholder="${staff?'Salarié':'Fournisseur'}"`)}</td>
    <td>${cSel('budget_lines', l.id, 'payer', l.payer || 'compte', payers, false)}</td>
    <td class="num">${prev}</td>
    <td class="num"><input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="amount" value="${l.amount??''}" placeholder="—" title="${staff?'Coût total (bulletin)':'Montant réel HT (pièce)'}"></td>
    <td class="nowrap">${l.file_path ? `<button class="btn icon sm" data-act="openBudgetFile" data-id="${l.id}" title="${esc(l.file_name||'Pièce')}" aria-label="Ouvrir la pièce">📎</button>` : ''}${l.drive_file_id ? `<a class="btn icon sm" href="https://drive.google.com/file/d/${esc(l.drive_file_id)}/view" target="_blank" rel="noopener" title="Rangée dans le Drive de la date" aria-label="Ouvrir dans le Drive">▲</a>` : ''}${cIn('budget_lines', l.id, 'doc_number', l.doc_number, 'text', 'placeholder="N° pièce" class="doc-no"')}</td>
    <td class="${l.paid_at?'done-cell':''}">${cIn('budget_lines', l.id, 'paid_at', l.paid_at, 'date')}${['artbo', 'autre'].includes(l.payer) && l.paid_at ? `<div class="reimb ${l.reimbursed_at?'done-cell':''}" title="${esc(payerLabel(l.payer, project))} a avancé cette dépense : date à laquelle ${esc(payerLabel('compte', project))} l’a remboursée"><span class="muted">remboursé à ${esc(payerLabel(l.payer, project))} le</span>${cIn('budget_lines', l.id, 'reimbursed_at', l.reimbursed_at, 'date')}</div>` : ''}</td>
    <td><button class="btn icon sm ghost danger" data-act="delBudgetLine" data-id="${l.id}" aria-label="Supprimer la ligne">✕</button></td>
  </tr>`;
}

/**
 * Lignes rangées par catégorie (dans l'ordre des catégories du budget), avec un sous-total par catégorie ;
 * une ligne qui change de catégorie va d'elle-même au bon endroit. Dans une catégorie : l'ordre d'ajout.
 */
function byCategory(lines, project){
  const order = c => { const i = BUDGET_CATS.indexOf(c || 'Autres'); return i < 0 ? BUDGET_CATS.length : i; };
  const groups = new Map();
  for (const l of lines.slice().sort((a, b) => order(a.category) - order(b.category))) { const c = l.category || 'Autres'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(l); }
  return [...groups].map(([c, ls]) => { const f = ls.reduce((t, l) => t + (lineForecast(l) ?? (Number(l.amount) || 0)), 0), r = ls.reduce((t, l) => t + lineValue(l), 0);
    return `<tr class="cat-row"><td colspan="9"><b>${esc(c)}</b> <span class="muted">· prévu ${eur2(f)} · à jour ${eur2(r)}</span></td></tr>` + ls.map(l => lineRow(l, project)).join(''); }).join('');
}

const HEAD = '<thead><tr><th>Catégorie</th><th>Libellé</th><th>Fournisseur</th><th>Payé par</th><th class="num col-prev">Prévu HT</th><th class="num col-real">Réel HT</th><th>Pièce</th><th>Payé le</th><th></th></tr></thead>';

function dropZone(attrs, text){
  return `<div class="dropzone budget-drop" ${attrs}>
    <label class="btn sm file-btn">Ajouter une pièce<input class="file-input" type="file" multiple accept="application/pdf,image/*" ${attrs.replace('data-budget-drop','data-budget-pick')}></label>
    <span class="drop-hint">${text}</span></div>`;
}

/**
 * Résumé lisible : prévu / réel / écart. Une seule logique sur toutes les lignes :
 *  - « Réel » = ce qu'on sait aujourd'hui : le montant réel quand il est connu, sinon le prévu (encore estimé) ;
 *  - « Écart » = seulement ce qui a vraiment changé (réel connu − son prévu) ;
 *  - le reste pour l'artiste se calcule avec les mêmes chiffres, donc il tombe juste avec les lignes du dessus.
 */
/** Commission de production (lot D1) : total, déjà transféré, reste — même texte dans le budget, l'onglet Factures et l'export */
export function commissionStatus(com){
  if (!com) return 'pas encore versée';
  const st = commissionState(com), dates = st.transfers.map(t => fmtDate(t.transferred_at));
  if (st.legacy) return `versée le ${fmtDate(com.paid_at)}`;
  if (st.full) return st.transfers.length > 1 ? `versée en ${st.transfers.length} fois (${dates.join(', ')})` : `versée le ${dates[0]}`;
  if (st.partial) return `versée en partie : ${eur2(st.transferred)} transférés (${dates.join(', ')}), reste ${eur2(st.remaining)} à transférer`;
  return 'pas encore versée';
}
/** Cellule « versement » d'une commission de production : historique des versements + bouton pour noter le suivant */
export function commissionTransferCell(com){
  if (!com) return '<span class="muted">—</span>';
  const st = commissionState(com);
  const list = st.transfers.map(t => `<div class="nowrap" title="${esc([t.reference, t.note].filter(Boolean).join(' · '))}">${eur2(Number(t.amount))} · ${fmtDate(t.transferred_at)}${t.reference ? ' · ' + esc(t.reference) : ''}</div>`).join('');
  const legacy = st.legacy ? `<div class="nowrap">${eur2(st.total)} · ${fmtDate(com.paid_at)}</div>` : '';
  const btn = st.remaining >= 0.005 && !st.legacy ? `<button class="btn sm" data-act="addTransfer" data-id="${com.id}" title="Noter un virement réel vers L’ArtBo (date, montant, référence)">Noter un versement</button>` : '';
  return `${legacy}${list}${btn}`;
}

function summaryTable(s, b, com, p){
  const exp = b.lines.filter(l => !isSolde(l)), real = exp.filter(l => l.amount != null), est = exp.filter(l => l.amount == null);
  const realSum = real.reduce((t, l) => t + Number(l.amount), 0), estSum = est.reduce((t, l) => t + (lineForecast(l) || 0), 0);
  const expNow = r2(realSum + estSum), expGap = r2(real.reduce((t, l) => t + Number(l.amount) - (lineForecast(l) ?? Number(l.amount)), 0));
  const cashedRows = paymentsOf(s.id).filter(x => ['acompte', 'solde'].includes(x.kind) && x.paid_at);
  const cashed = cashedRows.reduce((t, x) => t + (payAmount(x) || 0), 0);
  // part encaissée sans compte d'encaissement (§6.6, Q6, M9) : comptée dans la date, signalée ; aucun total changé
  const unassigned = r2(cashedRows.filter(x => !x.payee).reduce((t, x) => t + (payAmount(x) || 0), 0));
  const gapCell = (g, cost) => `<td class="num nowrap ${Math.abs(g) < 0.01 ? 'muted' : (g > 0) === cost ? 'neg' : 'pos'}">${Math.abs(g) < 0.01 ? eur2(0) : (g > 0 ? '+' : '') + eur2(g)}</td>`;
  const row = (label, f, r, gap, help, {cost = false, strong = false} = {}) => `<tr class="${strong ? 'bill-total' : ''}"><td>${strong ? `<b>${label}</b>` : label}${help ? `<div class="muted tiny">${help}</div>` : ''}</td>
      <td class="num nowrap">${strong ? `<b>${eur2(f)}</b>` : eur2(f)}</td><td class="num nowrap">${strong ? `<b>${eur2(r)}</b>` : eur2(r)}</td>${gapCell(gap, cost)}</tr>`;
  const resteF = r2(b.fee - b.com - b.forecastExp), resteR = r2(b.fee - b.com - expNow);
  return `<div class="tbl-wrap"><table class="budget-sum"><thead><tr><th></th><th class="num">Prévu</th><th class="num" title="Montant réel quand il est connu, sinon le prévu">Réel / à jour</th><th class="num">Écart</th></tr></thead><tbody>
    ${row('Cachet HT', b.fee, b.fee, 0, (cashed >= b.fee - 0.01 && b.fee ? 'entièrement encaissé' : `encaissé : ${eur2(cashed)} sur ${eur2(b.fee)}`) + (unassigned ? ` · dont ${eur2(unassigned)} — compte non renseigné` : ''))}
    ${row('Commission L’ArtBo', b.com, b.com, 0, commissionStatus(com), {cost: true})}
    ${row('Dépenses', b.forecastExp, expNow, expGap, !exp.length ? 'aucune ligne' : est.length ? `${eur2(realSum)} réels (${real.length} ligne${real.length > 1 ? 's' : ''}) + ${eur2(estSum)} encore au prévu (${est.length} ligne${est.length > 1 ? 's' : ''})` : 'toutes les lignes ont leur montant réel', {cost: true})}
    ${row('Reste pour l’artiste' + (p?.artist_payee ? ` (${esc(p.artist_payee)})` : ''), resteF, resteR, r2(resteR - resteF), est.length ? `cachet − commission − dépenses · encore provisoire : ${est.length} dépense${est.length > 1 ? 's' : ''} au prévu` : 'cachet − commission − dépenses · définitif', {strong: true})}
  </tbody></table></div>
  <p class="muted" style="font-size:12px;margin:6px 0 12px">Pièces reçues : ${b.docsIn}/${b.docsAll} · ${b.paid} payées.</p>`;
}

/**
 * Résultat : ce qui reste pour l'artiste (calculé, jamais saisi) et ce qui lui a été versé.
 * Écart vu de L'ArtBo : reste calculé − versé (négatif = versé plus que le reste, on perd de l'argent ; positif = on en garde).
 */
export function artistResult(s, b = showBudget(s)){
  const sl = b.lines.filter(isSolde), reste = r2(availableForArtist(s));
  // versé = montant saisi ET date de versement ; un montant sans date = connu, encore à verser
  const known = sl.filter(l => l.amount != null), paid = known.filter(l => l.paid_at);
  const verse = r2(paid.reduce((t, l) => t + Number(l.amount), 0)), todo = r2(known.filter(l => !l.paid_at).reduce((t, l) => t + Number(l.amount), 0));
  return {reste, verse, todo, hasVerse: paid.length > 0, ecart: known.length ? r2(reste - verse - todo) : null, lines: sl};
}
export const ecartHTML = e => e == null ? '<span class="muted">—</span>' : Math.abs(e) < 0.01 ? '<span class="muted">0,00 €</span>'
  : `<b style="color:var(--${e < 0 ? 'danger' : 'ok'})">${e > 0 ? '+' : ''}${eur2(e)}</b>`;

function artistBlock(s, b, p){
  const r = artistResult(s, b), who = p?.artist_payee || 'l’artiste';
  const payers = PAYERS.map(c => [c, payerLabel(c, p)]);
  const rows = r.lines.map(l => `<tr data-budget-line="${l.id}" class="${l.paid_at ? 'is-paid' : ''}">
      <td>${cIn('budget_lines', l.id, 'supplier', l.supplier, 'text', `placeholder="${esc(p?.artist_payee || 'Bénéficiaire')}"`)}</td>
      <td class="num"><input type="number" step="any" data-t="budget_lines" data-id="${l.id}" data-f="amount" value="${l.amount ?? ''}" placeholder="${esc(String(r.reste))}" title="Montant réellement versé (HT)"></td>
      <td class="${l.paid_at ? 'done-cell' : ''}">${cIn('budget_lines', l.id, 'paid_at', l.paid_at, 'date')}</td>
      <td>${cSel('budget_lines', l.id, 'payer', l.payer || 'compte', payers, false)}${(l.payer || 'compte') !== 'compte' && l.paid_at ? `<div class="reimb ${l.reimbursed_at ? 'done-cell' : ''}"><span class="muted">Déduit du compte le</span>${cIn('budget_lines', l.id, 'reimbursed_at', l.reimbursed_at, 'date')}</div>` : ''}</td>
      <td class="nowrap">${l.file_path ? `<button class="btn icon sm" data-act="openBudgetFile" data-id="${l.id}" title="${esc(l.file_name||'Pièce')}" aria-label="Ouvrir la pièce">📎</button>` : ''}${l.drive_file_id ? `<a class="btn icon sm" href="https://drive.google.com/file/d/${esc(l.drive_file_id)}/view" target="_blank" rel="noopener" title="Rangée dans le Drive de la date" aria-label="Ouvrir dans le Drive">▲</a>` : ''}${cIn('budget_lines', l.id, 'doc_number', l.doc_number, 'text', 'placeholder="N° facture" style="min-width:80px"')}</td>
      <td><button class="btn icon sm ghost danger" data-act="delBudgetLine" data-id="${l.id}" aria-label="Supprimer ce versement">✕</button></td></tr>`).join('');
  return `<div class="artist-result">
    <h4 class="block-title">Reste pour ${esc(who)}</h4>
    <div class="ar-grid">
      <div class="stat"><b>${eur2(r.reste)}</b><span>calculé : cachet ${eur2(b.fee)} − commission ${eur2(b.com)} − dépenses ${eur2(b.expenses)}</span></div>
      <div class="stat"><b>${r.hasVerse ? eur2(r.verse) : '—'}</b><span>versé à ${esc(who)}${r.todo ? ` · <b>${eur2(r.todo)}</b> encore à verser (pas de date)` : ''}</span></div>
      <div class="stat"><b>${ecartHTML(r.ecart)}</b><span>${r.ecart == null ? 'écart : quand le versement est noté' : r.ecart < -0.005 ? 'écart pour toi : versé plus que le reste, tu perds' : r.ecart > 0.005 ? 'écart pour toi : versé moins que le reste, tu gagnes' : 'écart pour toi : juste'}</span></div>
    </div>
    ${r.lines.length ? `<div class="tbl-wrap"><table class="budget-table"><thead><tr><th>Versé à</th><th class="num">Montant versé HT</th><th>Versé le</th><th>Payé par</th><th>Facture</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <div class="vh-actions mt-sm">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Solde artiste">${r.lines.length ? 'Ajouter un versement' : 'Noter le versement'}</button>
      <button class="btn sm ghost" data-act="exportArtistBudget" data-id="${s.id}">Exporter pour ${esc(who)}</button>
    </div>
  </div>`;
}

/** Budget d'une date (dans la date dépliée) */
export function showBudgetHTML(s){
  const p = byId('projects', s.project_id), b = showBudget(s), com = commissionOf(s);
  const cst = com ? commissionState(com) : null;
  const comRow = `<tr class="${cst?.full || cst?.legacy ? 'is-paid' : ''}"><td><b>Commission</b></td><td><span>Commission L'ArtBo</span> ${com?.amount != null && com.amount !== '' ? `<span class="muted" title="Montant saisi à la main dans Factures">(montant saisi)</span>` : com?.pct != null && com.pct !== '' ? cIn('show_payments', com.id, 'pct', com.pct, 'number', 'class="narrow" title="% de commission sur cette date"') : cIn('shows', s.id, 'artbo_pct', s.artbo_pct, 'number', 'class="narrow" title="% de commission sur cette date"')} %</td><td>L'ArtBoristerie</td><td>${esc(payerLabel('compte', p))}</td>
    <td class="num">${money(commissionAmount(s))}</td><td class="num">${cst && (cst.transferred || cst.remaining) ? eur2(cst.transferred) : '—'}</td><td class="muted">${cst?.full || cst?.legacy ? 'versée' : cst?.partial ? `reste ${eur2(cst.remaining)} à te verser` : 'à te verser'}</td>
    <td class="${cst?.full || cst?.legacy ? 'done-cell' : ''}">${commissionTransferCell(com)}</td><td></td></tr>`;
  return `<div class="prod-budget">

    ${summaryTable(s, b, com, p)}
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${comRow}${byCategory(b.lines.filter(l => !isSolde(l)), p)}</tbody></table></div>
    <div class="vh-actions mt">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}">Ajouter une dépense</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Staff">Ajouter un salarié</button>
      ${b.lines.length ? '' : `<button class="btn sm primary" data-act="prefillBudget" data-id="${s.id}">Préremplir (budget type)</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture, un bulletin ou une note de frais (ou sur une ligne précise) : l’IA la lit, met la ligne à jour et la range dans le Drive de la date (02_Finance). La date de paiement se note à part : une pièce reçue n’est pas une dépense payée.')}
    ${artistBlock(s, b, p)}
    <p class="muted small mt-sm">Montants HT ; salaires en coût total. Ligne verte : payée ; jaune : pièce reçue, pas encore payée. Prévu en orange : montant tapé à la place du calcul automatique (Movinmotion, CNM) ; efface-le pour revenir au calcul.</p>
  </div>`;
}

/**
 * Date produite par L'ArtBo (contrat Production / Co-Production) dans le tableau de l'artiste : son budget est un PRÉVISIONNEL
 * à part (recettes, dépenses, répartition selon l'accord). Aucun « reste artiste » n'est calculé ici ; seuls les montants
 * réalisés s'affichent (dépenses payées, versements réellement faits à l'artiste). Hors compte dédié (accountOf), hors totaux.
 */
function ownProdRow(s, b, missing){
  const paidExp = r2(b.lines.filter(l => !isSolde(l) && (l.paid_at || l.reimbursed_at)).reduce((t, l) => t + lineValue(l), 0));
  const ar = artistResult(s, b), kind = s.contract_type === 'Co-Production' ? 'Coproduction' : 'Production';
  const dash = t => `<td class="num muted" title="${t}">—</td>`;
  return `<tr class="own-prod-row"><td class="nowrap"><a href="#" data-act="openProdShow" data-id="${s.id}">${fmtDate(s.date)}</a></td><td>${esc(s.venue||'')}${s.city?` <span class="muted">(${esc(s.city)})</span>`:''} <span class="badge" title="Budget de production à part (onglet Budget de la date) : prévisionnel, répartition selon l’accord">${kind}</span></td>
      ${dash('Pas de cession facturée par L’ArtBo à l’organisateur sur cette date')}${dash('Pas de commission calculée : répartition selon l’accord')}
      <td class="num nowrap" title="Dépenses réellement payées ; le prévisionnel est dans le budget de la date">${eur2(paidExp)} <span class="muted tiny">payées</span></td>
      ${dash('Pas de reste calculé : la part de l’artiste suit l’accord de production')}<td class="num">${ar.hasVerse ? eur2(ar.verse) : '<span class="muted">—</span>'}</td>
      ${dash('Pas d’écart calculé sans reste prévu')}<td class="${missing?'late-cell':''}">${b.lines.length ? `${b.docsIn}/${b.docsAll}${missing?' ⚠︎':''}` : '<span class="muted">—</span>'}</td></tr>`;
}

/** Vue d'ensemble d'un artiste : compte dédié + toutes ses dates en production + frais hors date */
export function projectBudgetHTML(projectId){
  const p = byId('projects', projectId); if (!p) return '';
  const shows = prodShowsOf(projectId); if (!shows.length) return '';
  const open = S.openBudget?.has(projectId);
  const a = accountOf(projectId);
  const head = `<button class="btn sm ${open?'':'primary'}" data-act="toggleProjBudget" data-id="${projectId}" aria-expanded="${!!open}">${open?'Masquer le budget':'Budget et compte'}</button>
    ${p.account_name ? `<span class="badge" title="Solde réel du compte : encaissé − payé">${esc(p.account_name)} : <b>${eur2(a.real)}</b></span>` : ''}`;
  if (!open) return `<div class="proj-budget-bar">${head}</div>`;
  const rows = shows.map(s => { const b = showBudget(s); const now = today();
    const missing = s.date && s.date < now && b.docsIn < b.docsAll;
    if (isProductionShow(s)) return ownProdRow(s, b, missing);
    return `<tr><td class="nowrap"><a href="#" data-act="openProdShow" data-id="${s.id}">${fmtDate(s.date)}</a></td><td>${esc(s.venue||'')}${s.city?` <span class="muted">(${esc(s.city)})</span>`:''}</td>
      <td class="num">${eur2(b.fee)}</td><td class="num">${eur2(b.com)}</td><td class="num">${eur2(b.expenses)}</td><td class="num"><b>${eur2(b.available)}</b></td><td class="num">${(r => r.hasVerse ? eur2(r.verse) : '<span class="muted">—</span>')(artistResult(s, b))}</td>
      ${b.lines.length ? `<td class="num nowrap">${ecartHTML(artistResult(s, b).ecart)}</td>
      <td class="${missing?'late-cell':''}">${b.docsIn}/${b.docsAll}${missing?' ⚠︎':''}</td>` : '<td class="num muted">—</td><td><span class="warn-badge">Budget à faire</span></td>'}</tr>`; }).join('');
  // dates produites par L'ArtBo (Production / Co-Production) : budget prévisionnel à part, hors totaux du cachet ; seul le versé réel compte
  const tot = shows.reduce((t,s) => { const b = showBudget(s), ar = artistResult(s, b); t.solde += ar.verse; if (isProductionShow(s)) { t.own++; return t; }
    ['fee','com','expenses','available'].forEach(k => t[k] += b[k]); if (ar.ecart != null) t.result += ar.ecart; return t; }, {fee:0,com:0,expenses:0,available:0,solde:0,result:0,own:0});
  const off = offLinesOf(projectId);
  const cats = Object.entries(a.byCat).filter(([,v]) => Math.abs(v) >= 0.01).sort((x,y) => y[1]-x[1]);
  return `<div class="proj-budget panel">
    <div class="proj-budget-bar">${head}</div>
    ${!p.account_name ? `<p class="help mb">Pas de compte dédié pour cet artiste : les cessions arrivent sur un compte de L’ArtBoristerie, qui y garde sa commission. Aucun solde de compte artiste n’est calculé (lot D1).</p>` : `<div class="stat-row">
      <div class="stat"><b>${eur2(a.real)}</b><span>${esc(p.account_name)} : solde réel</span></div>
      <div class="stat"><b>${eur2(a.inTodo)}</b><span>Cachets encore à recevoir (HT)</span></div>
      <div class="stat"><b>${eur2(a.outTodo)}</b><span>Encore à payer par le compte</span></div>
      <div class="stat"><b>${eur2(a.end)}</b><span>Solde prévu en fin de tournée</span></div>
      ${a.artboAdvance ? `<div class="stat"><b style="color:var(--warn)">${eur2(a.artboAdvance)}</b><span>Avancé par L'ArtBo, pas encore remboursé par le compte</span></div>` : ''}
      ${a.unassignedDone || a.unassignedTodo ? `<div class="stat" title="Acomptes et soldes dont le compte d’encaissement (« Arrive sur ») n’est pas renseigné : comptés dans les dates et l’artiste, mais dans aucun compte tant qu’il n’est pas choisi (onglet Factures de la date)"><b>${eur2(a.unassignedDone)}</b><span>Compte non renseigné : encaissé${a.unassignedTodo ? ` · ${eur2(a.unassignedTodo)} à recevoir` : ''}</span></div>` : ''}
    </div>
    ${(() => { const mv = accountMoves(projectId); return mv.length ? `<details class="acc-moves"><summary>Détail des ${mv.length} mouvements du compte (à pointer avec le relevé de la banque)</summary>
      <div class="tbl-wrap"><table class="budget-table"><thead><tr><th>Date</th><th>Mouvement</th><th class="num">Entrée</th><th class="num">Sortie</th><th class="num">Solde</th></tr></thead><tbody>
      ${mv.map(m => `<tr><td class="nowrap">${fmtDate(m.date)}</td><td>${esc(m.label)}${m.calc ? ' <span class="muted" title="Pas de montant saisi : calculé à partir du pourcentage ou du prévu">(calculé)</span>' : ''}</td>
        <td class="num nowrap">${m.amount > 0 ? eur2(m.amount) : ''}</td><td class="num nowrap">${m.amount < 0 ? eur2(-m.amount) : ''}</td><td class="num nowrap">${eur2(m.balance)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Comptés : acomptes et soldes notés payés (encaissés sur le compte), commissions L’ArtBo virées, dépenses payées par le compte, avances remboursées par le compte. « (calculé) » : aucun montant saisi, c’est le pourcentage ou le prévu qui est utilisé.</p></details>` : ''; })()}`}
    <div class="steps" style="max-width:640px;margin-bottom:12px">
      <label>Nom du compte dédié</label>${cIn('projects', p.id, 'account_name', p.account_name, 'text', 'placeholder="ex. Compte The Locos L’ArtBo (vide = pas de compte dédié)"')}
      <label>Solde de départ du compte</label>${cIn('projects', p.id, 'account_opening', p.account_opening, 'number', 'class="narrow" placeholder="0"')}
      <label>Le solde artiste est versé à</label>${cIn('projects', p.id, 'artist_payee', p.artist_payee, 'text', 'placeholder="ex. Pipi"')}
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th class="num">Cachet HT</th><th class="num">Commission</th><th class="num">Dépenses</th><th class="num">Reste artiste</th><th class="num">Versé à l’artiste</th><th class="num" title="Reste calculé − versé : négatif = tu perds, positif = tu gagnes">Écart pour toi</th><th>Pièces</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td colspan="2"><b>Total (${shows.length} dates)</b>${tot.own ? `<div class="muted tiny">dont ${tot.own} en production / coproduction : hors totaux du cachet, de la commission, des dépenses et du reste (budget prévisionnel à part) ; seul le versé réel est compté</div>` : ''}</td><td class="num"><b>${eur2(tot.fee)}</b></td><td class="num"><b>${eur2(tot.com)}</b></td><td class="num"><b>${eur2(tot.expenses)}</b></td><td class="num"><b>${eur2(tot.available)}</b></td><td class="num"><b>${eur2(tot.solde)}</b></td><td class="num nowrap">${ecartHTML(r2(tot.result))}</td><td></td></tr></tbody></table></div>
    <p class="muted" style="font-size:13px;margin:6px 0 14px">Dépenses par catégorie : ${cats.map(([k,v]) => `${esc(k)} <b>${eur2(v)}</b>`).join(' · ') || '—'} · coût moyen par date : <b>${eur2(shows.length - tot.own ? (tot.com + tot.expenses) / (shows.length - tot.own) : 0)}</b></p>
    <h3 class="block-title">Frais hors date (affiches, avances…)</h3>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${off.map(l => lineRow(l, p)).join('') || '<tr><td colspan="9" class="muted">Aucun frais hors date.</td></tr>'}</tbody></table></div>
    <div class="vh-actions mt"><button class="btn sm" data-act="addBudgetLine" data-project="${p.id}">Ajouter un frais hors date</button></div>
    ${dropZone(`data-budget-drop='${JSON.stringify({project_id:p.id})}'`, 'Glisse ici une pièce hors date : l’IA la lit et l’ajoute.')}
  </div>`;
}


// ─────────────── Budget de production (contrat Production / Co-Production) ───────────────

const pin = (s, path, v, extra = '') => `<input type="${/label/.test(path) ? 'text' : 'number'}" ${/label/.test(path) ? '' : 'step="any" inputmode="decimal"'} data-prod-show="${s.id}" data-prod-path="${path}" value="${esc(v ?? '')}" ${extra}>`;
const pct = v => v == null ? '—' : fmtPct(Math.round(v * 1000) / 10);   // taux 0–1 affiché « 87,5 % » (format officiel §2.4)
const two = (f, r, cls = '') => `<td class="num nowrap ${cls}">${eur2(f)}</td><td class="num nowrap ${cls}">${r == null ? '—' : eur2(r)}</td>`;

/** Budget d'une date produite par L'ArtBo : billetterie, droits et taxes, coûts, résultat partagé avec le coproducteur */
export function productionBudgetHTML(s){
  const proj = byId('projects', s.project_id), f = productionBudget(s), r = productionBudget(s, true), p = f.p;
  const hasReal = p.tickets.some(t => t.real_qty != null && t.real_qty !== '');
  const R = v => hasReal ? v : null;
  const lines = linesOf(s.id);
  const cats = [...PROD_CATS, ...new Set(lines.map(l => l.category).filter(c => c && !PROD_CATS.includes(c)))];
  const tickets = p.tickets.map((t, i) => `<tr>
      <td>${pin(s, `tickets.${i}.label`, t.label, 'placeholder="Tarif (ex. Prévente)"')}</td>
      <td class="num">${pin(s, `tickets.${i}.qty`, t.qty, 'class="narrow"')}</td>
      <td class="num">${pin(s, `tickets.${i}.price`, t.price, 'class="narrow" title="Prix TTC"')}</td>
      <td class="num">${pin(s, `tickets.${i}.dl_prod`, t.dl_prod, 'class="narrow" title="Droit de location producteur (par billet)"')}</td>
      <td class="num">${pin(s, `tickets.${i}.dl_net`, t.dl_net, 'class="narrow" title="Droit de location réseau (par billet)"')}</td>
      <td class="num nowrap">${eur2((Number(t.price) || 0) + (Number(t.dl_prod) || 0) + (Number(t.dl_net) || 0))}</td>
      <td class="num nowrap">${eur2(f.tickets[i].gross)}</td>
      <td class="num">${pin(s, `tickets.${i}.real_qty`, t.real_qty, 'class="narrow" placeholder="—" title="Billets vendus (réel)"')}</td>
      <td class="num nowrap">${t.real_qty == null || t.real_qty === '' ? '—' : eur2(r.tickets[i].gross)}</td>
      <td><button class="btn icon sm ghost danger" data-act="prodDelTicket" data-id="${s.id}" data-i="${i}" aria-label="Retirer ce tarif">✕</button></td></tr>`).join('');
  const taxRow = (label, key, fv, rv, help) => `<tr><td>${label}</td><td class="num">${key ? pin(s, key, p[key], `class="narrow" title="${help || '%'}"`) + ' %' : ''}</td>${two(fv, R(rv))}</tr>`;
  return `<div class="prod-budget prod-production">
    <h3 class="block-title">Budget de production <span class="badge tag">${esc(s.contract_type)}</span></h3>
    <div class="stat-row budget-stats">
      <div class="stat"><b>${eur2(f.ht)}</b><span>Recette billetterie HT (prévu)${hasReal ? ` · réel ${eur2(r.ht)}` : ''}</span></div>
      <div class="stat"><b>${eur2(f.taxes)}</b><span>Droits et taxes</span></div>
      <div class="stat"><b>${eur2(f.costs + f.promo)}</b><span>Coûts${f.promo ? ' + promo locale' : ''}</span></div>
      <div class="stat"><b style="${f.resultDl < 0 ? 'color:var(--danger)' : ''}">${eur2(f.resultDl)}</b><span>Résultat DL inclus (prévu)${hasReal || lines.some(l => l.amount != null) ? ` · réel ${eur2(r.resultDl)}` : ''}</span></div>
      <div class="stat"><b>${pct(f.fill)}</b><span>Remplissage (${f.total} / ${f.capacity || '?'} places)</span></div>
    </div>

    <div class="steps prod-params">
      <label>Jauge (fiche de la date)</label>${cIn('shows', s.id, 'capacity', s.capacity, 'number', 'class="narrow"')}
      <label>Représentations</label>${pin(s, 'reps', p.reps, 'class="narrow"')}
      <label>TVA billetterie (%)</label>${pin(s, 'vat', p.vat, 'class="narrow"')}
      ${s.contract_type === 'Co-Production' || s.partner_id ? `<label>Part de L’ArtBo (%)</label><span>${pin(s, 'artbo_share', p.artbo_share, 'class="narrow"')} <span class="muted">· ${esc(f.partnerName)} : ${esc(fmtPct(100 - (Number(p.artbo_share) || 0)))}</span></span>` : ''}
    </div>

    <h4 class="block-title">Recettes : billetterie</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th>Tarif</th><th class="num">Billets prévus</th><th class="num">Prix TTC</th><th class="num">DL prod</th><th class="num">DL réseau</th><th class="num">Prix public</th><th class="num">Total prévu TTC</th><th class="num">Billets vendus</th><th class="num">Total réel TTC</th><th></th></tr></thead>
      <tbody>${tickets}
        <tr><td>Invitations</td><td class="num">${pin(s, 'invitations', p.invitations, 'class="narrow"')}</td><td colspan="5"></td><td class="num">${pin(s, 'real_invitations', p.real_invitations, 'class="narrow" placeholder="—"')}</td><td colspan="2"></td></tr></tbody>
      <tfoot><tr class="bill-total"><td><b>Total</b></td><td class="num"><b>${f.paying}</b> payants</td><td colspan="4" class="muted">prix moyen ${eur2(f.avgPrice)}</td><td class="num nowrap"><b>${eur2(f.grossTtc)}</b></td><td class="num">${hasReal ? `<b>${r.paying}</b>` : '—'}</td><td class="num nowrap">${hasReal ? `<b>${eur2(r.grossTtc)}</b>` : '—'}</td><td></td></tr></tfoot></table></div>
    <div class="vh-actions mt-sm mb"><button class="btn sm" data-act="prodAddTicket" data-id="${s.id}">Ajouter un tarif</button></div>

    <h4 class="block-title">Droits et taxes</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette TTC</td><td></td>${two(f.grossTtc, R(r.grossTtc))}</tr>
      <tr><td>TVA</td><td class="num">${esc(fmtPct(p.vat))}</td>${two(f.vatAmount, R(r.vatAmount))}</tr>
      <tr><td><b>Recette HT</b></td><td></td>${two(f.ht, R(r.ht), 'strong')}</tr>
      ${taxRow('Taxe CNM', 'cnm_pct', f.cnm, r.cnm, '% de la recette HT')}
      ${taxRow('SACEM + AGESSA', 'sacem_pct', f.sacem, r.sacem, '% de la recette HT ; AGESSA ' + p.agessa_pct + ' % des droits')}
      ${taxRow('SACD + CR + AGESSA', 'sacd_pct', f.sacd, r.sacd, '% de la recette HT (0 si pas de SACD)')}
      ${taxRow('SACD mise en scène', 'sacd_ms_pct', f.sacdMs, r.sacdMs, '% de la recette HT (0 si pas de mise en scène)')}
      <tr><td>AGESSA (sur les droits)</td><td class="num">${pin(s, 'agessa_pct', p.agessa_pct, 'class="narrow"')} %</td><td colspan="2" class="muted">compris dans les lignes SACEM / SACD</td></tr>
      <tr class="bill-total"><td><b>Recette nette de droits et taxes</b></td><td class="muted">${eur2(f.netPerTicket)} / billet</td>${two(f.net, R(r.net), 'strong')}</tr>
      <tr><td>Droits de location producteur (HT)</td><td></td>${two(f.dlHt, R(r.dlHt))}</tr>
    </tbody></table></div>

    <h4 class="block-title">Coûts de production</h4>
    <div class="tbl-wrap"><table class="budget-table">${HEAD}<tbody>${cats.map(c => { const ls = lines.filter(l => (l.category || 'Autres') === c); return ls.length ? `<tr class="cat-row"><td colspan="9"><b>${esc(c)}</b> <span class="muted">· prévu ${eur2(f.byCat[c] || 0)} · réel ${eur2(r.byCat[c] || 0)}</span></td></tr>` + ls.map(l => lineRow(l, proj, {qtyAll: true})).join('') : ''; }).join('')}</tbody></table></div>
    <div class="vh-actions mt">
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Salle">Ajouter une ligne salle</button>
      <button class="btn sm" data-act="addBudgetLine" data-show="${s.id}" data-cat="Promoteur">Ajouter une ligne promoteur</button>
      ${lines.length ? '' : `<button class="btn sm primary" data-act="prefillProduction" data-id="${s.id}">Préremplir (modèle du budget de production)</button>`}
      <button class="btn sm ghost" data-act="copyBudget" data-id="${s.id}">Copier les lignes d'une autre date</button>
    </div>
    ${dropZone(`data-budget-drop='${JSON.stringify({show_id:s.id})}'`, 'Glisse ici une facture ou un devis (ou sur une ligne précise) : l’IA la lit, met la ligne à jour et la range dans le Drive de la date (02_Finance).')}

    <h4 class="block-title">Résultat</h4>
    <div class="tbl-wrap"><table class="budget-table prod-table"><thead><tr><th></th><th class="num">Taux</th><th class="num">Prévu</th><th class="num">Réel</th></tr></thead><tbody>
      <tr><td>Recette nette de droits et taxes</td><td></td>${two(f.net, R(r.net))}</tr>
      <tr><td>Coûts de production HT</td><td></td>${two(-f.costs, -r.costs)}</tr>
      <tr><td>Promo locale (sur la recette nette)</td><td class="num">${pin(s, 'promo_net_pct', p.promo_net_pct, 'class="narrow"')} %</td><td colspan="2"></td></tr>
      <tr><td>Promo locale (sur les DL)</td><td class="num">${pin(s, 'promo_dl_pct', p.promo_dl_pct, 'class="narrow"')} %</td>${two(-f.promo, R(-r.promo))}</tr>
      <tr><td><b>Résultat hors DL</b></td><td></td>${two(f.result, R(r.result), 'strong')}</tr>
      <tr class="bill-total"><td><b>Résultat DL inclus</b></td><td></td>${two(f.resultDl, R(r.resultDl), 'strong')}</tr>
      ${f.share < 1 ? `<tr><td>Part L’ArtBo (${esc(fmtPct(p.artbo_share))})</td><td></td>${two(f.artbo, R(r.artbo))}</tr>
      <tr><td>Part ${esc(f.partnerName)} (${esc(fmtPct(100 - p.artbo_share))})</td><td></td>${two(f.partner, R(r.partner))}</tr>` : ''}
    </tbody></table></div>
    <p class="muted small mt-sm">Montants HT sauf la billetterie (TTC). Le réel se remplit avec les billets vendus et les montants réels des pièces ; tant qu’aucun billet vendu n’est saisi, les recettes réelles restent vides. Une date produite par L’ArtBo n’entre pas dans le compte dédié de l’artiste.</p>
  </div>`;
}
